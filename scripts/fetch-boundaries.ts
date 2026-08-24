/**
 * Fetch authoritative administrative boundaries for the four Deep South
 * provinces and write web-ready GeoJSON.
 *
 *   npx tsx scripts/fetch-boundaries.ts
 *
 * Replaces the manual QGIS step in the GIS workflow with a reproducible one:
 * fetch -> validate -> clip to the four provinces -> simplify -> EPSG:4326.
 * Running it again is idempotent; the output is byte-stable for a given
 * source revision and tolerance.
 *
 * Source of record is the DDPM administrative-boundary service. Province and
 * district geometry come from the same EPSG:4326 service revision so shared
 * boundaries do not drift between publishers. Provenance for every fetch is written to a sidecar
 * `.meta.json` next to the data, per the Data Source Protocol (§9).
 */
import simplify from "@turf/simplify";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const PORTAL =
  "https://gis-portal.disaster.go.th/arcgis/rest/services/MapDX/DPM_TH_Boundary/MapServer";

/** จังหวัดชายแดนใต้ที่อยู่ในขอบเขตของระบบ */
const PROVINCE_CODES = ["90", "94", "95", "96"] as const; // สงขลา ปัตตานี ยะลา นราธิวาส

interface LayerSpec {
  /** Output basename under public/data. */
  name: string;
  layerId: 1 | 2;
  /** ArcGIS `where` clause restricting the fetch to our four provinces. */
  where: string;
  outFields: string[];
  /**
   * Douglas-Peucker tolerance in degrees. Province outlines carry the map at
   * low zoom and can be coarser; district lines are only shown zoomed in.
   */
  tolerance: number;
  /** Rename raw ArcGIS fields to the canonical property names. */
  map: (p: Record<string, unknown>) => Record<string, string>;
}

const LAYERS: LayerSpec[] = [
  {
    // The rest of Thailand, drawn dim behind the focus area so the four
    // provinces read as part of the country rather than floating in the sea.
    // Excludes the focus provinces so the two layers never overlap and
    // double-paint their shared fill.
    name: "thailand-provinces",
    layerId: 1,
    where: `PROV_CODE NOT IN (${PROVINCE_CODES.map((c) => `'${c}'`).join(",")})`,
    outFields: ["PROV_CODE", "PROV_NAM_T", "PROV_NAM_E"],
    // Context only — never inspected up close, so it can be much coarser.
    tolerance: 0.006,
    map: (p) => ({
      province_code: String(p.PROV_CODE),
      province_th: stripPrefix(String(p.PROV_NAM_T ?? ""), "province"),
      province_en: titleCase(String(p.PROV_NAM_E ?? "").replace(/^CHANGWAT\s+/i, "")),
    }),
  },
  {
    name: "south-provinces",
    layerId: 1,
    where: `PROV_CODE IN (${PROVINCE_CODES.map((c) => `'${c}'`).join(",")})`,
    outFields: ["PROV_CODE", "PROV_NAM_T", "PROV_NAM_E"],
    // Matched to the district tolerance below. Simplifying the two levels at
    // different tolerances makes the coarser province outline cut inside the
    // finer district outlines along the coast, so district lines visibly poke
    // out past the province boundary they belong to.
    tolerance: 0.0006,
    map: (p) => ({
      province_code: String(p.PROV_CODE),
      province_th: stripPrefix(String(p.PROV_NAM_T ?? ""), "province"),
      province_en: titleCase(String(p.PROV_NAM_E ?? "").replace(/^CHANGWAT\s+/i, "")),
    }),
  },
  {
    name: "south-districts",
    layerId: 2,
    where: `PROV_CODE IN (${PROVINCE_CODES.map((c) => `'${c}'`).join(",")})`,
    outFields: ["AMP_CODE", "AMP_NAM_T", "AMP_NAM_E", "PROV_CODE", "PROV_NAM_T"],
    tolerance: 0.0006,
    map: (p) => ({
      district_code: String(p.AMP_CODE),
      district_th: stripPrefix(String(p.AMP_NAM_T ?? ""), "district"),
      district_en: titleCase(String(p.AMP_NAM_E ?? "").replace(/^AMPHOE\s+/i, "")),
      province_code: String(p.PROV_CODE),
      province_th: stripPrefix(String(p.PROV_NAM_T ?? ""), "province"),
    }),
  },
];

const titleCase = (s: string) =>
  s.toLowerCase().replace(/(^|\s|-)([a-z])/g, (_, sep, c) => sep + c.toUpperCase());

