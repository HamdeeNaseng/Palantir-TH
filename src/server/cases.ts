import type { Filter, Sort } from "mongodb";
import { effectiveEvent, type EffectiveEvent } from "@/lib/case-correction";
import { COLLECTIONS, getDb } from "@/lib/mongodb";
import { EVENT_TYPE_LABEL, SEVERITY_LABEL, VERIFICATION_LABEL } from "@/lib/labels";
import { PROVINCE_BY_CODE } from "@/lib/geo";
import { loadDistricts, loadSubdistricts, representativePoint } from "@/lib/geography";
import { EVENT_COLOR } from "@/lib/palette";
import {
  BANGKOK_OFFSET,
  CASES_PER_PAGE,
  type CaseFilters,
  type CaseSortKey,
} from "@/lib/case-filters";
import type {
  CaseCorrectionDoc,
  EventCandidateDoc,
  GeoPrecision,
  EventType,
  IngestionRunDoc,
  ProvinceCode,
  RawRecordDoc,
  SourceRegistryDoc,
  VerificationStatus,
} from "@/lib/types";

/**
 * Query layer for the case register (`/cases`).
 *
 * Unlike `investigate.ts`, which pulls every candidate into the app and filters
 * in memory, this pages and counts inside MongoDB. The register is a lookup
 * over the whole record — 10k documents today, and the whole point of the table
 * is that it keeps working when that number grows — so shipping the collection
 * to the app on every keystroke would be the wrong shape from the start.
 */

/** Anything a case row needs; a shape the client can serialize. */
export interface CaseRow {
  id: string;
  at: Date;
  /** How precisely the source dated it — a day-precision record has no clock. */
  timePrecision: EventCandidateDoc["time"]["precision"];
  title: string;
  type: EventType;
  typeLabel: string;
  typeColor: string;
  /** The source's own category string, before it was mapped to `type`. */
  rawType: string | null;
  province: string;
  provinceCode: ProvinceCode;
  district: string;
  subdistrict: string | null;
  place: string | null;
  verification: VerificationStatus;
  verificationLabel: string;
  /** null when the source reported nothing implying severity. */
  severity: number | null;
  severityLabel: string;
  confidence: number;
  sourceId: string;
  sourceName: string;
  mediaCount: number;
  /** How many canonical fields this source does not supply at all. */
  unreportedCount: number;
}

export interface CaseFacets {
  provinces: { code: ProvinceCode; label: string; n: number }[];
  districts: { name: string; province: string; n: number }[];
  eventTypes: { value: EventType; label: string; color: string; n: number }[];
  verification: { value: VerificationStatus; label: string; n: number }[];
  sources: { id: string; label: string; n: number }[];
  placeTypes: { value: string; n: number }[];
  withMedia: number;
}

export interface CaseListResult {
  /** False when MongoDB is unreachable — never substitute fixtures. */
  live: boolean;
  filters: CaseFilters;
  rows: CaseRow[];
  /** Rows matching the filters, across all pages. */
  total: number;
  /** Rows in the collection before any filter — the denominator. */
  grandTotal: number;
  page: number;
  pageCount: number;
  pageSize: number;
  facets: CaseFacets;
  /** Oldest and newest record in the whole collection, as `YYYY-MM-DD`. */
  span: { from: string; to: string } | null;
}

const EMPTY_FACETS: CaseFacets = {
  provinces: [],
  districts: [],
  eventTypes: [],
  verification: [],
  sources: [],
  placeTypes: [],
  withMedia: 0,
};

// ------------------------------------------------------------------- querying

