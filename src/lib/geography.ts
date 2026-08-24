import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Real administrative geography, loaded from the DDPM boundaries in
 * `public/data`. This is the single source of truth for where a place is —
 * nothing in the app should carry a hand-written coordinate or district list.
 *
 * Server-only: reads from disk. Client code wanting labels imports
 * `./labels` instead.
 */

export type Position = [number, number];

export interface PolygonGeometry {
  type: "Polygon" | "MultiPolygon";
  coordinates: number[][][] | number[][][][];
}

export interface BoundaryFeature {
  properties: Record<string, string>;
  geometry: PolygonGeometry;
  /** [minLng, minLat, maxLng, maxLat] — precomputed for rejection sampling. */
  bbox: [number, number, number, number];
}

export interface District extends BoundaryFeature {
  code: string;
  nameTh: string;
  provinceCode: string;
  provinceNameTh: string;
}

export interface Province extends BoundaryFeature {
  code: string;
  nameTh: string;
}

// ------------------------------------------------------------------ geometry

/**
 * Normalise to a list of polygons, each being [outerRing, ...holes], so
 * Polygon and MultiPolygon can be walked by the same code.
 */
function ringsGrouped(g: PolygonGeometry): number[][][][] {
  return g.type === "Polygon"
    ? [g.coordinates as unknown as number[][][]]
    : (g.coordinates as unknown as number[][][][]);
}

/** Standard even-odd ray casting against a single ring. */
function pointInRing([x, y]: Position, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * True when the point is inside the geometry — inside an outer ring and not
 * inside any of that polygon's holes.
 */
export function pointInPolygon(pt: Position, g: PolygonGeometry): boolean {
  for (const rings of ringsGrouped(g)) {
    if (!pointInRing(pt, rings[0])) continue;
    let inHole = false;
    for (let k = 1; k < rings.length; k++) {
      if (pointInRing(pt, rings[k])) {
        inHole = true;
        break;
      }
    }
    if (!inHole) return true;
  }
  return false;
}

function computeBbox(g: PolygonGeometry): [number, number, number, number] {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const rings of ringsGrouped(g)) {
    for (const ring of rings) {
      for (const [lng, lat] of ring) {
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
  }
  return [minLng, minLat, maxLng, maxLat];
}

/**
 * A point guaranteed to lie inside the geometry.
 *
 * The arithmetic centroid is NOT safe here: several districts along the Pattani
 * and Narathiwat coast are concave or crescent-shaped, and their centroid falls
 * in the sea. So take the centroid only when it actually tests inside, and
 * otherwise search a grid over the bounding box for the interior point furthest
 * from the boundary — a coarse pole of inaccessibility, which is stable and
 * good enough for placing a district-level marker.
 */
export function representativePoint(g: PolygonGeometry): Position {
  const [minLng, minLat, maxLng, maxLat] = computeBbox(g);

  // Vertex-average centroid, cheap and usually correct for convex shapes.
  let sumLng = 0;
  let sumLat = 0;
  let n = 0;
  for (const rings of ringsGrouped(g)) {
    for (const [lng, lat] of rings[0]) {
      sumLng += lng;
      sumLat += lat;
      n++;
    }
  }
  const centroid: Position = [sumLng / n, sumLat / n];
  if (pointInPolygon(centroid, g)) return centroid;

  // Grid search: keep the interior candidate with the largest clearance to the
  // bounding box edges, which pushes the result toward the middle of the mass.
  const STEPS = 48;
  let best: Position | null = null;
  let bestScore = -Infinity;
  for (let i = 1; i < STEPS; i++) {
    for (let j = 1; j < STEPS; j++) {
      const p: Position = [
        minLng + ((maxLng - minLng) * i) / STEPS,
        minLat + ((maxLat - minLat) * j) / STEPS,
      ];
      if (!pointInPolygon(p, g)) continue;
      const score = Math.min(
        p[0] - minLng,
        maxLng - p[0],
        p[1] - minLat,
        maxLat - p[1],
      );
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
  }

  // A polygon with no interior grid hit would be degenerate; fall back to the
  // first vertex, which is on the boundary but at least on the right feature.
  return best ?? (ringsGrouped(g)[0][0][0] as Position);
}

/**
 * Uniform random point inside the geometry via rejection sampling.
 *
 * `rng` must be the caller's seeded generator so fixtures stay reproducible.
 * Long thin districts can reject many times, so the attempt count is capped and
 * falls back to the representative point rather than looping unbounded.
 */
export function randomPointInPolygon(
  rng: () => number,
  g: PolygonGeometry,
  bbox: [number, number, number, number],
  maxAttempts = 200,
): Position {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  for (let i = 0; i < maxAttempts; i++) {
    const p: Position = [
      minLng + rng() * (maxLng - minLng),
      minLat + rng() * (maxLat - minLat),
    ];
    if (pointInPolygon(p, g)) return p;
  }
  return representativePoint(g);
}

// -------------------------------------------------------------------- loading

const DATA_DIR = resolve(process.cwd(), "public/data");

function readCollection(name: string): { features: { properties: Record<string, string>; geometry: PolygonGeometry }[] } {
  return JSON.parse(readFileSync(resolve(DATA_DIR, `${name}.geojson`), "utf8"));
}

let districtCache: District[] | null = null;
let provinceCache: Province[] | null = null;

export function loadDistricts(): District[] {
  if (districtCache) return districtCache;
  districtCache = readCollection("south-districts").features.map((f) => ({
    properties: f.properties,
    geometry: f.geometry,
    bbox: computeBbox(f.geometry),
    code: f.properties.district_code,
    nameTh: f.properties.district_th,
    provinceCode: f.properties.province_code,
    provinceNameTh: f.properties.province_th,
  }));
  return districtCache;
}

export function loadProvinces(): Province[] {
  if (provinceCache) return provinceCache;
  provinceCache = readCollection("south-provinces").features.map((f) => ({
    properties: f.properties,
    geometry: f.geometry,
    bbox: computeBbox(f.geometry),
    code: f.properties.province_code,
    nameTh: f.properties.province_th,
  }));
  return provinceCache;
}

/** Districts belonging to one province, in stable code order. */
export function districtsOfProvince(provinceCode: string): District[] {
  return loadDistricts()
    .filter((d) => d.provinceCode === provinceCode)
    .sort((a, b) => a.code.localeCompare(b.code));
}

/** Which district actually contains this point, if any. */
export function districtAt(pt: Position): District | undefined {
  return loadDistricts().find(
    (d) =>
      pt[0] >= d.bbox[0] &&
      pt[0] <= d.bbox[2] &&
      pt[1] >= d.bbox[1] &&
      pt[1] <= d.bbox[3] &&
      pointInPolygon(pt, d.geometry),
  );
}

export { computeBbox };
