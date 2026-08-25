/** Audit, enrich, and add verified southern security incidents for 14-20 Jun 2026. */
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
const WINDOW_ID = "verified-window-2026-06-14-to-20";
const DEFAULT_URI = "mongodb://root:changeme@localhost:27017/palantir_th?authSource=admin";
const SBPAC = "https://opendata.sbpac.go.th/API/relief_01_01.aspx";

type Update = { id: string; urls: string[]; set: Record<string, unknown> };
const updates: Update[] = [
  {
    id: "evt_4b1906803dc7547048474f7e",
    urls: ["https://www.isranews.org/article/south-slide/147448-changepolptn.html", SBPAC],
    set: {
      "time.start": new Date("2026-06-14T16:10:00+07:00"), "time.precision": "minute",
      "location.place": "สวนยางพาราข้างสนามกีฬากลาง อบต.พิเทน หมู่ 1 ตำบลพิเทน อำเภอทุ่งยางแดง จังหวัดปัตตานี", "location.geo": null, "location.geo_precision": "unknown",
      "event.type": "explosion", "event.title": "วางระเบิด 2 ลูกข้างสนามกีฬา อบต.พิเทน", "event.rawType": "วางระเบิดแสวงเครื่องในงานกีฬา",
      "event.summary": "ก่อนพิธีเปิดพิเทนเกมส์ เจ้าหน้าที่พบระเบิดแสวงเครื่องตั้งเวลาด้วยวงจรดิจิทัลในสวนยางข้างสนามเวลา 11.30 น.และเก็บกู้ได้ ต่อมาเวลา 16.10 น.ระเบิดอีกลูกทำงานห่างจุดแรกประมาณ 50 เมตร สร้างความตื่นตระหนก แต่ไม่มีรายงานผู้เสียชีวิตหรือบาดเจ็บ",
      severity: 4, verification: "verified", confidence: 96, casualties: { killed: 0, injured: 0 }, actors: ["คนร้ายไม่ทราบกลุ่มและจำนวน"], targets: ["งานพิเทนเกมส์ 2569", "ประชาชนและเจ้าหน้าที่บริเวณสนามกีฬา"],
      "attributes.device_count": 2, "attributes.defused_count": 1, "attributes.exploded_count": 1, "attributes.location_text_precision": "site_village",
    },
  },
  {
    id: "evt_794fe0d5f1ce3c5ffef1e38d",
    urls: ["https://www.thaipbs.or.th/news/content/507157", SBPAC],
    set: {
      "time.start": new Date("2026-06-16T17:00:00+07:00"), "time.precision": "minute",
      "location.place": "เนินดินในสวนป่าริมทาง รอยต่อบ้านไม้ฝาด หมู่ 8 กับบ้านตอออ หมู่ 1 ตำบลกายูคละ อำเภอแว้ง จังหวัดนราธิวาส", "location.geo": null, "location.geo_precision": "unknown",
      "event.type": "explosion", "event.title": "ลอบวางระเบิดชุดจรยุทธ์รอยต่อบ้านไม้ฝาด–บ้านตอออ", "event.rawType": "ลอบวางระเบิดเจ้าหน้าที่ทหาร",
      "event.summary": "คนร้ายลอบวางระเบิดบริเวณเนินดินในสวนป่าริมทางซึ่งกำลังพลกองร้อยป้องกันชายแดนที่ 2 ใช้เป็นพื้นที่กางเต็นท์พักแรม แรงระเบิดทำให้พลทหารนราพงษ์ หนูสงวน อายุ 22 ปี มีอาการแน่นหน้าอกและถูกนำส่งโรงพยาบาลแว้ง",
      severity: 4, verification: "verified", confidence: 96, casualties: { killed: 0, injured: 1 }, actors: ["คนร้ายไม่ทราบกลุ่มและจำนวน"], targets: ["ชุดปฏิบัติการจรยุทธ์ กองร้อยป้องกันชายแดนที่ 2"],
      "attributes.location_text_precision": "village_boundary_site",
    },
  },
  {
    id: "evt_191993e7d908177976caae75",
    urls: ["https://www.isranews.org/article/south-slide/147448-changepolptn.html", "https://www.amarintv.com/news/crime/548993", "https://www.thaipbs.or.th/news/content/507182"],
    set: {
      "time.start": new Date("2026-06-17T09:30:00+07:00"), "time.precision": "minute",
      "location.place": "ถนนสาย 4017 บ้านกลาง–บ้านนอก หมู่ 5 ตำบลบ้านกลาง อำเภอปะนาเระ จังหวัดปัตตานี", "location.geo": null, "location.geo_precision": "unknown",
      "event.type": "explosion", "event.title": "ระเบิดขบวน อส.นำผู้ป่วยยาเสพติดส่งบำบัด", "event.rawType": "ลอบวางระเบิดแสวงเครื่องริมถนน",
      "event.summary": "คนร้ายจุดชนวนระเบิดแสวงเครื่องหนักประมาณ 5 กิโลกรัมที่ซุกริมถนน ขณะขบวนรถจักรยานยนต์ของ อส.ชุดคุ้มครองตำบลบ้านนอกกำลังนำผู้ป่วยยาเสพติดไปโรงพยาบาลปะนาเระ นายอิลยัส ดอเลาะเสียชีวิตภายหลัง และนายมะลีกี เจ๊ะแวได้รับบาดเจ็บ",
      severity: 5, verification: "verified", confidence: 98, casualties: { killed: 1, injured: 1 }, actors: ["คนร้ายไม่ทราบกลุ่มและจำนวน"], targets: ["อส.ชุดคุ้มครองตำบลบ้านนอก", "ขบวนนำผู้ป่วยยาเสพติดเข้ารับการบำบัด"],
      "attributes.explosive_weight_kg": 5, "attributes.location_text_precision": "road_village",
    },
  },
  {
    id: "evt_53d09eb96bcf1a0871d7e057",
    urls: ["https://www.thaipbs.or.th/news/content/507274", "https://www.thaich8.com/news_detail/144205/คนร้ายวางระเบิดรถตำรวจ-โชคดีเด็กเห็น-บอกชาวบ้านแจ้ง-ตร", "https://www.naewna.com/local/971871"],
    set: {
      "time.start": new Date("2026-06-19T13:10:00+07:00"), "time.precision": "minute",
      "location.place": "หน้ามัสยิดบูเก๊ะตา ตำบลโละจูด อำเภอแว้ง จังหวัดนราธิวาส", "location.geo": null, "location.geo_precision": "unknown",
      "event.type": "explosion", "event.title": "ซุกระเบิดใต้รถสายตรวจหน้ามัสยิดบูเก๊ะตา", "event.rawType": "ลอบวางระเบิดแสวงเครื่องติดใต้รถตำรวจ",
      "event.summary": "ประชาชนเห็นผู้ต้องสงสัยนำวัตถุติดใต้รถสายตรวจ สภ.บูเก๊ะตาที่จอดหน้ามัสยิดและแจ้งตำรวจ เจ้าหน้าที่กันพื้นที่ก่อนระเบิดทำงานราว 13.10 น. รถสายตรวจและรถประชาชนอีกคันเสียหาย แต่ไม่มีผู้เสียชีวิตหรือบาดเจ็บ กล้องวงจรปิดพบผู้ก่อเหตุ 1 คนเข้าไปติดวัตถุใต้รถ",
      severity: 4, verification: "verified", confidence: 98, casualties: { killed: 0, injured: 0 }, actors: ["ผู้ก่อเหตุ 1 คนที่ปรากฏในกล้องวงจรปิด"], targets: ["รถสายตรวจ สภ.บูเก๊ะตา", "เจ้าหน้าที่ตำรวจและประชาชนหน้ามัสยิด"],
      "attributes.detection_time": "12:57", "attributes.location_text_precision": "landmark",
    },
  },
  {
    id: "evt_7e5776541b9bfc962b46849f",
    urls: ["https://www.isranews.org/article/south-news/other-news/147470-bppthanto-3.html", "https://thaitv5hd.com/content/67915/", "https://www.southpeace.go.th/?p=176032"],
    set: {
      "time.start": new Date("2026-06-19T08:10:00+07:00"), "time.precision": "minute",
      "location.place": "ถนนสายบ้านบูโละสะนีแย–บ้านซาไก พื้นที่บ้านบูโละสะนีแย หมู่ 4 ตำบลบ้านแหร อำเภอธารโต จังหวัดยะลา", "location.geo": null, "location.geo_precision": "unknown",
      "event.type": "explosion", "event.title": "ระเบิดและซุ่มยิงขบวน ตชด.442 ชุด รปภ.ครู", "event.rawType": "ลอบวางระเบิดแสวงเครื่องและซุ่มยิง",
      "event.summary": "คนร้ายซุกระเบิดแสวงเครื่องในกล่องเหล็กหนักประมาณ 20 กิโลกรัมริมถนนและจุดชนวนขณะขบวนรถจักรยานยนต์ ตชด.442 เดินทางกลับจากภารกิจรักษาความปลอดภัยครูโรงเรียนบ้านซาไก มีรายงานซุ่มยิงประกอบการโจมตี ตชด.บาดเจ็บรวม 6 นาย ในจำนวนนี้สาหัส 2 นาย",
      severity: 5, verification: "verified", confidence: 98, casualties: { killed: 0, injured: 6 }, actors: ["คนร้ายไม่ทราบกลุ่มและจำนวน"], targets: ["ตชด.442 ชุดรักษาความปลอดภัยครู", "ขบวนรถจักรยานยนต์เจ้าหน้าที่"],
      "attributes.explosive_weight_kg": 20, "attributes.seriously_injured": 2, "attributes.location_text_precision": "road_village",
    },
  },
  {
    id: "evt_4efafb7bfddaf1fdc32ce573",
    urls: ["https://www.amarintv.com/news/crime/549364", SBPAC],
    set: {
      "time.start": new Date("2026-06-20T21:30:00+07:00"), "time.precision": "minute",
      "location.place": "หน้าร้านก๋วยเตี๋ยวข้างบ้านเลขที่ 157 หมู่ 7 บ้านตือกอ ตำบลจะแนะ อำเภอจะแนะ จังหวัดนราธิวาส", "location.geo": null, "location.geo_precision": "unknown",
      "event.type": "shooting", "event.title": "ยิงผู้ช่วยผู้ใหญ่บ้านตือกอแต่พลาดเป้า", "event.rawType": "ลอบยิงผู้ช่วยผู้ใหญ่บ้าน",
      "event.summary": "ชาย 2 คนใช้รถจักรยานยนต์เข้ามาหานายดันนียา กือเต๊ะ ผู้ช่วยผู้ใหญ่บ้านตือกอหน้าร้านก๋วยเตี๋ยว คนซ้อนท้ายยิงด้วยปืนเอ็ม 16 แต่นายดันนียาหลบได้ เมื่อพยายามยิงซ้ำปืนขัดลำกล้อง ก่อนยิงอีก 2 นัดแล้วหลบหนี ไม่มีผู้บาดเจ็บ กระสุนทำให้รถยนต์และผนังบ้านเสียหาย",
      severity: 4, verification: "verified", confidence: 95, casualties: { killed: 0, injured: 0 }, actors: ["คนร้าย 2 คนใช้รถจักรยานยนต์"], targets: ["นายดันนียา กือเต๊ะ ผู้ช่วยผู้ใหญ่บ้านตือกอ"],
      "attributes.weapon": "ปืนเอ็ม 16", "attributes.location_text_precision": "street_address",
    },
  },
];

