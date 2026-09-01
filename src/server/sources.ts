import { COLLECTIONS, getDb } from "@/lib/mongodb";
import type {
  EventCandidateDoc,
  IngestionRunDoc,
  SourceRegistryDoc,
  SourceTrustClass,
} from "@/lib/types";

/**
 * Query layer for the source register (`/sources`).
 *
 * The page answers one question — "where is this app's evidence coming from,
 * and is any of it going stale" — so everything here is a per-source rollup
 * rather than a document listing. All of it is counted inside MongoDB: eleven
 * registry rows joined against 10k candidates and 10k raw records is a shape
 * the database aggregates in one pass and the app would otherwise stream in
 * full just to length-check the results.
 *
 * `superseded` candidates are excluded from every contribution count, matching
 * `listCases()`. A source whose rows were all replaced by a later correction
 * has contributed nothing to what the register currently shows, and counting
 * them here would make the two pages disagree about the same number.
 */

/** What a source contributed, and whether its pipe is still running. */
export interface SourceRow {
  id: string;
  name: string;
  shortName: string;
  category: string;
  role: string | null;
  priority: SourceRegistryDoc["priority"];
  connectorType: SourceRegistryDoc["connector"]["type"];
  endpoint: string | null;
  scheduleMode: SourceRegistryDoc["schedule"]["mode"];
  scheduleFrequency: string;
  trustClass: SourceTrustClass;
  trustScore: number;
  enabled: boolean;
  /** Candidates whose `source_id` is this source — its primary contribution. */
  events: number;
  /** Candidates from another source that name this one as corroboration. */
  corroborations: number;
  rawRecords: number;
  /** `events` as a share of every candidate in the register, 0-100. */
  share: number;
  /** Newest `time.start` among this source's candidates; null when it has none. */
  latestEventMs: number | null;
  lastRun: {
    atMs: number;
    status: IngestionRunDoc["status"];
    error: string | null;
    downloaded: number;
    added: number;
    failed: number;
  } | null;
  runs: number;
  /** Runs that ended `failed` or `partial` — the reliability signal. */
  runsUnhealthy: number;
}

/** One row of the "รอบดึงข้อมูลล่าสุด" panel. */
export interface RunRow {
  id: string;
  sourceId: string;
  sourceName: string;
  startedAtMs: number;
  finishedAtMs: number | null;
  status: IngestionRunDoc["status"];
  downloaded: number;
  added: number;
  failed: number;
  error: string | null;
}

/** Events grouped by the trust class of the source that reported them. */
export interface TrustSlice {
  trustClass: SourceTrustClass;
  sources: number;
  events: number;
  /** Share of all counted events, 0-100. */
  share: number;
}

export interface SourceDashboard {
  /** False when MongoDB is unreachable or the register has never been seeded. */
  live: boolean;
  totals: {
    sources: number;
    enabled: number;
    events: number;
    rawRecords: number;
    runs: number;
    runsSuccessful: number;
    /** Enabled sources that have produced no candidate at all. */
    silent: number;
    /** Newest `time.start` anywhere in the register. */
    latestEventMs: number | null;
  };
  rows: SourceRow[];
  recentRuns: RunRow[];
  trustMix: TrustSlice[];
  /** When the page was rendered — the reference point for every "x ago". */
  builtAtMs: number;
}

const EMPTY: SourceDashboard = {
  live: false,
  totals: {
    sources: 0,
    enabled: 0,
    events: 0,
    rawRecords: 0,
    runs: 0,
    runsSuccessful: 0,
    silent: 0,
    latestEventMs: null,
  },
  rows: [],
  recentRuns: [],
  trustMix: [],
  builtAtMs: 0,
};

/** Candidates a correction has replaced are not part of anyone's contribution. */
const NOT_SUPERSEDED = { "attributes.superseded_by": { $exists: false } };

/** How many runs the side panel lists. Bounded so a long history cannot grow it. */
const RECENT_RUN_LIMIT = 40;

