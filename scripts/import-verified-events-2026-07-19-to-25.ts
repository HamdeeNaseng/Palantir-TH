/** Import and reconcile verified southern security incidents for 19-25 Jul 2026. */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MongoClient } from "mongodb";
import type { EventCandidateDoc, EventType, IngestionRunDoc, RawRecordDoc, SourceRegistryDoc } from "../src/lib/types";

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
const WINDOW_ID = "verified-window-2026-07-19-to-25";
const DEFAULT_URI = "mongodb://root:changeme@localhost:27017/palantir_th?authSource=admin";

interface VerifiedEvent {
  id: string;
  at: string;
  precision: "minute" | "hour" | "day";
  province: string;
  provinceCode: "pattani" | "yala" | "narathiwat";
  district: string;
  subdistrict: string;
  place: string;
  locationPrecision: "site" | "village" | "subdistrict";
  geo?: { type: "Point"; coordinates: [number, number] };
  geoPrecision?: "address" | "village" | "subdistrict";
  type: EventType;
  title: string;
  rawType: string;
  summary: string;
  severity: 1 | 2 | 3 | 4 | 5;
  killed: number;
  injured: number;
  actors: string[];
  targets: string[];
  urls: string[];
  attributes: Record<string, string | number | boolean | null>;
  unreported: string[];
}

