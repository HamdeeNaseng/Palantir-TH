import { COLLECTIONS, getDb } from "@/lib/mongodb";
import { EVENT_TYPE_LABEL, SEVERITY_LABEL } from "@/lib/labels";
import { PROVINCES } from "@/lib/geo";
import { DEFAULT_FILTERS, RANGE_DAYS, type InvestigationFilters } from "@/lib/filters";
import { EVENT_COLOR } from "@/lib/palette";
import { GEO_PRECISION_RADIUS_M } from "@/lib/types";
import type {
  CaseDoc,
  CitizenReportDoc,
  EventCandidateDoc,
  EventType,
  GeoPrecision,
  IngestionRunDoc,
  SourceRegistryDoc,
} from "@/lib/types";

/** Sources at or above this trust score satisfy "เฉพาะแหล่งข้อมูลที่เชื่อถือได้". */
const TRUSTED_SCORE_FLOOR = 70;

/**
 * Drawn for events whose source reports no severity. Deliberately the middle of
 * the scale so an unknown neither shouts nor disappears; `severity_known`
 * carries the truth for anything that needs to tell them apart.
 */
const UNKNOWN_SEVERITY_FALLBACK = 3;
let NOW = new Date();

interface RawBundle {
  sources: SourceRegistryDoc[];
  events: EventCandidateDoc[];
  citizenReports: CitizenReportDoc[];
  ingestionRuns: IngestionRunDoc[];
  cases: CaseDoc[];
  /** False when MongoDB is unavailable. No fixture data is substituted. */
  live: boolean;
}

/**
 * Reads the document layers from MongoDB. An unavailable or unseeded database
 * returns an empty bundle; production must never silently substitute mock data.
 */
async function loadBundle(): Promise<RawBundle> {
  try {
    const db = await getDb();
    const [sources, events, citizenReports, ingestionRuns, cases] = await Promise.all([
      db.collection<SourceRegistryDoc>(COLLECTIONS.sourceRegistry).find({}).toArray(),
      db.collection<EventCandidateDoc>(COLLECTIONS.eventCandidates).find({}).toArray(),
      db.collection<CitizenReportDoc>(COLLECTIONS.citizenReports).find({}).toArray(),
      db.collection<IngestionRunDoc>(COLLECTIONS.ingestionRuns).find({}).toArray(),
      db.collection<CaseDoc>(COLLECTIONS.cases).find({}).toArray(),
    ]);

    return { sources, events, citizenReports, ingestionRuns, cases, live: sources.length > 0 };
  } catch {
    // Database unavailable: preserve an honest empty state.
  }

  return {
    sources: [],
    events: [],
    citizenReports: [],
    ingestionRuns: [],
    cases: [],
    live: false,
  };
}

/**
 * `windowsBack` shifts the window into the past by whole window lengths: 0 is
 * the current period, 1 the immediately preceding one (used for KPI deltas).
 */
function inRange(at: Date, range: InvestigationFilters["range"], windowsBack = 0): boolean {
  const days = RANGE_DAYS[range];
  if (days === null) return windowsBack === 0;
  const age = NOW.getTime() - at.getTime();
  const span = days * 86400000;
  return age > windowsBack * span && age <= (windowsBack + 1) * span;
}

function applyFilters(
  events: EventCandidateDoc[],
  sources: SourceRegistryDoc[],
  f: InvestigationFilters,
  windowsBack = 0,
): EventCandidateDoc[] {
  const trusted = new Set(
    sources.filter((s) => s.trust.score >= TRUSTED_SCORE_FLOOR).map((s) => s._id),
  );

  return events.filter((e) => {
    if (!inRange(e.time.start, f.range, windowsBack)) return false;
    if (f.provinces.length && !f.provinces.includes(e.location.provinceCode)) return false;
    if (f.eventTypes.length && !f.eventTypes.includes(e.event.type)) return false;
    if (f.verification.length && !f.verification.includes(e.verification)) return false;
    if (f.sourceId !== "all" && !e.corroborating_sources.includes(f.sourceId)) return false;
    if (f.trustedOnly && !e.corroborating_sources.some((id) => trusted.has(id))) return false;
    return true;
  });
}

// ---------------------------------------------------------------- view models

export interface KpiCard {
  key: string;
  label: string;
  value: string;
  delta: string;
  deltaTone: "up" | "down" | "flat";
  deltaNote: string;
  spark: number[];
  icon: "target" | "shield" | "book" | "gauge";
  /** Present on the gauge card only. */
  ring?: number;
}

