/** Import the verified 9 Aug 2026 Thung Yang Daeng police shooting. */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MongoClient } from "mongodb";
import type {
  EventCandidateDoc,
  IngestionRunDoc,
  RawRecordDoc,
  SourceRegistryDoc,
} from "../src/lib/types";

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
const EVENT_ID = "evt_verified_20260809_thung_yang_daeng_police_shooting";
const RAW_ID = "raw_verified_20260809_thung_yang_daeng_police_shooting";
const DEFAULT_URI = "mongodb://root:changeme@localhost:27017/palantir_th?authSource=admin";

const evidence = {
  record_type: "manual_research_claim",
  research_batch: "verified-window-2026-08-09-to-16",
  incident: {
    occurred_at_primary: "2026-08-09T11:40:00+07:00",
    occurred_at_conflicting_report: "2026-08-09T12:20:00+07:00",
    victim: "จ.ส.ต.ฮากีม กือจิ",
    victim_age: 32,
    victim_role: "เจ้าหน้าที่ตำรวจ สภ.ทุ่งยางแดง",
    progression: "ได้รับบาดเจ็บสาหัสและเสียชีวิตภายหลัง",
    final_casualties: { killed: 1, injured: 0 },
    address: "หมู่ 1 ตำบลน้ำดำ อำเภอทุ่งยางแดง จังหวัดปัตตานี",
  },
  sources: [
    {
      publisher: "กอ.รมน.ภาค 4 สน.",
      url: "https://www.southpeace.go.th/?p=179434",
      supports: ["วันที่และเวลา 11:40 น.", "ชื่อและอายุผู้เสียหาย", "สถานที่", "การนำส่งโรงพยาบาล"],
    },
    {
      publisher: "กอ.รมน.ภาค 4 สน.",
      url: "https://www.southpeace.go.th/?p=179584",
      supports: ["การเสียชีวิต", "ความเชื่อมโยงกับเหตุยิงวันที่ 9 สิงหาคม"],
    },
    {
      publisher: "ศอ.บต.",
      url: "https://www.sbpac.go.th/home/?p=171419",
      supports: ["การเสียชีวิต", "สถานที่", "เวลา 12:20 น. ซึ่งขัดกับรายงานแรก"],
    },
    {
      publisher: "ตำรวจภูธรภาค 9",
      url: "https://www.police9.go.th/%E0%B8%AA%E0%B8%94%E0%B8%B8%E0%B8%94%E0%B8%B5%E0%B8%95%E0%B8%B3%E0%B8%A3%E0%B8%A7%E0%B8%88%E0%B8%81%E0%B8%A5%E0%B9%89%E0%B8%B2-10/",
      supports: ["การเสียชีวิต", "สถานที่และวันที่เกิดเหตุ"],
    },
  ],
  caveat: "Manually corroborated claim record; not an original publisher payload.",
};

const contentHash = `sha256:${createHash("sha256").update(JSON.stringify(evidence)).digest("hex")}`;

