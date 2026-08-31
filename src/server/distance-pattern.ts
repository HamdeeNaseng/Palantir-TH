import "server-only";
import { COLLECTIONS, getDb } from "@/lib/mongodb";
import type { DistancePattern, PatternSector } from "@/lib/distance-pattern";

/**
 * Reading one case's distance pattern out of `result_batch_processing`.
 *
 * The batch in `ml-server/` writes it; nothing here ever does. A missing
 * pattern is a normal answer, not an error — the batch is optional, and on a
 * fresh clone or in CI it has never run. Callers get `null` and the map's
 * toggle says the layer is unavailable rather than the page failing.
 */

/** What the batch stores. Mirrors `sector_docs()` in `distance_pattern.py`. */
interface StoredSector {
  sector: number;
  abbr: string;
  name_th: string;
  bearing_deg: number;
  neighbour: {
    id: string;
    kind: string;
    name: string | null;
    district: string | null;
    location: { coordinates: [number, number] };
  };
  straight_m: number;
  road_m?: number | null;
  detour_ratio?: number | null;
}

interface StoredPattern {
  event_id: string;
  anchor_id: string;
  run_id: string;
  computed_at: Date;
  anchor: {
    location: { coordinates: [number, number] };
    geo_precision: string | null;
    precision_m: number;
    cases_at_this_position: number;
  };
  params: { radius_m: number };
  summary: {
    coverage: number;
    empty_sectors: number;
    nearest_m: number | null;
    mean_m: number | null;
    anisotropy: number | null;
    median_detour_ratio?: number | null;
  };
  sectors: StoredSector[];
}

/**
 * Only the fields the map draws. The stored document averages ~7 KB, most of
 * it snap distances and the caveat list that the client already has as static
 * copy; projecting here keeps a click to roughly a fifth of that.
 */
const PROJECTION = {
  event_id: 1,
  anchor_id: 1,
  run_id: 1,
  computed_at: 1,
  "anchor.location.coordinates": 1,
  "anchor.geo_precision": 1,
  "anchor.precision_m": 1,
  "anchor.cases_at_this_position": 1,
  "params.radius_m": 1,
  summary: 1,
  "sectors.sector": 1,
  "sectors.abbr": 1,
  "sectors.name_th": 1,
  "sectors.bearing_deg": 1,
  "sectors.neighbour": 1,
  "sectors.straight_m": 1,
  "sectors.road_m": 1,
  "sectors.detour_ratio": 1,
} as const;

function toSector(s: StoredSector): PatternSector {
  const [lng, lat] = s.neighbour.location.coordinates;
  return {
    sector: s.sector,
    abbr: s.abbr,
    nameTh: s.name_th,
    bearingDeg: s.bearing_deg,
    neighbour: {
      id: s.neighbour.id,
      // Passed through verbatim. The batch reads this from OpenStreetMap
      // tags, so it can fall outside the app's union; `spokeColor` and
      // `kindLabel` handle that, and guessing a kind here would paint the
      // line in another category's colour.
      kind: s.neighbour.kind,
      name: s.neighbour.name,
      district: s.neighbour.district,
      lng,
      lat,
    },
    straightM: s.straight_m,
    roadM: s.road_m ?? null,
    detourRatio: s.detour_ratio ?? null,
  };
}

/**
 * The newest stored pattern for one case, or null.
 *
 * Sorted by `computed_at` descending rather than resolving a "live run"
 * pointer: this collection deliberately has none, because the flow model's
 * pointer means "newest live run" with no notion of which model wrote it.
 * The `(event_id, computed_at)` index makes this a single seek.
 */
export async function getDistancePattern(eventId: string): Promise<DistancePattern | null> {
  try {
    const db = await getDb();
    const doc = await db
      .collection<StoredPattern>(COLLECTIONS.caseDistancePatterns)
      .findOne({ event_id: eventId }, { projection: PROJECTION, sort: { computed_at: -1 } });

    if (!doc) return null;

    const [lng, lat] = doc.anchor.location.coordinates;
    return {
      eventId: doc.event_id,
      anchorId: doc.anchor_id,
      lng,
      lat,
      precisionM: doc.anchor.precision_m,
      geoPrecision: doc.anchor.geo_precision,
      casesAtPosition: doc.anchor.cases_at_this_position,
      radiusM: doc.params.radius_m,
      computedAtMs: new Date(doc.computed_at).getTime(),
      runId: doc.run_id,
      summary: {
        coverage: doc.summary.coverage,
        emptySectors: doc.summary.empty_sectors,
        nearestM: doc.summary.nearest_m,
        meanM: doc.summary.mean_m,
        anisotropy: doc.summary.anisotropy,
        medianDetourRatio: doc.summary.median_detour_ratio ?? null,
      },
      // Compass order, so the popup and any future rose read consistently
      // however MongoDB happened to return the array.
      sectors: (doc.sectors ?? []).map(toSector).sort((a, b) => a.sector - b.sector),
    };
  } catch {
    // A database that is down is already reported by the page-level banner;
    // this layer simply has nothing to draw.
    return null;
  }
}

/** Whether the batch has ever run, for the toggle's disabled state. */
export async function distancePatternsPresent(): Promise<boolean> {
  try {
    const db = await getDb();
    const one = await db
      .collection(COLLECTIONS.caseDistancePatterns)
      .findOne({}, { projection: { _id: 1 } });
    return one !== null;
  } catch {
    return false;
  }
}
