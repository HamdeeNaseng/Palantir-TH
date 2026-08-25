/** Import and reconcile verified southern security incidents for 12-18 Jul 2026. */
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
const WINDOW_ID = "verified-window-2026-07-12-to-18";
const DEFAULT_URI = "mongodb://root:changeme@localhost:27017/palantir_th?authSource=admin";

const existingUpdates = [
  {
    id: "evt_77650c592a1d7e0d505cb2d2",
    urls: ["https://www.isranews.org/article/south-news/other-news/147909-samdao.html", "https://www.board.hatyaifocus.com/news-detail/31374/", "https://www.komchadluek.net/news/general-news/620422"],
    set: {
      "time.start": new Date("2026-07-13T10:00:00+07:00"), "time.precision": "minute",
      "location.place": "หน้าอาคารสำนักงาน หจก.สามดาวพาราวู้ด เลขที่ 117 หมู่ 9 บ้านเจาะปันตัง ตำบลบันนังสตา อำเภอบันนังสตา จังหวัดยะลา",
      "location.geo": null, "location.geo_precision": "unknown", "event.type": "shooting", "event.title": "ซุ่มยิงเจ้าของโรงไม้สามดาวพาราวู้ดเสียชีวิต", "event.rawType": "ลอบยิงผู้ประกอบการ",
      "event.summary": "คนร้ายไม่ทราบกลุ่มและจำนวนซุ่มยิงนายชัชวาลย์ บูรณะเรข อายุ 60 ปี จากป่ากล้วยฝั่งตรงข้ามโรงงาน ระยะประมาณ 55 เมตร กระสุน 1 นัดเข้าหน้าอกซ้ายขณะยืนหน้าอาคารสำนักงาน ผู้บาดเจ็บเสียชีวิตภายหลังที่โรงพยาบาล ตำรวจตรวจทั้งประเด็นความไม่สงบ ความขัดแย้งทางธุรกิจ และเหตุส่วนตัว",
      severity: 5, verification: "verified", confidence: 98, casualties: { killed: 1, injured: 0 }, actors: ["มือปืนไม่ทราบกลุ่มและจำนวน"], targets: ["เจ้าของ หจก.สามดาวพาราวู้ด"],
    },
  },
  {
    id: "evt_8d2852f02a49211b99dce4d9",
    urls: ["https://thaitv5hd.com/content/100875/%E0%B8%84%E0%B8%99%E0%B8%A3%E0%B9%89%E0%B8%B2%E0%B8%A2%E0%B8%81%E0%B9%88%E0%B8%AD%E0%B9%80%E0%B8%AB%E0%B8%95%E0%B8%B8%E0%B8%AA%E0%B8%A3%E0%B9%89%E0%B8%B2%E0%B8%87%E0%B8%AA%E0%B8%96%E0%B8%B2%E0%B8%99%E0%B8%81%E0%B8%B2%E0%B8%A3%E0%B8%93%E0%B9%8C-%E0%B8%8B%E0%B8%B8%E0%B9%88%E0%B8%A1%E0%B8%A2%E0%B8%B4%E0%B8%87%E0%B8%95%E0%B8%B3%E0%B8%A3%E0%B8%A7%E0%B8%88%E0%B8%A2%E0%B8%B0%E0%B8%A5%E0%B8%B2"],
    set: {
      "time.start": new Date("2026-07-14T21:10:00+07:00"), "time.precision": "minute",
      "location.place": "บริเวณบ้านพัก บ้านมูนุง หมู่ 5 ตำบลปะแต อำเภอยะหา จังหวัดยะลา", "location.geo": null, "location.geo_precision": "unknown",
      "event.type": "shooting", "event.title": "ซุ่มยิงตำรวจบริเวณบ้านพักที่บ้านมูนุง", "event.rawType": "ลอบยิงเจ้าหน้าที่ตำรวจ",
      "event.summary": "คนร้ายไม่ทราบจำนวนใช้อาวุธปืนยิง จ.ส.ต.มะรอปีอิง การี เจ้าหน้าที่ สภ.ธารโต ขณะอยู่บริเวณบ้านพัก กระสุนถูกฝาผนังและประตูบ้าน ตำรวจและลูกชายปลอดภัย ไม่มีผู้บาดเจ็บ ผู้ก่อเหตุอาศัยความมืดหลบหนี",
      severity: 4, verification: "verified", confidence: 94, casualties: { killed: 0, injured: 0 }, actors: ["คนร้ายไม่ทราบจำนวน"], targets: ["เจ้าหน้าที่ตำรวจ สภ.ธารโต", "บ้านพักของเจ้าหน้าที่"],
    },
  },
  {
    id: "evt_37b0d130b140e87cf90a8b19",
    urls: ["https://www.banmuang.co.th/news/crime/483354"],
    set: {
      "time.start": new Date("2026-07-15T22:20:00+07:00"), "time.precision": "minute", "location.district": "บันนังสตา", "location.subdistrict": "บาเจาะ",
      "location.place": "บ้านอูแบ หมู่ 1 ตำบลบาเจาะ อำเภอบันนังสตา จังหวัดยะลา", "event.type": "shooting", "event.title": "ซุ่มยิงชาวบ้านบ้านอูแบเสียชีวิต", "event.rawType": "ยิงประชาชนเสียชีวิต",
      "event.summary": "คนร้ายไม่ทราบชื่อและจำนวนใช้อาวุธปืนไม่ทราบชนิดยิงนายอาดือนัน ลูมะ อายุ 30 ปีเข้าที่ลำตัว เสียชีวิตในที่เกิดเหตุ เจ้าหน้าที่ยังสอบสวนว่าเกี่ยวข้องกับความไม่สงบหรือความขัดแย้งส่วนตัว",
      severity: 5, verification: "verified", confidence: 93, casualties: { killed: 1, injured: 0 }, actors: ["คนร้ายไม่ทราบชื่อและจำนวน"], targets: ["ประชาชนชายอายุ 30 ปี"],
    },
  },
];

