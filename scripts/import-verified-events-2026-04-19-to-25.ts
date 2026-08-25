/** Audit, enrich, and add southern security incidents for 19-25 Apr 2026. */
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
const WINDOW_ID = "verified-window-2026-04-19-to-25";
const DEFAULT_URI = "mongodb://root:changeme@localhost:27017/palantir_th?authSource=admin";
type Update = { id: string; urls: string[]; set: Record<string, unknown>; reported: string[] };

const updates: Update[] = [
  {
    id: "evt_14fc63740cdca19268a6b0ba",
    urls: ["https://www.southpeace.go.th/?p=168224", "https://www.southpeace.go.th/?p=168359", "https://www.southpeace.go.th/?p=168827", "https://www.isranews.org/article/south-slide/146526-grnangtabb.html", "https://opendata.sbpac.go.th/API/relief_01_01.aspx"],
    set: {
      "time.start": new Date("2026-04-20T10:40:00+07:00"), "time.precision": "minute",
      "location.place": "ทางหลวงแผ่นดินหมายเลข 410 หน้าโรงเรียนแสงทิพย์วิทยา บ้านตาเนาะปูเต๊ะ หมู่ 4 ตำบลตาเนาะปูเต๊ะ อำเภอบันนังสตา จังหวัดยะลา", "location.geo": null, "location.geo_precision": "unknown",
      "event.type": "explosion", "event.title": "ลอบวางระเบิดรถหุ้มเกราะทหารพรานบนทางหลวง 410 บันนังสตา บาดเจ็บ 7 นาย", "event.rawType": "ลอบวางระเบิดแสวงเครื่องโจมตีเจ้าหน้าที่",
      "event.summary": "คนร้ายนำระเบิดแสวงเครื่องบรรจุถังแก๊สขนาด 15 กิโลกรัม ใส่เหล็กเส้นตัดเป็นสะเก็ด น้ำหนักรวมกว่า 80 กิโลกรัม ซุกในท่อลอดใต้ถนนและลากสายไฟไปกดจุดระเบิด ขณะรถกระบะหุ้มเกราะอีซูซุ ดีแม็คซ์ ของชุดรักษาความปลอดภัยคณะผู้บังคับบัญชา ฉก.ทพ.33 ผ่านหน้าโรงเรียนแสงทิพย์วิทยา รถเสียหายและกำลังพลบาดเจ็บ 7 นาย ส่วนใหญ่แน่นหน้าอกหรือหูอื้อจากแรงอัดระเบิด",
      severity: 5, verification: "verified", confidence: 99, casualties: { killed: 0, injured: 7 }, actors: ["ผู้ก่อเหตุไม่ทราบกลุ่มและจำนวน"], targets: ["รถกระบะหุ้มเกราะและกำลังพลหน่วยเฉพาะกิจกรมทหารพรานที่ 33"],
      "attributes.injured_security": 7, "attributes.explosive_container": "ถังแก๊ส 15 กิโลกรัม", "attributes.estimated_device_weight_kg": 80, "attributes.trigger": "ลากสายไฟไปกดจุดระเบิด", "attributes.location_text_precision": "road_school_village", "attributes.time_source_difference": "แหล่งทางการระบุ 10:40 น.; อิศราระบุ 10:47 น.",
    },
    reported: ["severity", "casualties", "casualties.killed", "casualties.injured", "actors", "targets", "coordinates", "exact_time"],
  },
  {
    id: "evt_ada85e9c303121b14d1f8685",
    urls: ["https://www.isranews.org/article/south-slide/146526-grnangtabb.html", "https://www.matichon.co.th/region/news_5683901", "https://opendata.sbpac.go.th/API/relief_01_01.aspx"],
    set: {
      "time.start": new Date("2026-04-20T08:40:00+07:00"), "time.precision": "minute",
      "location.place": "ถนนในบ้านคอลอกาปะ หมู่ 6 ตำบลกะรุบี อำเภอกะพ้อ จังหวัดปัตตานี", "location.geo": null, "location.geo_precision": "unknown",
      "event.type": "shooting", "event.title": "คนร้ายแต่งกายอำพรางประกบยิง อส.กะพ้อ เสียชีวิตที่บ้านคอลอกาปะ", "event.rawType": "ลอบยิงเจ้าหน้าที่อาสารักษาดินแดนระหว่างเดินทางไปทำงาน",
      "event.summary": "คนร้าย 2 รายใช้รถจักรยานยนต์ติดตามและประกบยิงนายเดชอุดม สาและ อายุ 59 ปี สมาชิกกองอาสารักษาดินแดนอำเภอกะพ้อ ขณะผู้ตายขี่รถจักรยานยนต์ไปทำงาน กระสุนถูกลำตัวและศีรษะ เสียชีวิตในที่เกิดเหตุ ภาพกล้องใกล้เคียงพบผู้ก่อเหตุแต่งกายคล้ายหญิงมุสลิม สวมเสื้อคลุมยาวและฮิญาบเพื่ออำพราง",
      severity: 5, verification: "verified", confidence: 99, casualties: { killed: 1, injured: 0 }, actors: ["คนร้าย 2 รายใช้รถจักรยานยนต์และแต่งกายอำพราง"], targets: ["นายเดชอุดม สาและ อายุ 59 ปี สมาชิก อส.อำเภอกะพ้อ"], "attributes.killed_security": 1, "attributes.location_text_precision": "road_village",
    },
    reported: ["severity", "casualties", "casualties.killed", "casualties.injured", "actors", "targets", "coordinates", "exact_time"],
  },
  {
    id: "evt_308ded86594f7543368c41a0",
    urls: ["https://opendata.sbpac.go.th/API/relief_01_01.aspx"],
    set: {
      "location.place": "ไม่ทราบสถานที่ภายในตำบลยะรัง อำเภอยะรัง จังหวัดปัตตานี", "location.geo": null, "location.geo_precision": "unknown",
      "event.type": "other", "event.title": "รายการเหตุในตำบลยะรังที่คณะกรรมการสามฝ่ายไม่รับรอง—ไม่มีรายละเอียดเพียงพอ", "event.rawType": "เหตุการณ์ที่คณะกรรมการ 3 ฝ่ายไม่รับรอง",
      "event.summary": "ทะเบียนเปิดของ ศอ.บต. ระบุเพียงวันที่ 24 เมษายน 2569 ตำบลยะรัง อำเภอยะรัง จังหวัดปัตตานี และสถานะไม่รับรอง โดยไม่มีชื่อบุคคล ลักษณะเหตุ ผู้เสียหาย จุดเกิดเหตุย่อย หรือภาพประกอบ จึงเก็บรายการไว้เพื่อรักษาหลักฐานต้นทาง แต่ไม่อนุมานว่าเป็นเหตุรุนแรงชนิดใด",
      severity: 1, verification: "unverifiable", confidence: 35, "attributes.location_text_precision": "subdistrict_only", "attributes.evidence_limit": "ระเบียนต้นทางไม่มีรายละเอียดเหตุ บุคคล ความสูญเสีย หรือภาพประกอบ", "attributes.mechanism": "unknown",
    },
    reported: ["severity", "coordinates"],
  },
  {
    id: "evt_ea7f8897cbb2629673fe3c79",
    urls: ["https://www.southpeace.go.th/?p=168764", "https://www.sbpac.go.th/home/?p=163327", "https://www.sbpac.go.th/home/?p=163329", "https://songkhla.prd.go.th/th/content/category/detail/id/33/iid/498115", "https://opendata.sbpac.go.th/API/relief_01_01.aspx"],
    set: {
      "time.start": new Date("2026-04-24T14:25:00+07:00"), "time.precision": "minute",
      "location.place": "ถนนทางหลวงหมายเลข 42 ฝั่งขาเข้าปัตตานี บ้านปาโฮ๊ะแฮ หมู่ 1 ตำบลบาโลย อำเภอยะหริ่ง จังหวัดปัตตานี", "location.geo": null, "location.geo_precision": "unknown",
      "event.type": "explosion", "event.title": "ลอบวางระเบิดรถนาวิกโยธินบนถนน 42 บ้านปาโฮ๊ะแฮ บาดเจ็บรวม 5 นาย", "event.rawType": "ลอบวางระเบิดแสวงเครื่องโจมตีรถหน่วยเฉพาะกิจนาวิกโยธิน",
      "event.summary": "คนร้ายลอบวางระเบิดแสวงเครื่องโจมตีรถบรรทุกขนาดเล็กของหน่วยเฉพาะกิจนาวิกโยธินบนถนนหมายเลข 42 รถได้รับความเสียหาย จ่าเอกเจนณรงค์ สามารถ อายุ 28 ปี ถูกสะเก็ดบริเวณขมับซ้ายและได้รับการผ่าตัด อีก 4 นายมีอาการแน่นหน้าอกและหูอื้อ รวมผู้บาดเจ็บที่แหล่งติดตามอาการยืนยัน 5 นาย",
      severity: 5, verification: "verified", confidence: 99, casualties: { killed: 0, injured: 5 }, actors: ["ผู้ก่อเหตุไม่ทราบกลุ่มและจำนวน"], targets: ["รถบรรทุกขนาดเล็กและกำลังพลหน่วยเฉพาะกิจนาวิกโยธิน"], "attributes.injured_security": 5, "attributes.location_text_precision": "highway_village", "attributes.casualty_reconciliation": "รายงานแรกระบุบาดเจ็บ 1 นาย; ข่าวเยี่ยมภายหลังยืนยันอีก 4 นาย รวม 5 นาย",
    },
    reported: ["severity", "casualties", "casualties.killed", "casualties.injured", "actors", "targets", "coordinates", "exact_time"],
  },
];

