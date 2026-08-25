/** Audit, enrich, and add southern security incidents for 22-28 Mar 2026. */
import { createHash, randomUUID } from "node:crypto";
import { MongoClient } from "mongodb";
import type { EventCandidateDoc, IngestionRunDoc, RawRecordDoc, SourceRegistryDoc } from "../src/lib/types";

const SOURCE_ID = "src_manual_research";
const WINDOW_ID = "verified-window-2026-03-22-to-28";
const OFFICIAL_OP_URL = "https://www.southpeace.go.th/?p=165252";
const DEFAULT_URI = "mongodb://root:changeme@localhost:27017/palantir_th?authSource=admin";

const additions: EventCandidateDoc[] = [
  {
    _id: "evt_verified_20260323_rangae_checkpoint_arrest", source_id: SOURCE_ID, raw_record_id: "raw_verified_20260323_rangae_checkpoint_arrest",
    time: { start: new Date("2026-03-23T20:08:00+07:00"), precision: "minute" },
    location: { province: "นราธิวาส", provinceCode: "narathiwat", district: "ระแงะ", subdistrict: "ตันหยงมัส", place: "จุดตรวจ/จุดสกัดชั่วคราวหน้าสำนักงานประมงอำเภอระแงะ หมู่ 1 ตำบลตันหยงมัส อำเภอระแงะ จังหวัดนราธิวาส", geo: null, geo_precision: "unknown" },
    event: { type: "raid", title: "จุดตรวจตันหยงมัสควบคุมผู้ต้องหาตามหมายจับคดีระเบิดปั๊ม ปตท.", rawType: "ควบคุมตัวตามหมายจับที่จุดตรวจ", summary: "ฉก.ทพ.45 และกำลัง 3 ฝ่ายตั้งจุดตรวจชั่วคราวหน้าสำนักงานประมงอำเภอระแงะ เรียกตรวจรถจักรยานยนต์ฮอนด้าเวฟ 125 ไอ ซึ่งมีชาย 2 คน จากนั้นตรวจพบว่าผู้โดยสารเป็นผู้ต้องหาตามหมายจับ ป.วิอาญา 149/2569 ซึ่งหน่วยงานระบุว่าเชื่อมโยงเหตุระเบิดปั๊ม ปตท.ตันหยงมัส 11 มกราคม เจ้าหน้าที่นำทั้งสองไปตรวจสอบเบื้องต้น ก่อนลงบันทึกที่ สภ.ระแงะ ตรวจร่างกายที่โรงพยาบาลระแงะ และส่งผู้ต้องหาตามหมายไปศูนย์ซักถาม ฉก.ทพ.46 ข้อกล่าวหายังต้องผ่านกระบวนการยุติธรรม" },
    severity: 2, verification: "verified", confidence: 98, casualties: { killed: 0, injured: 0 }, actors: ["ฉก.ทพ.45 และกำลังบูรณาการ 3 ฝ่าย"], targets: ["ผู้ต้องหาตามหมายจับ 149/2569", "ผู้ขับขี่ที่ถูกเชิญไปตรวจสอบเบื้องต้น"], corroborating_sources: [SOURCE_ID], media: [],
    attributes: { research_batch: WINDOW_ID, location_address: "หน้าสำนักงานประมงอำเภอระแงะ หมู่ 1 ตำบลตันหยงมัส อำเภอระแงะ จังหวัดนราธิวาส", location_text_precision: "named_office_checkpoint_village", source_count: 1, source_url_1: OFFICIAL_OP_URL, people_stopped: 2, warrant_arrests: 1, warrant_number: "149/2569 ลงวันที่ 10 มีนาคม 2569", due_process_status: "ลงบันทึก สภ.ระแงะ ตรวจร่างกาย รพ.ระแงะ และส่งศูนย์ซักถามตามรายงาน", allegation_status: "ข้อกล่าวหาของหน่วยงานรัฐ; ต้องผ่านกระบวนการยุติธรรม" },
    unreported: ["coordinates"],
  },
  {
    _id: "evt_verified_20260324_yupo_security_operation", source_id: SOURCE_ID, raw_record_id: "raw_verified_20260324_yupo_security_operation",
    time: { start: new Date("2026-03-24T06:00:00+07:00"), precision: "minute" },
    location: { province: "ยะลา", provinceCode: "yala", district: "เมืองยะลา", subdistrict: "ยุโป", place: "บ้านเป้าหมายในพื้นที่หมู่ 6 ตำบลยุโป อำเภอเมืองยะลา จังหวัดยะลา (แหล่งข่าวไม่เปิดเผยเลขที่บ้านจุดปฏิบัติการ)", geo: null, geo_precision: "unknown" },
    event: { type: "raid", title: "ปฏิบัติการบังคับใช้กฎหมายตำบลยุโป ควบคุม 3 รายและเชิญเจ้าของบ้าน 1 ราย", rawType: "ปิดล้อมตรวจค้นและควบคุมตัวในคดีความมั่นคง", summary: "เจ้าหน้าที่เข้าบังคับใช้กฎหมายในพื้นที่เป้าหมายตำบลยุโป ควบคุมบุคคล 3 รายและเชิญเจ้าของบ้าน 1 รายเข้าสู่กระบวนการซักถาม หน่วยงานระบุว่าบางรายมีหมายจับหรือถูกสงสัยว่าเชื่อมโยงคดีความมั่นคงหลายคดี พร้อมตรวจยึดปืนพก 2 กระบอก ซองกระสุน 4 ซอง กระสุนจำนวนหนึ่ง โทรศัพท์ 2 เครื่อง และพ็อกเก็ตไวไฟที่ถูกทำลาย 2 ชิ้น นำผู้ถูกควบคุมทั้ง 4 ไปลงบันทึกที่ สภ.ตาเซะและตรวจร่างกายที่โรงพยาบาลยะลาสิริรัตนรักษ์ การระบุบทบาทและความเชื่อมโยงเป็นข้อมูลจากหน่วยงานรัฐและยังต้องผ่านกระบวนการพิสูจน์" },
    severity: 3, verification: "verified", confidence: 97, casualties: { killed: 0, injured: 0 }, actors: ["เจ้าหน้าที่บังคับใช้กฎหมายในพื้นที่จังหวัดยะลา"], targets: ["ผู้ถูกควบคุม 3 รายและเจ้าของบ้านที่ถูกเชิญตัว 1 ราย"], corroborating_sources: [SOURCE_ID], media: [],
    attributes: { research_batch: WINDOW_ID, location_address: "พื้นที่หมู่ 6 ตำบลยุโป อำเภอเมืองยะลา จังหวัดยะลา; ไม่เปิดเผยเลขที่บ้านจุดปฏิบัติการ", location_text_precision: "village_operation_exact_house_undisclosed", source_count: 1, source_url_1: OFFICIAL_OP_URL, detained_people: 3, invited_house_owner: 1, handguns_seized: 2, magazines_seized: 4, phones_seized: 2, damaged_pocket_wifi_seized: 2, due_process_status: "ลงบันทึก สภ.ตาเซะ ตรวจร่างกาย รพ.ยะลาสิริรัตนรักษ์ และส่งศูนย์ซักถามตามรายงาน", allegation_status: "ข้อกล่าวหาและข้อสงสัยของหน่วยงานรัฐ; ต้องผ่านกระบวนการยุติธรรม" },
    unreported: ["coordinates", "exact_house_number", "ammunition_count"],
  },
];

