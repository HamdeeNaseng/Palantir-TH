import type { ProvinceCode } from "./types";

/**
 * Province metadata used for UI affordances — filter checkboxes, labels.
 *
 * Deliberately carries no geometry: shapes, district lists and coordinates all
 * come from the DDPM boundaries via `./geography`, so there is exactly one
 * source of truth for where things are. Keeping a parallel hand-written
 * geography here is what previously let district labels and coordinates drift
 * apart.
 */
export interface ProvinceMeta {
  code: ProvinceCode;
  /** DDPM numeric province code, the join key to the boundary data. */
  ddpmCode: string;
  name: string;
}

/** The four provinces covered by the Deep South conflict dataset. */
export const PROVINCES: ProvinceMeta[] = [
  { code: "pattani", ddpmCode: "94", name: "ปัตตานี" },
  { code: "yala", ddpmCode: "95", name: "ยะลา" },
  { code: "narathiwat", ddpmCode: "96", name: "นราธิวาส" },
  { code: "songkhla", ddpmCode: "90", name: "สงขลา" },
];

export const PROVINCE_BY_CODE = new Map(PROVINCES.map((p) => [p.code, p]));

/** Reverse of `PROVINCE_BY_CODE` — DDPM numeric code back to this app's own. */
export const PROVINCE_BY_DDPM = new Map(PROVINCES.map((p) => [p.ddpmCode, p]));
