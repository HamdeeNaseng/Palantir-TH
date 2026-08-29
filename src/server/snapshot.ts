import { createHash } from "node:crypto";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { PROVINCES } from "@/lib/geo";
import { districtsOfProvince } from "@/lib/geography";
import { SNAPSHOT_SCHEMA, type Snapshot } from "@/lib/snapshot";
import { loadBundle, type RawBundle } from "./shared-events";

/**
 * Builds the one payload the browser caches, and keeps it warm.
 *
 * Every page render used to call `loadBundle()` — a full scan of all 10,171
 * `event_candidates` documents — and every filter click was a page render. The
 * browser now holds the dataset and filters it locally (see `@/lib/snapshot`),
 * which leaves two jobs on this side: project the documents down to what the
 * view models read, and hand the same projection to both the server render and
 * `/api/snapshot`.
 *
 * The projection is not cosmetic. Raw documents serialise to 10.11 MB, most of
 * it the `attributes` bag of upstream dataset columns that nothing on either
 * page reads; projected it is 5.14 MB, 372 KB gzipped over the wire.
 */

/**
 * How long a built snapshot is reused before MongoDB is read again.
 *
 * Deliberately shorter than the browser's five-minute refresh, so a client
 * polling on schedule can never be served something older than roughly six
 * minutes: at worst it arrives just as a cached build turns stale. Without
 * this, n open tabs would each trigger their own full collection scan every
 * five minutes, which is the load the client-side cache exists to remove.
 */
export const SNAPSHOT_TTL_MS = 60_000;

interface CachedSnapshot {
  snapshot: Snapshot;
  /** Serialised once, so the route handler never re-stringifies 5 MB per request. */
  json: string;
  /**
   * Compressed once per build, for the same reason.
   *
   * Next does not compress this route's response — measured with `next start`,
   * an `Accept-Encoding: gzip` request came back as 5,395,891 identity bytes —
   * and a deployment that happens to compress at the edge is not something the
   * app should depend on to be usable. Doing it here makes the payload 372 KB
   * (gzip) or 251 KB (brotli) everywhere, at a cost paid once a minute rather
   * than once a request.
   */
  gzip: Uint8Array<ArrayBuffer>;
  brotli: Uint8Array<ArrayBuffer>;
  etag: string;
  /**
   * When MongoDB was last *read* — the TTL clock. Distinct from
   * `snapshot.builtAtMs`, which is when the data now being served was read:
   * a re-read that finds nothing changed advances this and leaves that alone,
   * because the dataset really is the one from the earlier read.
   */
  checkedAtMs: number;
}

let cached: CachedSnapshot | null = null;
/**
 * In-flight build, shared by concurrent callers. Without it, the first request
 * after expiry and everything arriving while it runs each start their own scan
 * — precisely the stampede the TTL is meant to prevent.
 */
let inFlight: Promise<CachedSnapshot> | null = null;

/** How many อำเภอ each จังหวัด has, read from the DDPM boundary files on disk. */
function districtsByProvince(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of PROVINCES) out[p.code] = districtsOfProvince(p.ddpmCode).length;
  return out;
}

/** The document layers, projected to the fields any view model actually reads. */
export function toSnapshot(bundle: RawBundle, builtAtMs: number): Omit<Snapshot, "version"> {
  return {
    schema: SNAPSHOT_SCHEMA,
    builtAtMs,
    live: bundle.live,
    // Sorted once here rather than in every consumer: the client-side replay
    // binary-searches this array, and `buildEventsWorkspace` takes the span
    // from its ends.
    events: [...bundle.events]
      .sort((a, b) => a.time.start.getTime() - b.time.start.getTime() || a._id.localeCompare(b._id))
      .map((e) => ({
        id: e._id,
        ts: e.time.start.getTime(),
        type: e.event.type,
        title: e.event.title,
        provinceCode: e.location.provinceCode,
        province: e.location.province,
        district: e.location.district,
        subdistrict: e.location.subdistrict ?? null,
        lng: e.location.geo?.coordinates[0] ?? null,
        lat: e.location.geo?.coordinates[1] ?? null,
        precision: e.location.geo_precision ?? null,
        severity: e.severity,
        confidence: e.confidence,
        verification: e.verification,
        killed: e.casualties.killed,
        injured: e.casualties.injured,
        sources: e.corroborating_sources,
        // Only the counts are ever read (the network panel's totals, the map
        // popup's badges), so the arrays themselves stay on the server.
        mediaCount: e.media?.length ?? 0,
        actorsCount: e.actors?.length ?? 0,
        targetsCount: e.targets?.length ?? 0,
      })),
    sources: bundle.sources.map((s) => ({
      id: s._id,
      shortName: s.shortName,
      trustClass: s.trust.class,
      trustScore: s.trust.score,
    })),
    citizenReports: bundle.citizenReports.map((r) => ({
      id: r._id,
      ts: r.reported_at.getTime(),
      channel: r.channel,
      provinceCode: r.provinceCode,
      district: r.district,
      topic: r.topic,
      becameFact: r.became_fact,
    })),
    cases: bundle.cases.map((c) => ({
      id: c._id,
      code: c.code,
      title: c.title,
      status: c.status,
      occurredAtMs: c.occurred_at.getTime(),
      location: c.location,
      eventType: c.event_type,
      severity: c.severity,
      riskScore: c.risk_score,
      summary: c.summary,
      entities: c.entities,
      updates: c.updates.map((u) => ({ atMs: u.at.getTime(), text: u.text, tag: u.tag })),
    })),
    districtsByProvince: districtsByProvince(),
  };
}