/**
 * One event as a GeoJSON feature for MapLibre. Properties are flat scalars
 * because MapLibre filter/paint expressions can only read primitives.
 */
export interface EventFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: {
    id: string;
    type: EventType;
    severity: number;
    /** false when the source reported nothing implying severity. */
    severity_known: boolean;
    confidence: number;
    /** Epoch ms — drives `["<=", ["get","ts"], t]` timeline replay. */
    ts: number;
    title: string;
    district: string;
    province: string;
    precision: GeoPrecision;
    /** Nominal positional error in metres, for the uncertainty layer. */
    precision_m: number;
    color: string;
  };
}

export interface EventFeatureCollection {
  type: "FeatureCollection";
  features: EventFeature[];
}

export interface TrendSeries {
  key: string;
  label: string;
  color: string;
  points: number[];
}

export interface NetworkNode {
  id: string;
  label: string;
  icon: "person" | "group" | "place" | "vehicle" | "phone" | "event";
  count?: number;
  x: number;
  y: number;
  accent: string;
}

export interface SourceReliabilityRow {
  id: string;
  name: string;
  category: string;
  score: number;
}

export interface EventRow {
  id: string;
  at: Date;
  type: string;
  district: string;
  province: string;
  severity: number;
  severityLabel: string;
  source: string;
}

export interface CitizenSignal {
  totalReports: number;
  changePct: number;
  suspiciousClusters: number;
  clusterDelta: number;
  factConversionPct: number;
  factConversionDelta: number;
  daily: number[];
  rollingAvg: number[];
  anomalyIndex: number[];
  dayLabels: string[];
  channels: { key: string; label: string; color: string; pct: number; series: number[] }[];
  topSignals: string[];
  hotspots: { rank: number; label: string; delta: number }[];
}

export interface InvestigationDashboard {
  live: boolean;
  filters: InvestigationFilters;
  kpis: KpiCard[];
  events: EventFeatureCollection;
  trend: { labels: string[]; series: TrendSeries[]; max: number; bucketLabel: string };
  network: { nodes: NetworkNode[]; edges: { from: string; to: string; weight: number }[] };
  sources: SourceReliabilityRow[];
  recentEvents: EventRow[];
  citizen: CitizenSignal;
  activeCase: CaseDoc | null;
  totalMatched: number;
}

// ----------------------------------------------------------------- aggregation

const TREND_GROUPS: { key: string; label: string; color: string; types: EventType[] }[] = [
  { key: "violence", label: "เหตุรุนแรง", color: "#3b82f6", types: ["unrest", "explosion", "shooting", "arson"] },
  { key: "narcotics", label: "ยาเสพติด", color: "#22c55e", types: ["narcotics"] },
  { key: "crime", label: "อาชญากรรม", color: "#f59e0b", types: ["crime"] },
  { key: "gang", label: "กิจกรรมกลุ่ม", color: "#a855f7", types: ["gang", "abduction"] },
  { key: "other", label: "อื่น ๆ", color: "#64748b", types: ["raid", "other"] },
];

const THAI_MONTH_ABBR = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];

function thaiShortDate(d: Date): string {
  return `${d.getDate()} ${THAI_MONTH_ABBR[d.getMonth()]}`;
}

/** Bucket a set of timestamps into `days` daily counts ending at NOW. */
function dailyCounts(dates: Date[], days: number): number[] {
  const out = new Array(days).fill(0);
  const end = NOW.getTime();
  for (const d of dates) {
    const idx = days - 1 - Math.floor((end - d.getTime()) / 86400000);
    if (idx >= 0 && idx < days) out[idx] += 1;
  }
  return out;
}

function rollingMean(xs: number[], window: number): number[] {
  return xs.map((_, i) => {
    const slice = xs.slice(Math.max(0, i - window + 1), i + 1);
    return slice.reduce((s, n) => s + n, 0) / slice.length;
  });
}

/**
 * `matched` is the current window; `previous` is the same filters shifted back
 * by one window length, so every delta is a like-for-like comparison.
 */
