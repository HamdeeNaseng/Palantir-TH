/** Append evidence for the 23–25 Aug window and enrich the matched candidates. */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MongoClient } from "mongodb";
import type { EventCandidateDoc, IngestionRunDoc, RawRecordDoc } from "../src/lib/types";

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
const WINDOW_ID = "events-window-2026-08-23-to-25";
const DEFAULT_URI = "mongodb://root:changeme@localhost:27017/palantir_th?authSource=admin";

const supplements = [
  {
    ledgerId: "001",
    occurredAt: "2026-08-24T20:00:00+07:00",
    title: "เผาและวางระเบิดร้าน 7-Eleven สาขาตาแบ๊ะ ก่อนปะทะตำรวจ",
    summary: "เวลาประมาณ 20:00 น. ผู้ก่อเหตุเข้าไล่พนักงานและลูกค้าออกจากร้าน ยิงข่มขู่ วางระเบิดแสวงเครื่องและวางเพลิง ก่อนปะทะกับตำรวจระหว่างหลบหนี ภายหลังพบปลอกกระสุน 9 มม. และรอยเลือดในพื้นที่ ร้านเสียหายเกือบทั้งหมด และควบคุมผู้ต้องสงสัย 2 รายเพื่อเข้าสู่กระบวนการตรวจสอบ",
    urls: ["https://www.southpeace.go.th/?p=181815", "https://www.thaipbs.or.th/news/content/509855"],
    evidence: { exact_time: "ประมาณ 20:00", explosive_device: "ระเบิดแสวงเครื่อง", cartridge: "9 มม.", blood_trace: true, injured: 0, killed: 0 },
  },
  {
    ledgerId: "002",
    occurredAt: "2026-08-23T21:10:00+07:00",
    title: "โจมตี วางเพลิง และวางระเบิดเทศบาลตำบลพ่อมิ่ง",
    summary: "เวลาประมาณ 21:10 น. กลุ่มติดอาวุธเข้าโจมตีและวางเพลิงสำนักงานกับโรงจอดรถเทศบาลตำบลพ่อมิ่ง พร้อมวางระเบิดบริเวณป้อม รปภ. รถเทศบาลเสียหาย 3 คัน และสถานศึกษาใกล้เคียงปิดชั่วคราว รายงานติดตามระบุว่าไม่มีผู้เสียชีวิตหรือบาดเจ็บ",
    urls: ["https://www.thaipbs.or.th/news/content/509788", "https://www.amarintv.com/news/politic/555661", "https://www.porming.go.th/contact"],
    evidence: { exact_time: "ประมาณ 21:10", damaged_vehicles: 3, injured: 0, killed: 0 },
  },
] as const;

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function main(): Promise<void> {
  const client = await new MongoClient(process.env.MONGODB_URI ?? DEFAULT_URI, { serverSelectionTimeoutMS: 5_000 }).connect();
  const startedAt = new Date();
  const runId = `run_${SOURCE_ID}_${startedAt.toISOString().replace(/\D/g, "").slice(0, 14)}_${randomUUID().slice(0, 8)}`;
  try {
    const db = client.db(process.env.MONGODB_DB ?? "palantir_th");
    const run: IngestionRunDoc = {
      _id: runId,
      source_id: SOURCE_ID,
      started_at: startedAt,
      finished_at: null,
      status: "running",
      records: { downloaded: supplements.length, new: 0, updated: 0, duplicate: 0, failed: 0 },
    };
    await db.collection<IngestionRunDoc>("ingestion_runs").insertOne(run);
    const counts = { downloaded: supplements.length, new: 0, updated: 0, duplicate: 0, failed: 0 };

    for (const supplement of supplements) {
      try {
        const candidate = await db.collection<EventCandidateDoc>("event_candidates").findOne({
          source_id: SOURCE_ID,
          "attributes.research_batch": "events-batch-001",
          "attributes.ledger_id": supplement.ledgerId,
        });
        if (!candidate) throw new Error(`candidate ledger ${supplement.ledgerId} not found`);

        const rawPayload = {
          record_type: "manual_research_enrichment",
          window_id: WINDOW_ID,
          ledger_id: supplement.ledgerId,
          candidate_id: candidate._id,
          ledger_path: "research/events-window-2026-08-23-to-25.md",
          evidence: supplement.evidence,
          source_urls: supplement.urls,
        };
        const digest = hash(rawPayload);
        const rawId = `raw_manual_research_${digest.slice(0, 24)}`;
        const raw: RawRecordDoc = {
          _id: rawId,
          source_id: SOURCE_ID,
          external_id: `${WINDOW_ID}-${supplement.ledgerId}`,
          retrieved_at: startedAt,
          source: { url: supplement.urls[0] },
          dataset: { name: "Palantir TH recent event window", version: WINDOW_ID },
          raw: rawPayload,
          integrity: { content_hash: `sha256:${digest}`, algorithm: "sha256" },
          processing: { status: "normalized" },
          ingestion_run_id: runId,
        };
        const rawResult = await db.collection<RawRecordDoc>("raw_records").updateOne(
          { "integrity.content_hash": raw.integrity.content_hash },
          { $setOnInsert: raw },
          { upsert: true },
        );
        rawResult.upsertedCount === 1 ? counts.new++ : counts.duplicate++;

        const before = {
          time: candidate.time,
          title: candidate.event.title,
          summary: candidate.event.summary,
          casualties: candidate.casualties,
        };
        await db.collection<{ _id: string } & Record<string, unknown>>("processing_logs").updateOne(
          { _id: `proc_recent_${digest.slice(0, 24)}` },
          {
            $setOnInsert: {
              _id: `proc_recent_${digest.slice(0, 24)}`,
              at: startedAt,
              operation: "manual_evidence_enrichment",
              candidate_id: candidate._id,
              evidence_raw_record_id: rawId,
              before,
              after: { occurred_at: supplement.occurredAt, title: supplement.title, summary: supplement.summary, casualties: { killed: 0, injured: 0 } },
            },
          },
          { upsert: true },
        );
        await db.collection<EventCandidateDoc>("event_candidates").updateOne(
          { _id: candidate._id },
          {
            $set: {
              "time.start": new Date(supplement.occurredAt),
              "time.precision": "minute",
              "event.title": supplement.title,
              "event.summary": supplement.summary,
              casualties: { killed: 0, injured: 0 },
              "attributes.recent_window": WINDOW_ID,
              "attributes.enrichment_raw_record_id": rawId,
              "attributes.source_count": supplement.urls.length,
              "attributes.source_url_1": supplement.urls[0],
              "attributes.source_url_2": supplement.urls[1] ?? null,
              "attributes.source_url_3": supplement.urls[2] ?? null,
            },
            $pull: { unreported: { $in: ["exact_time", "casualties", "casualties.killed"] } },
          },
        );
        counts.updated++;
      } catch (error) {
        counts.failed++;
        console.error(`${supplement.ledgerId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    await db.collection<IngestionRunDoc>("ingestion_runs").updateOne(
      { _id: runId },
      { $set: { finished_at: new Date(), status: counts.failed ? "partial" : "success", records: counts } },
    );
    console.log(JSON.stringify({ runId, window: WINDOW_ID, events: supplements.length, counts }, null, 2));
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
