/** Audit, enrich, and add verified southern security incidents for 17-23 May 2026. */
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
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}
loadEnv();

const SOURCE_ID = "src_manual_research";
const WINDOW_ID = "verified-window-2026-05-17-to-23";
const DEFAULT_URI = "mongodb://root:changeme@localhost:27017/palantir_th?authSource=admin";
const SBPAC = "https://opendata.sbpac.go.th/API/relief_01_01.aspx";
type Update = { id: string; urls: string[]; set: Record<string, unknown>; reported: string[] };

const updates: Update[] = [
  {
    id: "evt_9a7b0e6e2ef41a23c4783642",
    urls: ["https://www.isranews.org/article/south-news/other-news/147050-shootsergeantsawoo.html", "https://www.thaipost.net/news-update/1003824/", "https://www.isranews.org/article/south-news/south-slide/147105-officershoot.html", SBPAC],
    set: {
      "location.place": "หน้าบ้านเลขที่ 24/5 หมู่ 6 ตำบลสาวอ อำเภอรือเสาะ จังหวัดนราธิวาส", "location.geo": null, "location.geo_precision": "unknown",
      "event.type": "shooting", "event.title": "ลอบยิงทหารหน้าบ้านภรรยาที่ตำบลสาวอ เด็กหญิงถูกลูกหลง", "event.rawType": "ลอบยิงเจ้าหน้าที่ทหารและกระสุนถูกพลเรือน",
      "event.summary": "คนร้ายใช้อาวุธปืนลอบยิง ส.อ.มูฮัมหมัดอำมูดี แวสอเฮาะ กำลังพลกองร้อยอาวุธเบา กองพันทหารราบที่ 3 กรมทหารราบที่ 152 บริเวณหน้าบ้านภรรยา ทำให้ทหารได้รับบาดเจ็บ และ ด.ญ.นูรฟิรดาวส์ ตาเละ อายุ 9 ปี ซึ่งเป็นหลานของภรรยา ถูกกระสุนลูกหลงได้รับบาดเจ็บ ทั้งคู่ส่งรักษาที่โรงพยาบาลนราธิวาสราชนครินทร์",
      severity: 4, verification: "verified", confidence: 97, casualties: { killed: 0, injured: 2 }, actors: ["มือปืนไม่ทราบกลุ่มและจำนวน"], targets: ["ส.อ.มูฮัมหมัดอำมูดี แวสอเฮาะ ทหาร ร้อย อวบ.ร.152 พัน.3", "ด.ญ.นูรฟิรดาวส์ ตาเละ อายุ 9 ปี"],
      "attributes.injured_security": 1, "attributes.injured_civilian": 1, "attributes.location_text_precision": "house_number",
    },
    reported: ["severity", "casualties", "casualties.killed", "casualties.injured", "actors", "targets"],
  },
  {
    id: "evt_35e0d7b58c5070d78eb46f53",
    urls: ["https://saiburi.pattani.police.go.th/elementor-6050/", "https://www.isranews.org/article/south-news/other-news/147076-saiburipol-2.html", "https://www.isranews.org/article/south-news/south-slide/147191-shellshootpol.html", "https://www.amarintv.com/news/crime/546730", SBPAC],
    set: {
      "time.start": new Date("2026-05-22T18:20:00+07:00"), "time.precision": "minute", "location.place": "อาคารสถานีตำรวจภูธรสายบุรีแห่งใหม่ที่กำลังก่อสร้าง หมู่ 1 ตำบลตะบิ้ง อำเภอสายบุรี จังหวัดปัตตานี", "location.geo": null, "location.geo_precision": "unknown",
      "event.type": "shooting", "event.title": "ซุ่มยิงตำรวจเฝ้า สภ.สายบุรีแห่งใหม่เสียชีวิต", "event.rawType": "ใช้อาวุธสงครามซุ่มโจมตีเจ้าหน้าที่ตำรวจ",
      "event.summary": "กลุ่มคนร้ายซุ่มใช้อาวุธสงครามยิงใส่ตำรวจซึ่งกำลังเฝ้ารักษาอาคาร สภ.สายบุรีแห่งใหม่และออกกำลังกายอยู่ภายใน ส.ต.อ.นัฐวุฒิ สุราษฎร์ ผบ.หมู่ นปพ. สภ.หนองจิก ซึ่งช่วยราชการ สภ.สายบุรี ถูกยิงบริเวณใบหน้า คาง คอ และไหล่ ก่อนเสียชีวิตที่โรงพยาบาลสมเด็จพระยุพราชสายบุรี ภายหลังตรวจพบปลอกกระสุน 66 ปลอกจาก AK-47, AK-102, HK33 และ M16 รวม 4 กระบอก ซึ่งผลตรวจเชื่อมโยงกับคดีเดิม 59 คดี",
      severity: 5, verification: "verified", confidence: 99, casualties: { killed: 1, injured: 0 }, actors: ["กลุ่มคนร้ายติดอาวุธสงครามไม่ทราบจำนวน"], targets: ["ตำรวจผู้ปฏิบัติหน้าที่เฝ้าอาคาร สภ.สายบุรีแห่งใหม่", "ส.ต.อ.นัฐวุฒิ สุราษฎร์"],
      "attributes.weapon": "AK-47, AK-102, HK33 และ M16", "attributes.casing_count": 66, "attributes.forensic_links_prior_cases": 59, "attributes.location_text_precision": "named_site_village",
    },
    reported: ["severity", "casualties", "casualties.killed", "casualties.injured", "actors", "targets", "exact_time"],
  },
  {
    id: "evt_446bad4900e0007b268e74e7",
    urls: ["https://www.thaipbs.or.th/news/content/506261", "https://www.isranews.org/article/south-news/south-slide/147105-officershoot.html", SBPAC],
    set: {
      "time.start": new Date("2026-05-22T21:00:00+07:00"), "time.precision": "minute", "location.place": "ถนนในหมู่บ้าน หมู่ 1 ตำบลจะกว๊ะ อำเภอรามัน จังหวัดยะลา บริเวณรอยต่อบ้านตะยา ตำบลสุวารี อำเภอรือเสาะ จังหวัดนราธิวาส", "location.geo": null, "location.geo_precision": "unknown",
      "event.type": "shooting", "event.title": "ยิงอดีตทหารพรานบนถนนรอยต่อยะลา–นราธิวาสเสียชีวิต", "event.rawType": "ประกบยิงอดีตทหารพรานและชิงอาวุธ",
      "event.summary": "คนร้ายลอบยิงนายอิสมาแอ (มะแอ) มะสีละ อายุ 50 ปี อดีตทหารพรานกรมทหารพรานที่ 47 ขณะเดินทางด้วยรถยนต์บนถนนในหมู่บ้านพื้นที่รอยต่อ ต.จะกว๊ะ จ.ยะลา กับบ้านตะยา ต.สุวารี จ.นราธิวาส ทำให้เสียชีวิตในรถ และคนร้ายชิงปืนพกขนาด 9 มม. ของผู้ตายหลบหนีไป",
      severity: 5, verification: "verified", confidence: 96, casualties: { killed: 1, injured: 0 }, actors: ["มือปืนไม่ทราบกลุ่มและจำนวน"], targets: ["นายอิสมาแอ (มะแอ) มะสีละ อดีตทหารพรานกรมทหารพรานที่ 47"],
      "attributes.weapon_stolen": "ปืนพกขนาด 9 มม. ของผู้เสียชีวิต", "attributes.name_discrepancy": "Thai PBS ระบุ อิสมาแอ มะสีละ; Isranews ระบุ มะแอ มะสีละ", "attributes.location_text_precision": "road_village_boundary",
    },
    reported: ["severity", "casualties", "casualties.killed", "casualties.injured", "actors", "targets", "exact_time"],
  },
];

