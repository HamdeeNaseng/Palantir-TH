/** Import and enrich verified southern security incidents for 28 Jun-4 Jul 2026. */
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
const WINDOW_ID = "verified-window-2026-06-28-to-07-04";
const DEFAULT_URI = "mongodb://root:changeme@localhost:27017/palantir_th?authSource=admin";

const existingUpdates = [
  {
    id: "evt_7d3c50e90b69159d61e87f53",
    urls: ["https://www.isranews.org/article/south-news/south-slide/147630-bombptylptn.html", "https://www.sbpac.go.th/home/?p=168908", "https://thaitv5hd.com/web26/content/68417/%E0%B8%AA%E0%B8%A1%E0%B8%8A-%E0%B8%8A%E0%B8%B5%E0%B9%89%E0%B8%9A%E0%B8%B6%E0%B9%89%E0%B8%A1%E0%B8%9B%E0%B8%B1%E0%B9%8A%E0%B8%A1-PT-%E0%B8%A2%E0%B8%B0%E0%B8%A5%E0%B8%B2-%E0%B9%82%E0%B8%A2%E0%B8%87%E0%B8%9B%E0%B9%88%E0%B8%A7%E0%B8%99%E0%B9%83%E0%B8%95%E0%B9%89-%E0%B9%80%E0%B8%9C%E0%B8%A2%E0%B8%9E%E0%B8%A4%E0%B8%95%E0%B8%B4%E0%B8%81%E0%B8%A3%E0%B8%A3%E0%B8%A1%E0%B8%8B%E0%B9%89%E0%B9%8D%E0%B8%B2%E0%B8%A3%E0%B8%AD%E0%B8%A2%E0%B8%AD%E0%B8%94%E0%B8%B5%E0%B8%95"],
    set: {
      "time.start": new Date("2026-06-28T23:08:00+07:00"), "time.precision": "minute", "location.subdistrict": "สะเตงนอก",
      "location.place": "สถานีบริการน้ำมัน PT สาขาสาย 15 ริมถนนสาย 15 ตำบลสะเตงนอก อำเภอเมืองยะลา จังหวัดยะลา", "location.geo": null, "location.geo_precision": "unknown",
      "event.type": "explosion", "event.title": "ระเบิดและวางเพลิงปั๊ม PT สาขาสาย 15", "event.rawType": "ระเบิดและวางเพลิงสถานีบริการน้ำมัน",
      "event.summary": "กลุ่มคนร้ายประมาณ 6 คนใช้รถจักรยานยนต์ 2 คัน เข้าข่มขู่และไล่พนักงานกับประชาชนออกจากปั๊ม ก่อนวางระเบิดแสวงเครื่องที่บรรจุในถังดับเพลิงน้ำหนักราว 15 กิโลกรัมและจุดชนวน ทำให้หัวจ่ายและทรัพย์สินเสียหาย ไม่มีรายงานผู้บาดเจ็บ",
      severity: 4, verification: "verified", confidence: 97, casualties: { killed: 0, injured: 0 }, actors: ["กลุ่มคนร้ายประมาณ 6 คนแต่งกายดำ"], targets: ["สถานีบริการน้ำมัน PT สาขาสาย 15", "ระบบเศรษฐกิจในพื้นที่"],
    },
  },
  {
    id: "evt_99afd681b1af274b615faab0",
    urls: ["https://www.isranews.org/article/south-news/south-slide/147630-bombptylptn.html", "https://www.amarintv.com/news/crime/550138", "https://www.naewna.com/local/974035"],
    set: {
      "time.start": new Date("2026-06-28T23:30:00+07:00"), "time.precision": "minute",
      "location.place": "สถานีบริการน้ำมัน PT สาขาปาวา ริมทางหลวงหมายเลข 42 ปัตตานี–นราธิวาส ตำบลเตราะบอน อำเภอสายบุรี จังหวัดปัตตานี", "location.geo": null, "location.geo_precision": "unknown",
      "event.type": "explosion", "event.title": "ระเบิดและวางเพลิงปั๊ม PT สาขาปาวา", "event.rawType": "ระเบิดและวางเพลิงสถานีบริการน้ำมัน",
      "event.summary": "คนร้าย 7–8 คนใช้รถจักรยานยนต์ 4 คัน ขับไล่พนักงาน รปภ. และประชาชน ก่อนวางระเบิดบริเวณหัวจ่าย ทำให้หลังคาถล่มและหัวจ่าย 8 หัวเสียหาย มีผู้บาดเจ็บ 2 ราย ได้แก่พนักงานแคชเชียร์มีบาดแผลที่ศีรษะ หน้าอก และต้นขา กับพนักงานร้านค้ามีอาการแน่นหน้าอก",
      severity: 5, verification: "verified", confidence: 97, casualties: { killed: 0, injured: 2 }, actors: ["กลุ่มคนร้าย 7–8 คนแต่งกายดำ"], targets: ["สถานีบริการน้ำมัน PT สาขาปาวา", "พนักงานและประชาชนในปั๊ม"],
    },
  },
  {
    id: "evt_00557b25699ba4f5a9d7007d",
    urls: ["https://www.southpeace.go.th/?p=176671", "https://www.thaipost.net/x-cite-news/1023319/", "https://www.talknewsonline.com/News/36431/"],
    set: {
      "time.start": new Date("2026-06-29T11:41:00+07:00"), "time.precision": "minute",
      "location.place": "ท่อลอดถนนใกล้สามแยกสะปอม ฝั่งขาเข้าอำเภอตากใบ พื้นที่บ้านไพรวัน ตำบลไพรวัน อำเภอตากใบ จังหวัดนราธิวาส", "location.geo": null, "location.geo_precision": "unknown",
      "event.type": "explosion", "event.title": "ลอบวางระเบิดท่อลอดถนนใกล้สามแยกสะปอม", "event.rawType": "ลอบวางระเบิดริมทาง",
      "event.summary": "คนร้ายนำระเบิดถังแก๊สซ่อนไว้ในท่อลอดถนนใกล้สามแยกสะปอมและจุดชนวน แรงระเบิดกระทบรถนักท่องเที่ยวชาวมาเลเซีย ทำให้ชายชาวมาเลเซีย 2 รายได้รับบาดเจ็บ เจ้าหน้าที่เข้าปิดกั้น ตรวจพิสูจน์ และซ่อมแซมเส้นทาง",
      severity: 5, verification: "verified", confidence: 98, casualties: { killed: 0, injured: 2 }, actors: ["คนร้ายไม่ทราบกลุ่มและจำนวน"], targets: ["ผู้ใช้ทางและนักท่องเที่ยว", "เส้นทางขาเข้าอำเภอตากใบ"],
    },
  },
];

