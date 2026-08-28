"use client";

import { useActionState, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconLink,
  IconLoader2,
  IconMapPin,
  IconPlus,
  IconSend,
  IconX,
} from "@tabler/icons-react";
import { PROVINCES } from "@/lib/geo";
import { toInputDate } from "@/lib/datetime";
import {
  HONEYPOT_FIELD,
  PIN_FIELDS,
  REPORT_EVENT_GROUPS,
  REPORT_FORM_IDLE,
  REPORT_LIMITS,
  REPORT_MIN_DATE,
  type DistrictOption,
  type ReportFieldName,
  type ReportFormState,
} from "@/lib/report-form";
import { RECAPTCHA_ENABLED, RECAPTCHA_FIELD } from "@/lib/recaptcha";
import type { ProvinceCode } from "@/lib/types";
import { submitCitizenReport } from "@/server/report-intake";
import ReportLocationPicker, { type PickedPin } from "./ReportLocationPicker";
import { useRecaptcha } from "./useRecaptcha";

/**
 * The citizen intake form.
 *
 * Deliberately asks for no name, phone, or email — see the note in
 * `report-intake.ts` on why. Every field it does ask for maps straight onto
 * `event_candidates`, so nothing here is collected only to be discarded.
 *
 * Laid out phone-first, because a phone is where it is actually filled in.
 * Three things follow from that and are worth stating, since each costs
 * something on the desktop side of the same component:
 *
 *   1. **Four numbered sections, not one list of fourteen fields.** The
 *      sections are the citizen's own questions — what, when, where, and
 *      anything else — so someone who has never seen the form can tell how
 *      much of it is left without scrolling to the end. On a 390 px screen
 *      that is the difference between a form and a wall.
 *   2. **Only three of those sections are required, and the fourth is
 *      folded away.** จุดสังเกต, casualty counts and evidence links are all
 *      "ถ้าทราบ" — shown at equal weight they read as work to be done, and a
 *      report that is abandoned half-filled is worth nothing to anyone.
 *   3. **The submit button sticks to the bottom of the viewport.** The form
 *      is taller than a phone, so an inline button at the end is a button the
 *      citizen has to go looking for.
 *
 * The controls themselves are sized in `globals.css` (`.cz-field`, `.cz-btn`)
 * rather than here — see the note there on the 16 px and 48 px floors.
 */
