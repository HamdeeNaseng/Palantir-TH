import { MongoClient } from "mongodb";

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? "mongodb://root:changeme@localhost:27017/palantir_th?authSource=admin";
  const client = await new MongoClient(uri).connect();
  try {
  const db = client.db(process.env.MONGODB_DB ?? "palantir_th");
  const window = {
    "time.start": {
      $gte: new Date("2026-08-21T17:00:00.000Z"),
      $lt: new Date("2026-08-25T17:00:00.000Z"),
    },
  };
  const [total, sources, missingAddress, campaignRows, provisionalRows] = await Promise.all([
    db.collection("event_candidates").countDocuments(window),
    db.collection("event_candidates").aggregate([
      { $match: window },
      { $group: { _id: "$source_id", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]).toArray(),
    db.collection("event_candidates").countDocuments({ ...window, $or: [
      { "location.place": { $exists: false } }, { "location.place": null }, { "location.place": "" },
    ] }),
    db.collection("event_candidates").countDocuments({ ...window, "attributes.campaign_id": "south-unrest-2026-08-22-police-75" }),
    db.collection("event_candidates").countDocuments({ ...window, "attributes.provisional_case_slot": true }),
  ]);
  console.log(JSON.stringify({ total, sources, missingAddress, campaignRows, provisionalRows }, null, 2));
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
