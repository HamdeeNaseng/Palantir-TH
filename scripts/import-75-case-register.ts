/** Reconcile the 22–24 Aug 2026 campaign register to the police total of 75. */
import { createHash, randomUUID } from "node:crypto";
import { MongoClient } from "mongodb";
import type { EventCandidateDoc, IngestionRunDoc, RawRecordDoc, SourceRegistryDoc } from "../src/lib/types";

const URI = process.env.MONGODB_URI ?? "mongodb://root:changeme@localhost:27017/palantir_th?authSource=admin";
const DB = process.env.MONGODB_DB ?? "palantir_th";
const SOURCE_ID = "src_campaign_20260822_police75";
const CAMPAIGN_ID = "south-unrest-2026-08-22-police-75";
const INITIAL_URL = "https://www.southpeace.go.th/?p=181425";
const FINAL_URL = "https://www.sbpac.go.th/home/?p=172228";
const AUDIT_URL = "https://isranews.org/article/south-news/scoop/148579-violencebb.html";

type Province = "pattani" | "yala" | "narathiwat";
interface DistrictTarget { provinceCode: Province; province: string; district: string; target: number }

// The official article says 51 incidents. Its printed district rows sum to 49;
// the unexplained two are retained as Yala/unallocated instead of invented.
const initialTargets: DistrictTarget[] = [
  { provinceCode: "narathiwat", province: "นราธิวาส", district: "จะแนะ", target: 4 },
  { provinceCode: "narathiwat", province: "นราธิวาส", district: "ศรีสาคร", target: 1 },
  { provinceCode: "narathiwat", province: "นราธิวาส", district: "แว้ง", target: 1 },
  { provinceCode: "narathiwat", province: "นราธิวาส", district: "บาเจาะ", target: 3 },
  { provinceCode: "narathiwat", province: "นราธิวาส", district: "เมืองนราธิวาส", target: 1 },
  { provinceCode: "narathiwat", province: "นราธิวาส", district: "เจาะไอร้อง", target: 1 },
  { provinceCode: "narathiwat", province: "นราธิวาส", district: "ระแงะ", target: 5 },
  { provinceCode: "narathiwat", province: "นราธิวาส", district: "สุไหงโก-ลก", target: 1 },
  { provinceCode: "narathiwat", province: "นราธิวาส", district: "ตากใบ", target: 2 },
  { provinceCode: "narathiwat", province: "นราธิวาส", district: "ยี่งอ", target: 1 },
  { provinceCode: "narathiwat", province: "นราธิวาส", district: "รือเสาะ", target: 1 },
  { provinceCode: "narathiwat", province: "นราธิวาส", district: "สุไหงปาดี", target: 1 },
  { provinceCode: "pattani", province: "ปัตตานี", district: "ยะรัง", target: 3 },
  { provinceCode: "pattani", province: "ปัตตานี", district: "ยะหริ่ง", target: 2 },
  { provinceCode: "pattani", province: "ปัตตานี", district: "หนองจิก", target: 3 },
  { provinceCode: "pattani", province: "ปัตตานี", district: "สายบุรี", target: 1 },
  { provinceCode: "pattani", province: "ปัตตานี", district: "ทุ่งยางแดง", target: 1 },
  { provinceCode: "pattani", province: "ปัตตานี", district: "โคกโพธิ์", target: 1 },
  { provinceCode: "yala", province: "ยะลา", district: "ธารโต", target: 8 },
  { provinceCode: "yala", province: "ยะลา", district: "บันนังสตา", target: 6 },
  { provinceCode: "yala", province: "ยะลา", district: "รามัน", target: 2 },
  { provinceCode: "yala", province: "ยะลา", district: "ไม่ระบุอำเภอ", target: 2 },
];

const start = new Date("2026-08-21T17:00:00.000Z");
const end = new Date("2026-08-25T17:00:00.000Z");
const digest = (text: string) => createHash("sha256").update(text).digest("hex");

