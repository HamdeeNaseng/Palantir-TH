"use server";

import { createHash, randomUUID } from "node:crypto";
import { COLLECTIONS, getDb } from "@/lib/mongodb";
import { PROVINCE_BY_CODE, PROVINCE_BY_DDPM } from "@/lib/geo";
import {
  districtAt,
  districtsOfProvince,
  nearestVillage,
  representativePoint,
  subdistrictAt,
  type District,
} from "@/lib/geography";
import { EVENT_TYPE_LABEL } from "@/lib/labels";
import { pinGeoPrecision, REPORT_PIN, type ReportFormState } from "@/lib/report-form";
import {
  isHoneypotFilled,
  readReportForm,
  reportSchema,
  toFieldErrors,
  type FieldErrors,
  type ReportInput,
} from "@/lib/report-schema";
import type {
  CitizenReportDoc,
  EventCandidateDoc,
  EventMedia,
  GeoPrecision,
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
 *
 * The map pin is held to the same rule. A GPS fix taken at the scene is very
 * often a fix on the person filing the report, and every coordinate stored
 * here is published. So the browser snaps the pin to the ~110 m grid in
 * `REPORT_PIN` before submitting, this action snaps it again on arrival, and
 * the exact coordinate is never written down — not in `event_candidates`, and
 * not in the raw record either.
 */

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

/**
 * Resolves a submission that has already passed `reportSchema` into the real
 * geography it claims.
 *
 * A pin outranks the จังหวัด/อำเภอ selects rather than being checked against
 * them. The polygons decide which อำเภอ contains a point, so re-deriving is
 * both the stricter answer and the only one that keeps `location.district`
 * consistent with `location.geo` — which `validate-events` enforces.
 */
function resolvePlace(
  input: ReportInput,
):
  | { provinceCode: ProvinceCode; district: District; subdistrict: string | null }
  | { errors: FieldErrors } {
  if (input.pin) {
    const district = districtAt([input.pin.lng, input.pin.lat]);
    const provinceCode = district
      ? (PROVINCE_BY_DDPM.get(district.provinceCode)?.code ?? null)
      : null;
    if (!district || !provinceCode) {
      return {
        errors: {
          pin: "หมุดไม่ได้อยู่ในเขตอำเภอใด — อาจอยู่ในทะเลหรือนอกพื้นที่ กรุณาปักใหม่",
        },
      };
    }
    // ตำบล comes from the polygons too, for the same reason อำเภอ does: it is
    // the finest boundary DDPM publishes, and a name derived from geometry
    // beats one typed from memory.
    return {
      provinceCode,
      district,
      subdistrict: subdistrictAt([input.pin.lng, input.pin.lat])?.nameTh ?? null,
    };
  }

  const provinceCode = VALID_PROVINCES.has(input.provinceCode as never)
    ? (input.provinceCode as ProvinceCode)
    : null;
  if (!provinceCode) return { errors: { provinceCode: "กรุณาเลือกจังหวัด" } };

  // `districtsOfProvince` joins on the DDPM numeric code, not this app's
  // `ProvinceCode` string — see `PROVINCE_BY_CODE` in lib/geo.ts.
  const ddpmCode = PROVINCE_BY_CODE.get(provinceCode)?.ddpmCode;
  const district = ddpmCode
    ? districtsOfProvince(ddpmCode).find((d) => d.code === input.districtCode)
    : undefined;
  if (!district) return { errors: { districtCode: "กรุณาเลือกอำเภอจากรายการ" } };

  // With no pin there is no geometry to ask, so the reporter's own words stand.
  return { provinceCode, district, subdistrict: input.subdistrict };
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
  if (isHoneypotFilled(formData)) {
    return { status: "success", message: "ขอบคุณสำหรับการแจ้งเหตุ" };
  }

  const parsed = reportSchema.safeParse(readReportForm(formData));
  if (!parsed.success) {
    return {
      status: "error",
      message: "กรุณาตรวจสอบข้อมูลที่กรอก",
      fieldErrors: toFieldErrors(parsed.error),
    };
  }
  const r = parsed.data;

  // Shape was settled by the schema; this is the separate question of whether
  // the place named actually exists on the DDPM boundaries.
  const place = resolvePlace(r);
  if ("errors" in place) {
    return { status: "error", message: "กรุณาตรวจสอบข้อมูลที่กรอก", fieldErrors: place.errors };
  }
  const { district, provinceCode, subdistrict } = place;

  /**
   * Nearest mapped หมู่บ้าน, recorded as context rather than as a location.
   *
   * OpenStreetMap has roughly a fifth of the villages in these four
   * provinces, so this is stored with its distance and never substituted for
   * the coordinate — a name 1.8 km away is a landmark, not an address.
   */
  const village = place.subdistrict && r.pin ? nearestVillage([r.pin.lng, r.pin.lat]) : null;

  // Bangkok time: the wall clock the reporter read, not the server's.
  const occurredAt = new Date(`${r.occurredDate}T${r.occurredTime || "00:00"}:00+07:00`);
  const precision = r.occurredTime ? "minute" : "day";

  let db: Awaited<ReturnType<typeof getDb>>;
  try {
    db = await getDb();
  } catch {
    return {
      status: "error",
      message: "เชื่อมต่อฐานข้อมูลไม่ได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง",
    };
  }

  // With no pin the point is the อำเภอ's representative point, and it has to be
  // *exactly* that: `validate-events` layer 5 treats a district-precision
  // record sitting anywhere else as a coordinate misrepresenting itself.
  const [lng, lat] = r.pin ? [r.pin.lng, r.pin.lat] : representativePoint(district.geometry);
  const geoPrecision: GeoPrecision = r.pin ? pinGeoPrecision(r.pin.accuracyM) : "district";
  const provinceName = PROVINCE_BY_CODE.get(provinceCode)?.name ?? provinceCode;

  const raw = {
    title: r.title,
    description: r.description,
    event_type_hint: r.eventType,
    occurred_at: occurredAt.toISOString(),
    time_precision: precision,
    province: provinceName,
    district: district.nameTh,
    subdistrict,
    place: r.place,
    nearest_village: village && village.distanceM <= 2000 ? village.village.nameTh : null,
    nearest_village_distance_m: village && village.distanceM <= 2000 ? Math.round(village.distanceM) : null,
    killed: r.killed,
    injured: r.injured,
    media_urls: r.mediaUrls,
    // GeoJSON order — [longitude, latitude] — matching what is stored below.
    coordinates: r.pin ? [lng, lat] : null,
    coordinate_source: r.pin ? r.pin.source : null,
    // The grid it was rounded onto, so a reader of the archive knows.
    coordinate_grid_m: r.pin ? REPORT_PIN.gridM : null,
    gps_accuracy_m: r.pin?.accuracyM ?? null,
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

    const unreported = ["severity", "actors", "targets"];
    if (!r.pin) unreported.push("coordinates");
    if (r.killed === null) unreported.push("casualties.killed");
    if (r.injured === null) unreported.push("casualties.injured");
    if (!subdistrict) unreported.push("subdistrict");
    if (!r.place) unreported.push("place");
    if (!r.description) unreported.push("summary");
    if (r.mediaUrls.length === 0) unreported.push("media");

    const event: EventCandidateDoc = {
      _id: evtId,
      source_id: "src_citizen",
      raw_record_id: rawId,
      time: { start: occurredAt, precision },
      location: {
        province: provinceName,
        provinceCode,
        district: district.nameTh,
        subdistrict,
        place: r.place,
        geo: { type: "Point", coordinates: [lng, lat] },
        geo_precision: geoPrecision,
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
      provinceCode,
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
