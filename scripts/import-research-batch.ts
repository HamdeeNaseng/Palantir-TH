/** Import the corroborated research ledger without rewriting prior raw claims. */
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
const BATCH_ID = "events-batch-001";
const DEFAULT_URI = "mongodb://root:changeme@localhost:27017/palantir_th?authSource=admin";

interface ResearchEvent {
  id: string;
  at: string;
  precision: "minute" | "day";
  province: string;
  provinceCode: "pattani" | "yala" | "narathiwat";
  district: string;
  subdistrict: string | null;
  address: string;
  addressPrecision: "site" | "village" | "road_segment";
  type: EventType;
  title: string;
  rawType: string;
  summary: string;
  injured: number | null;
  urls: string[];
  missing: string[];
}

const events: ResearchEvent[] = [
  {
    id: "001", at: "2026-08-24T00:00:00+07:00", precision: "day", province: "ปัตตานี", provinceCode: "pattani", district: "มายอ", subdistrict: "ลางา",
    address: "ร้านสะดวกซื้อสาขาบ้านตาแบ๊ะ บ้านตาแบ๊ะ หมู่ 3 ตำบลลางา อำเภอมายอ จังหวัดปัตตานี", addressPrecision: "site", type: "explosion",
    title: "เผาและวางระเบิดร้านสะดวกซื้อ บ้านตาแบ๊ะ", rawType: "วางเพลิงและวางระเบิด",
    summary: "เกิดเหตุเผาและวางระเบิดร้านสะดวกซื้อ ก่อนมีการปะทะเมื่อเจ้าหน้าที่เข้าตรวจพื้นที่ ไม่มีรายงานตำรวจหรือประชาชนบาดเจ็บ และมีการควบคุมวัยรุ่นต้องสงสัย 2 คนเพื่อสอบสวน",
    injured: 0, urls: ["https://www.thaipbs.or.th/news/content/509835"], missing: ["coordinates", "exact_time", "explosive_device", "damage_value", "casualties.killed"],
  },
  {
    id: "002", at: "2026-08-23T00:00:00+07:00", precision: "day", province: "ปัตตานี", provinceCode: "pattani", district: "ปะนาเระ", subdistrict: "พ่อมิ่ง",
    address: "เทศบาลตำบลพ่อมิ่ง เลขที่ 109/4 หมู่ 3 ตำบลพ่อมิ่ง อำเภอปะนาเระ จังหวัดปัตตานี 94130", addressPrecision: "site", type: "explosion",
    title: "เผาและวางระเบิดเทศบาลตำบลพ่อมิ่ง", rawType: "ควบคุมตัว วางเพลิง และวางระเบิด",
    summary: "ผู้ก่อเหตุควบคุม รปภ. 2 คน เผารถและสำนักงาน ก่อนวางระเบิดที่ป้อม รปภ. รถเสียหาย 3 คัน และสถานศึกษาใกล้เคียง 3 แห่งปิดเรียนชั่วคราว",
    injured: null, urls: ["https://www.thaipbs.or.th/news/content/509788", "https://www.porming.go.th/contact"], missing: ["coordinates", "exact_time", "casualties", "explosive_device", "damage_value"],
  },
  {
    id: "003", at: "2026-08-22T20:45:00+07:00", precision: "minute", province: "ปัตตานี", provinceCode: "pattani", district: "ยะหริ่ง", subdistrict: "บางปู",
    address: "ร้าน 7-Eleven บางปู หมู่ 3 ตำบลบางปู อำเภอยะหริ่ง จังหวัดปัตตานี", addressPrecision: "site", type: "arson",
    title: "โจมตีร้านสะดวกซื้อบริเวณสามแยกบางปู", rawType: "ยิงก่อกวน วางวัตถุต้องสงสัย และวางเพลิง/ระเบิด",
    summary: "กลุ่มติดอาวุธเข้าพื้นที่ร้านสะดวกซื้อและร้านได้รับความเสียหายจากไฟ รายงานแต่ละช่วงเรียกเหตุนี้ต่างกันว่าปล้น ระเบิดใกล้ร้าน หรือไฟไหม้ จึงยังไม่สรุปกลไกเดียว",
    injured: null, urls: ["https://www.nationthailand.com/news/general/40070139", "https://www.thaipbs.or.th/news/content/509759", "https://apnews.com/article/thailand-south-muslim-insurgency-narathiwat-pattani-yala-863364191d84b10bd82ea9b8e47e62ca"], missing: ["coordinates", "casualties", "explosive_device", "damage_value", "confirmed_attack_method"],
  },
  {
    id: "004", at: "2026-08-22T20:41:00+07:00", precision: "minute", province: "นราธิวาส", provinceCode: "narathiwat", district: "ระแงะ", subdistrict: null,
    address: "ช่วงรอยต่อบ้านกำปงปาเร๊ะ หมู่ 8 ตำบลมะรือโบตก–บ้านกูจิงลือปะ หมู่ 4 ตำบลเฉลิม อำเภอระแงะ จังหวัดนราธิวาส", addressPrecision: "road_segment", type: "explosion",
    title: "ระเบิดเส้นทางรอยต่อมะรือโบตก–เฉลิม", rawType: "ระเบิดบนหรือใกล้เส้นทาง", summary: "เกิดเหตุระเบิดบริเวณเส้นทางรอยต่อสองหมู่บ้าน รายงาน ณ ขณะนั้นระบุว่าไม่มีผู้บาดเจ็บ",
    injured: 0, urls: ["https://www.thaipbs.or.th/news/content/509752"], missing: ["coordinates", "casualties.killed", "explosive_device", "target", "case_number"],
  },
  {
    id: "005", at: "2026-08-22T20:10:00+07:00", precision: "minute", province: "นราธิวาส", provinceCode: "narathiwat", district: "ระแงะ", subdistrict: "บองอ",
    address: "ที่ทำการองค์การบริหารส่วนตำบลบองอ หมู่ 9 ตำบลบองอ อำเภอระแงะ จังหวัดนราธิวาส 96220", addressPrecision: "site", type: "arson",
    title: "วางเพลิง อบต.บองอ และนำรถราชการออกจากพื้นที่", rawType: "ควบคุมตัว วางเพลิง และนำรถราชการออกไป",
    summary: "รายงานเบื้องต้นระบุว่าผู้ก่อเหตุควบคุมและมัดมือ รปภ. ก่อนเผาอาคาร และนำรถกระบะ Mitsubishi Triton สีดำ ทะเบียน 2474 นราธิวาสออกจากพื้นที่",
    injured: null, urls: ["https://www.thaipbs.or.th/news/content/509752", "https://www.thaipbs.or.th/news/content/509759", "https://bo-ngo.go.th/public/list/data/detail/id/2809/menu/1700/page/1"], missing: ["coordinates", "casualties", "guard_status", "vehicle_recovery", "damage_value"],
  },
  {
    id: "006", at: "2026-08-22T00:00:00+07:00", precision: "day", province: "นราธิวาส", provinceCode: "narathiwat", district: "ระแงะ", subdistrict: null,
    address: "ทางรถไฟสายใต้ กม. 1090/6–7 ช่วงสถานีมะรือโบ–ตันหยงมัส อำเภอระแงะ จังหวัดนราธิวาส", addressPrecision: "site", type: "explosion",
    title: "ระเบิดทางรถไฟช่วงมะรือโบ–ตันหยงมัส", rawType: "ระเบิดทำลายโครงสร้างทางรถไฟ",
    summary: "ระเบิดทำให้ทางรถไฟเสียหายและต้องหยุดเดินรถชั่วคราว รฟท. ซ่อมแล้วเสร็จและเปิดเดินรถตามปกติเวลา 18:30 น. วันที่ 24 สิงหาคม 2569",
    injured: null, urls: ["https://www.thaipbs.or.th/news/content/509833", "https://apnews.com/article/thailand-south-muslim-insurgency-narathiwat-pattani-yala-863364191d84b10bd82ea9b8e47e62ca"], missing: ["coordinates", "exact_time", "casualties", "explosive_device", "repair_cost"],
  },
  {
    id: "007", at: "2026-08-22T00:00:00+07:00", precision: "day", province: "นราธิวาส", provinceCode: "narathiwat", district: "ระแงะ", subdistrict: "มะรือโบตก",
    address: "ศูนย์พัฒนาเด็กเล็กบ้านบูเก๊ะบือเราะ หมู่ 4 ตำบลมะรือโบตก อำเภอระแงะ จังหวัดนราธิวาส 96130", addressPrecision: "site", type: "explosion",
    title: "ระเบิดและยิงที่ศูนย์พัฒนาเด็กเล็กบ้านบูเก๊ะบือเราะ", rawType: "ระเบิดและยิงก่อกวน", summary: "รายงานเบื้องต้นระบุเหตุระเบิดและยิงที่ศูนย์พัฒนาเด็กเล็ก แต่ยังไม่มีตัวเลขผู้เสียหายเฉพาะจุดหรือรายละเอียดนิติวิทยาศาสตร์",
    injured: null, urls: ["https://www.thaipbs.or.th/news/content/509759", "https://www.thaipbs.or.th/news/content/509752"], missing: ["coordinates", "exact_time", "casualties", "occupancy", "weapons", "damage_value"],
  },
  {
    id: "008", at: "2026-08-22T00:00:00+07:00", precision: "day", province: "ยะลา", provinceCode: "yala", district: "ธารโต", subdistrict: "บ้านแหร",
    address: "ที่ทำการองค์การบริหารส่วนตำบลบ้านแหร หมู่ 4 ตำบลบ้านแหร อำเภอธารโต จังหวัดยะลา 95150", addressPrecision: "site", type: "arson",
    title: "เผารถและเสาสัญญาณในพื้นที่ อบต.บ้านแหร", rawType: "วางเพลิงรถราชการและเสาสัญญาณโทรคมนาคม", summary: "มีรายงานรถของ อบต. และเสาสัญญาณของสองเครือข่ายถูกเผา แต่จำนวนรถในรายงานยังคลาดเคลื่อน จึงไม่ล็อกจำนวนในระเบียนนี้",
    injured: null, urls: ["https://www.thaipbs.or.th/news/content/509759", "https://www.nationthailand.com/news/general/40070139"], missing: ["coordinates", "exact_time", "casualties", "confirmed_vehicle_count", "damage_value"],
  },
  {
    id: "009", at: "2026-08-22T00:00:00+07:00", precision: "day", province: "ปัตตานี", provinceCode: "pattani", district: "ยะรัง", subdistrict: "วัด",
    address: "พื้นที่ อบต.วัด บ้านวัด หมู่ 1 ตำบลวัด อำเภอยะรัง จังหวัดปัตตานี 94160", addressPrecision: "village", type: "arson",
    title: "เผารถขยะของ อบต.วัด", rawType: "วางเพลิงรถราชการ", summary: "รายงานเบื้องต้นระบุว่ารถขยะของ อบต.วัดถูกเผา 1 คัน แต่ยังไม่ยืนยันว่ารถจอดอยู่ภายในที่ทำการ อบต.",
    injured: null, urls: ["https://www.thaipbs.or.th/news/content/509759"], missing: ["coordinates", "exact_time", "casualties", "exact_site", "damage_value"],
  },
  {
    id: "010", at: "2026-08-22T00:00:00+07:00", precision: "day", province: "ปัตตานี", provinceCode: "pattani", district: "หนองจิก", subdistrict: "บางเขา",
    address: "ที่ทำการองค์การบริหารส่วนตำบลบางเขา หมู่ 1 ตำบลบางเขา อำเภอหนองจิก จังหวัดปัตตานี 94170", addressPrecision: "site", type: "arson",
    title: "เผารถดับเพลิงและรถขยะ อบต.บางเขา", rawType: "วางเพลิงรถฉุกเฉินและรถราชการ", summary: "การตรวจสถานที่ภายหลังพบรถดับเพลิง 1 คันและรถขยะ 1 คันเสียหายหนัก รวม 2 คัน และไม่มีรายงานผู้บาดเจ็บ",
    injured: 0, urls: ["https://www.thaipbs.or.th/news/content/509759", "https://www.thairath.co.th/news/local/south/2954700", "https://bangkhao.go.th/public/list/data/index/menu/1144"], missing: ["coordinates", "exact_time", "casualties.killed", "damage_value", "case_number"],
  },
];

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

