/**
 * Fetch the response network — the places that answer an incident — for the
 * four Deep South provinces.
 *
 *   npx tsx scripts/fetch-facilities.ts
 *
 * Nine kinds: ด่านตรวจ, ค่ายทหาร, สถานีตำรวจ, สถานีกู้ภัย, สถานีดับเพลิง,
 * ศูนย์อพยพ, ศูนย์ช่วยเหลือ, อนามัย, โรงพยาบาล.
 *
 * Source is OpenStreetMap, for the same reason `fetch-villages.ts` uses it: no
 * Thai authority publishes an open, machine-readable register of these
 * facilities with coordinates. That has consequences the whole feature has to
 * carry honestly:
 *
 *   - **Coverage is contributed, not surveyed.** A ตำบล with no clinic in this
 *     file may well have one. Every consumer must read a missing facility as
 *     "not mapped", never as "not there" — the same contract the village layer
 *     already states. The page says so on screen, and lets an analyst add what
 *     is missing (those live in MongoDB, never in this file).
 *   - **Security-side kinds are the thinnest.** ด่านตรวจ and ค่ายทหาร are
 *     mapped far less consistently than hospitals; the counts printed at the
 *     end are there so that thinness is visible rather than assumed away.
 *   - **Unnamed facilities are kept.** The village layer drops a node with no
 *     Thai name, because a name is the whole point of that layer. Here it is
 *     not: an unnamed fire station at a known position is still the nearest
 *     fire station. The name is left null and the UI says so.
 *
 * Ways and relations (a hospital compound, a camp perimeter) come back through
 * `out center`, so an area becomes the one point this app can put on a map and
 * route to — it is a locator, not the footprint.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { districtAt, subdistrictAt } from "../src/lib/geography";
import { FACILITY_KINDS, type FacilityKind } from "../src/lib/facilities";

const OVERPASS = process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter";

/** Same generous box as the village fetch; the polygon clip below is the authority. */
const BBOX = { south: 5.5, west: 99.9, north: 8.1, east: 102.3 };

/**
 * What to ask Overpass for, and what each answer means here.
 *
 * `nwr` rather than `node`: most hospitals, camps and many stations are mapped
 * as areas. The order of this list does not matter — `classify` decides the
 * kind from the tags, because one element can match two queries (a hospital
 * that is also tagged `healthcare=centre`).
 */
const SELECTORS = [
  '["amenity"="police"]',
  '["barrier"="checkpoint"]',
  '["military"="checkpoint"]',
  '["military"="barracks"]',
  '["landuse"="military"]',
  '["amenity"="fire_station"]',
  '["emergency"="ambulance_station"]',
  '["amenity"="hospital"]',
  '["amenity"="clinic"]',
  '["healthcare"="centre"]',
  '["amenity"="doctors"]',
  '["amenity"="shelter"]',
  '["emergency"="assembly_point"]',
  '["amenity"="social_facility"]',
];

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/**
 * One element to one kind.
 *
 * Ordered most-specific first, because the tags overlap: a `military=barracks`
 * inside `landuse=military` must be a camp, not a second landuse polygon, and
 * a hospital tagged `healthcare=centre` is a hospital.
 */
function classify(tags: Record<string, string>): FacilityKind | null {
  const amenity = tags.amenity ?? "";
  const emergency = tags.emergency ?? "";
  const military = tags.military ?? "";

  if (amenity === "hospital") return "hospital";
  if (amenity === "clinic" || amenity === "doctors" || tags.healthcare === "centre") return "health";
  if (amenity === "fire_station") return "fire";
  if (emergency === "ambulance_station") return "rescue";
  if (amenity === "police") {
    // A police box on a road is a checkpoint in everything but the tag.
    return tags.police === "checkpoint" || tags.checkpoint ? "checkpoint" : "police";
  }
  if (tags.barrier === "checkpoint" || military === "checkpoint") return "checkpoint";
  if (military === "barracks" || tags.landuse === "military") return "military";
  if (emergency === "assembly_point") return "evacuation";
  // A bus shelter is also `amenity=shelter`; only the emergency ones count.
  if (amenity === "shelter") {
    return tags.shelter_type === "emergency" || tags.shelter_type === "public_building"
      ? "evacuation"
      : null;
  }
  if (amenity === "social_facility") return "aid";
  return null;
}

