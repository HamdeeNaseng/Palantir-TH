/**
 * Seeds MongoDB with the Phase 0 collections from MVP.md.
 *
 *   docker compose up -d
 *   npm run db:seed
 *
 * Raw data is append-only by design, so this script refuses to run against a
 * database that already holds raw_records unless --force is passed.
 */
import { MongoClient } from "mongodb";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildAll } from "../src/lib/fixtures";

// Minimal .env loader — avoids pulling in dotenv for one script.
function loadEnv() {
  try {
    const text = readFileSync(resolve(process.cwd(), ".env"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
  } catch {
    // No .env — rely on the ambient environment.
  }
}

async function main() {
  loadEnv();

  const force = process.argv.includes("--force");
  const uri = process.env.MONGODB_URI!;
  const dbName = process.env.MONGODB_DB ?? "palantir_th";

  const client = await new MongoClient(uri, { serverSelectionTimeoutMS: 5_000 }).connect();
  const db = client.db(dbName);

  const existing = await db.collection("raw_records").estimatedDocumentCount();
  if (existing > 0 && !force) {
    console.error(
      `raw_records already holds ${existing} documents. Raw data is append-only — ` +
        `pass --force only if you intend to wipe the development database.`,
    );
    await client.close();
    process.exit(1);
  }

  const { sources, events, citizenReports, ingestionRuns, cases } = buildAll();

  // Every candidate references the raw record it was derived from; generate the
  // raw layer alongside so the lineage in MVP.md holds from the first seed.
  const rawRecords = events.map((e) => ({
    _id: e.raw_record_id,
    source_id: e.source_id,
    external_id: e._id,
    retrieved_at: e.time.start,
    source: { url: `https://example.invalid/${e.source_id}/${e._id}` },
    raw: {
      event_date: e.time.start.toISOString(),
      event_type: e.event.type,
      location: `${e.location.district}, ${e.location.province}`,
      latitude: e.location.geo.coordinates[1],
      longitude: e.location.geo.coordinates[0],
      fatalities: e.casualties.killed,
    },
    integrity: { content_hash: `sha256:${e._id}` },
    processing: { status: "normalized" as const },
  }));

  const plan: [string, unknown[]][] = [
    ["source_registry", sources],
    ["ingestion_runs", ingestionRuns],
    ["raw_records", rawRecords],
    ["event_candidates", events],
    ["cases", cases],
    ["citizen_reports", citizenReports],
  ];

  for (const [name, docs] of plan) {
    await db.collection(name).deleteMany({});
    if (docs.length) await db.collection(name).insertMany(docs as never[], { ordered: false });
    console.log(`  ${name.padEnd(18)} ${docs.length}`);
  }

  // Indexes that the query layer will need as soon as filtering moves into Mongo.
  await db.collection("event_candidates").createIndexes([
    { key: { "time.start": -1 } },
    { key: { "location.provinceCode": 1, "event.type": 1 } },
    { key: { "location.geo": "2dsphere" } },
    { key: { verification: 1 } },
  ]);
  await db.collection("raw_records").createIndex({ "integrity.content_hash": 1 }, { unique: true });
  await db.collection("citizen_reports").createIndex({ reported_at: -1 });
  await db.collection("ingestion_runs").createIndex({ source_id: 1, started_at: -1 });

  console.log(`\nSeeded ${dbName}.`);
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