interface CountBucket {
  _id: string | null;
  n: number;
}

interface RunRollup {
  _id: string | null;
  lastAt: Date;
  lastStatus: IngestionRunDoc["status"];
  lastError: string | null;
  lastDownloaded: number;
  lastAdded: number;
  lastFailed: number;
  runs: number;
  unhealthy: number;
  successful: number;
}

export async function getSourceDashboard(): Promise<SourceDashboard> {
  const builtAtMs = Date.now();

  try {
    const db = await getDb();
    const events = db.collection<EventCandidateDoc>(COLLECTIONS.eventCandidates);
    const runs = db.collection<IngestionRunDoc>(COLLECTIONS.ingestionRuns);

    const [
      registry,
      eventBuckets,
      corroborationBuckets,
      rawBuckets,
      latestBuckets,
      runRollups,
      recentRunDocs,
      rawTotal,
    ] = await Promise.all([
      db.collection<SourceRegistryDoc>(COLLECTIONS.sourceRegistry).find({}).toArray(),

      events
        .aggregate<CountBucket>([
          { $match: NOT_SUPERSEDED },
          { $group: { _id: "$source_id", n: { $sum: 1 } } },
        ])
        .toArray(),

      // Unwound because one candidate can name several corroborating sources;
      // grouping the array itself would count the combination, not each source.
      events
        .aggregate<CountBucket>([
          { $match: NOT_SUPERSEDED },
          { $unwind: "$corroborating_sources" },
          { $group: { _id: "$corroborating_sources", n: { $sum: 1 } } },
        ])
        .toArray(),

      db
        .collection(COLLECTIONS.rawRecords)
        .aggregate<CountBucket>([{ $group: { _id: "$source_id", n: { $sum: 1 } } }])
        .toArray(),

      events
        .aggregate<{ _id: string | null; latest: Date }>([
          { $match: NOT_SUPERSEDED },
          { $group: { _id: "$source_id", latest: { $max: "$time.start" } } },
        ])
        .toArray(),

      // `$sort` before `$group` is what makes `$first` mean "most recent run";
      // the counters are folded in the same pass rather than as a second query.
      runs
        .aggregate<RunRollup>([
          { $sort: { started_at: -1 } },
          {
            $group: {
              _id: "$source_id",
              lastAt: { $first: "$started_at" },
              lastStatus: { $first: "$status" },
              lastError: { $first: { $ifNull: ["$error", null] } },
              lastDownloaded: { $first: { $ifNull: ["$records.downloaded", 0] } },
              lastAdded: { $first: { $ifNull: ["$records.new", 0] } },
              lastFailed: { $first: { $ifNull: ["$records.failed", 0] } },
              runs: { $sum: 1 },
              unhealthy: {
                $sum: { $cond: [{ $in: ["$status", ["failed", "partial"]] }, 1, 0] },
              },
              successful: { $sum: { $cond: [{ $eq: ["$status", "success"] }, 1, 0] } },
            },
          },
        ])
        .toArray(),

      runs.find({}).sort({ started_at: -1 }).limit(RECENT_RUN_LIMIT).toArray(),

      db.collection(COLLECTIONS.rawRecords).estimatedDocumentCount(),
    ]);

    const byId = <T extends { _id: string | null }>(rows: T[]) =>
      new Map(rows.filter((r): r is T & { _id: string } => r._id !== null).map((r) => [r._id, r]));

    const eventsBy = byId(eventBuckets);
    const corroborationsBy = byId(corroborationBuckets);
    const rawBy = byId(rawBuckets);
    const latestBy = byId(latestBuckets);
    const runsBy = byId(runRollups);

    const totalEvents = eventBuckets.reduce((s, b) => s + b.n, 0);

    const rows: SourceRow[] = registry
      .map((s) => {
        const n = eventsBy.get(s._id)?.n ?? 0;
        const run = runsBy.get(s._id);

        return {
          id: s._id,
          name: s.name,
          shortName: s.shortName,
          category: s.category,
          role: s.role ?? null,
          priority: s.priority,
          connectorType: s.connector.type,
          endpoint: s.connector.endpoint ?? null,
          scheduleMode: s.schedule.mode,
          scheduleFrequency: s.schedule.frequency,
          trustClass: s.trust.class,
          trustScore: s.trust.score,
          enabled: s.enabled,
          events: n,
          corroborations: corroborationsBy.get(s._id)?.n ?? 0,
          rawRecords: rawBy.get(s._id)?.n ?? 0,
          share: totalEvents > 0 ? (n / totalEvents) * 100 : 0,
          latestEventMs: latestBy.get(s._id)?.latest?.getTime() ?? null,
          lastRun: run
            ? {
                atMs: run.lastAt.getTime(),
                status: run.lastStatus,
                error: run.lastError,
                downloaded: run.lastDownloaded,
                added: run.lastAdded,
                failed: run.lastFailed,
              }
            : null,
          runs: run?.runs ?? 0,
          runsUnhealthy: run?.unhealthy ?? 0,
        };
      })
      // Contribution first: the register is read to find out who is carrying
      // the dataset, and a source with no rows is the exception worth seeing
      // at the bottom rather than sorted alphabetically into the middle.
      .sort((a, b) => b.events - a.events || a.name.localeCompare(b.name, "th"));

    const nameOf = new Map(registry.map((s) => [s._id, s.shortName || s.name]));

    const recentRuns: RunRow[] = recentRunDocs.map((r) => ({
      id: r._id,
      sourceId: r.source_id,
      sourceName: nameOf.get(r.source_id) ?? r.source_id,
      startedAtMs: r.started_at.getTime(),
      finishedAtMs: r.finished_at?.getTime() ?? null,
      status: r.status,
      downloaded: r.records?.downloaded ?? 0,
      added: r.records?.new ?? 0,
      failed: r.records?.failed ?? 0,
      error: r.error ?? null,
    }));

    const mix = new Map<SourceTrustClass, { sources: number; events: number }>();
    for (const row of rows) {
      const slot = mix.get(row.trustClass) ?? { sources: 0, events: 0 };
      slot.sources += 1;
      slot.events += row.events;
      mix.set(row.trustClass, slot);
    }

    const trustMix: TrustSlice[] = [...mix.entries()]
      .map(([trustClass, v]) => ({
        trustClass,
        sources: v.sources,
        events: v.events,
        share: totalEvents > 0 ? (v.events / totalEvents) * 100 : 0,
      }))
      .sort((a, b) => b.events - a.events);

    const runTotals = runRollups.reduce(
      (acc, r) => ({ runs: acc.runs + r.runs, successful: acc.successful + r.successful }),
      { runs: 0, successful: 0 },
    );

    return {
      // A reachable but unseeded register is not something to report on — the
      // same rule `listCases()` applies, so both pages say "no data" together.
      live: registry.length > 0,
      totals: {
        sources: registry.length,
        enabled: registry.filter((s) => s.enabled).length,
        events: totalEvents,
        rawRecords: rawTotal,
        runs: runTotals.runs,
        runsSuccessful: runTotals.successful,
        silent: rows.filter((r) => r.enabled && r.events === 0).length,
        latestEventMs: rows.reduce<number | null>(
          (max, r) => (r.latestEventMs !== null && (max === null || r.latestEventMs > max) ? r.latestEventMs : max),
          null,
        ),
      },
      rows,
      recentRuns,
      trustMix,
      builtAtMs,
    };
  } catch (err) {
    // Database unavailable: an honest empty state, but never a silent one —
    // a bare `catch {}` here is what made the same failure on `/cases` show up
    // as nothing but a banner, with no reason anywhere in the Vercel log.
    console.error("[getSourceDashboard] MongoDB unavailable, serving empty state:", err);
    return { ...EMPTY, builtAtMs };
  }
}
