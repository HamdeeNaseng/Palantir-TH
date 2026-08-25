/** Audit, enrich, and add southern security incidents for 29 Mar-4 Apr 2026. */
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
const WINDOW_ID = "verified-window-2026-03-29-to-04-04";
const SBPAC_URL = "https://opendata.sbpac.go.th/API/relief_01_01.aspx";
const DEFAULT_URI = "mongodb://root:changeme@localhost:27017/palantir_th?authSource=admin";
type Update = { id: string; urls: string[]; set: Record<string, unknown>; reported: string[] };

const updates: Update[] = [
  {
    id: "evt_f9d5f677ae78520184a4a3ce",
    urls: ["https://www.southpeace.go.th/?p=166002", SBPAC_URL],
    set: {
      "time.start": new Date("2026-03-31T22:10:00+07:00"), "time.precision": "minute",
      "location.place": "บ้านเลขที่ 110 บ้านกอลี หมู่ 6 ตำบลตะโละดือรามัน อำเภอกะพ้อ จังหวัดปัตตานี", "location.geo": null, "location.geo_precision": "unknown",
      "event.type": "shooting", "event.title": "ลอบยิงอาสาสมัครทหารพรานขณะช่วยสร้างบ้านที่บ้านกอลี", "event.rawType": "ลอบยิงเจ้าหน้าที่ระหว่างลาพักและประชาชน",
      "event.summary": "คนร้ายไม่ทราบชื่อและจำนวนใช้อาวุธปืนยิงบริเวณบ้านเลขที่ 110 ซึ่งอยู่ระหว่างก่อสร้างในบ้านกอลี อาสาสมัครทหารพรานซอเฮาะ บาแต สังกัด ฉก.ทพ.44 ซึ่งอยู่ระหว่างลาพักและแวะช่วยชาวบ้านก่อสร้างบ้านเสียชีวิต และประชาชนที่ร่วมก่อสร้างบาดเจ็บอีก 1 ราย หน่วยงานยังอยู่ระหว่างตรวจสอบรายละเอียดและติดตามผู้ก่อเหตุ",
      severity: 5, verification: "verified", confidence: 98, casualties: { killed: 1, injured: 1 },
      actors: ["คนร้ายไม่ทราบชื่อและจำนวน"], targets: ["อส.ทพ.ซอเฮาะ บาแต สังกัด ฉก.ทพ.44", "ประชาชนผู้ร่วมก่อสร้างบ้าน"],
      "attributes.killed_security": 1, "attributes.injured_civilian": 1, "attributes.duty_status": "ลาพัก", "attributes.location_text_precision": "house_number_village",
    },
    reported: ["severity", "casualties", "casualties.killed", "casualties.injured", "actors", "targets", "exact_time"],
  },
  {
    id: "evt_e4b6902c015f14104ebcf102",
    urls: ["https://radionarathiwat.prd.go.th/th/content/category/detail/id/9/iid/490637", "https://www.southpeace.go.th/?p=166003", "https://thainews.prd.go.th/thainews/news/view/1910011/?bid=1", "https://www.nationtv.tv/news/current-issue/378975978", SBPAC_URL],
    set: {
      "time.start": new Date("2026-04-01T01:00:00+07:00"), "time.precision": "minute",
      "location.place": "ทางหลวงชนบทหมายเลข นธ.4115 บริเวณบ้านสุแฆ หมู่ 3 ตำบลดุซงญอ อำเภอจะแนะ จังหวัดนราธิวาส", "location.geo": null, "location.geo_precision": "unknown",
      "event.type": "shooting", "event.title": "ซุ่มยิงรถปลัดอำเภอจะแนะบนทางหลวง นธ.4115 เสียชีวิต 2 ราย", "event.rawType": "ซุ่มยิงรถเจ้าหน้าที่ฝ่ายปกครอง",
      "event.summary": "คนร้ายไม่ทราบจำนวนซุ่มยิงรถกระบะของเจ้าหน้าที่ฝ่ายปกครองบนทางหลวงชนบท นธ.4115 บ้านสุแฆ ทำให้นายมนชัย จิตกมลกานต์ ปลัดอำเภอจะแนะและหัวหน้ากลุ่มงานความมั่นคง กับนางสาวฮัยด๊ะ บือราเฮง อายุ 27 ปี พนักงานส่วนท้องถิ่น เสียชีวิต 2 ราย การตรวจพิสูจน์ภายหลังรายงานว่าพบปลอกกระสุน 94 นัดจากอาวุธอย่างน้อย 4 ชนิด แต่แรงจูงใจยังต้องยึดผลสอบสวนตามกระบวนการ",
      severity: 6, verification: "verified", confidence: 99, casualties: { killed: 2, injured: 0 },
      actors: ["คนร้ายไม่ทราบจำนวน"], targets: ["นายมนชัย จิตกมลกานต์ ปลัดอำเภอจะแนะ", "นางสาวฮัยด๊ะ บือราเฮง พนักงานส่วนท้องถิ่น"],
      "attributes.killed_government_officials": 2, "attributes.spent_cartridges_reported": 94, "attributes.weapon_types_reported": 4, "attributes.motive_status": "อยู่ระหว่างกระบวนการสอบสวน", "attributes.location_text_precision": "road_number_village",
    },
    reported: ["severity", "casualties", "casualties.killed", "casualties.injured", "actors", "targets", "exact_time"],
  },
  {
    id: "evt_f22bdfbceb8e06ffe22902f7",
    urls: ["https://www.southpeace.go.th/?p=166005", "https://www.thaipost.net/district-news/972968/", SBPAC_URL],
    set: {
      "time.start": new Date("2026-04-01T05:40:00+07:00"), "time.precision": "minute",
      "location.place": "ถนนภายในบ้านบาโงยือริง หมู่ 3 ตำบลบือเระ อำเภอสายบุรี จังหวัดปัตตานี ห่างจากบ้านพักผู้เสียชีวิตประมาณ 100 เมตร", "location.geo": null, "location.geo_precision": "unknown",
      "event.type": "shooting", "event.title": "ซุ่มยิงผู้ใหญ่บ้านบาโงยือริงขณะเดินทางไปละหมาด", "event.rawType": "ซุ่มยิงผู้นำท้องที่",
      "event.summary": "นายรียะ สาและ อายุ 58 ปี ผู้ใหญ่บ้านหมู่ 3 ขี่รถจักรยานยนต์จากบ้านไปละหมาดที่มัสยิดในหมู่บ้าน เมื่อถึงถนนห่างบ้านประมาณ 100 เมตร ถูกคนร้ายซุ่มในที่มืดใช้ปืนลูกซองยิง 1 นัด เข้าศีรษะและลำตัว ชาวบ้านนำส่งโรงพยาบาลสมเด็จพระยุพราชสายบุรีแต่เสียชีวิตภายหลัง ตำรวจยังไม่สรุปแรงจูงใจ โดยตรวจทั้งความขัดแย้ง การเมืองท้องถิ่น และเหตุความไม่สงบ",
      severity: 5, verification: "under_review", confidence: 98, casualties: { killed: 1, injured: 0 },
      actors: ["คนร้ายไม่ทราบจำนวนซุ่มอยู่ในที่มืด"], targets: ["นายรียะ สาและ อายุ 58 ปี ผู้ใหญ่บ้านหมู่ 3"],
      "attributes.weapon": "ปืนลูกซอง", "attributes.shots_reported": 1, "attributes.motive_status": "ตำรวจยังไม่สรุปและไม่ตัดหลายประเด็น", "attributes.location_text_precision": "village_road_distance_from_home", "attributes.time_source_difference": "ข่าวตำรวจระบุรับแจ้ง 05:30 น.; กอ.รมน.ระบุเหตุประมาณ 05:40 น.",
    },
    reported: ["severity", "casualties", "casualties.killed", "casualties.injured", "actors", "targets", "exact_time"],
  },
  {
    id: "evt_ce4ba390da41dc18cd61fa01",
    urls: ["https://www.thaipbs.or.th/news/content/504257", "https://www.thereporters.co/deepsouth/0404261600/", "https://www.southpeace.go.th/?p=166474", "https://www.sbpac.go.th/home/?p=162239", SBPAC_URL],
    set: {
      "time.start": new Date("2026-04-04T01:30:00+07:00"), "time.precision": "minute",
      "location.place": "ถนนทางหลวงหมายเลข 4271 บริเวณบ้านไอร์ลาฆอ (บ้านย่อยบ้านไอร์โซ) หมู่ 5 ตำบลช้างเผือก อำเภอจะแนะ จังหวัดนราธิวาส", "location.geo": null, "location.geo_precision": "unknown",
      "event.type": "shooting", "event.title": "ซุ่มยิงขบวนชุดเคลื่อนที่เร็ว ทพ.4901 ที่บ้านไอร์ลาฆอ บาดเจ็บ 4 นาย", "event.rawType": "ซุ่มยิงขบวนเจ้าหน้าที่ระหว่างปฏิบัติหน้าที่",
      "event.summary": "คนร้ายไม่ทราบกลุ่มและจำนวนซุ่มในป่ารกริมถนน แล้วยิงรถคันที่ 5 ของขบวนชุดปฏิบัติการเคลื่อนที่เร็ว ร้อย ทพ.4901 ซึ่งมีกำลัง 5 คันและกำลังไปสนับสนุน ชคต.ช้างเผือก หลังเกิดเหตุทำลายกล้องวงจรปิด ทำให้ ร.ท.วาทิต วัฒนสันติ์, ส.ท.ศุภณัฐ พรหมสุทธิ์, อส.ทพ.อนาวิล จินดาพรรณ และ อส.ทพ.พงษ์ธร อักษรเงิน บาดเจ็บรวม 4 นาย เจ้าหน้าที่นำส่งโรงพยาบาลจะแนะและส่งต่อรักษา",
      severity: 5, verification: "verified", confidence: 99, casualties: { killed: 0, injured: 4 },
      actors: ["คนร้ายไม่ทราบกลุ่มและจำนวนซุ่มอยู่ในป่ารกริมถนน"], targets: ["ชุดปฏิบัติการเคลื่อนที่เร็ว ร้อย ทพ.4901 ขบวนรถ 5 คัน"],
      "attributes.injured_security": 4, "attributes.convoy_vehicles": 5, "attributes.target_vehicle_position": 5, "attributes.location_text_precision": "highway_village",
    },
    reported: ["severity", "casualties", "casualties.killed", "casualties.injured", "actors", "targets", "exact_time"],
  },
];

