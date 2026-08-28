/**
 * Pure statistics and time-bucketing helpers, shared by every page that needs
 * to say "this is more than expected" or "bucket this timestamp".
 *
 * Isomorphic on purpose — no `node:fs`, no `mongodb` import — so the same
 * functions run server-side (investigate.ts, events.ts) and client-side
 * (events-replay.ts, driving the playhead without a round trip per tick).
 *
 * Extracted from `src/server/investigate.ts`, which used to keep these
 * private and reach for a module-level mutable `NOW` instead of taking the
 * current instant as a parameter — harmless for a single page, but a second
 * consumer of the same math is exactly what turns "mutable module global"
 * into "two in-flight requests stepping on each other's clock". Every
 * function here takes `now`/`endMs` explicitly instead.
 */

const DAY_MS = 86400000;

/** P(X >= k) for X ~ Poisson(lambda). Used to separate signal from noise. */
export function poissonUpperTail(k: number, lambda: number): number {
  if (lambda <= 0) return k > 0 ? 0 : 1;
  let cumulative = 0;
  let term = Math.exp(-lambda);
  for (let i = 0; i < k; i++) {
    cumulative += term;
    term *= lambda / (i + 1);
  }
  return Math.max(0, Math.min(1, 1 - cumulative));
}

/** Bucket a set of timestamps into `days` daily counts ending at `endMs`. */
export function dailyCounts(timestampsMs: number[], days: number, endMs: number): number[] {
  const out = new Array(days).fill(0);
  for (const t of timestampsMs) {
    const idx = days - 1 - Math.floor((endMs - t) / DAY_MS);
    if (idx >= 0 && idx < days) out[idx] += 1;
  }
  return out;
}

export function rollingMean(xs: number[], window: number): number[] {
  return xs.map((_, i) => {
    const slice = xs.slice(Math.max(0, i - window + 1), i + 1);
    return slice.reduce((s, n) => s + n, 0) / slice.length;
  });
}

// ------------------------------------------------------------------ hotspots

export interface HotspotItem {
  /** What's being counted — a district label, a case id, anything comparable. */
  key: string;
  atMs: number;
}

export interface HotspotRow {
  rank: number;
  label: string;
  /** Signed percent above the expected count. */
  delta: number;
  /** Raw Poisson upper-tail p-value — lower is more significant. */
  p: number;
  /**
   * Benjamini-Hochberg adjusted p-value (q-value) across every key tested in
   * the same scan. This, not `p`, is what `alpha` is compared against — see
   * `detectHotspots`.
   */
  q: number;
}

export interface HotspotResult {
  hotspots: HotspotRow[];
  significantCount: number;
}

export interface HotspotOptions {
  recentDays?: number;
  baselineDays?: number;
  /** Ignore keys too sparse for the Poisson comparison to say anything. */
  minBaseline?: number;
  /** Target false-discovery rate, applied to the BH-adjusted q-values. */
  alpha?: number;
  /** How many rows `hotspots` keeps, sorted most-significant first. */
  limit?: number;
}

const DEFAULT_HOTSPOT_OPTIONS: Required<HotspotOptions> = {
  recentDays: 7,
  baselineDays: 23,
  minBaseline: 10,
  alpha: 0.05,
  limit: 3,
};

/**
 * Benjamini-Hochberg adjusted p-values, returned in the input order.
 *
 * `q[i] <= alpha` is exactly the BH rejection rule at false-discovery rate
 * `alpha`, so callers never have to find the step-up cutoff themselves. The
 * step-up is a single pass from the largest p-value down, carrying the running
 * minimum of `m * p / rank` so the result stays monotone in `p`.
 */
export function benjaminiHochberg(ps: number[]): number[] {
  const m = ps.length;
  if (m === 0) return [];
  const order = ps.map((p, i) => i).sort((a, b) => ps[a] - ps[b]);
  const q = new Array<number>(m);
  let running = 1;
  for (let rank = m; rank >= 1; rank--) {
    const idx = order[rank - 1];
    running = Math.min(running, (ps[idx] * m) / rank);
    q[idx] = Math.max(0, Math.min(1, running));
  }
  return q;
}

