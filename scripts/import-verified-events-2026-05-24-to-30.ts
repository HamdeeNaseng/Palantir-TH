/** Enrich the verified southern security incident for 24-30 May 2026. */
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
const WINDOW_ID = "verified-window-2026-05-24-to-30";
const DEFAULT_URI = "mongodb://root:changeme@localhost:27017/palantir_th?authSource=admin";
const CANDIDATE_ID = "evt_776f6da5fc22875e451f742f";
const urls = [
  "https://www.thaipbs.or.th/news/content/506398",
  "https://www.isranews.org/article/south-news/south-slide/147105-officershoot.html",
  "https://www.thereporters.co/deepsouth/2505261936/",
  "https://opendata.sbpac.go.th/API/relief_01_01.aspx",
];
const place = "หน้าทางเข้าโรงเรียนประสานวิทยามูลนิธิ ใกล้มัสยิด หมู่ 5 ตำบลยะรัง อำเภอยะรัง จังหวัดปัตตานี";
const update: Record<string, unknown> = {
  "time.start": new Date("2026-05-25T15:30:00+07:00"), "time.precision": "minute",
  "location.subdistrict": "ยะรัง", "location.place": place, "location.geo": null, "location.geo_precision": "unknown",
  "event.type": "shooting", "event.title": "มือปืนแต่งกายคล้ายหญิงยิงครอบครัวตำรวจหน้าโรงเรียนประสานวิทยา", "event.rawType": "ประกบยิงรถยนต์ครอบครัวเจ้าหน้าที่ตำรวจ",
  "event.summary": "ผู้ก่อเหตุ 4 คนแต่งกายคล้ายหญิงมุสลิม ใช้รถจักรยานยนต์ 2 คันติดตามและยิงรถเก๋งของ ด.ต.อดุลย์ หะยีสุหลง ขณะครอบครัวมารับบุตรหน้าโรงเรียนประสานวิทยามูลนิธิ ด.ต.อดุลย์ได้รับบาดเจ็บ นางฟาตีเมาะ ยาโงะ ภรรยาและครูของโรงเรียนเสียชีวิตขณะอุ้มบุตร และทารกหญิงได้รับบาดเจ็บจากกระสุนเฉี่ยว เด็กชายวัย 3 ขวบในรถไม่บาดเจ็บ",
  severity: 5, verification: "verified", confidence: 98, casualties: { killed: 1, injured: 2 },
  actors: ["ผู้ก่อเหตุ 4 คนแต่งกายคล้ายหญิงมุสลิม ใช้รถจักรยานยนต์ 2 คัน"],
  targets: ["ด.ต.อดุลย์ หะยีสุหลง ตำรวจ สภ.ยะหริ่ง", "ครอบครัวของเจ้าหน้าที่ตำรวจ", "รถยนต์ส่วนตัวหน้าโรงเรียน"],
  "attributes.weapon": "อาวุธปืนขนาด 9 มม. และอาก้า", "attributes.injured_adult": 1, "attributes.injured_infant": 1,
  "attributes.location_text_precision": "school_village", "attributes.location_discrepancy": "รายงานแรกของ Thai PBS ระบุ ต.พงสตา; ศอ.บต. ตำรวจพื้นที่ Isranews และ The Reporters ระบุ หมู่ 5 ต.ยะรัง",
};
function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

async function main(): Promise<void> {
  const client = await new MongoClient(process.env.MONGODB_URI ?? DEFAULT_URI, { serverSelectionTimeoutMS: 5_000 }).connect();
  const startedAt = new Date();
  const runId = `run_verified_20260524_30_${startedAt.toISOString().replace(/\D/g, "").slice(0, 14)}_${randomUUID().slice(0, 8)}`;
  const counts = { downloaded: 1, new: 0, updated: 0, duplicate: 0, failed: 0 };
  const db = client.db(process.env.MONGODB_DB ?? "palantir_th");
  try {
    const source: SourceRegistryDoc = { _id: SOURCE_ID, name: "Palantir TH manual research ledger", shortName: "Manual research", category: "research", priority: "P3", role: "Manually corroborated event enrichment", connector: { type: "FORM" }, schedule: { mode: "snapshot", frequency: "manual" }, trust: { class: "manual_entry", score: 60 }, enabled: true };
    await db.collection<SourceRegistryDoc>("source_registry").updateOne({ _id: SOURCE_ID }, { $setOnInsert: source }, { upsert: true });
    const run: IngestionRunDoc = { _id: runId, source_id: SOURCE_ID, started_at: startedAt, finished_at: null, status: "running", records: counts };
    await db.collection<IngestionRunDoc>("ingestion_runs").insertOne(run);
    const payload = { record_type: "manual_research_enrichment", window_id: WINDOW_ID, candidate_id: CANDIDATE_ID, sources: urls, normalized_update: update };
    const rawId = `raw_manual_enrichment_${WINDOW_ID}_${CANDIDATE_ID}`;
    const raw: RawRecordDoc = { _id: rawId, source_id: SOURCE_ID, external_id: `${WINDOW_ID}-${CANDIDATE_ID}`, retrieved_at: startedAt, source: { url: urls[0] }, dataset: { name: "Palantir TH verified event window", version: WINDOW_ID }, raw: payload, integrity: { content_hash: `sha256:${hash(payload)}`, algorithm: "sha256" }, processing: { status: "normalized" }, ingestion_run_id: runId };
    await db.collection<RawRecordDoc>("raw_records").updateOne({ _id: rawId }, { $setOnInsert: raw }, { upsert: true });
    const sourceAttributes = Object.fromEntries(urls.map((url, index) => [`attributes.source_url_${index + 1}`, url]));
    const result = await db.collection<EventCandidateDoc>("event_candidates").updateOne({ _id: CANDIDATE_ID }, { $set: { ...update, ...sourceAttributes, "attributes.research_batch": WINDOW_ID, "attributes.enrichment_raw_record_id": rawId, "attributes.location_address": place, "attributes.source_count": urls.length } as never, $addToSet: { corroborating_sources: SOURCE_ID }, $pull: { unreported: { $in: ["severity", "casualties", "casualties.killed", "casualties.injured", "actors", "targets", "exact_time"] } } });
    if (!result.matchedCount) throw new Error(`Existing candidate ${CANDIDATE_ID} was not found`);
    result.modifiedCount ? counts.updated++ : counts.duplicate++;
    await db.collection<IngestionRunDoc>("ingestion_runs").updateOne({ _id: runId }, { $set: { finished_at: new Date(), status: "success", records: counts } });
    console.log(JSON.stringify({ runId, window: WINDOW_ID, counts }, null, 2));
  } catch (error) {
    await db.collection<IngestionRunDoc>("ingestion_runs").updateOne({ _id: runId }, { $set: { finished_at: new Date(), status: "failed", error: error instanceof Error ? error.message : String(error), records: { ...counts, failed: 1 } } });
    throw error;
  } finally { await client.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
