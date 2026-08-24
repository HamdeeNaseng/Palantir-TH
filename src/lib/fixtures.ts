import { PROVINCES } from "./geo";
import {
  districtsOfProvince,
  randomPointInPolygon,
  representativePoint,
  type District,
} from "./geography";
import type {
  CaseDoc,
  CitizenReportDoc,
  EventCandidateDoc,
  EventType,
  GeoPrecision,
  IngestionRunDoc,
  ProvinceCode,
  SeverityLevel,
  SourceRegistryDoc,
  VerificationStatus,
} from "./types";

/**
 * Deterministic demo dataset.
 *
 * Used by `scripts/seed.ts` to populate MongoDB, and by the server layer as an
 * in-memory fallback when the database is unreachable — so the UI always has
 * something to render and both paths exercise the same aggregation code.
 */

/** mulberry32 — small deterministic PRNG so seeds and fallbacks agree. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

/** Anchor date so the dataset is stable regardless of when it is generated. */
export const NOW = new Date("2024-05-19T12:00:00+07:00");

export const SOURCES: SourceRegistryDoc[] = [
  {
    _id: "src_dsi_wcid",
    name: "DSI-WCID",
    shortName: "DSI-WCID",
    category: "conflict_event",
    priority: "P1",
    connector: { type: "DATASET" },
    schedule: { mode: "snapshot", frequency: "weekly" },
    trust: { class: "government", score: 92 },
    enabled: true,
  },
  {
    _id: "src_acled",
    name: "ACLED",
    shortName: "ACLED",
    category: "conflict_event",
    priority: "P1",
    connector: { type: "REST_API", endpoint: "ACLED_API" },
    schedule: { mode: "incremental", frequency: "daily" },
    trust: { class: "international", score: 85 },
    enabled: true,
  },
  {
    _id: "src_ucdp",
    name: "UCDP GED",
    shortName: "UCDP GED",
    category: "conflict_event",
    priority: "P1",
    connector: { type: "REST_API", endpoint: "UCDP_API" },
    schedule: { mode: "versioned", frequency: "daily" },
    trust: { class: "international", score: 81 },
    enabled: true,
  },
  {
    _id: "src_isoc4",
    name: "กอ.รมน.ภาค 4 สน.",
    shortName: "กอ.รมน.ภาค 4 สน.",
    category: "official_report",
    priority: "P1",
    connector: { type: "SCRAPER" },
    schedule: { mode: "incremental", frequency: "1-3h" },
    trust: { class: "government", score: 80 },
    enabled: true,
  },
  {
    _id: "src_local_news",
    name: "ข่าวท้องถิ่น",
    shortName: "ข่าวท้องถิ่น",
    category: "media",
    priority: "P2",
    connector: { type: "SCRAPER" },
    schedule: { mode: "incremental", frequency: "hourly" },
    trust: { class: "local_media", score: 71 },
    enabled: true,
  },
  {
    _id: "src_thaipbs",
    name: "Thai PBS",
    shortName: "Thai PBS",
    category: "media",
    priority: "P2",
    connector: { type: "SCRAPER" },
    schedule: { mode: "incremental", frequency: "hourly" },
    trust: { class: "national_media", score: 65 },
    enabled: true,
  },
  {
    _id: "src_citizen",
    name: "รายงานประชาชน",
    shortName: "รายงานประชาชน",
    category: "citizen",
    priority: "P3",
    connector: { type: "REST_API" },
    schedule: { mode: "incremental", frequency: "realtime" },
    trust: { class: "citizen_report", score: 48 },
    enabled: true,
  },
];

const EVENT_TYPES: { type: EventType; label: string; weight: number }[] = [
  { type: "unrest", label: "เหตุรุนแรง", weight: 22 },
  { type: "shooting", label: "ยิง/ประทะ", weight: 20 },
  { type: "raid", label: "ตรวจค้น/จับกุม", weight: 18 },
  { type: "explosion", label: "ลอบวางระเบิด", weight: 14 },
  { type: "arson", label: "วางเพลิง", weight: 9 },
  { type: "narcotics", label: "ยาเสพติด", weight: 8 },
  { type: "abduction", label: "ลักพาตัว", weight: 5 },
  { type: "crime", label: "อาชญากรรม", weight: 4 },
];

