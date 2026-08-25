/** Audit, enrich, and add southern security incidents for 12-18 Apr 2026. */
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
const WINDOW_ID = "verified-window-2026-04-12-to-18";
const WEEKLY_URL = "https://www.isranews.org/article/south-slide/146497-backhoeburnsouth.html";
const DEFAULT_URI = "mongodb://root:changeme@localhost:27017/palantir_th?authSource=admin";
type Update = { id: string; urls: string[]; set: Record<string, unknown>; reported: string[] };

const updates: Update[] = [
  {
    id: "evt_3d474818db78f91d4de822ca",
    urls: [WEEKLY_URL, "https://siamrath.co.th/regional/news/141546", "https://www.fm91bkk.com/newsarticle/70136", "https://opendata.sbpac.go.th/API/relief_01_01.aspx"],
    set: {
      "time.start": new Date("2026-04-14T12:48:00+07:00"), "time.precision": "minute",
      "location.place": "ร้านขายของชำ บ้านเจาะบูแม หมู่ 2 ตำบลจะกว๊ะ อำเภอรามัน จังหวัดยะลา", "location.geo": null, "location.geo_precision": "unknown",
      "event.type": "shooting", "event.title": "มือปืนบุกยิงอดีต ชรบ.เสียชีวิตในร้านชำบ้านเจาะบูแม", "event.rawType": "ยิงสังหารอดีตสมาชิกชุดรักษาความปลอดภัยหมู่บ้าน",
      "event.summary": "คนร้ายชายขี่รถจักรยานยนต์ตามนายอุสมาน หะยีเปาะจิ อายุ 63 ปี อดีต ชรบ. เข้าไปในร้านขายของชำ ทำทีซื้อสินค้าและให้เจ้าของร้านออกไปด้านนอก ก่อนใช้อาวุธปืนขนาด 9 มม. จ่อยิงบริเวณขมับขวา 1 นัด เสียชีวิตในร้าน แล้วขี่รถจักรยานยนต์หลบหนี ตำรวจยังไม่สรุปแรงจูงใจแต่ให้น้ำหนักประเด็นความมั่นคง",
      severity: 5, verification: "under_review", confidence: 95, casualties: { killed: 1, injured: 0 }, actors: ["มือปืนชายไม่ทราบชื่อ ใช้รถจักรยานยนต์"], targets: ["นายอุสมาน หะยีเปาะจิ อายุ 63 ปี อดีต ชรบ."],
      "attributes.weapon_caliber": "9 มม.", "attributes.killed_former_security": 1, "attributes.motive_status": "ตำรวจยังไม่สรุป; ให้น้ำหนักประเด็นความมั่นคง", "attributes.location_text_precision": "shop_village",
    },
    reported: ["severity", "casualties", "casualties.killed", "casualties.injured", "actors", "targets", "coordinates", "exact_time"],
  },
  {
    id: "evt_c7369c73761b3a6bc1dbfbbd",
    urls: [WEEKLY_URL, "https://www.secnia.go.th/2026/04/%E0%B8%95%E0%B8%A3%E0%B8%A7%E0%B8%88%E0%B8%AA%E0%B8%AD%E0%B8%9A%E0%B9%80%E0%B8%AB%E0%B8%95%E0%B8%B8%E0%B8%A5%E0%B8%AD%E0%B8%9A%E0%B8%A2%E0%B8%B4%E0%B8%87-%E0%B8%AD%E0%B8%AA-%E0%B8%93-%E0%B8%9A/", "https://www.naewna.com/local/958680", "https://opendata.sbpac.go.th/API/relief_01_01.aspx"],
    set: {
      "time.start": new Date("2026-04-14T22:20:00+07:00"), "time.precision": "minute",
      "location.place": "ริมถนนสายชลประทาน บ้านไสยพญา หมู่ 7 ตำบลบ้านกลาง อำเภอปะนาเระ จังหวัดปัตตานี", "location.geo": null, "location.geo_precision": "unknown",
      "event.type": "shooting", "event.title": "ซุ่มยิง อส.ชคต.คอกกระบือขณะกลับจากละหมาดที่บ้านไสยพญา", "event.rawType": "ลอบยิงสมาชิกชุดคุ้มครองตำบลระหว่างลาพัก",
      "event.summary": "นายวันอัฟคาน หะยีสะมาแอ สมาชิก อส.ชุดคุ้มครองตำบลคอกกระบือ ซึ่งอยู่ระหว่างลาพักและกลับมาอยู่กับครอบครัว เดินทางไปละหมาดที่มัสยิดในหมู่บ้าน ขากลับถูกคนร้ายไม่ทราบกลุ่มและจำนวนซุ่มยิงจากข้างถนนจนบาดเจ็บ พลเมืองดีนำส่งโรงพยาบาลปะนาเระ ตำรวจยังไม่สรุปสาเหตุแต่ให้น้ำหนักการสร้างสถานการณ์ความไม่สงบ",
      severity: 4, verification: "verified", confidence: 98, casualties: { killed: 0, injured: 1 }, actors: ["คนร้ายไม่ทราบกลุ่มและจำนวน"], targets: ["นายวันอัฟคาน หะยีสะมาแอ สมาชิก อส.ชคต.คอกกระบือ"],
      "attributes.injured_security": 1, "attributes.duty_status": "ลาพัก", "attributes.motive_status": "ตำรวจยังไม่สรุป; ให้น้ำหนักการสร้างสถานการณ์", "attributes.location_text_precision": "canal_road_village", "attributes.time_source_difference": "อิศราระบุรับแจ้ง 22:20 น.; FM91 ระบุ 20:35 น.",
    },
    reported: ["severity", "casualties", "casualties.killed", "casualties.injured", "actors", "targets", "coordinates", "exact_time"],
  },
  {
    id: "evt_8dbf99dec8cb5711a03e5442",
    urls: [WEEKLY_URL, "https://www.tnews.co.th/social/social-news/648533", "https://opendata.sbpac.go.th/API/relief_01_01.aspx"],
    set: {
      "time.start": new Date("2026-04-16T22:30:00+07:00"), "time.precision": "minute",
      "location.place": "ไซต์ก่อสร้างระบบป้องกันน้ำท่วมริมแม่น้ำโก-ลก บ้านมือบา หมู่ 4 ตำบลปาเสมัส อำเภอสุไหงโก-ลก จังหวัดนราธิวาส", "location.geo": null, "location.geo_precision": "unknown",
      "event.type": "arson", "event.title": "กลุ่มคนร้ายข้ามแม่น้ำโก-ลกขู่คนงานก่อนเผาเครื่องจักรไซต์ป้องกันน้ำท่วม", "event.rawType": "วางเพลิงเครื่องจักรก่อสร้างและข่มขู่คนงาน",
      "event.summary": "กลุ่มคนร้ายไม่ทราบจำนวนลอบข้ามแม่น้ำโก-ลกจากรัฐกลันตันเข้ามายังไซต์งานของบริษัท ตากใบการโยธา จำกัด ขู่บังคับคนงานเฝ้าไซต์ 2 คนให้หลบหนี แล้วใช้น้ำมันราดรถแบคโฮและรถบดถนนล้อยางก่อนจุดไฟเผา รถดับเพลิงใช้เวลากว่า 30 นาทีควบคุมเพลิง เครื่องจักร 2 คันเสียหายมูลค่ากว่า 6 ล้านบาท ไม่พบผู้บาดเจ็บทางกาย",
      severity: 5, verification: "verified", confidence: 98, casualties: { killed: 0, injured: 0 }, actors: ["กลุ่มคนร้ายไม่ทราบจำนวนซึ่งลอบข้ามแม่น้ำจากฝั่งรัฐกลันตัน"], targets: ["คนงานเฝ้าไซต์ 2 คน", "รถแบคโฮและรถบดถนนล้อยางของบริษัท ตากใบการโยธา จำกัด"],
      "attributes.threatened_workers": 2, "attributes.machinery_destroyed": 2, "attributes.estimated_damage_thb": 6000000, "attributes.accelerant": "น้ำมันเชื้อเพลิง", "attributes.fire_suppression_minutes": 30, "attributes.location_text_precision": "construction_site_river_village",
    },
    reported: ["severity", "casualties", "casualties.killed", "casualties.injured", "actors", "targets", "coordinates", "exact_time"],
  },
];