const newEvents: VerifiedEvent[] = [
  {
    id: "evt_verified_20260723_tano_pute_orchard_shooting",
    at: "2026-07-23T23:57:00+07:00", precision: "minute",
    province: "ยะลา", provinceCode: "yala", district: "บันนังสตา", subdistrict: "ตาเนาะปูเต๊ะ",
    place: "สวนทุเรียน บ้านนิคมซอยเหมือง หมู่ 7 ตำบลตาเนาะปูเต๊ะ อำเภอบันนังสตา จังหวัดยะลา", locationPrecision: "village",
    type: "shooting", title: "ยิงประชาชนในสวนทุเรียนบ้านนิคมซอยเหมือง", rawType: "ลอบยิงประชาชน",
    summary: "คนร้ายไม่ทราบกลุ่มและจำนวนยิงนายฮัมดี สีฮี อายุ 35 ปี ขณะดูแลสวนทุเรียน กระสุนถูกลำตัวและข้อมือซ้ายรวม 3 นัด พลเมืองดีนำส่งโรงพยาบาลบันนังสตา ตำรวจยังไม่สรุปสาเหตุ",
    severity: 4, killed: 0, injured: 1, actors: ["คนร้ายไม่ทราบกลุ่มและจำนวน"], targets: ["ประชาชนในสวนทุเรียน"],
    urls: ["https://www.isranews.org/article/south-news/other-news/148160-huntinginsurgents.html"],
    attributes: { victim_name: "ฮัมดี สีฮี", victim_age: 35, gunshot_wounds_reported: 3, motive_status: "อยู่ระหว่างการสอบสวน" },
    unreported: ["coordinates", "weapon_type", "perpetrator_identity", "perpetrator_count"],
  },
  {
    id: "evt_verified_20260723_don_sai_village_post_shooting",
    at: "2026-07-23T22:00:00+07:00", precision: "minute",
    province: "ปัตตานี", provinceCode: "pattani", district: "ไม้แก่น", subdistrict: "ดอนทราย",
    place: "ป้อมชุดรักษาความปลอดภัยหมู่บ้าน บ้านดอนทราย หมู่ 4 ตำบลดอนทราย อำเภอไม้แก่น จังหวัดปัตตานี", locationPrecision: "site",
    type: "shooting", title: "ลอบยิงป้อม ชรบ.บ้านดอนทราย", rawType: "ยิงโจมตีป้อมชุดรักษาความปลอดภัยหมู่บ้าน",
    summary: "คนร้ายไม่ทราบกลุ่มและจำนวนยิงใส่ป้อม ชรบ. ขณะผู้ช่วยผู้ใหญ่บ้านและ ชรบ.อีก 3 คนเข้าเวร กระสุนถูกผู้ช่วยผู้ใหญ่บ้านบริเวณหัวไหล่ 1 นัด เจ้าหน้าที่สันนิษฐานเบื้องต้นว่าเกี่ยวข้องกับความไม่สงบ",
    severity: 4, killed: 0, injured: 1, actors: ["คนร้ายไม่ทราบกลุ่มและจำนวน"], targets: ["ป้อม ชรบ.บ้านดอนทราย", "ผู้ช่วยผู้ใหญ่บ้านและ ชรบ."],
    urls: ["https://www.isranews.org/article/south-news/other-news/148160-huntinginsurgents.html"],
    attributes: { injured_role: "ผู้ช่วยผู้ใหญ่บ้าน", guards_on_duty: 4, motive_assessment: "เจ้าหน้าที่สันนิษฐานว่าเป็นการก่อความไม่สงบ" },
    unreported: ["coordinates", "weapon_type", "perpetrator_identity", "perpetrator_count"],
  },
  {
    id: "evt_verified_20260725_to_rayo_fatal_shooting",
    at: "2026-07-25T06:50:00+07:00", precision: "minute",
    province: "ยะลา", provinceCode: "yala", district: "บันนังสตา", subdistrict: "ตลิ่งชัน",
    place: "บ้านโต๊ะรายอ หมู่ 10 ตำบลตลิ่งชัน อำเภอบันนังสตา จังหวัดยะลา", locationPrecision: "village",
    type: "shooting", title: "พบประชาชนถูกยิงเสียชีวิตที่บ้านโต๊ะรายอ", rawType: "ยิงประชาชนเสียชีวิต",
    summary: "หน่วยกู้ภัยตลิ่งชันแจ้งพบชายอายุ 31 ปีถูกยิงด้วยอาวุธปืนไม่ทราบชนิดและขนาดเสียชีวิตในพื้นที่บ้านโต๊ะรายอ ตำรวจยังไม่สรุปสาเหตุหรือผู้ก่อเหตุ",
    severity: 5, killed: 1, injured: 0, actors: ["ผู้ก่อเหตุไม่ทราบชื่อ"], targets: ["ประชาชนชายอายุ 31 ปี"],
    urls: ["https://www.isranews.org/article/south-news/other-news/148160-huntinginsurgents.html"],
    attributes: { victim_name: "กูบาฮา หนิมะ", victim_age: 31, motive_status: "อยู่ระหว่างการสอบสวน" },
    unreported: ["coordinates", "weapon_type", "perpetrator_identity", "perpetrator_count"],
  },
  {
    id: "evt_verified_20260725_nam_dam_police_shooting",
    at: "2026-07-25T23:45:00+07:00", precision: "minute",
    province: "ปัตตานี", provinceCode: "pattani", district: "ทุ่งยางแดง", subdistrict: "น้ำดำ",
    place: "บริเวณพรุน้ำดำ หมู่ 4 ตำบลน้ำดำ อำเภอทุ่งยางแดง จังหวัดปัตตานี", locationPrecision: "village",
    type: "shooting", title: "ลอบยิงตำรวจขณะกลับจากหาปลาที่พรุน้ำดำ", rawType: "ลอบยิงเจ้าหน้าที่ตำรวจนอกเวลาราชการ",
    summary: "คนร้ายซุ่มยิง ด.ต.จักรพงศ์ โรสันตา สังกัด สภ.โกตาบารู ขณะเก็บอุปกรณ์หลังกลับจากหาปลากับครอบครัว กระสุนถูกโคนต้นขาซ้าย 1 นัดและทำให้กระดูกต้นขาแตก ผู้บาดเจ็บพ้นขีดอันตราย เหตุเกิดคืนวันที่ 25 กรกฎาคมตามรายงานร่วมสมัยและ ศอ.บต.",
    severity: 4, killed: 0, injured: 1, actors: ["คนร้ายซุ่มอยู่ในป่า"], targets: ["เจ้าหน้าที่ตำรวจ สภ.โกตาบารู"],
    urls: ["https://www.thaipost.net/district-news/1038985/", "https://www.sbpac.go.th/home/?p=171425", "https://www.isranews.org/article/south-news/other-news/148160-huntinginsurgents.html"],
    attributes: { victim_name: "ด.ต.จักรพงศ์ โรสันตา", victim_age: 38, injury: "โคนต้นขาซ้าย กระดูกต้นขาแตก", date_source_conflict: true, alternate_reported_date: "2026-07-26", date_resolution: "ใช้ 25 ก.ค. ตามรายงานร่วมสมัยและ ศอ.บต.; อิศราระบุ 26 ก.ค." },
    unreported: ["coordinates", "weapon_type", "perpetrator_identity", "perpetrator_count"],
  },
];