export default function ReportForm({
  districtsByProvince,
  onSubmitted,
}: {
  districtsByProvince: Record<ProvinceCode, DistrictOption[]>;
  /** Fired when "ส่งรายงานอีกฉบับ" is clicked — a fresh form is wanted. */
  onSubmitted?: () => void;
}) {
  const executeRecaptcha = useRecaptcha();

  // A v3 token is good for about two minutes, so it is minted here — at the
  // moment of submit — rather than on render, where it would have gone stale
  // while the reporter was placing their pin. Wrapping the action rather than
  // rendering a hidden input is what makes that possible: `pending` then covers
  // the token round-trip too, so the button stays disabled for all of it.
  const [state, formAction, pending] = useActionState(
    async (prev: ReportFormState, formData: FormData) => {
      const token = await executeRecaptcha();
      if (token) formData.set(RECAPTCHA_FIELD, token);
      return submitCitizenReport(prev, formData);
    },
    REPORT_FORM_IDLE,
  );
  const [provinceCode, setProvinceCode] = useState<ProvinceCode | "">("");
  const [districtCode, setDistrictCode] = useState("");
  // A pin, once placed, is the location — the selects below step aside rather
  // than offer a second, contradictable answer to the same question.
  const [pin, setPin] = useState<PickedPin | null>(null);
  const [mediaCount, setMediaCount] = useState(1);
  const [extrasOpen, setExtrasOpen] = useState(false);
  const formId = useId();

  const districts = useMemo(
    () => (provinceCode ? districtsByProvince[provinceCode] : []),
    [provinceCode, districtsByProvince],
  );

  const fieldErrors = state.fieldErrors;
  const errorList = useMemo(
    () =>
      fieldErrors
        ? (Object.entries(fieldErrors) as [ReportFieldName, string][]).filter(([, m]) => !!m)
        : [],
    [fieldErrors],
  );

  /**
   * A rejected field inside the folded section would otherwise be invisible —
   * the citizen would be told the form failed with nothing on screen saying
   * why. Opening it is not optional, so this overrides the toggle rather than
   * seeding it.
   */
  const extrasHasError = errorList.some(([name]) => EXTRA_FIELDS.has(name));

  /**
   * Server errors land after a round trip, by which time the citizen may be
   * anywhere in a form taller than their screen. The summary takes focus so a
   * screen reader announces the failure and the viewport moves to it.
   */
  const summaryRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (state.status !== "error") return;
    summaryRef.current?.focus();
    summaryRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [state]);

  if (state.status === "success") {
    return (
      <div className="flex flex-col items-center gap-4 px-5 py-10 text-center sm:py-8">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[rgba(34,197,94,0.14)]">
          <IconCircleCheck size={32} stroke={1.5} className="text-mint" />
        </span>
        <p className="text-[17px] font-medium text-ink sm:text-[14px]">
          {state.message ?? "บันทึกรายงานเรียบร้อยแล้ว"}
        </p>
        <p className="max-w-md text-[13px] leading-relaxed text-ink-dim sm:text-[11.5px]">
          รายงานนี้ยังเป็นข้อมูลที่ &ldquo;อยู่ระหว่างตรวจสอบ&rdquo; ไม่ใช่ข้อเท็จจริงที่ยืนยันแล้ว
          — สามารถดูสิ่งที่ถูกบันทึกไว้ได้ที่ลิงก์ด้านล่าง
        </p>
        <div className="flex w-full max-w-sm flex-col gap-2 sm:w-auto sm:flex-row sm:justify-center">
          {state.caseId && (
            <Link
              href={`/cases/${encodeURIComponent(state.caseId)}?ref=${encodeURIComponent("/report")}`}
              className="cz-btn bg-[rgba(56,189,248,0.14)] text-azure hover:bg-[rgba(56,189,248,0.24)]"
            >
              ดูรายงานที่บันทึกไว้
            </Link>
          )}
          <button
            type="button"
            onClick={() => onSubmitted?.()}
            className="cz-btn border border-[rgba(56,100,150,0.6)] text-ink-dim hover:text-ink"
          >
            ส่งรายงานอีกฉบับ
          </button>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-5 p-4 sm:gap-4">
      {/* Honeypot: off-screen, unreachable by tab, invisible to a sighted user —
          a legitimate submitter has no way to notice or fill this in. */}
      <input
        type="text"
        name={HONEYPOT_FIELD}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute h-0 w-0 opacity-0"
      />

      {state.status === "error" && (
        <div
          ref={summaryRef}
          tabIndex={-1}
          role="alert"
          className="scroll-mt-4 rounded-lg border border-danger/45 bg-danger/10 px-3.5 py-3 outline-none"
        >
          <p className="flex items-center gap-2 text-[14px] font-medium text-danger sm:text-[12px]">
            <IconAlertTriangle size={16} stroke={1.9} className="shrink-0" />
            {state.message ?? "ยังส่งรายงานไม่ได้ — ตรวจสอบข้อมูลด้านล่าง"}
          </p>
          {errorList.length > 0 && (
            // Each error is a link to the field that produced it: on a phone
            // the offending input is usually a screen or two away.
            <ul className="mt-2 space-y-1">
              {errorList.map(([name, message]) => (
                <li key={name} className="text-[13px] leading-snug sm:text-[11.5px]">
                  <a
                    href={`#${fieldId(formId, name)}`}
                    className="text-danger underline underline-offset-2"
                    onClick={() => {
                      if (EXTRA_FIELDS.has(name)) setExtrasOpen(true);
                    }}
                  >
                    {FIELD_LABEL[name]}
                  </a>
                  <span className="text-ink-dim"> — {message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Section step={1} title="เกิดอะไรขึ้น">
        <Field
          label="ประเภทเหตุการณ์"
          htmlFor={fieldId(formId, "eventType")}
          error={fieldErrors?.eventType}
          required
        >
          <select
            id={fieldId(formId, "eventType")}
            name="eventType"
            required
            defaultValue=""
            aria-invalid={!!fieldErrors?.eventType}
            className="cz-field cz-select"
          >
            <option value="" disabled>
              เลือกประเภท
            </option>
            {REPORT_EVENT_GROUPS.map((g) => (
              <optgroup key={g.family} label={g.label}>
                {g.types.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>

        <Field
          label="หัวข้อสั้น ๆ"
          htmlFor={fieldId(formId, "title")}
          error={fieldErrors?.title}
          required
        >
          <input
            id={fieldId(formId, "title")}
            type="text"
            name="title"
            required
            maxLength={REPORT_LIMITS.title}
            enterKeyHint="next"
            autoComplete="off"
            placeholder="เช่น ได้ยินเสียงคล้ายระเบิดใกล้ตลาดสด"
            aria-invalid={!!fieldErrors?.title}
            className="cz-field"
          />
        </Field>

        <Field
          label="รายละเอียดเพิ่มเติม"
          optional
          htmlFor={fieldId(formId, "description")}
          error={fieldErrors?.description}
          hint="เห็นอะไร ได้ยินอะไร มีใครอยู่ตรงนั้นบ้าง — เท่าที่จำได้"
        >
          <textarea
            id={fieldId(formId, "description")}
            name="description"
            rows={4}
            maxLength={REPORT_LIMITS.description}
            aria-invalid={!!fieldErrors?.description}
            className="cz-field resize-y"
          />
        </Field>
      </Section>

      <Section step={2} title="เกิดขึ้นเมื่อไหร่">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-3">
          <Field
            label="วันที่เกิดเหตุ"
            htmlFor={fieldId(formId, "occurredDate")}
            error={fieldErrors?.occurredDate}
            required
          >
            <input
              id={fieldId(formId, "occurredDate")}
              type="date"
              name="occurredDate"
              required
              min={REPORT_MIN_DATE}
              // Bangkok-local "today", matching the server's validation exactly —
              // UTC's own date lags Bangkok by up to 7 hours, which would block
              // today's actual date for part of every evening otherwise.
              max={toInputDate(new Date())}
              aria-invalid={!!fieldErrors?.occurredDate}
              className="cz-field"
            />
          </Field>

          <Field
            label="เวลาโดยประมาณ"
            optional
            htmlFor={fieldId(formId, "occurredTime")}
            error={fieldErrors?.occurredTime}
          >
            <input
              id={fieldId(formId, "occurredTime")}
              type="time"
              name="occurredTime"
              aria-invalid={!!fieldErrors?.occurredTime}
              className="cz-field"
            />
          </Field>
        </div>
      </Section>

      <Section
        step={3}
        title="เกิดที่ไหน"
        hint="ปักหมุดถ้าทราบจุดที่แน่ชัด — ไม่ปักก็ส่งได้ โดยเลือกจังหวัดและอำเภอแทน"
      >
        <div id={fieldId(formId, "pin")} className="scroll-mt-4">
          <ReportLocationPicker onChange={setPin} />
          {fieldErrors?.pin && <FieldError message={fieldErrors.pin} />}
        </div>
        {pin && (
          <>
            <input type="hidden" name={PIN_FIELDS.lng} value={pin.lng} />
            <input type="hidden" name={PIN_FIELDS.lat} value={pin.lat} />
            <input type="hidden" name={PIN_FIELDS.source} value={pin.source} />
            {pin.accuracyM !== null && (
              <input type="hidden" name={PIN_FIELDS.accuracy} value={pin.accuracyM} />
            )}
          </>
        )}

        {pin ? (
          // Not a disabled `<select>`: those submit nothing, and a locked control
          // that still looks like a control invites the citizen to fight it. The
          // อำเภอ shown here is the one the server will re-derive from the pin.
          <div className="rounded-lg border border-[rgba(37,66,102,0.8)] bg-[#0a1524] px-3 py-2.5">
            <p className="flex items-center gap-2 text-[14px] text-ink sm:text-[12px]">
              <IconMapPin size={15} stroke={1.8} className="shrink-0 text-azure" />
              จ.{pin.provinceName} · อ.{pin.districtName}
              {pin.subdistrictName ? ` · ต.${pin.subdistrictName}` : ""}
            </p>
            <p className="cz-hint mt-1">อ่านจากหมุดบนแผนที่ — แก้ได้ด้วยการย้ายหมุด</p>
            <input type="hidden" name="provinceCode" value={pin.provinceCode} />
            <input type="hidden" name="districtCode" value={pin.districtCode} />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-3">
            <Field
              label="จังหวัด"
              htmlFor={fieldId(formId, "provinceCode")}
              error={fieldErrors?.provinceCode}
              required
            >
              <select
                id={fieldId(formId, "provinceCode")}
                name="provinceCode"
                required
                value={provinceCode}
                onChange={(e) => {
                  setProvinceCode(e.target.value as ProvinceCode);
                  setDistrictCode("");
                }}
                aria-invalid={!!fieldErrors?.provinceCode}
                className="cz-field cz-select"
              >
                <option value="" disabled>
                  เลือกจังหวัด
                </option>
                {PROVINCES.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              label="อำเภอ"
              htmlFor={fieldId(formId, "districtCode")}
              error={fieldErrors?.districtCode}
              required
            >
              <select
                id={fieldId(formId, "districtCode")}
                name="districtCode"
                required
                disabled={!provinceCode}
                value={districtCode}
                onChange={(e) => setDistrictCode(e.target.value)}
                aria-invalid={!!fieldErrors?.districtCode}
                className="cz-field cz-select"
              >
                <option value="" disabled>
                  {provinceCode ? "เลือกอำเภอ" : "เลือกจังหวัดก่อน"}
                </option>
                {districts.map((d) => (
                  <option key={d.code} value={d.code}>
                    {d.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}

        {/* ตำบล only when there is no pin: a pin has already answered it, and
            the server re-derives it from the polygons regardless of what is
            typed here, so a text box would only invite a contradiction. */}
        {!pin?.subdistrictName && (
          <Field
            label="ตำบล"
            optional
            htmlFor={fieldId(formId, "subdistrict")}
            error={fieldErrors?.subdistrict}
          >
            <input
              id={fieldId(formId, "subdistrict")}
              type="text"
              name="subdistrict"
              maxLength={REPORT_LIMITS.subdistrict}
              autoComplete="off"
              aria-invalid={!!fieldErrors?.subdistrict}
              className="cz-field"
            />
          </Field>
        )}
      </Section>

      {/* Everything below is optional. Folded away so the required part of the
          form reads as short — which it is — and opened on demand or whenever
          the server rejects something inside it. */}
      <details
        open={extrasOpen || extrasHasError}
        onToggle={(e) => setExtrasOpen(e.currentTarget.open)}
        className="rounded-lg border border-[rgba(37,66,102,0.55)] bg-[rgba(10,21,36,0.5)]"
      >
        <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-3.5 py-3 marker:hidden">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[rgba(56,189,248,0.12)] text-[11px] font-semibold text-azure">
            4
          </span>
          <span className="flex-1 text-[14.5px] font-medium text-ink sm:text-[12.5px]">
            รายละเอียดเพิ่มเติม
          </span>
          <span className="cz-hint">ไม่บังคับ</span>
        </summary>

        <div className="flex flex-col gap-4 border-t border-[rgba(37,66,102,0.45)] p-3.5 sm:gap-3">
          <Field
            label="จุดสังเกต/สถานที่"
            optional
            htmlFor={fieldId(formId, "place")}
            error={fieldErrors?.place}
            hint="เช่น หน้าโรงเรียน ปากซอย ริมถนนสายเก่า"
          >
            <input
              id={fieldId(formId, "place")}
              type="text"
              name="place"
              maxLength={REPORT_LIMITS.place}
              autoComplete="off"
              aria-invalid={!!fieldErrors?.place}
              className="cz-field"
            />
          </Field>

          <div className="grid grid-cols-2 gap-4 sm:gap-3">
            <Field
              label="ผู้เสียชีวิต"
              optional
              htmlFor={fieldId(formId, "killed")}
              error={fieldErrors?.killed}
            >
              <input
                id={fieldId(formId, "killed")}
                type="number"
                name="killed"
                min={0}
                max={REPORT_LIMITS.casualtyMax}
                inputMode="numeric"
                aria-invalid={!!fieldErrors?.killed}
                className="cz-field"
              />
            </Field>

            <Field
              label="ผู้บาดเจ็บ"
              optional
              htmlFor={fieldId(formId, "injured")}
              error={fieldErrors?.injured}
            >
              <input
                id={fieldId(formId, "injured")}
                type="number"
                name="injured"
                min={0}
                max={REPORT_LIMITS.casualtyMax}
                inputMode="numeric"
                aria-invalid={!!fieldErrors?.injured}
                className="cz-field"
              />
            </Field>
          </div>

          <div>
            <span className="cz-label" id={`${formId}-media-label`}>
              ลิงก์หลักฐาน{" "}
              <span className="font-normal text-ink-muted">(ภาพ วิดีโอ หรือโพสต์)</span>
            </span>
            <div className="flex flex-col gap-2">
              {Array.from({ length: mediaCount }, (_, i) => (
                <div key={i} className="relative">
                  <IconLink
                    size={15}
                    stroke={1.8}
                    className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-muted"
                  />
                  <input
                    id={i === 0 ? fieldId(formId, "mediaUrls") : undefined}
                    type="url"
                    name="mediaUrl"
                    inputMode="url"
                    placeholder="https://…"
                    aria-label={`ลิงก์หลักฐานที่ ${i + 1}`}
                    maxLength={REPORT_LIMITS.mediaUrlLength}
                    aria-invalid={i === 0 && !!fieldErrors?.mediaUrls}
                    className="cz-field pl-9"
                  />
                </div>
              ))}
            </div>
            {mediaCount < REPORT_LIMITS.mediaUrls && (
              <button
                type="button"
                onClick={() => setMediaCount((n) => Math.min(REPORT_LIMITS.mediaUrls, n + 1))}
                className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-[13px] text-azure sm:min-h-0 sm:text-[11px]"
              >
                <IconPlus size={14} stroke={2} />
                เพิ่มลิงก์
              </button>
            )}
            {fieldErrors?.mediaUrls && <FieldError message={fieldErrors.mediaUrls} />}
          </div>
        </div>
      </details>

      <p className="cz-hint">
        รายงานนี้จะถูกบันทึกในสถานะ &ldquo;อยู่ระหว่างตรวจสอบ&rdquo; และแสดงในตารางด้านล่างทันที
        ไม่มีการเก็บชื่อ เบอร์โทร หรืออีเมลของผู้แจ้ง
      </p>

      {/*
        Sticky rather than inline: the form is several screens tall on a phone,
        and the submit button is the one control that must never require
        hunting for. It leaves the flow at `sm`, where the whole form is
        visible at once and a bar pinned over the console would only cover it.
      */}
      <div className="sticky bottom-0 -mx-4 -mb-4 border-t border-[rgba(37,66,102,0.55)] bg-[rgba(6,13,25,0.94)] px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-sm sm:static sm:mx-0 sm:mb-0 sm:bg-transparent sm:px-0 sm:pb-0 sm:backdrop-blur-none">
        <button
          type="submit"
          disabled={pending}
          className="cz-btn w-full bg-[#1d4ed8] text-white hover:bg-[#2563eb] sm:ml-auto sm:w-auto sm:flex"
        >
          {pending ? (
            <IconLoader2 size={16} stroke={2} className="animate-spin" />
          ) : (
            <IconSend size={16} stroke={1.8} />
          )}
          ส่งรายงาน
        </button>
        {/* The floating reCAPTCHA badge is hidden in globals.css because it
            would sit on top of the map picker. Google permits that only if
            this notice is shown instead, so the two must stay together. */}
        {RECAPTCHA_ENABLED && (
          <p className="cz-hint mt-2 text-center sm:text-right">
            หน้านี้ได้รับการป้องกันโดย reCAPTCHA และอยู่ภายใต้{" "}
            <a
              href="https://policies.google.com/privacy"
              target="_blank"
              rel="noreferrer"
              className="text-ink-dim underline underline-offset-2 hover:text-ink"
            >
              นโยบายความเป็นส่วนตัว
            </a>{" "}
            และ{" "}
            <a
              href="https://policies.google.com/terms"
              target="_blank"
              rel="noreferrer"
              className="text-ink-dim underline underline-offset-2 hover:text-ink"
            >
              ข้อกำหนดในการให้บริการ
            </a>
            ของ Google
          </p>
        )}
      </div>
    </form>
  );
}

/** Which fields live inside the folded section — see `extrasHasError`. */
const EXTRA_FIELDS = new Set<ReportFieldName>(["place", "killed", "injured", "mediaUrls"]);

/** Names the error summary uses. Kept short: they are links, not sentences. */
const FIELD_LABEL: Record<ReportFieldName, string> = {
  eventType: "ประเภทเหตุการณ์",
  title: "หัวข้อ",
  description: "รายละเอียด",
  occurredDate: "วันที่เกิดเหตุ",
  occurredTime: "เวลา",
  provinceCode: "จังหวัด",
  districtCode: "อำเภอ",
  subdistrict: "ตำบล",
  place: "จุดสังเกต/สถานที่",
  killed: "ผู้เสียชีวิต",
  injured: "ผู้บาดเจ็บ",
  mediaUrls: "ลิงก์หลักฐาน",
  pin: "ตำแหน่งบนแผนที่",
};

/**
 * One id scheme for both the control and the summary link that jumps to it,
 * so the two can never drift apart.
 */
function fieldId(formId: string, name: ReportFieldName): string {
  return `${formId}-${name}`;
}

/**
 * A numbered step.
 *
 * The numbering is not decoration: these are the four questions the form asks,
 * in the order it asks them, and on a phone the number is the only cue for how
 * far through it the citizen is.
 */
function Section({
  step,
  title,
  hint,
  children,
}: {
  step: number;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-3 flex w-full items-center gap-2 sm:mb-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[rgba(56,189,248,0.12)] text-[11px] font-semibold text-azure">
          {step}
        </span>
        <span className="text-[14.5px] font-medium text-ink sm:text-[12.5px]">{title}</span>
      </legend>
      {hint && <p className="cz-hint mb-3 sm:mb-2">{hint}</p>}
      <div className="flex flex-col gap-4 sm:gap-3">{children}</div>
    </fieldset>
  );
}

function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  optional,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  required?: boolean;
  /** Says so in words rather than leaving "no asterisk" to carry the meaning. */
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={htmlFor} className="cz-label">
        {label}
        {required && <span className="text-danger"> *</span>}
        {optional && <span className="font-normal text-ink-muted"> · ถ้าทราบ</span>}
      </label>
      {hint && <p className="cz-hint mb-1.5 -mt-0.5">{hint}</p>}
      {children}
      {error && <FieldError message={error} />}
    </div>
  );
}

function FieldError({ message }: { message: string }) {
  return (
    <p className="mt-1.5 flex items-start gap-1.5 text-[12.5px] leading-snug text-danger sm:text-[10.5px]">
      <IconX size={13} stroke={2.5} className="mt-px shrink-0" />
      {message}
    </p>
  );
}
