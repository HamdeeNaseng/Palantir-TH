/** Import/enrich verified southern security incidents for 2-8 Aug 2026. */
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
const WINDOW_ID = "verified-window-2026-08-02-to-08";
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
    id: "evt_verified_20260803_lam_mai_police_station_shooting",
    at: "2026-08-03T07:55:00+07:00", precision: "minute",
    province: "ยะลา", provinceCode: "yala", district: "เมืองยะลา", subdistrict: "ลำใหม่",
    place: "บริเวณด้านหลังสถานีตำรวจภูธรลำใหม่ ตำบลลำใหม่ อำเภอเมืองยะลา จังหวัดยะลา", locationPrecision: "site",
    type: "shooting", title: "ยิงก่อกวนบริเวณด้านหลัง สภ.ลำใหม่", rawType: "ยิงก่อกวนสถานีตำรวจ",
    summary: "คนร้ายไม่ทราบจำนวนใช้อาวุธปืนสงครามยิงก่อกวนบริเวณด้านหลังสถานีตำรวจภูธรลำใหม่ เจ้าหน้าที่เข้าควบคุมและปิดกั้นพื้นที่ ไม่พบรายงานผู้เสียชีวิตหรือบาดเจ็บ",
    severity: 3, killed: 0, injured: 0, actors: ["คนร้ายไม่ทราบจำนวน"], targets: ["สถานีตำรวจภูธรลำใหม่", "เจ้าหน้าที่ตำรวจ"],
    urls: ["https://www.southpeace.go.th/?p=178472", "https://www.police9.go.th/%E0%B8%9C%E0%B8%9A%E0%B8%8A-%E0%B8%A0-9-%E0%B8%9E%E0%B8%A3%E0%B9%89%E0%B8%AD%E0%B8%A1%E0%B8%84%E0%B8%93%E0%B8%B0%E0%B8%9C%E0%B8%B9%E0%B9%89%E0%B8%9A%E0%B8%B1%E0%B8%87%E0%B8%84%E0%B8%B1%E0%B8%9A/"],
    attributes: { weapon_class: "อาวุธปืนสงคราม", alternate_reported_time: "2026-08-03T07:57:00+07:00" },
    unreported: ["coordinates", "weapon_type", "weapon_caliber", "perpetrator_identity", "perpetrator_count"],
  },
  {
    id: "evt_verified_20260803_wat_thep_nimit_ping_pong_bomb",
    at: "2026-08-03T08:40:00+07:00", precision: "minute",
    province: "ปัตตานี", provinceCode: "pattani", district: "ปะนาเระ", subdistrict: "บ้านกลาง",
    place: "วัดเทพนิมิต บ้านกลาง อำเภอปะนาเระ จังหวัดปัตตานี", locationPrecision: "site",
    type: "explosion", title: "ขว้างระเบิดปิงปองเข้าไปในวัดเทพนิมิต", rawType: "ขว้างระเบิดปิงปอง",
    summary: "คนร้ายไม่ทราบจำนวนขว้างระเบิดปิงปองพันด้วยเทปสายไฟเข้าไปในบริเวณวัดเทพนิมิต เจ้าหน้าที่ EOD เข้าตรวจสอบ ไม่พบผู้บาดเจ็บหรือความเสียหายร้ายแรง",
    severity: 2, killed: 0, injured: 0, actors: ["คนร้ายไม่ทราบจำนวน"], targets: ["วัดเทพนิมิต"],
    urls: ["https://www.southpeace.go.th/?p=178478", "https://www.nationtv.tv/news/current-issue/378981146"],
    attributes: { explosive_device: "ระเบิดปิงปองพันด้วยเทปสายไฟ", exact_time_source: "Nation TV" },
    unreported: ["coordinates", "perpetrator_identity", "perpetrator_count", "damage_value"],
  },
  {
    id: "evt_verified_20260803_mae_wat_pickup_theft",
    at: "2026-08-03T00:00:00+07:00", precision: "day",
    province: "ยะลา", provinceCode: "yala", district: "ธารโต", subdistrict: "แม่หวาด",
    place: "ตำบลแม่หวาด อำเภอธารโต จังหวัดยะลา", locationPrecision: "subdistrict",
    type: "crime", title: "โจรกรรมรถกระบะในตำบลแม่หวาด ก่อนพบรถภายหลัง", rawType: "โจรกรรมรถยนต์และแจ้งเตือนภัยความมั่นคง",
    summary: "รถกระบะ Mitsubishi สีขาว-ดำ รุ่นปี 2010 ทะเบียน บฉ 6999 ถูกโจรกรรมในตำบลแม่หวาด เจ้าหน้าที่แจ้งเตือนว่าอาจถูกนำไปใช้ก่อเหตุ ก่อนติดตามพบรถคันดังกล่าวภายในวันเดียวกันและนำเข้าสู่กระบวนการตรวจสอบ",
    severity: 2, killed: 0, injured: 0, actors: ["ผู้ก่อเหตุโจรกรรมไม่ทราบชื่อ"], targets: ["รถยนต์กระบะ"],
    urls: ["https://thaitv5hd.com/content/101812/%E0%B8%81%E0%B8%AD-%E0%B8%A3%E0%B8%A1%E0%B8%99-%E0%B8%A0%E0%B8%B2%E0%B8%84-4-%E0%B8%AA%E0%B8%99-%E0%B9%81%E0%B8%88%E0%B9%89%E0%B8%87%E0%B9%80%E0%B8%9D%E0%B9%89%E0%B8%B2%E0%B8%A3%E0%B8%B0%E0%B8%A7%E0%B8%B1%E0%B8%87%E0%B8%A3%E0%B8%96%E0%B8%96%E0%B8%B9%E0%B8%81%E0%B9%82%E0%B8%88%E0%B8%A3%E0%B8%81%E0%B8%A3%E0%B8%A3%E0%B8%A1-%E0%B8%9E%E0%B8%9A%E0%B9%80%E0%B8%AB%E0%B9%87%E0%B8%99%E0%B8%AD%E0%B8%A2%E0%B9%88%E0%B8%B2%E0%B9%80%E0%B8%82%E0%B9%89%E0%B8%B2%E0%B9%83%E0%B8%81%E0%B8%A5%E0%B9%89-%E0%B8%AD%E0%B8%A2%E0%B9%88%E0%B8%B2%E0%B8%AA%E0%B8%B1%E0%B8%A1%E0%B8%9C%E0%B8%B1%E0%B8%AA-%E0%B8%AD%E0%B8%A2%E0%B9%88%E0%B8%B2%E0%B8%95%E0%B8%B4%E0%B8%94%E0%B8%95%E0%B8%B2%E0%B8%A1%E0%B9%80%E0%B8%AD%E0%B8%87", "https://radionarathiwat.prd.go.th/th/content/category/detail/id/9/iid/528352"],
    attributes: { vehicle_make: "Mitsubishi", vehicle_color: "ขาว-ดำ", vehicle_year: 2010, vehicle_registration: "บฉ 6999", vehicle_recovered: true },
    unreported: ["coordinates", "exact_time", "perpetrator_identity", "recovery_location", "recovery_time"],
  },
  {
    id: "evt_verified_20260804_mayo_excise_office_shooting",
    at: "2026-08-04T11:24:00+07:00", precision: "minute",
    province: "ปัตตานี", provinceCode: "pattani", district: "มายอ", subdistrict: "ลางา",
    place: "สำนักงานสรรพสามิตพื้นที่ปัตตานี สาขามายอ เลขที่ 127/3 หมู่ 5 ตำบลลางา อำเภอมายอ จังหวัดปัตตานี", locationPrecision: "site",
    type: "shooting", title: "ยิงถล่มสำนักงานสรรพสามิตปัตตานี สาขามายอ", rawType: "ยิงถล่มสถานที่ราชการ",
    summary: "คนร้าย 2 คนขับขี่รถจักรยานยนต์และแต่งกายเลียนแบบผู้หญิงมุสลิม ใช้ปืนยาวยิง 16 นัดเข้าอาคารสำนักงานสรรพสามิต มีผู้บาดเจ็บ 2 ราย อาคารเสียหาย 16 จุดและรถจักรยานยนต์เสียหาย 1 คัน",
    severity: 4, killed: 0, injured: 2, actors: ["คนร้าย 2 คน"], targets: ["สำนักงานสรรพสามิตพื้นที่ปัตตานี สาขามายอ", "เจ้าหน้าที่ตำรวจ"],
    urls: ["https://www.thaigov.go.th/th/news/167221", "https://www.sbpac.go.th/home/?p=171425", "https://www.thairath.co.th/news/crime/2950521"],
    attributes: { weapon_class: "ปืนยาว", rounds_reported: 16, building_damage_points: 16, damaged_motorcycles: 1, alternate_reported_time_1: "2026-08-04T11:20:00+07:00", alternate_reported_time_2: "2026-08-04T11:40:00+07:00", time_conflict: true },
    unreported: ["coordinates", "perpetrator_identity", "motorcycle_registration", "damage_value"],
  },
  {
    id: "evt_verified_20260804_dusong_yo_official_vehicle_bombing",
    at: "2026-08-04T18:45:00+07:00", precision: "minute",
    province: "นราธิวาส", provinceCode: "narathiwat", district: "จะแนะ", subdistrict: "ดุซงญอ",
    place: "พื้นที่ตำบลดุซงญอ อำเภอจะแนะ จังหวัดนราธิวาส", locationPrecision: "subdistrict",
    type: "explosion", title: "ลอบวางระเบิดรถยนต์เจ้าหน้าที่ในตำบลดุซงญอ", rawType: "ลอบวางระเบิดรถยนต์เจ้าหน้าที่",
    summary: "คนร้ายลอบวางระเบิดรถยนต์ของเจ้าหน้าที่ในพื้นที่ตำบลดุซงญอ เจ้าหน้าที่เข้าควบคุมและตรวจสอบพื้นที่ เบื้องต้นไม่มีผู้ได้รับบาดเจ็บ",
    severity: 3, killed: 0, injured: 0, actors: ["คนร้ายไม่ทราบจำนวน"], targets: ["รถยนต์เจ้าหน้าที่", "เจ้าหน้าที่รัฐ"],
    urls: ["https://www.southpeace.go.th/?p=178744", "https://www.thaipbs.or.th/news/content/509027"],
    attributes: {}, unreported: ["coordinates", "exact_site", "explosive_device", "vehicle_damage", "damage_value", "perpetrator_identity", "perpetrator_count"],
  },
  {
    id: "evt_verified_20260805_sukhirin_enforcement_shootout",
    at: "2026-08-05T02:00:00+07:00", precision: "hour",
    province: "นราธิวาส", provinceCode: "narathiwat", district: "สุคิริน", subdistrict: "สุคิริน",
    place: "ขนำ บ้านน้ำตก หมู่ 5 ตำบลสุคิริน อำเภอสุคิริน จังหวัดนราธิวาส", locationPrecision: "site",
    type: "shooting", title: "ปะทะระหว่างปิดล้อมบังคับใช้กฎหมายที่บ้านน้ำตก", rawType: "ยิงปะทะระหว่างบังคับใช้กฎหมาย",
    summary: "เจ้าหน้าที่ปิดล้อมพื้นที่เป้าหมายตั้งแต่ประมาณ 02:00 น. ผู้ต้องสงสัยยิงต่อสู้จึงเกิดการปะทะ ผู้ต้องสงสัยเสียชีวิต 2 ราย เจ้าหน้าที่ทุกฝ่ายปลอดภัย และตรวจยึดอาวุธปืนของตำรวจที่ถูกนำไปจากเหตุยิง สภ.ตากใบ",
    severity: 5, killed: 2, injured: 0, actors: ["เจ้าหน้าที่ฝ่ายความมั่นคง", "ผู้ต้องสงสัย 2 ราย"], targets: ["ผู้ต้องสงสัยคดียิงตำรวจ สภ.ตากใบ"],
    urls: ["https://www.thaipbs.or.th/news/content/509050"],
    attributes: { operation_started_at: "2026-08-05T02:00:00+07:00", deceased_suspect_1: "นายอับดุลมูคลีส", deceased_suspect_2: "นายสะหมาน", police_casualties: 0, recovered_firearms: 3 },
    unreported: ["coordinates", "exact_shootout_time"],
  },
];

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function main(): Promise<void> {
  const client = await new MongoClient(process.env.MONGODB_URI ?? DEFAULT_URI, { serverSelectionTimeoutMS: 5_000 }).connect();
  const startedAt = new Date();
  const runId = `run_verified_20260802_08_${startedAt.toISOString().replace(/\D/g, "").slice(0, 14)}_${randomUUID().slice(0, 8)}`;
  const counts = { downloaded: 7, new: 0, updated: 0, duplicate: 0, failed: 0 };

  try {
    const db = client.db(process.env.MONGODB_DB ?? "palantir_th");
    const source: SourceRegistryDoc = {
      _id: SOURCE_ID, name: "Palantir TH manual research ledger", shortName: "Manual research", category: "research", priority: "P3",
      role: "Manually corroborated event enrichment", connector: { type: "FORM" }, schedule: { mode: "snapshot", frequency: "manual" },
      trust: { class: "manual_entry", score: 60 }, enabled: true,
    };
    await db.collection<SourceRegistryDoc>("source_registry").updateOne({ _id: SOURCE_ID }, { $setOnInsert: source }, { upsert: true });
    const run: IngestionRunDoc = { _id: runId, source_id: SOURCE_ID, started_at: startedAt, finished_at: null, status: "running", records: counts };
    await db.collection<IngestionRunDoc>("ingestion_runs").insertOne(run);

    const existingId = "evt_850925658c0bd56d767efd82";
    const enrichment = {
      record_type: "manual_research_enrichment", window_id: WINDOW_ID, candidate_id: existingId,
      incident: { occurred_at: "2026-08-02T11:48:00+07:00", address: "สวนปาล์มด้านหลัง อบต.ไพรวัน หมู่ 6 ตำบลไพรวัน อำเภอตากใบ จังหวัดนราธิวาส", casualties: { killed: 2, injured: 4 } },
      sources: ["https://www.southpeace.go.th/?p=178471", "https://www.southpeace.go.th/?p=178788", "https://www.js100.com/th/site/news/view/163403"],
      location_caveat: "Official reports use Ban Kubu and Ban Bueng Chalam for the Moo 6 area; retain the common site description behind Phrai Wan SAO.",
    };
    const enrichmentHash = hash(enrichment);
    const enrichmentRawId = `raw_manual_research_${enrichmentHash.slice(0, 24)}`;
    const enrichmentRaw: RawRecordDoc = {
      _id: enrichmentRawId, source_id: SOURCE_ID, external_id: `${WINDOW_ID}-existing-001`, retrieved_at: startedAt,
      source: { url: enrichment.sources[0] }, dataset: { name: "Palantir TH verified event window", version: WINDOW_ID }, raw: enrichment,
      integrity: { content_hash: `sha256:${enrichmentHash}`, algorithm: "sha256" }, processing: { status: "normalized" }, ingestion_run_id: runId,
    };
    await db.collection<RawRecordDoc>("raw_records").updateOne({ _id: enrichmentRawId }, { $setOnInsert: enrichmentRaw }, { upsert: true });
    const existingResult = await db.collection<EventCandidateDoc>("event_candidates").updateOne(
      { _id: existingId },
      { $set: {
        "time.start": new Date("2026-08-02T11:48:00+07:00"), "time.precision": "minute",
        "location.place": "สวนปาล์มด้านหลัง อบต.ไพรวัน หมู่ 6 ตำบลไพรวัน อำเภอตากใบ จังหวัดนราธิวาส",
        "event.type": "shooting", "event.title": "คนร้ายยิงตำรวจชุดสืบสวน สภ.ตากใบ ในสวนปาล์ม", "event.rawType": "ยิงเจ้าหน้าที่ตำรวจ",
        "event.summary": "ตำรวจชุดสืบสวน สภ.ตากใบ 6 นายถูกคนร้ายไม่ทราบจำนวนใช้อาวุธปืนสงครามยิง ระหว่างเดินทางกลับจากภารกิจตรวจค้นเป้าหมายในสวนปาล์ม ส่งผลให้ตำรวจเสียชีวิต 2 นายและบาดเจ็บ 4 นาย",
        severity: 5, verification: "verified", confidence: 95, casualties: { killed: 2, injured: 4 },
        actors: ["คนร้ายไม่ทราบจำนวน"], targets: ["ตำรวจชุดสืบสวน สภ.ตากใบ"],
        "attributes.research_batch": WINDOW_ID, "attributes.enrichment_raw_record_id": enrichmentRawId,
        "attributes.location_address": "สวนปาล์มด้านหลัง อบต.ไพรวัน หมู่ 6 ตำบลไพรวัน อำเภอตากใบ จังหวัดนราธิวาส",
        "attributes.location_name_conflict": "บ้านกูบู/บ้านบึงฉลาม", "attributes.source_count": 3,
        "attributes.source_url_1": enrichment.sources[0], "attributes.source_url_2": enrichment.sources[1], "attributes.source_url_3": enrichment.sources[2],
      }, $pull: { unreported: { $in: ["exact_time", "casualties", "casualties.killed", "casualties.injured", "actors", "targets"] } } },
    );
    if (!existingResult.matchedCount) throw new Error(`Existing SBPAC candidate ${existingId} was not found`);
    existingResult.modifiedCount ? counts.updated++ : counts.duplicate++;

    for (const event of newEvents) {
      try {
        const payload = { record_type: "manual_research_claim", window_id: WINDOW_ID, observed_event: event, caveat: "Manually corroborated claim record; not an original publisher payload." };
        const digest = hash(payload);
        const rawId = `raw_${event.id.replace(/^evt_/, "")}`;
        const raw: RawRecordDoc = {
          _id: rawId, source_id: SOURCE_ID, external_id: `${WINDOW_ID}-${event.id}`, retrieved_at: startedAt,
          source: { url: event.urls[0] }, dataset: { name: "Palantir TH verified event window", version: WINDOW_ID }, raw: payload,
          integrity: { content_hash: `sha256:${digest}`, algorithm: "sha256" }, processing: { status: "normalized" }, ingestion_run_id: runId,
        };
        await db.collection<RawRecordDoc>("raw_records").updateOne({ _id: rawId }, { $setOnInsert: raw }, { upsert: true });
        const candidate: EventCandidateDoc = {
          _id: event.id, source_id: SOURCE_ID, raw_record_id: rawId, time: { start: new Date(event.at), precision: event.precision },
          location: { province: event.province, provinceCode: event.provinceCode, district: event.district, subdistrict: event.subdistrict, place: event.place, geo: null, geo_precision: "unknown" },
          event: { type: event.type, title: event.title, summary: event.summary, rawType: event.rawType }, severity: event.severity,
          verification: "verified", confidence: event.urls.length > 1 ? 95 : 90, casualties: { killed: event.killed, injured: event.injured },
          actors: event.actors, targets: event.targets, corroborating_sources: [SOURCE_ID], media: [],
          attributes: { research_batch: WINDOW_ID, location_address: event.place, location_text_precision: event.locationPrecision, source_count: event.urls.length, source_url_1: event.urls[0], source_url_2: event.urls[1] ?? null, source_url_3: event.urls[2] ?? null, ...event.attributes },
          unreported: event.unreported,
        };
        const result = await db.collection<EventCandidateDoc>("event_candidates").updateOne({ _id: event.id }, { $setOnInsert: candidate }, { upsert: true });
        result.upsertedCount ? counts.new++ : counts.duplicate++;
      } catch (error) {
        counts.failed++;
        console.error(`${event.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    await db.collection<IngestionRunDoc>("ingestion_runs").updateOne({ _id: runId }, { $set: { finished_at: new Date(), status: counts.failed ? "partial" : "success", records: counts } });
    console.log(JSON.stringify({ runId, window: WINDOW_ID, counts }, null, 2));
  } catch (error) {
    await client.db(process.env.MONGODB_DB ?? "palantir_th").collection<IngestionRunDoc>("ingestion_runs").updateOne(
      { _id: runId }, { $set: { finished_at: new Date(), status: "failed", error: error instanceof Error ? error.message : String(error), records: { ...counts, failed: counts.failed + 1 } } },
    );
    throw error;
  } finally {
    await client.close();
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