const existingUpdates = [
  {
    id: "evt_a418a8985e589c88c95ad207",
    urls: ["https://www.dailynews.co.th/news/6046271/", "https://www.thairath.co.th/news/crime/2947864"],
    set: {
      "time.start": new Date("2026-07-21T19:20:00+07:00"), "time.precision": "minute",
      "location.district": "เมืองนราธิวาส", "location.subdistrict": "กะลุวอเหนือ", "location.place": "สถานีตำรวจภูธรตันหยง (หลังเก่า) ปากทางเข้าพระตำหนักทักษิณราชนิเวศน์ หมู่ 4 ตำบลกะลุวอเหนือ อำเภอเมืองนราธิวาส จังหวัดนราธิวาส",
      "location.geo": null, "location.geo_precision": "unknown", "event.type": "explosion", "event.title": "คาร์บอมบ์หน้า สภ.ตันหยง (หลังเก่า)", "event.rawType": "คาร์บอมบ์สถานที่ราชการ",
      "event.summary": "คนร้ายนำรถเก๋งโตโยต้า โซลูน่า จอดหน้า สภ.ตันหยงหลังเก่า ก่อนหลบหนีด้วยรถจักรยานยนต์และเกิดระเบิด ทำให้กำแพงรั้ว อาคาร รถเก๋ง และรถกระบะเสียหาย แต่ไม่มีผู้เสียชีวิตหรือบาดเจ็บ",
      severity: 4, verification: "verified", confidence: 96, casualties: { killed: 0, injured: 0 }, actors: ["คนร้ายอย่างน้อย 2 คน"], targets: ["สถานีตำรวจภูธรตันหยง (หลังเก่า)"],
    },
  },
  {
    id: "evt_1ae7763df1878643a8fb31de",
    urls: ["https://www.southpeace.go.th/?p=179971", "https://www.thairath.co.th/scoop/interview/2948476", "https://theactive.thaipbs.or.th/news/politics-20260731"],
    set: {
      "time.start": new Date("2026-07-22T18:45:00+07:00"), "time.precision": "minute",
      "location.district": "ระแงะ", "location.subdistrict": "ตันหยงมัส", "location.place": "จุดตรวจบูเก๊ะซามี (จุดตรวจเทศบาลตำบลตันหยงมัส) หมู่ 7 ตำบลตันหยงมัส อำเภอระแงะ จังหวัดนราธิวาส",
      "event.type": "shooting", "event.title": "ยิงและขว้างไปป์บอมบ์โจมตีจุดตรวจบูเก๊ะซามี", "event.rawType": "โจมตีจุดตรวจด้วยอาวุธปืนและระเบิด",
      "event.summary": "กลุ่มคนร้าย 9 คนใช้อาวุธปืนยิงและขว้างไปป์บอมบ์โจมตีจุดตรวจบูเก๊ะซามี ทำให้ทหารพรานเสียชีวิต 5 นาย ชาวบ้านบาดเจ็บ 6 ราย บ้านเรือนเสียหาย และมีรายงานว่าอาวุธปืนของเจ้าหน้าที่ถูกนำไป 5 กระบอก",
      severity: 5, verification: "verified", confidence: 99, casualties: { killed: 5, injured: 6 }, actors: ["กลุ่มคนร้าย 9 คน", "Patani insurgents"], targets: ["ทหารพรานประจำจุดตรวจบูเก๊ะซามี", "ประชาชนและบ้านเรือนใกล้จุดตรวจ"],
    },
  },
  {
    id: "evt_a970c981e608280e645e9fdc",
    urls: ["https://www.isranews.org/article/south-news/other-news/148160-huntinginsurgents.html", "https://www.amarintv.com/news/crime/552731"],
    set: {
      "time.start": new Date("2026-07-23T11:57:00+07:00"), "time.precision": "minute",
      "location.place": "โครงการขยายถนนบริเวณบ้านตาแลแป (บางแหล่งสะกด ดาแลแป) หมู่ 6 ตำบลเขื่อนบางลาง อำเภอบันนังสตา จังหวัดยะลา", "location.geo": null, "location.geo_precision": "unknown",
      "event.type": "shooting", "event.title": "ยิงหัวหน้าคุมงานขยายถนนบ้านตาแลแปเสียชีวิต", "event.rawType": "ยิงประชาชนระหว่างปฏิบัติงาน",
      "event.summary": "คนร้าย 2 คนปิดบังใบหน้าใช้รถจักรยานยนต์ประกบยิงหัวหน้าคุมงานก่อสร้างขณะทำงานใกล้รถแบ็กโฮ เสียชีวิตในที่เกิดเหตุ พบปลอกกระสุน 5.56 มม. 4 ปลอกและ AK-47 3 ปลอก ตำรวจยังตรวจทั้งประเด็นความไม่สงบและความขัดแย้งส่วนตัว",
      severity: 5, verification: "verified", confidence: 96, casualties: { killed: 1, injured: 0 }, actors: ["คนร้าย 2 คนปิดบังใบหน้า"], targets: ["หัวหน้าคุมงานโครงการขยายถนน"],
    },
  },
];