/**
 * Find keys reporting materially more than expected recently.
 *
 * The expectation is conditioned on the *overall* change across all keys over
 * the same period, not on each key's own past — so a global surge (a news
 * cycle, a campaign, a nationwide alert) doesn't get read as every key
 * individually spiking. Holding each key's share of the baseline volume
 * constant and projecting it onto the recent total removes that common-mode
 * movement, leaving only genuinely localised excess.
 *
 * Significance is a Poisson upper-tail test, so a key with a small baseline
 * cannot top the list on a couple of extra events.
 *
 * That test is then run once per key, and a raw `p < alpha` threshold on a
 * scan of hundreds of districts would manufacture roughly `alpha * m` hotspots
 * out of pure noise — at 900 districts and alpha 0.05, ~45 confident-looking
 * false alarms every render. So the p-values are corrected with
 * Benjamini-Hochberg and `alpha` is read as a false-discovery rate over the
 * whole scan: of the keys reported, at most `alpha` of them are expected to be
 * noise, however many keys were tested.
 */
export function detectHotspots(
  items: HotspotItem[],
  endMs: number,
  opts: HotspotOptions = {},
): HotspotResult {
  const { recentDays, baselineDays, ...rest } = { ...DEFAULT_HOTSPOT_OPTIONS, ...opts };

  const counts: HotspotCounts = new Map();
  for (const item of items) {
    tallyHotspot(counts, item.key, endMs - item.atMs, recentDays, baselineDays);
  }
  return detectHotspotsFromCounts(counts, rest);
}

/** How many observations a key has in each window. */
export type HotspotCounts = Map<string, { recent: number; before: number }>;

/**
 * Adds one observation to `counts`, in whichever window its age falls.
 *
 * The recent/baseline boundary arithmetic lives here and nowhere else, so a
 * caller that already has its data grouped can accumulate straight into a
 * `HotspotCounts` and skip building an intermediate `HotspotItem[]` — which is
 * what `districtClusters` does on `/events`, once per playhead tick over every
 * event played so far. A key outside both windows is still recorded (with no
 * increment) exactly as it was when this loop lived inline: it changes no
 * result, since `minBaseline` filters it out either way, but it keeps the two
 * paths identical rather than nearly so.
 */
export function tallyHotspot(
  counts: HotspotCounts,
  key: string,
  ageMs: number,
  recentDays: number,
  baselineDays: number,
): void {
  const s = counts.get(key) ?? { recent: 0, before: 0 };
  if (ageMs <= recentDays * DAY_MS) s.recent += 1;
  else if (ageMs <= (recentDays + baselineDays) * DAY_MS) s.before += 1;
  counts.set(key, s);
}

/**
 * The statistics half of `detectHotspots`, over counts that are already
 * grouped. Takes no `recentDays`/`baselineDays`: by this point the windows
 * have done their job and every number here is a plain count.
 */
export function detectHotspotsFromCounts(
  counts: HotspotCounts,
  opts: Pick<HotspotOptions, "minBaseline" | "alpha" | "limit"> = {},
): HotspotResult {
  const { minBaseline, alpha, limit } = { ...DEFAULT_HOTSPOT_OPTIONS, ...opts };

  const rows = [...counts.entries()];
  const totalRecent = rows.reduce((sum, [, s]) => sum + s.recent, 0);
  const totalBefore = rows.reduce((sum, [, s]) => sum + s.before, 0);
  if (!totalRecent || !totalBefore) return { hotspots: [], significantCount: 0 };

  // Every key that cleared `minBaseline` is one hypothesis tested, including
  // the quiet ones: the correction is only honest if `m` counts the whole
  // scan, not just the keys that happened to come out above expectation.
  const tested = rows
    .filter(([, s]) => s.before >= minBaseline)
    .map(([label, s]) => {
      const expected = (s.before / totalBefore) * totalRecent;
      return {
        label,
        expected,
        observed: s.recent,
        delta: Math.round((s.recent / expected - 1) * 100),
        p: poissonUpperTail(s.recent, expected),
      };
    });

  const qs = benjaminiHochberg(tested.map((r) => r.p));
  const significant = tested
    .map((r, i) => ({ ...r, q: qs[i] }))
    .filter((r) => r.observed > r.expected && r.q <= alpha)
    .sort((a, b) => a.p - b.p);

  return {
    // Only surface keys that clear the significance bar — an empty list is
    // the correct answer when nothing is genuinely anomalous.
    hotspots: significant.slice(0, limit).map((r, i) => ({
      rank: i + 1,
      label: r.label,
      delta: r.delta,
      p: r.p,
      q: r.q,
    })),
    significantCount: significant.length,
  };
}