const additions: EventCandidateDoc[] = [
  {
    _id: "evt_verified_20260415_bacho_champako_tire_fire", source_id: SOURCE_ID, raw_record_id: "raw_verified_20260415_bacho_champako_tire_fire",
    time: { start: new Date("2026-04-15T21:00:00+07:00"), precision: "minute" },
    location: { province: "นราธิวาส", provinceCode: "narathiwat", district: "บาเจาะ", subdistrict: "บาเระเหนือ", place: "ทางหลวงแผ่นดินหมายเลข 42 ฝั่งขาเข้าปัตตานี บ้านจำปากอ หมู่ 1 ตำบลบาเระเหนือ อำเภอบาเจาะ จังหวัดนราธิวาส ห่างฐานปฏิบัติการบ้านอิโย๊ะประมาณ 850 เมตร", geo: null, geo_precision: "unknown" },
    event: { type: "unrest", title: "เผายางรถยนต์บนทางหลวง 42 บ้านจำปากอใกล้ฐานบ้านอิโย๊ะ", rawType: "เผายางรถยนต์ก่อกวนเส้นทาง", summary: "คนร้ายไม่ทราบจำนวนจุดไฟเผายางรถยนต์ 1 เส้นบนทางหลวงหมายเลข 42 ชาวบ้านช่วยกันดับไฟ ความเสียหายจำกัดเป็นรอยไหม้เล็กน้อยบนผิวจราจร ไม่มีผู้บาดเจ็บหรือทรัพย์สินอื่นเสียหาย" },
    severity: 2, verification: "verified", confidence: 92, casualties: { killed: 0, injured: 0 }, actors: ["ผู้ก่อเหตุไม่ทราบกลุ่มและจำนวน"], targets: ["ทางหลวงหมายเลข 42 และการสัญจร"], corroborating_sources: [SOURCE_ID], media: [],
    attributes: { research_batch: WINDOW_ID, location_address: "ทางหลวง 42 บ้านจำปากอ หมู่ 1 ตำบลบาเระเหนือ อำเภอบาเจาะ จังหวัดนราธิวาส", location_text_precision: "highway_village_landmark_distance", source_count: 1, source_url_1: WEEKLY_URL, tires_burned: 1, distance_from_security_base_m: 850, damage: "รอยไหม้เล็กน้อยบนผิวจราจร" },
    unreported: ["coordinates", "perpetrator_identity"],
  },
  {
    _id: "evt_verified_20260416_takbai_chumbok_two_tire_fires", source_id: SOURCE_ID, raw_record_id: "raw_verified_20260416_takbai_chumbok_two_tire_fires",
    time: { start: new Date("2026-04-16T20:00:00+07:00"), precision: "minute" },
    location: { province: "นราธิวาส", provinceCode: "narathiwat", district: "ตากใบ", subdistrict: "เกาะสะท้อน", place: "ถนนในหมู่บ้านชุมบก หมู่ 9 ตำบลเกาะสะท้อน อำเภอตากใบ จังหวัดนราธิวาส จำนวน 2 จุด ห่างกันประมาณ 500 เมตร", geo: null, geo_precision: "unknown" },
    event: { type: "unrest", title: "เผายางรถยนต์ก่อกวน 2 จุดห่างกัน 500 เมตรที่บ้านชุมบก ตากใบ", rawType: "เผายางรถยนต์หลายจุดก่อกวนเส้นทาง", summary: "คนร้ายนำยางรถยนต์ไปจุดไฟเผาบนถนนในหมู่บ้านชุมบก 2 จุดซึ่งห่างกันประมาณ 500 เมตร เจ้าหน้าที่และชาวบ้านช่วยกันดับไฟ ไม่มีรายงานผู้บาดเจ็บ เบื้องต้นเจ้าหน้าที่สันนิษฐานว่าเป็นการสร้างสถานการณ์เชิงสัญลักษณ์" },
    severity: 3, verification: "verified", confidence: 92, casualties: { killed: 0, injured: 0 }, actors: ["ผู้ก่อเหตุไม่ทราบกลุ่มและจำนวน"], targets: ["ถนนและการสัญจรในบ้านชุมบก 2 จุด"], corroborating_sources: [SOURCE_ID], media: [],
    attributes: { research_batch: WINDOW_ID, location_address: "ถนนบ้านชุมบก หมู่ 9 ตำบลเกาะสะท้อน อำเภอตากใบ จังหวัดนราธิวาส", location_text_precision: "two_road_sites_village", source_count: 1, source_url_1: WEEKLY_URL, coordinated_sites: 2, distance_between_sites_m: 500 },
    unreported: ["coordinates", "perpetrator_identity", "damage_value"],
  },
];

