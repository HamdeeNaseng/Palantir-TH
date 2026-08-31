import { MongoClient, type Db } from "mongodb";

const uri = process.env.MONGODB_URI ?? "mongodb://root:changeme@localhost:27017/palantir_th?authSource=admin";
const dbName = process.env.MONGODB_DB ?? "palantir_th";

/**
 * Tuned for the deployment target: Vercel serverless functions talking to
 * Atlas. Every value here is a serverless choice, not a general-purpose one.
 *
 * The timeouts used to be 2s "to fail fast rather than hang a render". That
 * budget is survivable against a MongoDB container on localhost and is not
 * survivable against Atlas from a cold function: an mongodb+srv:// connect
 * pays SRV + TXT DNS resolution, a TLS handshake and SCRAM auth before the
 * first command, which routinely exceeds 2s on a cold start. The result was a
 * connect that always failed in production while always succeeding locally,
 * surfacing as the "showing sample data" banner.
 */
const clientOptions = {
  /**
   * Per function instance, and each instance serves one request at a time, so
   * a large pool buys nothing and costs ~1MB of cluster RAM per idle socket.
   * A small ceiling still absorbs the parallel find() fan-out in loadBundle().
   */
  maxPoolSize: 5,
  /** Nothing pre-warmed: an idle function instance should hold no sockets. */
  minPoolSize: 0,
  /** Reap sockets left behind by an instance that goes idle between bursts. */
  maxIdleTimeMS: 30_000,
  /** Cold-start budget: SRV/TXT DNS + TLS + SCRAM against Atlas. */
  connectTimeoutMS: 10_000,
  /** Also covers Atlas replica-set failover, not just the initial connect. */
  serverSelectionTimeoutMS: 10_000,
  /**
   * Bounded well above the slowest query the app runs (the unfiltered
   * event_candidates scan in loadBundle, ~10k docs) so a slow read is not
   * mistaken for a dead connection, but still bounded so a half-open socket
   * cannot pin a function for its whole execution limit.
   */
  socketTimeoutMS: 45_000,
};

declare global {
  // eslint-disable-next-line no-var
  var _palantirMongo: Promise<MongoClient> | undefined;
}

function connect(): Promise<MongoClient> {
  return new MongoClient(uri, clientOptions).connect();
}

/**
 * One client per process, reused across warm invocations in production and
 * across HMR reloads in dev; a new pool per request or per file change would
 * pay the handshake every time.
 *
 * The rejection is evicted rather than cached. A cached rejected promise means
 * a single failed connect — a cold start racing an Atlas autoscale, one DNS
 * blip — permanently poisons that function instance: every later request
 * re-awaits the same rejection and shows the banner even after Atlas is
 * healthy again. Evicting lets the next request retry.
 */
export function getClient(): Promise<MongoClient> {
  return (global._palantirMongo ??= connect().catch((err) => {
    global._palantirMongo = undefined;
    throw err;
  }));
}

export async function getDb(): Promise<Db> {
  const client = await getClient();
  return client.db(dbName);
}

export const COLLECTIONS = {
  sourceRegistry: "source_registry",
  ingestionRuns: "ingestion_runs",
  rawRecords: "raw_records",
  eventCandidates: "event_candidates",
  canonicalEvents: "canonical_events",
  processingLogs: "processing_logs",
  cases: "cases",
  citizenReports: "citizen_reports",
  /** Analyst corrections layered over event_candidates — never edits to them. */
  caseCorrections: "case_corrections",

  /**
   * The response network on `/network`.
   *
   * `facilities` holds only what an analyst added by hand; the OSM-derived
   * ones live in `public/data/south-facilities.geojson` and are never copied
   * in here, so re-running the fetch cannot silently overwrite local
   * knowledge. `facility_log` is append-only and carries both kinds of entry
   * an operations desk produces — a status change and a coordination call —
   * because "who said it was closed, and when" is the same question for both.
   */
  facilities: "facilities",
  facilityLog: "facility_log",

  /**
   * Output of the Bayesian route-prediction batch in `ml-server/`. Written
   * only by `python run_batch.py`; this app reads them and never writes.
   *
   * Every document is tagged with the `run_id` that produced it, and
   * `flow_model_runs` carries which run is `live` — so a batch that is still
   * writing is never the one being read. See `src/server/flow/predictions.ts`.
   */
  flowModelRuns: "flow_model_runs",
  flowAnchors: "flow_anchors",
  flowCorridors: "flow_corridors",
  flowForecasts: "flow_forecasts",
  flowSegments: "flow_segments",

  /**
   * Output of the distance-pattern batch in `ml-server/`. Written only by
   * `python run_distance_pattern.py`; this app reads and never writes.
   *
   * One document per case, keyed by `event_id` — the `event_candidates._id`
   * foreign key — holding what lies around that case in each of 32 compass
   * directions. Unlike the flow collections there is no `live` pointer: runs
   * are resolved by taking the newest `computed_at` for the case asked for.
   * See `src/server/distance-pattern.ts`.
   */
  caseDistancePatterns: "result_batch_processing",
} as const;
