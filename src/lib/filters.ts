import type { EventType, ProvinceCode, VerificationStatus } from "./types";

export interface InvestigationFilters {
  range: "1d" | "7d" | "30d" | "90d" | "all";
  provinces: ProvinceCode[];
  eventTypes: EventType[];
  verification: VerificationStatus[];
  sourceId: string;
  trustedOnly: boolean;
}

export const DEFAULT_FILTERS: InvestigationFilters = {
  /**
   * The ingested sources are a historical conflict record spanning 2002 to the
   * present, not a live feed. A 30-day default matched 2 of 10,041 events and
   * made the dashboard look broken, so the full record is the useful starting
   * point and narrowing is the deliberate act.
   */
  range: "all",
  provinces: ["pattani", "yala", "narathiwat", "songkhla"],
  eventTypes: [],
  verification: ["verified", "under_review"],
  sourceId: "all",
  trustedOnly: true,
};

export const RANGE_OPTIONS: { value: InvestigationFilters["range"]; label: string }[] = [
  { value: "1d", label: "วันนี้" },
  { value: "7d", label: "7 วันที่ผ่านมา" },
  { value: "30d", label: "30 วันที่ผ่านมา" },
  { value: "90d", label: "90 วันที่ผ่านมา" },
  { value: "all", label: "ทั้งหมด" },
];

export const RANGE_DAYS: Record<InvestigationFilters["range"], number | null> = {
  "1d": 1,
  "7d": 7,
  "30d": 30,
  "90d": 90,
  all: null,
};

const csv = <T extends string>(v: string | undefined, allowed: readonly T[]): T[] | null => {
  if (v === undefined) return null;
  if (v === "") return [];
  const parts = v.split(",").filter((p) => (allowed as readonly string[]).includes(p)) as T[];
  return parts;
};

const RANGES = ["1d", "7d", "30d", "90d", "all"] as const;
const PROVINCE_CODES = ["pattani", "yala", "narathiwat", "songkhla", "other"] as const;
const EVENT_TYPES = [
  "explosion", "shooting", "arson", "abduction", "raid",
  "unrest", "narcotics", "crime", "gang", "other",
] as const;
const VERIFICATIONS = ["verified", "under_review", "unverifiable"] as const;

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Read filters out of the page's search params, falling back to the defaults. */
export function parseFilters(params: Params): InvestigationFilters {
  const range = one(params.range);
  return {
    range: (RANGES as readonly string[]).includes(range ?? "")
      ? (range as InvestigationFilters["range"])
      : DEFAULT_FILTERS.range,
    provinces: csv(one(params.prov), PROVINCE_CODES) ?? DEFAULT_FILTERS.provinces,
    eventTypes: csv(one(params.type), EVENT_TYPES) ?? DEFAULT_FILTERS.eventTypes,
    verification: csv(one(params.ver), VERIFICATIONS) ?? DEFAULT_FILTERS.verification,
    sourceId: one(params.src) ?? DEFAULT_FILTERS.sourceId,
    trustedOnly: one(params.trusted) !== undefined
      ? one(params.trusted) === "1"
      : DEFAULT_FILTERS.trustedOnly,
  };
}

/** Inverse of `parseFilters` — only non-default values are written to the URL. */
export function serializeFilters(f: InvestigationFilters): string {
  const q = new URLSearchParams();
  if (f.range !== DEFAULT_FILTERS.range) q.set("range", f.range);
  q.set("prov", f.provinces.join(","));
  q.set("type", f.eventTypes.join(","));
  q.set("ver", f.verification.join(","));
  if (f.sourceId !== "all") q.set("src", f.sourceId);
  q.set("trusted", f.trustedOnly ? "1" : "0");
  return q.toString();
}