const newEvent = {
  id: "evt_verified_20260628_piya_pt_bombing",
  at: "2026-06-28T23:40:00+07:00",
  place: "สถานีบริการน้ำมัน PT สาขาปิยา ริมทางหลวงหมายเลข 42 บ้านบ่อม่วง หมู่ 2 ตำบลปิยามุมัง อำเภอยะหริ่ง จังหวัดปัตตานี",
  urls: ["https://www.isranews.org/article/south-news/south-slide/147630-bombptylptn.html", "https://www.amarintv.com/news/crime/550138", "https://www.sbpac.go.th/home/?p=168813"],
};

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function main(): Promise<void> {
  const client = await new MongoClient(process.env.MONGODB_URI ?? DEFAULT_URI, { serverSelectionTimeoutMS: 5_000 }).connect();
  const startedAt = new Date();
  const runId = `run_verified_20260628_0704_${startedAt.toISOString().replace(/\D/g, "").slice(0, 14)}_${randomUUID().slice(0, 8)}`;
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
      const set = { ...item.set, "attributes.research_batch": WINDOW_ID, "attributes.enrichment_raw_record_id": rawId, "attributes.location_address": item.set["location.place"], "attributes.source_count": item.urls.length, "attributes.source_url_1": item.urls[0], "attributes.source_url_2": item.urls[1], "attributes.source_url_3": item.urls[2] };
      const result = await db.collection<EventCandidateDoc>("event_candidates").updateOne({ _id: item.id }, { $set: set as never, $addToSet: { corroborating_sources: SOURCE_ID }, $pull: { unreported: { $in: ["severity", "casualties", "casualties.killed", "casualties.injured", "actors", "targets", "exact_time"] } } });
      if (!result.matchedCount) throw new Error(`Existing candidate ${item.id} was not found`);
      result.modifiedCount ? counts.updated++ : counts.duplicate++;
    }

    const payload = { record_type: "manual_research_claim", window_id: WINDOW_ID, observed_event: newEvent, coordinated_series: "การโจมตีปั๊ม PT 3 แห่งในคืนเดียวกัน; แยกเป็นเคสตามจุดเกิดเหตุและเวลา" };
    const rawId = `raw_${newEvent.id.replace(/^evt_/, "")}`;
    const digest = hash(payload);
    const raw: RawRecordDoc = { _id: rawId, source_id: SOURCE_ID, external_id: `${WINDOW_ID}-${newEvent.id}`, retrieved_at: startedAt, source: { url: newEvent.urls[0] }, dataset: { name: "Palantir TH verified event window", version: WINDOW_ID }, raw: payload, integrity: { content_hash: `sha256:${digest}`, algorithm: "sha256" }, processing: { status: "normalized" }, ingestion_run_id: runId };
    await db.collection<RawRecordDoc>("raw_records").updateOne({ _id: rawId }, { $setOnInsert: raw }, { upsert: true });
    const candidate: EventCandidateDoc = {
      _id: newEvent.id, source_id: SOURCE_ID, raw_record_id: rawId, time: { start: new Date(newEvent.at), precision: "minute" }, location: { province: "ปัตตานี", provinceCode: "pattani", district: "ยะหริ่ง", subdistrict: "ปิยามุมัง", place: newEvent.place, geo: null, geo_precision: "unknown" },
      event: { type: "explosion", title: "ระเบิดและวางเพลิงปั๊ม PT สาขาปิยา", rawType: "ระเบิดและวางเพลิงสถานีบริการน้ำมัน", summary: "กลุ่มคนร้ายแต่งกายดำขับไล่พนักงานและประชาชนออกจากพื้นที่ ก่อนวางระเบิดและจุดเพลิง ทำให้หัวจ่าย โครงสร้าง ร้านค้า และสถานที่ละหมาดเสียหาย พร้อมโปรยตะปูเรือใบบนทางเข้าออก มีผู้บาดเจ็บ 1 รายจากอาการหูอื้อและแน่นหน้าอก" },
      severity: 5, verification: "verified", confidence: 98, casualties: { killed: 0, injured: 1 }, actors: ["กลุ่มคนร้ายแต่งกายดำประมาณ 6 คน"], targets: ["สถานีบริการน้ำมัน PT สาขาปิยา", "พนักงานและประชาชนในปั๊ม"], corroborating_sources: [SOURCE_ID], media: [],
      attributes: { research_batch: WINDOW_ID, location_address: newEvent.place, location_text_precision: "site", source_count: 3, source_url_1: newEvent.urls[0], source_url_2: newEvent.urls[1], source_url_3: newEvent.urls[2], injured_name: "อัลอามีน บินมูดอ", injury: "หูอื้อและแน่นหน้าอก", coordinated_attack_count: 3 },
      unreported: ["coordinates", "explosive_device_detail", "perpetrator_identity", "damage_value"],
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