const operation: EventCandidateDoc = {
  _id: "evt_verified_20260521_yala_old_market_surrender", source_id: SOURCE_ID, raw_record_id: "raw_verified_20260521_yala_old_market_surrender",
  time: { start: new Date("2026-05-21T20:00:00+07:00"), precision: "hour" },
  location: { province: "ยะลา", provinceCode: "yala", district: "เมืองยะลา", subdistrict: "สะเตง", place: "ชุมชนตลาดเก่า บริเวณหลังโรงเรียนเทศบาล 5 ตำบลสะเตง อำเภอเมืองยะลา จังหวัดยะลา", geo: null, geo_precision: "unknown" },
  event: { type: "raid", title: "ปิดล้อมตลาดเก่าและเจรจาผู้ต้องหาคดีความมั่นคงมอบตัว", rawType: "ปฏิบัติการบังคับใช้กฎหมายและจับกุมผู้ต้องหาคดีความมั่นคง", summary: "ช่วงค่ำ เจ้าหน้าที่ฝ่ายความมั่นคงปิดล้อมพื้นที่ชุมชนตลาดเก่าหลังโรงเรียนเทศบาล 5 หลังได้รับแจ้งว่ามีบุคคลต้องสงสัยเข้ามาเคลื่อนไหว เจ้าหน้าที่ประสานผู้นำท้องที่และผู้นำท้องถิ่นเจรจาโดยเน้นสันติวิธี จนนายอิสมาแอ มูซอ อายุ 35 ปี ชาว ต.ท่าสาป ยอมมอบตัวโดยสมัครใจ ไม่มีการปะทะหรือผู้บาดเจ็บ ผู้ถูกจับมีหมายจับ ป.วิ.อาญา 3 หมาย รวมคดีระเบิดตลาดพิมลชัยปี 2561 และคดีปล้นรถเคอรี่ไปทำคาร์บอมบ์ สภ.รามันปี 2564" },
  severity: 3, verification: "verified", confidence: 96, casualties: { killed: 0, injured: 0 }, actors: ["เจ้าหน้าที่ฝ่ายความมั่นคงร่วมกับผู้นำท้องที่และผู้นำท้องถิ่น"], targets: ["นายอิสมาแอ มูซอ ผู้ต้องหาตามหมายจับคดีความมั่นคง 3 หมาย"], corroborating_sources: [SOURCE_ID], media: [],
  attributes: { research_batch: WINDOW_ID, location_address: "ชุมชนตลาดเก่า บริเวณหลังโรงเรียนเทศบาล 5 ตำบลสะเตง อำเภอเมืองยะลา จังหวัดยะลา", location_text_precision: "named_neighborhood_landmark", source_count: 3, source_url_1: "https://www.isranews.org/article/south-news/other-news/147060-ismaaeyala.html", source_url_2: "https://www.khaosod.co.th/breaking-news/news_10253807", source_url_3: "https://www.southpeace.go.th/?cat=24&filter_by=random_posts&paged=40", arrest_count: 1, warrant_count: 3, outcome: "voluntary_surrender_without_casualties", approximate_time: true },
  unreported: ["coordinates", "exact_minute"],
};

