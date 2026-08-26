import { EVENT_TYPES } from "./types";
import type { EventType, ProvinceCode, VerificationStatus } from "./types";

/**
 * Filters for the case register (`/cases`).
 *
 * Kept apart from `filters.ts` on purpose. The investigation dashboard narrows
 * by default — four provinces, trusted sources only — because it is answering
 * "what is happening in the focus area". The register is a lookup table over
 * the whole record, so its default is to hide nothing and let the analyst
 * narrow deliberately.
 */
export interface CaseFilters {
  /** Free text over title, place names, the source's own category, and the id. */
  q: string;
  /** Inclusive Bangkok-local date bounds, `YYYY-MM-DD`, empty when unbounded. */
  from: string;
  to: string;
  provinces: ProvinceCode[];
  /** ชื่ออำเภอ exactly as the source spelled it — the register's join key. */
  districts: string[];
  eventTypes: EventType[];
  verification: VerificationStatus[];
  /** A source_registry id, or "all". */
  sourceId: string;
  /** `location.place` — the source's own place category. */
  placeTypes: string[];
  /** Only records the source attached a photo or document to. */
  hasMedia: boolean;
  sort: CaseSortKey;
  dir: SortDir;
  /** 1-based. */
  page: number;
}

export type CaseSortKey = "date" | "province" | "type" | "verification" | "confidence";
export type SortDir = "asc" | "desc";

/** Rows per page. Large enough to scan, small enough to render server-side. */
export const CASES_PER_PAGE = 50;

/** Thailand has no DST, so a fixed offset is exact rather than an approximation. */
export const BANGKOK_OFFSET = "+07:00";

export const DEFAULT_CASE_FILTERS: CaseFilters = {
  q: "",
  from: "",
  to: "",
  provinces: [],
  districts: [],
  eventTypes: [],
  verification: [],
  sourceId: "all",
  placeTypes: [],
  hasMedia: false,
  sort: "date",
  dir: "desc",
  page: 1,
};

export const CASE_SORT_KEYS: readonly CaseSortKey[] = [
  "date",
  "province",
  "type",
  "verification",
  "confidence",
];

const PROVINCE_CODES = ["pattani", "yala", "narathiwat", "songkhla", "other"] as const;
const VERIFICATIONS = ["verified", "under_review", "unverifiable"] as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Comma-separated list constrained to a known vocabulary. */
const enumCsv = <T extends string>(v: string | undefined, allowed: readonly T[]): T[] => {
  if (!v) return [];
  return v.split(",").filter((p) => (allowed as readonly string[]).includes(p)) as T[];
};

/**
 * Comma-separated list of free-text values (district and place names come from
 * the data, not from a fixed vocabulary). Values are matched with `$in` against
 * exact strings, never interpolated into a regex, so no escaping is needed here.
 */
const freeCsv = (v: string | undefined): string[] =>
  v ? v.split(",").map((s) => s.trim()).filter(Boolean) : [];

export function parseCaseFilters(params: Params): CaseFilters {
  const d = DEFAULT_CASE_FILTERS;
  const sort = one(params.sort);
  const dir = one(params.dir);
  const page = Number.parseInt(one(params.page) ?? "", 10);
  const from = one(params.from) ?? "";
  const to = one(params.to) ?? "";

  return {
    q: (one(params.q) ?? "").trim().slice(0, 120),
    from: ISO_DATE.test(from) ? from : "",
    to: ISO_DATE.test(to) ? to : "",
    provinces: enumCsv(one(params.prov), PROVINCE_CODES),
    districts: freeCsv(one(params.dist)),
    eventTypes: enumCsv(one(params.type), EVENT_TYPES),
    verification: enumCsv(one(params.ver), VERIFICATIONS),
    sourceId: one(params.src) || d.sourceId,
    placeTypes: freeCsv(one(params.place)),
    hasMedia: one(params.media) === "1",
    sort: (CASE_SORT_KEYS as readonly string[]).includes(sort ?? "")
      ? (sort as CaseSortKey)
      : d.sort,
    dir: dir === "asc" || dir === "desc" ? dir : d.dir,
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

/** Inverse of `parseCaseFilters` — only non-default values reach the URL. */
export function serializeCaseFilters(f: CaseFilters): string {
  const d = DEFAULT_CASE_FILTERS;
  const q = new URLSearchParams();
  if (f.q) q.set("q", f.q);
  if (f.from) q.set("from", f.from);
  if (f.to) q.set("to", f.to);
  if (f.provinces.length) q.set("prov", f.provinces.join(","));
  if (f.districts.length) q.set("dist", f.districts.join(","));
  if (f.eventTypes.length) q.set("type", f.eventTypes.join(","));
  if (f.verification.length) q.set("ver", f.verification.join(","));
  if (f.sourceId !== d.sourceId) q.set("src", f.sourceId);
  if (f.placeTypes.length) q.set("place", f.placeTypes.join(","));
  if (f.hasMedia) q.set("media", "1");
  if (f.sort !== d.sort) q.set("sort", f.sort);
  if (f.dir !== d.dir) q.set("dir", f.dir);
  if (f.page > 1) q.set("page", String(f.page));
  return q.toString();
}

/**
 * List-page URL for `f` with `patch` applied. Any change other than paging
 * returns to page 1 — page 7 of a different result set is meaningless.
 *
 * `basePath` defaults to `/cases` but the same filter shape and URL encoding
 * serve `/report` (the citizen-report register) too — one query grammar for
 * every list view built on `CaseFilters`, rather than a parallel one per page.
 */
export function casesHref(
  f: CaseFilters,
  patch: Partial<CaseFilters> = {},
  basePath = "/cases",
): string {
  const next: CaseFilters = { ...f, ...patch };
  if (patch.page === undefined) next.page = 1;
  const qs = serializeCaseFilters(next);
  return qs ? `${basePath}?${qs}` : basePath;
}

/** True when nothing is narrowing the register (paging and sort aside). */
export function hasActiveCaseFilters(f: CaseFilters): boolean {
  const d = DEFAULT_CASE_FILTERS;
  return Boolean(
    f.q ||
      f.from ||
      f.to ||
      f.provinces.length ||
      f.districts.length ||
      f.eventTypes.length ||
      f.verification.length ||
      f.placeTypes.length ||
      f.hasMedia ||
      f.sourceId !== d.sourceId,
  );
}
