import { AnyBulkWriteOperation, Db, Document, MongoClient } from "mongodb";

import { createHash } from "node:crypto";
import dns from "node:dns";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";

// Same workaround as scripts/sync-mongo.ts: Node v24 on Windows can fail an
// SRV lookup with ECONNREFUSED even when Windows DNS resolves the host.
dns.setServers(["1.1.1.1", "8.8.8.8"]);

/**
 * Push the reference geography in `public/data` into MongoDB.
 *
 *   npm run mongo:push:geodata            # -> the deployment in .env.local
 *   tsx scripts/push-geodata.ts --dry-run
 *
 * The files stay the authority. `src/lib/geography.ts` and
 * `src/server/flow/road-graph.ts` read them off disk and are untouched by this
 * script; what lands in Mongo is a copy, so the push can be re-run after any
 * `npm run gis:*` fetch and the database catches up.
 *
 * What it writes:
 *
 *   geo_layers      one doc per layer — the whole `*.meta.json` (provenance,
 *                   licence, source query, counts) beside the SHA-256 of the
 *                   data file, so a stale copy is identifiable without
 *                   re-reading every feature.
 *   geo_features    one doc per GeoJSON feature, `_id` = "<layer>:<key>",
 *                   with `geometry` at the top level so a 2dsphere index and
 *                   $geoIntersects work against it directly, and `geo_valid`
 *                   recording whether that geometry could be indexed.
 *   geo_road_graph  the routing graph, in chunks. 119k nodes and 215k edges
 *                   do not fit the 16MB document limit as one document, and
 *                   splitting on a fixed stride keeps each chunk ~1MB and the
 *                   reassembly a sort by `part`.
 *
 * `facilities` is deliberately NOT a target. `COLLECTIONS.facilities` holds
 * only what an analyst entered by hand; the OSM-derived facilities in
 * south-facilities.geojson land in `geo_features` like every other layer, so a
 * re-push can never overwrite local knowledge.
 *
 * Flags:
 *   --env <file>      env file naming the target   (default .env.local)
 *   --layer <name>    push one layer only, repeatable
 *   --dry-run         report what would change, write nothing
 *   --allow-remote    required to write anywhere that is not localhost
 *
 * The remote guard is the one that matters: this script only writes, and the
 * production cluster is one `--env .env.production` away.
 */

const ROOT = process.cwd();
const DATA_DIR = path.resolve(ROOT, "public/data");
const BATCH_SIZE = 500;

/** ~1MB per chunk at four numbers per edge, comfortably under the 16MB cap. */
const GRAPH_CHUNK = 20_000;

const COLLECTION_LAYERS = "geo_layers";
const COLLECTION_FEATURES = "geo_features";
const COLLECTION_ROAD_GRAPH = "geo_road_graph";

const ROAD_GRAPH_FILE = "south-roads.graph.json";

const GEO_INDEX = "geo_2dsphere";

/**
 * Ceiling on the exclude-and-retry loop in `buildGeoIndex`. Well above the
 * handful of rings simplification actually breaks, and low enough that a layer
 * that is broken wholesale reports it instead of grinding through every
 * feature one index build at a time.
 */
const MAX_GEO_EXCLUSIONS = 50;

// ---------------------------------------------------------
// Arguments
// ---------------------------------------------------------

function flagValue(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;

  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} needs a value, e.g. ${name} .env.local`);
  }
  return value;
}

function flagValues(name: string): string[] {
  const out: string[] = [];
  process.argv.forEach((arg, index) => {
    if (arg !== name) return;
    const value = process.argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${name} needs a value, e.g. ${name} south-villages`);
    }
    out.push(value);
  });
  return out;
}

const ENV_FILE = flagValue("--env", ".env.local");
const ONLY_LAYERS = flagValues("--layer");
const DRY_RUN = process.argv.includes("--dry-run");
const ALLOW_REMOTE = process.argv.includes("--allow-remote");

// ---------------------------------------------------------
// Target
// ---------------------------------------------------------