const update = {
  id: "evt_6e8762a01772833fb7e9b252",
  urls: ["https://www.southpeace.go.th/?p=165411", "https://www.southpeace.go.th/?p=165863", "https://www.sbpac.go.th/home/?p=161853", "https://www.dailynews.co.th/news/5719270/", "https://www.tnews.co.th/social/social-news/647013", "https://opendata.sbpac.go.th/API/relief_01_01.aspx"],
  set: {
    "time.start": new Date("2026-03-24T20:51:00+07:00"), "time.precision": "minute",
    "location.place": "หน้าบ้านพักเลขที่ 34/9 บ้านโผลง หมู่ 5 ตำบลโต๊ะเด็ง อำเภอสุไหงปาดี จังหวัดนราธิวาส", "location.geo": null, "location.geo_precision": "unknown",
    "event.type": "shooting", "event.title": "สองคนร้ายชุดดำยิงอาสาสมัครทหารพรานเสียชีวิตหน้าบ้านเพื่อนที่บ้านโผลง", "event.rawType": "ลอบยิงเจ้าหน้าที่ระหว่างลาพัก",
    "event.summary": "คนร้าย 2 คนแต่งกายชุดดำใช้อาวุธปืนสงครามยิง อส.ทพ.ดรุณ ดารอเฮง อายุ 40 ปี สังกัด ร้อย ทพ.4813 ฉก.ทพ.48 ขณะอยู่หน้าบ้านพักเลขที่ 34/9 ซึ่งเป็นบ้านเพื่อนในบ้านโผลง ผู้เสียชีวิตลากลับมาพักกับครอบครัวได้ 2 วัน ที่เกิดเหตุพบปลอกกระสุน AK-47 มากกว่า 20 ปลอก ผู้ก่อเหตุหลบหนีไปทางเทือกเขาหลังหมู่บ้าน เจ้าหน้าที่เชื่อว่าเป็นกลุ่มเดียวกับเหตุยิงก่อกวนจุดตรวจฉัตรวารินวันที่ 19 มีนาคม แต่ข้อสรุปผู้ก่อเหตุยังอยู่ในกระบวนการสืบสวน",
    severity: 5, verification: "verified", confidence: 99, casualties: { killed: 1, injured: 0 }, actors: ["คนร้าย 2 คนแต่งกายชุดดำ"], targets: ["อส.ทพ.ดรุณ ดารอเฮง อายุ 40 ปี ร้อย ทพ.4813"],
    "attributes.weapon_reported": "ปืนเล็กยาว AK-47", "attributes.spent_cartridges_reported_min": 20, "attributes.duty_status": "ลาพักกลับบ้าน 2 วัน", "attributes.escape_direction": "เทือกเขาหลังหมู่บ้าน", "attributes.location_text_precision": "house_number_village", "attributes.suspected_link": "ฝ่ายความมั่นคงคาดว่าอาจเป็นกลุ่มเดียวกับเหตุยิงจุดตรวจฉัตรวาริน 19 มีนาคม 2569",
  },
  reported: ["severity", "casualties", "casualties.killed", "casualties.injured", "actors", "targets", "exact_time"],
};

