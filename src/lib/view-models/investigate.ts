import { EVENT_FAMILY_LABEL, EVENT_TYPE_LABEL, SEVERITY_LABEL } from "@/lib/labels";
import { EVENT_FAMILY_COLOR } from "@/lib/palette";
import { PROVINCES } from "@/lib/geo";
import { DEFAULT_FILTERS, RANGE_DAYS, type InvestigationFilters } from "@/lib/filters";
import {
  BUCKET_LABEL,
  bucketIndexOf,
  bucketList,
  chooseBucketUnit,
  dailyCounts,
  detectHotspots as detectHotspotsGeneric,
  rollingMean,
  thaiShortDate,
  type Bucket,
  type HotspotItem,
  type HotspotOptions,
} from "@/lib/stats";
import {
  FILTER_BIT,
  failedConditions,
  matchSnapshotEvents,
  trustedSourceIds,
  type Snapshot,
  type SnapshotCase,
  type SnapshotCitizenReport,
  type SnapshotEvent,
} from "@/lib/snapshot";
import { snapshotToFeature } from "./events";
import { EVENT_FAMILIES, typesInFamily } from "@/lib/types";
import type { EventFamily, EventType } from "@/lib/types";
import type { EventFeature, EventFeatureCollection } from "@/server/shared-events";

/**
 * View model for `/investigate`, built from a `Snapshot` rather than from
 * MongoDB — see the module comment in `./events` for why every builder lives
 * on this side of the wire now.
 */

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
  atMs: number;
  type: string;
  district: string;
  province: string;
  severity: number;
  severityLabel: string;
  source: string;
}

