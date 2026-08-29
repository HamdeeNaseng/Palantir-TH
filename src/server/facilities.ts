import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { COLLECTIONS, getDb } from "@/lib/mongodb";
import { PROVINCE_BY_DDPM } from "@/lib/geo";
import {
  FACILITY_KINDS,
  type Facility,
  type FacilityEdit,
  type FacilityKind,
  type FacilityStatus,
} from "@/lib/facilities";

/**
 * The response network, assembled from three layers that are never merged on
 * disk:
 *
 *   1. `public/data/south-facilities.geojson` — OpenStreetMap, via
 *      `scripts/fetch-facilities.ts`. Read-only here. Re-running the fetch
 *      replaces this file wholesale, which is safe precisely because nothing
 *      below is written into it.
 *   2. `facilities` in MongoDB — what an analyst added because OSM does not
 *      have it. Coverage of ศูนย์อพยพ and ศูนย์ช่วยเหลือ in particular is
 *      close to nil in the contributed data, so this is not an edge case.
 *   3. `facility_log` in MongoDB — append-only. Every open/closed change and
 *      every coordination call is an entry; the current status is simply the
 *      newest status entry. There is no update and no delete, so a wrong
 *      status is corrected by saying so, and the record of what was believed
 *      at the time survives — the same design `case_corrections` uses, and
 *      for the same reason: these writes are unauthenticated.
 *
 * A missing facility means "not mapped", never "not there". Every count this
 * module returns is a count of records, not of the world.
 */

const DATA_FILE = resolve(process.cwd(), "public/data/south-facilities.geojson");

interface FacilityFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    id: string;
    kind: string;
    name_th: string | null;
    name_en: string | null;
    phone: string | null;
    opening_hours: string | null;
    opened_on?: string | null;
    closed_on?: string | null;
    operator: string | null;
    subdistrict_th: string | null;
    district_code: string;
    district_th: string;
    province_code: string;
  };
}

/** A facility before any MongoDB overlay — what the two record sources agree on. */
type BaseFacility = Omit<
  Facility,
  | "status"
  | "statusNote"
  | "statusAtMs"
  | "statusBy"
  | "contactCount"
  | "lastContactAtMs"
  | "editedAtMs"
  | "editedBy"
>;

/** One entry in the append-only log. */
export interface FacilityLogEntry {
  id: string;
  facilityId: string;
  type: "status" | "contact" | "edit";
  /** Set on a status entry. */
  status: FacilityStatus | null;
  /** Set on a contact entry: how the desk reached them. */
  channel: string | null;
  /** Set on an edit entry: only the fields that actually changed. */
  changes: FacilityEdit | null;
  note: string | null;
  /** A claim about authorship, never a verified identity — see `case-corrections.ts`. */
  by: string | null;
  atMs: number;
}

export interface FacilityDoc {
  _id: string;
  kind: FacilityKind;
  name_th: string | null;
  name_en: string | null;
  lng: number;
  lat: number;
  district_code: string;
  district_th: string;
  subdistrict_th: string | null;
  province_code: string;
  phone: string | null;
  opening_hours: string | null;
  opened_on: string | null;
  closed_on: string | null;
  operator: string | null;
  added_by: string | null;
  added_at: Date;
}

export interface FacilityLogDoc {
  _id: string;
  facility_id: string;
  type: "status" | "contact" | "edit";
  status: FacilityStatus | null;
  channel: string | null;
  changes: FacilityEdit | null;
  note: string | null;
  by: string | null;
  at: Date;
}

const KINDS = new Set<string>(FACILITY_KINDS);

let cache: BaseFacility[] | null | undefined;

/**
 * The OSM layer, read once per process.
 *
 * `null` — never a throw — when the file is absent, exactly like
 * `loadRoadGraph`: a fresh clone that has not run `npm run gis:facilities`
 * still gets a working page, with the analyst-added facilities in it and a
 * notice saying the fetched layer is missing.
 */