function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

async function main(): Promise<void> {
  const client = await new MongoClient(process.env.MONGODB_URI ?? DEFAULT_URI, { serverSelectionTimeoutMS: 5_000 }).connect();
  const startedAt = new Date();
  const runId = `run_verified_20260412_18_${startedAt.toISOString().replace(/\D/g, "").slice(0, 14)}_${randomUUID().slice(0, 8)}`;
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
    for (const candidate of additions) {
      const urls = Object.entries(candidate.attributes).filter(([key]) => key.startsWith("source_url_")).map(([, value]) => String(value));
      const payload = { record_type: "manual_research_claim", window_id: WINDOW_ID, candidate, sources: urls };
      const raw: RawRecordDoc = { _id: candidate.raw_record_id, source_id: SOURCE_ID, external_id: `${WINDOW_ID}-${candidate._id}`, retrieved_at: startedAt, source: { url: urls[0] }, dataset: { name: "Palantir TH verified event window", version: WINDOW_ID }, raw: payload, integrity: { content_hash: `sha256:${hash(payload)}`, algorithm: "sha256" }, processing: { status: "normalized" }, ingestion_run_id: runId };
      await db.collection<RawRecordDoc>("raw_records").updateOne({ _id: raw._id }, { $setOnInsert: raw }, { upsert: true });
      const result = await db.collection<EventCandidateDoc>("event_candidates").updateOne({ _id: candidate._id }, { $setOnInsert: candidate }, { upsert: true });
      result.upsertedCount ? counts.new++ : counts.duplicate++;
    }
    await db.collection<IngestionRunDoc>("ingestion_runs").updateOne({ _id: runId }, { $set: { finished_at: new Date(), status: "success", records: counts } });
    console.log(JSON.stringify({ runId, window: WINDOW_ID, counts }, null, 2));
  } catch (error) {
    await db.collection<IngestionRunDoc>("ingestion_runs").updateOne({ _id: runId }, { $set: { finished_at: new Date(), status: "failed", error: error instanceof Error ? error.message : String(error), records: { ...counts, failed: 1 } } });
    throw error;
  } finally { await client.close(); }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
