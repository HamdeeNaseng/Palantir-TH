/**
 * Converts date fields stored as ISO-8601 strings into real BSON dates.
 *
 *   npx tsx --env-file=.env.local scripts/fix-string-dates.mts --dry-run
 *   npx tsx --env-file=.env.local scripts/fix-string-dates.mts
 *
 * The companion to scripts/probe-date-types.mts: the probe reports which
 * documents are wrong, this repairs them. Same field list, deliberately --
 * a field worth probing is a field worth fixing, and keeping the two lists in
 * step is easier than reasoning about why they differ.
 *
 * Why it matters in two places at once:
 *
 *   - `toSnapshot` calls `.getTime()` on these fields without checking, so a
 *     single string 500s /investigate and /events.
 *   - pymongo returns a BSON date tz-naive while an ISO string carrying `Z`
 *     parses tz-aware, so a column holding both stops the ml-server batch with
 *     "Cannot mix tz-aware with tz-naive values" on the first read.
 *
 * Only values that round-trip exactly are written. A string that does not parse,
 * or whose parse does not re-serialise to the same instant, is reported and left
 * alone -- this repairs a representation, it does not guess at a date.
 */
import { MongoClient } from "mongodb";

const uri =
  process.env.MONGODB_URI ??
  "mongodb://root:changeme@localhost:27017/palantir_th?authSource=admin";
const dbName = process.env.MONGODB_DB ?? "palantir_th";

const DRY_RUN = process.argv.includes("--dry-run");

/** Same fields as scripts/probe-date-types.mts. */
const checks: Array<[string, string]> = [
  ["event_candidates", "time.start"],
  ["citizen_reports", "reported_at"],
  ["cases", "occurred_at"],
];

function readPath(doc: unknown, field: string): unknown {
  return field
    .split(".")
    .reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], doc);
}

/**
 * The parsed instant, or null when the string is not an exact ISO-8601 UTC
 * instant. `Date.parse` is lenient enough to accept things nobody meant as a
 * date, so the result has to serialise back to the same moment to be trusted.
 */
function exactDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  const parsed = new Date(ms);
  return parsed.toISOString() === new Date(value).toISOString() ? parsed : null;
}

const client = await new MongoClient(uri).connect();
const db = client.db(dbName);

console.log(`${DRY_RUN ? "DRY RUN" : "REPAIR"}  ${dbName} @ ${uri.replace(/\/\/[^@]+@/, "//***@")}`);

let converted = 0;
let skipped = 0;

for (const [coll, field] of checks) {
  const bad = await db
    .collection(coll)
    .find({ [field]: { $exists: true, $not: { $type: "date" } } })
    .toArray();

  if (bad.length === 0) {
    console.log(`${coll}.${field}: clean`);
    continue;
  }

  console.log(`${coll}.${field}: ${bad.length} to repair`);

  for (const doc of bad) {
    const raw = readPath(doc, field);
    const parsed = exactDate(raw);

    if (!parsed) {
      skipped += 1;
      console.log(`  SKIP _id=${String(doc._id)} value=${JSON.stringify(raw)} (not an exact ISO instant)`);
      continue;
    }

    if (!DRY_RUN) {
      await db.collection(coll).updateOne({ _id: doc._id }, { $set: { [field]: parsed } });
    }
    converted += 1;
  }

  console.log(`  ${DRY_RUN ? "would convert" : "converted"}: ${bad.length - skipped}`);
}

console.log(`\n${DRY_RUN ? "would convert" : "converted"}: ${converted}   skipped: ${skipped}`);
if (DRY_RUN) console.log("nothing was written");

await client.close();
process.exit(skipped > 0 ? 1 : 0);
