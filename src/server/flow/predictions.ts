import type { Document, Db } from "mongodb";
import { COLLECTIONS, getDb } from "@/lib/mongodb";
import type {
  PredictionAnchorProps,
  PredictionBundle,
  PredictionCorridorProps,
  PredictionFeatureCollection,
  PredictionForecast,
  PredictionOutlook,
  PredictionRunMeta,
  PredictionSegmentProps,
  PredictionUnavailableReason,
} from "@/lib/flow/prediction";
import type { Position } from "@/lib/geography";

/**
 * Reads the Bayesian route-prediction model out of MongoDB.
 *
 * The model is produced by the batch job in `ml-server/` and lands in the
 * `flow_*` collections. This app is a **reader only** — it never writes there,
 * and it never fits anything at request time. Corridor inference costs several
 * Dijkstra sweeps per district pair, which is exactly why it happens in a cron
 * job instead of inside a map interaction.
 *
 * ## Reading a versioned run
 *
 * Every batch writes under a fresh `run_id` and marks itself `live` only once
 * all its documents have landed. So the read here is always two steps: resolve
 * which run is live, then query that run's id. A batch writing right now is
 * invisible until it finishes, and a batch that died half-way is never read at
 * all.
 *
 * ## Failing visibly
 *
 * Every function returns `null` rather than throwing when the model is absent.
 * A fresh clone has never run the batch, and that must leave the map working
 * with the layer switched off — the same contract `computeFlowLegs` has for a
 * missing road graph. The distinction the caller needs is *why*, which is what
 * `PredictionUnavailableReason` carries: "nobody has run the batch" and "the
 * database is down" want different words on screen.
 */

/** How many corridors the overview layer draws. Beyond this it is a hairball. */
const DEFAULT_CORRIDOR_LIMIT = 60;
/** Enough to read the shape of the flow map without shipping all 5,000. */
const DEFAULT_SEGMENT_LIMIT = 1200;

const OUTLOOK_ID = "__outlook__";

export interface PredictionFailure {
  reason: PredictionUnavailableReason;
}

function isFailure<T>(value: T | PredictionFailure): value is PredictionFailure {
  return value !== null && typeof value === "object" && "reason" in (value as object);
}

/**
 * The live run document, or why there isn't one.
 *
 * `finished_at` descending rather than `started_at`: if two runs were ever
 * marked live at once, the one that finished last is the newer model.
 */
async function liveRun(db: Db): Promise<Document | null> {
  return db.collection(COLLECTIONS.flowModelRuns).findOne(
    { status: "live" },
    { sort: { finished_at: -1 } },
  );
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function iso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value) return value;
  return null;
}

function toRunMeta(run: Document): PredictionRunMeta {
  const model = (run.model ?? {}) as Document;
  const calibration = (model.calibration ?? {}) as Document;
  const backtest = (run.backtest ?? {}) as Document;
  const headline = (backtest.headline ?? {}) as Document;
  const data = (run.data ?? {}) as Document;
  const dateRange = (data.date_range ?? {}) as Document;

  return {
    runId: String(run.run_id),
    modelVersion: String(run.model_version ?? model.version ?? "unknown"),
    builtAt: iso(run.finished_at),
    tauDays: num(calibration.tau_days),
    blend: num(calibration.blend),
    skill: {
      top3: num(headline.top3_accuracy),
      randomTop3: num(backtest.random_top3_baseline),
      logLoss: num(headline.log_loss),
      skillVsUniform: num(headline.skill_vs_uniform),
    },
    caveats: Array.isArray(run.caveats) ? run.caveats.map(String) : [],
    corpus: {
      events: num(data.events_total),
      anchors: num(data.distinct_positions),
      activeDays: num(data.active_days),
      dataThrough: iso(dateRange.end),
    },
  };
}

/**
 * Everything the map's prediction layers need, in one payload.
 *
 * One round trip rather than four, because all of it is switched on by the
 * same toggle — and because the four collections only agree with each other
 * within a single run, so fetching them separately would let a batch promoting
 * mid-session mix two models on screen.
 */
