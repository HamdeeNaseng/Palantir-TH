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

export type EventType =
  | "explosion" // ลอบวางระเบิด
  | "shooting" // ยิง/ประทะ
  | "arson" // วางเพลิง
  | "abduction" // ลักพาตัว
  | "raid" // ตรวจค้น/จับกุม
  | "unrest" // เหตุรุนแรง
  | "narcotics" // ยาเสพติด
  | "crime" // อาชญากรรม
  | "gang" // กิจกรรมกลุ่ม
  | "other";

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
    /** Never treat a district centroid as a GPS fix — see GeoPrecision. */
    geo_precision: GeoPrecision;
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
}
