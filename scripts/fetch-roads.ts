/**
 * Fetch the drivable road network for the four Deep South provinces and
 * compile it into a routing graph.
 *
 *   npx tsx scripts/fetch-roads.ts
 *
 * This is what replaced a self-hosted Valhalla container. Routing between two
 * events needs road *topology*, and the DDPM boundary service publishes none —
 * it stops at ตำบล polygons. OpenStreetMap has the ways; Overpass serves them
 * without the ~1 GB country extract a routing engine would want, which matters
 * because that download is exactly what could not be obtained here.
 *
 * Scope is the **through network** (motorway → tertiary, plus their _link
 * ramps), not every residential soi. Including `residential`/`unclassified`
 * takes the four provinces from ~21k ways to ~163k — an eightfold cost for
 * streets that do not change which corridor connects two events kilometres
 * apart. A corridor is a claim about the route between incidents, not about
 * the last hundred metres of it.
 *
 * The output is a pre-built graph, not raw GeoJSON, because the server would
 * otherwise have to rebuild node identity and adjacency from scratch on every
 * cold start. Deduplicating shared way endpoints is most of the work of
 * building the graph, and it is deterministic — so it is done once, here.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { districtAt } from "../src/lib/geography";

const OVERPASS = process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter";

/**
 * Same generous box as `fetch-villages.ts` — it also catches Malaysia and the
 * Gulf, which the point-in-polygon pass discards. Clipping by our own DDPM
 * polygons rather than by the box keeps this aligned with every other layer.
 */
const BBOX = { south: 5.5, west: 99.9, north: 8.1, east: 102.3 };

/** The through network. See the header for why `residential` is excluded. */
const HIGHWAY_CLASSES = [
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
] as const;

/**
 * Nominal free-flow speed per class, km/h. Used only when a way carries no
 * `maxspeed` tag — and only to weight the graph, never to claim a travel time.
 * The feasibility band a corridor ends up in is derived from the event
 * timestamps, not from these.
 */
const DEFAULT_SPEED_KMH: Record<string, number> = {
  motorway: 110,
  trunk: 90,
  primary: 80,
  secondary: 70,
  tertiary: 60,
};

interface OverpassWay {
  type: "way";
  id: number;
  nodes: number[];
  tags?: Record<string, string>;
}

interface OverpassNode {
  type: "node";
  id: number;
  lat: number;
  lon: number;
}

async function fetchRoads(): Promise<{
  ways: OverpassWay[];
  nodes: Map<number, [number, number]>;
  query: string;
  timestamp: string;
}> {
  const classes = HIGHWAY_CLASSES.join("|");
  // `>;` pulls the member nodes of every matched way — without their
  // coordinates the way ids alone describe topology with no geometry.
  const query = `[out:json][timeout:600];
(
  way["highway"~"^(${classes})(_link)?$"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
);
(._;>;);
out body;`;

  const res = await fetch(OVERPASS, {
    method: "POST",
    body: query,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "User-Agent": process.env.INGEST_USER_AGENT || "Palantir-TH/0.1",
    },
    signal: AbortSignal.timeout(900_000),
  });
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);

  const raw = (await res.json()) as {
    elements?: (OverpassWay | OverpassNode)[];
    osm3s?: { timestamp_osm_base?: string };
  };

  const ways: OverpassWay[] = [];
  const nodes = new Map<number, [number, number]>();
  for (const el of raw.elements ?? []) {
    if (el.type === "way") ways.push(el);
    else if (el.type === "node") nodes.set(el.id, [el.lon, el.lat]);
  }
  if (ways.length === 0) throw new Error("Overpass returned no ways");

  return { ways, nodes, query, timestamp: raw.osm3s?.timestamp_osm_base ?? "" };
}

/** OSM's `oneway` is a small vocabulary, not a boolean. `-1` means digitised backwards. */
function onewayOf(tags: Record<string, string>): 0 | 1 | -1 {
  const v = tags.oneway;
  if (v === "yes" || v === "true" || v === "1") return 1;
  if (v === "-1" || v === "reverse") return -1;
  // Motorway carriageways are one-way by definition even when untagged.
  if (!v && tags.highway === "motorway") return 1;
  return 0;
}

function speedOf(tags: Record<string, string>): number {
  const raw = tags.maxspeed;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  const cls = (tags.highway ?? "").replace(/_link$/, "");
  return DEFAULT_SPEED_KMH[cls] ?? 50;
}

