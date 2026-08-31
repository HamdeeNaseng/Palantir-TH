import { FACILITY_COLOR, FACILITY_LABEL, type FacilityKind } from "./facilities";

/**
 * The 32-direction distance pattern of one case, as the map needs it.
 *
 * Produced by `ml-server/run_distance_pattern.py` into
 * `result_batch_processing` and read through `/api/distance-pattern`. This
 * module holds only the shape and the geometry the layer draws — the analysis
 * itself happens in the batch, because a Dijkstra sweep per click is not
 * something a map interaction can afford.
 *
 * The stored document carries more than this (per-sector snap distances, the
 * full caveat list, run bookkeeping). What is modelled here is what the map
 * actually draws plus what the popup states; the API projects to it so a click
 * moves a few KB rather than the whole 7 KB document.
 */

/** Sectors are 360/32 = 11.25° wide, named at their centre. */
export const PATTERN_SECTORS = 32;

export interface PatternSector {
  /** 0-31, clockwise from north. */
  sector: number;
  /** International rhumb abbreviation — "N", "NbE", "NNE", … */
  abbr: string;
  /** Thai name from the classical compass — "อุดร (เหนือ)", … */
  nameTh: string;
  bearingDeg: number;
  neighbour: {
    id: string;
    /**
     * Usually a `FacilityKind`, but deliberately typed wider: the batch reads
     * this straight from OpenStreetMap tags, so a value outside the app's
     * union can arrive. `spokeColor` and `kindLabel` both degrade gracefully;
     * narrowing the type here would only move the lie upstream.
     */
    kind: string;
    /** Null where OpenStreetMap carries no name for the feature. */
    name: string | null;
    district: string | null;
    lng: number;
    lat: number;
  };
  straightM: number;
  /** Null where the two sit in different components of the road graph. */
  roadM: number | null;
  detourRatio: number | null;
}

export interface PatternSummary {
  /** How many of the 32 directions have anything within the search radius. */
  coverage: number;
  emptySectors: number;
  nearestM: number | null;
  meanM: number | null;
  /** Coefficient of variation across the filled directions; null below three. */
  anisotropy: number | null;
  medianDetourRatio: number | null;
}

export interface DistancePattern {
  eventId: string;
  /** Cases on the same district centroid share this, and share a pattern. */
  anchorId: string;
  lng: number;
  lat: number;
  /** Nominal positional error of the anchor. 8000 means a district centroid. */
  precisionM: number;
  geoPrecision: string | null;
  /** How many cases stand on this exact coordinate. */
  casesAtPosition: number;
  radiusM: number;
  computedAtMs: number;
  runId: string;
  summary: PatternSummary;
  sectors: PatternSector[];
}

/**
 * The colour a spoke takes: the kind of facility it connects to.
 *
 * Reuses `FACILITY_COLOR` rather than defining a second scale, so a line and
 * the pin it lands on are the same colour — which is what makes the layer
 * readable without consulting a legend. An unrecognised kind falls back to a
 * neutral rather than to another kind's colour, because a wrong colour here
 * reads as a confident claim about what the facility is.
 */
const UNKNOWN_KIND_COLOR = "#94a3b8";

export function spokeColor(kind: string): string {
  return FACILITY_COLOR[kind as FacilityKind] ?? UNKNOWN_KIND_COLOR;
}

/** The Thai label for a kind, falling back to the raw OSM tag when off-union. */
export function kindLabel(kind: string): string {
  return FACILITY_LABEL[kind as FacilityKind] ?? kind;
}

export interface SpokeFeatureProperties {
  sector: number;
  abbr: string;
  name_th: string;
  color: string;
  kind: string;
  neighbour_name: string;
  straight_km: number;
  road_km: number | null;
  detour: number | null;
}

/**
 * One `LineString` per filled direction, anchor → neighbour.
 *
 * Straight two-point lines, deliberately: the spoke is a statement about
 * *which direction and how far*, and drawing the routed road geometry instead
 * would look like a claim that this is the path taken. The road distance is
 * carried as a property and shown in the popup, where it can be labelled.
 */
export function toSpokeFeatureCollection(pattern: DistancePattern | null) {
  return {
    type: "FeatureCollection" as const,
    features: (pattern?.sectors ?? []).map((s) => ({
      type: "Feature" as const,
      geometry: {
        type: "LineString" as const,
        coordinates: [
          [pattern!.lng, pattern!.lat],
          [s.neighbour.lng, s.neighbour.lat],
        ],
      },
      properties: {
        sector: s.sector,
        abbr: s.abbr,
        name_th: s.nameTh,
        color: spokeColor(s.neighbour.kind),
        kind: s.neighbour.kind,
        neighbour_name: s.neighbour.name ?? "(ไม่ระบุชื่อ)",
        straight_km: Number((s.straightM / 1000).toFixed(2)),
        road_km: s.roadM === null ? null : Number((s.roadM / 1000).toFixed(2)),
        detour: s.detourRatio === null ? null : Number(s.detourRatio.toFixed(2)),
      } satisfies SpokeFeatureProperties,
    })),
  };
}

/** The endpoint of each spoke, so the connected facility is marked even when
 *  the facility layer itself is switched off. */
export function toSpokeEndFeatureCollection(pattern: DistancePattern | null) {
  return {
    type: "FeatureCollection" as const,
    features: (pattern?.sectors ?? []).map((s) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [s.neighbour.lng, s.neighbour.lat] },
      properties: { color: spokeColor(s.neighbour.kind), sector: s.sector },
    })),
  };
}

/**
 * The search radius as a polygon, so the analyst can see where "no neighbour
 * in that direction" stops being a claim about the world.
 *
 * Drawn as a 96-gon in degrees with the longitude scaled by cos(lat). At this
 * latitude (~6.5°N) and radius (25 km) the error against a true geodesic
 * circle is a few tens of metres — far inside the 8 km positional uncertainty
 * of the anchor it is drawn around, so a projected circle would be false
 * precision rather than an improvement.
 */
const RING_STEPS = 96;
const METRES_PER_DEGREE_LAT = 111_320;

export function radiusRing(lng: number, lat: number, radiusM: number) {
  const dLat = radiusM / METRES_PER_DEGREE_LAT;
  const dLng = radiusM / (METRES_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180));
  const coordinates = Array.from({ length: RING_STEPS + 1 }, (_, i) => {
    const theta = (i / RING_STEPS) * 2 * Math.PI;
    return [lng + dLng * Math.sin(theta), lat + dLat * Math.cos(theta)] as [number, number];
  });
  return {
    type: "FeatureCollection" as const,
    features: [
      {
        type: "Feature" as const,
        geometry: { type: "LineString" as const, coordinates },
        properties: { radius_km: Math.round(radiusM / 1000) },
      },
    ],
  };
}