async function fetchElements(): Promise<{
  elements: OverpassElement[];
  query: string;
  timestamp: string;
}> {
  const box = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`;
  const query = `[out:json][timeout:300];
(
${SELECTORS.map((s) => `  nwr${s}(${box});`).join("\n")}
);
out center tags;`;

  const res = await fetch(OVERPASS, {
    method: "POST",
    body: query,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      // Overpass asks for an identifiable agent; reuse the ingestion one so
      // there is a single contact string across every outbound fetch.
      "User-Agent": process.env.INGEST_USER_AGENT || "Palantir-TH/0.1",
    },
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);

  const raw = (await res.json()) as {
    elements?: OverpassElement[];
    osm3s?: { timestamp_osm_base?: string };
  };
  const elements = raw.elements ?? [];
  if (elements.length === 0) throw new Error("Overpass returned no elements");

  return { elements, query, timestamp: raw.osm3s?.timestamp_osm_base ?? "" };
}

/** Thai name preferred — it is what is written on the sign — English kept as a fallback. */
function names(tags: Record<string, string>): { th: string | null; en: string | null } {
  const th = tags["name:th"] ?? (/[฀-๿]/.test(tags.name ?? "") ? tags.name : null) ?? null;
  const en = tags["name:en"] ?? (th && tags.name !== th ? (tags.name ?? null) : null) ?? null;
  return { th: th?.trim() || null, en: en?.trim() || null };
}

/**
 * The day the place began or stopped operating, when OSM records one.
 *
 * `start_date` is the established tag and takes several shapes (`1994`,
 * `1994-05`, `1994-05-01`); anything short is padded to the first of the
 * period, because "opened sometime in 1994" is honestly represented as "on or
 * after 1994-01-01" and never as a precise day. Anything that is not a plain
 * year-first date — `~1990`, `C18`, `before 1970` — is dropped rather than
 * guessed at.
 */
function osmDate(...values: (string | undefined)[]): string | null {
  for (const raw of values) {
    const v = raw?.trim();
    if (!v) continue;
    const match = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(v);
    if (!match) continue;
    return `${match[1]}-${match[2] ?? "01"}-${match[3] ?? "01"}`;
  }
  return null;
}

function phone(tags: Record<string, string>): string | null {
  const raw = tags.phone ?? tags["contact:phone"] ?? tags["emergency:phone"] ?? null;
  return raw ? raw.split(";")[0].trim() : null;
}

async function main() {
  const outDir = resolve(process.cwd(), "public/data");
  await mkdir(outDir, { recursive: true });

  const { elements, query, timestamp } = await fetchElements();

  let unclassified = 0;
  let noPosition = 0;
  let outside = 0;

  const features = [];
  for (const el of elements) {
    const tags = el.tags ?? {};
    const kind = classify(tags);
    if (!kind) {
      unclassified++;
      continue;
    }

    const lon = el.lon ?? el.center?.lon;
    const lat = el.lat ?? el.center?.lat;
    if (lon === undefined || lat === undefined) {
      noPosition++;
      continue;
    }

    // Clipped against the same DDPM polygons every other layer is built from,
    // so a facility can never sit in a district this app does not know about.
    const district = districtAt([lon, lat]);
    if (!district) {
      outside++;
      continue;
    }
    const subdistrict = subdistrictAt([lon, lat]);
    const { th, en } = names(tags);

    features.push({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [lon, lat] },
      properties: {
        id: `osm_${el.type}_${el.id}`,
        osm_type: el.type,
        osm_id: el.id,
        kind,
        name_th: th,
        name_en: en,
        phone: phone(tags),
        opening_hours: tags.opening_hours ?? null,
        opened_on: osmDate(tags.start_date, tags.opening_date, tags["construction:end_date"]),
        closed_on: osmDate(tags.end_date, tags["disused:start_date"]),
        operator: tags.operator ?? tags["operator:th"] ?? null,
        subdistrict_th: subdistrict?.nameTh ?? null,
        district_code: district.code,
        district_th: district.nameTh,
        province_code: district.provinceCode,
      },
    });
  }

  // Stable order so re-running produces a byte-identical file for an unchanged
  // OSM extract, the same property `fetch-boundaries.ts` guarantees.
  features.sort((a, b) => a.properties.id.localeCompare(b.properties.id));

  const collection = { type: "FeatureCollection" as const, features };
  await writeFile(resolve(outDir, "south-facilities.geojson"), JSON.stringify(collection));

  const byKind: Record<string, number> = Object.fromEntries(FACILITY_KINDS.map((k) => [k, 0]));
  const byProvince: Record<string, number> = {};
  let named = 0;
  let withPhone = 0;
  let withHours = 0;
  let withDates = 0;
  for (const f of features) {
    byKind[f.properties.kind] += 1;
    const code = String(f.properties.province_code);
    byProvince[code] = (byProvince[code] ?? 0) + 1;
    if (f.properties.name_th || f.properties.name_en) named++;
    if (f.properties.phone) withPhone++;
    if (f.properties.opening_hours) withHours++;
    if (f.properties.opened_on || f.properties.closed_on) withDates++;
  }

  await writeFile(
    resolve(outDir, "south-facilities.meta.json"),
    JSON.stringify(
      {
        layer: "south-facilities",
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
        geometry: "Point (areas reduced to their centre)",
        feature_count: features.length,
        feature_count_by_kind: byKind,
        feature_count_by_province: byProvince,
        rows_with_name: named,
        rows_with_phone: withPhone,
        rows_with_opening_hours: withHours,
        rows_with_start_or_end_date: withDates,
        dropped: {
          not_one_of_the_nine_kinds: unclassified,
          no_position: noPosition,
          outside_four_provinces: outside,
        },
        joined_against: "public/data/south-districts.geojson, public/data/south-subdistricts.geojson",
        notes:
          "ไม่ใช่ทะเบียนหน่วยงานทางการ — เป็นข้อมูลที่อาสาสมัคร OSM ร่วมกันสร้าง ความครอบคลุมไม่เท่ากันในแต่ละพื้นที่ " +
          "โดยเฉพาะด่านตรวจและค่ายทหารซึ่งมีการทำแผนที่น้อยกว่าโรงพยาบาลมาก " +
          "สถานที่ที่ไม่ปรากฏในไฟล์นี้ให้อ่านว่า 'ยังไม่ถูกทำแผนที่' ไม่ใช่ 'ไม่มี' " +
          "จุดของพื้นที่ (โรงพยาบาล/ค่าย) คือจุดกึ่งกลางเพื่อใช้อ้างอิงตำแหน่ง ไม่ใช่ขอบเขตของสถานที่ " +
          "การเผยแพร่ซ้ำต้องให้เครดิต OpenStreetMap ตามเงื่อนไข ODbL",
      },
      null,
      2,
    ),
  );

  const kb = (n: number) => `${Math.round(n / 1024)}KB`;
  console.log(
    `  south-facilities ${features.length} points  ${kb(Buffer.byteLength(JSON.stringify(collection)))}` +
      `  (dropped ${unclassified} other kinds, ${noPosition} without position, ${outside} outside)`,
  );
  console.log(`  by kind: ${JSON.stringify(byKind)}`);
  console.log(`  by province: ${JSON.stringify(byProvince)}`);
  console.log(
    `  named ${named}/${features.length}, phone ${withPhone}, hours ${withHours}, dates ${withDates}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