export function loadOsmFacilities(): BaseFacility[] | null {
  if (cache !== undefined) return cache;
  try {
    const raw = JSON.parse(readFileSync(DATA_FILE, "utf8")) as { features: FacilityFeature[] };
    cache = raw.features.flatMap((f): BaseFacility[] => {
      if (!KINDS.has(f.properties.kind)) return [];
      const province = PROVINCE_BY_DDPM.get(f.properties.province_code);
      return [
        {
          id: f.properties.id,
          kind: f.properties.kind as FacilityKind,
          nameTh: f.properties.name_th,
          nameEn: f.properties.name_en,
          lng: f.geometry.coordinates[0],
          lat: f.geometry.coordinates[1],
          districtCode: f.properties.district_code,
          district: f.properties.district_th,
          subdistrict: f.properties.subdistrict_th,
          provinceCode: province?.code ?? f.properties.province_code,
          province: province?.name ?? f.properties.province_code,
          phone: f.properties.phone,
          openingHours: f.properties.opening_hours,
          openedOn: f.properties.opened_on ?? null,
          closedOn: f.properties.closed_on ?? null,
          operator: f.properties.operator,
          source: "osm",
        },
      ];
    });
  } catch {
    cache = null;
  }
  return cache;
}

function fromDoc(doc: FacilityDoc): BaseFacility {
  const province = PROVINCE_BY_DDPM.get(doc.province_code);
  return {
    id: doc._id,
    kind: doc.kind,
    nameTh: doc.name_th,
    nameEn: doc.name_en,
    lng: doc.lng,
    lat: doc.lat,
    districtCode: doc.district_code,
    district: doc.district_th,
    subdistrict: doc.subdistrict_th,
    provinceCode: province?.code ?? doc.province_code,
    province: province?.name ?? doc.province_code,
    phone: doc.phone,
    openingHours: doc.opening_hours,
    openedOn: doc.opened_on ?? null,
    closedOn: doc.closed_on ?? null,
    operator: doc.operator,
    source: "manual",
  };
}

export interface NetworkData {
  facilities: Facility[];
  /** True when MongoDB answered — the overlay is trustworthy rather than absent. */
  live: boolean;
  /** False when the fetched layer has never been produced on this machine. */
  osmLayerPresent: boolean;
  counts: { total: number; osm: number; manual: number; byKind: Record<FacilityKind, number> };
}

/**
 * Every facility with its overlay applied, ready to render.
 *
 * The log is read in one pass and folded per facility rather than queried per
 * row: 217 facilities would otherwise be 217 round trips for a page that is
 * mostly a list.
 */
export async function getNetwork(): Promise<NetworkData> {
  const osm = loadOsmFacilities();
  const base: BaseFacility[] = [...(osm ?? [])];

  const db = await getDb();
  let live = false;
  const statuses = new Map<string, FacilityLogDoc>();
  const contacts = new Map<string, { n: number; lastAt: number }>();
  const edits = new Map<string, FacilityLogDoc[]>();

  if (db) {
    live = true;
    const added = await db
      .collection<FacilityDoc>(COLLECTIONS.facilities)
      .find({})
      .sort({ added_at: -1 })
      .toArray();
    base.push(...added.map(fromDoc));

    // Newest first, so the first status entry seen for a facility is its
    // current one and everything after it is history.
    const log = await db
      .collection<FacilityLogDoc>(COLLECTIONS.facilityLog)
      .find({})
      .sort({ at: -1 })
      .toArray();
    for (const entry of log) {
      if (entry.type === "status") {
        if (!statuses.has(entry.facility_id)) statuses.set(entry.facility_id, entry);
      } else if (entry.type === "edit") {
        const list = edits.get(entry.facility_id);
        if (list) list.push(entry);
        else edits.set(entry.facility_id, [entry]);
      } else {
        const seen = contacts.get(entry.facility_id);
        const atMs = entry.at.getTime();
        if (seen) seen.n += 1;
        else contacts.set(entry.facility_id, { n: 1, lastAt: atMs });
      }
    }
  }

  const facilities: Facility[] = base.map((f) => {
    const status = statuses.get(f.id);
    const contact = contacts.get(f.id);
    const record = applyEdits(f, edits.get(f.id));
    return {
      ...record.facility,
      status: status?.status ?? "unknown",
      statusNote: status?.note ?? null,
      statusAtMs: status ? status.at.getTime() : null,
      statusBy: status?.by ?? null,
      contactCount: contact?.n ?? 0,
      lastContactAtMs: contact?.lastAt ?? null,
      editedAtMs: record.atMs,
      editedBy: record.by,
    };
  });

  // Kind, then province, then name: the list is read as "all the hospitals in
  // ปัตตานี", never as an arbitrary order.
  facilities.sort(
    (a, b) =>
      FACILITY_KINDS.indexOf(a.kind) - FACILITY_KINDS.indexOf(b.kind) ||
      a.province.localeCompare(b.province, "th") ||
      (a.nameTh ?? a.nameEn ?? "").localeCompare(b.nameTh ?? b.nameEn ?? "", "th"),
  );

  const byKind = Object.fromEntries(FACILITY_KINDS.map((k) => [k, 0])) as Record<
    FacilityKind,
    number
  >;
  for (const f of facilities) byKind[f.kind] += 1;

  return {
    facilities,
    live,
    osmLayerPresent: osm !== null,
    counts: {
      total: facilities.length,
      osm: facilities.filter((f) => f.source === "osm").length,
      manual: facilities.filter((f) => f.source === "manual").length,
      byKind,
    },
  };
}

