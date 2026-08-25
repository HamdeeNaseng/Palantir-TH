/** Audit, enrich, and add verified southern security incidents for 7-13 Jun 2026. */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MongoClient } from "mongodb";
import type { EventCandidateDoc, IngestionRunDoc, RawRecordDoc, SourceRegistryDoc } from "../src/lib/types";

function loadEnv(): void { const path = resolve(process.cwd(), ".env"); if (!existsSync(path)) return; for (const line of readFileSync(path, "utf8").split(/\r?\n/)) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2"); } }
loadEnv();
const SOURCE_ID = "src_manual_research";
const WINDOW_ID = "verified-window-2026-06-07-to-13";
const DEFAULT_URI = "mongodb://root:changeme@localhost:27017/palantir_th?authSource=admin";
const SBPAC = "https://opendata.sbpac.go.th/API/relief_01_01.aspx";
type Update = { id: string; urls: string[]; set: Record<string, unknown> };

const updates: Update[] = [
  {
    id: "evt_5f215a69a3f73468df1b1723",
    urls: ["https://www.isranews.org/article/south-slide/147317-ramanbaro.html", "https://www.thaipbs.or.th/news/content/506849", SBPAC],
    set: {
      "time.start": new Date("2026-06-09T08:35:00+07:00"), "time.precision": "minute",
      "location.place": "หน้า/ใกล้โรงเรียนบ้านปูลัย หมู่ 6 ตำบลบาลอ อำเภอรามัน จังหวัดยะลา", "location.geo": null, "location.geo_precision": "unknown",
      "event.type": "explosion", "event.title": "ระเบิดรถตำรวจชุด รปภ.ครูหน้าโรงเรียนบ้านปูลัย", "event.rawType": "ลอบวางระเบิดเจ้าหน้าที่รักษาความปลอดภัยครู",
      "event.summary": "คนร้ายลอบวางระเบิดรถของหมวดเฉพาะกิจหน่วยปฏิบัติการพิเศษยะลา 12 ขณะรักษาความปลอดภัยโรงเรียนบ้านปูลัย แรงระเบิดทำให้รถพลิกคว่ำ ตำรวจ 2 นายและชาวบ้านที่ผ่านทาง 1 รายได้รับบาดเจ็บ รวม 3 ราย",
      severity: 5, verification: "verified", confidence: 98, casualties: { killed: 0, injured: 3 }, actors: ["คนร้ายไม่ทราบกลุ่มและจำนวน"], targets: ["ตำรวจ นปพ.ยะลา 12 ชุด รปภ.ครู", "ครู นักเรียน และผู้ใช้ทางหน้าโรงเรียนบ้านปูลัย"],
      "attributes.injured_security": 2, "attributes.injured_civilian": 1, "attributes.location_text_precision": "school_village",
    },
  },
  {
    id: "evt_fe643d90a0999b308eb158b2",
    urls: ["https://www.isranews.org/article/south-news/south-slide/147367-roadbombmayo.html", "https://workpointnews.com/news/crime/NHvxVLBrW", "https://www.amarintv.com/news/crime/548584"],
    set: {
      "time.start": new Date("2026-06-11T16:40:00+07:00"), "time.precision": "minute",
      "location.place": "ริมถนนชลประทานที่กำลังก่อสร้าง บ้านโคกกอ หมู่ 3 ตำบลลุโบะยิไร อำเภอมายอ จังหวัดปัตตานี", "location.geo": null, "location.geo_precision": "unknown",
      "event.type": "explosion", "event.title": "ระเบิดขบวนรถนายอำเภอมายอที่บ้านโคกกอ", "event.rawType": "ลอบวางระเบิดแสวงเครื่องริมถนน",
      "event.summary": "คนร้ายจุดชนวนระเบิดแสวงเครื่องหนักประมาณ 15 กิโลกรัมที่ซุกริมถนน ขณะขบวนรถ 3 คันของนายอำเภอมายอกลับจากเปิดการแข่งขันฟุตบอล รถนายอำเภอผ่านไปก่อน แรงระเบิดจึงกระทบรถหุ้มเกราะ อส.คันตาม ทำให้เจ้าหน้าที่ 6 นายมีอาการหูอื้อและรถเสียหาย",
      severity: 5, verification: "verified", confidence: 98, casualties: { killed: 0, injured: 6 }, actors: ["คนร้ายไม่ทราบกลุ่มและจำนวน"], targets: ["ขบวนรถนายอำเภอมายอ", "เจ้าหน้าที่กองอาสารักษาดินแดน"],
      "attributes.explosive_weight_kg": 15, "attributes.location_text_precision": "road_village",
    },
  },
];

const additions: EventCandidateDoc[] = [
  {
    _id: "evt_verified_20260607_takbai_as_shooting", source_id: SOURCE_ID, raw_record_id: "raw_verified_20260607_takbai_as_shooting",
    time: { start: new Date("2026-06-07T21:57:00+07:00"), precision: "minute" },
    location: { province: "นราธิวาส", provinceCode: "narathiwat", district: "ตากใบ", subdistrict: "ศาลาใหม่", place: "เพิงพักต่อเติมหลังบ้านของนายมูหาหมัดอาซูวี มานา ตำบลศาลาใหม่ อำเภอตากใบ จังหวัดนราธิวาส", geo: null, geo_precision: "unknown" },
    event: { type: "shooting", title: "ซุ่มยิง อส.หน้าบ้านในตำบลศาลาใหม่แต่พลาดเป้า", rawType: "ลอบยิงสมาชิกกองอาสารักษาดินแดน", summary: "คนร้ายซุ่มในสวนปาล์มห่างบ้านประมาณ 100 เมตร ยิง 1 นัดใส่นายมูหาหมัดอาซูวี มานา สมาชิก อส.ชุดคุ้มครองตำบลไพรวัน ขณะนั่งกับทหารพราน ชาวบ้าน และบุตรรวม 7 คน กระสุนเจาะผนังอิฐบล็อก แต่ทุกคนหลบได้และไม่มีผู้บาดเจ็บ" },
    severity: 4, verification: "verified", confidence: 94, casualties: { killed: 0, injured: 0 }, actors: ["มือปืนไม่ทราบกลุ่มและจำนวน"], targets: ["นายมูหาหมัดอาซูวี มานา สมาชิก อส.ชคต.ไพรวัน", "ผู้ที่อยู่ในเพิงพักรวม 7 คน"], corroborating_sources: [SOURCE_ID], media: [],
    attributes: { research_batch: WINDOW_ID, location_address: "เพิงพักต่อเติมหลังบ้านของนายมูหาหมัดอาซูวี มานา ตำบลศาลาใหม่ อำเภอตากใบ จังหวัดนราธิวาส", location_text_precision: "residence_subdistrict", source_count: 1, source_url_1: "https://www.isranews.org/article/south-slide/147317-ramanbaro.html", firing_distance_m: 100 },
    unreported: ["coordinates", "weapon", "perpetrator_identity"],
  },
  {
    _id: "evt_verified_20260609_pattani_green_bombing", source_id: SOURCE_ID, raw_record_id: "raw_verified_20260609_pattani_green_bombing",
    time: { start: new Date("2026-06-09T00:05:00+07:00"), precision: "minute" },
    location: { province: "ปัตตานี", provinceCode: "pattani", district: "หนองจิก", subdistrict: "ลิปะสะโง", place: "โรงไฟฟ้าชีวมวล บริษัท ปัตตานีกรีน จำกัด หมู่ 1 ตำบลลิปะสะโง อำเภอหนองจิก จังหวัดปัตตานี", geo: null, geo_precision: "unknown" },
    event: { type: "explosion", title: "กลุ่มติดอาวุธวางระเบิด 3 จุดในโรงไฟฟ้าชีวมวลปัตตานีกรีน", rawType: "บุกข่มขู่และวางระเบิดสถานประกอบการ", summary: "ชายสวมหมวกคลุมหน้าและมีอาวุธปืน 3 คนลอบเข้าทางสวนยางข้างโรงไฟฟ้า ข่มขู่และรวมพนักงานกับ รปภ.ไว้หน้าประตู ก่อนติดตั้งระเบิดแสวงเครื่อง 3 จุดและจุดระเบิด ทำให้อุปกรณ์ไฟฟ้าและอาคารเสียหาย ไม่มีผู้เสียชีวิตหรือบาดเจ็บ" },
    severity: 5, verification: "verified", confidence: 97, casualties: { killed: 0, injured: 0 }, actors: ["ชายสวมหมวกคลุมหน้าติดอาวุธ 3 คน"], targets: ["โรงไฟฟ้าชีวมวลปัตตานีกรีน", "พนักงานและ รปภ.โรงไฟฟ้า", "โครงสร้างพื้นฐานด้านพลังงาน"], corroborating_sources: [SOURCE_ID], media: [],
    attributes: { research_batch: WINDOW_ID, location_address: "โรงไฟฟ้าชีวมวล บริษัท ปัตตานีกรีน จำกัด หมู่ 1 ตำบลลิปะสะโง อำเภอหนองจิก จังหวัดปัตตานี", location_text_precision: "named_site", source_count: 3, source_url_1: "https://www.thaipbs.or.th/news/content/506843", source_url_2: "https://www.isranews.org/article/south-slide/147317-ramanbaro.html", source_url_3: "https://spacebar.th/social/situation-in-the-south-attackers-plant-bombs-in-pattani-and-yala", explosive_device_count: 3 },
    unreported: ["coordinates", "explosive_device_detail", "perpetrator_identity", "damage_value"],
  },
];

function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
async function main(): Promise<void> {
  const client = await new MongoClient(process.env.MONGODB_URI ?? DEFAULT_URI, { serverSelectionTimeoutMS: 5_000 }).connect(); const startedAt = new Date(); const runId = `run_verified_20260607_13_${startedAt.toISOString().replace(/\D/g, "").slice(0, 14)}_${randomUUID().slice(0, 8)}`; const counts = { downloaded: 4, new: 0, updated: 0, duplicate: 0, failed: 0 }; const db = client.db(process.env.MONGODB_DB ?? "palantir_th");
  try {
    const source: SourceRegistryDoc = { _id: SOURCE_ID, name: "Palantir TH manual research ledger", shortName: "Manual research", category: "research", priority: "P3", role: "Manually corroborated event enrichment", connector: { type: "FORM" }, schedule: { mode: "snapshot", frequency: "manual" }, trust: { class: "manual_entry", score: 60 }, enabled: true };
    await db.collection<SourceRegistryDoc>("source_registry").updateOne({ _id: SOURCE_ID }, { $setOnInsert: source }, { upsert: true }); const run: IngestionRunDoc = { _id: runId, source_id: SOURCE_ID, started_at: startedAt, finished_at: null, status: "running", records: counts }; await db.collection<IngestionRunDoc>("ingestion_runs").insertOne(run);
    for (const item of updates) { const payload = { record_type: "manual_research_enrichment", window_id: WINDOW_ID, candidate_id: item.id, sources: item.urls, normalized_update: item.set }; const rawId = `raw_manual_enrichment_${WINDOW_ID}_${item.id}`; const raw: RawRecordDoc = { _id: rawId, source_id: SOURCE_ID, external_id: `${WINDOW_ID}-enrichment-${item.id}`, retrieved_at: startedAt, source: { url: item.urls[0] }, dataset: { name: "Palantir TH verified event window", version: WINDOW_ID }, raw: payload, integrity: { content_hash: `sha256:${hash(payload)}`, algorithm: "sha256" }, processing: { status: "normalized" }, ingestion_run_id: runId }; await db.collection<RawRecordDoc>("raw_records").updateOne({ _id: rawId }, { $setOnInsert: raw }, { upsert: true }); const sourceAttrs = Object.fromEntries(item.urls.map((url, i) => [`attributes.source_url_${i + 1}`, url])); const set = { ...item.set, ...sourceAttrs, "attributes.research_batch": WINDOW_ID, "attributes.enrichment_raw_record_id": rawId, "attributes.location_address": item.set["location.place"], "attributes.source_count": item.urls.length }; const result = await db.collection<EventCandidateDoc>("event_candidates").updateOne({ _id: item.id }, { $set: set as never, $addToSet: { corroborating_sources: SOURCE_ID }, $pull: { unreported: { $in: ["severity", "casualties", "casualties.killed", "casualties.injured", "actors", "targets", "exact_time"] } } }); if (!result.matchedCount) throw new Error(`Existing candidate ${item.id} was not found`); result.modifiedCount ? counts.updated++ : counts.duplicate++; }
    for (const candidate of additions) { const urls = Object.entries(candidate.attributes).filter(([key]) => key.startsWith("source_url_")).map(([, value]) => String(value)); const payload = { record_type: "manual_research_claim", window_id: WINDOW_ID, candidate, sources: urls }; const raw: RawRecordDoc = { _id: candidate.raw_record_id, source_id: SOURCE_ID, external_id: `${WINDOW_ID}-${candidate._id}`, retrieved_at: startedAt, source: { url: urls[0] }, dataset: { name: "Palantir TH verified event window", version: WINDOW_ID }, raw: payload, integrity: { content_hash: `sha256:${hash(payload)}`, algorithm: "sha256" }, processing: { status: "normalized" }, ingestion_run_id: runId }; await db.collection<RawRecordDoc>("raw_records").updateOne({ _id: raw._id }, { $setOnInsert: raw }, { upsert: true }); const result = await db.collection<EventCandidateDoc>("event_candidates").updateOne({ _id: candidate._id }, { $setOnInsert: candidate }, { upsert: true }); result.upsertedCount ? counts.new++ : counts.duplicate++; }
    await db.collection<IngestionRunDoc>("ingestion_runs").updateOne({ _id: runId }, { $set: { finished_at: new Date(), status: "success", records: counts } }); console.log(JSON.stringify({ runId, window: WINDOW_ID, counts }, null, 2));
  } catch (error) { await db.collection<IngestionRunDoc>("ingestion_runs").updateOne({ _id: runId }, { $set: { finished_at: new Date(), status: "failed", error: error instanceof Error ? error.message : String(error), records: { ...counts, failed: 1 } } }); throw error; } finally { await client.close(); }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
