"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { COLLECTIONS, getDb } from "@/lib/mongodb";
import { districtAt, subdistrictAt } from "@/lib/geography";
import { FACILITY_KINDS, type FacilityEdit } from "@/lib/facilities";
import {
  getFacility,
  loadOsmFacilities,
  type FacilityDoc,
  type FacilityLogDoc,
} from "@/server/facilities";

/**
 * Writing to the response network: a status change, a coordination entry, or a
 * facility OSM does not have.
 *
 * Append-only by construction, like `case-corrections.ts`. Marking a สถานีดับเพลิง
 * closed does not edit any record — it writes an entry saying so, and the
 * page reads the newest one. A mistake is corrected by writing the truth
 * after it, and what the desk believed at 03:00 is still readable at 09:00,
 * which is the property that makes this survivable without accounts.
 *
 * NOTE ON ACCESS: these actions are deliberately ungated, the same decision
 * (and the same mitigation) as the case corrections. `by` is therefore a claim
 * about authorship and is rendered as one — never as a verified identity.
 */

const NOTE_MAX = 500;
const BY_MAX = 80;
const NAME_MAX = 160;

/** Both writes name a facility; only an existing one can be written about. */
const statusSchema = z.object({
  facilityId: z.string().min(1).max(200),
  status: z.enum(["open", "closed", "unknown"]),
  note: z.string().max(NOTE_MAX).nullable(),
  by: z.string().max(BY_MAX).nullable(),
});

const contactSchema = z.object({
  facilityId: z.string().min(1).max(200),
  /** How the desk reached them — "โทร 191", "วิทยุ", "ลงพื้นที่". */
  channel: z.string().max(80).nullable(),
  note: z.string().max(NOTE_MAX).nullable(),
  by: z.string().max(BY_MAX).nullable(),
});

/**
 * `YYYY-MM-DD`, or empty for "not recorded".
 *
 * Bounded on both ends deliberately: 1782 is the founding of Bangkok and a
 * date before it is a typo rather than a fact about a police station, and a
 * date past 2100 is the same mistake in the other direction. The pair is
 * checked for order where both are given — a place cannot close before it
 * opened, and storing that would break every historical count built on it.
 */
const dateField = z
  .string()
  .trim()
  .regex(/^(\d{4}-\d{2}-\d{2})?$/, "รูปแบบวันที่ต้องเป็น ปปปป-ดด-วว (ค.ศ.)")
  .refine((v) => !v || (v >= "1782-01-01" && v <= "2100-12-31"), {
    message: "ปีต้องอยู่ระหว่าง ค.ศ. 1782–2100",
  })
  .transform((v) => v || null);

/** Neither date may sit after the other. */
function orderedDates(opened: string | null, closed: string | null): boolean {
  return !opened || !closed || opened <= closed;
}

const addSchema = z.object({
  kind: z.enum(FACILITY_KINDS),
  name: z.string().trim().min(1, "กรุณากรอกชื่อสถานที่").max(NAME_MAX),
  // The four provinces plus slack, matching the map's own bounds — a point
  // outside them is a mistake, and `districtAt` below is the real authority.
  lng: z.coerce.number().min(99).max(103),
  lat: z.coerce.number().min(5).max(9),
  phone: z.string().trim().max(60).nullable(),
  openingHours: z.string().trim().max(120).nullable(),
  openedOn: dateField,
  closedOn: dateField,
  by: z.string().max(BY_MAX).nullable(),
});

export type FacilityWriteResult = { ok: true; id: string } | { ok: false; error: string };

/** Every facility id the app knows — the OSM file plus what has been added. */
async function facilityExists(id: string): Promise<boolean> {
  if ((loadOsmFacilities() ?? []).some((f) => f.id === id)) return true;
  const db = await getDb();
  if (!db) return false;
  const doc = await db.collection<FacilityDoc>(COLLECTIONS.facilities).findOne({ _id: id });
  return doc !== null;
}

