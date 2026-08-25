/** Import verified southern security events for 26 Jul-1 Aug 2026. */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MongoClient } from "mongodb";
import type { EventCandidateDoc, IngestionRunDoc, RawRecordDoc, SourceRegistryDoc } from "../src/lib/types";

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
const WINDOW_ID = "verified-window-2026-07-26-to-08-01";
const EVENT_ID = "evt_verified_20260726_ban_nam_bo_weapon_seizure";
const RAW_ID = "raw_verified_20260726_ban_nam_bo_weapon_seizure";
const DEFAULT_URI = "mongodb://root:changeme@localhost:27017/palantir_th?authSource=admin";

const evidence = {
  record_type: "manual_research_claim",
  window_id: WINDOW_ID,
  incident: {
    occurred_on: "2026-07-26",
    time_precision: "day",
    address: "บ้านน้ำบ่อ หมู่ 4 ตำบลบ้านน้ำบ่อ อำเภอปะนาเระ จังหวัดปัตตานี",
    action: "ควบคุมผู้ต้องสงสัยเพื่อซักถามและตรวจยึดอาวุธปืนพร้อมเครื่องกระสุน",
    seized_items: ["ปืนลูกซองยาว 1 กระบอก", "กระสุนปืนลูกซองเบอร์ 12 จำนวน 13 นัด"],
    casualties: { killed: 0, injured: 0 },
    legal_caveat: "บันทึกยืนยันการปฏิบัติของเจ้าหน้าที่เท่านั้น ไม่ใช่การยืนยันความผิดของผู้ถูกควบคุมตัว",
  },
  sources: [{ publisher: "กอ.รมน.ภาค 4 สน.", url: "https://www.southpeace.go.th/?p=180750" }],
  caveat: "Manually corroborated claim record; not an original publisher payload.",
};

async function main(): Promise<void> {
  const client = await new MongoClient(process.env.MONGODB_URI ?? DEFAULT_URI, { serverSelectionTimeoutMS: 5_000 }).connect();
  const startedAt = new Date();
  const runId = `run_verified_20260726_0801_${startedAt.toISOString().replace(/\D/g, "").slice(0, 14)}_${randomUUID().slice(0, 8)}`;
  try {
    const db = client.db(process.env.MONGODB_DB ?? "palantir_th");
    const source: SourceRegistryDoc = {
      _id: SOURCE_ID, name: "Palantir TH manual research ledger", shortName: "Manual research", category: "research", priority: "P3",
      role: "Manually corroborated event enrichment", connector: { type: "FORM" }, schedule: { mode: "snapshot", frequency: "manual" },
      trust: { class: "manual_entry", score: 60 }, enabled: true,
    };
    await db.collection<SourceRegistryDoc>("source_registry").updateOne({ _id: SOURCE_ID }, { $setOnInsert: source }, { upsert: true });

    const run: IngestionRunDoc = {
      _id: runId, source_id: SOURCE_ID, started_at: startedAt, finished_at: null, status: "running",
      records: { downloaded: 1, new: 0, updated: 0, duplicate: 0, failed: 0 },
    };
    await db.collection<IngestionRunDoc>("ingestion_runs").insertOne(run);

    const digest = createHash("sha256").update(JSON.stringify(evidence)).digest("hex");
    const raw: RawRecordDoc = {
      _id: RAW_ID, source_id: SOURCE_ID, external_id: `${WINDOW_ID}-001`, retrieved_at: startedAt,
      source: { url: evidence.sources[0].url }, dataset: { name: "Palantir TH verified event window", version: WINDOW_ID }, raw: evidence,
      integrity: { content_hash: `sha256:${digest}`, algorithm: "sha256" }, processing: { status: "normalized" }, ingestion_run_id: runId,
    };
    await db.collection<RawRecordDoc>("raw_records").updateOne({ _id: RAW_ID }, { $setOnInsert: raw }, { upsert: true });

    const candidate: EventCandidateDoc = {
      _id: EVENT_ID, source_id: SOURCE_ID, raw_record_id: RAW_ID,
      time: { start: new Date("2026-07-26T00:00:00+07:00"), precision: "day" },
      location: {
        province: "ปัตตานี", provinceCode: "pattani", district: "ปะนาเระ", subdistrict: "บ้านน้ำบ่อ",
        place: "บ้านน้ำบ่อ หมู่ 4 ตำบลบ้านน้ำบ่อ อำเภอปะนาเระ จังหวัดปัตตานี", geo: null, geo_precision: "unknown",
      },
      event: {
        type: "raid", title: "ควบคุมผู้ต้องสงสัยและยึดปืนลูกซองที่บ้านน้ำบ่อ",
        summary: "เจ้าหน้าที่หน่วยเฉพาะกิจกรมทหารพรานที่ 42 ควบคุมผู้ต้องสงสัยชายอายุ 41 ปีเพื่อเข้าสู่กระบวนการซักถาม พร้อมตรวจยึดปืนลูกซองยาว 1 กระบอกและกระสุนลูกซองเบอร์ 12 จำนวน 13 นัด โดยยังต้องตรวจพิสูจน์ความเชื่อมโยงทางนิติวิทยาศาสตร์และไม่ถือเป็นการยืนยันความผิด",
        rawType: "บังคับใช้กฎหมาย ควบคุมตัว และตรวจยึดอาวุธ",
      },
      severity: 2, verification: "verified", confidence: 90, casualties: { killed: 0, injured: 0 },
      actors: ["หน่วยเฉพาะกิจกรมทหารพรานที่ 42"], targets: ["ผู้ต้องสงสัยชาย อายุ 41 ปี"], corroborating_sources: [SOURCE_ID], media: [],
      attributes: {
        research_batch: WINDOW_ID, location_address: evidence.incident.address, location_text_precision: "village",
        detained_count: 1, legal_status: "ผู้ต้องสงสัย อยู่ระหว่างกระบวนการซักถาม", shotgun_count: 1,
        ammunition_type: "กระสุนปืนลูกซองเบอร์ 12", ammunition_count: 13, forensic_link_pending: true,
        source_count: 1, source_url_1: evidence.sources[0].url,
      },
      unreported: ["coordinates", "exact_time", "case_number", "forensic_result"],
    };
    const result = await db.collection<EventCandidateDoc>("event_candidates").updateOne({ _id: EVENT_ID }, { $setOnInsert: candidate }, { upsert: true });
    const inserted = result.upsertedCount === 1;
    const records = { downloaded: 1, new: inserted ? 1 : 0, updated: 0, duplicate: inserted ? 0 : 1, failed: 0 };
    await db.collection<IngestionRunDoc>("ingestion_runs").updateOne({ _id: runId }, { $set: { finished_at: new Date(), status: "success", records } });
    console.log(JSON.stringify({ runId, window: WINDOW_ID, eventId: EVENT_ID, records }, null, 2));
  } catch (error) {
    await client.db(process.env.MONGODB_DB ?? "palantir_th").collection<IngestionRunDoc>("ingestion_runs").updateOne(
      { _id: runId }, { $set: { finished_at: new Date(), status: "failed", error: error instanceof Error ? error.message : String(error), "records.failed": 1 } },
    );
    throw error;
  } finally {
    await client.close();
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
