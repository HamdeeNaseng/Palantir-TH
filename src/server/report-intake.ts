"use server";

import { createHash, randomUUID } from "node:crypto";
import { COLLECTIONS, getDb } from "@/lib/mongodb";
import { PROVINCE_BY_CODE } from "@/lib/geo";
import { districtsOfProvince, representativePoint, type District } from "@/lib/geography";
import { EVENT_TYPE_LABEL } from "@/lib/labels";
import {
  HONEYPOT_FIELD,
  REPORT_EVENT_TYPES,
  REPORT_LIMITS,
  REPORT_MIN_DATE,
  type ReportFieldName,
  type ReportFormState,
} from "@/lib/report-form";
import type {
  CitizenReportDoc,
  EventCandidateDoc,
  EventMedia,
  EventType,
  IngestionRunDoc,
  ProvinceCode,
  RawRecordDoc,
  SourceRegistryDoc,
} from "@/lib/types";

/**
 * The citizen intake at `/report`, wired to the ladder in mockup/MVP.md:
 *
 *   raw_records (append-only, exactly what was submitted)
 *        -> event_candidates (normalized, still a claim — "under_review")
 *
 * plus a `citizen_reports` row, which is what feeds the aggregate signal panel
 * on `/investigate`. Nothing here ever edits a prior submission: a correction
 * would need to arrive as a new record referencing the old one, same as any
 * other source.
 *
 * No personal information is collected — no name, phone, or email field
 * exists on this form — because the raw payload flows straight through to the
 * public case-detail page at `/cases/[id]`. Collecting contact details would
 * mean deciding where they may and may not be displayed, which is a real
 * design problem this app has no authentication model to support yet.
 */

const VALID_EVENT_TYPES = new Set(REPORT_EVENT_TYPES.map((t) => t.value));
const VALID_PROVINCES = new Set(["pattani", "yala", "narathiwat", "songkhla"] as const);

/** Deterministic across retries so a stringified object always hashes the same. */
function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function guessMediaKind(url: string): EventMedia["kind"] {
  const ext = url.split(/[?#]/)[0].split(".").pop()?.toLowerCase() ?? "";
  if (["jpg", "jpeg", "png", "webp", "gif", "heic"].includes(ext)) return "image";
  if (["pdf", "doc", "docx"].includes(ext)) return "document";
  return "other";
}

/** `http(s)` only — an `<a href>` on the case page will otherwise execute it. */
function parseMediaUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

interface ValidatedReport {
  eventType: EventType;
  title: string;
  description: string | null;
  occurredAt: Date;
  precision: "minute" | "day";
  provinceCode: ProvinceCode;
  district: District;
  subdistrict: string | null;
  place: string | null;
  killed: number | null;
  injured: number | null;
  mediaUrls: string[];
}

type FieldErrors = Partial<Record<ReportFieldName, string>>;

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

/** Empty means "not reported" — never coerced to zero. */
function optionalCount(formData: FormData, key: string, errors: FieldErrors): number | null {
  const raw = str(formData, key);
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > REPORT_LIMITS.casualtyMax) {
    errors[key as ReportFieldName] = `กรอกเป็นจำนวนเต็ม 0–${REPORT_LIMITS.casualtyMax}`;
    return null;
  }
  return n;
}

/**
 * Read and validate every field. Rejects rather than guesses: an unlisted
 * province, an อำเภอ that is not really in that province, or a non-http(s)
 * evidence link all come back as a field error instead of being coerced into
 * something that merely looks plausible.
 */
function validate(formData: FormData): { data: ValidatedReport } | { errors: FieldErrors } {
  const errors: FieldErrors = {};

  const eventTypeRaw = str(formData, "eventType");
  const eventType = VALID_EVENT_TYPES.has(eventTypeRaw as EventType)
    ? (eventTypeRaw as EventType)
    : null;
  if (!eventType) errors.eventType = "กรุณาเลือกประเภทเหตุการณ์";

  const title = str(formData, "title");
  if (!title) errors.title = "กรุณากรอกหัวข้อ";
  else if (title.length > REPORT_LIMITS.title) errors.title = `ยาวเกิน ${REPORT_LIMITS.title} ตัวอักษร`;

  const description = str(formData, "description");
  if (description.length > REPORT_LIMITS.description) {
    errors.description = `ยาวเกิน ${REPORT_LIMITS.description} ตัวอักษร`;
  }

  const occurredDate = str(formData, "occurredDate");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(occurredDate)) {
    errors.occurredDate = "กรุณาระบุวันที่";
  } else if (occurredDate > today) {
    errors.occurredDate = "วันที่เกิดเหตุต้องไม่ใช่อนาคต";
  } else if (occurredDate < REPORT_MIN_DATE) {
    errors.occurredDate = `ต้องไม่ก่อน ${REPORT_MIN_DATE}`;
  }

  const occurredTimeRaw = str(formData, "occurredTime");
  const occurredTime = /^\d{2}:\d{2}$/.test(occurredTimeRaw) ? occurredTimeRaw : "";
  if (occurredTimeRaw && !occurredTime) errors.occurredTime = "รูปแบบเวลาไม่ถูกต้อง";

  const provinceCodeRaw = str(formData, "provinceCode");
  const provinceCode = VALID_PROVINCES.has(provinceCodeRaw as never)
    ? (provinceCodeRaw as ProvinceCode)
    : null;
  if (!provinceCode) errors.provinceCode = "กรุณาเลือกจังหวัด";

  const districtCode = str(formData, "districtCode");
  // `districtsOfProvince` joins on the DDPM numeric code, not this app's
  // `ProvinceCode` string — see `PROVINCE_BY_CODE` in lib/geo.ts.
  const ddpmCode = provinceCode ? PROVINCE_BY_CODE.get(provinceCode)?.ddpmCode : undefined;
  const district = ddpmCode
    ? districtsOfProvince(ddpmCode).find((d) => d.code === districtCode)
    : undefined;
  if (provinceCode && !district) errors.districtCode = "กรุณาเลือกอำเภอจากรายการ";

  const subdistrict = str(formData, "subdistrict").slice(0, REPORT_LIMITS.subdistrict);
  const place = str(formData, "place").slice(0, REPORT_LIMITS.place);

  const killed = optionalCount(formData, "killed", errors);
  const injured = optionalCount(formData, "injured", errors);

  const mediaUrls: string[] = [];
  for (const raw of formData.getAll("mediaUrl")) {
    const v = typeof raw === "string" ? raw.trim() : "";
    if (!v) continue;
    if (v.length > REPORT_LIMITS.mediaUrlLength || mediaUrls.length >= REPORT_LIMITS.mediaUrls) continue;
    const parsed = parseMediaUrl(v);
    if (parsed) mediaUrls.push(parsed);
    else errors.mediaUrls = "ลิงก์หลักฐานต้องขึ้นต้นด้วย http:// หรือ https://";
  }

  if (Object.keys(errors).length > 0 || !eventType || !provinceCode || !district) {
    return { errors };
  }

  const occurredAt = new Date(`${occurredDate}T${occurredTime || "00:00"}:00+07:00`);

  return {
    data: {
      eventType,
      title,
      description: description || null,
      occurredAt,
      precision: occurredTime ? "minute" : "day",
      provinceCode,
      district,
      subdistrict: subdistrict || null,
      place: place || null,
      killed,
      injured,
      mediaUrls,
    },
  };
}

