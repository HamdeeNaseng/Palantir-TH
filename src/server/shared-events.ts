import { COLLECTIONS, getDb } from "@/lib/mongodb";
import { readCachedBundle } from "./bundle-cache";
import { EVENT_COLOR } from "@/lib/palette";
import { RANGE_DAYS, type InvestigationFilters } from "@/lib/filters";
import { TRUSTED_SCORE_FLOOR } from "@/lib/snapshot";
import { msOr } from "@/lib/datetime";
import { asGeoPrecision, asSeverityLevel, geoPrecisionRadiusM } from "@/lib/types";
import type {
  CaseDoc,
  CitizenReportDoc,
  EventCandidateDoc,
  EventType,
  GeoPrecision,
  IngestionRunDoc,
  SourceRegistryDoc,
  VerificationStatus,
} from "@/lib/types";

/**
 * One event as a GeoJSON feature for MapLibre. Properties are flat scalars
 * because MapLibre filter/paint expressions can only read primitives — hence
 * the `*_known` booleans standing in for values that are really `number |
 * null` on the source document.
 *
 * Defined here (not in `investigate.ts`, which used to own it) because both
 * `/investigate` and `/events` build and consume this shape; `investigate.ts`
 * re-exports it so existing imports of `EventFeatureCollection` from there
 * keep working unchanged.
 */
export interface EventFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: {
    id: string;
    type: EventType;
    severity: number;
    /** false when the source reported nothing implying severity. */
    severity_known: boolean;
    confidence: number;
    /** Epoch ms — drives `["<=", ["get","ts"], t]` timeline replay. */
    ts: number;
    title: string;
    district: string;
    province: string;
    precision: GeoPrecision;
    /** Nominal positional error in metres, for the uncertainty layer. */
    precision_m: number;
    color: string;
    verification: VerificationStatus;
    /** false when the source reported nothing implying a death toll. */
    killed_known: boolean;
    killed: number;
    /** false when the source reported nothing implying an injury toll. */
    injured_known: boolean;
    injured: number;
    sources_count: number;
    media_count: number;
    actors_count: number;
    targets_count: number;
  };
}

export interface EventFeatureCollection {
  type: "FeatureCollection";
  features: EventFeature[];
}

/**
 * The bundle-load and event-matching engine shared by `/investigate` and
 * `/events` — extracted out of `investigate.ts` so a second page consuming the
 * same event set doesn't grow a second, silently-diverging copy of "what does
 * this filter set actually match".
 */

/**
 * Re-exported rather than declared: `@/lib/snapshot` owns this now, because the
 * browser applies the same "เฉพาะแหล่งข้อมูลที่เชื่อถือได้" condition against its
 * cached copy. Two constants that must agree is one more than there should be.
 */
export { TRUSTED_SCORE_FLOOR } from "@/lib/snapshot";

export interface RawBundle {
  sources: SourceRegistryDoc[];
  events: EventCandidateDoc[];
  citizenReports: CitizenReportDoc[];
  ingestionRuns: IngestionRunDoc[];
  cases: CaseDoc[];
  /** False when MongoDB is unavailable. No fixture data is substituted. */
  live: boolean;
}

/**
 * The `event_candidates` fields this bundle's three consumers actually read —
 * `toSnapshot`, `getMapOverview` and `getMapEvents`, and nothing else.
 *
 * Applied at the server rather than in Node because the cost of this scan is
 * transfer, not query: `event_candidates` is 30.6 MB across 10,300 documents
 * (avgObjSize 2,969 B), and measured end to end it moves at ~94 KB/s from a
 * function to the Atlas cluster — dead constant across runs, because the two
 * are on opposite sides of the Pacific. 30 MB at that rate is 320 s, which is
 * how a page with a 300 s ceiling returns HTTP 200 and then dies mid-stream.
 *
 * Fetching only these fields measured 6.63 MB and 70 s against the same
 * cluster: 4.5x less data, 4.6x less time, exactly proportional. The 20.9% of
 * every document taken by the `attributes` bag of upstream dataset columns is
 * the largest single thing dropped, and nothing here has ever read it.
 *
 * Keep in sync with `toSnapshot` (src/server/snapshot.ts) and
 * `toEventFeature` below: a field added there and forgotten here arrives as
 * `undefined`, not as an error.
 */