async function appendLog(entry: Omit<FacilityLogDoc, "_id" | "at">): Promise<FacilityWriteResult> {
  let db: Awaited<ReturnType<typeof getDb>>;
  try {
    db = await getDb();
  } catch {
    return { ok: false, error: "เชื่อมต่อฐานข้อมูลไม่ได้" };
  }

  if (!(await facilityExists(entry.facility_id))) {
    return { ok: false, error: "ไม่พบสถานที่นี้" };
  }

  const _id = `flog_${randomUUID().replace(/-/g, "")}`;
  await db.collection<FacilityLogDoc>(COLLECTIONS.facilityLog).insertOne({
    _id,
    ...entry,
    at: new Date(),
  });
  revalidatePath("/network");
  return { ok: true, id: _id };
}

/** "เปิด/ปิดอยู่ตอนนี้" — what the desk knows right now, not the published hours. */
export async function setFacilityStatus(input: unknown): Promise<FacilityWriteResult> {
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "ข้อมูลที่ส่งมาไม่ถูกต้อง" };
  const { facilityId, status, note, by } = parsed.data;
  return appendLog({
    facility_id: facilityId,
    type: "status",
    status,
    channel: null,
    changes: null,
    note: note?.trim() || null,
    by: by?.trim() || null,
  });
}

/** One coordination entry: who was called, through what, and what came back. */
export async function logFacilityContact(input: unknown): Promise<FacilityWriteResult> {
  const parsed = contactSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "ข้อมูลที่ส่งมาไม่ถูกต้อง" };
  const { facilityId, channel, note, by } = parsed.data;
  if (!note?.trim() && !channel?.trim()) {
    return { ok: false, error: "กรุณาบันทึกอย่างน้อยช่องทางหรือผลการติดต่อ" };
  }
  return appendLog({
    facility_id: facilityId,
    type: "contact",
    status: null,
    channel: channel?.trim() || null,
    changes: null,
    note: note?.trim() || null,
    by: by?.trim() || null,
  });
}

const editSchema = z.object({
  facilityId: z.string().min(1).max(200),
  name: z.string().trim().min(1).max(NAME_MAX).optional(),
  kind: z.enum(FACILITY_KINDS).optional(),
  /** Empty string means "the source's value is wrong and there is none". */
  phone: z.string().trim().max(60).nullable().optional(),
  openingHours: z.string().trim().max(120).nullable().optional(),
  openedOn: dateField.optional(),
  closedOn: dateField.optional(),
  lng: z.coerce.number().min(99).max(103).optional(),
  lat: z.coerce.number().min(5).max(9).optional(),
  note: z.string().max(NOTE_MAX).nullable(),
  by: z.string().max(BY_MAX).nullable(),
});

/**
 * Correcting a facility record.
 *
 * Never an update. The OSM layer is a file that `npm run gis:facilities`
 * replaces wholesale, and an analyst-added facility is a document someone
 * else may be reading — so a correction is an entry saying what changed, and
 * `applyEdits` replays it on read. Two things fall out of that and both are
 * wanted: re-fetching OSM keeps every local fix, and the history of what the
 * record used to say is still on the page.
 *
 * Only fields that actually differ are written. An "edit" that changes nothing
 * would otherwise sit in the log looking like a correction nobody can find.
 */