// Display labels live in ./labels — this module is server-only (it reads
// boundary GeoJSON from disk) and client components need the labels too.

const TITLE_BY_TYPE: Record<EventType, string[]> = {
  explosion: ["ลอบวางระเบิดริมทางหลวง", "ระเบิดแสวงเครื่องใกล้จุดตรวจ", "ลอบวางระเบิดเสาไฟฟ้า"],
  shooting: ["คนร้ายลอบยิงเจ้าหน้าที่", "ปะทะระหว่างเจ้าหน้าที่กับกลุ่มติดอาวุธ", "ลอบยิงราษฎรในพื้นที่"],
  arson: ["วางเพลิงเผายานพาหนะ", "วางเพลิงอาคารราชการ", "เผายางรถยนต์ปิดถนน"],
  abduction: ["ลักพาตัวราษฎรในพื้นที่", "ควบคุมตัวโดยกลุ่มไม่ทราบฝ่าย"],
  raid: ["ปิดล้อมตรวจค้นเป้าหมาย", "จับกุมผู้ต้องสงสัยตามหมายจับ", "ตรวจค้นแหล่งพักพิง"],
  unrest: ["เหตุก่อกวนหลายจุด", "ชุมนุมกดดันเจ้าหน้าที่", "ก่อกวนสร้างสถานการณ์"],
  narcotics: ["จับกุมเครือข่ายยาเสพติด", "ตรวจยึดยาเสพติดของกลาง"],
  crime: ["เหตุอาชญากรรมทั่วไป", "ชิงทรัพย์ในพื้นที่เฝ้าระวัง"],
  gang: ["ความเคลื่อนไหวของกลุ่มเป้าหมาย"],
  other: ["เหตุการณ์อื่น ๆ"],
};

function weightedType(r: () => number): EventType {
  const total = EVENT_TYPES.reduce((s, t) => s + t.weight, 0);
  let n = r() * total;
  for (const t of EVENT_TYPES) {
    n -= t.weight;
    if (n <= 0) return t.type;
  }
  return "other";
}

/** Province mix: the three southernmost provinces carry most of the volume. */
const PROVINCE_WEIGHT: Record<ProvinceCode, number> = {
  pattani: 34,
  yala: 28,
  narathiwat: 27,
  songkhla: 11,
  other: 0,
};

function weightedProvince(r: () => number) {
  const entries = PROVINCES.map((p) => [p, PROVINCE_WEIGHT[p.code]] as const);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let n = r() * total;
  for (const [p, w] of entries) {
    n -= w;
    if (n <= 0) return p;
  }
  return PROVINCES[0];
}

/**
 * Precision mix, weighted toward coarse geocoding because that is what the
 * official sources actually publish. Duplicated entries set the weight.
 */
const PRECISION_MIX = [
  "gps",
  "address",
  "village",
  "village",
  "subdistrict",
  "subdistrict",
  "district",
  "district",
  "unknown",
] as const;

/**
 * Produce a coordinate consistent with how precisely the location is known.
 *
 * The stored coordinate is the best available estimate, and `geo_precision`
 * (with `GEO_PRECISION_RADIUS_M`) says how far the truth may sit from it. A
 * district-level geocode genuinely resolves to one point for the whole
 * district, so it returns the district's representative point; anything finer
 * is a real position somewhere inside the district.
 *
 * Every branch returns a point inside the district polygon.
 */
function placeEvent(
  r: () => number,
  precision: GeoPrecision,
  district: District,
): [number, number] {
  if (precision === "district" || precision === "province" || precision === "unknown") {
    return representativePoint(district.geometry);
  }
  return randomPointInPolygon(r, district.geometry, district.bbox);
}

export const TOTAL_EVENTS = 1246;