async function build(previous: CachedSnapshot | null): Promise<CachedSnapshot> {
  const checkedAtMs = Date.now();
  const bundle = await loadBundle();
  const body = toSnapshot(bundle, checkedAtMs);

  // The version is a hash of the content, not a timestamp or a document count:
  // an edit that leaves the count unchanged still has to invalidate the
  // browser's copy, and a rebuild that changed nothing must not. `builtAtMs` is
  // held out of the hash for exactly that reason — it moves on every build by
  // definition, and hashing it would make every TTL expiry look like new data
  // and push 372 KB to every open tab for nothing.
  const { builtAtMs: _when, ...hashable } = body;
  const etag = createHash("sha1").update(JSON.stringify(hashable)).digest("hex").slice(0, 16);

  // Nothing changed since the last read, which is the ordinary case: events
  // arrive on ingestion runs, not once a minute. Re-serialising and
  // re-compressing a payload identical to the one already in hand costs ~125 ms
  // of CPU and ~10 MB of transient allocation for a byte-for-byte match, so
  // keep what we have and only advance the TTL clock.
  if (previous && previous.etag === etag) return { ...previous, checkedAtMs };

  const snapshot: Snapshot = { ...body, version: etag };
  const json = JSON.stringify(snapshot);
  const raw = Buffer.from(json, "utf8");

  // A `Buffer` is a `Uint8Array` at runtime, but `BodyInit` wants one backed by
  // a plain `ArrayBuffer` rather than Node's `ArrayBufferLike`. A view over the
  // same memory is the honest conversion, and copies nothing.
  const body_ = (b: Buffer): Uint8Array<ArrayBuffer> =>
    new Uint8Array(b.buffer as ArrayBuffer, b.byteOffset, b.byteLength);

  return {
    snapshot,
    json,
    gzip: body_(gzipSync(raw, { level: 6 })),
    // Quality 4 rather than the default 11: 263 KB in 51 ms against 5 MB,
    // where 11 would spend seconds of a request's latency to save a few more
    // kilobytes nobody is waiting on.
    brotli: body_(
      brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } }),
    ),
    etag,
    checkedAtMs,
  };
}

/**
 * The current snapshot, rebuilt at most once per `SNAPSHOT_TTL_MS`.
 *
 * A failed build is not cached: `loadBundle` already turns an unreachable
 * MongoDB into an honest empty bundle with `live: false`, and anything that
 * throws past it should be retried on the next request rather than pinned for
 * a minute.
 */
export async function getCachedSnapshot(): Promise<CachedSnapshot> {
  if (cached && Date.now() - cached.checkedAtMs < SNAPSHOT_TTL_MS) return cached;
  if (inFlight) return inFlight;

  inFlight = build(cached)
    .then((next) => {
      // Never pin an outage for a whole TTL. `loadBundle` turns an unreachable
      // MongoDB into an empty bundle with `live: false`; serving that is right,
      // but remembering it for a minute means the recovery is a minute late.
      if (next.snapshot.live) cached = next;
      return next;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/** The snapshot itself — what server components render their first paint from. */
export async function getSnapshot(): Promise<Snapshot> {
  return (await getCachedSnapshot()).snapshot;
}
