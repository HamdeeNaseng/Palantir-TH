import {
  Ambulance,
  BadgeCheck,
  Building2,
  Cross,
  Flame,
  HeartHandshake,
  Hospital,
  ShieldAlert,
  Tent,
  type LucideIcon,
} from "lucide-react";

/**
 * The response network: who is on the ground, where, and how to reach them.
 *
 * Kept client-safe (no `node:fs`, no MongoDB) for the same reason `labels.ts`
 * is — the map, the list and the filter sidebar all need this vocabulary in
 * the browser, and the loader that reads the GeoJSON off disk must not travel
 * with it.
 */

export const FACILITY_KINDS = [
  "checkpoint",
  "military",
  "police",
  "rescue",
  "fire",
  "evacuation",
  "aid",
  "health",
  "hospital",
] as const;

export type FacilityKind = (typeof FACILITY_KINDS)[number];

export const FACILITY_LABEL: Record<FacilityKind, string> = {
  checkpoint: "ด่านตรวจ",
  military: "ค่ายทหาร",
  police: "สถานีตำรวจ",
  rescue: "สถานีกู้ภัย",
  fire: "สถานีดับเพลิง",
  evacuation: "ศูนย์อพยพ",
  aid: "ศูนย์ช่วยเหลือ",
  health: "อนามัย",
  hospital: "โรงพยาบาล",
};

/**
 * Colours follow the same rule as `EVENT_COLOR`: read the family first.
 * Security-side kinds sit in the blues, medical in green-teal, and the two
 * civil-relief kinds in amber — so a glance at the map separates "who keeps
 * order", "who treats people" and "who shelters them" before any label is
 * read.
 */
export const FACILITY_COLOR: Record<FacilityKind, string> = {
  checkpoint: "#38bdf8",
  military: "#3b82f6",
  police: "#6366f1",
  rescue: "#22d3ee",
  fire: "#f97316",
  evacuation: "#f59e0b",
  aid: "#eab308",
  health: "#22c55e",
  hospital: "#10b981",
};

export const FACILITY_ICON: Record<FacilityKind, LucideIcon> = {
  checkpoint: BadgeCheck,
  military: ShieldAlert,
  police: Building2,
  rescue: Ambulance,
  fire: Flame,
  evacuation: Tent,
  aid: HeartHandshake,
  health: Cross,
  hospital: Hospital,
};

/**
 * The national emergency line to call for this kind of facility.
 *
 * This is a *routing* answer, not a directory: it is the number that reaches
 * the service responsible for that kind of incident, which is what someone
 * coordinating needs when a facility publishes no direct line of its own (and
 * OSM publishes one for very few of them). A unit's own number, when the data
 * has it, is shown beside this one and never replaces it — a direct line can
 * ring out; 191 does not.
 */
export const EMERGENCY_LINE: Record<FacilityKind, { number: string; label: string }> = {
  checkpoint: { number: "191", label: "แจ้งเหตุด่วน–ตำรวจ" },
  military: { number: "191", label: "แจ้งเหตุด่วน–ตำรวจ" },
  police: { number: "191", label: "แจ้งเหตุด่วน–ตำรวจ" },
  fire: { number: "199", label: "แจ้งเหตุไฟไหม้–ดับเพลิง" },
  rescue: { number: "1669", label: "การแพทย์ฉุกเฉิน" },
  health: { number: "1669", label: "การแพทย์ฉุกเฉิน" },
  hospital: { number: "1669", label: "การแพทย์ฉุกเฉิน" },
  evacuation: { number: "1784", label: "สาธารณภัย–ปภ." },
  aid: { number: "1300", label: "ศูนย์ช่วยเหลือสังคม" },
};

/** Open, closed, or nobody has said — never a boolean. */
export type FacilityStatus = "open" | "closed" | "unknown";

export const FACILITY_STATUS_LABEL: Record<FacilityStatus, string> = {
  open: "เปิดทำการ",
  closed: "ปิด",
  unknown: "ไม่ทราบสถานะ",
};

