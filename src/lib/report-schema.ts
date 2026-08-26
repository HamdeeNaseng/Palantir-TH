import { z } from "zod";
import { EVENT_TYPES } from "./types";
import {
  HONEYPOT_FIELD,
  isInServiceArea,
  PIN_FIELDS,
  REPORT_LIMITS,
  REPORT_MIN_DATE,
  REPORT_PIN,
  snapToPinGrid,
  type ReportFieldName,
} from "./report-form";

/**
 * The shape of a citizen report, as submitted.
 *
 * Deliberately separate from `report-intake.ts`: this file knows what a
 * well-formed submission looks like, and the server action knows what is true
 * about the world. The division is not cosmetic — "is this an ISO date" is a
 * question about the string, while "is อ.เมืองปัตตานี really in ปัตตานี" is a
 * question about DDPM's polygons, which only the server can answer because
 * only the server can read them off disk. Trying to express the second kind
 * here would drag `node:fs` into anything that imports this.
 *
 * Also separate from `report-form.ts`, which the browser bundle imports for
 * its limits and labels. Zod belongs to the validating side; there is no
 * reason to ship a parser to a form that submits to a server action.
 *
 * Two behaviours are preserved from the hand-written validator this replaces,
 * because both are deliberate rather than accidental:
 *
 *  - Over-long free text (ตำบล, สถานที่) is truncated, not rejected. It is
 *    context, and losing the tail of it is better than losing the report.
 *  - Evidence links that are empty, over-long, or past the count cap are
 *    dropped silently, while a link that is *present and not http(s)* is an
 *    error. Ignoring that one would quietly discard evidence the reporter
 *    believes they attached.
 */

export type FieldErrors = Partial<Record<ReportFieldName, string>>;

const trimmed = z.string().trim();

/** Today in Bangkok — the server's own clock may be hours behind or ahead. */
function bangkokToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
}

/** Empty means "not reported" — never coerced to zero. */
const optionalCount = trimmed
  .transform((v) => (v === "" ? null : Number(v)))
  .refine(
    (v) => v === null || (Number.isInteger(v) && v >= 0 && v <= REPORT_LIMITS.casualtyMax),
    { message: `กรอกเป็นจำนวนเต็ม 0–${REPORT_LIMITS.casualtyMax}` },
  );

/** `http(s)` only — an `<a href>` on the case page would otherwise execute it. */
const evidenceUrl = trimmed.transform((raw, ctx) => {
  try {
    const url = new URL(raw);
    if (url.protocol === "http:" || url.protocol === "https:") return url.toString();
  } catch {
    // fall through to the same message: from the reporter's side, an
    // unparseable link and a `javascript:` one are the same mistake.
  }
  ctx.addIssue({
    code: "custom",
    message: "ลิงก์หลักฐานต้องขึ้นต้นด้วย http:// หรือ https://",
  });
  return z.NEVER;
});

const pinSchema = z
  .object({
    lng: z.coerce.number().finite(),
    lat: z.coerce.number().finite(),
    /** Only a device fix carries an accuracy; a hand-placed pin has none. */
    accuracyM: trimmed
      .transform((v) => (v === "" ? null : Number(v)))
      .refine((v) => v === null || (Number.isFinite(v) && v >= 0), {
        message: "ค่าความคลาดเคลื่อนของ GPS ไม่ถูกต้อง",
      })
      .refine((v) => v === null || v <= REPORT_PIN.maxAccuracyM, {
        message:
          "สัญญาณ GPS คลาดเคลื่อนกว้างเกินกว่าจะระบุจุดได้ กรุณาแตะแผนที่เพื่อปักหมุดเอง",
      }),
    source: z.enum(["gps", "manual"]).catch("manual"),
  })
  // Snapping here, not only in the browser, is what makes the ~110 m privacy
  // grid a property of the system rather than of the UI. It is idempotent, so
  // re-snapping an already-snapped pin costs nothing.
  .transform((pin) => {
    const [lng, lat] = snapToPinGrid(pin.lng, pin.lat);
    return {
      lng,
      lat,
      accuracyM: pin.source === "gps" ? pin.accuracyM : null,
      source: pin.source,
    };
  })
  .refine((pin) => isInServiceArea(pin.lng, pin.lat), {
    message: "หมุดอยู่นอกพื้นที่ 4 จังหวัดที่ระบบนี้ครอบคลุม",
  });