async function main(): Promise<void> {
  const client = await new MongoClient(process.env.MONGODB_URI ?? DEFAULT_URI, { serverSelectionTimeoutMS: 5_000 }).connect();
  const startedAt = new Date();
  const runId = `run_${SOURCE_ID}_${startedAt.toISOString().replace(/\D/g, "").slice(0, 14)}_${randomUUID().slice(0, 8)}`;
  try {
    const db = client.db(process.env.MONGODB_DB ?? "palantir_th");
    const source: SourceRegistryDoc = {
      _id: SOURCE_ID, name: "Palantir TH manual research ledger", shortName: "Manual research", category: "research", priority: "P3",
      role: "Manually corroborated event enrichment", connector: { type: "FORM" }, schedule: { mode: "snapshot", frequency: "manual" },
      trust: { class: "manual_entry", score: 60 }, enabled: true,
    };
    await db.collection<SourceRegistryDoc>("source_registry").updateOne({ _id: SOURCE_ID }, { $set: source }, { upsert: true });
    const run: IngestionRunDoc = {
      _id: runId, source_id: SOURCE_ID, started_at: startedAt, finished_at: null, status: "running",
      records: { downloaded: events.length, new: 0, updated: 0, duplicate: 0, failed: 0 },
    };
    await db.collection<IngestionRunDoc>("ingestion_runs").insertOne(run);

    const counts = { downloaded: events.length, new: 0, updated: 0, duplicate: 0, failed: 0 };
    for (const input of events) {
      try {
        const rawPayload = {
          record_type: "manual_research_claim", research_batch: BATCH_ID, ledger_id: input.id,
          ledger_path: "research/events-batch-001.md", observed_event: input,
          caveat: "Manually corroborated claim record; not an original publisher payload.",
        };
        const digest = sha256(stableJson(rawPayload));
        const rawId = `raw_manual_research_${digest.slice(0, 24)}`;
        const raw: RawRecordDoc = {
          _id: rawId, source_id: SOURCE_ID, external_id: `${BATCH_ID}-${input.id}`, retrieved_at: startedAt,
          source: { url: input.urls[0] }, dataset: { name: "Palantir TH research ledger", version: BATCH_ID }, raw: rawPayload,
          integrity: { content_hash: `sha256:${digest}`, algorithm: "sha256" }, processing: { status: "normalized" }, ingestion_run_id: runId,
        };
        const rawResult = await db.collection<RawRecordDoc>("raw_records").updateOne(
          { "integrity.content_hash": raw.integrity.content_hash }, { $setOnInsert: raw }, { upsert: true },
        );
        rawResult.upsertedCount === 1 ? counts.new++ : counts.duplicate++;

        const candidate: EventCandidateDoc = {
          _id: `evt_manual_research_${digest.slice(0, 24)}`, source_id: SOURCE_ID, raw_record_id: rawId,
          time: { start: new Date(input.at), precision: input.precision },
          location: { province: input.province, provinceCode: input.provinceCode, district: input.district, subdistrict: input.subdistrict, place: input.address, geo: null, geo_precision: "unknown" },
          event: { type: input.type, title: input.title, summary: input.summary, rawType: input.rawType },
          severity: null, verification: "under_review", confidence: 60, casualties: { killed: null, injured: input.injured },
          actors: [], targets: [], corroborating_sources: [SOURCE_ID], media: [],
          attributes: {
            research_batch: BATCH_ID, ledger_id: input.id, location_address: input.address, location_text_precision: input.addressPrecision,
            source_count: input.urls.length, source_url_1: input.urls[0], source_url_2: input.urls[1] ?? null, source_url_3: input.urls[2] ?? null,
          },
          unreported: ["severity", "actors", "targets", ...input.missing],
        };
        await db.collection<EventCandidateDoc>("event_candidates").updateOne({ _id: candidate._id }, { $setOnInsert: candidate }, { upsert: true });
      } catch (error) {
        counts.failed++;
        console.error(`${input.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    await db.collection<IngestionRunDoc>("ingestion_runs").updateOne(
      { _id: runId }, { $set: { finished_at: new Date(), status: counts.failed ? "partial" : "success", records: counts } },
    );
    const [raw, candidates] = await Promise.all([
      db.collection("raw_records").countDocuments({ source_id: SOURCE_ID }),
      db.collection("event_candidates").countDocuments({ source_id: SOURCE_ID }),
    ]);
    console.log(JSON.stringify({ runId, counts, totals: { raw, candidates } }, null, 2));
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