const additions: EventCandidateDoc[] = [
  {
    _id: "evt_verified_20260403_chanae_four_site_cctv_damage", source_id: SOURCE_ID, raw_record_id: "raw_verified_20260403_chanae_four_site_cctv_damage",
    time: { start: new Date("2026-04-03T19:00:00+07:00"), precision: "minute" },
    location: { province: "นราธิวาส", provinceCode: "narathiwat", district: "จะแนะ", subdistrict: "ช้างเผือก/จะแนะ", place: "4 จุด: สามแยกมัสยิดมะนังกาแยง หมู่ 3 ตำบลช้างเผือก; สามแยกบ้านปารี หมู่ 4 ตำบลจะแนะ; แยกทางเข้าบ้านน้ำวน หมู่ 1 ตำบลช้างเผือก; หน้าโรงเรียนพิทักษ์วิทยากูมุง หมู่ 2 ตำบลช้างเผือก อำเภอจะแนะ จังหวัดนราธิวาส", geo: null, geo_precision: "unknown" },
    event: { type: "unrest", title: "ทำลายกล้องวงจรปิด 11 ตัวใน 4 จุด อำเภอจะแนะ", rawType: "ทำลายระบบกล้องวงจรปิดหลายจุด", summary: "กลุ่มชายฉกรรจ์ใช้รถจักรยานยนต์ตระเวน 4 จุดในตำบลช้างเผือกและตำบลจะแนะ แต่ละจุดพบผู้ก่อเหตุ 4 คน ใช้รถจักรยานยนต์ 2 คัน และใช้ท่อนไม้ยาวติดตะขอเกี่ยวสายไฟของกล้องจนขาด ทำให้กล้องใช้การไม่ได้ 11 ตัว แบ่งเป็น 3, 2, 3 และ 3 ตัวตามลำดับ เหตุนี้เกิดก่อนการซุ่มยิงขบวน ทพ.4901 ในพื้นที่เดียวกันหลายชั่วโมง" },
    severity: 3, verification: "verified", confidence: 97, casualties: { killed: 0, injured: 0 }, actors: ["กลุ่มชายฉกรรจ์ จุดละ 4 คน ใช้รถจักรยานยนต์ 2 คัน"], targets: ["กล้องวงจรปิด 11 ตัวใน 4 จุด"], corroborating_sources: [SOURCE_ID], media: [],
    attributes: { research_batch: WINDOW_ID, location_address: "4 จุดในหมู่ 1, 2, 3 ตำบลช้างเผือก และหมู่ 4 ตำบลจะแนะ อำเภอจะแนะ จังหวัดนราธิวาส", location_text_precision: "four_named_landmarks", source_count: 1, source_url_1: "https://www.thereporters.co/deepsouth/0404261600/", coordinated_sites: 4, cameras_disabled: 11, motorcycles: 2, perpetrators_per_site_reported: 4, method: "ใช้ท่อนไม้ยาวติดตะขอเกี่ยวสายไฟกล้องจนขาด" },
    unreported: ["coordinates", "perpetrator_identity", "damage_value"],
  },
  {
    _id: "evt_verified_20260403_thungyangdaeng_prepared_bomb", source_id: SOURCE_ID, raw_record_id: "raw_verified_20260403_thungyangdaeng_prepared_bomb",
    time: { start: new Date("2026-04-03T00:00:00+07:00"), precision: "day" },
    location: { province: "ปัตตานี", provinceCode: "pattani", district: "ทุ่งยางแดง", subdistrict: "ปากู", place: "ถนนหมายเลข 4074 หน้าปอเนาะเราฎอตุลมูตาอัลลิมีน บ้านมะนังยง หมู่ 4 ตำบลปากู อำเภอทุ่งยางแดง จังหวัดปัตตานี", geo: null, geo_precision: "unknown" },
    event: { type: "explosion", title: "พบการเตรียมวางระเบิดบนถนน 4074 หน้าปอเนาะบ้านมะนังยง", rawType: "ตรวจพบการเตรียมลอบวางระเบิด", summary: "แหล่งข่าวทางการภายหลังระบุว่าเกิดกรณีเตรียมลอบวางระเบิดบนถนนหมายเลข 4074 หน้าปอเนาะเราฎอตุลมูตาอัลลิมีน บ้านมะนังยง เมื่อวันที่ 3 เมษายน 2569 และตรวจพบ DNA บนวงจรวัตถุระเบิด ไม่มีรายงานการระเบิดหรือผู้เสียชีวิต/บาดเจ็บในคำชี้แจงดังกล่าว รายละเอียดเวลา ชนิด ภาชนะ น้ำหนัก และวิธีที่เจ้าหน้าที่พบหรือเก็บกู้ไม่ได้รับการเปิดเผย จึงบันทึกเฉพาะข้อเท็จจริงที่ยืนยันได้" },
    severity: 3, verification: "verified", confidence: 91, casualties: { killed: 0, injured: 0 }, actors: ["ผู้เตรียมวางระเบิดซึ่งยังต้องพิสูจน์ตามกระบวนการยุติธรรม"], targets: ["ถนนหมายเลข 4074 บริเวณหน้าปอเนาะและผู้ใช้เส้นทาง"], corroborating_sources: [SOURCE_ID], media: [],
    attributes: { research_batch: WINDOW_ID, location_address: "ถนน 4074 หน้าปอเนาะเราฎอตุลมูตาอัลลิมีน บ้านมะนังยง หมู่ 4 ตำบลปากู อำเภอทุ่งยางแดง จังหวัดปัตตานี", location_text_precision: "road_landmark_village", source_count: 2, source_url_1: "https://www.southpeace.go.th/?p=167128", source_url_2: "https://issoc4news.blogspot.com/2026/04/blog-post_11.html", device_status: "ตรวจพบวงจรวัตถุระเบิด; แหล่งข่าวไม่ระบุว่าเกิดการระเบิด", evidence_reported: "DNA บนวงจรวัตถุระเบิด", detail_limitations: "ไม่เปิดเผยเวลา ชนิด ภาชนะ น้ำหนัก และวิธีพบหรือเก็บกู้" },
    unreported: ["coordinates", "exact_time", "device_type", "explosive_weight", "discovery_method"],
  },
];