/** DDPM code to this app's own province name, for a corrected position. */
function provinceName(ddpmCode: string): string {
  return PROVINCE_BY_DDPM.get(ddpmCode)?.name ?? ddpmCode;
}

/**
 * Replays analyst corrections over a fetched record.
 *
 * `entries` arrives newest-first (that is how the log is read), so it is
 * walked backwards: the oldest correction is applied first and a later one
 * that touches the same field wins. Fields nobody corrected keep whatever the
 * source published, which is why an OSM refresh can change a phone number
 * without discarding the name someone fixed by hand.
 *
 * A correction that moves the point carries the อำเภอ that point falls in —
 * `editFacility` resolves it against the DDPM polygons before writing, so the
 * administrative fields always follow the geometry rather than lagging behind
 * a position that has been replaced.
 */
function applyEdits(
  base: BaseFacility,
  entries: FacilityLogDoc[] | undefined,
): { facility: BaseFacility; atMs: number | null; by: string | null } {
  if (!entries?.length) return { facility: base, atMs: null, by: null };

  let facility = base;
  for (let i = entries.length - 1; i >= 0; i--) {
    const c = entries[i].changes;
    if (!c) continue;
    facility = {
      ...facility,
      kind: c.kind ?? facility.kind,
      nameTh: c.name ?? facility.nameTh,
      phone: c.phone !== undefined ? c.phone : facility.phone,
      openingHours: c.openingHours !== undefined ? c.openingHours : facility.openingHours,
      openedOn: c.openedOn !== undefined ? c.openedOn : facility.openedOn,
      closedOn: c.closedOn !== undefined ? c.closedOn : facility.closedOn,
      lng: c.lng ?? facility.lng,
      lat: c.lat ?? facility.lat,
      districtCode: c.area?.districtCode ?? facility.districtCode,
      district: c.area?.district ?? facility.district,
      subdistrict: c.area !== undefined ? c.area.subdistrict : facility.subdistrict,
      provinceCode: c.area ? (PROVINCE_BY_DDPM.get(c.area.provinceCode)?.code ?? c.area.provinceCode) : facility.provinceCode,
      province: c.area ? provinceName(c.area.provinceCode) : facility.province,
    };
  }
  const newest = entries[0];
  return { facility, atMs: newest.at.getTime(), by: newest.by };
}

/**
 * One facility, with the same overlay the list applies.
 *
 * Built from `getNetwork` rather than from a targeted query: the overlay is a
 * fold over the whole log, and having a second, subtly different assembly of
 * it is how a detail page starts disagreeing with the list it was opened
 * from.
 */
export async function getFacility(id: string): Promise<Facility | null> {
  const { facilities } = await getNetwork();
  return facilities.find((f) => f.id === id) ?? null;
}

/** The full log for one facility, newest first — what the detail panel shows. */
export async function getFacilityLog(facilityId: string): Promise<FacilityLogEntry[]> {
  const db = await getDb();
  if (!db) return [];
  const docs = await db
    .collection<FacilityLogDoc>(COLLECTIONS.facilityLog)
    .find({ facility_id: facilityId })
    .sort({ at: -1 })
    .limit(50)
    .toArray();
  return docs.map((d) => ({
    id: d._id,
    facilityId: d.facility_id,
    type: d.type,
    status: d.status,
    channel: d.channel,
    changes: d.changes ?? null,
    note: d.note,
    by: d.by,
    atMs: d.at.getTime(),
  }));
}
