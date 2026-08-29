/**
 * Domain model for Palantir TH.
 *
 * Layering follows MVP.md:
 *   raw_records (immutable, append-only)
 *      -> event_candidates (normalized, still a *claim*)
 *      -> canonical_events (resolved across sources)
 *
 * Nothing downstream may mutate a raw record. New interpretations create a new
 * document that references the raw record it came from.
 */

export type ProvinceCode = "pattani" | "yala" | "narathiwat" | "songkhla" | "other";

/**
 * Every event category the system knows, in display order.
 *
 * This array — not a hand-written union — is the vocabulary. Filters, chips,
 * legends and the citizen intake form all derive from it, because the same
 * ten strings used to be re-typed in eight places and adding a category meant
 * finding all eight. `EventType` falls out of the array, so the type checker
 * now points at every `Record<EventType, …>` that has not caught up.
 *
 * The scope is สาธารณภัย as DDPM defines it, not conflict alone: the four
 * provinces flood every monsoon, and a flood that closes a road is exactly the
 * kind of thing a citizen opens this app to report.
 */
export const EVENT_TYPES = [
  // ความไม่สงบ
  "explosion", // ลอบวางระเบิด
  "shooting", // ยิง/ปะทะ
  "arson", // วางเพลิง
  "unrest", // เหตุไม่สงบ
  // กลุ่มเคลื่อนไหว
  "abduction", // ลักพาตัว
  "gang", // กิจกรรมกลุ่ม
  // บังคับใช้กฎหมาย / อาชญากรรม
  "raid", // ตรวจค้น/จับกุม
  "narcotics", // ยาเสพติด
  "crime", // อาชญากรรม
  // ภัยพิบัติธรรมชาติ
  "flood", // อุทกภัย
  "storm", // วาตภัย
  "landslide", // ดินโคลนถล่ม
  "wildfire", // ไฟป่า/หมอกควัน
  "drought", // ภัยแล้ง
  // อุบัติภัย
  "fire", // อัคคีภัย — ไฟไหม้ที่ยังไม่มีใครอ้างว่าจงใจ ต่างจาก arson
  "accident", // อุบัติเหตุ
  "other",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

/**
 * The coarse grouping every chart, legend and trend series rolls up to.
 *
 * Seventeen categories is more than any legend or colour scale can carry on
 * its own, so the family is what the eye is meant to read first and the type
 * is the detail underneath it. Splitting `disaster` from `safety` is not
 * decoration: a flood is a hazard nobody caused, a house fire is one somebody
 * might have, and merging them would put those two questions on one line.
 */
export type EventFamily =
  | "violence"
  | "gang"
  | "narcotics"
  | "crime"
  | "disaster"
  | "safety"
  | "other";

/** Display order for families. */
export const EVENT_FAMILIES: readonly EventFamily[] = [
  "violence",
  "gang",
  "narcotics",
  "crime",
  "disaster",
  "safety",
  "other",
];

export const EVENT_FAMILY: Record<EventType, EventFamily> = {
  explosion: "violence",
  shooting: "violence",
  arson: "violence",
  unrest: "violence",
  abduction: "gang",
  gang: "gang",
  narcotics: "narcotics",
  crime: "crime",
  flood: "disaster",
  storm: "disaster",
  landslide: "disaster",
  wildfire: "disaster",
  drought: "disaster",
  fire: "safety",
  accident: "safety",
  // `raid` is an enforcement action rather than an incident, and has always
  // been counted outside the violence trend it responds to. Left where it was.
  raid: "other",
  other: "other",
};

/** The types in one family, in the display order of `EVENT_TYPES`. */
export function typesInFamily(family: EventFamily): EventType[] {
  return EVENT_TYPES.filter((t) => EVENT_FAMILY[t] === family);
}

/** Where a record sits on the RAW -> CLAIM -> VERIFIED FACT ladder. */
export type VerificationStatus =
  | "verified" // ยืนยันแล้ว
  | "under_review" // อยู่ระหว่างตรวจสอบ
  | "unverifiable"; // ยังไม่สามารถยืนยันได้

export type SeverityLevel = 1 | 2 | 3 | 4 | 5;

/** Trust class of a source, per source_registry. */
export type SourceTrustClass =
  | "government" // หน่วยงานรัฐ
  | "international" // องค์กรระหว่างประเทศ
  | "external_dataset"
  | "local_media" // สื่อท้องถิ่น
  | "national_media" // สื่อกระแสหลัก
  | "citizen_report" // แหล่งข่าวไม่ทางการ / รายงานประชาชน
  | "manual_entry";

export interface GeoPoint {
  type: "Point";
  /** GeoJSON order: [lng, lat] — indexed with 2dsphere. */
  coordinates: [number, number];
}

/**
 * How the coordinates were arrived at. A GPS fix and a district centroid are
 * both "a point", but they must never be read as equally precise — clustering,
 * hotspot detection and any distance claim have to account for this. Stored
 * alongside the geometry rather than inferred from it.
 */
export type GeoPrecision =
  | "gps" // พิกัดจากอุปกรณ์/รายงานภาคสนาม
  | "address" // geocode ระดับที่อยู่
  | "village" // centroid ระดับหมู่บ้าน
  | "subdistrict" // centroid ระดับตำบล
  | "district" // centroid ระดับอำเภอ
  | "province" // centroid ระดับจังหวัด
  | "unknown";

/** Nominal positional error in metres, used to size uncertainty on the map. */
export const GEO_PRECISION_RADIUS_M: Record<GeoPrecision, number> = {
  gps: 30,
  address: 150,
  village: 800,
  subdistrict: 2500,
  district: 8000,
  province: 25000,
  unknown: 25000,
};

const GEO_PRECISION_VALUES = new Set<string>(Object.keys(GEO_PRECISION_RADIUS_M));

/**
 * A stored `geo_precision` as one of the seven values this app can reason
 * about.
 *
 * Ingestion does not enforce the vocabulary: 189 of the 10,173 records in the
 * current collection carry a free-form value its connector invented —
 * `subdistrict_reference_estimated`, `checkpoint_geolocated`,
 * `roadwork_site_estimated_via_superseded_event`. Indexing
 * `GEO_PRECISION_RADIUS_M` with one of those returns `undefined`, and an
 * `undefined` radius propagates as `NaN` into map geometry: the case page fit
 * its bounds from it and MapLibre rejected the whole viewport with "Invalid
 * LngLat object: (NaN, NaN)", leaving the map unframed and the caption reading
 * "คลาดเคลื่อนราว NaN กม.".
 *
 * Anything unrecognised is therefore `unknown` — the widest ring, 25 km.
 * Guessing a level from the string (`village_reference` → `village`) would be
 * inventing a precision claim the vocabulary never made; overstating the
 * uncertainty is the only direction that cannot make a coarse point look
 * sharper than it is.
 */
export function asGeoPrecision(value: string | null | undefined): GeoPrecision {
  return value && GEO_PRECISION_VALUES.has(value) ? (value as GeoPrecision) : "unknown";
}

/** The uncertainty radius for a stored `geo_precision`, never `undefined`. */
export function geoPrecisionRadiusM(value: string | null | undefined): number {
  return GEO_PRECISION_RADIUS_M[asGeoPrecision(value)];
}

/** `source_registry` — the catalogue of every ingestion source. */
export interface SourceRegistryDoc {
  _id: string;
  name: string;
  shortName: string;
  category: string;
  /** Ingestion priority, taken from mockup/Conflict Data Sources.md. */
  priority: "P0" | "P1" | "P2" | "P3";
  /**
   * บทบาทในระบบ — what this source is for, e.g. "Conflict Backbone",
   * "Official Claim", "External Event Validation". Also from the catalog.
   * Absent for sources that are not in the priority table.
   */
  role?: string;
  connector: {
    type:
      | "REST_API"
      | "SCRAPER"
      | "DATASET"
      /** A public submission form — the citizen-report intake at `/report`. */
      | "FORM";
    endpoint?: string;
  };
  schedule: { mode: "snapshot" | "incremental" | "versioned"; frequency: string };
  trust: { class: SourceTrustClass; /** 0-100, drives the reliability bars */ score: number };
  enabled: boolean;
}

/** `ingestion_runs` — one document per crawler/API execution. Observability. */
export interface IngestionRunDoc {
  _id: string;
  source_id: string;
  started_at: Date;
  finished_at: Date | null;
  status: "success" | "partial" | "failed" | "running" | "skipped";
  records: {
    downloaded: number;
    new: number;
    updated: number;
    duplicate: number;
    failed: number;
  };
  error?: string;
}

/**
 * `raw_records` — the source's own payload, archived exactly as received.
 *
 * Append-only: nothing downstream may edit one of these. `raw` is `unknown`
 * because each source's shape is its own — a JSON row from ศอ.บต., an HTML
 * body from Deep South Watch — and forcing them into a common shape here is
 * precisely the transformation this layer exists to defer.
 */
export interface RawRecordDoc {
  _id: string;
  source_id: string;
  external_id: string;
  retrieved_at: Date;
  source: {
    url: string;
    published_at?: Date;
    http_status?: number;
    content_type?: string;
    etag?: string;
    last_modified?: string;
  };
  dataset?: { name: string; version?: string };
  raw: unknown;
  /** Content hash of the payload, so tampering is detectable after the fact. */
  integrity: { content_hash: string; algorithm: "sha256" };
  processing: { status: "pending" | "normalized" };
  ingestion_run_id: string;
}

/** A file the source attached to a record — photo, document, scan. */
export interface EventMedia {
  url: string;
  kind: "image" | "document" | "other";
  /** Which source field it came from, e.g. "AccImage1". */
  field: string;
}

/**
 * Source values that have no canonical home. Kept verbatim and queryable so a
 * source's own vocabulary is not lost just because this schema has no column
 * for it — the full original still lives in the linked raw_record.
 */
export type EventAttributes = Record<string, string | number | boolean | null>;

/** `event_candidates` — normalized but NOT yet a verified fact. */
export interface EventCandidateDoc {
  _id: string;
  source_id: string;
  raw_record_id: string;
  time: { start: Date; precision: "minute" | "hour" | "day" };
  location: {
    province: string;
    provinceCode: ProvinceCode;
    district: string;
    /** ตำบล, when the source names one. */
    subdistrict: string | null;
    /** Free-text place description, e.g. a landmark or road. */
    place: string | null;
    /** null when the evidence names an address/site but publishes no defensible coordinates. */
    geo: GeoPoint | null;
    /**
     * Never treat a district centroid as a GPS fix — see GeoPrecision.
     *
     * Typed as the raw `string` it actually is, not as `GeoPrecision`: the
     * ingestion connectors write their own wording here and the collection
     * holds 30-odd distinct values. Every read must go through
     * `asGeoPrecision` / `geoPrecisionRadiusM`, and this type is what makes
     * the compiler say so.
     */
    geo_precision: string;
  };
  event: {
    type: EventType;
    title: string;
    summary?: string;
    /** The source's own category string, before mapping to EventType. */
    rawType: string | null;
  };
  /**
   * null when the source reports nothing that implies severity. Defaulting to
   * a number would put invented figures on the map; the view layer decides how
   * to present an unknown instead.
   */
  severity: SeverityLevel | null;
  verification: VerificationStatus;
  /** 0-100 — aggregate of corroborating source trust. */
  confidence: number;
  /**
   * null means the source did not report the figure — which is not the same as
   * reporting zero. Sources like ศอ.บต. Open Data carry no casualty fields at
   * all, and recording that as 0 would invent a fact the source never stated.
   */
  casualties: { killed: number | null; injured: number | null };
  actors: string[];
  targets: string[];
  /** source_registry ids that reported this same candidate. */
  corroborating_sources: string[];
  /** Files the source attached, e.g. scene photographs. */
  media: EventMedia[];
  /** Everything the source said that this schema has no field for. */
  attributes: EventAttributes;
  /**
   * Canonical fields this source does not supply, e.g. ["severity",
   * "casualties"]. Lets a query distinguish "not reported" from "reported as
   * nothing" without inspecting every field for null.
   */
  unreported: string[];
}

/** `canonical_events` — resolved across sources (Phase 4). */
export interface CanonicalEventDoc extends Omit<EventCandidateDoc, "_id" | "raw_record_id"> {
  _id: string;
  candidate_ids: string[];
  case_id?: string;
}

/** Investigation case an analyst is actively working. */
export interface CaseDoc {
  _id: string;
  code: string;
  title: string;
  status: "investigating" | "monitoring" | "closed";
  occurred_at: Date;
  location: string;
  event_type: string;
  severity: SeverityLevel;
  /** 0-100 risk index shown on the gauge. */
  risk_score: number;
  summary: string;
  entities: { people: number; groups: number; vehicles: number; phones: number; places: number; evidence: number };
  updates: { at: Date; text: string; tag: "urgent" | "connected" | "new" }[];
}

/**
 * `case_corrections` — what an analyst says the source got wrong.
 *
 * A separate document rather than an edit to `event_candidates`, for the same
 * reason `report-intake.ts` never edits a prior submission: the candidate is a
 * record of *what the source reported*, and the panel built on it is titled
 * accordingly. Overwriting it would quietly turn "แหล่งข้อมูลรายงานว่า" into
 * "someone typed", and there would be no way left to tell which one a given
 * value was.
 *
 * Append-only, like every other layer here. Correcting a correction means
 * writing another one; `effectiveEvent()` resolves the stack by taking the
 * newest value per field. Nothing is ever destroyed, so a wrong correction is
 * recoverable rather than fatal — which matters more than usual given this
 * app has no authentication to decide who may write one.
 */
export interface CaseCorrectionDoc {
  _id: string;
  /** The `event_candidates._id` this corrects. */
  event_id: string;
  corrected_at: Date;
  /**
   * Who claims to have made it. Free text and unverified — with no auth this
   * is an assertion about authorship, never evidence of it.
   */
  corrected_by: string | null;
  /** Why the source's value is believed wrong. The reason is the point. */
  note: string | null;
  /** Only the fields this correction actually changes. */
  changes: CaseCorrectionChanges;
}

/**
 * Every field an analyst may correct. Deliberately a small set: these are the
 * values that change what a case *means* on the map and in the register.
 * Anything absent is a field no correction can reach.
 *
 * `null` is a meaningful value here, not "unset" — it is how an analyst says
 * "the source's number is wrong and the truth is unknown", which is different
 * from leaving the source's number alone.
 */
export interface CaseCorrectionChanges {
  /** Where it actually happened — set by dragging the pin. */
  geo?: { coordinates: [number, number]; precision: GeoPrecision };
  event_type?: EventType;
  severity?: SeverityLevel | null;
  verification?: VerificationStatus;
  killed?: number | null;
  injured?: number | null;
  summary?: string | null;
}

/** The correctable field names, for iterating without hand-listing them twice. */
export const CORRECTABLE_FIELDS = [
  "geo",
  "event_type",
  "severity",
  "verification",
  "killed",
  "injured",
  "summary",
] as const satisfies readonly (keyof CaseCorrectionChanges)[];

/** Unofficial / citizen-sourced report — the lower-trust signal stream. */
export interface CitizenReportDoc {
  _id: string;
  reported_at: Date;
  channel: "citizen" | "local_news" | "social" | "network";
  provinceCode: ProvinceCode;
  district: string;
  topic: string;
  /** Did this report later get promoted to a verified fact? */
  became_fact: boolean;
  /**
   * reCAPTCHA v3 score, 0.0 (bot) to 1.0 (human). Absent on every report filed
   * before the captcha existed, and whenever it is unconfigured or Google was
   * unreachable — so a missing value means "not measured", never "suspicious".
   */
  captcha_score?: number;
}