export function buildEvents(): EventCandidateDoc[] {
  const r = rng(20240519);
  const events: EventCandidateDoc[] = [];

  for (let i = 0; i < TOTAL_EVENTS; i++) {
    const province = weightedProvince(r);
    // Districts come from the DDPM boundaries, never a hand-written list, so
    // the label and the coordinate below can never describe different places.
    const district = pick(r, districtsOfProvince(province.ddpmCode));
    const type = weightedType(r);

    // Spread over ~9 years of history. Just over half the volume lands in the
    // last 90 days so the 30-day panels have material, but it stays *uniform*
    // inside that span — otherwise the current window dwarfs the preceding one
    // and every KPI delta reads as a meaningless several-hundred percent.
    const daysAgo = r() < 0.55 ? Math.floor(r() * 90) : 90 + Math.floor(r() * 3210);
    const at = new Date(NOW.getTime() - daysAgo * 86400000 - Math.floor(r() * 86400000));

    // Draw the precision first, because it decides how the coordinate is
    // produced. Official datasets rarely carry a GPS fix; most events are
    // geocoded to a village or district centroid, so the mix reflects that.
    const precision = pick(r, PRECISION_MIX);
    const geo = placeEvent(r, precision, district);

    const severity = (1 + Math.floor(r() ** 1.6 * 5)) as SeverityLevel;
    const roll = r();
    const verification: VerificationStatus =
      roll < 0.62 ? "verified" : roll < 0.88 ? "under_review" : "unverifiable";

    const nSources = 1 + Math.floor(r() * 3);
    const corroborating = [...SOURCES]
      .sort(() => r() - 0.5)
      .slice(0, nSources)
      .map((s) => s._id);

    const confidence = Math.round(
      Math.min(
        98,
        corroborating.reduce((s, id) => s + (SOURCES.find((x) => x._id === id)?.trust.score ?? 50), 0) /
          corroborating.length +
          (verification === "verified" ? 8 : verification === "under_review" ? -6 : -18) +
          (nSources - 1) * 5,
      ),
    );

    const lethal = type === "explosion" || type === "shooting";
    events.push({
      _id: `cand_${String(i + 1).padStart(5, "0")}`,
      source_id: corroborating[0],
      raw_record_id: `raw_${corroborating[0]}_${i + 1}`,
      time: { start: at, precision: "minute" },
      location: {
        province: province.name,
        provinceCode: province.code,
        district: district.nameTh,
        subdistrict: null,
        place: null,
        geo: { type: "Point", coordinates: geo },
        geo_precision: precision,
      },
      event: { type, title: pick(r, TITLE_BY_TYPE[type]), rawType: null },
      severity,
      verification,
      confidence,
      casualties: {
        killed: lethal && r() < 0.35 ? 1 + Math.floor(r() * 2) : 0,
        injured: lethal && r() < 0.55 ? 1 + Math.floor(r() * 4) : 0,
      },
      actors: [],
      targets: [],
      corroborating_sources: corroborating,
      media: [],
      attributes: {},
      unreported: [],
    });
  }

  return events.sort((a, b) => b.time.start.getTime() - a.time.start.getTime());
}

export function buildCitizenReports(): CitizenReportDoc[] {
  const r = rng(770412);
  const reports: CitizenReportDoc[] = [];
  const topics = [
    "เสียงปืนแถบกลางดึก",
    "กลุ่มติดอาวุธเคลื่อนไหว",
    "วัตถุต้องสงสัย",
    "ด่านตรวจแปลก",
    "ไฟไหม้ผิดปกติ",
    "รถต้องสงสัย",
  ];
  const channels: CitizenReportDoc["channel"][] = ["citizen", "local_news", "social", "network"];
  // Channel mix matches the stacked-bar breakdown: 44 / 25 / 19 / 12.
  const channelWeights = [44, 25, 19, 12];

  // 60 days so the 30-day panel can compare itself against the window before it.
  for (let d = 59; d >= 0; d--) {
    // A deliberate spike around day 4-5 before "today" — the anomaly the panel flags.
    const spike = d >= 4 && d <= 5 ? 2.35 : 1;
    // Gentle upward drift so the "แนวโน้มเพิ่มขึ้น" reading is real, not asserted.
    const base = 54 + (59 - d) * 0.32 + Math.sin((59 - d) / 3.1) * 12 + r() * 20;
    const count = Math.round(base * spike);

    for (let i = 0; i < count; i++) {
      let n = r() * 100;
      let channel = channels[0];
      for (let c = 0; c < channels.length; c++) {
        n -= channelWeights[c];
        if (n <= 0) {
          channel = channels[c];
          break;
        }
      }
      const province = weightedProvince(r);
      reports.push({
        _id: `cr_${d}_${i}`,
        reported_at: new Date(NOW.getTime() - d * 86400000 - Math.floor(r() * 86400000)),
        channel,
        provinceCode: province.code,
        // Real district names, so hotspot labels name places that exist.
        district: pick(r, districtsOfProvince(province.ddpmCode)).nameTh,
        topic: pick(r, topics),
        became_fact: r() < 0.24,
      });
    }
  }
  return reports;
}

