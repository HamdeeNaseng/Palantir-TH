import { detectHotspotsFromCounts, tallyHotspot, type HotspotCounts } from "./stats";
import { EVENT_FAMILY } from "./types";
import type { EventFamily, EventType } from "./types";
import type { EventFeature } from "@/server/shared-events";

/**
 * Everything on `/events` that depends on the playhead, not the filters.
 *
 * These run client-side, in a `useMemo` keyed on `currentTimestamp`, off the
 * one `EventFeatureCollection` the server already shipped — a second
 * server round trip per scrub tick would make the timeline feel laggy, and
 * nothing here needs a database, only the features already in memory.
 * `features` must be sorted ascending by `properties.ts` (guaranteed by
 * `getEventsWorkspace`), which is what makes `playedSoFar`'s binary search
 * valid.
 */

/** Index of the last feature with `ts <= atMs`, or -1 if none qualify. */
function lastIndexAtOrBefore(features: EventFeature[], atMs: number): number {
  let lo = 0;
  let hi = features.length - 1;
  let result = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (features[mid].properties.ts <= atMs) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}

/** Every feature at or before the playhead — ascending, same order as `features`. */
export function playedSoFar(features: EventFeature[], currentTimestampMs: number): EventFeature[] {
  const idx = lastIndexAtOrBefore(features, currentTimestampMs);
  return idx < 0 ? [] : features.slice(0, idx + 1);
}

/** How far back the scoped time-path looks from the playhead. */
export const PATH_WINDOW_MS = 90 * 86400000;
/** How many of the most-recent points in that window it keeps, per group. */
export const PATH_MAX_POINTS = 20;

/**
 * The only families a link line is ever drawn for.
 *
 * A line between two events asserts that they are plausibly the same
 * behaviour moving through space — one actor, one network, one campaign. That
 * claim is meaningful for the human families and meaningless for the rest: two
 * floods a week apart are not a flood travelling, and joining a house fire to
 * a road accident draws a corridor nobody can act on. Natural hazards
 * (`disaster`), accidents (`safety`) and `other` are therefore never linked —
 * they still appear as dots, still count toward ความชุก (the cluster rings and
 * their summary) and ความหนาแน่น (the density score), which are per-area
 * measures and make no claim about any pair of events.
 */
export const LINKABLE_FAMILIES = ["violence", "gang", "narcotics", "crime"] as const;

export type LinkableFamily = (typeof LINKABLE_FAMILIES)[number];

const LINKABLE = new Set<EventFamily>(LINKABLE_FAMILIES);

/** The family a link line may be drawn within, or `null` if this type links to nothing. */
export function linkFamilyOf(type: EventType): LinkableFamily | null {
  const family = EVENT_FAMILY[type];
  return LINKABLE.has(family) ? (family as LinkableFamily) : null;
}

/** One family's chronological chain of events — never crosses into another family. */
export interface LinkGroup {
  family: LinkableFamily;
  /** Ascending by `ts`, at least 2 long. */
  features: EventFeature[];
}

/**
 * The events behind the "recent movement" lines — the mockup's เส้นทางเวลา,
 * scoped down from "every matched event ever" (which would be an unreadable
 * tangle across 24 years of real data) to the last `PATH_MAX_POINTS` events
 * within `PATH_WINDOW_MS` of the playhead.
 *
 * Split per family rather than returned as one chain. A single chain through
 * whatever happened to be most recent connected a shooting to the flood that
 * followed it purely because they were adjacent in time — the line looked like
 * a finding and was an artefact of sorting. Each group is now one family's own
 * chain, and only the four families in `LINKABLE_FAMILIES` get one at all.
 *
 * Groups below 2 points are dropped: a one-point "path" isn't a path, it's a
 * single dot pretending to be a line. Returned in `LINKABLE_FAMILIES` order so
 * the rendering is stable from tick to tick. Shared by `scopedTimePaths` (the
 * straight-line rendering) and the road-network flow-corridor layer, which
 * needs the full features — not just coordinates — to pair up event ids.
 */
export function scopedLinkGroups(
  features: EventFeature[],
  currentTimestampMs: number,
): LinkGroup[] {
  const idx = lastIndexAtOrBefore(features, currentTimestampMs);
  if (idx < 0) return [];

  const cutoff = currentTimestampMs - PATH_WINDOW_MS;
  const byFamily = new Map<LinkableFamily, EventFeature[]>();

  // One backward walk for all four families. It stops as soon as every family
  // is full, so a dense window costs `4 * PATH_MAX_POINTS` events rather than
  // a scan of everything played so far — this runs on every playhead tick.
  let full = 0;
  for (let i = idx; i >= 0 && full < LINKABLE_FAMILIES.length; i--) {
    const f = features[i];
    if (f.properties.ts < cutoff) break;
    const family = linkFamilyOf(f.properties.type);
    if (!family) continue;
    const bucket = byFamily.get(family);
    if (!bucket) {
      byFamily.set(family, [f]);
    } else if (bucket.length < PATH_MAX_POINTS) {
      bucket.push(f);
      if (bucket.length === PATH_MAX_POINTS) full += 1;
    }
  }

  return LINKABLE_FAMILIES.flatMap((family) => {
    const bucket = byFamily.get(family);
    if (!bucket || bucket.length < 2) return [];
    // Collected walking backward from the playhead; drawn in chronological order.
    return [{ family, features: bucket.reverse() }];
  });
}