async function main(): Promise<void> {
  const client = await new MongoClient(URI, { serverSelectionTimeoutMS: 5_000 }).connect();
  const now = new Date();
  const runId = `run_${SOURCE_ID}_${randomUUID().slice(0, 8)}`;
  try {
    const db = client.db(DB);
    const candidates = db.collection<EventCandidateDoc>("event_candidates");
    const existingFilter = { source_id: { $ne: SOURCE_ID }, "time.start": { $gte: start, $lt: end } };
    const existing = await candidates.find(existingFilter).toArray();
    if (existing.length !== 11) {
      throw new Error(`Expected 11 researched rows before reconciliation; found ${existing.length}. Refusing an ambiguous import.`);
    }

    const source: SourceRegistryDoc = {
      _id: SOURCE_ID,
      name: "ทะเบียนกระทบยอดเหตุ 22–24 ส.ค. 2569 (ยอดตำรวจ 75 เหตุการณ์)",
      shortName: "ตำรวจ/กอ.รมน. 75 เหตุ",
      category: "government_case_reconciliation",
      priority: "P2",
      role: "Count reconciliation; district detail follows the initial ISOC roster",
      connector: { type: "FORM", endpoint: FINAL_URL },
      schedule: { mode: "snapshot", frequency: "manual" },
      trust: { class: "government", score: 70 }, enabled: true,
    };
    await db.collection<SourceRegistryDoc>("source_registry").updateOne({ _id: SOURCE_ID }, { $set: source }, { upsert: true });
    const run: IngestionRunDoc = {
      _id: runId, source_id: SOURCE_ID, started_at: now, finished_at: null, status: "running",
      records: { downloaded: 64, new: 0, updated: 0, duplicate: 0, failed: 0 },
    };
    await db.collection<IngestionRunDoc>("ingestion_runs").insertOne(run);

    const existingByDistrict = new Map<string, number>();
    for (const row of existing.filter((row) => row.time.start < new Date("2026-08-22T17:00:00.000Z"))) {
      const key = `${row.location.provinceCode}|${row.location.district}`;
      existingByDistrict.set(key, (existingByDistrict.get(key) ?? 0) + 1);
    }

    const slots: Array<{ key: string; provinceCode: Province | "other"; province: string; district: string; place: string; phase: "initial-51" | "police-delta-24"; sourceUrl: string }> = [];
    for (const target of initialTargets) {
      const key = `${target.provinceCode}|${target.district}`;
      const residual = target.target - (existingByDistrict.get(key) ?? 0);
      if (residual < 0) throw new Error(`Existing rows exceed official target for ${key}`);
      for (let i = 1; i <= residual; i++) {
        slots.push({
          key: `initial-${target.provinceCode}-${target.district}-${i}`,
          provinceCode: target.provinceCode, province: target.province, district: target.district,
          place: target.district === "ไม่ระบุอำเภอ"
            ? "จังหวัดยะลา — บัญชีเผยแพร่ระบุยอดจังหวัด แต่ขาดชื่ออำเภอ 2 เหตุการณ์"
            : `อำเภอ${target.district} จังหวัด${target.province} — บัญชีเผยแพร่ไม่ระบุจุดย่อยรายเหตุ`,
          phase: "initial-51", sourceUrl: INITIAL_URL,
        });
      }
    }

    // Two of the later 24 are already represented by the researched Pho Ming
    // and Mayo rows. Police did not publish the remaining row-level locations.
    for (let i = 1; i <= 22; i++) {
      slots.push({
        key: `police-delta-${String(i).padStart(2, "0")}`,
        provinceCode: "other", province: "จังหวัดชายแดนภาคใต้", district: "ไม่เปิดเผยรายเหตุ (บัญชีตำรวจ)",
        place: "หนึ่งใน 27 อำเภอของจังหวัดยะลา ปัตตานี นราธิวาส และอำเภอเทพา จังหวัดสงขลา — ตำรวจไม่เผยแพร่ที่อยู่รายเหตุ",
        phase: "police-delta-24", sourceUrl: FINAL_URL,
      });
    }
    if (slots.length !== 64) throw new Error(`Reconciliation generated ${slots.length} rows, expected 64`);

    let inserted = 0;
    let duplicate = 0;
    for (const [index, slot] of slots.entries()) {
      const idHash = digest(`${CAMPAIGN_ID}\0${slot.key}`);
      const rawId = `raw_police75_${idHash.slice(0, 24)}`;
      const eventId = `evt_police75_${idHash.slice(0, 24)}`;
      const ordinal = index + 12;
      const rawPayload = {
        campaign_id: CAMPAIGN_ID, reconciliation_key: slot.key, phase: slot.phase,
        official_total: 75, location_statement: slot.place,
        caveat: "Count-backed registry slot. It is not an assertion of unpublished point-level details.",
        sources: [slot.sourceUrl, AUDIT_URL],
      };
      const rawHash = digest(JSON.stringify(rawPayload));
      const raw: RawRecordDoc = {
        _id: rawId, source_id: SOURCE_ID, external_id: `${CAMPAIGN_ID}-${slot.key}`,
        retrieved_at: now, source: { url: slot.sourceUrl }, dataset: { name: "Police 75-event reconciliation", version: "2026-08-24" },
        raw: rawPayload, integrity: { content_hash: `sha256:${rawHash}`, algorithm: "sha256" },
        processing: { status: "normalized" }, ingestion_run_id: runId,
      };
      await db.collection<RawRecordDoc>("raw_records").updateOne({ _id: rawId }, { $setOnInsert: raw }, { upsert: true });
      const candidate: EventCandidateDoc = {
        _id: eventId, source_id: SOURCE_ID, raw_record_id: rawId,
        time: { start: slot.phase === "initial-51" ? new Date("2026-08-22T13:00:00.000Z") : new Date("2026-08-23T00:00:00.000Z"), precision: "day" },
        location: { province: slot.province, provinceCode: slot.provinceCode, district: slot.district, subdistrict: null, place: slot.place, geo: null, geo_precision: "unknown" },
        event: {
          type: "unrest",
          title: slot.phase === "initial-51"
            ? `เหตุในบัญชี กอ.รมน. — ${slot.district} (ทะเบียนลำดับ ${ordinal}/75)`
            : `เหตุในยอดกระทบตำรวจที่ยังไม่เปิดเผยรายจุด (ทะเบียนลำดับ ${ordinal}/75)`,
          summary: slot.phase === "initial-51"
            ? "กอ.รมน.ภาค 4 สน. รับรองจำนวนเหตุในอำเภอนี้ แต่เอกสารสาธารณะไม่แจกแจงชนิด เวลา ตำบล หรือจุดเกิดเหตุของรายการนี้ จึงบันทึกเฉพาะระดับที่ยืนยันได้"
            : "ตำรวจยืนยันยอดรวม 75 เหตุการณ์ใน 27 อำเภอ แต่ข่าวแถลงไม่เผยแพร่บัญชีสถานที่รายเหตุ รายการนี้จึงเป็นช่องทะเบียนสำหรับรักษายอดทางการและต้องรอเลขคดี/สถานที่จากตำรวจ",
          rawType: "เหตุความไม่สงบ — รายละเอียดรายเหตุยังไม่เผยแพร่",
        },
        severity: null, verification: "under_review", confidence: slot.phase === "initial-51" ? 55 : 35,
        casualties: { killed: null, injured: null }, actors: [], targets: [], corroborating_sources: [SOURCE_ID], media: [],
        attributes: {
          campaign_id: CAMPAIGN_ID, campaign_ordinal: ordinal, reconciliation_phase: slot.phase,
          official_campaign_total: 75, provisional_case_slot: true,
          location_disclosure: slot.phase === "initial-51" ? "district_only" : "not_public",
          source_url_1: slot.sourceUrl, source_url_2: AUDIT_URL,
        },
        unreported: ["exact_time", "event_type", "severity", "casualties", "actors", "targets", "coordinates", "subdistrict", "exact_address", "police_case_number"],
      };
      const result = await candidates.updateOne({ _id: eventId }, { $setOnInsert: candidate }, { upsert: true });
      result.upsertedCount ? inserted++ : duplicate++;
    }

    const finalTotal = await candidates.countDocuments({ "time.start": { $gte: start, $lt: end } });
    const status = finalTotal === 75 ? "success" : "partial";
    await db.collection<IngestionRunDoc>("ingestion_runs").updateOne({ _id: runId }, {
      $set: { finished_at: new Date(), status, records: { downloaded: 64, new: inserted, updated: 0, duplicate, failed: finalTotal === 75 ? 0 : 1 } },
    });
    if (finalTotal !== 75) throw new Error(`Post-import window contains ${finalTotal} rows, expected exactly 75`);
    console.log(JSON.stringify({ runId, inserted, duplicate, finalTotal, campaignId: CAMPAIGN_ID }, null, 2));
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
