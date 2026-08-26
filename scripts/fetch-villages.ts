/**
 * Fetch หมู่บ้าน-level named places for the four Deep South provinces.
 *
 *   npx tsx scripts/fetch-villages.ts
 *
 * Why this is a separate script from `fetch-boundaries.ts`, and not just
 * another layer in it:
 *
 * The DDPM boundary service — the source of record for every other level in
 * this app — stops at ตำบล. It publishes no หมู่บ้าน layer, and no Thai
 * authority publishes village *polygons* as open data at all. So the finest
 * level this map can reach is reached with different geometry (points, not
 * areas) from a different publisher (OpenStreetMap, ODbL) at a different
 * completeness (contributed, not surveyed). Mixing that into the DDPM fetch
 * would let all three of those differences disappear behind one filename.
 *
 * What this does buy: a name for where something happened. "อ.เมืองปัตตานี" is
 * 160 km²; "ใกล้บ้านปะกาฮะรัง 300 ม." is a place a person recognises.
 *
 * Coverage is partial and unevenly distributed — OSM has more of some ตำบล
 * than others — so every consumer must treat a missing village as "not
 * mapped", never as "not there". `nearestVillage` returns the distance for
 * exactly this reason.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { districtAt, subdistrictAt } from "../src/lib/geography";

const OVERPASS = process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter";

/**
 * Bounding box around the four provinces. Deliberately generous — it also
 * catches parts of Malaysia and the upper Gulf, which the point-in-polygon
 * pass below discards. Clipping by our own DDPM polygons rather than by the
 * box is what keeps the output aligned with every other layer.
 */
const BBOX = { south: 5.5, west: 99.9, north: 8.1, east: 102.3 };

/**
 * `village` and `hamlet` are what Thai หมู่บ้าน are tagged as in OSM.
 * `neighbourhood` is deliberately excluded: in Thai cities it marks
 * sub-areas of a เทศบาล, which are not หมู่บ้าน and would inflate the count
 * with names that mean something else.
 */
const PLACE_KINDS = ["village", "hamlet"] as const;

interface OverpassNode {
  type: "node";
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
}

async function fetchNodes(): Promise<{ nodes: OverpassNode[]; query: string; timestamp: string }> {
  const query = `[out:json][timeout:180];
(
  node["place"~"^(${PLACE_KINDS.join("|")})$"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
);
out body;`;

  const res = await fetch(OVERPASS, {
    method: "POST",
    body: query,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      // Overpass asks for an identifiable agent; reuse the ingestion one so
      // there is a single contact string across every outbound fetch.
      "User-Agent": process.env.INGEST_USER_AGENT || "Palantir-TH/0.1",
    },
    signal: AbortSignal.timeout(240_000),
  });
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);

  const raw = (await res.json()) as {
    elements?: OverpassNode[];
    osm3s?: { timestamp_osm_base?: string };
  };
  const nodes = (raw.elements ?? []).filter((e) => e.type === "node");
  if (nodes.length === 0) throw new Error("Overpass returned no nodes");

  return { nodes, query, timestamp: raw.osm3s?.timestamp_osm_base ?? "" };
}

/**
 * The Thai name, which is the one this app displays.
 *
 * A node whose only name is a romanisation is dropped rather than shown: the
 * whole value of this layer is that a reporter recognises the name, and
 * "Ban Pakaharang" is not what is written on the sign.
 */
function thaiName(tags: Record<string, string>): string | null {
  const candidate = tags["name:th"] || tags.name;
  if (!candidate) return null;
  return /[฀-๿]/.test(candidate) ? candidate.trim() : null;
}

async function main() {
  const outDir = resolve(process.cwd(), "public/data");
  await mkdir(outDir, { recursive: true });

  const { nodes, query, timestamp } = await fetchNodes();

  let unnamed = 0;
  let outside = 0;
  let noSubdistrict = 0;

  const features = [];
  for (const node of nodes) {
    const name = thaiName(node.tags ?? {});
    if (!name) {
      unnamed++;
      continue;
    }

    // Clipped against the same polygons every other layer is built from, so a
    // village can never sit in a district this app does not know about.
    const district = districtAt([node.lon, node.lat]);
    if (!district) {
      outside++;
      continue;
    }
    const subdistrict = subdistrictAt([node.lon, node.lat]);
    if (!subdistrict) noSubdistrict++;

    features.push({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [node.lon, node.lat] },
      properties: {
        osm_id: node.id,
        name_th: name,
        name_en: node.tags?.["name:en"] ?? null,
        place: node.tags?.place ?? "village",
        subdistrict_code: subdistrict?.code ?? null,
        subdistrict_th: subdistrict?.nameTh ?? null,
        district_code: district.code,
        district_th: district.nameTh,
        province_code: district.provinceCode,
      },
    });
  }

  // Stable order so re-running produces a byte-identical file for an unchanged
  // OSM extract, the same property `fetch-boundaries.ts` guarantees.
  features.sort((a, b) => Number(a.properties.osm_id) - Number(b.properties.osm_id));

  const collection = { type: "FeatureCollection" as const, features };
  await writeFile(resolve(outDir, "south-villages.geojson"), JSON.stringify(collection));

  const byProvince: Record<string, number> = {};
  for (const f of features) {
    const code = String(f.properties.province_code);
    byProvince[code] = (byProvince[code] ?? 0) + 1;
  }

  await writeFile(
    resolve(outDir, "south-villages.meta.json"),
    JSON.stringify(
      {
        layer: "south-villages",
        owner: "OpenStreetMap contributors",
        licence: "ODbL 1.0 — https://www.openstreetmap.org/copyright",
        published_via: "Overpass API",
        access_method: "Overpass QL (POST)",
        source_url: OVERPASS,
        query,
        osm_data_timestamp: timestamp,
        fetched_at: new Date().toISOString(),
        crs: "EPSG:4326",
        encoding: "UTF-8",
        geometry: "Point",
        feature_count: features.length,
        feature_count_by_province: byProvince,
        dropped: { unnamed_or_latin_only: unnamed, outside_four_provinces: outside },
        joined_against: "public/data/south-districts.geojson, public/data/south-subdistricts.geojson",
        rows_without_subdistrict: noSubdistrict,
        notes:
          "ไม่ใช่ทะเบียนหมู่บ้านทางการ — เป็นข้อมูลที่อาสาสมัคร OSM ร่วมกันสร้าง ความครอบคลุมไม่เท่ากันในแต่ละพื้นที่ " +
          "และไม่มีขอบเขตพื้นที่ ใช้ได้เฉพาะเป็นชื่อสถานที่ใกล้เคียง ไม่ใช่การระบุว่าจุดหนึ่งอยู่ในหมู่บ้านใด " +
          "การเผยแพร่ซ้ำต้องให้เครดิต OpenStreetMap ตามเงื่อนไข ODbL",
      },
      null,
      2,
    ),
  );

  const kb = (n: number) => `${Math.round(n / 1024)}KB`;
  console.log(
    `  south-villages ${features.length} points  ${kb(Buffer.byteLength(JSON.stringify(collection)))}` +
      `  (dropped ${unnamed} unnamed, ${outside} outside; ${noSubdistrict} without ตำบล)`,
  );
  console.log(`  by province: ${JSON.stringify(byProvince)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
