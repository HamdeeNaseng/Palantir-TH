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
  /** Poisson upper-tail p-value — lower is more significant. */
  p: number;
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
 */
export function detectHotspots(
  items: HotspotItem[],
  endMs: number,
  opts: HotspotOptions = {},
): HotspotResult {
  const { recentDays, baselineDays, minBaseline, alpha, limit } = {
    ...DEFAULT_HOTSPOT_OPTIONS,
    ...opts,
  };

  const stats = new Map<string, { recent: number; before: number }>();
  for (const item of items) {
    const s = stats.get(item.key) ?? { recent: 0, before: 0 };
    if (endMs - item.atMs <= recentDays * DAY_MS) s.recent += 1;
    else if (endMs - item.atMs <= (recentDays + baselineDays) * DAY_MS) s.before += 1;
    stats.set(item.key, s);
  }

  const rows = [...stats.entries()];
  const totalRecent = rows.reduce((sum, [, s]) => sum + s.recent, 0);
  const totalBefore = rows.reduce((sum, [, s]) => sum + s.before, 0);
  if (!totalRecent || !totalBefore) return { hotspots: [], significantCount: 0 };

  const scored = rows
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
    })
    .filter((r) => r.observed > r.expected)
    .sort((a, b) => a.p - b.p);

  const significant = scored.filter((r) => r.p < alpha);

  return {
    // Only surface keys that clear the significance bar — an empty list is
    // the correct answer when nothing is genuinely anomalous.
    hotspots: significant.slice(0, limit).map((r, i) => ({
      rank: i + 1,
      label: r.label,
      delta: r.delta,
      p: r.p,
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

export const BUCKET_LABEL: Record<BucketUnit, string> = {
  day: "รายวัน",
  month: "รายเดือน",
  year: "รายปี",
};