/** User input reaches `$regex`, so every metacharacter must be neutralised. */
function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Start/end of a Bangkok-local calendar day, or null if the date is unreal. */
function bangkokInstant(day: string, edge: "start" | "end"): Date | null {
  const clock = edge === "start" ? "00:00:00.000" : "23:59:59.999";
  const at = new Date(`${day}T${clock}${BANGKOK_OFFSET}`);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** The filter dimensions, so a facet can be counted with its own one lifted. */
type Dimension = "province" | "district" | "type" | "verification" | "source" | "place" | "media";

/**
 * Translate the filters into a MongoDB query.
 *
 * `except` drops one dimension, which is what makes the sidebar counts useful:
 * the province counts are computed as if no province were selected, so ticking
 * ปัตตานี does not collapse every other province to zero and strand the analyst
 * with no way back.
 */
function buildMatch(f: CaseFilters, except?: Dimension): Filter<EventCandidateDoc> {
  // Source-level duplicates remain archived for provenance, but only the
  // selected representative belongs in the case register.
  const and: Filter<EventCandidateDoc>[] = [
    { "attributes.superseded_by": { $exists: false } } as Filter<EventCandidateDoc>,
  ];

  if (f.q) {
    const rx = { $regex: escapeRegex(f.q), $options: "i" };
    and.push({
      $or: [
        { _id: rx },
        { "event.title": rx },
        { "event.summary": rx },
        { "event.rawType": rx },
        { "location.province": rx },
        { "location.district": rx },
        { "location.subdistrict": rx },
        { "location.place": rx },
        { actors: rx },
        { targets: rx },
      ],
    } as Filter<EventCandidateDoc>);
  }

  const from = f.from ? bangkokInstant(f.from, "start") : null;
  const to = f.to ? bangkokInstant(f.to, "end") : null;
  if (from || to) {
    and.push({
      "time.start": { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) },
    } as Filter<EventCandidateDoc>);
  }

  if (except !== "province" && f.provinces.length) {
    and.push({ "location.provinceCode": { $in: f.provinces } } as Filter<EventCandidateDoc>);
  }
  if (except !== "district" && f.districts.length) {
    and.push({ "location.district": { $in: f.districts } } as Filter<EventCandidateDoc>);
  }
  if (except !== "type" && f.eventTypes.length) {
    and.push({ "event.type": { $in: f.eventTypes } } as Filter<EventCandidateDoc>);
  }
  if (except !== "verification" && f.verification.length) {
    and.push({ verification: { $in: f.verification } } as Filter<EventCandidateDoc>);
  }
  if (except !== "source" && f.sourceId !== "all") {
    and.push({ corroborating_sources: f.sourceId } as Filter<EventCandidateDoc>);
  }
  if (except !== "place" && f.placeTypes.length) {
    and.push({ "location.place": { $in: f.placeTypes } } as Filter<EventCandidateDoc>);
  }
  if (except !== "media" && f.hasMedia) {
    and.push({ "media.0": { $exists: true } } as Filter<EventCandidateDoc>);
  }

  return { $and: and };
}

/**
 * Secondary keys make each ordering readable rather than merely correct — a
 * verification sort with no date tiebreak is 9,680 rows in insertion order.
 * `_id` closes it off so paging can never repeat or skip a row.
 */
const SORT_KEYS: Record<CaseSortKey, string[]> = {
  date: ["time.start"],
  province: ["location.provinceCode", "location.district", "time.start"],
  type: ["event.type", "time.start"],
  verification: ["verification", "time.start"],
  confidence: ["confidence", "time.start"],
};

function buildSort(f: CaseFilters): Sort {
  const direction = f.dir === "asc" ? 1 : -1;
  const sort: Record<string, 1 | -1> = {};
  for (const key of SORT_KEYS[f.sort]) sort[key] = direction;
  sort._id = 1;
  return sort;
}

// ------------------------------------------------------------------- mapping

function toRow(e: EventCandidateDoc, sourceName: (id: string) => string): CaseRow {
  return {
    id: e._id,
    at: e.time.start,
    timePrecision: e.time.precision,
    title: e.event.title,
    type: e.event.type,
    typeLabel: EVENT_TYPE_LABEL[e.event.type] ?? e.event.type,
    typeColor: EVENT_COLOR[e.event.type] ?? EVENT_COLOR.other,
    rawType: e.event.rawType,
    province: e.location.province,
    provinceCode: e.location.provinceCode,
    district: e.location.district,
    subdistrict: e.location.subdistrict,
    place: e.location.place,
    verification: e.verification,
    verificationLabel: VERIFICATION_LABEL[e.verification] ?? e.verification,
    severity: e.severity,
    severityLabel: e.severity === null ? "ไม่ระบุ" : SEVERITY_LABEL[e.severity],
    confidence: e.confidence,
    sourceId: e.source_id,
    sourceName: sourceName(e.corroborating_sources[0] ?? e.source_id),
    mediaCount: e.media?.length ?? 0,
    unreportedCount: e.unreported?.length ?? 0,
  };
}