function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

async function main(): Promise<void> {
  const client = await new MongoClient(process.env.MONGODB_URI ?? DEFAULT_URI, { serverSelectionTimeoutMS: 5_000 }).connect();
  const startedAt = new Date();
  const runId = `run_verified_20260329_0404_${startedAt.toISOString().replace(/\D/g, "").slice(0, 14)}_${randomUUID().slice(0, 8)}`;
  const counts = { downloaded: updates.length + additions.length, new: 0, updated: 0, duplicate: 0, failed: 0 };
  const db = client.db(process.env.MONGODB_DB ?? "palantir_th");
  try {
    const source: SourceRegistryDoc = { _id: SOURCE_ID, name: "Palantir TH manual research ledger", shortName: "Manual research", category: "research", priority: "P3", role: "Manually corroborated event enrichment", connector: { type: "FORM" }, schedule: { mode: "snapshot", frequency: "manual" }, trust: { class: "manual_entry", score: 60 }, enabled: true };
    await db.collection<SourceRegistryDoc>("source_registry").updateOne({ _id: SOURCE_ID }, { $setOnInsert: source }, { upsert: true });
    const run: IngestionRunDoc = { _id: runId, source_id: SOURCE_ID, started_at: startedAt, finished_at: null, status: "running", records: counts };
    await db.collection<IngestionRunDoc>("ingestion_runs").insertOne(run);
    for (const item of updates) {
      const payload = { record_type: "manual_research_enrichment", window_id: WINDOW_ID, candidate_id: item.id, sources: item.urls, normalized_update: item.set };
      const rawId = `raw_manual_enrichment_${WINDOW_ID}_${item.id}`;
      const raw: RawRecordDoc = { _id: rawId, source_id: SOURCE_ID, external_id: `${WINDOW_ID}-enrichment-${item.id}`, retrieved_at: startedAt, source: { url: item.urls[0] }, dataset: { name: "Palantir TH verified event window", version: WINDOW_ID }, raw: payload, integrity: { content_hash: `sha256:${hash(payload)}`, algorithm: "sha256" }, processing: { status: "normalized" }, ingestion_run_id: runId };
      await db.collection<RawRecordDoc>("raw_records").updateOne({ _id: rawId }, { $setOnInsert: raw }, { upsert: true });
      const sourceAttrs = Object.fromEntries(item.urls.map((url, index) => [`attributes.source_url_${index + 1}`, url]));
      const set = { ...item.set, ...sourceAttrs, "attributes.research_batch": WINDOW_ID, "attributes.enrichment_raw_record_id": rawId, "attributes.location_address": item.set["location.place"], "attributes.source_count": item.urls.length };
      const result = await db.collection<EventCandidateDoc>("event_candidates").updateOne({ _id: item.id }, { $set: set as never, $addToSet: { corroborating_sources: SOURCE_ID }, $pull: { unreported: { $in: item.reported } } });
      if (!result.matchedCount) throw new Error(`Existing candidate ${item.id} was not found`);
      result.modifiedCount ? counts.updated++ : counts.duplicate++;
    }
    for (const item of additions) {
      const urls = Object.entries(item.attributes).filter(([key]) => key.startsWith("source_url_")).map(([, value]) => String(value));
      const payload = { record_type: "manual_research_claim", window_id: WINDOW_ID, candidate: item, sources: urls };
      const raw: RawRecordDoc = { _id: item.raw_record_id, source_id: SOURCE_ID, external_id: `${WINDOW_ID}-${item._id}`, retrieved_at: startedAt, source: { url: urls[0] }, dataset: { name: "Palantir TH verified event window", version: WINDOW_ID }, raw: payload, integrity: { content_hash: `sha256:${hash(payload)}`, algorithm: "sha256" }, processing: { status: "normalized" }, ingestion_run_id: runId };
      await db.collection<RawRecordDoc>("raw_records").updateOne({ _id: raw._id }, { $setOnInsert: raw }, { upsert: true });
      const result = await db.collection<EventCandidateDoc>("event_candidates").updateOne({ _id: item._id }, { $setOnInsert: item }, { upsert: true });
      result.upsertedCount ? counts.new++ : counts.duplicate++;
    }
    await db.collection<IngestionRunDoc>("ingestion_runs").updateOne({ _id: runId }, { $set: { finished_at: new Date(), status: "success", records: counts } });
    console.log(JSON.stringify({ runId, window: WINDOW_ID, counts }, null, 2));
  } catch (error) {
    counts.failed++;
    await db.collection<IngestionRunDoc>("ingestion_runs").updateOne({ _id: runId }, { $set: { finished_at: new Date(), status: "failed", error: error instanceof Error ? error.message : String(error), records: counts } });
    throw error;
  } finally { await client.close(); }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