const additions: EventCandidateDoc[] = [
  {
    _id: "evt_verified_20260420_mayo_kraso_cctv_shooting", source_id: SOURCE_ID, raw_record_id: "raw_verified_20260420_mayo_kraso_cctv_shooting",
    time: { start: new Date("2026-04-20T12:00:00+07:00"), precision: "day" },
    location: { province: "ปัตตานี", provinceCode: "pattani", district: "มายอ", subdistrict: "กระเสาะ", place: "หน้าสำนักงานองค์การบริหารส่วนตำบลกระเสาะ หมู่ 2 ตำบลกระเสาะ อำเภอมายอ จังหวัดปัตตานี", geo: null, geo_precision: "unknown" },
    event: { type: "shooting", title: "ยิงทำลายกล้อง CCTV หน้า อบต.กระเสาะ กระจกสำนักงานเสียหาย", rawType: "ใช้อาวุธปืนทำลายระบบเฝ้าระวังของทางราชการ", summary: "คนร้ายไม่ทราบจำนวนใช้อาวุธปืนยิงกล้องวงจรปิดด้านหน้าสำนักงาน อบต.กระเสาะ ทำให้กล้อง 1 ตัวใช้การไม่ได้ กระสุนบางส่วนถูกกระจกหน้าต่างสำนักงานแตก ไม่พบผู้บาดเจ็บ เจ้าหน้าที่ประเมินว่ามุ่งทำลายระบบบันทึกเส้นทางเข้าออกพื้นที่" },
    severity: 3, verification: "verified", confidence: 95, casualties: { killed: 0, injured: 0 }, actors: ["คนร้ายไม่ทราบกลุ่มและจำนวน"], targets: ["กล้อง CCTV และสำนักงาน อบต.กระเสาะ"], corroborating_sources: [SOURCE_ID], media: [],
    attributes: { research_batch: WINDOW_ID, location_address: "หน้าสำนักงาน อบต.กระเสาะ หมู่ 2 ตำบลกระเสาะ อำเภอมายอ จังหวัดปัตตานี", location_text_precision: "government_office_village", source_count: 1, source_url_1: "https://www.isranews.org/article/south-slide/146526-grnangtabb.html", cctv_destroyed: 1, property_damage: "กระจกหน้าต่างสำนักงานแตก" },
    unreported: ["coordinates", "exact_time", "weapon_type", "perpetrator_identity"],
  },
  {
    _id: "evt_verified_20260425_bannangsata_talingchan_security_operation", source_id: SOURCE_ID, raw_record_id: "raw_verified_20260425_bannangsata_talingchan_security_operation",
    time: { start: new Date("2026-04-25T04:30:00+07:00"), precision: "minute" },
    location: { province: "ยะลา", provinceCode: "yala", district: "บันนังสตา", subdistrict: "ตลิ่งชัน", place: "บ้านเลขที่ 263/1 หมู่ 8 ตำบลตลิ่งชัน อำเภอบันนังสตา จังหวัดยะลา", geo: null, geo_precision: "unknown" },
    event: { type: "raid", title: "สนธิกำลังควบคุมผู้ต้องสงสัยคดีระเบิดบันนังสตาที่บ้านเป้าหมายตลิ่งชัน", rawType: "ปฏิบัติการบังคับใช้กฎหมายและควบคุมตัวผู้ต้องสงสัย", summary: "หน่วยปฏิบัติการพิเศษร่วมประจำจังหวัดยะลาและหน่วยงานความมั่นคงเข้าตรวจค้นบ้านเป้าหมาย โดยมีผู้นำท้องที่เป็นพยาน ควบคุมชายอายุ 44 ปีซึ่งหน่วยงานระบุว่าหลักฐานนิติวิทยาศาสตร์เชื่อมโยงเหตุระเบิดทหารพรานวันที่ 20 เมษายน พร้อมตรวจยึดโทรศัพท์มือถือและกรรไกรตัดเหล็ก ก่อนลงบันทึกประจำวันที่ สภ.บันนังสตา ตรวจร่างกายที่โรงพยาบาล และนำเข้าสู่กระบวนการซักถาม" },
    severity: 3, verification: "verified", confidence: 96, casualties: { killed: 0, injured: 0 }, actors: ["หน่วยปฏิบัติการพิเศษร่วมประจำจังหวัดยะลาและหน่วยงานความมั่นคง"], targets: ["ผู้ต้องสงสัยชายอายุ 44 ปี (สงวนนามสกุล)"], corroborating_sources: [SOURCE_ID], media: [],
    attributes: { research_batch: WINDOW_ID, location_address: "บ้านเลขที่ 263/1 หมู่ 8 ตำบลตลิ่งชัน อำเภอบันนังสตา จังหวัดยะลา", location_text_precision: "house_number_village", source_count: 1, source_url_1: "https://www.southpeace.go.th/?p=168827", detained: 1, seized_items: "โทรศัพท์มือถือ; กรรไกรตัดเหล็ก", due_process_reported: true, allegation_status: "ผู้ต้องสงสัย; ยังไม่ใช่คำพิพากษาถึงที่สุด" },
    unreported: ["coordinates"],
  },
  {
    _id: "evt_verified_20260425_bannangsata_cctv_11_sites", source_id: SOURCE_ID, raw_record_id: "raw_verified_20260425_bannangsata_cctv_11_sites",
    time: { start: new Date("2026-04-25T00:57:00+07:00"), precision: "minute" },
    location: { province: "ยะลา", provinceCode: "yala", district: "บันนังสตา", subdistrict: "บันนังสตา", place: "11 จุดในตำบลบันนังสตา: หน้าโรงเรียนเตาปูน, ปั๊มเงาะกาโป, บ้านพงยามู, ทางเข้าและสามแยกบ้านบันนังกูแว, แยกโรงเรียนคัมภีร์, โรงเรียนบ้านบันนังกูแว, บ้านเยาะ, กล้องยุทธวิธี 4077 ทางเข้า บ้านบันนังกูแว และบ้านบาโงยตือเงาะ อำเภอบันนังสตา จังหวัดยะลา", geo: null, geo_precision: "unknown" },
    event: { type: "unrest", title: "กลุ่มคนร้ายทำลาย CCTV 17 ตัวพร้อมกัน 11 จุดในบันนังสตา", rawType: "ปฏิบัติการทำลายระบบกล้องวงจรปิดหลายจุด", summary: "ช่วง 00.57-01.19 น. คนร้ายซึ่งบางจุดแต่งชุดดำปิดบังใบหน้าและบางจุดแต่งคล้ายเจ้าหน้าที่ อส. เข้าทำลายกล้อง CCTV พร้อมกัน 11 จุด กล้อง 4G/WIFI เสียหาย 13 ตัวและกล้องยุทธวิธี 4 ตัว รวม 17 ตัว ไม่มีผู้บาดเจ็บหรือเสียชีวิต เจ้าหน้าที่เชื่อว่าเป็นการปิดระบบเฝ้าระวังก่อนเตรียมก่อเหตุอื่น" },
    severity: 4, verification: "verified", confidence: 96, casualties: { killed: 0, injured: 0 }, actors: ["กลุ่มคนร้ายหลายชุด ปิดบังใบหน้า บางรายแต่งคล้ายเจ้าหน้าที่ อส."], targets: ["กล้อง CCTV ของทางราชการ 17 ตัวใน 11 จุด"], corroborating_sources: [SOURCE_ID], media: [],
    attributes: { research_batch: WINDOW_ID, location_address: "11 จุดในหมู่ 3 หมู่ 4 และหมู่ 9 ตำบลบันนังสตา อำเภอบันนังสตา จังหวัดยะลา", location_text_precision: "multi_site_landmarks_villages", source_count: 2, source_url_1: "https://www.naewna.com/local/960811", source_url_2: "https://thainews.prd.go.th/regionnews/news/view/1979149/?bid=1", coordinated_sites: 11, cctv_destroyed: 17, cctv_4g_wifi_destroyed: 13, tactical_cctv_destroyed: 4, event_end_time: "2026-04-25T01:19:00+07:00" },
    unreported: ["coordinates", "perpetrator_identity", "damage_value"],
  },
];