interface Bucket {
  _id: string | null;
  n: number;
}

/**
 * Keep a selected option in its own facet list even when it now matches
 * nothing.
 *
 * A facet's counts are computed with its own dimension lifted, so an option
 * only reaches zero when some *other* filter rules it out — tick ยะลา, then
 * "มีหลักฐานแนบ", and ยะลา drops off the province list while still being the
 * thing narrowing the table. Appending it back at zero keeps the checkbox that
 * undoes it next to the checkbox that set it.
 */
function keepSelected<T>(
  options: T[],
  selected: readonly string[],
  keyOf: (option: T) => string,
  makeEmpty: (value: string) => T,
): T[] {
  const present = new Set(options.map(keyOf));
  return [...options, ...selected.filter((v) => !present.has(v)).map(makeEmpty)];
}

// ---------------------------------------------------------------- list query

export async function listCases(filters: CaseFilters): Promise<CaseListResult> {
  const empty: CaseListResult = {
    live: false,
    filters,
    rows: [],
    total: 0,
    grandTotal: 0,
    page: 1,
    pageCount: 1,
    pageSize: CASES_PER_PAGE,
    facets: EMPTY_FACETS,
    span: null,
  };

  try {
    const db = await getDb();
    const events = db.collection<EventCandidateDoc>(COLLECTIONS.eventCandidates);

    const match = buildMatch(filters);
    const skip = (filters.page - 1) * CASES_PER_PAGE;

    /** One-dimension group count, with that dimension's own filter lifted. */
    const bucketsOf = (field: string, except: Dimension) =>
      events
        .aggregate<Bucket>([
          { $match: buildMatch(filters, except) },
          { $group: { _id: `$${field}`, n: { $sum: 1 } } },
          { $sort: { n: -1 } },
        ])
        .toArray();

    const [
      docs,
      total,
      grandTotal,
      registry,
      provinceBuckets,
      districtBuckets,
      typeBuckets,
      verificationBuckets,
      sourceBuckets,
      placeBuckets,
      withMedia,
      spanRows,
    ] = await Promise.all([
      events.find(match).sort(buildSort(filters)).skip(skip).limit(CASES_PER_PAGE).toArray(),
      events.countDocuments(match),
      events.countDocuments({ "attributes.superseded_by": { $exists: false } }),
      db.collection<SourceRegistryDoc>(COLLECTIONS.sourceRegistry).find({}).toArray(),
      bucketsOf("location.provinceCode", "province"),
      events
        .aggregate<{ _id: { d: string; p: string }; n: number }>([
          { $match: buildMatch(filters, "district") },
          {
            $group: {
              _id: { d: "$location.district", p: "$location.province" },
              n: { $sum: 1 },
            },
          },
          { $sort: { n: -1 } },
        ])
        .toArray(),
      bucketsOf("event.type", "type"),
      bucketsOf("verification", "verification"),
      // Unwound because a candidate can be corroborated by several sources;
      // grouping on the array itself would count the combination, not each one.
      events
        .aggregate<Bucket>([
          { $match: buildMatch(filters, "source") },
          { $unwind: "$corroborating_sources" },
          { $group: { _id: "$corroborating_sources", n: { $sum: 1 } } },
          { $sort: { n: -1 } },
        ])
        .toArray(),
      bucketsOf("location.place", "place"),
      events.countDocuments(buildMatch({ ...filters, hasMedia: true })),
      events
        .aggregate<{ min: Date; max: Date }>([
          { $match: { "attributes.superseded_by": { $exists: false } } },
          { $group: { _id: null, min: { $min: "$time.start" }, max: { $max: "$time.start" } } },
        ])
        .toArray(),
    ]);

    const byId = new Map(registry.map((s) => [s._id, s]));
    const sourceName = (id: string) => byId.get(id)?.shortName ?? id ?? "ไม่ระบุ";

    const pageCount = Math.max(1, Math.ceil(total / CASES_PER_PAGE));
    const isoDay = (d: Date) =>
      new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(d);

    /**
     * A page number past the end is not an empty result — it is a stale link,
     * usually one bookmarked before the filters narrowed. Showing "ไม่พบเคส"
     * there would report the wrong thing and leave no pager to navigate back
     * with, so the request is clamped to the last real page instead.
     */
    let page = filters.page;
    let rows = docs;
    if (total > 0 && page > pageCount) {
      page = pageCount;
      rows = await events
        .find(match)
        .sort(buildSort(filters))
        .skip((page - 1) * CASES_PER_PAGE)
        .limit(CASES_PER_PAGE)
        .toArray();
    }

    return {
      // A reachable but unseeded database is not "live" data to report on.
      live: grandTotal > 0,
      filters,
      rows: rows.map((e) => toRow(e, sourceName)),
      total,
      grandTotal,
      page,
      pageCount,
      pageSize: CASES_PER_PAGE,
      facets: {
        provinces: keepSelected(
          provinceBuckets
            .filter((b): b is Bucket & { _id: string } => b._id !== null)
            .map((b) => ({
              code: b._id as ProvinceCode,
              label: PROVINCE_BY_CODE.get(b._id as ProvinceCode)?.name ?? "อื่น ๆ",
              n: b.n,
            })),
          filters.provinces,
          (p) => p.code,
          (code) => ({
            code: code as ProvinceCode,
            label: PROVINCE_BY_CODE.get(code as ProvinceCode)?.name ?? "อื่น ๆ",
            n: 0,
          }),
        ),
        districts: keepSelected(
          districtBuckets
            .filter((b) => Boolean(b._id?.d))
            .map((b) => ({ name: b._id.d, province: b._id.p, n: b.n })),
          filters.districts,
          (d) => d.name,
          // No province to attribute it to once nothing matches; the sidebar
          // treats an empty province as "always show".
          (name) => ({ name, province: "", n: 0 }),
        ).sort((a, b) => a.province.localeCompare(b.province, "th") || b.n - a.n),
        eventTypes: keepSelected(
          typeBuckets
            .filter((b): b is Bucket & { _id: string } => b._id !== null)
            .map((b) => ({
              value: b._id as EventType,
              label: EVENT_TYPE_LABEL[b._id as EventType] ?? b._id,
              color: EVENT_COLOR[b._id as EventType] ?? EVENT_COLOR.other,
              n: b.n,
            })),
          filters.eventTypes,
          (t) => t.value,
          (value) => ({
            value: value as EventType,
            label: EVENT_TYPE_LABEL[value as EventType] ?? value,
            color: EVENT_COLOR[value as EventType] ?? EVENT_COLOR.other,
            n: 0,
          }),
        ),
        verification: keepSelected(
          verificationBuckets
            .filter((b): b is Bucket & { _id: string } => b._id !== null)
            .map((b) => ({
              value: b._id as VerificationStatus,
              label: VERIFICATION_LABEL[b._id as VerificationStatus] ?? b._id,
              n: b.n,
            })),
          filters.verification,
          (v) => v.value,
          (value) => ({
            value: value as VerificationStatus,
            label: VERIFICATION_LABEL[value as VerificationStatus] ?? value,
            n: 0,
          }),
        ),
        sources: keepSelected(
          sourceBuckets
            .filter((b): b is Bucket & { _id: string } => b._id !== null)
            .map((b) => ({ id: b._id, label: sourceName(b._id), n: b.n })),
          // The sidebar renders this as a <select>; drop the chosen source from
          // the options and the control renders blank instead of the choice.
          filters.sourceId === "all" ? [] : [filters.sourceId],
          (s) => s.id,
          (id) => ({ id, label: sourceName(id), n: 0 }),
        ),
        placeTypes: keepSelected(
          placeBuckets
            .filter((b): b is Bucket & { _id: string } => b._id !== null)
            .map((b) => ({ value: b._id, n: b.n })),
          filters.placeTypes,
          (p) => p.value,
          (value) => ({ value, n: 0 }),
        ),
        withMedia,
      },
      span: spanRows[0]?.min
        ? { from: isoDay(spanRows[0].min), to: isoDay(spanRows[0].max) }
        : null,
    };
  } catch {
    // Database unavailable: preserve an honest empty state.
    return empty;
  }
}

