import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// Defined in the client-safe geometry module so the browser can use it too —
// see the note there. Re-exported because half this app imports it from here.
export { distanceMetres } from "./flow/geo-math";
import { distanceMetres } from "./flow/geo-math";

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

export interface Subdistrict extends BoundaryFeature {
  code: string;
  nameTh: string;
  nameEn: string;
  districtCode: string;
  districtNameTh: string;
  provinceCode: string;
  provinceNameTh: string;
}

/**
 * A หมู่บ้าน, as a point rather than an area.
 *
 * No Thai authority publishes village polygons openly — the DDPM boundary
 * service stops at ตำบล — so this is the finest level the map can reach, and
 * it reaches it with a different kind of geometry from a different publisher.
 * `nearestVillage` is therefore an *approximation of the nearest named place*,
 * never a statement that a point lies within that village.
 */
export interface Village {
  /** OSM node id, so a record can be traced back to what was fetched. */
  osmId: number;
  nameTh: string;
  nameEn: string | null;
  /** OSM `place` value: village, hamlet, … */
  kind: string;
  lng: number;
  lat: number;
  subdistrictCode: string | null;
  subdistrictNameTh: string | null;
  districtCode: string;
  districtNameTh: string;
  provinceCode: string;
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
let subdistrictCache: Subdistrict[] | null = null;
let villageCache: Village[] | null = null;

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

export function loadSubdistricts(): Subdistrict[] {
  if (subdistrictCache) return subdistrictCache;
  subdistrictCache = readCollection("south-subdistricts").features.map((f) => ({
    properties: f.properties,
    geometry: f.geometry,
    bbox: computeBbox(f.geometry),
    code: f.properties.subdistrict_code,
    nameTh: f.properties.subdistrict_th,
    nameEn: f.properties.subdistrict_en,
    districtCode: f.properties.district_code,
    districtNameTh: f.properties.district_th,
    provinceCode: f.properties.province_code,
    provinceNameTh: f.properties.province_th,
  }));
  return subdistrictCache;
}

/**
 * Villages, if they have been fetched.
 *
 * Returns an empty list rather than throwing when the file is absent: this
 * layer comes from OpenStreetMap via a separate script, it is optional, and
 * `/report` must keep working for someone who has only run the DDPM fetch.
 */
export function loadVillages(): Village[] {
  if (villageCache) return villageCache;
  try {
    const raw = JSON.parse(
      readFileSync(resolve(DATA_DIR, "south-villages.geojson"), "utf8"),
    ) as {
      features: {
        properties: Record<string, string | number | null>;
        geometry: { coordinates: [number, number] };
      }[];
    };
    villageCache = raw.features.map((f) => ({
      osmId: Number(f.properties.osm_id),
      nameTh: String(f.properties.name_th),
      nameEn: f.properties.name_en === null ? null : String(f.properties.name_en),
      kind: String(f.properties.place),
      lng: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
      subdistrictCode:
        f.properties.subdistrict_code === null ? null : String(f.properties.subdistrict_code),
      subdistrictNameTh:
        f.properties.subdistrict_th === null ? null : String(f.properties.subdistrict_th),
      districtCode: String(f.properties.district_code),
      districtNameTh: String(f.properties.district_th),
      provinceCode: String(f.properties.province_code),
    }));
  } catch {
    villageCache = [];
  }
  return villageCache;
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

/** Which ตำบล contains this point, if any. */
export function subdistrictAt(pt: Position): Subdistrict | undefined {
  return loadSubdistricts().find(
    (s) =>
      pt[0] >= s.bbox[0] &&
      pt[0] <= s.bbox[2] &&
      pt[1] >= s.bbox[1] &&
      pt[1] <= s.bbox[3] &&
      pointInPolygon(pt, s.geometry),
  );
}

/**
 * The nearest named village to a point, with how far away it is.
 *
 * The distance is the whole point of the return value. A village 200 m away is
 * a useful label for where something happened; one 6 km away means the map has
 * no village near that point and saying its name would mislead. Callers decide
 * the threshold, because what counts as "near" differs between a report form
 * and a case summary.
 */
export function nearestVillage(pt: Position): { village: Village; distanceM: number } | null {
  let best: Village | null = null;
  let bestDistance = Infinity;
  for (const village of loadVillages()) {
    const d = distanceMetres(pt, [village.lng, village.lat]);
    if (d < bestDistance) {
      bestDistance = d;
      best = village;
    }
  }
  return best ? { village: best, distanceM: bestDistance } : null;
}

export { computeBbox };