/**
 * Strip the administrative prefix from a Thai place name. The GISTDA layers
 * are inconsistent — the province layer spells it out ("จังหวัดปัตตานี") while
 * the amphoe layer abbreviates ("อ.เมืองสงขลา", "จ.สงขลา") — so handle both.
 */
const stripPrefix = (s: string, kind: "province" | "district") =>
  s
    .replace(kind === "province" ? /^(จังหวัด|จ\.)\s*/ : /^(อำเภอ|อ\.)\s*/, "")
    .trim();

interface GeoJsonFeature {
  type: "Feature";
  properties: Record<string, string>;
  geometry: { type: string; coordinates: unknown };
}

async function fetchLayer(spec: LayerSpec) {
  const url = new URL(`${PORTAL}/${spec.layerId}/query`);
  url.searchParams.set("where", spec.where);
  url.searchParams.set("outFields", spec.outFields.join(","));
  // Everything downstream assumes WGS84; ask the server to reproject.
  url.searchParams.set("outSR", "4326");
  url.searchParams.set("f", "geojson");

  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`${spec.name}: HTTP ${res.status}`);

  const raw = (await res.json()) as {
    error?: { message?: string };
    features?: GeoJsonFeature[];
  };
  if (raw.error) throw new Error(`${spec.name}: ${raw.error.message ?? "ArcGIS error"}`);
  if (!raw.features?.length) throw new Error(`${spec.name}: no features returned`);

  return { url: url.toString(), features: raw.features };
}

/** Reject anything that would render as a hole or crash a WebGL tessellator. */
function validate(features: GeoJsonFeature[], label: string) {
  for (const f of features) {
    const { type, coordinates } = f.geometry;
    if (type !== "Polygon" && type !== "MultiPolygon") {
      throw new Error(`${label}: unexpected geometry ${type}`);
    }
    if (!Array.isArray(coordinates) || coordinates.length === 0) {
      throw new Error(`${label}: empty geometry`);
    }
  }
}

const byteSize = (o: unknown) => Buffer.byteLength(JSON.stringify(o));

async function main() {
  const outDir = resolve(process.cwd(), "public/data");
  await mkdir(outDir, { recursive: true });

  const fetchedAt = new Date().toISOString();

  for (const spec of LAYERS) {
    const { url, features } = await fetchLayer(spec);
    validate(features, spec.name);

    const before = byteSize({ type: "FeatureCollection", features });

    const cleaned = features.map((f) => {
      // Simplify mutates, so hand it a copy. The two boundary levels are
      // sourced from the same DDPM service revision before simplification.
      const { geometry } = simplify(
        { type: "Feature", properties: {}, geometry: f.geometry } as Parameters<typeof simplify>[0],
        { tolerance: spec.tolerance, highQuality: true, mutate: true },
      ) as unknown as GeoJsonFeature;
      return { type: "Feature" as const, properties: spec.map(f.properties), geometry };
    });

    const collection = { type: "FeatureCollection" as const, features: cleaned };
    const after = byteSize(collection);

    await writeFile(resolve(outDir, `${spec.name}.geojson`), JSON.stringify(collection));

    // Provenance sidecar — Data Source Protocol §9.
    await writeFile(
      resolve(outDir, `${spec.name}.meta.json`),
      JSON.stringify(
        {
          layer: spec.name,
          owner: "กรมป้องกันและบรรเทาสาธารณภัย (DDPM)",
          published_via: "DDPM GIS Portal",
          access_method: "REST API (ArcGIS FeatureServer query, f=geojson)",
          source_url: url,
          fetched_at: fetchedAt,
          crs: "EPSG:4326",
          encoding: "UTF-8",
          feature_count: cleaned.length,
          simplify: { algorithm: "douglas-peucker", tolerance: spec.tolerance, highQuality: true },
          size_bytes: { source: before, published: after },
          field_mapping: spec.outFields,
          notes:
            "ตรวจสอบเงื่อนไขการใช้งานกับ DDPM ก่อนเผยแพร่ซ้ำ " +
            "ไฟล์นี้ถูก simplify แล้วจึงไม่เหมาะกับการวัดพื้นที่หรืองานที่ต้องการความแม่นยำเชิงตำแหน่ง",
        },
        null,
        2,
      ),
    );

    const pct = Math.round((1 - after / before) * 100);
    console.log(
      `  ${spec.name.padEnd(17)} ${String(cleaned.length).padStart(3)} features  ` +
        `${(before / 1024).toFixed(0)}KB -> ${(after / 1024).toFixed(0)}KB (-${pct}%)`,
    );
  }

  console.log(`\nWrote public/data (fetched_at ${fetchedAt}).`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