/**
 * Registers the citizen-report source on first use.
 *
 * `$setOnInsert` makes this a create-if-missing, never an overwrite — the
 * registry entry follows the same append-only spirit as everything else here,
 * and it means this feature needs no destructive `db:seed --force` to enable.
 */
async function ensureCitizenSourceRegistered(db: Awaited<ReturnType<typeof getDb>>): Promise<void> {
  await db.collection<SourceRegistryDoc>(COLLECTIONS.sourceRegistry).updateOne(
    { _id: "src_citizen" },
    {
      $setOnInsert: {
        _id: "src_citizen",
        name: "รายงานจากประชาชน",
        shortName: "รายงานประชาชน",
        category: "citizen_report",
        priority: "P3",
        connector: { type: "FORM" },
        schedule: { mode: "incremental", frequency: "on submit" },
        trust: { class: "citizen_report", score: 35 },
        enabled: true,
      },
    },
    { upsert: true },
  );
}

const MONGO_DUPLICATE_KEY = 11000;
const isDuplicateKeyError = (err: unknown): boolean =>
  typeof err === "object" && err !== null && (err as { code?: number }).code === MONGO_DUPLICATE_KEY;

export async function submitCitizenReport(
  _prev: ReportFormState,
  formData: FormData,
): Promise<ReportFormState> {
  // Bots fill every field, including ones no citizen would see; pretend to
  // succeed without writing anything, so the trap costs the sender nothing to
  // learn it exists.
  if (str(formData, HONEYPOT_FIELD)) {
    return { status: "success", message: "ขอบคุณสำหรับการแจ้งเหตุ" };
  }

  const result = validate(formData);
  if ("errors" in result) {
    return {
      status: "error",
      message: "กรุณาตรวจสอบข้อมูลที่กรอก",
      fieldErrors: result.errors,
    };
  }
  const r = result.data;

  let db: Awaited<ReturnType<typeof getDb>>;
  try {
    db = await getDb();
  } catch {
    return {
      status: "error",
      message: "เชื่อมต่อฐานข้อมูลไม่ได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง",
    };
  }

  const district = r.district;
  const [lng, lat] = representativePoint(district.geometry);
  const provinceName = PROVINCE_BY_CODE.get(r.provinceCode)?.name ?? r.provinceCode;

  const raw = {
    title: r.title,
    description: r.description,
    event_type_hint: r.eventType,
    occurred_at: r.occurredAt.toISOString(),
    time_precision: r.precision,
    province: provinceName,
    district: district.nameTh,
    subdistrict: r.subdistrict,
    place: r.place,
    killed: r.killed,
    injured: r.injured,
    media_urls: r.mediaUrls,
    submitted_via: "web_form",
  };

  // Deliberately NOT mixed into the digest: a random id here would make every
  // submission hash unique regardless of content, defeating the one thing this
  // hash is for — catching an accidental double submit of the same report.
  const externalId = `citizen-${randomUUID()}`;
  const digest = sha256(`src_citizen\0${stableJson(raw)}`);
  const rawId = `raw_citizen_${digest.slice(0, 24)}`;
  const evtId = `evt_citizen_${digest.slice(0, 24)}`;
  const crId = `cr_citizen_${digest.slice(0, 24)}`;
  const runId = `run_citizen_${digest.slice(0, 16)}`;
  const now = new Date();

  try {
    await ensureCitizenSourceRegistered(db);

    const rawDoc: RawRecordDoc = {
      _id: rawId,
      source_id: "src_citizen",
      external_id: externalId,
      retrieved_at: now,
      source: { url: "" },
      raw,
      integrity: { content_hash: `sha256:${digest}`, algorithm: "sha256" },
      processing: { status: "normalized" },
      ingestion_run_id: runId,
    };

    try {
      await db.collection<RawRecordDoc>(COLLECTIONS.rawRecords).insertOne(rawDoc);
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
      // Identical content already recorded — most likely a double form
      // submit. Report the existing case rather than raising an error or
      // silently duplicating the record.
      const existing = await db
        .collection<EventCandidateDoc>(COLLECTIONS.eventCandidates)
        .findOne({ raw_record_id: rawId });
      return {
        status: "success",
        message: "รายงานนี้ถูกบันทึกไว้แล้ว",
        caseId: existing?._id ?? evtId,
      };
    }

    const run: IngestionRunDoc = {
      _id: runId,
      source_id: "src_citizen",
      started_at: now,
      finished_at: now,
      status: "success",
      records: { downloaded: 1, new: 1, updated: 0, duplicate: 0, failed: 0 },
    };
    await db.collection<IngestionRunDoc>(COLLECTIONS.ingestionRuns).insertOne(run);

    const unreported = ["severity", "actors", "targets", "coordinates"];
    if (r.killed === null) unreported.push("casualties.killed");
    if (r.injured === null) unreported.push("casualties.injured");
    if (!r.subdistrict) unreported.push("subdistrict");
    if (!r.place) unreported.push("place");
    if (!r.description) unreported.push("summary");
    if (r.mediaUrls.length === 0) unreported.push("media");

    const event: EventCandidateDoc = {
      _id: evtId,
      source_id: "src_citizen",
      raw_record_id: rawId,
      time: { start: r.occurredAt, precision: r.precision },
      location: {
        province: provinceName,
        provinceCode: r.provinceCode,
        district: district.nameTh,
        subdistrict: r.subdistrict,
        place: r.place,
        geo: { type: "Point", coordinates: [lng, lat] },
        geo_precision: "district",
      },
      event: {
        type: r.eventType,
        title: r.title,
        summary: r.description ?? undefined,
        rawType: null,
      },
      severity: null,
      verification: "under_review",
      confidence: 35,
      casualties: { killed: r.killed, injured: r.injured },
      actors: [],
      targets: [],
      corroborating_sources: ["src_citizen"],
      media: r.mediaUrls.map((url, i) => ({
        url,
        kind: guessMediaKind(url),
        field: `citizen_link_${i + 1}`,
      })),
      attributes: {},
      unreported,
    };
    await db.collection<EventCandidateDoc>(COLLECTIONS.eventCandidates).insertOne(event);

    const citizenReport: CitizenReportDoc = {
      _id: crId,
      reported_at: now,
      channel: "citizen",
      provinceCode: r.provinceCode,
      district: district.nameTh,
      topic: EVENT_TYPE_LABEL[r.eventType],
      became_fact: false,
    };
    await db.collection<CitizenReportDoc>(COLLECTIONS.citizenReports).insertOne(citizenReport);

    return { status: "success", caseId: evtId };
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      // The raw record was new but a downstream id collided — practically
      // unreachable since both ids derive from the same digest, but report
      // success rather than a false failure for a report that did get archived.
      return { status: "success", caseId: evtId };
    }
    console.error("[report-intake] submission failed", err);
    return {
      status: "error",
      message: "บันทึกรายงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
    };
  }
}
