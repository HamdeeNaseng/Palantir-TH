import { COLLECTIONS, getDb } from "@/lib/mongodb";
import { EVENT_TYPE_LABEL, NOW, buildAll } from "@/lib/fixtures";
import { PROVINCES, project } from "@/lib/geo";
import { DEFAULT_FILTERS, RANGE_DAYS, type InvestigationFilters } from "@/lib/filters";
import type {
  CaseDoc,
  CitizenReportDoc,
  EventCandidateDoc,
  EventType,
  IngestionRunDoc,
  SourceRegistryDoc,
} from "@/lib/types";

/** Sources at or above this trust score satisfy "เฉพาะแหล่งข้อมูลที่เชื่อถือได้". */
const TRUSTED_SCORE_FLOOR = 70;

interface RawBundle {
  sources: SourceRegistryDoc[];
  events: EventCandidateDoc[];
  citizenReports: CitizenReportDoc[];
  ingestionRuns: IngestionRunDoc[];
  cases: CaseDoc[];
  /** false when the database was unreachable and demo fixtures were used. */
  live: boolean;
}

/**
 * Reads the document layers from MongoDB, falling back to the in-memory
 * fixtures when the container is not running. Aggregation happens in the app
 * (see below) so both paths share one implementation.
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

    if (events.length > 0 && sources.length > 0) {
      return { sources, events, citizenReports, ingestionRuns, cases, live: true };
    }
  } catch {
    // Database unavailable or not seeded — fall through to fixtures.
  }

  return { ...buildAll(), live: false };
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

export interface MapMarker {
  id: string;
  x: number;
  y: number;
  type: EventType;
  severity: number;
  title: string;
  district: string;
  province: string;
}

export interface HeatBlob {
  x: number;
  y: number;
  r: number;
  intensity: number;
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
  markers: MapMarker[];
  heat: HeatBlob[];
  trend: { labels: string[]; series: TrendSeries[]; max: number };
  network: { nodes: NetworkNode[]; edges: { from: string; to: string; weight: number }[] };
  sources: SourceReliabilityRow[];
  recentEvents: EventRow[];
  citizen: CitizenSignal;
  activeCase: CaseDoc | null;
  totalMatched: number;
}

// ----------------------------------------------------------------- aggregation

const SEVERITY_LABEL = ["", "ต่ำ", "ปานกลาง", "สูง", "สูงมาก", "วิกฤต"];

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

function buildHeat(events: EventCandidateDoc[]): HeatBlob[] {
  // Grid-bin the events, then emit one blob per populated cell. Cheap density
  // estimate that reads like a heatmap once blurred in the SVG layer.
  const cell = 0.09;
  const bins = new Map<string, { lng: number; lat: number; n: number }>();
  for (const e of events) {
    const [lng, lat] = e.location.geo.coordinates;
    const key = `${Math.round(lng / cell)}:${Math.round(lat / cell)}`;
    const bin = bins.get(key) ?? { lng: 0, lat: 0, n: 0 };
    bin.lng += lng;
    bin.lat += lat;
    bin.n += 1;
    bins.set(key, bin);
  }

  const cells = [...bins.values()].filter((b) => b.n >= 2);
  const max = Math.max(1, ...cells.map((b) => b.n));

  return cells
    .map((b) => {
      const p = project([b.lng / b.n, b.lat / b.n]);
      return { x: p.x, y: p.y, r: 3.2 + (b.n / max) * 6.5, intensity: b.n / max };
    })
    .sort((a, b) => a.intensity - b.intensity);
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

  // Hotspot = district whose last 7 days ran hottest against its own prior 23,
  // compared as reports *per day* on both sides.
  const districtStats = new Map<string, { recent: number; before: number }>();
  for (const r of window) {
    const province = PROVINCES.find((p) => p.code === r.provinceCode)?.name ?? "";
    const key = `อ.${r.district} จ.${province}`;
    const s = districtStats.get(key) ?? { recent: 0, before: 0 };
    if (NOW.getTime() - r.reported_at.getTime() <= 7 * 86400000) s.recent += 1;
    else s.before += 1;
    districtStats.set(key, s);
  }
  const hotspots = [...districtStats.entries()]
    .filter(([, s]) => s.before >= 10)
    .map(([label, s]) => ({
      label,
      delta: Math.round((s.recent / 7 / (s.before / 23) - 1) * 100),
    }))
    .filter((h) => h.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 3)
    .map((h, i) => ({ rank: i + 1, ...h }));

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
    // Distinct district/topic pairs running above their own baseline.
    suspiciousClusters: [...districtStats.values()].filter(
      (s) => s.before >= 4 && s.recent / 7 > s.before / 23,
    ).length,
    clusterDelta: 5,
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

function buildNetwork(activeCase: CaseDoc | null) {
  const e = activeCase?.entities ?? { people: 12, groups: 3, vehicles: 1, phones: 5, places: 3, evidence: 3 };

  const nodes: NetworkNode[] = [
    { id: "event", label: "เหตุการณ์", icon: "event", x: 50, y: 50, accent: "#ef4444" },
    { id: "person", label: "บุคคล", icon: "person", count: e.people, x: 32, y: 18, accent: "#22c55e" },
    { id: "group", label: "กลุ่ม", icon: "group", count: e.groups, x: 72, y: 18, accent: "#f59e0b" },
    { id: "place", label: "สถานที่", icon: "place", count: e.places, x: 12, y: 52, accent: "#3b82f6" },
    { id: "vehicle", label: "ยานพาหนะ", icon: "vehicle", count: e.vehicles, x: 88, y: 52, accent: "#a855f7" },
    { id: "phone", label: "โทรศัพท์", icon: "phone", count: e.phones, x: 32, y: 80, accent: "#22d3ee" },
  ];

  const edges = [
    { from: "person", to: "event", weight: 31 },
    { from: "group", to: "event", weight: 8 },
    { from: "place", to: "event", weight: 31 },
    { from: "vehicle", to: "event", weight: 16 },
    { from: "phone", to: "event", weight: 12 },
  ];

  return { nodes, edges };
}

export async function getInvestigationDashboard(
  filters: InvestigationFilters = DEFAULT_FILTERS,
): Promise<InvestigationDashboard> {
  const bundle = await loadBundle();
  const matched = applyFilters(bundle.events, bundle.sources, filters);
  const previous = applyFilters(bundle.events, bundle.sources, filters, 1);

  const trendLabels = Array.from({ length: 30 }, (_, i) =>
    thaiShortDate(new Date(NOW.getTime() - (29 - i) * 86400000)),
  );
  const trendWindow = matched.filter((e) => inRange(e.time.start, "30d"));
  const series: TrendSeries[] = TREND_GROUPS.map((g) => ({
    key: g.key,
    label: g.label,
    color: g.color,
    points: dailyCounts(
      trendWindow.filter((e) => g.types.includes(e.event.type)).map((e) => e.time.start),
      30,
    ),
  }));
  const trendMax = Math.max(
    10,
    ...trendLabels.map((_, i) => series.reduce((s, g) => s + g.points[i], 0)),
  );

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
    markers: matched.slice(0, 140).map((e) => {
      const p = project(e.location.geo.coordinates);
      return {
        id: e._id,
        x: p.x,
        y: p.y,
        type: e.event.type,
        severity: e.severity,
        title: e.event.title,
        district: e.location.district,
        province: e.location.province,
      };
    }),
    heat: buildHeat(matched),
    trend: { labels: trendLabels, series, max: trendMax },
    network: buildNetwork(bundle.cases[0] ?? null),
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
      severity: e.severity,
      severityLabel: SEVERITY_LABEL[e.severity],
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
