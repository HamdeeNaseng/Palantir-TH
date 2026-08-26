import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

const DATA_DIR = resolve(process.cwd(), "public/data");
const ALLOWED_PROVINCES = new Set(["90", "94", "95", "96"]);

const specs = [
  {
    name: "south-provinces",
    code: "province_code",
    expected: 4,
    required: ["province_code", "province_th", "province_en"],
  },
  {
    name: "south-districts",
    code: "district_code",
    expected: 49,
    required: ["district_code", "district_th", "district_en", "province_code", "province_th"],
  },
  {
    name: "south-subdistricts",
    code: "subdistrict_code",
    // 379 polygons from DDPM, 377 ตำบล: ต.เกาะยอ and ต.เกาะใหญ่ are each
    // published as two islands and are merged into MultiPolygons on fetch.
    expected: 377,
    required: [
      "subdistrict_code",
      "subdistrict_th",
      "subdistrict_en",
      "district_code",
      "district_th",
      "province_code",
      "province_th",
    ],
  },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function validatePosition(position, label) {
  assert(Array.isArray(position) && position.length >= 2, `${label}: invalid position`);
  const [lng, lat] = position;
  assert(Number.isFinite(lng) && Number.isFinite(lat), `${label}: non-numeric coordinate`);
  assert(lng >= 97 && lng <= 106 && lat >= 5 && lat <= 21, `${label}: coordinate outside Thailand`);
}

function validateRing(ring, label) {
  assert(Array.isArray(ring) && ring.length >= 4, `${label}: ring has fewer than four positions`);
  for (const position of ring) validatePosition(position, label);
  const first = ring[0];
  const last = ring.at(-1);
  assert(first[0] === last[0] && first[1] === last[1], `${label}: ring is not closed`);
}

function validateGeometry(geometry, label) {
  assert(geometry && ["Polygon", "MultiPolygon"].includes(geometry.type), `${label}: invalid geometry type`);
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  assert(Array.isArray(polygons) && polygons.length > 0, `${label}: empty geometry`);
  for (const polygon of polygons) {
    assert(Array.isArray(polygon) && polygon.length > 0, `${label}: polygon has no rings`);
    for (const ring of polygon) validateRing(ring, label);
  }
}

for (const spec of specs) {
  const [geojsonText, metaText] = await Promise.all([
    readFile(resolve(DATA_DIR, `${spec.name}.geojson`), "utf8"),
    readFile(resolve(DATA_DIR, `${spec.name}.meta.json`), "utf8"),
  ]);
  const collection = JSON.parse(geojsonText);
  const meta = JSON.parse(metaText);

  assert(collection.type === "FeatureCollection", `${spec.name}: expected FeatureCollection`);
  assert(collection.features.length === spec.expected, `${spec.name}: expected ${spec.expected} features`);
  assert(meta.feature_count === collection.features.length, `${spec.name}: metadata feature count mismatch`);
  assert(meta.crs === "EPSG:4326", `${spec.name}: CRS must be EPSG:4326`);
  assert(new URL(meta.source_url).hostname === "gis-portal.disaster.go.th", `${spec.name}: unexpected source host`);

  const ids = new Set();
  collection.features.forEach((feature, index) => {
    const label = `${spec.name}[${index}]`;
    assert(feature.type === "Feature", `${label}: invalid feature`);
    validateGeometry(feature.geometry, label);
    for (const key of spec.required) assert(String(feature.properties?.[key] ?? "").trim(), `${label}: missing ${key}`);
    assert(ALLOWED_PROVINCES.has(String(feature.properties.province_code)), `${label}: province outside scope`);
    const id = String(feature.properties[spec.code]);
    assert(!ids.has(id), `${label}: duplicate ${spec.code} ${id}`);
    ids.add(id);
  });

  console.log(`Validated ${spec.name}: ${collection.features.length} EPSG:4326 polygon features.`);
}
