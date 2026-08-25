/** Audit, enrich, and add southern security incidents for 26 Apr-2 May 2026. */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MongoClient } from "mongodb";
import type { EventCandidateDoc, IngestionRunDoc, RawRecordDoc, SourceRegistryDoc } from "../src/lib/types";

function loadEnv(): void { const path = resolve(process.cwd(), ".env"); if (!existsSync(path)) return; for (const line of readFileSync(path, "utf8").split(/\r?\n/)) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2"); } }
loadEnv();
const SOURCE_ID = "src_manual_research";
const WINDOW_ID = "verified-window-2026-04-26-to-05-02";
const DEFAULT_URI = "mongodb://root:changeme@localhost:27017/palantir_th?authSource=admin";
type Update = { id: string; urls: string[]; set: Record<string, unknown>; reported: string[] };

const updates: Update[] = [
  {
    id: "evt_427f9c8c298fb10f0f894a7a",
    urls: ["https://opendata.sbpac.go.th/API/relief_01_01.aspx", "https://relief.sbpac.go.th/accimg/273951.jpg", "https://relief.sbpac.go.th/accimg/273952.jpg", "https://relief.sbpac.go.th/accimg/273953.jpg"],
    set: {
      "location.place": "ถนนไม่ทราบชื่อในตำบลบ้านแหร อำเภอธารโต จังหวัดยะลา", "location.geo": null, "location.geo_precision": "unknown",
      "event.type": "other", "event.title": "ชายได้รับบาดเจ็บในพื้นที่ตำบลบ้านแหร—สาเหตุยังยืนยันไม่ได้", "event.rawType": "เหตุที่คณะกรรมการ 3 ฝ่ายไม่รับรอง",
      "event.summary": "ชุดข้อมูล ศอ.บต. บันทึกเหตุวันที่ 28 เมษายน 2569 ใน ต.บ้านแหร อ.ธารโต แต่ไม่ระบุรายละเอียดและคณะกรรมการ 3 ฝ่ายไม่รับรอง ภาพต้นฉบับแสดงชายผู้ใหญ่มีบาดแผลบริเวณลำตัวเข้ารับการรักษาในโรงพยาบาล และมีภาพเจ้าหน้าที่กับบุคคลชี้จุดบนถนนชนบท แต่ไม่มีหลักฐานข้อความเพียงพอให้ยืนยันว่าเกิดจากการยิง อุบัติเหตุ หรือเหตุอื่น จึงคงสถานะตรวจสอบไม่ได้และไม่ระบุตัวผู้ก่อเหตุ",
      severity: 3, verification: "unverifiable", confidence: 55, casualties: { killed: 0, injured: 1 }, actors: ["ไม่ทราบ—ไม่มีข้อมูลเพียงพอ"], targets: ["ชายผู้ใหญ่ไม่ทราบชื่อซึ่งปรากฏในภาพของชุดข้อมูล ศอ.บต."],
      "attributes.location_text_precision": "road_subdistrict", "attributes.evidence_limit": "มีเพียงระเบียนสั้นและภาพ 3 ภาพ ไม่มีคำบรรยายเหตุหรือแหล่งข่าวอิสระ", "attributes.mechanism_of_injury": "unknown", "attributes.visual_observation_only": true,
    },
    reported: ["severity", "casualties", "casualties.killed", "casualties.injured", "actors", "targets"],
  },
  {
    id: "evt_24f6f3f1cf16e869c19e4b0f",
    urls: ["https://www.southpeace.go.th/?p=169203", "https://www.thaipbs.or.th/news/content/505296", "https://www.isranews.org/article/south-slide/146679-bppthanto-2.html", "https://opendata.sbpac.go.th/API/relief_01_01.aspx"],
    set: {
      "time.start": new Date("2026-04-29T17:05:00+07:00"), "time.precision": "minute", "location.place": "พื้นที่ปฏิบัติหน้าที่ บ้านจาเราะแป หมู่ 3 ตำบลธารโต อำเภอธารโต จังหวัดยะลา", "location.geo": null, "location.geo_precision": "unknown",
      "event.type": "shooting", "event.title": "ซุ่มยิงตำรวจตระเวนชายแดนที่บ้านจาเราะแปบาดเจ็บสาหัส", "event.rawType": "ลอบยิงเจ้าหน้าที่ตำรวจตระเวนชายแดนขณะปฏิบัติหน้าที่",
      "event.summary": "คนร้ายไม่ทราบกลุ่มและจำนวนใช้อาวุธปืนไม่ทราบชนิดซุ่มยิงชุดปฏิบัติการหมวดเฉพาะกิจ ตชด.4413 ขณะปฏิบัติหน้าที่ ส.ต.ท.ธีระพัฒน์ แก่นทอง อายุ 30 ปี ถูกยิงช่องท้องล่าง กระสุนทะลุออกสะโพกด้านหลัง 1 นัด อาการสาหัส ส่งจากโรงพยาบาลธารโตไปรักษาต่อที่โรงพยาบาลศูนย์ยะลา",
      severity: 4, verification: "verified", confidence: 99, casualties: { killed: 0, injured: 1 }, actors: ["มือปืนไม่ทราบกลุ่มและจำนวน"], targets: ["ส.ต.ท.ธีระพัฒน์ แก่นทอง ชุดปฏิบัติการ มว.ฉก.ตชด.4413"],
      "attributes.injured_security": 1, "attributes.location_text_precision": "operational_area_village",
    },
    reported: ["severity", "casualties", "casualties.killed", "casualties.injured", "actors", "targets", "exact_time"],
  },
];

const additions: EventCandidateDoc[] = [
  {
    _id: "evt_verified_20260426_saiburi_koto_checkpoint_shooting", source_id: SOURCE_ID, raw_record_id: "raw_verified_20260426_saiburi_koto_checkpoint_shooting",
    time: { start: new Date("2026-04-26T19:30:00+07:00"), precision: "minute" },
    location: { province: "ปัตตานี", provinceCode: "pattani", district: "สายบุรี", subdistrict: "ละหาร", place: "จุดตรวจร่วม 3 ฝ่าย บริเวณสะพานกอตอ หมู่ 5 ตำบลละหาร อำเภอสายบุรี จังหวัดปัตตานี", geo: null, geo_precision: "unknown" },
    event: { type: "shooting", title: "ยิงก่อกวนจุดตรวจร่วมสามฝ่ายสะพานกอตอ", rawType: "ยิงโจมตีจุดตรวจและเจ้าหน้าที่ตอบโต้", summary: "คนร้ายไม่ทราบจำนวนใช้อาวุธปืนยิงก่อกวนจุดตรวจร่วม 3 ฝ่ายบริเวณสะพานกอตอ เจ้าหน้าที่ประจำจุดตรวจยิงตอบโต้ ทำให้กลุ่มคนร้ายล่าถอยและหลบหนี ไม่พบรายงานผู้เสียชีวิตหรือบาดเจ็บจากทั้งสองฝ่าย" },
    severity: 4, verification: "verified", confidence: 90, casualties: { killed: 0, injured: 0 }, actors: ["กลุ่มคนร้ายติดอาวุธไม่ทราบจำนวน", "เจ้าหน้าที่ประจำจุดตรวจร่วม 3 ฝ่าย"], targets: ["จุดตรวจร่วม 3 ฝ่ายบริเวณสะพานกอตอ", "เจ้าหน้าที่ประจำจุดตรวจ"], corroborating_sources: [SOURCE_ID], media: [],
    attributes: { research_batch: WINDOW_ID, location_address: "จุดตรวจร่วม 3 ฝ่าย บริเวณสะพานกอตอ หมู่ 5 ตำบลละหาร อำเภอสายบุรี จังหวัดปัตตานี", location_text_precision: "checkpoint_village", source_count: 1, source_url_1: "https://www.board.hatyaifocus.com/news-detail/30802/", outcome: "attackers_withdrew_after_return_fire" },
    unreported: ["coordinates", "weapon_type", "perpetrator_identity"],
  },
  {
    _id: "evt_verified_20260428_khokpho_railway_fake_bomb", source_id: SOURCE_ID, raw_record_id: "raw_verified_20260428_khokpho_railway_fake_bomb",
    time: { start: new Date("2026-04-28T07:15:00+07:00"), precision: "minute" },
    location: { province: "ปัตตานี", provinceCode: "pattani", district: "โคกโพธิ์", subdistrict: "ท่าเรือ", place: "รางรถไฟหลักเสาโทรเลข สทล.1007/2-3 ระหว่างสถานีปัตตานี–สถานีตาแปด หมู่ 8 ตำบลท่าเรือ อำเภอโคกโพธิ์ จังหวัดปัตตานี", geo: null, geo_precision: "unknown" },
    event: { type: "unrest", title: "วางถังแก๊สลวงคล้ายระเบิดบนรางรถไฟปัตตานี–ตาแปด", rawType: "วางวัตถุต้องสงสัยก่อกวนการเดินรถไฟ", summary: "ผู้ไม่ทราบฝ่ายนำถังแก๊สสีส้มขนาด 5 กิโลกรัมพันเทปดำและผูกไม้แขวนเสื้อให้ดูคล้ายมีวงจรระเบิดไปวางบนรางรถไฟ ทำให้ต้องปิดการเดินรถตั้งแต่ 07.30 น. และขบวนท้องถิ่นที่ 456 ยะลา–นครศรีธรรมราชหยุดรอที่สถานีตาแปด EOD ตรวจเวลา 11.30 น. พบเป็นถังเปล่า ไม่มีวัตถุระเบิดหรือวงจรจุดระเบิด ตรวจเส้นทางเพิ่ม 300 เมตรแล้วจึงเปิดเดินรถ ไม่มีผู้บาดเจ็บ" },
    severity: 3, verification: "verified", confidence: 98, casualties: { killed: 0, injured: 0 }, actors: ["ผู้วางวัตถุต้องสงสัยไม่ทราบฝ่ายและจำนวน"], targets: ["เส้นทางรถไฟปัตตานี–ตาแปด", "ขบวนรถท้องถิ่นที่ 456 และผู้โดยสาร"], corroborating_sources: [SOURCE_ID], media: [],
    attributes: { research_batch: WINDOW_ID, location_address: "รางรถไฟหลักเสาโทรเลข สทล.1007/2-3 ระหว่างสถานีปัตตานี–สถานีตาแปด หมู่ 8 ตำบลท่าเรือ อำเภอโคกโพธิ์ จังหวัดปัตตานี", location_text_precision: "railway_marker_village", source_count: 1, source_url_1: "https://www.isranews.org/article/south-slide/146679-bppthanto-2.html", device: "ถังแก๊สเปล่าขนาด 5 กิโลกรัมพันเทปดำและผูกไม้แขวนเสื้อ", explosive_confirmed: false, railway_inspection_distance_m: 300, service_disruption: true },
    unreported: ["coordinates", "perpetrator_identity", "service_resumption_time"],
  },
];

function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
async function main(): Promise<void> {
  const client = await new MongoClient(process.env.MONGODB_URI ?? DEFAULT_URI, { serverSelectionTimeoutMS: 5_000 }).connect(); const startedAt = new Date(); const runId = `run_verified_20260426_0502_${startedAt.toISOString().replace(/\D/g, "").slice(0, 14)}_${randomUUID().slice(0, 8)}`; const counts = { downloaded: 4, new: 0, updated: 0, duplicate: 0, failed: 0 }; const db = client.db(process.env.MONGODB_DB ?? "palantir_th");
  try {
    const source: SourceRegistryDoc = { _id: SOURCE_ID, name: "Palantir TH manual research ledger", shortName: "Manual research", category: "research", priority: "P3", role: "Manually corroborated event enrichment", connector: { type: "FORM" }, schedule: { mode: "snapshot", frequency: "manual" }, trust: { class: "manual_entry", score: 60 }, enabled: true };
    await db.collection<SourceRegistryDoc>("source_registry").updateOne({ _id: SOURCE_ID }, { $setOnInsert: source }, { upsert: true }); const run: IngestionRunDoc = { _id: runId, source_id: SOURCE_ID, started_at: startedAt, finished_at: null, status: "running", records: counts }; await db.collection<IngestionRunDoc>("ingestion_runs").insertOne(run);
    for (const item of updates) { const payload = { record_type: "manual_research_enrichment", window_id: WINDOW_ID, candidate_id: item.id, sources: item.urls, normalized_update: item.set }; const rawId = `raw_manual_enrichment_${WINDOW_ID}_${item.id}`; const raw: RawRecordDoc = { _id: rawId, source_id: SOURCE_ID, external_id: `${WINDOW_ID}-enrichment-${item.id}`, retrieved_at: startedAt, source: { url: item.urls[0] }, dataset: { name: "Palantir TH verified event window", version: WINDOW_ID }, raw: payload, integrity: { content_hash: `sha256:${hash(payload)}`, algorithm: "sha256" }, processing: { status: "normalized" }, ingestion_run_id: runId }; await db.collection<RawRecordDoc>("raw_records").updateOne({ _id: rawId }, { $setOnInsert: raw }, { upsert: true }); const sourceAttrs = Object.fromEntries(item.urls.map((url, i) => [`attributes.source_url_${i + 1}`, url])); const set = { ...item.set, ...sourceAttrs, "attributes.research_batch": WINDOW_ID, "attributes.enrichment_raw_record_id": rawId, "attributes.location_address": item.set["location.place"], "attributes.source_count": item.urls.length }; const result = await db.collection<EventCandidateDoc>("event_candidates").updateOne({ _id: item.id }, { $set: set as never, $addToSet: { corroborating_sources: SOURCE_ID }, $pull: { unreported: { $in: item.reported } } }); if (!result.matchedCount) throw new Error(`Existing candidate ${item.id} was not found`); result.modifiedCount ? counts.updated++ : counts.duplicate++; }
    for (const candidate of additions) { const urls = Object.entries(candidate.attributes).filter(([key]) => key.startsWith("source_url_")).map(([, value]) => String(value)); const payload = { record_type: "manual_research_claim", window_id: WINDOW_ID, candidate, sources: urls }; const raw: RawRecordDoc = { _id: candidate.raw_record_id, source_id: SOURCE_ID, external_id: `${WINDOW_ID}-${candidate._id}`, retrieved_at: startedAt, source: { url: urls[0] }, dataset: { name: "Palantir TH verified event window", version: WINDOW_ID }, raw: payload, integrity: { content_hash: `sha256:${hash(payload)}`, algorithm: "sha256" }, processing: { status: "normalized" }, ingestion_run_id: runId }; await db.collection<RawRecordDoc>("raw_records").updateOne({ _id: raw._id }, { $setOnInsert: raw }, { upsert: true }); const result = await db.collection<EventCandidateDoc>("event_candidates").updateOne({ _id: candidate._id }, { $setOnInsert: candidate }, { upsert: true }); result.upsertedCount ? counts.new++ : counts.duplicate++; }
    await db.collection<IngestionRunDoc>("ingestion_runs").updateOne({ _id: runId }, { $set: { finished_at: new Date(), status: "success", records: counts } }); console.log(JSON.stringify({ runId, window: WINDOW_ID, counts }, null, 2));
  } catch (error) { await db.collection<IngestionRunDoc>("ingestion_runs").updateOne({ _id: runId }, { $set: { finished_at: new Date(), status: "failed", error: error instanceof Error ? error.message : String(error), records: { ...counts, failed: 1 } } }); throw error; } finally { await client.close(); }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