export async function getPredictionBundle(options?: {
  corridorLimit?: number;
  segmentLimit?: number;
}): Promise<PredictionBundle | PredictionFailure> {
  const corridorLimit = options?.corridorLimit ?? DEFAULT_CORRIDOR_LIMIT;
  const segmentLimit = options?.segmentLimit ?? DEFAULT_SEGMENT_LIMIT;

  let db: Db;
  try {
    db = await getDb();
  } catch {
    return { reason: "db-unreachable" };
  }

  try {
    const run = await liveRun(db);
    if (!run) return { reason: "no-model-run" };
    const runId = run.run_id;

    const [anchorDocs, corridorDocs, segmentDocs, outlookDoc] = await Promise.all([
      db
        .collection(COLLECTIONS.flowAnchors)
        .find({ run_id: runId })
        .sort({ n_events: -1 })
        .toArray(),
      db
        .collection(COLLECTIONS.flowCorridors)
        .find({ run_id: runId })
        // Same tie-break as the per-anchor read, for the same reason: under
        // `--pairs all` the observed pairs lead, and the zero-co-occurrence
        // remainder is ordered by road distance rather than arbitrarily.
        .sort({ cooccurrence_days: -1, road_distance_m: 1 })
        .limit(corridorLimit)
        .toArray(),
      db
        .collection(COLLECTIONS.flowSegments)
        .find({ run_id: runId })
        .sort({ flow: -1 })
        .limit(segmentLimit)
        .toArray(),
      db.collection(COLLECTIONS.flowForecasts).findOne({ run_id: runId, anchor_id: OUTLOOK_ID }),
    ]);

    return {
      run: toRunMeta(run),
      outlook: outlookDoc ? toOutlook(outlookDoc) : null,
      anchors: toAnchorCollection(anchorDocs),
      corridors: toCorridorCollection(corridorDocs),
      segments: toSegmentCollection(segmentDocs),
    };
  } catch {
    return { reason: "db-unreachable" };
  }
}

function toAnchorCollection(docs: Document[]): PredictionFeatureCollection<PredictionAnchorProps> {
  return {
    type: "FeatureCollection",
    features: docs
      .filter((d) => Array.isArray(d.location?.coordinates))
      .map((d) => ({
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: d.location.coordinates as Position,
        },
        properties: {
          anchor_id: String(d.anchor_id),
          name: String(d.name ?? ""),
          district: d.district ? String(d.district) : null,
          n_events: num(d.n_events) ?? 0,
          match_confidence: num(d.match_confidence) ?? 0,
          recency_weight: num(d.recency_weight) ?? 0,
        },
      })),
  };
}

/**
 * Corridor documents to drawable lines.
 *
 * Only the highest-posterior route per pair by default. A pair carries up to
 * three candidates, and drawing all of them for sixty pairs is 180 overlapping
 * lines that say less than sixty do — the alternatives belong in the panel for
 * one selected pair, where they can be read against each other.
 */
function toCorridorCollection(
  docs: Document[],
  { allRoutes = false }: { allRoutes?: boolean } = {},
): PredictionFeatureCollection<PredictionCorridorProps> {
  const features = [];
  for (const doc of docs) {
    const routes: Document[] = Array.isArray(doc.routes) ? doc.routes : [];
    for (const route of allRoutes ? routes : routes.slice(0, 1)) {
      const coordinates = route.geometry?.coordinates;
      if (!Array.isArray(coordinates) || coordinates.length < 2) continue;
      features.push({
        type: "Feature" as const,
        geometry: { type: "LineString" as const, coordinates: coordinates as Position[] },
        properties: {
          from_id: String(doc.from_id),
          to_id: String(doc.to_id),
          from_name: String(doc.from_name ?? ""),
          to_name: String(doc.to_name ?? ""),
          rank: num(route.rank) ?? 1,
          posterior: num(route.posterior) ?? 0,
          prior: num(route.prior) ?? 0,
          length_m: num(route.length_m) ?? 0,
          cooccurrence_days: num(doc.cooccurrence_days) ?? 0,
          match_confidence: num(doc.match_confidence) ?? 0,
          prior_dominated: doc.prior_dominated === true,
        },
      });
    }
  }
  return { type: "FeatureCollection", features };
}