function buildKpis(matched: EventCandidateDoc[], previous: EventCandidateDoc[]): KpiCard[] {
  const claims = matched.reduce((s, e) => s + e.corroborating_sources.length, 0);
  const prevClaims = previous.reduce((s, e) => s + e.corroborating_sources.length, 0);

  const isFact = (e: EventCandidateDoc) => e.verification === "verified" && e.confidence >= 85;
  const facts = matched.filter(isFact).length;
  const prevFacts = previous.filter(isFact).length;

  const mean = (xs: EventCandidateDoc[]) =>
    xs.length ? xs.reduce((s, e) => s + e.confidence, 0) / xs.length : 0;
  const confidence = Math.round(mean(matched));
  const confidenceDelta = Math.round(mean(matched) - mean(previous));

  const spark = (xs: EventCandidateDoc[]) => dailyCounts(xs.map((e) => e.time.start), 30);

  /** Signed percent change, clamped so a near-empty baseline can't print +2485%. */
  const delta = (now: number, before: number) => {
    if (before === 0) return now === 0 ? "0%" : "ใหม่";
    const p = Math.round(((now - before) / before) * 100);
    return `${p >= 0 ? "+" : ""}${Math.max(-99, Math.min(999, p))}%`;
  };
  const tone = (now: number, before: number): KpiCard["deltaTone"] =>
    now > before ? "up" : now < before ? "down" : "flat";

  return [
    {
      key: "events",
      label: "เหตุการณ์ทั้งหมด",
      value: matched.length.toLocaleString("en-US"),
      delta: delta(matched.length, previous.length),
      deltaTone: tone(matched.length, previous.length),
      deltaNote: "จากช่วงก่อนหน้า",
      spark: spark(matched),
      icon: "target",
    },
    {
      key: "claims",
      label: "ข้อกล่าวหาที่ยืนยันแล้ว",
      value: claims.toLocaleString("en-US"),
      delta: delta(claims, prevClaims),
      deltaTone: tone(claims, prevClaims),
      deltaNote: "จากช่วงก่อนหน้า",
      spark: spark(matched),
      icon: "shield",
    },
    {
      key: "facts",
      label: "ข้อเท็จจริงที่ยืนยันแล้ว",
      value: facts.toLocaleString("en-US"),
      delta: delta(facts, prevFacts),
      deltaTone: tone(facts, prevFacts),
      deltaNote: "จากช่วงก่อนหน้า",
      spark: spark(matched.filter(isFact)),
      icon: "book",
    },
    {
      key: "confidence",
      label: "ความเชื่อมั่นของแหล่งข้อมูล",
      value: `${confidence}%`,
      delta:
        confidenceDelta === 0
          ? "ทรงตัว"
          : `${confidenceDelta > 0 ? "↑ ดีขึ้น" : "↓ ลดลง"} ${Math.abs(confidenceDelta)}%`,
      deltaTone: confidenceDelta >= 0 ? "up" : "down",
      deltaNote: "",
      spark: [],
      icon: "gauge",
      ring: confidence,
    },
  ];
}

/** P(X >= k) for X ~ Poisson(lambda). Used to separate signal from noise. */
function poissonUpperTail(k: number, lambda: number): number {
  if (lambda <= 0) return k > 0 ? 0 : 1;
  let cumulative = 0;
  let term = Math.exp(-lambda);
  for (let i = 0; i < k; i++) {
    cumulative += term;
    term *= lambda / (i + 1);
  }
  return Math.max(0, Math.min(1, 1 - cumulative));
}

const HOTSPOT_RECENT_DAYS = 7;
const HOTSPOT_BASELINE_DAYS = 23;
/** Ignore districts too sparse for the Poisson comparison to say anything. */
const HOTSPOT_MIN_BASELINE = 10;
const HOTSPOT_ALPHA = 0.05;

/**
 * Find districts reporting materially more than expected.
 *
 * The expectation is conditioned on the *national* change over the same period,
 * not on the district's own past. That distinction matters: when reporting
 * rises everywhere — a news cycle, a campaign, a nationwide alert — every
 * district beats its own baseline, so "above its own baseline" would flag
 * almost everything and mean nothing. Holding each district's share of the
 * baseline volume constant and projecting it onto the recent total removes that
 * common-mode movement, leaving only genuinely localised excess.
 *
 * Significance is a Poisson upper-tail test, so a district with a small
 * baseline cannot top the list on a couple of extra reports.
 *
 * @param reports  Reports inside the analysis window.
 * @param endMs    Instant the window ends at (the "now" of this comparison).
 */