export const reportSchema = z
  .object({
    eventType: z.enum(EVENT_TYPES, { message: "กรุณาเลือกประเภทเหตุการณ์" }),

    title: trimmed
      .min(1, "กรุณากรอกหัวข้อ")
      .max(REPORT_LIMITS.title, `ยาวเกิน ${REPORT_LIMITS.title} ตัวอักษร`),

    description: trimmed
      .max(REPORT_LIMITS.description, `ยาวเกิน ${REPORT_LIMITS.description} ตัวอักษร`)
      .transform((v) => v || null),

    occurredDate: trimmed
      .regex(/^\d{4}-\d{2}-\d{2}$/, "กรุณาระบุวันที่")
      .refine((v) => v <= bangkokToday(), { message: "วันที่เกิดเหตุต้องไม่ใช่อนาคต" })
      .refine((v) => v >= REPORT_MIN_DATE, { message: `ต้องไม่ก่อน ${REPORT_MIN_DATE}` }),

    occurredTime: trimmed.refine((v) => v === "" || /^\d{2}:\d{2}$/.test(v), {
      message: "รูปแบบเวลาไม่ถูกต้อง",
    }),

    // Format only. Whether this อำเภอ exists, and whether it belongs to that
    // จังหวัด, is settled in the server action against the real polygons.
    provinceCode: trimmed,
    districtCode: trimmed,

    subdistrict: trimmed.transform((v) => v.slice(0, REPORT_LIMITS.subdistrict) || null),
    place: trimmed.transform((v) => v.slice(0, REPORT_LIMITS.place) || null),

    killed: optionalCount,
    injured: optionalCount,

    mediaUrls: z
      .array(z.string())
      .transform((list) =>
        list
          .map((v) => v.trim())
          .filter((v) => v.length > 0 && v.length <= REPORT_LIMITS.mediaUrlLength)
          .slice(0, REPORT_LIMITS.mediaUrls),
      )
      .pipe(z.array(evidenceUrl)),

    pin: pinSchema.nullable(),
  })
  .superRefine((data, ctx) => {
    // A pin names its own อำเภอ, so the selects are only required without one.
    if (data.pin) return;
    if (!data.provinceCode) {
      ctx.addIssue({ code: "custom", path: ["provinceCode"], message: "กรุณาเลือกจังหวัด" });
    }
    if (!data.districtCode) {
      ctx.addIssue({
        code: "custom",
        path: ["districtCode"],
        message: "กรุณาเลือกอำเภอจากรายการ",
      });
    }
  });

export type ReportInput = z.infer<typeof reportSchema>;

/** Reads the submitted form into the shape the schema above expects. */
export function readReportForm(formData: FormData): unknown {
  const str = (key: string): string => {
    const v = formData.get(key);
    return typeof v === "string" ? v.trim() : "";
  };

  const lng = str(PIN_FIELDS.lng);
  const lat = str(PIN_FIELDS.lat);

  return {
    eventType: str("eventType"),
    title: str("title"),
    description: str("description"),
    occurredDate: str("occurredDate"),
    occurredTime: str("occurredTime"),
    provinceCode: str("provinceCode"),
    districtCode: str("districtCode"),
    subdistrict: str("subdistrict"),
    place: str("place"),
    killed: str("killed"),
    injured: str("injured"),
    mediaUrls: formData.getAll("mediaUrl").map((v) => (typeof v === "string" ? v : "")),
    // An empty pair means the citizen never touched the map; a half-filled one
    // is a broken submission and is reported as such by `pinSchema`.
    pin: lng === "" && lat === "" ? null : { lng, lat, accuracyM: str(PIN_FIELDS.accuracy), source: str(PIN_FIELDS.source) },
  };
}

/** True when a bot filled the field no citizen can see. */
export function isHoneypotFilled(formData: FormData): boolean {
  const v = formData.get(HONEYPOT_FIELD);
  return typeof v === "string" && v.trim() !== "";
}

/**
 * One message per field, which is what the form renders.
 *
 * The first issue on a path wins: a field with three things wrong still gets
 * one line under it, and showing the earliest one keeps the message stable as
 * the reporter fixes the others.
 */
export function toFieldErrors(error: z.ZodError): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key !== "string") continue;
    if (!(key in errors)) errors[key as ReportFieldName] = issue.message;
  }
  return errors;
}