async function main() {
  const outDir = resolve(process.cwd(), "public/data");
  await mkdir(outDir, { recursive: true });

  console.log("Fetching road network from Overpass (this takes a few minutes)…");
  const { ways, nodes, query, timestamp } = await fetchRoads();
  console.log(`  ${ways.length} ways, ${nodes.size} nodes returned`);

  /**
   * Only nodes inside the four provinces are kept, and a way is kept where it
   * has at least two consecutive surviving nodes. Clipping node-by-node rather
   * than dropping any way that strays outside keeps the highways that run
   * along the boundary usable instead of punching holes in the network.
   */
  const inside = new Map<number, boolean>();
  const isInside = (id: number): boolean => {
    const cached = inside.get(id);
    if (cached !== undefined) return cached;
    const pt = nodes.get(id);
    const ok = pt ? districtAt(pt) !== undefined : false;
    inside.set(id, ok);
    return ok;
  };

  /**
   * Graph nodes are deduplicated by OSM node id, which is what makes two ways
   * that share an intersection actually connect. Only ids that survive
   * clipping and are used by a kept segment get an index, so the emitted node
   * array carries no orphans.
   */
  const indexOf = new Map<number, number>();
  const coords: [number, number][] = [];
  const nodeIndex = (osmId: number): number => {
    const existing = indexOf.get(osmId);
    if (existing !== undefined) return existing;
    const idx = coords.length;
    indexOf.set(osmId, idx);
    coords.push(nodes.get(osmId)!);
    return idx;
  };

  // [fromIndex, toIndex, lengthMetres, speedKmh] — flat tuples rather than
  // objects, because this file is parsed on a cold start and 200k small
  // objects cost far more to allocate than 200k array slots.
  const edges: [number, number, number, number][] = [];
  let clippedWays = 0;

  for (const way of ways) {
    const tags = way.tags ?? {};
    const oneway = onewayOf(tags);
    const speed = speedOf(tags);
    let used = false;

    for (let i = 0; i < way.nodes.length - 1; i++) {
      const a = way.nodes[i];
      const b = way.nodes[i + 1];
      if (!isInside(a) || !isInside(b)) continue;

      const pa = nodes.get(a);
      const pb = nodes.get(b);
      if (!pa || !pb) continue;

      const length = metres(pa, pb);
      if (length <= 0) continue;

      const ia = nodeIndex(a);
      const ib = nodeIndex(b);
      // A two-way road is two directed edges; `-1` means the tags describe the
      // way in the opposite order from how its nodes are listed.
      if (oneway !== -1) edges.push([ia, ib, length, speed]);
      if (oneway !== 1) edges.push([ib, ia, length, speed]);
      used = true;
    }
    if (!used) clippedWays++;
  }

  const graph = {
    // Coordinates are rounded to ~1 m. Full float precision more than doubles
    // the file for detail no snap or corridor can act on.
    nodes: coords.map(([lng, lat]) => [round6(lng), round6(lat)]),
    edges,
  };

  const json = JSON.stringify(graph);
  await writeFile(resolve(outDir, "south-roads.graph.json"), json);

  await writeFile(
    resolve(outDir, "south-roads.meta.json"),
    JSON.stringify(
      {
        layer: "south-roads",
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
        geometry: "routing graph (node array + directed edge tuples)",
        highway_classes: HIGHWAY_CLASSES,
        node_count: graph.nodes.length,
        directed_edge_count: edges.length,
        ways_returned: ways.length,
        ways_fully_outside: clippedWays,
        clipped_against: "public/data/south-districts.geojson",
        notes:
          "โครงข่ายถนนสายหลัก (motorway–tertiary) เท่านั้น ไม่รวมถนนในหมู่บ้าน/ซอย " +
          "ใช้สำหรับคำนวณเส้นทางระหว่างเหตุการณ์ ไม่ใช่การนำทางแบบเลี้ยวต่อเลี้ยว " +
          "การเผยแพร่ซ้ำต้องให้เครดิต OpenStreetMap ตามเงื่อนไข ODbL",
      },
      null,
      2,
    ),
  );

  const mb = (Buffer.byteLength(json) / 1024 / 1024).toFixed(1);
  console.log(
    `  south-roads.graph.json  ${graph.nodes.length} nodes, ${edges.length} directed edges  ${mb}MB`,
  );
}

/** Metres per degree of latitude; longitude scales by cos(lat). Mirrors `geography.distanceMetres`. */
const M_PER_DEG_LAT = 111_320;

function metres(a: [number, number], b: [number, number]): number {
  const meanLat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const dx = (a[0] - b[0]) * M_PER_DEG_LAT * Math.cos(meanLat);
  const dy = (a[1] - b[1]) * M_PER_DEG_LAT;
  return Math.hypot(dx, dy);
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