const newEvent = {
  id: "evt_verified_20260718_juap_cctv_solar_damage",
  at: "2026-07-18T20:00:00+07:00",
  place: "3 จุดในตำบลจวบ อำเภอเจาะไอร้อง จังหวัดนราธิวาส: (1) เสาไฟฟ้าบริเวณสามแยกบ้านลูโบะเย๊าะ หมู่ 7 (2) เสาไฟฟ้าอีกต้นห่างจากจุดแรกประมาณ 20 เมตร บ้านลูโบะเย๊าะ หมู่ 7 และ (3) เสาไฟฟ้าหน้าโรงเรียนสัมพันธ์วิทยา หมู่ 8",
  urls: ["https://www.thairath.co.th/news/crime/2947214"],
};

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function main(): Promise<void> {
  const client = await new MongoClient(process.env.MONGODB_URI ?? DEFAULT_URI, { serverSelectionTimeoutMS: 5_000 }).connect();
  const startedAt = new Date();
  const runId = `run_verified_20260712_18_${startedAt.toISOString().replace(/\D/g, "").slice(0, 14)}_${randomUUID().slice(0, 8)}`;
  const counts = { downloaded: 4, new: 0, updated: 0, duplicate: 0, failed: 0 };
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

    const duplicateResult = await db.collection<EventCandidateDoc>("event_candidates").updateOne(
      { _id: "evt_69459ed51b6dfeabd38293b0" },
      { $set: { "attributes.superseded_by": "evt_77650c592a1d7e0d505cb2d2", "attributes.superseded_reason": "ระเบียน UCDP ระดับอำเภอและ ศอ.บต. อ้างถึงเหตุยิงเจ้าของโรงไม้สามดาววันที่ 13 ก.ค.เดียวกัน", "attributes.reconciled_in_batch": WINDOW_ID } },
    );
    if (!duplicateResult.matchedCount) throw new Error("Duplicate UCDP candidate for 13 Jul was not found");
    duplicateResult.modifiedCount ? counts.updated++ : counts.duplicate++;

    const payload = { record_type: "manual_research_claim", window_id: WINDOW_ID, observed_event: newEvent, caveat: "สามตำแหน่งเป็นการปฏิบัติการต่อเนื่องของกลุ่มเดียวกันในช่วงเวลาเดียวกัน จึงนับเป็นหนึ่งเหตุหลายจุด" };
    const rawId = `raw_${newEvent.id.replace(/^evt_/, "")}`;
    const digest = hash(payload);
    const raw: RawRecordDoc = { _id: rawId, source_id: SOURCE_ID, external_id: `${WINDOW_ID}-${newEvent.id}`, retrieved_at: startedAt, source: { url: newEvent.urls[0] }, dataset: { name: "Palantir TH verified event window", version: WINDOW_ID }, raw: payload, integrity: { content_hash: `sha256:${digest}`, algorithm: "sha256" }, processing: { status: "normalized" }, ingestion_run_id: runId };
    await db.collection<RawRecordDoc>("raw_records").updateOne({ _id: rawId }, { $setOnInsert: raw }, { upsert: true });
    const candidate: EventCandidateDoc = {
      _id: newEvent.id, source_id: SOURCE_ID, raw_record_id: rawId, time: { start: new Date(newEvent.at), precision: "minute" },
      location: { province: "นราธิวาส", provinceCode: "narathiwat", district: "เจาะไอร้อง", subdistrict: "จวบ", place: newEvent.place, geo: null, geo_precision: "unknown" },
      event: { type: "arson", title: "เผากล้องวงจรปิดและยิงตู้โซลาร์ 3 จุดในตำบลจวบ", rawType: "ทำลายระบบกล้องวงจรปิดและระบบไฟฟ้า", summary: "ชาย 4 คนแต่งกายดำและปิดบังใบหน้าใช้ปืนลูกซองยิงตู้คอมบายเนอร์ของระบบโซลาร์ และใช้ยางรถจักรยานยนต์จุดไฟเผากล้องวงจรปิด รวมความเสียหาย 3 จุดในบ้านลูโบะเย๊าะและหน้าโรงเรียนสัมพันธ์วิทยา ไม่พบผู้เสียชีวิตหรือบาดเจ็บ" },
      severity: 3, verification: "verified", confidence: 93, casualties: { killed: 0, injured: 0 }, actors: ["ชาย 4 คนแต่งกายดำและปิดบังใบหน้า"], targets: ["กล้องวงจรปิด", "ตู้คอมบายเนอร์ระบบโซลาร์เซลล์"], corroborating_sources: [SOURCE_ID], media: [],
      attributes: { research_batch: WINDOW_ID, location_address: newEvent.place, location_text_precision: "multi_site", source_count: 1, source_url_1: newEvent.urls[0], site_count: 3, site_1: "สามแยกบ้านลูโบะเย๊าะ หมู่ 7 ตำบลจวบ", site_2: "เสาไฟฟ้าห่างจากจุดแรกประมาณ 20 เมตร บ้านลูโบะเย๊าะ หมู่ 7 ตำบลจวบ", site_3: "หน้าโรงเรียนสัมพันธ์วิทยา หมู่ 8 ตำบลจวบ", shotgun_shells_reported: 5 },
      unreported: ["coordinates", "perpetrator_identity", "damage_value"],
    };
    const insertResult = await db.collection<EventCandidateDoc>("event_candidates").updateOne({ _id: candidate._id }, { $setOnInsert: candidate }, { upsert: true });
    insertResult.upsertedCount ? counts.new++ : counts.duplicate++;

    await db.collection<IngestionRunDoc>("ingestion_runs").updateOne({ _id: runId }, { $set: { finished_at: new Date(), status: "success", records: counts } });
    console.log(JSON.stringify({ runId, window: WINDOW_ID, counts }, null, 2));
  } catch (error) {
    await client.db(process.env.MONGODB_DB ?? "palantir_th").collection<IngestionRunDoc>("ingestion_runs").updateOne({ _id: runId }, { $set: { finished_at: new Date(), status: "failed", error: error instanceof Error ? error.message : String(error), records: { ...counts, failed: counts.failed + 1 } } });
    throw error;
  } finally {
    await client.close();
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
