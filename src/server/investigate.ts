import { EVENT_TYPE_LABEL, SEVERITY_LABEL } from "@/lib/labels";
import { PROVINCES } from "@/lib/geo";
import { DEFAULT_FILTERS, type InvestigationFilters } from "@/lib/filters";
import {
  BUCKET_LABEL,
  bucketKey,
  bucketList,
  chooseBucketUnit,
  dailyCounts,
  detectHotspots as detectHotspotsGeneric,
  rollingMean,
  thaiShortDate,
  type HotspotItem,
} from "@/lib/stats";
import {
  loadBundle,
  matchedEvents,
  toEventFeature,
  type EventFeature,
  type EventFeatureCollection,
} from "./shared-events";
import type { CaseDoc, CitizenReportDoc, EventCandidateDoc, EventType } from "@/lib/types";

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

/**
 * `matched` is the current window; `previous` is the same filters shifted back
 * by one window length, so every delta is a like-for-like comparison.
 */
function buildKpis(matched: EventCandidateDoc[], previous: EventCandidateDoc[], now: Date): KpiCard[] {
  const claims = matched.reduce((s, e) => s + e.corroborating_sources.length, 0);
  const prevClaims = previous.reduce((s, e) => s + e.corroborating_sources.length, 0);

  const isFact = (e: EventCandidateDoc) => e.verification === "verified" && e.confidence >= 85;
  const facts = matched.filter(isFact).length;
  const prevFacts = previous.filter(isFact).length;

  const mean = (xs: EventCandidateDoc[]) =>
    xs.length ? xs.reduce((s, e) => s + e.confidence, 0) / xs.length : 0;
  const confidence = Math.round(mean(matched));
  const confidenceDelta = Math.round(mean(matched) - mean(previous));

  const spark = (xs: EventCandidateDoc[]) =>
    dailyCounts(xs.map((e) => e.time.start.getTime()), 30, now.getTime());

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

/**
 * Find districts reporting materially more than expected. Thin wrapper over
 * the generic `detectHotspots` in `@/lib/stats`, keyed the way citizen reports
 * have always been keyed here (`อ.${district} จ.${province}`), so `/events`
 * can reuse the same significance test keyed by its own event locations
 * without a second implementation.
 */
function detectHotspots(reports: CitizenReportDoc[], endMs: number) {
  const items: HotspotItem[] = reports.map((r) => {
    const province = PROVINCES.find((p) => p.code === r.provinceCode)?.name ?? "";
    return { key: `อ.${r.district} จ.${province}`, atMs: r.reported_at.getTime() };
  });
  return detectHotspotsGeneric(items, endMs);
}

function buildCitizen(reports: CitizenReportDoc[], now: Date): CitizenSignal {
  const nowMs = now.getTime();
  const window = reports.filter((r) => nowMs - r.reported_at.getTime() <= 30 * 86400000);
  const daily = dailyCounts(window.map((r) => r.reported_at.getTime()), 30, nowMs);
  const rollingAvg = rollingMean(daily, 30);

  const mean = daily.reduce((s, n) => s + n, 0) / daily.length;
  const sd = Math.sqrt(daily.reduce((s, n) => s + (n - mean) ** 2, 0) / daily.length);
  const anomalyIndex = daily.map((n, i) => (n > mean + 1.6 * sd ? i : -1)).filter((i) => i >= 0);

  const dayLabels = Array.from({ length: 30 }, (_, i) =>
    thaiShortDate(new Date(nowMs - (29 - i) * 86400000)),
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
      series: dailyCounts(rows.map((r) => r.reported_at.getTime()), 30, nowMs),
    };
  });

  const topicCounts = new Map<string, number>();
  for (const r of window) topicCounts.set(r.topic, (topicCounts.get(r.topic) ?? 0) + 1);
  const topSignals = [...topicCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([t]) => `#${t}`);

  const { hotspots, significantCount } = detectHotspots(window, nowMs);

  // Period over period: this 30-day window against the 30 before it.
  const prior = reports.filter((r) => {
    const age = nowMs - r.reported_at.getTime();
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
    clusterDelta: significantCount - detectHotspots(prior, nowMs - 30 * 86400000).significantCount,
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
function buildTrend(events: EventCandidateDoc[], now: Date) {
  const times = events.map((e) => e.time.start.getTime());

  // "ทั้งหมด" spans whatever the data spans, so derive the window from it.
  const endMs = now.getTime();
  const startMs = times.length ? Math.min(...times) : endMs - 30 * 86400000;
  const spanDays = Math.max(1, (endMs - startMs) / 86400000);
  const unit = chooseBucketUnit(spanDays);

  const buckets = bucketList(startMs, endMs, unit);
  const index = new Map(buckets.map((b, i) => [b.key, i]));

  const series: TrendSeries[] = TREND_GROUPS.map((g) => {
    const points = new Array(buckets.length).fill(0);
    for (const e of events) {
      if (!g.types.includes(e.event.type)) continue;
      const i = index.get(bucketKey(e.time.start, unit));
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
    bucketLabel: BUCKET_LABEL[unit],
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
  // Threaded explicitly through every helper below rather than read off a
  // module-level global: two in-flight requests on the same server process
  // must each see their own "now", not whichever one reassigned it last.
  const now = new Date();
  const bundle = await loadBundle();
  const matched = matchedEvents(bundle, filters, { now });
  const previous = matchedEvents(bundle, filters, { now, windowsBack: 1 });

  const trend = buildTrend(matched, now);
  const { labels: trendLabels, series, max: trendMax, bucketLabel } = trend;

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
    kpis: buildKpis(matched, previous, now),
    // The whole matched set goes to the client: MapLibre renders points on the
    // GPU, so there is no reason to cap it the way a DOM-node map had to. The
    // heatmap layer derives density itself, so no pre-binning either.
    events: {
      type: "FeatureCollection",
      features: matched.map((e): EventFeature => toEventFeature(e)),
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
    citizen: buildCitizen(bundle.citizenReports, now),
    activeCase: bundle.cases[0] ?? null,
    totalMatched: matched.length,
  };
}

export { EVENT_TYPE_LABEL, thaiShortDate, DEFAULT_FILTERS };
export type { InvestigationFilters };
export type { EventFeature, EventFeatureCollection } from "./shared-events";