// -------------------------------------------------------------- detail query

/** A `raw.<key>` rendered as one row of the raw-payload panel. */
export interface RawField {
  key: string;
  value: string;
  /** Set when `value` was cut down; the archive still holds the whole thing. */
  truncatedFrom?: number;
}

export interface CaseDetail {
  /** Exactly what the source reported — never overwritten by a correction. */
  event: EventCandidateDoc;
  /** The same case with analyst corrections applied, plus per-field provenance. */
  effective: EffectiveEvent;
  /**
   * Where to frame the map for a case that has no coordinates at all — 186 of
   * them carry an address but no point.
   *
   * Deliberately NOT a pin and never rendered as one: it is the ตำบล or อำเภอ
   * this case is filed under, supplied only so the edit map opens somewhere
   * useful instead of over the Gulf. Drawing it as a location would be the
   * exact "centroid that looks like a GPS fix" this app warns about
   * everywhere else.
   */
  locationFallback: {
    centre: [number, number];
    label: string;
    /** Which administrative level the estimate came from — sizes the uncertainty ring. */
    precision: Extract<GeoPrecision, "subdistrict" | "district">;
  } | null;
  /** The source that produced the record, from source_registry. */
  source: SourceRegistryDoc | null;
  /** Every source that reported this same candidate, the first one included. */
  corroborating: SourceRegistryDoc[];
  raw: {
    id: string;
    externalId: string;
    url: string;
    retrievedAt: Date;
    contentHash: string;
    httpStatus: number | null;
    contentType: string | null;
    processing: RawRecordDoc["processing"]["status"];
    /** Flattened `raw` payload; empty when the body is not a JSON object. */
    fields: RawField[];
    /** Set instead of `fields` for a non-object payload, e.g. an HTML page. */
    body: { preview: string; length: number } | null;
  } | null;
  run: IngestionRunDoc | null;
  /** Other records in the same district, nearest in time first. */
  nearby: CaseRow[];
}

