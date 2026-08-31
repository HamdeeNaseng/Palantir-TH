/**
 * Finds documents whose date fields are not BSON dates.
 *
 *   npx tsx --env-file=.env.local  scripts/probe-date-types.mts   # local
 *   npx tsx --env-file=vercel.env  scripts/probe-date-types.mts   # Atlas
 *
 * Every field listed here is one `toSnapshot` calls `.getTime()` on without
 * checking, so a single non-date value 500s /investigate and /events.
 */
import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI ?? "mongodb://root:changeme@localhost:27017/palantir_th?authSource=admin";
const client = await new MongoClient(uri).connect();
const db = client.db(process.env.MONGODB_DB ?? "palantir_th");

const checks: Array<[string, string]> = [
  ["event_candidates", "time.start"],
  ["citizen_reports", "reported_at"],
  ["cases", "occurred_at"],
  ["cases", "updates.at"],
];

let bad = 0;
for (const [coll, field] of checks) {
  const total = await db.collection(coll).countDocuments({});
  const n = await db.collection(coll).countDocuments({ [field]: { $not: { $type: "date" } } });
  bad += n;
  console.log(`${coll}.${field}: total=${total} non-date=${n}`);
  if (n > 0) {
    const rows = await db.collection(coll).find({ [field]: { $not: { $type: "date" } } }).limit(10).toArray();
    for (const r of rows) {
      const v = field.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], r);
      console.log(`  _id=${String(r._id)} source_id=${String((r as { source_id?: unknown }).source_id)} value=${JSON.stringify(v)} jsType=${typeof v}`);
    }
  }
}
await client.close();
process.exit(bad > 0 ? 1 : 0);
