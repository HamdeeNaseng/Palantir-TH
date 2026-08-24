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

/** `source_registry` — the catalogue of every ingestion source. */
export interface SourceRegistryDoc {
  _id: string;
  name: string;
  shortName: string;
  category: string;
  priority: "P1" | "P2" | "P3";
  connector: { type: "REST_API" | "SCRAPER" | "DATASET"; endpoint?: string };
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
  status: "success" | "partial" | "failed" | "running";
  records: {
    downloaded: number;
    new: number;
    updated: number;
    duplicate: number;
    failed: number;
  };
  error?: string;
}

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
    geo: GeoPoint;
  };
  event: { type: EventType; title: string; summary?: string };
  severity: SeverityLevel;
  verification: VerificationStatus;
  /** 0-100 — aggregate of corroborating source trust. */
  confidence: number;
  casualties: { killed: number; injured: number };
  actors: string[];
  targets: string[];
  /** source_registry ids that reported this same candidate. */
  corroborating_sources: string[];
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