export interface CitizenSignal {
  /** Days of reporting this panel summarises — every "N วัน" label reads it. */
  windowDays: number;
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

export interface SourceFacet {
  id: string;
  label: string;
  /** Events this source would match if it were the only source selected. */
  n: number;
}

export interface InvestigationDashboard {
  live: boolean;
  filters: InvestigationFilters;
  /**
   * Counts for the sidebar's own controls, computed with that dimension's
   * condition lifted — "how many if this were the selection".
   */
  facets: { sources: SourceFacet[] };
  kpis: KpiCard[];
  events: EventFeatureCollection;
  trend: { labels: string[]; series: TrendSeries[]; max: number; bucketLabel: string };
  network: { nodes: NetworkNode[]; edges: { from: string; to: string; weight: number }[] };
  sources: SourceReliabilityRow[];
  recentEvents: EventRow[];
  citizen: CitizenSignal;
  activeCase: SnapshotCase | null;
  totalMatched: number;
}

// ----------------------------------------------------------------- aggregation

/**
 * The trend chart's series, one per family.
 *
 * Derived rather than listed: this used to be a hand-written partition of the
 * event vocabulary, which meant a new category silently fell out of the chart
 * — counted nowhere, and looking like a quiet week rather than a missing
 * series. `EVENT_FAMILY` covers every type by construction, so it cannot.
 */
const TREND_GROUPS: { key: EventFamily; label: string; color: string; types: EventType[] }[] =
  EVENT_FAMILIES.map((family) => ({
    key: family,
    label: EVENT_FAMILY_LABEL[family],
    color: EVENT_FAMILY_COLOR[family],
    types: typesInFamily(family),
  }));

/** Reverse index of the above: which series an event type belongs to. */
const SERIES_OF_TYPE = new Map<EventType, number>(
  TREND_GROUPS.flatMap((g, i) => g.types.map((t): [EventType, number] => [t, i])),
);

/**
 * Counts events into the trend chart's own buckets.
 *
 * The KPI sparklines used to be a fixed 30-day daily series regardless of the
 * selected range. At the default "ทั้งหมด" that drew the last 30 days — 44
 * events — underneath a headline of 9,755, so the line said nothing about the
 * number above it. Sharing the trend's buckets makes the spark cover exactly
 * the span the KPI counts.
 *
 * `weight` lets a card whose headline is not an event count (claims sums
 * `sources`) plot its own quantity rather than event volume.
 */
function buildSpark(buckets: Bucket[]) {
  return (events: SnapshotEvent[], weight: (e: SnapshotEvent) => number = () => 1) => {
    const points: number[] = new Array(buckets.length).fill(0);
    for (const e of events) {
      const i = bucketIndexOf(buckets, e.ts);
      if (i >= 0) points[i] += weight(e);
    }
    return points;
  };
}

/**
 * `matched` is the current window; `previous` is the same filters shifted back
 * by one window length, so every delta is a like-for-like comparison.
 * `spark` comes from `buildSpark`, bucketed to the selected range.
 */
function buildKpis(
  matched: SnapshotEvent[],
  previous: SnapshotEvent[],
  spark: ReturnType<typeof buildSpark>,
): KpiCard[] {
  const claims = matched.reduce((s, e) => s + e.sources.length, 0);
  const prevClaims = previous.reduce((s, e) => s + e.sources.length, 0);

  const isFact = (e: SnapshotEvent) => e.verification === "verified" && e.confidence >= 85;
  const facts = matched.filter(isFact).length;
  const prevFacts = previous.filter(isFact).length;

  const mean = (xs: SnapshotEvent[]) =>
    xs.length ? xs.reduce((s, e) => s + e.confidence, 0) / xs.length : 0;
  const confidence = Math.round(mean(matched));
  const confidenceDelta = Math.round(mean(matched) - mean(previous));

  /** Signed percent change, clamped so a near-empty baseline can't print +2485%. */
  const delta = (nowCount: number, before: number) => {
    if (before === 0) return nowCount === 0 ? "0%" : "ใหม่";
    const p = Math.round(((nowCount - before) / before) * 100);
    return `${p >= 0 ? "+" : ""}${Math.max(-99, Math.min(999, p))}%`;
  };
  const tone = (nowCount: number, before: number): KpiCard["deltaTone"] =>
    nowCount > before ? "up" : nowCount < before ? "down" : "flat";

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
      spark: spark(matched, (e) => e.sources.length),
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

/**
 * Find districts reporting materially more than expected. Thin wrapper over
 * the generic `detectHotspots` in `@/lib/stats`, keyed the way citizen reports
 * have always been keyed here (`อ.${district} จ.${province}`), so `/events`
 * can reuse the same significance test keyed by its own event locations
 * without a second implementation.
 */
function detectHotspots(
  reports: SnapshotCitizenReport[],
  endMs: number,
  opts: HotspotOptions = {},
) {
  const items: HotspotItem[] = reports.map((r) => {
    const province = PROVINCES.find((p) => p.code === r.provinceCode)?.name ?? "";
    return { key: `อ.${r.district} จ.${province}`, atMs: r.ts };
  });
  return detectHotspotsGeneric(items, endMs, opts);
}

/**
 * How many days of citizen reporting the panel summarises.
 *
 * Follows the sidebar's ช่วงเวลา so the panel answers the same question as the
 * rest of the page, with two guards. A one-day "trend" is a single point, not
 * a line, so `CITIZEN_MIN_WINDOW_DAYS` floors it; and "ทั้งหมด" spans the whole
 * 2545-onward record, where a daily report-volume series would be twenty-odd
 * years of pixels nobody reads — that keeps the 30-day recent window the panel
 * has always used.
 */
const CITIZEN_MIN_WINDOW_DAYS = 7;
const CITIZEN_DEFAULT_WINDOW_DAYS = 30;

function citizenWindowDays(range: InvestigationFilters["range"]): number {
  const days = RANGE_DAYS[range];
  return days === null ? CITIZEN_DEFAULT_WINDOW_DAYS : Math.max(CITIZEN_MIN_WINDOW_DAYS, days);
}

/**
 * The recent/baseline split inside the citizen window, as a fraction of it.
 * 7 of 30 days is what this panel has always compared, so the default window
 * reproduces the previous 7-day-against-23-day test exactly.
 */
const CITIZEN_HOTSPOT_RECENT_FRACTION = 7 / 30;

function buildCitizen(
  reports: SnapshotCitizenReport[],
  nowMs: number,
  filters: InvestigationFilters,
): CitizenSignal {
  const windowDays = citizenWindowDays(filters.range);
  const windowMs = windowDays * 86400000;

  // The panel used to summarise every citizen report in the database — every
  // province, a fixed 30 days — so nothing in it, the hotspot list included,
  // ever moved when the sidebar changed. A citizen report carries a province
  // and a date and nothing else the sidebar filters on (no event type, no
  // verification state, no source registry entry), so those two are what
  // scope it.
  const scoped = filters.provinces.length
    ? reports.filter((r) => filters.provinces.includes(r.provinceCode))
    : reports;

  const window = scoped.filter((r) => nowMs - r.ts <= windowMs);
  const daily = dailyCounts(window.map((r) => r.ts), windowDays, nowMs);
  const rollingAvg = rollingMean(daily, windowDays);

  const mean = daily.reduce((s, n) => s + n, 0) / daily.length;
  const sd = Math.sqrt(daily.reduce((s, n) => s + (n - mean) ** 2, 0) / daily.length);
  const anomalyIndex = daily.map((n, i) => (n > mean + 1.6 * sd ? i : -1)).filter((i) => i >= 0);

  const dayLabels = Array.from({ length: windowDays }, (_, i) =>
    thaiShortDate(new Date(nowMs - (windowDays - 1 - i) * 86400000)),
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
      series: dailyCounts(rows.map((r) => r.ts), windowDays, nowMs),
    };
  });