const superseded = [
  { id: "evt_e9a61fb9ef052dfea18d2212", by: "evt_1ae7763df1878643a8fb31de", reason: "ระเบียน ศอ.บต. และ UCDP อ้างถึงเหตุโจมตีจุดตรวจบูเก๊ะซามีเดียวกัน" },
  { id: "evt_e449b09348006939616eae13", by: "evt_a970c981e608280e645e9fdc", reason: "ระเบียน UCDP ระดับอำเภอและ ศอ.บต. อ้างถึงเหตุยิงหัวหน้าคุมงานบ้านตาแลแปเดียวกัน" },
] as const;

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function main(): Promise<void> {
  const client = await new MongoClient(process.env.MONGODB_URI ?? DEFAULT_URI, { serverSelectionTimeoutMS: 5_000 }).connect();
  const startedAt = new Date();
  const runId = `run_verified_20260719_25_${startedAt.toISOString().replace(/\D/g, "").slice(0, 14)}_${randomUUID().slice(0, 8)}`;
  const counts = { downloaded: 7, new: 0, updated: 0, duplicate: 0, failed: 0 };
  try {
    const db = client.db(process.env.MONGODB_DB ?? "palantir_th");
    const source: SourceRegistryDoc = { _id: SOURCE_ID, name: "Palantir TH manual research ledger", shortName: "Manual research", category: "research", priority: "P3", role: "Manually corroborated event enrichment", connector: { type: "FORM" }, schedule: { mode: "snapshot", frequency: "manual" }, trust: { class: "manual_entry", score: 60 }, enabled: true };
    await db.collection<SourceRegistryDoc>("source_registry").updateOne({ _id: SOURCE_ID }, { $setOnInsert: source }, { upsert: true });
    const run: IngestionRunDoc = { _id: runId, source_id: SOURCE_ID, started_at: startedAt, finished_at: null, status: "running", records: counts };
    await db.collection<IngestionRunDoc>("ingestion_runs").insertOne(run);

    for (const item of existingUpdates) {
      const payload = { record_type: "manual_research_enrichment", window_id: WINDOW_ID, candidate_id: item.id, sources: item.urls, normalized_update: item.set };
      const digest = hash(payload);
      const rawId = `raw_manual_enrichment_${WINDOW_ID}_${item.id}`;
      const raw: RawRecordDoc = { _id: rawId, source_id: SOURCE_ID, external_id: `${WINDOW_ID}-enrichment-${item.id}`, retrieved_at: startedAt, source: { url: item.urls[0] }, dataset: { name: "Palantir TH verified event window", version: WINDOW_ID }, raw: payload, integrity: { content_hash: `sha256:${digest}`, algorithm: "sha256" }, processing: { status: "normalized" }, ingestion_run_id: runId };
      await db.collection<RawRecordDoc>("raw_records").updateOne({ _id: rawId }, { $setOnInsert: raw }, { upsert: true });
      const set = { ...item.set, "attributes.research_batch": WINDOW_ID, "attributes.enrichment_raw_record_id": rawId, "attributes.location_address": item.set["location.place"], "attributes.source_count": item.urls.length, "attributes.source_url_1": item.urls[0], "attributes.source_url_2": item.urls[1] ?? null, "attributes.source_url_3": item.urls[2] ?? null };
      const result = await db.collection<EventCandidateDoc>("event_candidates").updateOne({ _id: item.id }, { $set: set as never, $addToSet: { corroborating_sources: SOURCE_ID }, $pull: { unreported: { $in: ["severity", "casualties", "casualties.killed", "casualties.injured", "actors", "targets", "exact_time"] } } });
      if (!result.matchedCount) throw new Error(`Existing candidate ${item.id} was not found`);
      result.modifiedCount ? counts.updated++ : counts.duplicate++;
    }

    for (const item of superseded) {
      const result = await db.collection<EventCandidateDoc>("event_candidates").updateOne({ _id: item.id }, { $set: { "attributes.superseded_by": item.by, "attributes.superseded_reason": item.reason, "attributes.reconciled_in_batch": WINDOW_ID } });
      if (!result.matchedCount) throw new Error(`Duplicate candidate ${item.id} was not found`);
      result.modifiedCount ? counts.updated++ : counts.duplicate++;
    }

    for (const event of newEvents) {
      const payload = { record_type: "manual_research_claim", window_id: WINDOW_ID, observed_event: event, caveat: "ยืนยันการเกิดเหตุจากรายงานที่อ้างอิง แต่ข้อกล่าวหา ตัวผู้ก่อเหตุ และแรงจูงใจที่ยังไม่สรุปให้คงสถานะตามแหล่งข่าว" };
      const digest = hash(payload);
      const rawId = `raw_${event.id.replace(/^evt_/, "")}`;
      const raw: RawRecordDoc = { _id: rawId, source_id: SOURCE_ID, external_id: `${WINDOW_ID}-${event.id}`, retrieved_at: startedAt, source: { url: event.urls[0] }, dataset: { name: "Palantir TH verified event window", version: WINDOW_ID }, raw: payload, integrity: { content_hash: `sha256:${digest}`, algorithm: "sha256" }, processing: { status: "normalized" }, ingestion_run_id: runId };
      await db.collection<RawRecordDoc>("raw_records").updateOne({ _id: rawId }, { $setOnInsert: raw }, { upsert: true });
      const candidate: EventCandidateDoc = { _id: event.id, source_id: SOURCE_ID, raw_record_id: rawId, time: { start: new Date(event.at), precision: event.precision }, location: { province: event.province, provinceCode: event.provinceCode, district: event.district, subdistrict: event.subdistrict, place: event.place, geo: event.geo ?? null, geo_precision: event.geoPrecision ?? "unknown" }, event: { type: event.type, title: event.title, summary: event.summary, rawType: event.rawType }, severity: event.severity, verification: "verified", confidence: event.urls.length > 1 ? 95 : 90, casualties: { killed: event.killed, injured: event.injured }, actors: event.actors, targets: event.targets, corroborating_sources: [SOURCE_ID], media: [], attributes: { research_batch: WINDOW_ID, location_address: event.place, location_text_precision: event.locationPrecision, source_count: event.urls.length, source_url_1: event.urls[0], source_url_2: event.urls[1] ?? null, source_url_3: event.urls[2] ?? null, ...event.attributes }, unreported: event.unreported };
      const result = await db.collection<EventCandidateDoc>("event_candidates").updateOne({ _id: event.id }, { $setOnInsert: candidate }, { upsert: true });
      result.upsertedCount ? counts.new++ : counts.duplicate++;
    }

    await db.collection<IngestionRunDoc>("ingestion_runs").updateOne({ _id: runId }, { $set: { finished_at: new Date(), status: counts.failed ? "partial" : "success", records: counts } });
    console.log(JSON.stringify({ runId, window: WINDOW_ID, counts }, null, 2));
  } catch (error) {
    await client.db(process.env.MONGODB_DB ?? "palantir_th").collection<IngestionRunDoc>("ingestion_runs").updateOne({ _id: runId }, { $set: { finished_at: new Date(), status: "failed", error: error instanceof Error ? error.message : String(error), records: { ...counts, failed: counts.failed + 1 } } });
    throw error;
  } finally {
    await client.close();
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
