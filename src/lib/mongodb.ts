import dns from "node:dns";
import { MongoClient, type Db } from "mongodb";

const LOCAL_URI = "mongodb://root:changeme@localhost:27017/palantir_th?authSource=admin";

const uri = process.env.MONGODB_URI ?? LOCAL_URI;
const dbName = process.env.MONGODB_DB ?? "palantir_th";

/**
 * The default above is a convenience for a fresh clone, and a trap in
 * production: an unset `MONGODB_URI` on the host then reads as a perfectly
 * ordinary connection failure to `localhost:27017`, and the pages render the
 * same "ยังไม่มีข้อมูลใน MongoDB" screen they would show for a wrong password
 * or an un-allowlisted IP. Note that `.env.production` is gitignored and never
 * reaches a platform build — the variable has to be set in the host's own
 * environment (e.g. the Vercel project settings), per environment.
 *
 * Said once at module load rather than per request, so it appears at the top
 * of a cold function's log where it is actually findable.
 */
if (process.env.NODE_ENV === "production" && process.env.MONGODB_URI === undefined) {
  console.error(
    "[mongodb] MONGODB_URI is not set in this environment; falling back to localhost, " +
      "which cannot resolve from a deployed server. Set MONGODB_URI (and MONGODB_DB) " +
      "in the deployment platform's environment variables.",
  );
}

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

/**
 * True when this process has no resolver it can actually reach.
 *
 * Node reads its resolver list from the OS and, on Windows, sometimes comes up
 * with `127.0.0.1` where nothing is listening — while Windows itself resolves
 * the same name perfectly well. Every `mongodb+srv://` connect then dies in
 * milliseconds with `querySrv ECONNREFUSED`, which reads exactly like a dead
 * cluster and sends the reader to check Atlas, the password and the IP
 * allowlist for a fault that is none of them.
 */
function loopbackResolversOnly(): boolean {
  const servers = dns.getServers();
  return (
    servers.length > 0 &&
    servers.every((s) => {
      // Node reports a resolver as `1.2.3.4`, `1.2.3.4:5353`, or `[::1]:5353`.
      // A bare IPv6 address carries several colons, so it is never a host:port.
      const host = s.startsWith("[")
        ? s.slice(1, s.indexOf("]"))
        : s.split(":").length > 2
          ? s
          : s.replace(/:\d+$/, "");
      return host === "::1" || host.startsWith("127.");
    })
  );
}

const isSrvDnsFailure = (err: unknown): boolean => {
  const code = (err as { code?: string })?.code;
  const message = String((err as { message?: string })?.message ?? "");
  return (
    /querySrv|queryTxt/.test(message) &&
    (code === "ECONNREFUSED" || code === "ESERVFAIL" || code === "ETIMEOUT")
  );
};

/**
 * Public resolvers are used as a *fallback*, never as the default: overriding
 * a resolver that works would bypass split-horizon DNS, a VPN, or a private
 * Atlas endpoint. So the ordinary path is untouched, and this only runs after
 * a connect has already failed on SRV lookup with no reachable resolver — the
 * one case where the alternative is not "slower", it is "never connects".
 */
async function connect(): Promise<MongoClient> {
  try {
    return await new MongoClient(uri, clientOptions).connect();
  } catch (err) {
    if (!isSrvDnsFailure(err) || !loopbackResolversOnly()) throw err;
    console.warn(
      "[mongodb] SRV lookup failed and this process has no reachable DNS resolver " +
        `(${dns.getServers().join(", ")}); retrying once via 1.1.1.1 / 8.8.8.8. ` +
        "This is a local Node/Windows resolver fault, not an Atlas one.",
    );
    dns.setServers(["1.1.1.1", "8.8.8.8"]);
    return new MongoClient(uri, clientOptions).connect();
  }
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
