import { RANGE_DAYS, type InvestigationFilters } from "./filters";
import type {
  EventType,
  GeoPrecision,
  ProvinceCode,
  SeverityLevel,
  VerificationStatus,
} from "./types";

/**
 * The one dataset the browser keeps, and the filter ladder that runs over it.
 *
 * `/investigate` and `/events` used to re-query MongoDB on every filter click:
 * each tick of a checkbox pushed a URL, which re-rendered a `force-dynamic`
 * server page, which called `loadBundle()` — all 10,171 event documents, every
 * time, for a filter the browser could have applied itself. This module is the
 * shape that made that unnecessary: one snapshot, fetched whole, cached in
 * IndexedDB, filtered locally.
 *
 * Strictly isomorphic — no `mongodb`, no `node:fs`, nothing that cannot run in
 * a browser tab — because the same builders in `./view-models` run over it on
 * both sides. The server renders the first paint from a snapshot it just read;
 * the client re-renders every later filter from the snapshot it has. One
 * implementation, so the two can never disagree about what a filter means.
 *
 * A `SnapshotEvent` is a projection of `EventCandidateDoc`, not the document:
 * the raw docs are 10.11 MB of JSON, mostly the `attributes` bag of upstream
 * dataset columns that nothing on either page reads. Projected to what the
 * view models actually touch it is 5.14 MB (372 KB over the wire, gzipped),
 * and every date is already an epoch number, so the payload survives JSON
 * transport and `structuredClone` into IndexedDB without a revive pass.
 */

/**
 * Bumped whenever `SnapshotEvent` or its siblings change shape. A cached
 * snapshot written by an older build is discarded rather than fed to code that
 * expects a field it does not have — the cache is a convenience, never a
 * migration problem.
 */
export const SNAPSHOT_SCHEMA = 1;

/** Sources at or above this trust score satisfy "เฉพาะแหล่งข้อมูลที่เชื่อถือได้". */
export const TRUSTED_SCORE_FLOOR = 70;

export interface SnapshotEvent {
  id: string;
  /** `time.start` as epoch ms — the only time any view model reads. */
  ts: number;
  type: EventType;
  title: string;
  provinceCode: ProvinceCode;
  province: string;
  district: string;
  /** null when the source located the event no finer than an อำเภอ. */
  subdistrict: string | null;
  /** null together with `lat` when the source published no point at all. */
  lng: number | null;
  lat: number | null;
  precision: GeoPrecision | null;
  /** null when the source reported nothing implying severity. */
  severity: SeverityLevel | null;
  confidence: number;
  verification: VerificationStatus;
  killed: number | null;
  injured: number | null;
  /** `corroborating_sources` — ids into `Snapshot.sources`. */
  sources: string[];
  mediaCount: number;
  actorsCount: number;
  targetsCount: number;
}

export interface SnapshotSource {
  id: string;
  shortName: string;
  trustClass: string;
  trustScore: number;
}

export interface SnapshotCitizenReport {
  id: string;
  /** `reported_at` as epoch ms. */
  ts: number;
  channel: "citizen" | "local_news" | "social" | "network";
  provinceCode: ProvinceCode;
  district: string;
  topic: string;
  becameFact: boolean;
}

export interface SnapshotCaseUpdate {
  atMs: number;
  text: string;
  tag: "urgent" | "connected" | "new";
}

export interface SnapshotCase {
  id: string;
  code: string;
  title: string;
  status: "investigating" | "monitoring" | "closed";
  occurredAtMs: number;
  location: string;
  eventType: string;
  severity: SeverityLevel;
  riskScore: number;
  summary: string;
  entities: {
    people: number;
    groups: number;
    vehicles: number;
    phones: number;
    places: number;
    evidence: number;
  };
  updates: SnapshotCaseUpdate[];
}

export interface Snapshot {
  schema: number;
  /**
   * Changes if and only if the data changed. The client sends it back as an
   * `If-None-Match` and gets a 304 when nothing moved, so a five-minute poll
   * that finds no new events costs a few hundred bytes rather than 372 KB.
   */
  version: string;
  /** When the server read this out of MongoDB. */
  builtAtMs: number;
  /** False when MongoDB was unreachable — an honest empty state, never fixtures. */
  live: boolean;
  /** Ascending by `ts`, which every consumer relies on (binary search, spans). */
  events: SnapshotEvent[];
  sources: SnapshotSource[];
  citizenReports: SnapshotCitizenReport[];
  cases: SnapshotCase[];
  /**
   * How many อำเภอ each จังหวัด has, from the DDPM boundary files. Carried in
   * the payload because the boundaries are read with `node:fs` and the density
   * gauge's denominator is needed client-side, where there is no filesystem.
   */
  districtsByProvince: Record<string, number>;
}

/** The empty snapshot — what a client renders before its first fetch resolves. */
export const EMPTY_SNAPSHOT: Snapshot = {
  schema: SNAPSHOT_SCHEMA,
  version: "empty",
  builtAtMs: 0,
  live: false,
  events: [],
  sources: [],
  citizenReports: [],
  cases: [],
  districtsByProvince: {},
};