  const topicCounts = new Map<string, number>();
  for (const r of window) topicCounts.set(r.topic, (topicCounts.get(r.topic) ?? 0) + 1);
  const topSignals = [...topicCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([t]) => `#${t}`);

  // Scaled off `windowDays` rather than left at the 7/23-day default, so the
  // recent-against-baseline split stays proportional to whatever window the
  // sidebar selected instead of silently testing 30 days inside a 90-day one.
  const hotspotOpts = {
    recentDays: windowDays * CITIZEN_HOTSPOT_RECENT_FRACTION,
    baselineDays: windowDays * (1 - CITIZEN_HOTSPOT_RECENT_FRACTION),
  };
  const { hotspots, significantCount } = detectHotspots(window, nowMs, hotspotOpts);

  // Period over period: this window against the one of equal length before it.
  const prior = scoped.filter((r) => {
    const age = nowMs - r.ts;
    return age > windowMs && age <= 2 * windowMs;
  });
  const changePct = prior.length
    ? Math.round(((window.length - prior.length) / prior.length) * 100)
    : 0;

  const factRate = (rows: SnapshotCitizenReport[]) =>
    rows.length ? (rows.filter((r) => r.becameFact).length / rows.length) * 100 : 0;

  return {
    windowDays,
    totalReports: window.length,
    changePct,
    // Districts whose recent volume exceeds what the national trend predicts,
    // at a 5% false-discovery rate across the whole district scan — not merely
    // "more than last week", and not an uncorrected p < 0.05 either.
    suspiciousClusters: significantCount,
    clusterDelta:
      significantCount - detectHotspots(prior, nowMs - windowMs, hotspotOpts).significantCount,
    factConversionPct: Math.round(factRate(window)),
    factConversionDelta: Math.round(factRate(window) - factRate(prior)),
    daily,
    rollingAvg,
    anomalyIndex,
    dayLabels,
    channels,
    topSignals,
    hotspots: hotspots.map(({ rank, label, delta }) => ({ rank, label, delta })),
  };
}

/**
 * Trend bucketed to suit the selected range.
 *
 * A fixed 30-day daily series was useless against this data: the ingested
 * record spans 2002 onward, so at "ทั้งหมด" the chart showed a flat line with
 * everything crushed into the last pixel. Short ranges stay daily; longer ones
 * roll up to months or years so the shape of two decades is actually visible.
 */
