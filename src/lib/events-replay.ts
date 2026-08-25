import { detectHotspots } from "./stats";
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
/** How many of the most-recent points in that window it keeps. */
export const PATH_MAX_POINTS = 20;

/**
 * A short, legible "recent movement" line — the mockup's เส้นทางเวลา, scoped
 * down from "every matched event ever" (which would be an unreadable tangle
 * across 24 years of real data) to the last `PATH_MAX_POINTS` events within
 * `PATH_WINDOW_MS` of the playhead. Hidden entirely below 2 points: a
 * one-point "path" isn't a path, it's a single dot pretending to be a line.
 */
export function scopedTimePath(
  features: EventFeature[],
  currentTimestampMs: number,
): [number, number][] {
  const idx = lastIndexAtOrBefore(features, currentTimestampMs);
  if (idx < 0) return [];

  const cutoff = currentTimestampMs - PATH_WINDOW_MS;
  const candidates: EventFeature[] = [];
  for (let i = idx; i >= 0 && candidates.length < PATH_MAX_POINTS; i--) {
    if (features[i].properties.ts < cutoff) break;
    candidates.push(features[i]);
  }
  if (candidates.length < 2) return [];

  // `candidates` was collected walking backward from the playhead; the path
  // should be drawn in chronological order.
  return candidates.reverse().map((f) => f.geometry.coordinates);
}

export interface DistrictCluster {
  key: string;
  district: string;
  province: string;
  lng: number;
  lat: number;
  /** Signed percent above the expected recent count. */
  delta: number;
  p: number;
  tier: "high" | "medium";
}

const CLUSTER_OPTIONS = { recentDays: 180, baselineDays: 540, minBaseline: 5, limit: 12 };

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

  const byKey = new Map<string, { district: string; province: string; lngs: number[]; lats: number[] }>();
  for (const f of played) {
    const key = `${f.properties.province}|${f.properties.district}`;
    const entry = byKey.get(key) ?? {
      district: f.properties.district,
      province: f.properties.province,
      lngs: [],
      lats: [],
    };
    entry.lngs.push(f.geometry.coordinates[0]);
    entry.lats.push(f.geometry.coordinates[1]);
    byKey.set(key, entry);
  }

  const { hotspots } = detectHotspots(
    played.map((f) => ({ key: `${f.properties.province}|${f.properties.district}`, atMs: f.properties.ts })),
    currentTimestampMs,
    CLUSTER_OPTIONS,
  );

  return hotspots
    .map((h): DistrictCluster | null => {
      const entry = byKey.get(h.label);
      if (!entry) return null;
      const n = entry.lngs.length;
      return {
        key: h.label,
        district: entry.district,
        province: entry.province,
        lng: entry.lngs.reduce((s, v) => s + v, 0) / n,
        lat: entry.lats.reduce((s, v) => s + v, 0) / n,
        delta: h.delta,
        p: h.p,
        tier: h.p < 0.01 ? "high" : "medium",
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
 * Plain factual sentences built directly from `districtClusters` — never a
 * fabricated narrative. `insights: []` is the honest, expected answer when
 * nothing in the current window clears statistical significance.
 */
export function phenomenaSummary(
  features: EventFeature[],
  currentTimestampMs: number,
): { insights: PhenomenonInsight[] } {
  const clusters = districtClusters(features, currentTimestampMs);
  const insights = clusters.slice(0, 4).map((c) => ({
    id: c.key,
    text: `อ.${c.district} จ.${c.province} มีเหตุการณ์มากกว่าค่าคาดการณ์ ${c.delta}% ในช่วง ${CLUSTER_OPTIONS.recentDays} วันล่าสุด (p<${c.tier === "high" ? "0.01" : "0.05"})`,
    tone: c.tier === "high" ? ("warning" as const) : ("info" as const),
  }));
  return { insights };
}
