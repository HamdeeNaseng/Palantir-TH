import { MongoClient, type Db } from "mongodb";

const uri = process.env.MONGODB_URI ?? "mongodb://root:changeme@localhost:27017/palantir_th?authSource=admin";
const dbName = process.env.MONGODB_DB ?? "palantir_th";

/**
 * Fail fast rather than hanging a page render for 30s when the container is down —
 * callers fall back to demo data (see src/server/investigate.ts).
 */
const clientOptions = { serverSelectionTimeoutMS: 2_000, connectTimeoutMS: 2_000 };

declare global {
  // eslint-disable-next-line no-var
  var _palantirMongo: Promise<MongoClient> | undefined;
}

function connect(): Promise<MongoClient> {
  return new MongoClient(uri, clientOptions).connect();
}

/**
 * A single client is reused across HMR reloads in dev; without the global the
 * dev server opens a new connection pool on every file change.
 */
const clientPromise: Promise<MongoClient> =
  process.env.NODE_ENV === "development"
    ? (global._palantirMongo ??= connect())
    : connect();

export default clientPromise;

export async function getDb(): Promise<Db> {
  const client = await clientPromise;
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
} as const;
