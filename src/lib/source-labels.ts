import type { IngestionRunDoc, SourceRegistryDoc, SourceTrustClass } from "./types";

/**
 * Display vocabulary for the source register (`/sources`).
 *
 * Split out of `labels.ts` rather than appended to it because that file is the
 * event vocabulary — type, severity, verification — and is imported by every
 * map layer and chart. Nothing that draws an event needs to know what a
 * connector or an ingestion status is called.
 *
 * Each label map is keyed by the union it renders, so a new trust class or run
 * status fails the build here instead of rendering as a raw identifier on the
 * page. Colours sit beside the labels for the same reason.
 */

export const TRUST_CLASS_LABEL: Record<SourceTrustClass, string> = {
  government: "หน่วยงานรัฐ",
  international: "องค์กรระหว่างประเทศ",
  external_dataset: "ชุดข้อมูลภายนอก",
  local_media: "สื่อท้องถิ่น",
  national_media: "สื่อกระแสหลัก",
  citizen_report: "รายงานจากประชาชน",
  manual_entry: "บันทึกโดยนักวิเคราะห์",
};

export const TRUST_CLASS_COLOR: Record<SourceTrustClass, string> = {
  government: "#38bdf8",
  international: "#22d3ee",
  external_dataset: "#a855f7",
  local_media: "#f59e0b",
  national_media: "#f97316",
  citizen_report: "#22c55e",
  manual_entry: "#64809f",
};

export const CONNECTOR_LABEL: Record<SourceRegistryDoc["connector"]["type"], string> = {
  REST_API: "REST API",
  SCRAPER: "Scraper",
  DATASET: "ชุดข้อมูล",
  FORM: "แบบฟอร์มรับแจ้ง",
};

export const SCHEDULE_MODE_LABEL: Record<SourceRegistryDoc["schedule"]["mode"], string> = {
  snapshot: "ภาพรวมทั้งชุด",
  incremental: "เพิ่มเฉพาะที่ใหม่",
  versioned: "แยกตามเวอร์ชัน",
};

export const RUN_STATUS_LABEL: Record<IngestionRunDoc["status"], string> = {
  success: "สำเร็จ",
  partial: "สำเร็จบางส่วน",
  failed: "ล้มเหลว",
  running: "กำลังทำงาน",
  skipped: "ข้าม",
};

export const RUN_STATUS_COLOR: Record<IngestionRunDoc["status"], string> = {
  success: "#22c55e",
  partial: "#f59e0b",
  failed: "#ef4444",
  running: "#38bdf8",
  skipped: "#64809f",
};

/**
 * Ingestion priority from the source catalog. P0 is the backbone the whole
 * register leans on, so it is the one colour that reads as an alert when its
 * last run failed.
 */
export const PRIORITY_COLOR: Record<SourceRegistryDoc["priority"], string> = {
  P0: "#ef4444",
  P1: "#f59e0b",
  P2: "#38bdf8",
  P3: "#64809f",
};

/**
 * `category` is the source's own catalog string, not a closed union — a new
 * importer can introduce one this app has never seen. Unknown values fall back
 * to the raw string rather than to "อื่น ๆ", because on this page the raw
 * string is the more useful of the two.
 */
const CATEGORY_LABEL: Record<string, string> = {
  conflict_event: "เหตุการณ์ความไม่สงบ",
  official_news: "ข่าวจากหน่วยงานรัฐ",
  external_dataset: "ชุดข้อมูลวิจัยภายนอก",
  research: "งานวิจัย/บันทึกภาคสนาม",
  citizen_report: "รายงานจากประชาชน",
  local_media: "สื่อท้องถิ่น",
  national_media: "สื่อกระแสหลัก",
};

export function categoryLabel(category: string): string {
  return CATEGORY_LABEL[category] ?? category;
}

/**
 * "เมื่อ 3 ชม. ที่แล้ว" for a freshness column.
 *
 * Takes epoch milliseconds and the reference time as arguments rather than
 * reading the clock itself: the caller is a server component, and a
 * `Date.now()` in here would make the rendered string depend on when the
 * module happened to run rather than on the request.
 */
export function relativeThai(ms: number | null, nowMs: number): string {
  if (ms === null) return "ไม่เคย";

  const diff = nowMs - ms;
  if (diff < 0) return "อีกไม่นาน";

  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "เมื่อสักครู่";
  if (minutes < 60) return `${minutes} นาทีที่แล้ว`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ชม. ที่แล้ว`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} วันที่แล้ว`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months} เดือนที่แล้ว`;

  return `${Math.floor(months / 12)} ปีที่แล้ว`;
}