/** One straight-line path per linkable family — the always-on, zero-cost fallback. */
export function scopedTimePaths(
  features: EventFeature[],
  currentTimestampMs: number,
): { family: LinkableFamily; coordinates: [number, number][] }[] {
  return scopedLinkGroups(features, currentTimestampMs).map((g) => ({
    family: g.family,
    coordinates: g.features.map((f) => f.geometry.coordinates),
  }));
}

export interface DistrictCluster {
  key: string;
  district: string;
  province: string;
  lng: number;
  lat: number;
  /** Signed percent above the expected recent count. */
  delta: number;
  /** Raw Poisson upper-tail p-value. */
  p: number;
  /** False-discovery-corrected p-value — what `tier` is graded on. */
  q: number;
  /** Length of the "recently" this cluster was measured over, in whole days. */
  recentDays: number;
  tier: "high" | "medium";
}

/**
 * The recent-against-baseline split used to detect a cluster, as a fraction of
 * the span actually played so far.
 *
 * This used to be a fixed 180-day recent window against a 540-day baseline,
 * which silently made the whole layer dead for most filter selections: the
 * sidebar's ranges top out at 90 days, so every played event fell inside the
 * 180-day "recent" window, the baseline was empty, and `detectHotspots`
 * correctly returned nothing — no circles on the map, unchanged no matter what
 * was filtered. The other end was no better: across the full 2545-onward
 * record, 180 days is the last ~2% of the span, so a district had to spike
 * inside a window narrower than the histogram's own buckets to register.
 *
 * Scaling both windows off the played span instead means "recently" always
 * means the last quarter of what is on screen, and the baseline is the three
 * quarters before it, at every zoom from a day to two decades.
 */
const CLUSTER_RECENT_FRACTION = 0.25;
/** A window this short cannot hold a baseline; below it, no cluster is claimed. */
const CLUSTER_MIN_SPAN_MS = 4 * 86400000;
const CLUSTER_OPTIONS = { minBaseline: 5, limit: 12 };

/**
 * Districts whose played-so-far volume is significantly above what the
 * dataset's own recent trend predicts — the mockup's คลัสเตอร์เสี่ยงสูง/
 * ปานกลาง. Reuses the exact Poisson-significance test already proven for
 * citizen-report hotspots (`detectHotspots` in `@/lib/stats`), keyed by
 * `province|district` instead of a citizen report's `provinceCode`/`district`.
 *
 * The circle for each district is centred on the average coordinates of that
 * district's *own* matched events, not a DOPA-polygon centroid — deliberately:
 * `location.district` is free text per source (a handful of records carry an
 * unromanized English name from a different connector) and is not a safe join
 * key against the boundary file's Thai district names. Centring on the
 * events' own coordinates sidesteps that entirely and arguably tells a more
 * honest story: "here is where these events actually are."
 *
 * An empty result is a correct, expected answer when no district clears
 * significance in the current window — not a bug to work around.
 */
export function districtClusters(
  features: EventFeature[],
  currentTimestampMs: number,
): DistrictCluster[] {
  const played = playedSoFar(features, currentTimestampMs);
  if (played.length === 0) return [];

  // Measured from the first played event rather than from the filter's own
  // span, so the windows track what the playhead has actually revealed — early
  // in a replay that is a few weeks even when the filter covers twenty years.
  const playedSpanMs = currentTimestampMs - played[0].properties.ts;
  if (playedSpanMs < CLUSTER_MIN_SPAN_MS) return [];
  const recentDays = (playedSpanMs * CLUSTER_RECENT_FRACTION) / 86400000;
  const baselineDays = playedSpanMs / 86400000 - recentDays;

  // One pass, because this is the hot loop of the whole page: it runs on every
  // playhead tick — eight times a second during playback — over every event
  // played so far. It used to walk `played` three times (coordinates, then a
  // 9,659-object `HotspotItem[]`, then the tally inside `detectHotspots`) and
  // build the same district key twice per event. Accumulating coordinate sums
  // and hotspot counts together drops that to one walk, one key, and no
  // intermediate array — see `tallyHotspot` in `@/lib/stats`.
  const byKey = new Map<
    string,
    { district: string; province: string; lngSum: number; latSum: number; n: number }
  >();
  const counts: HotspotCounts = new Map();
  for (const f of played) {
    const key = `${f.properties.province}|${f.properties.district}`;
    const entry = byKey.get(key);
    if (entry) {
      entry.lngSum += f.geometry.coordinates[0];
      entry.latSum += f.geometry.coordinates[1];
      entry.n += 1;
    } else {
      byKey.set(key, {
        district: f.properties.district,
        province: f.properties.province,
        lngSum: f.geometry.coordinates[0],
        latSum: f.geometry.coordinates[1],
        n: 1,
      });
    }
    tallyHotspot(counts, key, currentTimestampMs - f.properties.ts, recentDays, baselineDays);
  }

  const { hotspots } = detectHotspotsFromCounts(counts, CLUSTER_OPTIONS);

  return hotspots
    .map((h): DistrictCluster | null => {
      const entry = byKey.get(h.label);
      if (!entry) return null;
      return {
        key: h.label,
        district: entry.district,
        province: entry.province,
        lng: entry.lngSum / entry.n,
        lat: entry.latSum / entry.n,
        delta: h.delta,
        p: h.p,
        q: h.q,
        recentDays: Math.max(1, Math.round(recentDays)),
        tier: h.q < 0.01 ? "high" : "medium",
      };
    })
    .filter((c): c is DistrictCluster => c !== null);
}

