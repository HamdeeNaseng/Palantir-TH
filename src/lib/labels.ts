import type { EventType, GeoPrecision, VerificationStatus } from "./types";

/**
 * Display labels shared by server and client.
 *
 * These live apart from `fixtures.ts` on purpose: fixtures reads boundary
 * GeoJSON off disk with `node:fs`, so anything importing it is server-only.
 * Client components need the labels but must not pull in that dependency.
 */

export const EVENT_TYPE_LABEL: Record<EventType, string> = {
  unrest: "เหตุรุนแรง",
  shooting: "ยิง/ประทะ",
  raid: "ตรวจค้น/จับกุม",
  explosion: "ลอบวางระเบิด",
  arson: "วางเพลิง",
  narcotics: "ยาเสพติด",
  abduction: "ลักพาตัว",
  crime: "อาชญากรรม",
  gang: "กิจกรรมกลุ่ม",
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