function buildTrend(events: SnapshotEvent[], nowMs: number) {
  const times = events.map((e) => e.ts);

  // "ทั้งหมด" spans whatever the data spans, so derive the window from it.
  const endMs = nowMs;
  const startMs = times.length ? Math.min(...times) : endMs - 30 * 86400000;
  const spanDays = Math.max(1, (endMs - startMs) / 86400000);
  const unit = chooseBucketUnit(spanDays);

  const buckets = bucketList(startMs, endMs, unit);

  // One walk of the events, not one per family. This used to run the whole
  // matched set through `types.includes` once per `TREND_GROUPS` entry — seven
  // passes, each doing a linear scan of that family's type list per event, to
  // answer a question a lookup table answers in constant time.
  const points = TREND_GROUPS.map(() => new Array<number>(buckets.length).fill(0));
  for (const e of events) {
    const g = SERIES_OF_TYPE.get(e.type);
    if (g === undefined) continue;
    const i = bucketIndexOf(buckets, e.ts);
    if (i >= 0) points[g][i] += 1;
  }
  const series: TrendSeries[] = TREND_GROUPS.map((g, gi) => ({
    key: g.key,
    label: g.label,
    color: g.color,
    points: points[gi],
  }));

  const max = Math.max(
    10,
    ...buckets.map((_, i) => series.reduce((sum, g) => sum + g.points[i], 0)),
  );

  return {
    labels: buckets.map((b) => b.label),
    series,
    max,
    bucketLabel: BUCKET_LABEL[unit],
    // Handed back so the KPI sparklines can share the same bins rather than
    // inventing a second, unrelated time window.
    buckets,
    unit,
  };
}

/** How many rows the "รายการเหตุการณ์ล่าสุด" panel shows. */
const RECENT_EVENTS_LIMIT = 14;

/** Open cases outrank monitored ones, which outrank closed. */
const CASE_STATUS_RANK: Record<SnapshotCase["status"], number> = {
  investigating: 0,
  monitoring: 1,
  closed: 2,
};

/**
 * The rail showed `cases[0]` — whichever document the collection scan happened
 * to return first, so "เคสที่กำลังติดตาม" could be a closed case while an open
 * one sat behind it. Rank instead: still open, then highest risk, then most
 * recent, with `id` as a tiebreak so the rail doesn't swap between renders.
 */
function pickActiveCase(cases: SnapshotCase[]): SnapshotCase | null {
  return (
    [...cases].sort(
      (a, b) =>
        CASE_STATUS_RANK[a.status] - CASE_STATUS_RANK[b.status] ||
        b.riskScore - a.riskScore ||
        b.occurredAtMs - a.occurredAtMs ||
        a.id.localeCompare(b.id),
    )[0] ?? null
  );
}