function detectHotspots(reports: CitizenReportDoc[], endMs: number) {
  const stats = new Map<string, { recent: number; before: number }>();
  for (const r of reports) {
    const province = PROVINCES.find((p) => p.code === r.provinceCode)?.name ?? "";
    const key = `อ.${r.district} จ.${province}`;
    const s = stats.get(key) ?? { recent: 0, before: 0 };
    if (endMs - r.reported_at.getTime() <= HOTSPOT_RECENT_DAYS * 86400000) s.recent += 1;
    else s.before += 1;
    stats.set(key, s);
  }

  const rows = [...stats.entries()];
  const totalRecent = rows.reduce((sum, [, s]) => sum + s.recent, 0);
  const totalBefore = rows.reduce((sum, [, s]) => sum + s.before, 0);
  if (!totalRecent || !totalBefore) return { hotspots: [], significantCount: 0 };

  const scored = rows
    .filter(([, s]) => s.before >= HOTSPOT_MIN_BASELINE)
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

  const significant = scored.filter((r) => r.p < HOTSPOT_ALPHA);

  return {
    // Only surface districts that clear the significance bar — an empty list is
    // the correct answer when nothing is genuinely anomalous.
    hotspots: significant.slice(0, 3).map((r, i) => ({
      rank: i + 1,
      label: r.label,
      delta: r.delta,
    })),
    significantCount: significant.length,
  };
}

function buildCitizen(reports: CitizenReportDoc[]): CitizenSignal {
  const window = reports.filter((r) => inRange(r.reported_at, "30d"));
  const daily = dailyCounts(window.map((r) => r.reported_at), 30);
  const rollingAvg = rollingMean(daily, 30);

  const mean = daily.reduce((s, n) => s + n, 0) / daily.length;
  const sd = Math.sqrt(daily.reduce((s, n) => s + (n - mean) ** 2, 0) / daily.length);
  const anomalyIndex = daily.map((n, i) => (n > mean + 1.6 * sd ? i : -1)).filter((i) => i >= 0);

  const dayLabels = Array.from({ length: 30 }, (_, i) =>
    thaiShortDate(new Date(NOW.getTime() - (29 - i) * 86400000)),
  );

  const channelMeta = [
    { key: "citizen", label: "รายงานประชาชน", color: "#3b82f6" },
    { key: "local_news", label: "ข่าวท้องถิ่น", color: "#f59e0b" },
    { key: "social", label: "โซเชียลมีเดีย", color: "#22d3ee" },
    { key: "network", label: "เครือข่ายภาคประชาชน", color: "#a855f7" },
  ] as const;

  const channels = channelMeta.map((c) => {
    const rows = window.filter((r) => r.channel === c.key);
    return {
      key: c.key,
      label: c.label,
      color: c.color,
      pct: window.length ? Math.round((rows.length / window.length) * 100) : 0,
      series: dailyCounts(rows.map((r) => r.reported_at), 30),
    };
  });

  const topicCounts = new Map<string, number>();
  for (const r of window) topicCounts.set(r.topic, (topicCounts.get(r.topic) ?? 0) + 1);
  const topSignals = [...topicCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([t]) => `#${t}`);

  const { hotspots, significantCount } = detectHotspots(window, NOW.getTime());

  // Period over period: this 30-day window against the 30 before it.
  const prior = reports.filter((r) => {
    const age = NOW.getTime() - r.reported_at.getTime();
    return age > 30 * 86400000 && age <= 60 * 86400000;
  });
  const changePct = prior.length
    ? Math.round(((window.length - prior.length) / prior.length) * 100)
    : 0;

  const factRate = (rows: CitizenReportDoc[]) =>
    rows.length ? (rows.filter((r) => r.became_fact).length / rows.length) * 100 : 0;

  return {
    totalReports: window.length,
    changePct,
    // Districts whose recent volume exceeds what the national trend predicts,
    // at p < 0.05 — not merely "more than last week".
    suspiciousClusters: significantCount,
    clusterDelta: significantCount - detectHotspots(prior, NOW.getTime() - 30 * 86400000).significantCount,
    factConversionPct: Math.round(factRate(window)),
    factConversionDelta: Math.round(factRate(window) - factRate(prior)),
    daily,
    rollingAvg,
    anomalyIndex,
    dayLabels,
    channels,
    topSignals,
    hotspots,
  };
}