function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

async function main(): Promise<void> {
  const client = await new MongoClient(process.env.MONGODB_URI ?? DEFAULT_URI, { serverSelectionTimeoutMS: 5_000 }).connect();
  const startedAt = new Date();
  const runId = `run_verified_20260419_25_${startedAt.toISOString().replace(/\D/g, "").slice(0, 14)}_${randomUUID().slice(0, 8)}`;
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
    // Keep the materialized candidate within the scalar attribute schema even if
    // this script previously inserted the seized-item list as an array.
    await db.collection<EventCandidateDoc>("event_candidates").updateOne(
      { _id: "evt_verified_20260425_bannangsata_talingchan_security_operation" },
      { $set: { "attributes.seized_items": "โทรศัพท์มือถือ; กรรไกรตัดเหล็ก" } },
    );
    await db.collection<IngestionRunDoc>("ingestion_runs").updateOne({ _id: runId }, { $set: { finished_at: new Date(), status: "success", records: counts } });
    console.log(JSON.stringify({ runId, window: WINDOW_ID, counts }, null, 2));
  } catch (error) {
    await db.collection<IngestionRunDoc>("ingestion_runs").updateOne({ _id: runId }, { $set: { finished_at: new Date(), status: "failed", error: error instanceof Error ? error.message : String(error), records: { ...counts, failed: 1 } } });
    throw error;
  } finally { await client.close(); }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
