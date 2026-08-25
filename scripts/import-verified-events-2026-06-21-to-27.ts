/** Audit and enrich southern security-event candidates for 21-27 Jun 2026. */
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
const WINDOW_ID = "verified-window-2026-06-21-to-27";
const DEFAULT_URI = "mongodb://root:changeme@localhost:27017/palantir_th?authSource=admin";

const updates: Array<{ id: string; urls: string[]; set: Record<string, unknown> }> = [
  {
    id: "evt_26b555a00f7e2796694a8909",
    urls: ["https://opendata.sbpac.go.th/API/relief_01_01.aspx"],
    set: {
      "location.place": "ตำบลบาละ อำเภอกาบัง จังหวัดยะลา (ศอ.บต.ไม่ระบุจุดเกิดเหตุ)",
      "location.geo_precision": "district",
      "event.type": "unrest",
      "event.title": "ระเบียนเหตุที่คณะกรรมการ 3 ฝ่ายไม่รับรองในตำบลบาละ",
      "event.summary": "ฐานข้อมูล ศอ.บต.ลงวันที่ 22 มิถุนายน 2569 ระบุเพียงตำบลบาละ อำเภอกาบัง จังหวัดยะลา และจัดหมวดว่าเป็นเหตุการณ์ที่คณะกรรมการ 3 ฝ่ายไม่รับรอง โดยไม่เปิดเผยลักษณะเหตุ จุดเกิดเหตุ เวลา หรือผู้เสียหาย การตรวจสอบข่าวสาธารณะในรอบนี้ยังไม่พบแหล่งอิสระที่ระบุตัวเหตุได้ จึงคงสถานะยืนยันไม่ได้และไม่อนุมานรายละเอียดเพิ่มเติม",
      severity: null,
      verification: "unverifiable",
      confidence: 45,
      casualties: { killed: null, injured: null },
      actors: [],
      targets: [],
      "attributes.audit_status": "unverifiable_source_claim",
      "attributes.corroboration_result": "ไม่พบรายงานสาธารณะที่ระบุตัวเหตุได้ ณ การตรวจสอบรอบ 21–27 มิ.ย. 2569",
      "attributes.location_text_precision": "subdistrict_only",
    },
  },
  {
    id: "evt_96ffe9f0add7c2746dbc33a7",
    urls: ["https://www.thaipost.net/hi-light/1021964/", "https://www.thaipbs.or.th/news/archive/2026-06-26", "https://opendata.sbpac.go.th/API/relief_01_01.aspx"],
    set: {
      "time.start": new Date("2026-06-26T20:00:00+07:00"),
      "time.precision": "minute",
      "location.place": "ถนนหน้าปอเนาะ บ้านเขาดิน หมู่ 3 ตำบลปากู อำเภอทุ่งยางแดง จังหวัดปัตตานี",
      "location.geo": null,
      "location.geo_precision": "unknown",
      "event.type": "explosion",
      "event.title": "ลอบวางระเบิดรถครอบครัวหน้าปอเนาะบ้านเขาดิน",
      "event.rawType": "ลอบวางระเบิดแสวงเครื่องริมถนน",
      "event.summary": "คนร้ายซุกระเบิดแสวงเครื่องหนักประมาณ 15 กิโลกรัมใต้ผิวถนนหน้าปอเนาะ บ้านเขาดิน หมู่ 3 แล้วจุดชนวนขณะรถกระบะอีซูซุ ดีแมคซ์ของครอบครัวผ่าน ทำให้บิดา มารดา และบุตรอายุ 8 เดือนกับ 2 ปี รวม 4 คนได้รับบาดเจ็บ รถเสียหายหนัก เจ้าหน้าที่ประเมินเบื้องต้นว่าคนร้ายอาจเข้าใจผิดว่าเป็นรถของฝ่ายความมั่นคง",
      severity: 5,
      verification: "verified",
      confidence: 97,
      casualties: { killed: 0, injured: 4 },
      actors: ["คนร้ายไม่ทราบกลุ่มและจำนวน"],
      targets: ["รถกระบะของครอบครัวพลเรือน", "ผู้ใช้เส้นทางหน้าปอเนาะบ้านเขาดิน"],
      "attributes.explosive_weight_kg": 15,
      "attributes.location_text_precision": "village_site",
    },
  },
  {
    id: "evt_e926ad6e259af2566329ddce",
    urls: ["https://www.thaitv5hd.com/web/content.php?id=68284", "https://www.isranews.org/article/south-news/south-slide/147607-burntrucknangta.html", "https://www.board.hatyaifocus.com/news-detail/31221/"],
    set: {
      "time.start": new Date("2026-06-26T23:10:00+07:00"),
      "time.precision": "minute",
      "location.place": "ทางหลวงหมายเลข 410 บริเวณคอสะพาน/โค้งใกล้มัสยิดบ้านคลองน้ำขุ่น บ้านกาสอต หมู่ 5 ตำบลบันนังสตา อำเภอบันนังสตา จังหวัดยะลา",
      "location.geo": null,
      "location.geo_precision": "unknown",
      "event.type": "arson",
      "event.title": "กลุ่มติดอาวุธเผารถบรรทุกบนทางหลวง 410 บ้านกาสอต",
      "event.rawType": "ปล้นและวางเพลิงรถบรรทุก",
      "event.summary": "ชายแต่งกายดำติดอาวุธประมาณ 7–10 คน แอบอ้างเป็นทหารพราน เรียกหยุดรถบรรทุกสิบล้อบนทางหลวง 410 บริเวณสะพานใกล้มัสยิดบ้านคลองน้ำขุ่น บังคับคนขับและภรรยาลงจากรถก่อนจุดไฟเผา รถได้รับความเสียหาย แต่ไม่มีผู้บาดเจ็บ รายงานเวลาแตกต่างกันเล็กน้อยระหว่าง 23.10 และ 23.30 น.; ใช้ 23.10 น.ตามรายงานร่วมสมัยที่ละเอียดกว่า",
      severity: 4,
      verification: "verified",
      confidence: 96,
      casualties: { killed: 0, injured: 0 },
      actors: ["ชายแต่งกายดำติดอาวุธประมาณ 7–10 คน"],
      targets: ["รถบรรทุกสิบล้อ", "คนขับรถและภรรยา", "การสัญจรบนทางหลวงหมายเลข 410"],
      "attributes.alternate_reported_time": "23:30",
      "attributes.location_text_precision": "road_landmark_village",
    },
  },
  {
    id: "evt_1bf2a4cbb7de43520ec52e07",
    urls: ["https://www.thaitv5hd.com/web/content.php?id=68287", "https://www.isranews.org/article/south-news/south-slide/147607-burntrucknangta.html", "https://opendata.sbpac.go.th/API/relief_01_01.aspx"],
    set: {
      "time.start": new Date("2026-06-27T07:30:00+07:00"),
      "time.precision": "minute",
      "location.place": "บ้านต้นมะขาม หมู่ 4 ตำบลเมาะมาวี อำเภอยะรัง จังหวัดปัตตานี",
      "location.geo": null,
      "location.geo_precision": "unknown",
      "event.type": "shooting",
      "event.title": "ยิงสมาชิก อส.เสียชีวิตที่บ้านต้นมะขาม",
      "event.rawType": "ลอบยิงเจ้าหน้าที่ฝ่ายปกครอง",
      "event.summary": "คนร้ายใช้อาวุธปืนพกขนาด 9 มม.ยิงนายอับดุลเลาะ ยามา สมาชิกกองอาสารักษาดินแดน ขณะกลับจากไปส่งบุตรที่โรงเรียนตาดีกาในพื้นที่บ้านต้นมะขาม หมู่ 4 ทำให้เสียชีวิต 1 ราย เจ้าหน้าที่เข้าตรวจสถานที่และรวบรวมหลักฐานเพื่อติดตามผู้ก่อเหตุ",
      severity: 5,
      verification: "verified",
      confidence: 97,
      casualties: { killed: 1, injured: 0 },
      actors: ["คนร้ายไม่ทราบกลุ่มและจำนวน"],
      targets: ["นายอับดุลเลาะ ยามา สมาชิกกองอาสารักษาดินแดน"],
      "attributes.weapon": "ปืนพกขนาด 9 มม.",
      "attributes.location_text_precision": "village",
    },
  },
];

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function main(): Promise<void> {
  const client = await new MongoClient(process.env.MONGODB_URI ?? DEFAULT_URI, { serverSelectionTimeoutMS: 5_000 }).connect();
  const startedAt = new Date();
  const runId = `run_verified_20260621_27_${startedAt.toISOString().replace(/\D/g, "").slice(0, 14)}_${randomUUID().slice(0, 8)}`;
  const counts = { downloaded: updates.length, new: 0, updated: 0, duplicate: 0, failed: 0 };
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
      const result = await db.collection<EventCandidateDoc>("event_candidates").updateOne(
        { _id: item.id },
        { $set: set as never, $addToSet: { corroborating_sources: SOURCE_ID }, $pull: { unreported: { $in: ["severity", "casualties", "casualties.killed", "casualties.injured", "actors", "targets", "exact_time"] } } },
      );
      if (!result.matchedCount) throw new Error(`Existing candidate ${item.id} was not found`);
      result.modifiedCount ? counts.updated++ : counts.duplicate++;
    }

    await db.collection<IngestionRunDoc>("ingestion_runs").updateOne({ _id: runId }, { $set: { finished_at: new Date(), status: "success", records: counts } });
    console.log(JSON.stringify({ runId, window: WINDOW_ID, counts }, null, 2));
  } catch (error) {
    await db.collection<IngestionRunDoc>("ingestion_runs").updateOne({ _id: runId }, { $set: { finished_at: new Date(), status: "failed", error: error instanceof Error ? error.message : String(error), records: { ...counts, failed: counts.failed + 1 } } });
    throw error;
  } finally {
    await client.close();
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