/**
 * The finest administrative unit this case names, as a point to frame a map on.
 *
 * Matched by name against the DDPM polygons, narrowed to the case's own
 * province first — ตำบล names repeat across the four provinces, and a bare
 * name match would happily return one 200 km away. Returns `null` rather than
 * guessing when nothing matches, because a wrong frame is worse than no map:
 * it would show the analyst a district that is not the one on the page.
 *
 * `representativePoint` (not a vertex average) because several coastal อำเภอ
 * here are crescent-shaped and their arithmetic centroid falls in the sea.
 */
function administrativeCentre(
  event: EventCandidateDoc,
): CaseDetail["locationFallback"] {
  const province = PROVINCE_BY_CODE.get(event.location.provinceCode);
  if (!province) return null;

  const wanted = event.location.subdistrict?.trim();
  if (wanted) {
    const sub = loadSubdistricts().find(
      (s) => s.provinceCode === province.ddpmCode && s.nameTh === wanted,
    );
    if (sub) {
      return {
        centre: representativePoint(sub.geometry),
        label: `ต.${sub.nameTh}`,
        precision: "subdistrict",
      };
    }
  }

  const districtName = event.location.district?.trim();
  const district = districtName
    ? loadDistricts().find(
        (d) => d.provinceCode === province.ddpmCode && d.nameTh === districtName,
      )
    : undefined;
  if (district) {
    return {
      centre: representativePoint(district.geometry),
      label: `อ.${district.nameTh}`,
      precision: "district",
    };
  }

  return null;
}

/** Long values are cut for display only; the archive keeps the full payload. */
const RAW_VALUE_LIMIT = 600;
const RAW_BODY_PREVIEW = 1200;
/** Time window for "เหตุการณ์ใกล้เคียง", in days either side. */
const NEARBY_DAYS = 30;
/** How many of them to show. */
const NEARBY_LIMIT = 8;
/**
 * Ceiling on what is read before ranking by closeness in time. MongoDB cannot
 * sort by distance from a pivot, so the window is read and ranked here — the
 * busiest อำเภอ in the collection averages about three records a month, so this
 * takes the whole window with room to spare rather than an arbitrary first-8
 * that could miss the nearest one entirely.
 */