// -------------------------------------------------------------- filter ladder

/**
 * `windowsBack` shifts the window into the past by whole window lengths: 0 is
 * the current period, 1 the immediately preceding one (used for KPI deltas).
 * `nowMs` is threaded in explicitly rather than read off a module global, for
 * the same reason the server version is: one instant per computation, so two
 * halves of the same render cannot disagree about when "now" is.
 */
export function inRange(
  atMs: number,
  range: InvestigationFilters["range"],
  nowMs: number,
  windowsBack = 0,
): boolean {
  const days = RANGE_DAYS[range];
  if (days === null) return windowsBack === 0;
  const age = nowMs - atMs;
  const span = days * 86400000;
  return age > windowsBack * span && age <= (windowsBack + 1) * span;
}

/** Which filter dimension a facet count should compute with lifted. */
export type FilterDimension = "province" | "type" | "verification" | "source" | "trusted";

export interface MatchOptions {
  /** Skip this one condition — how a facet counts "what if this weren't ticked". */
  except?: FilterDimension;
  /** Defaults to `Date.now()`; pass one instant for every call in a render. */
  nowMs?: number;
  windowsBack?: number;
}

/** The ids of every source at or above the trust floor. */
export function trustedSourceIds(sources: SnapshotSource[]): Set<string> {
  return new Set(sources.filter((s) => s.trustScore >= TRUSTED_SCORE_FLOOR).map((s) => s.id));
}

/**
 * One bit per filter condition, so a single evaluation can answer both "does
 * this event match?" and "which one condition kept it out?".
 *
 * That second question is what a facet count is: "จังหวัด ยะลา 2,662" means
 * "how many would match if the province box were the only thing changed". The
 * pages used to answer it by running the whole ladder again per dimension —
 * four full passes over 10,171 events to produce three counts and one list.
 * With the failures in a bitmask, an event that fails nothing counts
 * everywhere, and an event that fails exactly one condition counts in that
 * dimension's facet, which is the same answer in one pass.
 */
export const FILTER_BIT = {
  range: 1 << 0,
  province: 1 << 1,
  type: 1 << 2,
  verification: 1 << 3,
  source: 1 << 4,
  trusted: 1 << 5,
} as const;

export type FilterBit = (typeof FILTER_BIT)[keyof typeof FILTER_BIT];

/**
 * Which conditions this event fails — 0 when it matches the filter outright.
 *
 * The one definition of what each filter means, shared by `matchSnapshotEvents`
 * and by every facet count on both pages. It deliberately evaluates all six
 * rather than short-circuiting: the caller needs to know *which* condition
 * failed, not merely that one did.
 */
export function failedConditions(
  e: SnapshotEvent,
  filters: InvestigationFilters,
  nowMs: number,
  trusted: ReadonlySet<string>,
  windowsBack = 0,
): number {
  let fail = 0;
  if (!inRange(e.ts, filters.range, nowMs, windowsBack)) fail |= FILTER_BIT.range;
  if (filters.provinces.length && !filters.provinces.includes(e.provinceCode)) {
    fail |= FILTER_BIT.province;
  }
  if (filters.eventTypes.length && !filters.eventTypes.includes(e.type)) fail |= FILTER_BIT.type;
  if (filters.verification.length && !filters.verification.includes(e.verification)) {
    fail |= FILTER_BIT.verification;
  }
  if (filters.sourceId !== "all" && !e.sources.includes(filters.sourceId)) fail |= FILTER_BIT.source;
  if (filters.trustedOnly && !e.sources.some((id) => trusted.has(id))) fail |= FILTER_BIT.trusted;
  return fail;
}

/** The bit a `FilterDimension` corresponds to, for `except`. */
const BIT_OF_DIMENSION: Record<FilterDimension, FilterBit> = {
  province: FILTER_BIT.province,
  type: FILTER_BIT.type,
  verification: FILTER_BIT.verification,
  source: FILTER_BIT.source,
  trusted: FILTER_BIT.trusted,
};

/**
 * Which events in `snapshot` satisfy `filters` — the browser-side twin of
 * `matchedEvents` in `@/server/shared-events`, condition for condition.
 *
 * Kept as one function both sides call rather than a client copy of the
 * server's ladder: two implementations of "what does this filter mean" is the
 * bug where a page's own facet counts stop agreeing with the map beside them.
 */
export function matchSnapshotEvents(
  snapshot: Pick<Snapshot, "events" | "sources">,
  filters: InvestigationFilters,
  opts: MatchOptions = {},
): SnapshotEvent[] {
  const nowMs = opts.nowMs ?? Date.now();
  const windowsBack = opts.windowsBack ?? 0;
  const ignored = opts.except ? BIT_OF_DIMENSION[opts.except] : 0;

  const trusted = trustedSourceIds(snapshot.sources);

  return snapshot.events.filter(
    (e) => (failedConditions(e, filters, nowMs, trusted, windowsBack) & ~ignored) === 0,
  );
}