const EVENT_PROJECTION = {
  "event.type": 1,
  "event.title": 1,
  "location.provinceCode": 1,
  "location.province": 1,
  "location.district": 1,
  "location.subdistrict": 1,
  "location.geo": 1,
  "location.geo_precision": 1,
  "time.start": 1,
  severity: 1,
  confidence: 1,
  verification: 1,
  "casualties.killed": 1,
  "casualties.injured": 1,
  corroborating_sources: 1,
  // Only ever read as `.length`, but the arrays are small next to what is
  // being dropped and $size would cost an aggregation pipeline here.
  media: 1,
  actors: 1,
  targets: 1,
} as const;

/** The empty bundle — what every failure path serves instead of fixtures. */
const emptyBundle = (): RawBundle => ({
  sources: [],
  events: [],
  citizenReports: [],
  ingestionRuns: [],
  cases: [],
  live: false,
});

/**
 * Reads the document layers from MongoDB. An unavailable or unseeded database
 * returns an empty bundle; production must never silently substitute mock data.
 *
 * Served from `snapshot_cache` when a build is present, because the direct
 * scan below cannot complete against this cluster: even projected it is
 * 6.24 MB, the measured throughput is ~94 KB/s, and `socketTimeoutMS` is 45 s.
 * The scan is kept as the fallback for a fresh clone or a local docker
 * database, where it is both fast and the only thing there is to read.
 */
export async function loadBundle(): Promise<RawBundle> {
  try {
    const cached = await readCachedBundle();
    if (cached) return cached.bundle;

    console.warn(
      "[loadBundle] no precomputed bundle in snapshot_cache; falling back to a " +
        "direct scan. Against a throttled cluster this will exceed socketTimeoutMS " +
        "— run `npm run snapshot:build` to populate it.",
    );
    return await scanBundle();
  } catch (err) {
    // Database unavailable: preserve an honest empty state, but never swallow
    // the reason. A bare `catch {}` here is why a production outage showed up
    // only as the "sample data" banner, with nothing in the Vercel logs to say
    // whether the URI was wrong, the IP was not allowlisted, or auth failed.
    console.error("[loadBundle] MongoDB unavailable, serving empty state:", err);
  }

  return emptyBundle();
}

/**
 * The direct read of all five collections.
 *
 * Exported because `scripts/build-snapshot-cache.ts` is the one caller that
 * *should* pay for it: run from a machine with no request deadline and a
 * socket timeout raised to match, it is the input the cache is built from.
 */
export async function scanBundle(): Promise<RawBundle> {
  const db = await getDb();
  const [sources, events, citizenReports, ingestionRuns, cases] = await Promise.all([
    db.collection<SourceRegistryDoc>(COLLECTIONS.sourceRegistry).find({}).toArray(),
    db
      .collection<EventCandidateDoc>(COLLECTIONS.eventCandidates)
      .find({}, { projection: EVENT_PROJECTION })
      .toArray(),
    db.collection<CitizenReportDoc>(COLLECTIONS.citizenReports).find({}).toArray(),
    db.collection<IngestionRunDoc>(COLLECTIONS.ingestionRuns).find({}).toArray(),
    db.collection<CaseDoc>(COLLECTIONS.cases).find({}).toArray(),
  ]);

  return { sources, events, citizenReports, ingestionRuns, cases, live: sources.length > 0 };
}

/**
 * `windowsBack` shifts the window into the past by whole window lengths: 0 is
 * the current period, 1 the immediately preceding one (used for KPI deltas).
 * `now` is threaded in explicitly rather than read off a module global — two
 * in-flight requests on the same server process must not be able to shift
 * each other's "now" mid-computation.
 */
function inRange(
  at: Date,
  range: InvestigationFilters["range"],
  now: Date,
  windowsBack = 0,
): boolean {
  const days = RANGE_DAYS[range];
  if (days === null) return windowsBack === 0;
  const age = now.getTime() - at.getTime();
  const span = days * 86400000;
  return age > windowsBack * span && age <= (windowsBack + 1) * span;
}

/** Which filter dimension a facet count should compute with lifted. */
export type FilterDimension = "province" | "type" | "verification" | "source" | "trusted";

export interface MatchedEventsOptions {
  /** Skip this one condition — how a facet counts "what if this weren't ticked". */
  except?: FilterDimension;
  /** Defaults to `new Date()`; pass one instant for every call in a request. */
  now?: Date;
  windowsBack?: number;
}