function buildNetwork(events: SnapshotEvent[]) {
  // One walk, accumulating straight into the sets. The previous shape built
  // four throwaway arrays as long as the matched set — ~40,000 strings, for a
  // result that is five integers.
  const districtSet = new Set<string>();
  const subdistrictSet = new Set<string>();
  const sourceSet = new Set<string>();
  const typeSet = new Set<string>();
  let media = 0;
  for (const e of events) {
    districtSet.add(`${e.province}/${e.district}`);
    if (e.subdistrict) subdistrictSet.add(`${e.district}/${e.subdistrict}`);
    for (const id of e.sources) if (id) sourceSet.add(id);
    if (e.type) typeSet.add(e.type);
    media += e.mediaCount;
  }
  const districts = districtSet.size;
  const subdistricts = subdistrictSet.size;
  const sources = sourceSet.size;
  const types = typeSet.size;

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

const CATEGORY_LABEL: Record<string, string> = {
  government: "หน่วยงานรัฐ",
  international: "องค์กรระหว่างประเทศ",
  external_dataset: "ชุดข้อมูลภายนอก",
  local_media: "สื่อท้องถิ่น",
  national_media: "สื่อกระแสหลัก",
  citizen_report: "แหล่งข่าวไม่ทางการ",
  manual_entry: "บันทึกด้วยตนเอง",
};

export function buildInvestigationDashboard(
  snapshot: Snapshot,
  filters: InvestigationFilters = DEFAULT_FILTERS,
  nowMs: number = Date.now(),
): InvestigationDashboard {
  // The matched set and the source facet in one pass — see `failedConditions`.
  const trusted = trustedSourceIds(snapshot.sources);
  const matched: SnapshotEvent[] = [];
  const sourceCounts = new Map<string, number>();
  for (const e of snapshot.events) {
    const fail = failedConditions(e, filters, nowMs, trusted);
    if (fail !== 0 && fail !== FILTER_BIT.source) continue;
    if (fail === 0) matched.push(e);
    for (const id of e.sources) sourceCounts.set(id, (sourceCounts.get(id) ?? 0) + 1);
  }

  const previous = matchSnapshotEvents(snapshot, filters, { nowMs, windowsBack: 1 });

  const trend = buildTrend(matched, nowMs);
  const { labels: trendLabels, series, max: trendMax, bucketLabel } = trend;
  const spark = buildSpark(trend.buckets);

  const sourceById = new Map(snapshot.sources.map((s) => [s.id, s]));

  /**
   * The sidebar's แหล่งข้อมูล list used to be seven hard-coded `<option>`s, and
   * every one of them was dead: five named ids that are not in
   * `source_registry` at all (`src_ucdp`, `src_citizen`, …) and two that are
   * but appear on no event. Selecting any of them filtered the dashboard to
   * zero. Deriving the list from the data — the same way the province and type
   * facets already were — is the only version of this control that cannot
   * drift from the registry again.
   */
  const sourceFacets: SourceFacet[] = snapshot.sources
    .map((s) => ({ id: s.id, label: s.shortName, n: sourceCounts.get(s.id) ?? 0 }))
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label, "th"));

  return {
    live: snapshot.live,
    filters,
    facets: { sources: sourceFacets },
    kpis: buildKpis(matched, previous, spark),
    // The whole matched set goes to the client: MapLibre renders points on the
    // GPU, so there is no reason to cap it the way a DOM-node map had to. The
    // heatmap layer derives density itself, so no pre-binning either.
    events: {
      type: "FeatureCollection",
      features: matched.flatMap((e): EventFeature[] => {
        const feature = snapshotToFeature(e);
        return feature ? [feature] : [];
      }),
    },
    trend: { labels: trendLabels, series, max: trendMax, bucketLabel },
    network: buildNetwork(matched),
    sources: [...snapshot.sources]
      .sort((a, b) => b.trustScore - a.trustScore)
      .map((s) => ({
        id: s.id,
        name: s.shortName,
        category: CATEGORY_LABEL[s.trustClass] ?? s.trustClass,
        score: s.trustScore,
      })),
    // "ล่าสุด" has to mean it. Unsorted, this took `matched` in whatever order
    // the collection scan returned, which put 2545-era records at the top of a
    // panel headed "รายการเหตุการณ์ล่าสุด". `id` breaks ties so the list is
    // stable across renders instead of reshuffling equal timestamps.
    recentEvents: [...matched]
      .sort((a, b) => b.ts - a.ts || a.id.localeCompare(b.id))
      .slice(0, RECENT_EVENTS_LIMIT)
      .map((e) => ({
        id: e.id,
        atMs: e.ts,
        type: EVENT_TYPE_LABEL[e.type],
        district: e.district,
        province: e.province,
        severity: e.severity ?? 0,
        severityLabel: e.severity === null ? "ไม่ระบุ" : SEVERITY_LABEL[e.severity],
        source: sourceById.get(e.sources[0] ?? "")?.shortName ?? "ไม่ระบุ",
      })),
    citizen: buildCitizen(snapshot.citizenReports, nowMs, filters),
    activeCase: pickActiveCase(snapshot.cases),
    totalMatched: matched.length,
  };
}
