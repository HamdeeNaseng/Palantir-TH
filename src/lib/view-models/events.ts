import { PROVINCES } from "@/lib/geo";
import { EVENT_TYPE_LABEL, VERIFICATION_LABEL } from "@/lib/labels";
import { EVENT_COLOR } from "@/lib/palette";
import { formatThaiDate } from "@/lib/datetime";
import { BUCKET_LABEL, bucketIndexOf, bucketList, chooseBucketUnit, type BucketUnit } from "@/lib/stats";
import { DEFAULT_FILTERS, type InvestigationFilters } from "@/lib/filters";
import {
  FILTER_BIT,
  failedConditions,
  trustedSourceIds,
  type Snapshot,
  type SnapshotEvent,
} from "@/lib/snapshot";
import { GEO_PRECISION_RADIUS_M } from "@/lib/types";
import type { EventFeature, EventFeatureCollection } from "@/server/shared-events";
import type { EventType, ProvinceCode, VerificationStatus } from "@/lib/types";

/**
 * View model for `/events` — the timeline-replay page.
 *
 * Built from a `Snapshot`, not from MongoDB, so the exact same function runs
 * on the server for the first paint and in the browser for every filter change
 * after it. Moved here out of `src/server/events.ts` (which now just loads a
 * snapshot and calls this) for that reason alone: a second, client-side copy of
 * "what does this filter show" is how a page starts disagreeing with itself.
 *
 * Everything that depends on where the playhead sits (played-so-far count,
 * density, phenomena insights, cluster circles, the scoped time-path, the
 * trend highlight band) is *not* here — that is `src/lib/events-replay.ts`,
 * recomputed per tick off the `events` collection this produces.
 */
export interface EventsWorkspace {
  /** False when MongoDB is unreachable — never substitute fixtures. */
  live: boolean;
  filters: InvestigationFilters;
  /** Sorted ascending by `properties.ts` — required for client-side binary search. */
  events: EventFeatureCollection;
  /**
   * True when `events.features` was deliberately emptied before this view left
   * the server, and the browser must rebuild it from the snapshot.
   *
   * The features are by far the largest thing on the page — 9,749 of them,
   * 6.68 MB of RSC payload — and the client downloads the same corpus again in
   * the snapshot and rebuilds them from it anyway. Shipping both cost a
   * low-spec phone seconds of parsing for a set it was about to throw away.
   * Every aggregate beside this one is small and still computed server-side
   * from the full match, so the first paint keeps its KPIs, facets, histogram
   * and span; only the map dots wait for the snapshot.
   *
   * Absent or false means the collection is complete, which is what
   * `/investigate` and any direct caller still get.
   */
  eventsDeferred?: boolean;
  totalMatched: number;
  /** null when nothing matched — an honest gap, not a fabricated "now" span. */
  span: { startMs: number; endMs: number; label: string; durationLabel: string } | null;
  /** Districts covered by the selected provinces — the density gauge's denominator. */
  totalDistrictsInScope: number;
  facets: {
    provinces: { code: ProvinceCode; label: string; n: number }[];
    eventTypes: { value: EventType; label: string; color: string; n: number }[];
    verification: { value: VerificationStatus; label: string; n: number }[];
  };
  histogram: {
    unit: BucketUnit;
    bucketLabel: string;
    buckets: { label: string; startMs: number; endMs: number; count: number }[];
  };
}

/**
 * Drawn for events whose source reports no severity. Deliberately the middle
 * of the scale so an unknown neither shouts nor disappears; `severity_known`
 * carries the truth for anything that needs to tell them apart.
 */
const UNKNOWN_SEVERITY_FALLBACK = 3;

/**
 * One snapshot event as a GeoJSON feature for MapLibre. Properties are flat
 * scalars because MapLibre filter/paint expressions can only read primitives.
 *
 * An address is useful evidence even when the source publishes no point: such
 * an event stays in lists and statistics, but never gets an invented marker.
 */
export function snapshotToFeature(e: SnapshotEvent): EventFeature | null {
  if (e.lng === null || e.lat === null) return null;
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [e.lng, e.lat] },
    properties: {
      id: e.id,
      type: e.type,
      severity: e.severity ?? UNKNOWN_SEVERITY_FALLBACK,
      severity_known: e.severity !== null,
      confidence: e.confidence,
      ts: e.ts,
      title: e.title,
      district: e.district,
      province: e.province,
      precision: e.precision ?? "unknown",
      precision_m: GEO_PRECISION_RADIUS_M[e.precision ?? "unknown"],
      color: EVENT_COLOR[e.type],
      killed_known: e.killed !== null,
      killed: e.killed ?? 0,
      injured_known: e.injured !== null,
      injured: e.injured ?? 0,
      verification: e.verification,
      sources_count: e.sources.length,
      media_count: e.mediaCount,
      actors_count: e.actorsCount,
      targets_count: e.targetsCount,
    },
  };
}