export async function editFacility(input: unknown): Promise<FacilityWriteResult> {
  const parsed = editSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลที่ส่งมาไม่ถูกต้อง" };
  }
  const { facilityId, note, by, ...fields } = parsed.data;

  const current = await getFacility(facilityId);
  if (!current) return { ok: false, error: "ไม่พบสถานที่นี้" };

  // Moving the point re-decides which อำเภอ this is in, so it is checked
  // against the polygons here rather than trusted from the form.
  const movedLng = fields.lng ?? current.lng;
  const movedLat = fields.lat ?? current.lat;
  if (fields.lng !== undefined || fields.lat !== undefined) {
    if (!districtAt([movedLng, movedLat])) {
      return { ok: false, error: "จุดที่เลือกอยู่นอกพื้นที่ 4 จังหวัด" };
    }
  }

  const changes: FacilityEdit = {};
  if (fields.name !== undefined && fields.name !== current.nameTh) changes.name = fields.name;
  if (fields.kind !== undefined && fields.kind !== current.kind) changes.kind = fields.kind;
  if (fields.phone !== undefined && (fields.phone || null) !== current.phone) {
    changes.phone = fields.phone || null;
  }
  if (
    fields.openingHours !== undefined &&
    (fields.openingHours || null) !== current.openingHours
  ) {
    changes.openingHours = fields.openingHours || null;
  }
  if (fields.openedOn !== undefined && fields.openedOn !== current.openedOn) {
    changes.openedOn = fields.openedOn;
  }
  if (fields.closedOn !== undefined && fields.closedOn !== current.closedOn) {
    changes.closedOn = fields.closedOn;
  }
  // Checked against the record as it will be, not as it was: changing only one
  // of the pair still has to leave a range that runs forwards.
  if (
    !orderedDates(
      changes.openedOn !== undefined ? changes.openedOn : current.openedOn,
      changes.closedOn !== undefined ? changes.closedOn : current.closedOn,
    )
  ) {
    return { ok: false, error: "วันที่เริ่มทำการต้องไม่หลังวันที่ยกเลิก" };
  }
  if (fields.lng !== undefined && fields.lng !== current.lng) changes.lng = fields.lng;
  if (fields.lat !== undefined && fields.lat !== current.lat) changes.lat = fields.lat;
  if (changes.lng !== undefined || changes.lat !== undefined) {
    // The moved point decides its own อำเภอ — see `FacilityEdit.area`.
    const district = districtAt([movedLng, movedLat]);
    if (!district) return { ok: false, error: "จุดที่เลือกอยู่นอกพื้นที่ 4 จังหวัด" };
    changes.area = {
      districtCode: district.code,
      district: district.nameTh,
      subdistrict: subdistrictAt([movedLng, movedLat])?.nameTh ?? null,
      provinceCode: district.provinceCode,
    };
  }

  if (Object.keys(changes).length === 0) {
    return { ok: false, error: "ยังไม่มีอะไรเปลี่ยน" };
  }

  const result = await appendLog({
    facility_id: facilityId,
    type: "edit",
    status: null,
    channel: null,
    changes,
    note: note?.trim() || null,
    by: by?.trim() || null,
  });
  if (result.ok) revalidatePath(`/network/${encodeURIComponent(facilityId)}`);
  return result;
}

/**
 * A facility the fetched layer does not have.
 *
 * The district is resolved from the point against the DDPM polygons rather
 * than asked for: the same join every other layer uses, and it is also the
 * check that the point is inside the four provinces at all.
 */
export async function addFacility(input: unknown): Promise<FacilityWriteResult> {
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลที่ส่งมาไม่ถูกต้อง" };
  }
  const { kind, name, lng, lat, phone, openingHours, openedOn, closedOn, by } = parsed.data;
  if (!orderedDates(openedOn, closedOn)) {
    return { ok: false, error: "วันที่เริ่มทำการต้องไม่หลังวันที่ยกเลิก" };
  }

  const district = districtAt([lng, lat]);
  if (!district) return { ok: false, error: "จุดที่เลือกอยู่นอกพื้นที่ 4 จังหวัด" };
  const subdistrict = subdistrictAt([lng, lat]);

  let db: Awaited<ReturnType<typeof getDb>>;
  try {
    db = await getDb();
  } catch {
    return { ok: false, error: "เชื่อมต่อฐานข้อมูลไม่ได้" };
  }

  const _id = `fac_${randomUUID().replace(/-/g, "")}`;
  await db.collection<FacilityDoc>(COLLECTIONS.facilities).insertOne({
    _id,
    kind,
    name_th: name,
    name_en: null,
    lng,
    lat,
    district_code: district.code,
    district_th: district.nameTh,
    subdistrict_th: subdistrict?.nameTh ?? null,
    province_code: district.provinceCode,
    phone: phone?.trim() || null,
    opening_hours: openingHours?.trim() || null,
    opened_on: openedOn,
    closed_on: closedOn,
    operator: null,
    added_by: by?.trim() || null,
    added_at: new Date(),
  });
  revalidatePath("/network");
  return { ok: true, id: _id };
}