export const FACILITY_STATUS_COLOR: Record<FacilityStatus, string> = {
  open: "#22c55e",
  closed: "#ef4444",
  unknown: "#64809f",
};

/** Where a facility record came from — displayed, never inferred. */
export type FacilitySource = "osm" | "manual";

/** One facility, as the page renders it: the record plus everything laid over it. */
export interface Facility {
  id: string;
  kind: FacilityKind;
  /** The Thai name where the source has one; otherwise null — never invented. */
  nameTh: string | null;
  nameEn: string | null;
  lng: number;
  lat: number;
  districtCode: string;
  district: string;
  subdistrict: string | null;
  provinceCode: string;
  province: string;
  /** The unit's own line, when the source publishes one. */
  phone: string | null;
  /** OSM `opening_hours`, verbatim — parsed by `isOpenNow`, never rewritten. */
  openingHours: string | null;
  /**
   * When the place began and stopped operating, `YYYY-MM-DD` or null.
   *
   * Day precision and nothing finer: these are administrative facts — a camp
   * was established, a shelter was stood down — and an hour on them would be
   * invented. Either may be null, and null means "not recorded", which is why
   * `stateOn` has a fourth answer instead of guessing.
   */
  openedOn: string | null;
  closedOn: string | null;
  operator: string | null;
  source: FacilitySource;
  /** The current status, from the newest status entry in the log. */
  status: FacilityStatus;
  statusNote: string | null;
  statusAtMs: number | null;
  statusBy: string | null;
  /** How many coordination entries the log holds for this facility. */
  contactCount: number;
  lastContactAtMs: number | null;
  /**
   * When an analyst last corrected the record itself.
   *
   * The OSM layer is never written to — a correction is an entry in
   * `facility_log` that is replayed over the fetched record on read, so
   * re-running the fetch keeps local knowledge instead of erasing it. This is
   * how the page can say "แก้ไขโดยเจ้าหน้าที่" beside a value that no longer
   * matches what OpenStreetMap publishes.
   */
  editedAtMs: number | null;
  editedBy: string | null;
}

/** The fields a correction may change — everything else is provenance. */
export interface FacilityEdit {
  name?: string;
  kind?: FacilityKind;
  phone?: string | null;
  openingHours?: string | null;
  openedOn?: string | null;
  closedOn?: string | null;
  lng?: number;
  lat?: number;
  /**
   * Where the moved point landed.
   *
   * Derived on the server from the new coordinate against the DDPM polygons —
   * never accepted from the form, and never sent without `lng`/`lat`. Without
   * it a corrected position would keep the อำเภอ of the position it replaced,
   * which is the one thing a wrong pin must not do quietly.
   */
  area?: {
    districtCode: string;
    district: string;
    subdistrict: string | null;
    provinceCode: string;
  };
}

/**
 * Whether a facility was in operation on a given day.
 *
 * `unknown` is a first-class answer, not a fallback. Only a handful of records
 * carry `start_date`, so a historical view that silently dropped everything
 * undated would show four hospitals in 2010 and read as a finding — when what
 * it actually means is "nobody has recorded when these opened". The page
 * therefore separates the three things it can say from the one it cannot.
 */
export type HistoricalState = "active" | "not_yet" | "ended" | "unknown";

export const HISTORICAL_STATE_LABEL: Record<HistoricalState, string> = {
  active: "เปิดดำเนินการแล้ว",
  not_yet: "ยังไม่ก่อตั้ง",
  ended: "ยกเลิกแล้ว",
  unknown: "ไม่ทราบช่วงเวลา",
};

/**
 * `onIso` is a plain `YYYY-MM-DD`, compared as a string — ISO dates sort
 * lexicographically, so this needs no parsing and no timezone, which is the
 * only way "was this open on 2 มี.ค. 2565" gives the same answer everywhere.
 */