function loadEnvFile(filename: string): Record<string, string> {
  const filePath = path.resolve(ROOT, filename);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Environment file not found: ${filePath}`);
  }
  return dotenv.parse(fs.readFileSync(filePath));
}

function isLocalUri(uri: string): boolean {
  return /^mongodb:\/\/(?:[^@]*@)?(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:[/?]|$)/i.test(uri);
}

function redact(uri: string): string {
  return uri.replace(/:\/\/[^@]*@/, "://***@");
}

const targetEnv = loadEnvFile(ENV_FILE);
const TARGET_URI = targetEnv.MONGODB_URI;
const TARGET_DB = targetEnv.MONGODB_DB || targetEnv.MONGO_DATABASE || "palantir_th";

if (!TARGET_URI) {
  throw new Error(`MONGODB_URI is not set in ${ENV_FILE}`);
}

if (!isLocalUri(TARGET_URI) && !ALLOW_REMOTE && !DRY_RUN) {
  throw new Error(
    "Refusing to write to a non-local target without --allow-remote:\n" +
      `  ${ENV_FILE} -> ${redact(TARGET_URI)}`,
  );
}

// ---------------------------------------------------------
// Files
// ---------------------------------------------------------

interface Feature {
  type: "Feature";
  geometry: Document | null;
  properties: Record<string, unknown> | null;
}

interface FeatureCollection {
  type: "FeatureCollection";
  features: Feature[];
}

interface RawGraph {
  nodes: [number, number][];
  edges: number[][];
}

function sha256(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function metaFor(layer: string): Document | null {
  const metaPath = path.join(DATA_DIR, `${layer}.meta.json`);
  return fs.existsSync(metaPath) ? readJson<Document>(metaPath) : null;
}

/**
 * A feature's identity, so a re-push updates a row rather than duplicating it.
 * Every layer already carries a stable code from its source — the DDPM
 * boundary codes, the OSM element id — and keying on the array index instead
 * would make identity depend on the file's ordering.
 */
function featureKey(feature: Feature): string | null {
  const properties = (feature.properties ?? {}) as Record<string, unknown>;
  const candidate =
    properties.subdistrict_code ??
    properties.district_code ??
    properties.province_code ??
    properties.id ??
    properties.osm_id;

  return candidate === undefined || candidate === null ? null : String(candidate);
}

// ---------------------------------------------------------
// Push
// ---------------------------------------------------------

interface LayerReport {
  layer: string;
  features: number;
  upserted: number;
  modified: number;
  removed: number;
}

/** `_id`s are strings here; the driver's generic still expects its own type. */
function id(value: string): Document["_id"] {
  return value as unknown as Document["_id"];
}

/**
 * Build the 2dsphere index over every feature it will accept.
 *
 * The boundary layers are Douglas-Peucker simplified, and simplification can
 * pull a ring across itself — thailand-provinces, at a 0.006 tolerance, is the
 * worst of it. 2dsphere refuses the *whole collection* over one such ring, so
 * a plain createIndex leaves the map with no geospatial index because four
 * provinces in a backdrop layer are a few metres out.
 *
 * Mongo names the offending document in the error, so the fix is to take it at
 * its word: mark that feature `geo_valid: false`, and rebuild against a
 * partial filter that skips it. The excluded features are still stored and
 * still readable by `_id` and by `layer`; only $geo* queries cannot see them,
 * and the caller prints exactly which ones so the loss is never silent.
 *
 * Returns the excluded `_id`s, or null if the build failed for a reason that
 * is not one bad geometry.
 */
async function buildGeoIndex(
  features: ReturnType<Db["collection"]>,
): Promise<string[] | null> {
  const excluded: string[] = [];

  for (let attempt = 0; attempt <= MAX_GEO_EXCLUSIONS; attempt++) {
    try {
      await features.createIndex(
        { geometry: "2dsphere" },
        { name: GEO_INDEX, partialFilterExpression: { geo_valid: true } },
      );
      return excluded;
    } catch (error) {
      const message = (error as Error).message;
      const offender = /_id: "([^"]+)"/.exec(message);

      if (!offender) {
        console.warn(`  ! ${message.split("\n")[0].slice(0, 300)}`);
        return null;
      }

      excluded.push(offender[1]);
      await features.updateOne({ _id: id(offender[1]) }, { $set: { geo_valid: false } });
    }
  }

  console.warn(`  ! more than ${MAX_GEO_EXCLUSIONS} unindexable geometries — check the source data`);
  return null;
}

async function main(): Promise<void> {
  const geojsonLayers = fs
    .readdirSync(DATA_DIR)
    .filter((name) => name.endsWith(".geojson"))
    .map((name) => name.replace(/\.geojson$/, ""))
    .filter((layer) => ONLY_LAYERS.length === 0 || ONLY_LAYERS.includes(layer))
    .sort();

  const pushRoadGraph =
    fs.existsSync(path.join(DATA_DIR, ROAD_GRAPH_FILE)) &&
    (ONLY_LAYERS.length === 0 || ONLY_LAYERS.includes("south-roads"));

  console.log(`Source : ${DATA_DIR}`);
  console.log(`Target : ${redact(TARGET_URI)} db=${TARGET_DB} (${ENV_FILE})`);
  console.log(`Layers : ${geojsonLayers.join(", ")}${pushRoadGraph ? ", south-roads (graph)" : ""}`);
  if (DRY_RUN) console.log("Mode   : DRY RUN — nothing is written");
  console.log("");

  const client = new MongoClient(TARGET_URI, {
    connectTimeoutMS: 15_000,
    serverSelectionTimeoutMS: 15_000,
    socketTimeoutMS: 120_000,
  });

  await client.connect();

  try {
    const db = client.db(TARGET_DB);
    const features = db.collection(COLLECTION_FEATURES);
    const layers = db.collection(COLLECTION_LAYERS);
    const roadGraph = db.collection(COLLECTION_ROAD_GRAPH);

    const pushedAt = new Date();
    const reports: LayerReport[] = [];

    /**
     * Dropped before the load, not just before the rebuild. Every feature is
     * written `geo_valid: true` and the exclusions are discovered afterwards,
     * so leaving last push's 2dsphere index in place makes it reject the write
     * of the very feature it would have excluded — the load fails on a
     * geometry the script is designed to cope with. The collection is without
     * a geospatial index for the length of the push, which is what a bulk load
     * wants anyway.
     */
    if (!DRY_RUN) {
      await features.dropIndex(GEO_INDEX).catch(() => undefined);
    }

    for (const layer of geojsonLayers) {
      const filePath = path.join(DATA_DIR, `${layer}.geojson`);
      const collection = readJson<FeatureCollection>(filePath);

      const seen = new Set<string>();
      const ops: AnyBulkWriteOperation<Document>[] = [];
      let unkeyed = 0;

      collection.features.forEach((feature, index) => {
        const key = featureKey(feature);
        if (key === null) unkeyed += 1;

        // No source code leaves file position as the only identity available.
        let docId = `${layer}:${key ?? `#${index}`}`;

        // Two features under one code — a boundary the source publishes as
        // separate parts. Suffixing keeps both instead of dropping one.
        if (seen.has(docId)) {
          let part = 2;
          while (seen.has(`${docId}/${part}`)) part += 1;
          docId = `${docId}/${part}`;
        }

        seen.add(docId);
        ops.push({
          replaceOne: {
            filter: { _id: id(docId) },
            replacement: {
              layer,
              key: key ?? `#${index}`,
              geometry: feature.geometry,
              /** Optimistic; `buildGeoIndex` demotes what 2dsphere rejects. */
              geo_valid: true,
              properties: feature.properties ?? {},
              pushed_at: pushedAt,
            },
            upsert: true,
          },
        });
      });

      let upserted = 0;
      let modified = 0;
      let removed = 0;

      if (!DRY_RUN) {
        for (let i = 0; i < ops.length; i += BATCH_SIZE) {
          const result = await features.bulkWrite(ops.slice(i, i + BATCH_SIZE), {
            ordered: false,
          });
          upserted += result.upsertedCount;
          modified += result.modifiedCount;
        }

        // A feature dropped from the file — a boundary merged away, an OSM
        // node deleted — has to leave the collection too, or the database
        // keeps answering with a place the source no longer publishes.
        const stale = await features.deleteMany({
          layer,
          _id: { $nin: [...seen].map(id) },
        });
        removed = stale.deletedCount;

        await layers.replaceOne(
          { _id: id(layer) },
          {
            layer,
            kind: "features",
            source_file: `public/data/${layer}.geojson`,
            sha256: sha256(filePath),
            feature_count: collection.features.length,
            meta: metaFor(layer),
            pushed_at: pushedAt,
          },
          { upsert: true },
        );
      }

      if (unkeyed > 0) {
        console.warn(
          `  ! ${layer}: ${unkeyed} feature(s) carry no source code — keyed by file position`,
        );
      }

      reports.push({ layer, features: collection.features.length, upserted, modified, removed });
      console.log(
        `  ${layer.padEnd(22)}${String(collection.features.length).padStart(7)} features` +
          (DRY_RUN ? "" : `  (+${upserted} ~${modified} -${removed})`),
      );
    }

    if (pushRoadGraph) {
      const filePath = path.join(DATA_DIR, ROAD_GRAPH_FILE);
      const graph = readJson<RawGraph>(filePath);

      const chunks: Document[] = [];
      for (const kind of ["nodes", "edges"] as const) {
        const rows: unknown[] = graph[kind];
        for (let offset = 0, part = 0; offset < rows.length; offset += GRAPH_CHUNK, part += 1) {
          chunks.push({
            _id: id(`south-roads:${kind}:${String(part).padStart(4, "0")}`),
            layer: "south-roads",
            kind,
            part,
            data: rows.slice(offset, offset + GRAPH_CHUNK),
            pushed_at: pushedAt,
          });
        }
      }

      if (!DRY_RUN) {
        for (let i = 0; i < chunks.length; i += 10) {
          await roadGraph.bulkWrite(
            chunks.slice(i, i + 10).map((chunk) => ({
              replaceOne: { filter: { _id: chunk._id }, replacement: chunk, upsert: true },
            })),
            { ordered: false },
          );
        }

        // A smaller graph than last time leaves chunks behind that would
        // otherwise be reassembled as real nodes and edges.
        await roadGraph.deleteMany({
          layer: "south-roads",
          _id: { $nin: chunks.map((chunk) => chunk._id) },
        });

        await layers.replaceOne(
          { _id: id("south-roads") },
          {
            layer: "south-roads",
            kind: "road_graph",
            source_file: `public/data/${ROAD_GRAPH_FILE}`,
            sha256: sha256(filePath),
            node_count: graph.nodes.length,
            directed_edge_count: graph.edges.length,
            chunk_size: GRAPH_CHUNK,
            chunk_count: chunks.length,
            meta: metaFor("south-roads"),
            pushed_at: pushedAt,
          },
          { upsert: true },
        );
      }

      console.log(
        `  ${"south-roads (graph)".padEnd(22)}${String(graph.nodes.length).padStart(7)} nodes, ` +
          `${graph.edges.length} edges in ${chunks.length} chunks`,
      );
    }

    if (!DRY_RUN) {
      console.log("\nIndexes");
      await features.createIndex({ layer: 1, key: 1 });
      await features.createIndex({ layer: 1, "properties.province_code": 1 });
      await features.createIndex({ layer: 1, "properties.district_code": 1 });
      await roadGraph.createIndex({ layer: 1, kind: 1, part: 1 });
      console.log("  scalar indexes ok");

      const excluded = await buildGeoIndex(features);
      if (excluded === null) {
        console.warn("  ! 2dsphere index skipped — see the error above");
        console.warn("    geometry is stored and readable; only $geo* queries are unavailable.");
      } else {
        console.log(`  ${GEO_INDEX} ok (${excluded.length} feature(s) excluded)`);
        for (const docId of excluded) console.warn(`    - ${docId}`);
      }
    }

    const total = reports.reduce((sum, report) => sum + report.features, 0);
    console.log(
      `\n${DRY_RUN ? "Would push" : "Pushed"} ${total} features across ${reports.length} layer(s).`,
    );
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(`\npush-geodata failed: ${(error as Error).message}`);
  process.exit(1);
});
