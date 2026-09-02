import { brotliCompressSync, brotliDecompressSync, constants } from "node:zlib";
import { Binary } from "mongodb";
import { COLLECTIONS, getDb } from "@/lib/mongodb";
import type { RawBundle } from "./shared-events";

/**
 * The read-side bundle, precomputed into one compressed document.
 *
 * `loadBundle()` used to scan `event_candidates` on every cold render. Against
 * this Atlas M0 that is not survivable: throughput measures ~94 KB/s — the
 * same for `raw_records`, unchanged by `batchSize`, unchanged when warm, so it
 * is a tier-level cap and not a query, an index or a driver setting. The
 * projected bundle is 6.24 MB, which needs 68 s at that rate, and
 * `socketTimeoutMS` is 45 s. Every read therefore failed, `loadBundle` caught
 * the timeout, and the pages showed their "MongoDB unavailable" banner while
 * MongoDB was in fact answering `/api/facilities` in 280 ms.
 *
 * Compression is what closes the gap, because the payload is enormously
 * repetitive — the same province names, event types and source ids across
 * 10,300 documents. Brotli at quality 4 takes it to ~323 KB, a 13x margin
 * against the timeout instead of a 1.5x deficit.
 *
 * The trade is freshness for reachability: the bundle is only as current as
 * the last `npm run snapshot:build`. That is the right trade for a corpus
 * that changes on ingestion runs rather than continuously, and `builtAtMs`
 * below keeps the staleness measurable rather than hidden.
 */

/**
 * Bumped whenever the projected document shape changes. A blob written by an
 * older build is ignored rather than parsed into code expecting a field it
 * does not carry — the cache is an optimisation, never a migration problem.
 */
export const BUNDLE_CACHE_SCHEMA = 1;

/** The cache holds exactly one document; this is its `_id`. */
const CACHE_ID = "bundle";

/** What `toSnapshot`, `matchedEvents` and `toEventFeature` read, and nothing else. */
type CachedBundle = Omit<RawBundle, "live">;

interface BundleCacheDoc {
  _id: string;
  schema: number;
  /** When the scan that produced this blob ran. */
  builtAtMs: number;
  /** Per-layer document counts, so a bad build is visible without decompressing. */
  counts: Record<string, number>;
  /** Brotli-compressed JSON of `CachedBundle`. */
  blob: Binary;
}

/**
 * JSON has no date type, so every `Date` in the bundle crosses as an ISO
 * string and has to be turned back before it reaches a consumer.
 *
 * This is not cosmetic. `inRange()` in `./shared-events` calls `.getTime()` on
 * `time.start` directly, so a revived string would not merely read oddly, it
 * would throw on the first filtered render. `msOrNull` tolerates both, but the
 * point of the cache is that nothing downstream can tell where the bundle came
 * from, so the shape is restored exactly rather than relying on every consumer
 * being tolerant.
 */
const asDate = (value: unknown): Date => (value instanceof Date ? value : new Date(String(value)));

function revive(bundle: CachedBundle): CachedBundle {
  for (const e of bundle.events) if (e.time) e.time.start = asDate(e.time.start);
  for (const r of bundle.citizenReports) r.reported_at = asDate(r.reported_at);
  for (const run of bundle.ingestionRuns) {
    run.started_at = asDate(run.started_at);
    // Null is meaningful here — the run has not finished — so it survives.
    run.finished_at = run.finished_at === null ? null : asDate(run.finished_at);
  }
  for (const c of bundle.cases) {
    c.occurred_at = asDate(c.occurred_at);
    for (const u of c.updates) u.at = asDate(u.at);
  }
  return bundle;
}

export interface CachedBundleResult {
  bundle: RawBundle;
  /** When the underlying scan ran, for reporting staleness to the caller. */
  builtAtMs: number;
}

/**
 * The precomputed bundle, or null when there is nothing usable to serve.
 *
 * Null rather than throwing: a fresh clone, a database that has never had
 * `snapshot:build` run against it, and a blob left by an older schema are all
 * ordinary states, and the caller's answer to each is the same — fall back to
 * reading the collections directly.
 */
export async function readCachedBundle(): Promise<CachedBundleResult | null> {
  const db = await getDb();
  const doc = await db
    .collection<BundleCacheDoc>(COLLECTIONS.snapshotCache)
    .findOne({ _id: CACHE_ID });

  if (!doc) return null;
  if (doc.schema !== BUNDLE_CACHE_SCHEMA) {
    console.warn(
      `[bundle-cache] ignoring blob written for schema ${doc.schema}; ` +
        `this build reads schema ${BUNDLE_CACHE_SCHEMA}. Re-run npm run snapshot:build.`,
    );
    return null;
  }

  const json = brotliDecompressSync(doc.blob.buffer).toString("utf8");
  const bundle = revive(JSON.parse(json) as CachedBundle);

  return {
    // `live` is derived, never stored: it means "this came from a database
    // that has sources in it", which is exactly as true of the cached copy.
    bundle: { ...bundle, live: bundle.sources.length > 0 },
    builtAtMs: doc.builtAtMs,
  };
}

/**
 * Replaces the cached bundle. Only `scripts/build-snapshot-cache.ts` calls it.
 *
 * A single `replaceOne` upsert rather than delete-then-insert, so a reader
 * arriving mid-write sees either the previous blob or the new one and never
 * an empty collection.
 */
export async function writeCachedBundle(
  bundle: CachedBundle,
  builtAtMs: number,
): Promise<{ bytes: number; counts: Record<string, number> }> {
  const raw = Buffer.from(JSON.stringify(bundle), "utf8");
  // Quality 4, matching `snapshot.ts`: within a few percent of maximum on text
  // this repetitive, for a fraction of the CPU that quality 11 would spend.
  const blob = brotliCompressSync(raw, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 4 },
  });

  const counts = {
    events: bundle.events.length,
    sources: bundle.sources.length,
    citizenReports: bundle.citizenReports.length,
    ingestionRuns: bundle.ingestionRuns.length,
    cases: bundle.cases.length,
  };

  const db = await getDb();
  await db.collection<BundleCacheDoc>(COLLECTIONS.snapshotCache).replaceOne(
    { _id: CACHE_ID },
    {
      // `_id` is the filter's business; a replacement carrying it is rejected
      // by the driver's types, and the upsert derives it from the filter.
      schema: BUNDLE_CACHE_SCHEMA,
      builtAtMs,
      counts,
      blob: new Binary(blob),
    },
    { upsert: true },
  );

  return { bytes: blob.length, counts };
}