export function stateOn(
  facility: Pick<Facility, "openedOn" | "closedOn">,
  onIso: string,
): HistoricalState {
  const { openedOn, closedOn } = facility;
  if (!openedOn && !closedOn) return "unknown";
  if (closedOn && onIso > closedOn) return "ended";
  if (openedOn && onIso < openedOn) return "not_yet";
  // Past its opening, or closed but not yet on that day: in operation. A
  // record with only an end date is treated as having always existed before
  // it, which is what "ยกเลิกเมื่อ" says and all it says.
  return "active";
}

/** How long it has been running, in whole years — only when the record says. */
export function yearsOfService(
  facility: Pick<Facility, "openedOn" | "closedOn">,
  nowMs: number,
): number | null {
  if (!facility.openedOn) return null;
  const from = Date.parse(`${facility.openedOn}T00:00:00+07:00`);
  const to = facility.closedOn ? Date.parse(`${facility.closedOn}T00:00:00+07:00`) : nowMs;
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return null;
  return Math.floor((to - from) / (365.25 * 86400000));
}

/** `2543-05-01` as Thai readers write it. Empty string for a missing date. */
export function thaiDate(iso: string | null): string {
  if (!iso) return "";
  const at = new Date(`${iso}T00:00:00+07:00`);
  if (Number.isNaN(at.getTime())) return iso;
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "long",
    calendar: "buddhist",
    timeZone: "Asia/Bangkok",
  }).format(at);
}

/** What a facility is called on screen when the source published no name. */
export function facilityName(f: Pick<Facility, "kind" | "nameTh" | "nameEn" | "district">): string {
  return f.nameTh ?? f.nameEn ?? `${FACILITY_LABEL[f.kind]} (ไม่ระบุชื่อ) อ.${f.district}`;
}

/**
 * Whether the published hours say this facility is open at `atMs`.
 *
 * A deliberately small reader for the subset of `opening_hours` that Thai
 * facilities actually use: `24/7`, and day-range plus time-range rules such as
 * `Mo-Fr 08:30-16:30; Sa 08:30-12:00`. Anything it does not understand returns
 * `null` — "the schedule does not say", which the UI must show as a shrug
 * rather than as "closed". Guessing here would put a shut door on the map at
 * the moment someone needs one open.
 */
export function scheduledOpen(openingHours: string | null, atMs: number): boolean | null {
  if (!openingHours) return null;
  const spec = openingHours.trim();
  if (!spec) return null;
  if (/^24\s*\/\s*7$/.test(spec)) return true;

  const at = new Date(atMs);
  // Bangkok, because the facility is in Bangkok time whatever the reader is in.
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const day = DAYS.indexOf(get("weekday"));
  if (day < 0) return null;
  const minutes = Number(get("hour")) * 60 + Number(get("minute"));

  let understood = false;
  for (const rule of spec.split(";")) {
    const match = /^\s*([A-Za-z,\-]*)\s*([0-9]{1,2}:[0-9]{2})\s*-\s*([0-9]{1,2}:[0-9]{2})\s*$/.exec(rule);
    if (!match) continue;
    const [, dayspec, from, to] = match;
    const days = parseDays(dayspec);
    if (!days) continue;
    understood = true;
    if (!days.includes(day)) continue;
    if (minutes >= toMinutes(from) && minutes < toMinutes(to)) return true;
  }
  return understood ? false : null;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const OSM_DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function parseDays(spec: string): number[] | null {
  const trimmed = spec.trim();
  // No day part means "every day", which is what `08:00-16:00` alone means.
  if (!trimmed) return [0, 1, 2, 3, 4, 5, 6];
  const out: number[] = [];
  for (const chunk of trimmed.split(",")) {
    const range = chunk.trim().split("-");
    const from = OSM_DAYS.indexOf(range[0]);
    if (from < 0) return null;
    if (range.length === 1) {
      out.push(from);
      continue;
    }
    const to = OSM_DAYS.indexOf(range[1]);
    if (to < 0) return null;
    for (let d = from; ; d = (d + 1) % 7) {
      out.push(d);
      if (d === to) break;
    }
  }
  return out;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
}
