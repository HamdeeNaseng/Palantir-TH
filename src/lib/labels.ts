import type {
  CaseDoc,
  EventFamily,
  EventType,
  GeoPrecision,
  VerificationStatus,
} from "./types";

/**
 * Display labels shared by server and client.
 *
 * These live apart from `fixtures.ts` on purpose: fixtures reads boundary
 * GeoJSON off disk with `node:fs`, so anything importing it is server-only.
 * Client components need the labels but must not pull in that dependency.
 */

export const EVENT_TYPE_LABEL: Record<EventType, string> = {
  // "เหตุไม่สงบ", not "เหตุรุนแรง": the latter now names the whole family this
  // type sits in, and one label meaning two different scopes is unreadable in
  // a legend that shows both.
  unrest: "เหตุไม่สงบ",
  shooting: "ยิง/ปะทะ",
  raid: "ตรวจค้น/จับกุม",
  explosion: "ลอบวางระเบิด",
  arson: "วางเพลิง",
  narcotics: "ยาเสพติด",
  abduction: "ลักพาตัว",
  crime: "อาชญากรรม",
  gang: "กิจกรรมกลุ่ม",
  flood: "อุทกภัย",
  storm: "วาตภัย",
  landslide: "ดินโคลนถล่ม",
  wildfire: "ไฟป่า/หมอกควัน",
  drought: "ภัยแล้ง",
  fire: "อัคคีภัย",
  accident: "อุบัติเหตุ",
  other: "อื่น ๆ",
};

export const EVENT_FAMILY_LABEL: Record<EventFamily, string> = {
  violence: "เหตุรุนแรง",
  gang: "กิจกรรมกลุ่ม",
  narcotics: "ยาเสพติด",
  crime: "อาชญากรรม",
  disaster: "ภัยพิบัติธรรมชาติ",
  safety: "อุบัติภัย",
  other: "อื่น ๆ",
};

export const VERIFICATION_LABEL: Record<VerificationStatus, string> = {
  verified: "ยืนยันแล้ว",
  under_review: "อยู่ระหว่างตรวจสอบ",
  unverifiable: "ยังไม่สามารถยืนยันได้",
};

export const GEO_PRECISION_LABEL: Record<GeoPrecision, string> = {
  gps: "GPS",
  address: "ระดับที่อยู่",
  village: "centroid หมู่บ้าน",
  subdistrict: "centroid ตำบล",
  district: "centroid อำเภอ",
  province: "centroid จังหวัด",
  unknown: "ไม่ระบุ",
};

export const SEVERITY_LABEL = ["", "ต่ำ", "ปานกลาง", "สูง", "สูงมาก", "วิกฤต"] as const;

export const CASE_STATUS_LABEL: Record<CaseDoc["status"], string> = {
  investigating: "กำลังสืบสวน",
  monitoring: "เฝ้าติดตาม",
  closed: "ปิดเคสแล้ว",
};

/**
 * Colour for a case status chip. Kept beside the label so a new status cannot
 * be added with a label but no colour.
 */
export const CASE_STATUS_COLOR: Record<CaseDoc["status"], string> = {
  investigating: "#f59e0b",
  monitoring: "#38bdf8",
  closed: "#64748b",
};

/**
 * Band for a 0-100 risk index. The rail used to print "สูงมาก" next to every
 * score regardless of its value; the band has to follow the number.
 */
export function riskBand(score: number): { label: string; color: string } {
  if (score >= 80) return { label: "สูงมาก", color: "#ef4444" };
  if (score >= 60) return { label: "สูง", color: "#f97316" };
  if (score >= 40) return { label: "ปานกลาง", color: "#f59e0b" };
  if (score >= 20) return { label: "ต่ำ", color: "#84cc16" };
  return { label: "ต่ำมาก", color: "#22c55e" };
}

/** Indexed by `SeverityLevel`; index 0 is the "not reported" slot. */
export const SEVERITY_COLOR = [
  "", "#22c55e", "#84cc16", "#f59e0b", "#f97316", "#ef4444",
] as const;