/** "X ปี Y เดือน" between two instants — whole years, then remainder months. */
function durationLabel(startMs: number, endMs: number): string {
  const start = new Date(startMs);
  const end = new Date(endMs);
  let months =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (end.getUTCMonth() - start.getUTCMonth());
  if (end.getUTCDate() < start.getUTCDate()) months -= 1;
  months = Math.max(0, months);
  const years = Math.floor(months / 12);
  const remMonths = months % 12;
  if (years === 0) return `${remMonths} เดือน`;
  if (remMonths === 0) return `${years} ปี`;
  return `${years} ปี ${remMonths} เดือน`;
}

export function buildEventsWorkspace(
  snapshot: Snapshot,
  filters: InvestigationFilters = DEFAULT_FILTERS,
  nowMs: number = Date.now(),
): EventsWorkspace {
  // One pass for the matched set and all three facet counts — see
  // `failedConditions`. Four separate runs of the filter ladder over 10,171
  // events was the largest single cost of applying a filter.
  const trusted = trustedSourceIds(snapshot.sources);
  const matched: SnapshotEvent[] = [];
  const provinceCounts = new Map<ProvinceCode, number>();
  const typeCounts = new Map<EventType, number>();
  const verificationCounts = new Map<VerificationStatus, number>();
  const bump = <K>(counts: Map<K, number>, key: K) => counts.set(key, (counts.get(key) ?? 0) + 1);

  for (const e of snapshot.events) {
    const fail = failedConditions(e, filters, nowMs, trusted);
    if (fail === 0) {
      matched.push(e);
      bump(provinceCounts, e.provinceCode);
      bump(typeCounts, e.type);
      bump(verificationCounts, e.verification);
    } else if (fail === FILTER_BIT.province) bump(provinceCounts, e.provinceCode);
    else if (fail === FILTER_BIT.type) bump(typeCounts, e.type);
    else if (fail === FILTER_BIT.verification) bump(verificationCounts, e.verification);
  }

  // `snapshot.events` is already ascending, and `filter` preserves order, so
  // the matched set inherits the ordering every consumer here depends on.
  const times = matched.map((e) => e.ts);
  const span =
    times.length > 0
      ? {
          startMs: times[0],
          endMs: times[times.length - 1],
          label: `${formatThaiDate(new Date(times[0]))} — ${formatThaiDate(new Date(times[times.length - 1]))}`,
          durationLabel: durationLabel(times[0], times[times.length - 1]),
        }
      : null;

  // "อื่น ๆ" (provinces outside the 4-province DDPM boundary set) has no
  // district list to count — it contributes 0 to the denominator, which is
  // negligible in practice since the ingested record has no events there.
  const provinceCodes = filters.provinces.length ? filters.provinces : PROVINCES.map((p) => p.code);
  const totalDistrictsInScope = provinceCodes.reduce(
    (sum, code) => sum + (snapshot.districtsByProvince[code] ?? 0),
    0,
  );

  const histogramUnit = span
    ? chooseBucketUnit(Math.max(1, (span.endMs - span.startMs) / 86400000))
    : "year";
  const histogramBuckets = span ? bucketList(span.startMs, span.endMs, histogramUnit) : [];
  const histogramCounts = new Array(histogramBuckets.length).fill(0);
  for (const e of matched) {
    const i = bucketIndexOf(histogramBuckets, e.ts);
    if (i >= 0) histogramCounts[i] += 1;
  }

  return {
    live: snapshot.live,
    filters,
    events: {
      type: "FeatureCollection",
      features: matched.flatMap((e): EventFeature[] => {
        const feature = snapshotToFeature(e);
        return feature ? [feature] : [];
      }),
    },
    totalMatched: matched.length,
    span,
    totalDistrictsInScope,
    facets: {
      provinces: PROVINCES.map((p) => ({
        code: p.code,
        label: p.name,
        n: provinceCounts.get(p.code) ?? 0,
      })),
      eventTypes: [...typeCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([value, n]) => ({
          value,
          label: EVENT_TYPE_LABEL[value] ?? value,
          color: EVENT_COLOR[value] ?? EVENT_COLOR.other,
          n,
        })),
      verification: [...verificationCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([value, n]) => ({ value, label: VERIFICATION_LABEL[value] ?? value, n })),
    },
    histogram: {
      unit: histogramUnit,
      bucketLabel: BUCKET_LABEL[histogramUnit],
      buckets: histogramBuckets.map((b, i) => ({
        label: b.label,
        startMs: b.startMs,
        endMs: b.endMs,
        count: histogramCounts[i],
      })),
    },
  };
}