const additions: EventCandidateDoc[] = [
  {
    _id: "evt_verified_20260619_mayo_khuan_yi_bomb", source_id: SOURCE_ID, raw_record_id: "raw_verified_20260619_mayo_khuan_yi_bomb",
    time: { start: new Date("2026-06-19T11:30:00+07:00"), precision: "minute" },
    location: { province: "ปัตตานี", provinceCode: "pattani", district: "มายอ", subdistrict: "ปะโด", place: "ถนนชลประทาน บ้านควนหยี หมู่ 3 ตำบลปะโด อำเภอมายอ จังหวัดปัตตานี", geo: null, geo_precision: "unknown" },
    event: { type: "explosion", title: "ระเบิดตำรวจ นปพ.ปัตตานี 31 ที่บ้านควนหยี", rawType: "ลอบวางระเบิดแสวงเครื่องริมถนน", summary: "คนร้ายจุดชนวนระเบิดแสวงเครื่องที่ฝังริมถนนชลประทาน ขณะตำรวจหมวดเฉพาะกิจหน่วยปฏิบัติการพิเศษปัตตานี 31 ขี่รถจักรยานยนต์กลับจากภารกิจตั้งจุดตรวจรักษาความปลอดภัย ทำให้ตำรวจบาดเจ็บ 5 นาย สองนายมีบาดแผลสะเก็ดระเบิด และสามนายมีอาการแน่นหน้าอกหรือหูอื้อ" },
    severity: 5, verification: "verified", confidence: 98, casualties: { killed: 0, injured: 5 }, actors: ["คนร้ายไม่ทราบกลุ่มและจำนวน"], targets: ["ตำรวจหมวดเฉพาะกิจ นปพ.ปัตตานี 31"], corroborating_sources: [SOURCE_ID], media: [],
    attributes: { research_batch: WINDOW_ID, location_address: "ถนนชลประทาน บ้านควนหยี หมู่ 3 ตำบลปะโด อำเภอมายอ จังหวัดปัตตานี", location_text_precision: "road_village", source_count: 3, source_url_1: "https://www.southpeace.go.th/?p=175452", source_url_2: "https://www.sbpac.go.th/home/?p=167934", source_url_3: "https://www.komchadluek.net/news/crime/618670" },
    unreported: ["coordinates", "explosive_device_detail", "perpetrator_identity"],
  },
  {
    _id: "evt_verified_20260619_tham_thalu_attack", source_id: SOURCE_ID, raw_record_id: "raw_verified_20260619_tham_thalu_attack",
    time: { start: new Date("2026-06-19T17:16:00+07:00"), precision: "minute" },
    location: { province: "ยะลา", provinceCode: "yala", district: "บันนังสตา", subdistrict: "ถ้ำทะลุ", place: "พื้นที่หมู่ 3 ตำบลถ้ำทะลุ อำเภอบันนังสตา จังหวัดยะลา", geo: null, geo_precision: "unknown" },
    event: { type: "unrest", title: "โจมตีสมาชิก อส.ขณะปฏิบัติหน้าที่ในตำบลถ้ำทะลุ", rawType: "รายงานขัดกัน: ใช้วัตถุไม่ทราบชนิดปาใส่/ลอบยิง", summary: "คนร้ายไม่ทราบชื่อและจำนวนโจมตีนายณัฐวุฒิ ประวรณา สมาชิกกองอาสารักษาดินแดน ชุดปฏิบัติการที่ 1 ขณะปฏิบัติหน้าที่ในพื้นที่หมู่ 3 ทำให้บาดเจ็บบริเวณช่องท้อง รายงานทางการระบุว่าใช้วัตถุไม่ทราบชนิดปาใส่ ขณะที่สำนักข่าวอิศราระบุว่าเป็นการลอบยิง จึงไม่ฟันธงชนิดอาวุธ" },
    severity: 4, verification: "verified", confidence: 90, casualties: { killed: 0, injured: 1 }, actors: ["คนร้ายไม่ทราบกลุ่มและจำนวน"], targets: ["นายณัฐวุฒิ ประวรณา สมาชิกกองอาสารักษาดินแดน"], corroborating_sources: [SOURCE_ID], media: [],
    attributes: { research_batch: WINDOW_ID, location_address: "พื้นที่หมู่ 3 ตำบลถ้ำทะลุ อำเภอบันนังสตา จังหวัดยะลา", location_text_precision: "village", source_count: 2, source_url_1: "https://www.southpeace.go.th/?p=175470", source_url_2: "https://www.isranews.org/article/south-news/other-news/147492-ttbomb.html", evidence_conflict: "official_source=unknown thrown object; Isranews=gunfire" },
    unreported: ["coordinates", "weapon", "perpetrator_identity"],
  },
];