function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

async function main(): Promise<void> {
  const client = await new MongoClient(process.env.MONGODB_URI ?? DEFAULT_URI).connect();
  const db = client.db(process.env.MONGODB_DB ?? "palantir_th");
  const startedAt = new Date();
  const runId = `run_verified_20260322_28_${startedAt.toISOString().replace(/\D/g, "").slice(0, 14)}_${randomUUID().slice(0, 8)}`;
  const counts = { downloaded: 3, new: 0, updated: 0, duplicate: 0, failed: 0 };
  try {
    await db.collection<SourceRegistryDoc>("source_registry").updateOne({ _id: SOURCE_ID }, { $setOnInsert: { _id: SOURCE_ID, name: "Palantir TH manual research ledger", shortName: "Manual research", category: "research", priority: "P3", role: "Manually corroborated event enrichment", connector: { type: "FORM" }, schedule: { mode: "snapshot", frequency: "manual" }, trust: { class: "manual_entry", score: 60 }, enabled: true } }, { upsert: true });
    await db.collection<IngestionRunDoc>("ingestion_runs").insertOne({ _id: runId, source_id: SOURCE_ID, started_at: startedAt, finished_at: null, status: "running", records: counts });
    const enrichmentPayload = { record_type: "manual_research_enrichment", window_id: WINDOW_ID, candidate_id: update.id, sources: update.urls, normalized_update: update.set };
    const enrichmentRawId = `raw_manual_enrichment_${WINDOW_ID}_${update.id}`;
    await db.collection<RawRecordDoc>("raw_records").updateOne({ _id: enrichmentRawId }, { $setOnInsert: { _id: enrichmentRawId, source_id: SOURCE_ID, external_id: `${WINDOW_ID}-enrichment-${update.id}`, retrieved_at: startedAt, source: { url: update.urls[0] }, dataset: { name: "Palantir TH verified event window", version: WINDOW_ID }, raw: enrichmentPayload, integrity: { content_hash: `sha256:${hash(enrichmentPayload)}`, algorithm: "sha256" }, processing: { status: "normalized" }, ingestion_run_id: runId } }, { upsert: true });
    const sourceAttrs = Object.fromEntries(update.urls.map((url, index) => [`attributes.source_url_${index + 1}`, url]));
    const result = await db.collection<EventCandidateDoc>("event_candidates").updateOne({ _id: update.id }, { $set: { ...update.set, ...sourceAttrs, "attributes.research_batch": WINDOW_ID, "attributes.enrichment_raw_record_id": enrichmentRawId, "attributes.location_address": update.set["location.place"], "attributes.source_count": update.urls.length } as never, $addToSet: { corroborating_sources: SOURCE_ID }, $pull: { unreported: { $in: update.reported } } });
    if (!result.matchedCount) throw new Error(`Existing candidate ${update.id} not found`);
    result.modifiedCount ? counts.updated++ : counts.duplicate++;
    for (const item of additions) {
      const urls = Object.entries(item.attributes).filter(([key]) => key.startsWith("source_url_")).map(([, value]) => String(value));
      const payload = { record_type: "manual_research_claim", window_id: WINDOW_ID, candidate: item, sources: urls };
      await db.collection<RawRecordDoc>("raw_records").updateOne({ _id: item.raw_record_id }, { $setOnInsert: { _id: item.raw_record_id, source_id: SOURCE_ID, external_id: `${WINDOW_ID}-${item._id}`, retrieved_at: startedAt, source: { url: urls[0] }, dataset: { name: "Palantir TH verified event window", version: WINDOW_ID }, raw: payload, integrity: { content_hash: `sha256:${hash(payload)}`, algorithm: "sha256" }, processing: { status: "normalized" }, ingestion_run_id: runId } }, { upsert: true });
      const inserted = await db.collection<EventCandidateDoc>("event_candidates").updateOne({ _id: item._id }, { $setOnInsert: item }, { upsert: true });
      inserted.upsertedCount ? counts.new++ : counts.duplicate++;
    }
    await db.collection<IngestionRunDoc>("ingestion_runs").updateOne({ _id: runId }, { $set: { finished_at: new Date(), status: "success", records: counts } });
    console.log(JSON.stringify({ runId, window: WINDOW_ID, counts }, null, 2));
  } catch (error) {
    counts.failed++;
    await db.collection<IngestionRunDoc>("ingestion_runs").updateOne({ _id: runId }, { $set: { finished_at: new Date(), status: "failed", error: error instanceof Error ? error.message : String(error), records: counts } });
    throw error;
  } finally { await client.close(); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