function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

async function main(): Promise<void> {
  const client = await new MongoClient(process.env.MONGODB_URI ?? DEFAULT_URI, { serverSelectionTimeoutMS: 5_000 }).connect();
  const startedAt = new Date(); const runId = `run_verified_20260517_23_${startedAt.toISOString().replace(/\D/g, "").slice(0, 14)}_${randomUUID().slice(0, 8)}`;
  const counts = { downloaded: updates.length + 1, new: 0, updated: 0, duplicate: 0, failed: 0 }; const db = client.db(process.env.MONGODB_DB ?? "palantir_th");
  try {
    const source: SourceRegistryDoc = { _id: SOURCE_ID, name: "Palantir TH manual research ledger", shortName: "Manual research", category: "research", priority: "P3", role: "Manually corroborated event enrichment", connector: { type: "FORM" }, schedule: { mode: "snapshot", frequency: "manual" }, trust: { class: "manual_entry", score: 60 }, enabled: true };
    await db.collection<SourceRegistryDoc>("source_registry").updateOne({ _id: SOURCE_ID }, { $setOnInsert: source }, { upsert: true });
    const run: IngestionRunDoc = { _id: runId, source_id: SOURCE_ID, started_at: startedAt, finished_at: null, status: "running", records: counts }; await db.collection<IngestionRunDoc>("ingestion_runs").insertOne(run);
    for (const item of updates) {
      const payload = { record_type: "manual_research_enrichment", window_id: WINDOW_ID, candidate_id: item.id, sources: item.urls, normalized_update: item.set };
      const rawId = `raw_manual_enrichment_${WINDOW_ID}_${item.id}`; const raw: RawRecordDoc = { _id: rawId, source_id: SOURCE_ID, external_id: `${WINDOW_ID}-enrichment-${item.id}`, retrieved_at: startedAt, source: { url: item.urls[0] }, dataset: { name: "Palantir TH verified event window", version: WINDOW_ID }, raw: payload, integrity: { content_hash: `sha256:${hash(payload)}`, algorithm: "sha256" }, processing: { status: "normalized" }, ingestion_run_id: runId };
      await db.collection<RawRecordDoc>("raw_records").updateOne({ _id: rawId }, { $setOnInsert: raw }, { upsert: true });
      const sourceAttrs = Object.fromEntries(item.urls.map((url, index) => [`attributes.source_url_${index + 1}`, url]));
      const set = { ...item.set, ...sourceAttrs, "attributes.research_batch": WINDOW_ID, "attributes.enrichment_raw_record_id": rawId, "attributes.location_address": item.set["location.place"], "attributes.source_count": item.urls.length };
      const result = await db.collection<EventCandidateDoc>("event_candidates").updateOne({ _id: item.id }, { $set: set as never, $addToSet: { corroborating_sources: SOURCE_ID }, $pull: { unreported: { $in: item.reported } } });
      if (!result.matchedCount) throw new Error(`Existing candidate ${item.id} was not found`); result.modifiedCount ? counts.updated++ : counts.duplicate++;
    }
    const urls = Object.entries(operation.attributes).filter(([key]) => key.startsWith("source_url_")).map(([, value]) => String(value));
    const payload = { record_type: "manual_research_claim", window_id: WINDOW_ID, candidate: operation, sources: urls };
    const raw: RawRecordDoc = { _id: operation.raw_record_id, source_id: SOURCE_ID, external_id: `${WINDOW_ID}-${operation._id}`, retrieved_at: startedAt, source: { url: urls[0] }, dataset: { name: "Palantir TH verified event window", version: WINDOW_ID }, raw: payload, integrity: { content_hash: `sha256:${hash(payload)}`, algorithm: "sha256" }, processing: { status: "normalized" }, ingestion_run_id: runId };
    await db.collection<RawRecordDoc>("raw_records").updateOne({ _id: raw._id }, { $setOnInsert: raw }, { upsert: true });
    const result = await db.collection<EventCandidateDoc>("event_candidates").updateOne({ _id: operation._id }, { $setOnInsert: operation }, { upsert: true }); result.upsertedCount ? counts.new++ : counts.duplicate++;
    // Append a correction record so databases that received the pre-enum draft can be repaired without mutating its raw claim.
    const correctionPayload = { record_type: "manual_research_correction", window_id: WINDOW_ID, candidate_id: operation._id, supersedes_raw_record_id: operation.raw_record_id, normalized_update: { "event.type": "raid" } };
    const correctionId = `raw_manual_correction_${WINDOW_ID}_${operation._id}_event_type`;
    const correction: RawRecordDoc = { _id: correctionId, source_id: SOURCE_ID, external_id: `${WINDOW_ID}-${operation._id}-event-type-correction`, retrieved_at: startedAt, source: { url: urls[0] }, dataset: { name: "Palantir TH verified event window", version: WINDOW_ID }, raw: correctionPayload, integrity: { content_hash: `sha256:${hash(correctionPayload)}`, algorithm: "sha256" }, processing: { status: "normalized" }, ingestion_run_id: runId };
    await db.collection<RawRecordDoc>("raw_records").updateOne({ _id: correctionId }, { $setOnInsert: correction }, { upsert: true });
    await db.collection<EventCandidateDoc>("event_candidates").updateOne({ _id: operation._id }, { $set: { "event.type": "raid", "attributes.event_type_correction_raw_record_id": correctionId } });
    await db.collection<IngestionRunDoc>("ingestion_runs").updateOne({ _id: runId }, { $set: { finished_at: new Date(), status: "success", records: counts } });
    console.log(JSON.stringify({ runId, window: WINDOW_ID, counts }, null, 2));
  } catch (error) {
    await db.collection<IngestionRunDoc>("ingestion_runs").updateOne({ _id: runId }, { $set: { finished_at: new Date(), status: "failed", error: error instanceof Error ? error.message : String(error), records: { ...counts, failed: 1 } } }); throw error;
  } finally { await client.close(); }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
