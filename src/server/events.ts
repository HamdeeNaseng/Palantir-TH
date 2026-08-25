import { PROVINCES } from "@/lib/geo";
import { districtsOfProvince } from "@/lib/geography";
import { EVENT_TYPE_LABEL, VERIFICATION_LABEL } from "@/lib/labels";
import { EVENT_COLOR } from "@/lib/palette";
import { formatThaiDate } from "@/lib/datetime";
import { BUCKET_LABEL, bucketKey, bucketList, chooseBucketUnit, type BucketUnit } from "@/lib/stats";
import { DEFAULT_FILTERS, type InvestigationFilters } from "@/lib/filters";
import {
  loadBundle,
  matchedEvents,
  toEventFeature,
  type EventFeatureCollection,
} from "./shared-events";
import type { EventCandidateDoc, EventType, ProvinceCode, VerificationStatus } from "@/lib/types";

/**
 * View model for `/events` — the timeline-replay page.
 *
 * Shipped once per filter change, not once per playhead tick: everything that
 * depends on where the playhead sits (played-so-far count, density, phenomena
 * insights, cluster circles, the scoped time-path, the trend highlight band)
 * is computed client-side off the `events` collection here (see
 * `src/lib/events-replay.ts`) so scrubbing feels instant instead of round-
 * tripping to the server on every tick.
 */
export interface EventsWorkspace {
  /** False when MongoDB is unreachable — never substitute fixtures. */
  live: boolean;
  filters: InvestigationFilters;
  /** Sorted ascending by `properties.ts` — required for client-side binary search. */
  events: EventFeatureCollection;
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

const MS_PER_YEAR = 365.25 * 86400000;

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

export async function getEventsWorkspace(
  filters: InvestigationFilters = DEFAULT_FILTERS,
): Promise<EventsWorkspace> {
  const now = new Date();
  const bundle = await loadBundle();
  const matched = matchedEvents(bundle, filters, { now });
  const sorted = [...matched].sort((a, b) => a.time.start.getTime() - b.time.start.getTime());

  const times = sorted.map((e) => e.time.start.getTime());
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
  const totalDistrictsInScope = provinceCodes.reduce((sum, code) => {
    const meta = PROVINCES.find((p) => p.code === code);
    return meta ? sum + districtsOfProvince(meta.ddpmCode).length : sum;
  }, 0);

  const countBy = <K extends string>(events: EventCandidateDoc[], keyOf: (e: EventCandidateDoc) => K) => {
    const counts = new Map<K, number>();
    for (const e of events) counts.set(keyOf(e), (counts.get(keyOf(e)) ?? 0) + 1);
    return counts;
  };

  const provinceCounts = countBy(
    matchedEvents(bundle, filters, { now, except: "province" }),
    (e) => e.location.provinceCode,
  );
  const typeCounts = countBy(
    matchedEvents(bundle, filters, { now, except: "type" }),
    (e) => e.event.type,
  );
  const verificationCounts = countBy(
    matchedEvents(bundle, filters, { now, except: "verification" }),
    (e) => e.verification,
  );

  const histogramUnit = span ? chooseBucketUnit(Math.max(1, (span.endMs - span.startMs) / 86400000)) : "year";
  const histogramBuckets = span ? bucketList(span.startMs, span.endMs, histogramUnit) : [];
  const histogramIndex = new Map(histogramBuckets.map((b, i) => [b.key, i]));
  const histogramCounts = new Array(histogramBuckets.length).fill(0);
  for (const e of sorted) {
    const i = histogramIndex.get(bucketKey(e.time.start, histogramUnit));
    if (i !== undefined) histogramCounts[i] += 1;
  }

  return {
    live: bundle.live,
    filters,
    events: { type: "FeatureCollection", features: sorted.map((e) => toEventFeature(e)) },
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