/**
 * What the events in scope are actually made of.
 *
 * This used to render a fixed set of counts (31 people, 8 groups, …) that were
 * written into the source and shown regardless of the data — including when no
 * case existed at all. Everything here is now counted from the matched events,
 * so an empty result shows zeros rather than a plausible-looking fiction.
 *
 * Person/vehicle/phone entities do not exist in the ingested sources yet, so
 * the graph reports the dimensions that do: where, who reported it, what kind,
 * and what evidence came attached.
 */
/**
 * Trend bucketed to suit the selected range.
 *
 * A fixed 30-day daily series was useless against this data: the ingested
 * record spans 2002 onward, so at "ทั้งหมด" the chart showed a flat line with
 * everything crushed into the last pixel. Short ranges stay daily; longer ones
 * roll up to months or years so the shape of two decades is actually visible.
 */
function buildTrend(events: EventCandidateDoc[], range: InvestigationFilters["range"]) {
  const times = events.map((e) => e.time.start.getTime());
  const days = RANGE_DAYS[range];

  // "ทั้งหมด" spans whatever the data spans, so derive the window from it.
  const endMs = NOW.getTime();
  const startMs =
    days !== null
      ? endMs - days * 86400000
      : times.length
        ? Math.min(...times)
        : endMs - 30 * 86400000;
  const spanDays = Math.max(1, (endMs - startMs) / 86400000);

  const unit: "day" | "month" | "year" =
    spanDays <= 120 ? "day" : spanDays <= 365 * 3 ? "month" : "year";

  /** Bucket key and its display label, both derived from the same date. */
  const keyOf = (d: Date) =>
    unit === "day"
      ? `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`
      : unit === "month"
        ? `${d.getUTCFullYear()}-${d.getUTCMonth()}`
        : `${d.getUTCFullYear()}`;

  // Build the ordered bucket list first so empty periods still appear.
  const buckets: { key: string; label: string }[] = [];
  const cursor = new Date(startMs);
  if (unit === "day") cursor.setUTCHours(0, 0, 0, 0);
  else if (unit === "month") cursor.setUTCDate(1), cursor.setUTCHours(0, 0, 0, 0);
  else cursor.setUTCMonth(0, 1), cursor.setUTCHours(0, 0, 0, 0);

  while (cursor.getTime() <= endMs && buckets.length < 400) {
    buckets.push({
      key: keyOf(cursor),
      label:
        unit === "day"
          ? thaiShortDate(cursor)
          : unit === "month"
            ? `${THAI_MONTH_ABBR[cursor.getUTCMonth()]} ${String(cursor.getUTCFullYear() + 543).slice(-2)}`
            : String(cursor.getUTCFullYear() + 543),
      });
    if (unit === "day") cursor.setUTCDate(cursor.getUTCDate() + 1);
    else if (unit === "month") cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    else cursor.setUTCFullYear(cursor.getUTCFullYear() + 1);
  }

  const index = new Map(buckets.map((b, i) => [b.key, i]));

  const series: TrendSeries[] = TREND_GROUPS.map((g) => {
    const points = new Array(buckets.length).fill(0);
    for (const e of events) {
      if (!g.types.includes(e.event.type)) continue;
      const i = index.get(keyOf(e.time.start));
      if (i !== undefined) points[i] += 1;
    }
    return { key: g.key, label: g.label, color: g.color, points };
  });

  const max = Math.max(
    10,
    ...buckets.map((_, i) => series.reduce((sum, g) => sum + g.points[i], 0)),
  );

  return {
    labels: buckets.map((b) => b.label),
    series,
    max,
    bucketLabel: unit === "day" ? "รายวัน" : unit === "month" ? "รายเดือน" : "รายปี",
  };
}

function buildNetwork(events: EventCandidateDoc[]) {
  const distinct = (values: (string | null | undefined)[]) =>
    new Set(values.filter((value): value is string => Boolean(value))).size;

  const districts = distinct(events.map((e) => `${e.location.province}/${e.location.district}`));
  const subdistricts = distinct(
    events.map((e) => e.location.subdistrict && `${e.location.district}/${e.location.subdistrict}`),
  );
  const sources = distinct(events.flatMap((e) => e.corroborating_sources));
  const types = distinct(events.map((e) => e.event.type));
  const media = events.reduce((sum, e) => sum + (e.media?.length ?? 0), 0);

  const nodes: NetworkNode[] = [
    { id: "event", label: "เหตุการณ์", icon: "event", x: 50, y: 50, accent: "#ef4444" },
    { id: "district", label: "อำเภอ", icon: "place", count: districts, x: 32, y: 18, accent: "#3b82f6" },
    { id: "subdistrict", label: "ตำบล", icon: "place", count: subdistricts, x: 72, y: 18, accent: "#22c55e" },
    { id: "source", label: "แหล่งข้อมูล", icon: "group", count: sources, x: 12, y: 52, accent: "#f59e0b" },
    { id: "type", label: "ประเภทเหตุ", icon: "vehicle", count: types, x: 88, y: 52, accent: "#a855f7" },
    { id: "media", label: "หลักฐานภาพ", icon: "phone", count: media, x: 32, y: 80, accent: "#22d3ee" },
  ];

  return {
    nodes,
    edges: [
      { from: "district", to: "event", weight: districts },
      { from: "subdistrict", to: "event", weight: subdistricts },
      { from: "source", to: "event", weight: sources },
      { from: "type", to: "event", weight: types },
      { from: "media", to: "event", weight: media },
    ],
  };
}