function toSegmentCollection(
  docs: Document[],
): PredictionFeatureCollection<PredictionSegmentProps> {
  return {
    type: "FeatureCollection",
    features: docs
      .filter((d) => Array.isArray(d.geometry?.coordinates))
      .map((d) => ({
        type: "Feature" as const,
        geometry: {
          type: "LineString" as const,
          coordinates: d.geometry.coordinates as Position[],
        },
        properties: {
          flow: num(d.flow) ?? 0,
          flow_normalised: num(d.flow_normalised) ?? 0,
        },
      })),
  };
}

function toOutlook(doc: Document): PredictionOutlook {
  const top: Document[] = Array.isArray(doc.top) ? doc.top : [];
  const focus = (doc.focus ?? null) as Document | null;
  return {
    asOf: iso(doc.as_of),
    focus: focus?.anchor_id
      ? { anchorId: String(focus.anchor_id), name: String(focus.name ?? "") }
      : null,
    top: top.map((t) => ({
      anchorId: String(t.anchor_id),
      name: String(t.name ?? ""),
      probability: num(t.probability) ?? 0,
    })),
  };
}

/**
 * One anchor's next-district posterior, plus its own corridors.
 *
 * Fetched on click rather than shipped with the bundle: 228 anchors' forecasts
 * are about a megabyte, and all but one of them is unread at any moment.
 */
export interface AnchorDetail {
  forecast: PredictionForecast;
  corridors: PredictionFeatureCollection<PredictionCorridorProps>;
}

/**
 * Returns `null` — distinct from a `PredictionFailure` — when the run is
 * healthy but holds no such anchor. Reporting that as "no model run" would
 * send the reader to rebuild a model that is already there; the real cause is
 * a stale anchor id, which is a 404.
 */
export async function getAnchorDetail(
  anchorId: string,
): Promise<AnchorDetail | PredictionFailure | null> {
  let db: Db;
  try {
    db = await getDb();
  } catch {
    return { reason: "db-unreachable" };
  }

  try {
    const run = await liveRun(db);
    if (!run) return { reason: "no-model-run" };
    const runId = run.run_id;

    const [forecastDoc, corridorDocs] = await Promise.all([
      db.collection(COLLECTIONS.flowForecasts).findOne({ run_id: runId, anchor_id: anchorId }),
      db
        .collection(COLLECTIONS.flowCorridors)
        // Corridors are stored once per undirected pair, so this anchor can be
        // at either end of its own corridors.
        .find({ run_id: runId, $or: [{ from_id: anchorId }, { to_id: anchorId }] })
        // Co-occurrence first, then the nearest by road. A batch run with
        // `--pairs all` gives every anchor 227 corridors, all but a handful of
        // them tied at zero co-occurrence — and an unqualified sort would fill
        // the eight slots from that tie in whatever order the index happened to
        // yield, differently on each request. Distance is what the prior is
        // built from, so ordering the tie by it shows the nearest corridors
        // rather than an arbitrary eight, and shows the same eight every time.
        .sort({ cooccurrence_days: -1, road_distance_m: 1 })
        .limit(8)
        .toArray(),
    ]);

    if (!forecastDoc) return null;

    const entries: Document[] = Array.isArray(forecastDoc.top) ? forecastDoc.top : [];
    return {
      forecast: {
        anchorId,
        name: String(forecastDoc.name ?? ""),
        observations: num(forecastDoc.observations) ?? 0,
        entries: entries.map((e) => ({
          anchorId: String(e.anchor_id),
          name: String(e.name ?? ""),
          mean: num(e.posterior_mean) ?? 0,
          low: num(e.cri90_low) ?? 0,
          high: num(e.cri90_high) ?? 0,
          cooccurrenceDays: num(e.cooccurrence_days) ?? 0,
          roadDistanceM: num(e.road_distance_m),
        })),
      },
      corridors: toCorridorCollection(corridorDocs, { allRoutes: true }),
    };
  } catch {
    return { reason: "db-unreachable" };
  }
}

export { isFailure };
