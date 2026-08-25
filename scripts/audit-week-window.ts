import { MongoClient } from "mongodb";

async function main(): Promise<void> {
  const from = process.argv[2];
  const toExclusive = process.argv[3];
  if (!from || !toExclusive) {
    throw new Error("Usage: tsx scripts/audit-week-window.ts <from-iso> <to-exclusive-iso>");
  }

  const client = await new MongoClient(
    process.env.MONGODB_URI ?? "mongodb://root:changeme@localhost:27017/palantir_th?authSource=admin",
  ).connect();
  try {
    const db = client.db(process.env.MONGODB_DB ?? "palantir_th");
    const rows = await db
      .collection("event_candidates")
      .find({ "time.start": { $gte: new Date(from), $lt: new Date(toExclusive) } })
      .sort({ "time.start": 1, _id: 1 })
      .toArray();
    const rawIds = rows.map((row) => row.raw_record_id).filter((id): id is string => typeof id === "string");
    const raw = await db.collection<{ _id: string }>("raw_records").find({ _id: { $in: rawIds } }).toArray();
    const visible = rows.filter((row) => !row.attributes?.superseded_by);
    const rawIdSet = new Set(raw.map((record) => record._id));
    const summary = {
      stored: rows.length,
      visible: visible.length,
      superseded: rows.length - visible.length,
      missingAddress: visible.filter((row) => !row.location?.place).map((row) => row._id),
      missingRaw: rows.filter((row) => !rawIdSet.has(row.raw_record_id)).map((row) => row._id),
      visibleIds: visible.map((row) => row._id),
    };
    console.log(JSON.stringify(process.argv.includes("--summary") ? summary : { summary, rows, raw }, null, 2));
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