/**
 * Which events in `bundle` satisfy `filters`, optionally with one dimension's
 * condition lifted out — the same "except" idea `src/server/cases.ts` uses so
 * a sidebar count can answer "how many if this box weren't ticked" without a
 * second, drifting copy of the filter ladder.
 */
export function matchedEvents(
  bundle: Pick<RawBundle, "events" | "sources">,
  filters: InvestigationFilters,
  opts: MatchedEventsOptions = {},
): EventCandidateDoc[] {
  const now = opts.now ?? new Date();
  const windowsBack = opts.windowsBack ?? 0;
  const except = opts.except;

  const trusted = new Set(
    bundle.sources.filter((s) => s.trust.score >= TRUSTED_SCORE_FLOOR).map((s) => s._id),
  );

  return bundle.events.filter((e) => {
    if (!inRange(e.time.start, filters.range, now, windowsBack)) return false;
    if (except !== "province" && filters.provinces.length && !filters.provinces.includes(e.location.provinceCode)) {
      return false;
    }
    if (except !== "type" && filters.eventTypes.length && !filters.eventTypes.includes(e.event.type)) {
      return false;
    }
    if (except !== "verification" && filters.verification.length && !filters.verification.includes(e.verification)) {
      return false;
    }
    // `?? []` throughout: a handful of ingested documents omit these arrays
    // entirely rather than sending them empty. An event that lists no source
    // genuinely matches neither a source filter nor a trusted-only filter, so
    // absence and emptiness give the same answer here — and neither should be
    // a 500. See `msOrNull` in `@/lib/datetime` for the same problem in dates.
    const sources = e.corroborating_sources ?? [];
    if (except !== "source" && filters.sourceId !== "all" && !sources.includes(filters.sourceId)) {
      return false;
    }
    if (except !== "trusted" && filters.trustedOnly && !sources.some((id) => trusted.has(id))) {
      return false;
    }
    return true;
  });
}

/**
 * Drawn for events whose source reports no severity. Deliberately the middle
 * of the scale so an unknown neither shouts nor disappears; `severity_known`
 * carries the truth for anything that needs to tell them apart.
 */
const UNKNOWN_SEVERITY_FALLBACK = 3;

/**
 * One event as a GeoJSON feature for MapLibre. Properties are flat scalars
 * because MapLibre filter/paint expressions can only read primitives.
 */
export function toEventFeature(e: EventCandidateDoc): EventFeature | null {
  // An address is useful evidence even when the source publishes no point.
  // Keep that event in lists and statistics, but never invent a map marker.
  if (!e.location.geo) return null;
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: e.location.geo.coordinates },
    properties: {
      id: e._id,
      type: e.event.type,
      // MapLibre paint expressions cannot read null, so an unreported
      // severity is drawn at the neutral middle rather than omitted. The
      // `severity_known` flag keeps the distinction visible to the UI.
      // Coerced, not just null-checked: part of the corpus stores a word here,
      // which passes `!== null` and then reaches a numeric paint expression.
      severity: asSeverityLevel(e.severity) ?? UNKNOWN_SEVERITY_FALLBACK,
      severity_known: asSeverityLevel(e.severity) !== null,
      confidence: e.confidence,
      // Coerced, not trusted: one string timestamp in the corpus would
      // otherwise throw here and 500 the whole map. An unreadable one is
      // placed at load time, which puts it at the end of the replay rather
      // than at the 1970 end of the scrubber. See `msOr`.
      ts: msOr(e.time.start, Date.now()),
      title: e.event.title,
      district: e.location.district,
      province: e.location.province,
      precision: asGeoPrecision(e.location.geo_precision),
      precision_m: geoPrecisionRadiusM(e.location.geo_precision),
      color: EVENT_COLOR[e.event.type],
      // An absent `casualties` object reads exactly like one reporting null:
      // the source did not say. `killed_known` already carries that
      // distinction to the UI, so nothing here has to invent a number.
      killed_known: e.casualties?.killed != null,
      killed: e.casualties?.killed ?? 0,
      injured_known: e.casualties?.injured != null,
      injured: e.casualties?.injured ?? 0,
      verification: e.verification,
      sources_count: e.corroborating_sources?.length ?? 0,
      media_count: e.media?.length ?? 0,
      actors_count: e.actors?.length ?? 0,
      targets_count: e.targets?.length ?? 0,
    },
  };
}