export function buildIngestionRuns(): IngestionRunDoc[] {
  const r = rng(31337);
  return SOURCES.flatMap((s) =>
    Array.from({ length: 6 }, (_, i) => {
      const started = new Date(NOW.getTime() - i * 86400000 - 4 * 3600000);
      const downloaded = 40 + Math.floor(r() * 200);
      const fresh = Math.floor(downloaded * (0.04 + r() * 0.12));
      const updated = Math.floor(r() * 5);
      const failed = r() < 0.12 ? Math.floor(r() * 4) : 0;
      return {
        _id: `run_${s._id}_${i}`,
        source_id: s._id,
        started_at: started,
        finished_at: new Date(started.getTime() + 60_000 + Math.floor(r() * 120_000)),
        status: failed > 0 ? ("partial" as const) : ("success" as const),
        records: {
          downloaded,
          new: fresh,
          updated,
          duplicate: downloaded - fresh - updated - failed,
          failed,
        },
      };
    }),
  );
}

export function buildCases(): CaseDoc[] {
  return [
    {
      _id: "case_2024_0517",
      code: "CASE-TH-2024-0517",
      title: "คดีติดตามรายเป็น หน่วยเฉพาะกิจปะทะ",
      status: "investigating",
      occurred_at: new Date("2024-05-17T06:45:00+07:00"),
      location: "อ.บาเจาะ จ.ยะลา และ จ.นราธิวาส",
      event_type: "ความรุนแรง/ยิงปะทะ",
      severity: 5,
      risk_score: 82,
      summary:
        "เกิดเหตุปะทะระหว่างหน่วยปฏิบัติการพิเศษ จ.4104 กับกลุ่มติดอาวุธไม่ทราบฝ่ายบริเวณรอยต่อ จ.ยะลา ด้วยตำแหน่งของรถยนต์ที่ผู้ก่อเหตุใช้ ตรงกับที่พบในเหตุการณ์ก่อนหน้าเมื่อ 3 สัปดาห์ที่ผ่านมา ยังไม่ยืนยันความเชื่อมโยงกับเครือข่าย BRN ในพื้นที่",
      entities: { people: 12, groups: 3, vehicles: 1, phones: 5, places: 3, evidence: 3 },
      updates: [
        { at: new Date("2024-05-18T09:12:00+07:00"), text: "พบวัตถุต้องสงสัยเพิ่มเติมใกล้จุดเกิดเหตุ", tag: "urgent" },
        { at: new Date("2024-05-18T08:45:00+07:00"), text: "แจ้งเตือนพื้นที่เฝ้าระวัง ติดตั้งกล้องวงจรปิด CCTV", tag: "connected" },
        { at: new Date("2024-05-17T22:30:00+07:00"), text: "ปิดล้อมพื้นที่จุดเกิดเหตุเพิ่มเติม 2 ราย", tag: "new" },
      ],
    },
  ];
}

export function buildAll() {
  return {
    sources: SOURCES,
    events: buildEvents(),
    citizenReports: buildCitizenReports(),
    ingestionRuns: buildIngestionRuns(),
    cases: buildCases(),
  };
}