async function main(): Promise<void> {
  const client = await new MongoClient(process.env.MONGODB_URI ?? DEFAULT_URI, {
    serverSelectionTimeoutMS: 5_000,
  }).connect();
  const startedAt = new Date();
  const runId = `run_verified_20260809_${startedAt.toISOString().replace(/\D/g, "").slice(0, 14)}_${randomUUID().slice(0, 8)}`;

  try {
    const db = client.db(process.env.MONGODB_DB ?? "palantir_th");
    const source: SourceRegistryDoc = {
      _id: SOURCE_ID,
      name: "Palantir TH manual research ledger",
      shortName: "Manual research",
      category: "research",
      priority: "P3",
      role: "Manually corroborated event enrichment",
      connector: { type: "FORM" },
      schedule: { mode: "snapshot", frequency: "manual" },
      trust: { class: "manual_entry", score: 60 },
      enabled: true,
    };
    await db.collection<SourceRegistryDoc>("source_registry").updateOne(
      { _id: SOURCE_ID },
      { $setOnInsert: source },
      { upsert: true },
    );

    const run: IngestionRunDoc = {
      _id: runId,
      source_id: SOURCE_ID,
      started_at: startedAt,
      finished_at: null,
      status: "running",
      records: { downloaded: 1, new: 0, updated: 0, duplicate: 0, failed: 0 },
    };
    await db.collection<IngestionRunDoc>("ingestion_runs").insertOne(run);

    const raw: RawRecordDoc = {
      _id: RAW_ID,
      source_id: SOURCE_ID,
      external_id: "verified-window-2026-08-09-to-16-001",
      retrieved_at: startedAt,
      source: { url: evidence.sources[0].url },
      dataset: { name: "Palantir TH verified event window", version: "2026-08-09-to-16" },
      raw: evidence,
      integrity: { content_hash: contentHash, algorithm: "sha256" },
      processing: { status: "normalized" },
      ingestion_run_id: runId,
    };
    const rawResult = await db.collection<RawRecordDoc>("raw_records").updateOne(
      { _id: RAW_ID },
      { $setOnInsert: raw },
      { upsert: true },
    );

    const candidate: EventCandidateDoc = {
      _id: EVENT_ID,
      source_id: SOURCE_ID,
      raw_record_id: RAW_ID,
      time: { start: new Date("2026-08-09T11:40:00+07:00"), precision: "minute" },
      location: {
        province: "ปัตตานี",
        provinceCode: "pattani",
        district: "ทุ่งยางแดง",
        subdistrict: "น้ำดำ",
        place: "หมู่ 1 ตำบลน้ำดำ อำเภอทุ่งยางแดง จังหวัดปัตตานี",
        geo: null,
        geo_precision: "unknown",
      },
      event: {
        type: "shooting",
        title: "ยิงตำรวจ สภ.ทุ่งยางแดง ที่ตำบลน้ำดำ",
        summary: "คนร้ายไม่ทราบจำนวนใช้อาวุธปืนยิง จ.ส.ต.ฮากีม กือจิ อายุ 32 ปี เจ้าหน้าที่ตำรวจ สภ.ทุ่งยางแดง ได้รับบาดเจ็บสาหัสก่อนเสียชีวิตภายหลัง รายงานแรกระบุเวลาเกิดเหตุ 11:40 น. ขณะที่ ศอ.บต. ระบุ 12:20 น.",
        rawType: "ยิงเจ้าหน้าที่ตำรวจ",
      },
      severity: 5,
      verification: "verified",
      confidence: 95,
      casualties: { killed: 1, injured: 0 },
      actors: ["คนร้ายไม่ทราบจำนวน"],
      targets: ["เจ้าหน้าที่ตำรวจ สภ.ทุ่งยางแดง"],
      corroborating_sources: [SOURCE_ID],
      media: [],
      attributes: {
        research_batch: "verified-window-2026-08-09-to-16",
        victim_name: "จ.ส.ต.ฮากีม กือจิ",
        victim_age: 32,
        victim_role: "เจ้าหน้าที่ตำรวจ สภ.ทุ่งยางแดง",
        location_address: "หมู่ 1 ตำบลน้ำดำ อำเภอทุ่งยางแดง จังหวัดปัตตานี",
        location_text_precision: "village",
        time_conflict: true,
        alternate_reported_time: "2026-08-09T12:20:00+07:00",
        casualty_progression: "บาดเจ็บสาหัสก่อนเสียชีวิตภายหลัง",
        source_count: 4,
        source_url_1: evidence.sources[0].url,
        source_url_2: evidence.sources[1].url,
        source_url_3: evidence.sources[2].url,
        source_url_4: evidence.sources[3].url,
      },
      unreported: ["coordinates", "weapon_type", "weapon_caliber", "perpetrator_identity", "perpetrator_count"],
    };
    const candidateResult = await db.collection<EventCandidateDoc>("event_candidates").updateOne(
      { _id: EVENT_ID },
      { $setOnInsert: candidate },
      { upsert: true },
    );

    const inserted = candidateResult.upsertedCount === 1;
    const records = {
      downloaded: 1,
      new: inserted ? 1 : 0,
      updated: 0,
      duplicate: inserted ? 0 : 1,
      failed: 0,
    };
    await db.collection<IngestionRunDoc>("ingestion_runs").updateOne(
      { _id: runId },
      { $set: { finished_at: new Date(), status: "success", records } },
    );

    console.log(JSON.stringify({ runId, eventId: EVENT_ID, rawInserted: rawResult.upsertedCount === 1, records }, null, 2));
  } catch (error) {
    await client.db(process.env.MONGODB_DB ?? "palantir_th").collection<IngestionRunDoc>("ingestion_runs").updateOne(
      { _id: runId },
      { $set: { finished_at: new Date(), status: "failed", error: error instanceof Error ? error.message : String(error), "records.failed": 1 } },
    );
    throw error;
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