export async function getInvestigationDashboard(
  filters: InvestigationFilters = DEFAULT_FILTERS,
): Promise<InvestigationDashboard> {
  NOW = new Date();
  const bundle = await loadBundle();
  const matched = applyFilters(bundle.events, bundle.sources, filters);
  const previous = applyFilters(bundle.events, bundle.sources, filters, 1);

  const trend = buildTrend(matched, filters.range);
  const { labels: trendLabels, series, max: trendMax, bucketLabel } = trend;

  const sourceUsage = new Map<string, number>();
  for (const e of matched) {
    for (const id of e.corroborating_sources) sourceUsage.set(id, (sourceUsage.get(id) ?? 0) + 1);
  }

  const CATEGORY_LABEL: Record<string, string> = {
    government: "หน่วยงานรัฐ",
    international: "องค์กรระหว่างประเทศ",
    external_dataset: "ชุดข้อมูลภายนอก",
    local_media: "สื่อท้องถิ่น",
    national_media: "สื่อกระแสหลัก",
    citizen_report: "แหล่งข่าวไม่ทางการ",
    manual_entry: "บันทึกด้วยตนเอง",
  };

  return {
    live: bundle.live,
    filters,
    kpis: buildKpis(matched, previous),
    // The whole matched set goes to the client: MapLibre renders points on the
    // GPU, so there is no reason to cap it the way a DOM-node map had to. The
    // heatmap layer derives density itself, so no pre-binning either.
    events: {
      type: "FeatureCollection",
      features: matched.map((e) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: e.location.geo.coordinates },
        properties: {
          id: e._id,
          type: e.event.type,
          // MapLibre paint expressions cannot read null, so an unreported
          // severity is drawn at the neutral middle rather than omitted. The
          // `severity_known` flag keeps the distinction visible to the UI.
          severity: e.severity ?? UNKNOWN_SEVERITY_FALLBACK,
          severity_known: e.severity !== null,
          confidence: e.confidence,
          ts: e.time.start.getTime(),
          title: e.event.title,
          district: e.location.district,
          province: e.location.province,
          precision: e.location.geo_precision ?? "unknown",
          precision_m: GEO_PRECISION_RADIUS_M[e.location.geo_precision ?? "unknown"],
          color: EVENT_COLOR[e.event.type],
        },
      })),
    },
    trend: { labels: trendLabels, series, max: trendMax, bucketLabel },
    network: buildNetwork(matched),
    sources: [...bundle.sources]
      .sort((a, b) => b.trust.score - a.trust.score)
      .map((s) => ({
        id: s._id,
        name: s.shortName,
        category: CATEGORY_LABEL[s.trust.class] ?? s.trust.class,
        score: s.trust.score,
      })),
    recentEvents: matched.slice(0, 14).map((e) => ({
      id: e._id,
      at: e.time.start,
      type: EVENT_TYPE_LABEL[e.event.type],
      district: e.location.district,
      province: e.location.province,
      severity: e.severity ?? 0,
      severityLabel: e.severity === null ? "ไม่ระบุ" : SEVERITY_LABEL[e.severity],
      source:
        bundle.sources.find((s) => s._id === e.corroborating_sources[0])?.shortName ?? "ไม่ระบุ",
    })),
    citizen: buildCitizen(bundle.citizenReports),
    activeCase: bundle.cases[0] ?? null,
    totalMatched: matched.length,
  };
}

export { EVENT_TYPE_LABEL, thaiShortDate, DEFAULT_FILTERS };
export type { InvestigationFilters };
