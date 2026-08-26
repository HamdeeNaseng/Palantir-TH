import { EVENT_FAMILIES, typesInFamily } from "./types";
import type { EventFamily, EventType, GeoPrecision } from "./types";
import { EVENT_FAMILY_LABEL, EVENT_TYPE_LABEL } from "./labels";

/**
 * Shared shape for the citizen-report intake at `/report`.
 *
 * Kept apart from `report-intake.ts` (the server action) so the client form
 * can import limits and labels without pulling in `node:crypto` or MongoDB —
 * the same client/server split `labels.ts` already draws for the rest of the
 * app.
 */

/**
 * Every category a citizen may file under, grouped by family for the select's
 * `<optgroup>`s.
 *
 * Seventeen options is too many for a flat list to scan, and the grouping is
 * also what makes the หมวดภัยพิบัติ findable at all — someone reporting น้ำท่วม
 * is not going to read past ลอบวางระเบิด hunting for it. The order follows
 * `EVENT_TYPES` so this form, the filter chips and the map legend all present
 * the vocabulary the same way round.
 */
export const REPORT_EVENT_GROUPS: {
  family: EventFamily;
  label: string;
  types: { value: EventType; label: string }[];
}[] = EVENT_FAMILIES.map((family) => ({
  family,
  label: EVENT_FAMILY_LABEL[family],
  types: typesInFamily(family).map((value) => ({ value, label: EVENT_TYPE_LABEL[value] })),
}));

export const REPORT_LIMITS = {
  title: 140,
  description: 2000,
  place: 160,
  subdistrict: 120,
  mediaUrls: 3,
  mediaUrlLength: 500,
  /** Casualty counts above this are almost certainly a typo, not a report. */
  casualtyMax: 999,
} as const;

/** Earliest date the form accepts — a round floor, not the dataset's actual start. */
export const REPORT_MIN_DATE = "2000-01-01";

/**
 * The map pin.
 *
 * A citizen can mark where the incident was, either from the device's own GPS
 * or by tapping the map. Two things about that are deliberate:
 *
 * 1. The coordinate is snapped to a ~110 m grid *in the browser*, before it is
 *    ever submitted. `raw_records` is rendered verbatim on the public
 *    `/cases/[id]` page, so a metre-accurate fix taken where the reporter is
 *    standing would publish the reporter, not just the incident. This app has
 *    no authentication model and therefore no private tier to hide an exact
 *    coordinate in — so the exact coordinate is never collected at all.
 *
 * 2. `geo_precision` is derived from the fix's own accuracy rather than
 *    assumed. A 30 m fix and a 900 m one are both "GPS"; storing them at the
 *    same precision would misreport the second one on every map that reads it.
 */
export const REPORT_PIN = {
  /** 0.001° is ~110 m at this latitude, so a point names a neighbourhood. */
  gridDecimals: 3,
  /** The grid spacing above, in metres — for UI copy and nothing else. */
  gridM: 110,
  /**
   * Beyond this the fix is worse than the อำเภอ centroid the form falls back
   * to, so it is rejected instead of stored as if it added anything.
   */
  maxAccuracyM: 2500,
  /** Cheap pre-filter around the four provinces; `districtAt` is the authority. */
  bounds: { minLng: 99.9, minLat: 5.4, maxLng: 102.3, maxLat: 8.2 },
} as const;

/** `gps` = straight from the device. `manual` = tapped or dragged into place. */
export type PinSource = "gps" | "manual";

/** The form fields a pin travels in. */
export const PIN_FIELDS = {
  lng: "pinLng",
  lat: "pinLat",
  accuracy: "pinAccuracy",
  source: "pinSource",
} as const;

/**
 * Round onto the shared grid. Applied on both sides: the browser snaps so the
 * citizen sees the point that will actually be stored, and the server snaps
 * again so a hand-built POST cannot bypass it. Rounding twice is harmless —
 * the operation is idempotent.
 */
export function snapToPinGrid(lng: number, lat: number): [number, number] {
  const f = 10 ** REPORT_PIN.gridDecimals;
  return [Math.round(lng * f) / f, Math.round(lat * f) / f];
}

/**
 * How precise the stored point honestly is.
 *
 * Never "gps": that precision class means a 30 m fix, and the grid above has
 * already spent up to 78 m of it. Never coarser than "subdistrict" either —
 * "district" and above are reserved for centroids, and `validate-events`
 * enforces that a point at those precisions *is* the district's representative
 * point rather than some position inside it.
 */
export function pinGeoPrecision(accuracyM: number | null): GeoPrecision {
  if (accuracyM === null || accuracyM <= 150) return "address";
  if (accuracyM <= 800) return "village";
  return "subdistrict";
}

/** Inside the rough box around the four provinces. */
export function isInServiceArea(lng: number, lat: number): boolean {
  const b = REPORT_PIN.bounds;
  return lng >= b.minLng && lng <= b.maxLng && lat >= b.minLat && lat <= b.maxLat;
}

/** Classic honeypot bait: a field a real citizen has no reason to fill in. */
export const HONEYPOT_FIELD = "organization";

export type ReportFieldName =
  | "eventType"
  | "title"
  | "description"
  | "occurredDate"
  | "occurredTime"
  | "provinceCode"
  | "districtCode"
  | "subdistrict"
  | "place"
  | "killed"
  | "injured"
  | "mediaUrls"
  | "pin";

export interface ReportFormState {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Partial<Record<ReportFieldName, string>>;
  /** Set on success — the case the submission was recorded as. */
  caseId?: string;
}

export const REPORT_FORM_IDLE: ReportFormState = { status: "idle" };

/** One province's selectable districts, sent to the client as plain data. */
export interface DistrictOption {
  code: string;
  name: string;
}
