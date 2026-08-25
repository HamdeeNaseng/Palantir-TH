/** Audit and add verified southern security incidents for 5-11 Apr 2026. */
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
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
    }
  }
}
loadEnv();

const SOURCE_ID = "src_manual_research";
const WINDOW_ID = "verified-window-2026-04-05-to-11";
const EVENT_URL = "https://www.southpeace.go.th/?p=167128";
const ADDRESS_URL = "https://saiburi.pattani.police.go.th/contact/";
const DEFAULT_URI = "mongodb://root:changeme@localhost:27017/palantir_th?authSource=admin";

const candidate: EventCandidateDoc = {
  _id: "evt_verified_20260410_saiburi_suspect_detention",
  source_id: SOURCE_ID,
  raw_record_id: "raw_verified_20260410_saiburi_suspect_detention",
  time: { start: new Date("2026-04-10T15:49:00+07:00"), precision: "minute" },
  location: {
    province: "ปัตตานี",
    provinceCode: "pattani",
    district: "สายบุรี",
    subdistrict: "ตะลุบัน",
    place: "จุดควบคุมตัวไม่เปิดเผย; สถานที่ดำเนินกระบวนการแห่งแรกที่ยืนยันได้คือ สถานีตำรวจภูธรสายบุรี เลขที่ 105 ถนนสายบุรี ตำบลตะลุบัน อำเภอสายบุรี จังหวัดปัตตานี 94110",
    geo: null,
    geo_precision: "unknown",
  },
  event: {
    type: "raid",
    title: "ทหารพรานควบคุมผู้ต้องสงสัยเชื่อมโยงวงจรวัตถุระเบิดทุ่งยางแดง",
    rawType: "ปฏิบัติการควบคุมตัวผู้ต้องสงสัยในคดีความมั่นคง",
    summary: "เมื่อวันที่ 10 เมษายน 2569 เวลา 15.49 น. ฝ่ายข่าว หน่วยเฉพาะกิจกรมทหารพรานที่ 44 ควบคุมตัวนายต่วนกิพลี (สงวนนามสกุล) หลังหน่วยงานระบุว่าพบ DNA ของบุคคลดังกล่าวบนวงจรวัตถุระเบิดจากเหตุเตรียมวางระเบิดบนถนนหมายเลข 4074 หน้าปอเนาะเราฎอตุลมูตาอัลลิมีน บ้านมะนังยง หมู่ 4 ตำบลปากู อำเภอทุ่งยางแดง เมื่อ 3 เมษายน 2569 แหล่งข่าวไม่เปิดเผยจุดควบคุมตัว เจ้าหน้าที่นำตัวไปลงบันทึกที่ สภ.สายบุรี ตรวจร่างกายที่โรงพยาบาลสมเด็จพระยุพราชสายบุรี แล้วส่งต่อศูนย์ซักถาม ฉก.ทพ.43 ภายในค่ายอิงคยุทธบริหาร อำเภอหนองจิก ทั้งนี้เป็นข้อกล่าวหาของหน่วยงานรัฐและยังต้องผ่านกระบวนการยุติธรรม",
  },
  severity: 2,
  verification: "verified",
  confidence: 96,
  casualties: { killed: 0, injured: 0 },
  actors: ["ฝ่ายข่าว หน่วยเฉพาะกิจกรมทหารพรานที่ 44"],
  targets: ["นายต่วนกิพลี (สงวนนามสกุล) ผู้ถูกควบคุมตัว"],
  corroborating_sources: [SOURCE_ID],
  media: [],
  attributes: {
    research_batch: WINDOW_ID,
    location_address: "สถานีตำรวจภูธรสายบุรี เลขที่ 105 ถนนสายบุรี ตำบลตะลุบัน อำเภอสายบุรี จังหวัดปัตตานี 94110",
    location_text_precision: "first_verified_processing_site_not_apprehension_site",
    apprehension_location_disclosed: false,
    source_count: 2,
    source_url_1: EVENT_URL,
    source_url_2: ADDRESS_URL,
    due_process_status: "ลงบันทึกประจำวัน ตรวจร่างกาย และส่งศูนย์ซักถามตามรายงานของหน่วยงานรัฐ",
    allegation_status: "ข้อกล่าวหาของหน่วยงานรัฐ; ยังต้องผ่านกระบวนการยุติธรรม",
    linked_prior_event_date: "2026-04-03",
    linked_prior_event_location: "ถนนหมายเลข 4074 หน้าปอเนาะเราฎอตุลมูตาอัลลิมีน บ้านมะนังยง หมู่ 4 ตำบลปากู อำเภอทุ่งยางแดง จังหวัดปัตตานี",
  },
  unreported: ["apprehension_coordinates", "apprehension_exact_address"],
};

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function main(): Promise<void> {
  const client = await new MongoClient(process.env.MONGODB_URI ?? DEFAULT_URI, { serverSelectionTimeoutMS: 5_000 }).connect();
  const startedAt = new Date();
  const runId = `run_verified_20260405_11_${startedAt.toISOString().replace(/\D/g, "").slice(0, 14)}_${randomUUID().slice(0, 8)}`;
  const counts = { downloaded: 1, new: 0, updated: 0, duplicate: 0, failed: 0 };
  const db = client.db(process.env.MONGODB_DB ?? "palantir_th");
  try {
    const source: SourceRegistryDoc = {
      _id: SOURCE_ID,
      name: "Palantir TH manual research ledger",
      shortName: "Manual research",
      category: "research",
      priority: "P3",
      role: "Manually corroborated event enrichment",
      connector: { type: "FORM" },
      schedule: { mode: "snapshot", frequency: "manual" },
      trust: { class: "manual_entry", score: 60 },
      enabled: true,
    };
    await db.collection<SourceRegistryDoc>("source_registry").updateOne({ _id: SOURCE_ID }, { $setOnInsert: source }, { upsert: true });
    const run: IngestionRunDoc = { _id: runId, source_id: SOURCE_ID, started_at: startedAt, finished_at: null, status: "running", records: counts };
    await db.collection<IngestionRunDoc>("ingestion_runs").insertOne(run);

    const payload = { record_type: "manual_research_claim", window_id: WINDOW_ID, candidate, sources: [EVENT_URL, ADDRESS_URL] };
    const raw: RawRecordDoc = {
      _id: candidate.raw_record_id,
      source_id: SOURCE_ID,
      external_id: `${WINDOW_ID}-${candidate._id}`,
      retrieved_at: startedAt,
      source: { url: EVENT_URL },
      dataset: { name: "Palantir TH verified event window", version: WINDOW_ID },
      raw: payload,
      integrity: { content_hash: `sha256:${hash(payload)}`, algorithm: "sha256" },
      processing: { status: "normalized" },
      ingestion_run_id: runId,
    };
    await db.collection<RawRecordDoc>("raw_records").updateOne({ _id: raw._id }, { $setOnInsert: raw }, { upsert: true });
    const result = await db.collection<EventCandidateDoc>("event_candidates").updateOne({ _id: candidate._id }, { $setOnInsert: candidate }, { upsert: true });
    result.upsertedCount ? counts.new++ : counts.duplicate++;

    await db.collection<IngestionRunDoc>("ingestion_runs").updateOne({ _id: runId }, { $set: { finished_at: new Date(), status: "success", records: counts } });
    console.log(JSON.stringify({ runId, window: WINDOW_ID, counts }, null, 2));
  } catch (error) {
    counts.failed++;
    await db.collection<IngestionRunDoc>("ingestion_runs").updateOne({ _id: runId }, { $set: { finished_at: new Date(), status: "failed", error: error instanceof Error ? error.message : String(error), records: counts } });
    throw error;
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