const NEARBY_SCAN_LIMIT = 60;

function flattenRaw(raw: unknown): { fields: RawField[]; body: RawField["value"] | null } {
  if (raw === null || raw === undefined) return { fields: [], body: null };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { fields: [], body: String(raw) };
  }

  const fields: RawField[] = [];
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const text =
      value === null || value === undefined
        ? ""
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value);
    fields.push(
      text.length > RAW_VALUE_LIMIT
        ? { key, value: `${text.slice(0, RAW_VALUE_LIMIT)}…`, truncatedFrom: text.length }
        : { key, value: text },
    );
  }
  return { fields, body: null };
}

export async function getCaseDetail(id: string): Promise<CaseDetail | null> {
  try {
    const db = await getDb();
    const events = db.collection<EventCandidateDoc>(COLLECTIONS.eventCandidates);
    const event = await events.findOne({ _id: id });
    if (!event) return null;

    const span = NEARBY_DAYS * 86400000;
    const [rawDoc, registry, run, nearbyDocs, corrections] = await Promise.all([
      db.collection<RawRecordDoc>(COLLECTIONS.rawRecords).findOne({ _id: event.raw_record_id }),
      db.collection<SourceRegistryDoc>(COLLECTIONS.sourceRegistry).find({}).toArray(),
      db.collection<IngestionRunDoc>(COLLECTIONS.ingestionRuns).findOne({
        source_id: event.source_id,
      }),
      events
        .find({
          _id: { $ne: event._id },
          "attributes.superseded_by": { $exists: false },
          "location.district": event.location.district,
          "location.provinceCode": event.location.provinceCode,
          "time.start": {
            $gte: new Date(event.time.start.getTime() - span),
            $lte: new Date(event.time.start.getTime() + span),
          },
        })
        .limit(NEARBY_SCAN_LIMIT)
        .toArray(),
      db
        .collection<CaseCorrectionDoc>(COLLECTIONS.caseCorrections)
        .find({ event_id: id })
        .toArray(),
    ]);

    const byId = new Map(registry.map((s) => [s._id, s]));
    const sourceName = (sid: string) => byId.get(sid)?.shortName ?? sid ?? "ไม่ระบุ";

    const flat = rawDoc ? flattenRaw(rawDoc.raw) : { fields: [], body: null };

    const effective = effectiveEvent(event, corrections);

    return {
      locationFallback: effective.event.location.geo ? null : administrativeCentre(event),
      // `event` stays the source's claim — every "ข้อเท็จจริงที่แหล่งข้อมูล
      // รายงาน" field reads from it, and corrections travel alongside rather
      // than replacing it.
      event,
      effective,
      source: byId.get(event.source_id) ?? null,
      corroborating: event.corroborating_sources
        .map((sid) => byId.get(sid))
        .filter((s): s is SourceRegistryDoc => Boolean(s)),
      raw: rawDoc
        ? {
            id: rawDoc._id,
            externalId: rawDoc.external_id,
            url: rawDoc.source?.url ?? "",
            retrievedAt: rawDoc.retrieved_at,
            contentHash: rawDoc.integrity?.content_hash ?? "",
            httpStatus: rawDoc.source?.http_status ?? null,
            contentType: rawDoc.source?.content_type ?? null,
            processing: rawDoc.processing?.status ?? "pending",
            fields: flat.fields,
            body:
              flat.body === null
                ? null
                : { preview: flat.body.slice(0, RAW_BODY_PREVIEW), length: flat.body.length },
          }
        : null,
      run: run ?? null,
      nearby: nearbyDocs
        .map((e) => toRow(e, sourceName))
        .sort(
          (a, b) =>
            Math.abs(a.at.getTime() - event.time.start.getTime()) -
            Math.abs(b.at.getTime() - event.time.start.getTime()),
        )
        .slice(0, NEARBY_LIMIT),
    };
  } catch {
    // Database unavailable — indistinguishable from "no such case" to the page,
    // which renders a not-found rather than inventing a record.
    return null;
  }
}
