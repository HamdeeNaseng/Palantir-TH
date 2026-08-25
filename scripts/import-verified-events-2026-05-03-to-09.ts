/** Enrich the verified southern security incident for 3-9 May 2026. */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MongoClient } from "mongodb";
import type { EventCandidateDoc, IngestionRunDoc, RawRecordDoc, SourceRegistryDoc } from "../src/lib/types";

function loadEnv(): void { const path = resolve(process.cwd(), ".env"); if (!existsSync(path)) return; for (const line of readFileSync(path, "utf8").split(/\r?\n/)) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2"); } }
loadEnv();
const SOURCE_ID = "src_manual_research";
const WINDOW_ID = "verified-window-2026-05-03-to-09";
const DEFAULT_URI = "mongodb://root:changeme@localhost:27017/palantir_th?authSource=admin";
const CANDIDATE_ID = "evt_e842f50f0becf9e50065384f";
const urls = ["https://www.thairath.co.th/news/crime/2930613", "https://www.hatyaifocus.com/news-detail/30853/", "https://www.southpeace.go.th/?p=169976", "https://opendata.sbpac.go.th/API/relief_01_01.aspx"];
const place = "สี่แยกบ้านม่วงหวาน ตำบลสาคอบน อำเภอมายอ จังหวัดปัตตานี";
const update: Record<string, unknown> = {
  "time.start": new Date("2026-05-04T17:30:00+07:00"), "time.precision": "minute", "location.place": place, "location.geo": null, "location.geo_precision": "unknown",
  "event.type": "shooting", "event.title": "คนร้ายปลอมเป็นช่างไฟยิงตำรวจที่สี่แยกบ้านม่วงหวาน", "event.rawType": "ใช้อาวุธปืนสงครามและปืนสั้นซุ่มยิงเจ้าหน้าที่ตำรวจ",
  "event.summary": "คนร้ายประมาณ 4 คนใช้รถจักรยานยนต์ 2 คัน จอดทำทีเป็นช่างซ่อมสายไฟฟ้าบริเวณสี่แยกบ้านม่วงหวาน เมื่อ ด.ต.มะยากี ดีเยาะ อายุ 50 ปี ตำรวจ สภ.ราตาปันยัง ขับรถกระบะอีซูซุส่วนตัวกลับบ้านหลังออกเวรและชะลอรถ คนร้ายใช้อาวุธปืนสงครามและปืนสั้นยิงถล่ม ผู้เสียหายพยายามลงจากรถแต่ถูกยิงซ้ำและเสียชีวิตในที่เกิดเหตุ รถถูกยิงพรุน ก่อนคนร้ายหลบหนี",
  severity: 5, verification: "verified", confidence: 98, casualties: { killed: 1, injured: 0 }, actors: ["คนร้ายประมาณ 4 คน ปลอมเป็นช่างไฟ ใช้รถจักรยานยนต์ 2 คัน"], targets: ["ด.ต.มะยากี ดีเยาะ ตำรวจ สภ.ราตาปันยัง", "รถกระบะอีซูซุส่วนตัวทะเบียน บค 7147 ปัตตานี"],
  "attributes.weapon": "อาวุธปืนสงครามและอาวุธปืนสั้น", "attributes.location_text_precision": "named_intersection", "attributes.location_discrepancy": "Thai Rath และสื่อรายงานจุดเกิดเหตุเป็นหมู่ 4 ขณะที่รายงานติดตามคดีของ กอ.รมน.ภาค 4 สน. ระบุหมู่ 2; ทุกแหล่งตรงกันว่าเป็นสี่แยกบ้านม่วงหวาน ต.สาคอบน จึงไม่ใส่เลขหมู่ในที่อยู่หลัก",
};
function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
async function main(): Promise<void> {
  const client = await new MongoClient(process.env.MONGODB_URI ?? DEFAULT_URI, { serverSelectionTimeoutMS: 5_000 }).connect(); const startedAt = new Date(); const runId = `run_verified_20260503_09_${startedAt.toISOString().replace(/\D/g, "").slice(0, 14)}_${randomUUID().slice(0, 8)}`; const counts = { downloaded: 1, new: 0, updated: 0, duplicate: 0, failed: 0 }; const db = client.db(process.env.MONGODB_DB ?? "palantir_th");
  try {
    const source: SourceRegistryDoc = { _id: SOURCE_ID, name: "Palantir TH manual research ledger", shortName: "Manual research", category: "research", priority: "P3", role: "Manually corroborated event enrichment", connector: { type: "FORM" }, schedule: { mode: "snapshot", frequency: "manual" }, trust: { class: "manual_entry", score: 60 }, enabled: true };
    await db.collection<SourceRegistryDoc>("source_registry").updateOne({ _id: SOURCE_ID }, { $setOnInsert: source }, { upsert: true }); const run: IngestionRunDoc = { _id: runId, source_id: SOURCE_ID, started_at: startedAt, finished_at: null, status: "running", records: counts }; await db.collection<IngestionRunDoc>("ingestion_runs").insertOne(run);
    const payload = { record_type: "manual_research_enrichment", window_id: WINDOW_ID, candidate_id: CANDIDATE_ID, sources: urls, normalized_update: update }; const rawId = `raw_manual_enrichment_${WINDOW_ID}_${CANDIDATE_ID}`; const raw: RawRecordDoc = { _id: rawId, source_id: SOURCE_ID, external_id: `${WINDOW_ID}-${CANDIDATE_ID}`, retrieved_at: startedAt, source: { url: urls[0] }, dataset: { name: "Palantir TH verified event window", version: WINDOW_ID }, raw: payload, integrity: { content_hash: `sha256:${hash(payload)}`, algorithm: "sha256" }, processing: { status: "normalized" }, ingestion_run_id: runId };
    await db.collection<RawRecordDoc>("raw_records").updateOne({ _id: rawId }, { $setOnInsert: raw }, { upsert: true }); const sourceAttrs = Object.fromEntries(urls.map((url, i) => [`attributes.source_url_${i + 1}`, url])); const result = await db.collection<EventCandidateDoc>("event_candidates").updateOne({ _id: CANDIDATE_ID }, { $set: { ...update, ...sourceAttrs, "attributes.research_batch": WINDOW_ID, "attributes.enrichment_raw_record_id": rawId, "attributes.location_address": place, "attributes.source_count": urls.length } as never, $addToSet: { corroborating_sources: SOURCE_ID }, $pull: { unreported: { $in: ["severity", "casualties", "casualties.killed", "casualties.injured", "actors", "targets", "exact_time"] } } }); if (!result.matchedCount) throw new Error(`Existing candidate ${CANDIDATE_ID} was not found`); result.modifiedCount ? counts.updated++ : counts.duplicate++;
    await db.collection<IngestionRunDoc>("ingestion_runs").updateOne({ _id: runId }, { $set: { finished_at: new Date(), status: "success", records: counts } }); console.log(JSON.stringify({ runId, window: WINDOW_ID, counts }, null, 2));
  } catch (error) { await db.collection<IngestionRunDoc>("ingestion_runs").updateOne({ _id: runId }, { $set: { finished_at: new Date(), status: "failed", error: error instanceof Error ? error.message : String(error), records: { ...counts, failed: 1 } } }); throw error; } finally { await client.close(); }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