export interface DensityScore {
  score: number;
  band: "ต่ำ" | "ปานกลาง" | "สูง";
  recentRate: number;
  baselineRate: number;
}

const DENSITY_RECENT_DAYS = 180;
/** score=100 means "double this dataset's own long-run rate", not an absolute constant. */
const DENSITY_CALIBRATION = 2;

/**
 * "ความหนาแน่นเหตุการณ์" — how busy the played-so-far window is per district
 * per year, relative to the matched set's own long-run average. Entirely
 * self-referential (no constant tied to today's 10,041-record dataset size),
 * so the same formula stays meaningful if the underlying data changes scale.
 */
export function densityScore(
  features: EventFeature[],
  currentTimestampMs: number,
  totalDistrictsInScope: number,
): DensityScore {
  if (features.length === 0 || totalDistrictsInScope === 0) {
    return { score: 0, band: "ต่ำ", recentRate: 0, baselineRate: 0 };
  }

  const played = playedSoFar(features, currentTimestampMs);
  const spanYears = Math.max(
    1 / 365.25,
    (features[features.length - 1].properties.ts - features[0].properties.ts) / (365.25 * 86400000),
  );
  const baselineRate = features.length / spanYears / totalDistrictsInScope;

  const recentCutoff = currentTimestampMs - DENSITY_RECENT_DAYS * 86400000;
  const recentCount = played.filter((f) => f.properties.ts >= recentCutoff).length;
  const recentRate = recentCount / (DENSITY_RECENT_DAYS / 365.25) / totalDistrictsInScope;

  const score =
    baselineRate > 0
      ? Math.max(0, Math.min(100, Math.round((100 * recentRate) / (baselineRate * DENSITY_CALIBRATION))))
      : 0;
  const band = score < 33 ? "ต่ำ" : score < 67 ? "ปานกลาง" : "สูง";

  return { score, band, recentRate, baselineRate };
}

export interface PhenomenonInsight {
  id: string;
  text: string;
  tone: "warning" | "info";
}

/**
 * "N วันล่าสุด" in Thai, rolled up once a day count stops being readable as
 * one. The cluster window scales with the played span, so on the full record
 * it lands near 2,200 days — a number no one parses as "about six years".
 */
function windowLabel(days: number): string {
  if (days < 60) return `${Math.max(1, Math.round(days))} วัน`;
  if (days < 730) return `${Math.round(days / 30)} เดือน`;
  return `${(days / 365.25).toFixed(1)} ปี`;
}

/**
 * Plain factual sentences built directly from `districtClusters` — never a
 * fabricated narrative. `insights: []` is the honest, expected answer when
 * nothing in the current window clears statistical significance.
 *
 * Takes the clusters rather than recomputing them: the caller already has the
 * same list for the map's rings, and `districtClusters` is the most expensive
 * thing on the playhead's path — a Poisson scan of every played event, per
 * district, per tick. Running it twice per frame was doubling the cost of
 * playback for two renderings of one answer.
 */
export function phenomenaSummary(clusters: DistrictCluster[]): { insights: PhenomenonInsight[] } {
  const insights = clusters.slice(0, 4).map((c) => ({
    id: c.key,
    // The window is the one this cluster was actually measured over — it
    // scales with the played span now, so a constant here would misreport it.
    text: `อ.${c.district} จ.${c.province} มีเหตุการณ์มากกว่าค่าคาดการณ์ ${c.delta}% ในช่วง ${windowLabel(c.recentDays)}ล่าสุด (q<${c.tier === "high" ? "0.01" : "0.05"})`,
    tone: c.tier === "high" ? ("warning" as const) : ("info" as const),
  }));
  return { insights };
}
