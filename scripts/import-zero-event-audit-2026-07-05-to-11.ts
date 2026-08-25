/** Persist the completed zero-event audit for 5-11 Jul 2026. */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MongoClient } from "mongodb";
import type { IngestionRunDoc, RawRecordDoc, SourceRegistryDoc } from "../src/lib/types";

function loadEnv(): void {
  const path = resolve(process.cwd(), ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}
loadEnv();

const SOURCE_ID = "src_manual_research";
const WINDOW_ID = "verified-window-2026-07-05-to-11";
const RAW_ID = "raw_manual_audit_verified_window_2026_07_05_to_11";
const DEFAULT_URI = "mongodb://root:changeme@localhost:27017/palantir_th?authSource=admin";

async function main(): Promise<void> {
  const client = await new MongoClient(process.env.MONGODB_URI ?? DEFAULT_URI, { serverSelectionTimeoutMS: 5_000 }).connect();
  const startedAt = new Date();
  const runId = `run_audit_20260705_11_${startedAt.toISOString().replace(/\D/g, "").slice(0, 14)}_${randomUUID().slice(0, 8)}`;
  const counts = { downloaded: 0, new: 0, updated: 0, duplicate: 0, failed: 0 };
  try {
    const db = client.db(process.env.MONGODB_DB ?? "palantir_th");
    const source: SourceRegistryDoc = { _id: SOURCE_ID, name: "Palantir TH manual research ledger", shortName: "Manual research", category: "research", priority: "P3", role: "Manually corroborated event enrichment", connector: { type: "FORM" }, schedule: { mode: "snapshot", frequency: "manual" }, trust: { class: "manual_entry", score: 60 }, enabled: true };
    await db.collection<SourceRegistryDoc>("source_registry").updateOne({ _id: SOURCE_ID }, { $setOnInsert: source }, { upsert: true });
    const run: IngestionRunDoc = { _id: runId, source_id: SOURCE_ID, started_at: startedAt, finished_at: null, status: "running", records: counts };
    await db.collection<IngestionRunDoc>("ingestion_runs").insertOne(run);

    const audit = {
      record_type: "weekly_zero_event_audit",
      window_id: WINDOW_ID,
      local_window: { from: "2026-07-05T00:00:00+07:00", to: "2026-07-11T23:59:59.999+07:00" },
      scope: "เหตุความมั่นคง ความรุนแรง และปฏิบัติการบังคับใช้กฎหมายที่เกี่ยวเนื่องในปัตตานี ยะลา และนราธิวาส",
      database_before_update: { event_candidates: 0 },
      result: { verified_distinct_events: 0, candidate_updates: 0, note: "ไม่พบเหตุที่ยืนยันได้ในช่วงนี้; ผลค้นที่เกี่ยวข้องเป็นข่าวติดตาม เยียวยา เหตุเดือนก่อน หรือเหตุคนละปี" },
      sources_checked: [
        "https://www.isranews.org/article/south-news.html",
        "https://www.southpeace.go.th/",
        "https://opendata.sbpac.go.th/API/relief_01_01.aspx",
        "https://ucdp.uu.se/downloads/candidateged/GEDEvent_v26_0_7.csv",
        "https://www.thaipbs.or.th/news/archive/2026-07-05",
      ],
      query_dates_checked: ["2026-07-05", "2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10", "2026-07-11"],
    };
    const digest = createHash("sha256").update(JSON.stringify(audit)).digest("hex");
    const raw: RawRecordDoc = { _id: RAW_ID, source_id: SOURCE_ID, external_id: WINDOW_ID, retrieved_at: startedAt, source: { url: audit.sources_checked[0] }, dataset: { name: "Palantir TH weekly audit ledger", version: WINDOW_ID }, raw: audit, integrity: { content_hash: `sha256:${digest}`, algorithm: "sha256" }, processing: { status: "normalized" }, ingestion_run_id: runId };
    const rawResult = await db.collection<RawRecordDoc>("raw_records").updateOne({ _id: RAW_ID }, { $setOnInsert: raw }, { upsert: true });
    rawResult.upsertedCount ? counts.new++ : counts.duplicate++;

    await db.collection<IngestionRunDoc>("ingestion_runs").updateOne({ _id: runId }, { $set: { finished_at: new Date(), status: "success", records: counts } });
    console.log(JSON.stringify({ runId, window: WINDOW_ID, verifiedDistinctEvents: 0, counts }, null, 2));
  } catch (error) {
    await client.db(process.env.MONGODB_DB ?? "palantir_th").collection<IngestionRunDoc>("ingestion_runs").updateOne({ _id: runId }, { $set: { finished_at: new Date(), status: "failed", error: error instanceof Error ? error.message : String(error), records: { ...counts, failed: counts.failed + 1 } } });
    throw error;
  } finally {
    await client.close();
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