// ------------------------------------------------------------------ bucketing

export type BucketUnit = "day" | "month" | "year";

export const THAI_MONTH_ABBR = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];

export function thaiShortDate(d: Date): string {
  return `${d.getDate()} ${THAI_MONTH_ABBR[d.getMonth()]}`;
}

/**
 * Which bucket size keeps a trend chart readable at this span.
 *
 * A fixed daily series is useless once the range spans years: at "ทั้งหมด"
 * over two decades it would crush everything into the last few pixels. Short
 * ranges stay daily; longer ones roll up to months or years so the shape of a
 * multi-year span is actually visible.
 */
export function chooseBucketUnit(spanDays: number): BucketUnit {
  return spanDays <= 120 ? "day" : spanDays <= 365 * 3 ? "month" : "year";
}

/** Bucket key for `d` at this unit — dates in the same bucket share a key. */
export function bucketKey(d: Date, unit: BucketUnit): string {
  return unit === "day"
    ? `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`
    : unit === "month"
      ? `${d.getUTCFullYear()}-${d.getUTCMonth()}`
      : `${d.getUTCFullYear()}`;
}

export interface Bucket {
  key: string;
  label: string;
  startMs: number;
  /** Exclusive — the instant the next bucket begins. */
  endMs: number;
}

/** Thai label for the bucket starting at `cursor`, per `unit`. */
function bucketLabelFor(cursor: Date, unit: BucketUnit): string {
  if (unit === "day") return thaiShortDate(cursor);
  if (unit === "month") {
    return `${THAI_MONTH_ABBR[cursor.getUTCMonth()]} ${String(cursor.getUTCFullYear() + 543).slice(-2)}`;
  }
  return String(cursor.getUTCFullYear() + 543);
}

function advance(cursor: Date, unit: BucketUnit): void {
  if (unit === "day") cursor.setUTCDate(cursor.getUTCDate() + 1);
  else if (unit === "month") cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  else cursor.setUTCFullYear(cursor.getUTCFullYear() + 1);
}

/**
 * The ordered bucket list from `startMs` to `endMs`, so empty periods still
 * appear rather than silently vanishing from the axis. Capped at `maxBuckets`
 * as a backstop against a pathological span, not a limit expected to bind in
 * practice (400 daily buckets is already ~13 months, well past where
 * `chooseBucketUnit` would have rolled up to months).
 */
export function bucketList(
  startMs: number,
  endMs: number,
  unit: BucketUnit,
  maxBuckets = 400,
): Bucket[] {
  const buckets: Bucket[] = [];
  const cursor = new Date(startMs);
  if (unit === "day") cursor.setUTCHours(0, 0, 0, 0);
  else if (unit === "month") cursor.setUTCDate(1), cursor.setUTCHours(0, 0, 0, 0);
  else cursor.setUTCMonth(0, 1), cursor.setUTCHours(0, 0, 0, 0);

  while (cursor.getTime() <= endMs && buckets.length < maxBuckets) {
    const startOfBucket = cursor.getTime();
    const label = bucketLabelFor(cursor, unit);
    advance(cursor, unit);
    buckets.push({
      key: bucketKey(new Date(startOfBucket), unit),
      label,
      startMs: startOfBucket,
      endMs: cursor.getTime(),
    });
  }
  return buckets;
}

/**
 * Which bucket `ms` falls in, or -1 when it falls outside them all.
 *
 * The alternative — `index.get(bucketKey(new Date(ms), unit))` — allocates a
 * `Date` and a key string per lookup, and the callers here do one lookup per
 * event: the trend chart, three KPI sparklines and the `/events` histogram all
 * walk the full matched set. A binary search over contiguous buckets is five
 * comparisons and no allocation, and answers the same question, because
 * `bucketList` emits buckets that tile `[startMs, endMs)` in order and
 * `bucketKey` is constant within each one.
 */
export function bucketIndexOf(buckets: Bucket[], ms: number): number {
  let lo = 0;
  let hi = buckets.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ms < buckets[mid].startMs) hi = mid - 1;
    else if (ms >= buckets[mid].endMs) lo = mid + 1;
    else return mid;
  }
  return -1;
}

export const BUCKET_LABEL: Record<BucketUnit, string> = {
  day: "รายวัน",
  month: "รายเดือน",
  year: "รายปี",
};