function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

async function main(): Promise<void> {
  const client = await new MongoClient(process.env.MONGODB_URI ?? DEFAULT_URI, { serverSelectionTimeoutMS: 5_000 }).connect();
  const startedAt = new Date();
  const runId = `run_verified_20260614_20_${startedAt.toISOString().replace(/\D/g, "").slice(0, 14)}_${randomUUID().slice(0, 8)}`;
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
      const sourceAttributes = Object.fromEntries(item.urls.map((url, index) => [`attributes.source_url_${index + 1}`, url]));
      const set = { ...item.set, ...sourceAttributes, "attributes.research_batch": WINDOW_ID, "attributes.enrichment_raw_record_id": rawId, "attributes.location_address": item.set["location.place"], "attributes.source_count": item.urls.length };
      const result = await db.collection<EventCandidateDoc>("event_candidates").updateOne({ _id: item.id }, { $set: set as never, $addToSet: { corroborating_sources: SOURCE_ID }, $pull: { unreported: { $in: ["severity", "casualties", "casualties.killed", "casualties.injured", "actors", "targets", "exact_time"] } } });
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
    await db.collection<IngestionRunDoc>("ingestion_runs").updateOne({ _id: runId }, { $set: { finished_at: new Date(), status: "failed", error: error instanceof Error ? error.message : String(error), records: { ...counts, failed: counts.failed + 1 } } });
    throw error;
  } finally { await client.close(); }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
