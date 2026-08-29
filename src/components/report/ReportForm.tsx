"use client";

import { useActionState, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconArrowRight,
  IconCheck,
  IconCircleCheck,
  IconLink,
  IconLoader2,
  IconMapPin,
  IconPencil,
  IconPlus,
  IconSend,
  IconX,
} from "@tabler/icons-react";
import { PROVINCES } from "@/lib/geo";
import { toInputDate } from "@/lib/datetime";
import { EVENT_ICON } from "@/lib/event-icons";
import { EVENT_COLOR } from "@/lib/palette";
import { EVENT_TYPE_LABEL } from "@/lib/labels";
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
import type { EventType, ProvinceCode } from "@/lib/types";
import { submitCitizenReport } from "@/server/report-intake";
import ReportLocationPicker, { type PickedPin } from "./ReportLocationPicker";
import { useRecaptcha } from "./useRecaptcha";

/**
 * The citizen intake form — one question per screen.
 *
 * Deliberately asks for no name, phone, or email — see the note in
 * `report-intake.ts` on why.
 *
 * This used to be four numbered sections on one long page. That is a good
 * form for someone who fills in forms; it is a wall for the person this page
 * actually exists for — a member of the public, on a phone, once, often
 * shaken, who has never met a `<select>` with seventeen options in it. So the
 * form now asks one thing at a time and says how far along it is, which is the
 * same reason government services are built this way: a short question with an
 * obvious next button is answerable by someone who would abandon a page of
 * fourteen fields.
 *
 * Four things follow from that and are worth stating, because each costs
 * something:
 *
 *   1. **Every step stays mounted, hidden rather than unmounted.** A wizard
 *      that rebuilds a step loses what was typed in it. The only exception is
 *      the map, which is mounted the first time its step is reached and kept
 *      afterwards — MapLibre cannot size a canvas inside a `display: none`
 *      box, and the boundary polygons are not worth fetching for a reporter
 *      who never gets that far.
 *   2. **No `required` attributes.** A `required` control inside a hidden step
 *      makes the browser block submit on a field it cannot scroll to ("not
 *      focusable"), with no message the reporter can act on. Each step
 *      validates itself in `stepErrors` instead, and the server — which is the
 *      only validation that counts — is unchanged.
 *   3. **Everything is controlled state.** It is what lets the review step
 *      read back what was entered, in the reporter's own words, before
 *      anything is sent.
 *   4. **A review step before submit.** The reporter sees the whole report on
 *      one screen with an แก้ไข link per answer. Nothing is filed by accident.
 *
 * The controls themselves are sized in `globals.css` (`.cz-field`, `.cz-btn`,
 * `.cz-card`, `.cz-chip`) — see the note there on the 16 px and 48 px floors.
 */

type StepId = "what" | "story" | "where" | "when" | "extra" | "review";

const STEPS: { id: StepId; title: string; hint?: string }[] = [
  { id: "what", title: "เกิดเรื่องอะไรขึ้น", hint: "เลือกข้อที่ใกล้เคียงที่สุด ไม่แน่ใจให้เลือก “อื่น ๆ”" },
  { id: "story", title: "เล่าให้ฟังสั้น ๆ", hint: "เขียนอย่างที่จะเล่าให้เพื่อนบ้านฟังก็พอ" },
  { id: "where", title: "เกิดที่ไหน", hint: "กดปุ่มใช้ตำแหน่งปัจจุบันได้เลย หรือเลือกจังหวัดกับอำเภอ" },
  { id: "when", title: "เกิดเมื่อไหร่" },
  { id: "extra", title: "มีอะไรบอกเพิ่มไหม", hint: "ข้อนี้ข้ามได้ ไม่กรอกก็ส่งรายงานได้" },
  { id: "review", title: "ตรวจทานก่อนส่ง" },
];

/** Which step owns each field — where a server error has to send the reporter. */
const FIELD_STEP: Record<ReportFieldName, StepId> = {
  eventType: "what",
  title: "story",
  description: "story",
  pin: "where",
  provinceCode: "where",
  districtCode: "where",
  subdistrict: "where",
  occurredDate: "when",
  occurredTime: "when",
  place: "extra",
  killed: "extra",
  injured: "extra",
  mediaUrls: "extra",
};

/** Names the error summary and the review list use. Kept short — they are labels. */
const FIELD_LABEL: Record<ReportFieldName, string> = {
  eventType: "ประเภทเหตุการณ์",
  title: "เรื่องที่เกิดขึ้น",
  description: "รายละเอียด",
  occurredDate: "วันที่เกิดเหตุ",
  occurredTime: "เวลา",
  provinceCode: "จังหวัด",
  districtCode: "อำเภอ",
  subdistrict: "ตำบล",
  place: "จุดสังเกต",
  killed: "ผู้เสียชีวิต",
  injured: "ผู้บาดเจ็บ",
  mediaUrls: "ลิงก์รูปหรือคลิป",
  pin: "ตำแหน่งบนแผนที่",
};

type FieldErrors = Partial<Record<ReportFieldName, string>>;

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

  const formId = useId();
  const [stepIndex, setStepIndex] = useState(0);
  const step = STEPS[stepIndex];

  const [eventType, setEventType] = useState<EventType | "">("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [occurredDate, setOccurredDate] = useState("");
  const [occurredTime, setOccurredTime] = useState("");
  const [provinceCode, setProvinceCode] = useState<ProvinceCode | "">("");
  const [districtCode, setDistrictCode] = useState("");
  const [subdistrict, setSubdistrict] = useState("");
  const [place, setPlace] = useState("");
  const [killed, setKilled] = useState("");
  const [injured, setInjured] = useState("");
  const [mediaUrls, setMediaUrls] = useState<string[]>([""]);
  // A pin, once placed, is the location — the selects below step aside rather
  // than offer a second, contradictable answer to the same question.
  const [pin, setPin] = useState<PickedPin | null>(null);
  const [clientErrors, setClientErrors] = useState<FieldErrors>({});

  const today = useMemo(() => toInputDate(new Date()), []);
  const yesterday = useMemo(() => toInputDate(new Date(Date.now() - 86_400_000)), []);

  /**
   * The map is expensive (three boundary files and a WebGL canvas) and cannot
   * lay itself out inside a hidden box, so it is created when its step is
   * first opened — and never destroyed afterwards, or the pin would vanish
   * every time the reporter stepped back to check something.
   */
  const [mapMounted, setMapMounted] = useState(false);
  useEffect(() => {
    if (step.id === "where") setMapMounted(true);
  }, [step.id]);

  const districts = useMemo(
    () => (provinceCode ? districtsByProvince[provinceCode] : []),
    [provinceCode, districtsByProvince],
  );

  const serverErrors = state.fieldErrors;
  const errors: FieldErrors = useMemo(
    () => ({ ...serverErrors, ...clientErrors }),
    [serverErrors, clientErrors],
  );

  /** What this step must have before "ถัดไป" means anything. */
  const stepErrors = useCallback(
    (id: StepId): FieldErrors => {
      switch (id) {
        case "what":
          return eventType ? {} : { eventType: "เลือกสักข้อก่อนนะ ถ้าไม่แน่ใจให้เลือก “อื่น ๆ”" };
        case "story":
          return title.trim()
            ? {}
            : { title: "บอกสั้น ๆ ว่าเกิดอะไรขึ้น เช่น “ได้ยินเสียงระเบิดใกล้ตลาด”" };
        case "where":
          if (pin) return {};
          if (!provinceCode) return { provinceCode: "เลือกจังหวัด หรือกดใช้ตำแหน่งปัจจุบัน" };
          if (!districtCode) return { districtCode: "เลือกอำเภอด้วย" };
          return {};
        case "when":
          if (!occurredDate) return { occurredDate: "เลือกวันที่เกิดเหตุ" };
          if (occurredDate > today) return { occurredDate: "วันที่เกิดเหตุต้องไม่ใช่อนาคต" };
          if (occurredDate < REPORT_MIN_DATE) {
            return { occurredDate: `ต้องไม่ก่อน ${REPORT_MIN_DATE}` };
          }
          return {};
        default:
          return {};
      }
    },
    [eventType, title, pin, provinceCode, districtCode, occurredDate, today],
  );

  /**
   * The step heading takes focus on every move.
   *
   * Nothing else tells a screen-reader user that the page changed — the URL
   * does not move and the surrounding page is identical — and a sighted
   * reporter on a phone would otherwise land mid-way down the previous
   * scroll position.
   */
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const movedRef = useRef(false);
  useEffect(() => {
    if (!movedRef.current) return;
    headingRef.current?.focus();
    headingRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [stepIndex]);

  const goTo = useCallback((index: number) => {
    movedRef.current = true;
    setStepIndex(index);
  }, []);

  const goToField = useCallback(
    (name: ReportFieldName) => {
      const target = STEPS.findIndex((s) => s.id === FIELD_STEP[name]);
      if (target >= 0) goTo(target);
      // After the step is on screen: the control, not the heading.
      window.setTimeout(() => {
        document.getElementById(fieldId(formId, name))?.focus({ preventScroll: false });
      }, 60);
    },
    [formId, goTo],
  );

  function next() {
    const found = stepErrors(step.id);
    setClientErrors(found);
    const first = Object.keys(found)[0] as ReportFieldName | undefined;
    if (first) {
      document.getElementById(fieldId(formId, first))?.focus();
      return;
    }
    goTo(Math.min(STEPS.length - 1, stepIndex + 1));
  }

  /**
   * A server rejection lands after a round trip, from the review step. Send
   * the reporter to the step that owns the first rejected field rather than
   * leaving them looking at a summary of somewhere else.
   */
  useEffect(() => {
    if (state.status !== "error") return;
    const first = Object.keys(state.fieldErrors ?? {})[0] as ReportFieldName | undefined;
    if (!first) return;
    setClientErrors({});
    goToField(first);
  }, [state, goToField]);

  if (state.status === "success") {
    return (
      <div className="flex flex-col items-center gap-4 px-5 py-10 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[rgba(34,197,94,0.14)]">
          <IconCircleCheck size={36} stroke={1.5} className="text-mint" />
        </span>
        <p className="text-[19px] font-medium text-ink">
          {state.message ?? "ส่งรายงานเรียบร้อยแล้ว ขอบคุณมาก"}
        </p>
        <p className="max-w-md text-[15px] leading-relaxed text-ink-dim">
          เจ้าหน้าที่จะตรวจสอบต่อไป ระหว่างนี้รายงานจะขึ้นสถานะว่า
          &ldquo;อยู่ระหว่างตรวจสอบ&rdquo; ยังไม่ใช่ข้อเท็จจริงที่ยืนยันแล้ว
        </p>
        <div className="flex w-full max-w-sm flex-col gap-2.5 sm:w-auto sm:flex-row sm:justify-center">
          {state.caseId && (
            <Link
              href={`/cases/${encodeURIComponent(state.caseId)}?ref=${encodeURIComponent("/report")}`}
              className="cz-btn bg-[rgba(56,189,248,0.14)] text-azure hover:bg-[rgba(56,189,248,0.24)]"
            >
              ดูรายงานที่ส่งไป
            </Link>
          )}
          <button
            type="button"
            onClick={() => onSubmitted?.()}
            className="cz-btn border border-[rgba(56,100,150,0.6)] text-ink-dim hover:text-ink"
          >
            แจ้งอีกเรื่อง
          </button>
        </div>
      </div>
    );
  }

  const onReview = step.id === "review";

  return (
    <form
      action={formAction}
      // Enter inside a text box means "next question", not "file the report" —
      // the only way to submit is the button on the review step.
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        const el = e.target as HTMLElement;
        if (el.tagName === "TEXTAREA" || el.tagName === "BUTTON") return;
        if (onReview) return;
        e.preventDefault();
        next();
      }}
      className="flex flex-col"
    >
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

      <Progress index={stepIndex} />

      <div className="flex flex-col gap-5 px-4 py-5 sm:px-5">
        <div>
          <h3
            ref={headingRef}
            tabIndex={-1}
            className="text-[21px] leading-snug font-semibold text-ink outline-none sm:text-[19px]"
          >
            {step.title}
          </h3>
          {step.hint && <p className="cz-hint mt-1.5">{step.hint}</p>}
        </div>

        {/* ── 1. What happened ─────────────────────────────────────────── */}
        <Step hidden={step.id !== "what"}>
          <fieldset>
            <legend className="sr-only">ประเภทเหตุการณ์</legend>
            <div id={fieldId(formId, "eventType")} tabIndex={-1} className="flex flex-col gap-4 outline-none">
              {REPORT_EVENT_GROUPS.map((group) => (
                <div key={group.family}>
                  <p className="cz-label">{group.label}</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {group.types.map((t) => (
                      <TypeCard
                        key={t.value}
                        value={t.value}
                        label={t.label}
                        checked={eventType === t.value}
                        onChange={() => {
                          setEventType(t.value);
                          setClientErrors(({ eventType: _drop, ...rest }) => rest);
                        }}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </fieldset>
          {errors.eventType && <FieldError message={errors.eventType} />}
        </Step>

        {/* ── 2. In their own words ────────────────────────────────────── */}
        <Step hidden={step.id !== "story"}>
          <Field
            label="เกิดอะไรขึ้น"
            htmlFor={fieldId(formId, "title")}
            error={errors.title}
            required
            hint="ประโยคเดียวก็พอ"
          >
            <input
              id={fieldId(formId, "title")}
              type="text"
              name="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={REPORT_LIMITS.title}
              enterKeyHint="next"
              autoComplete="off"
              placeholder="เช่น ได้ยินเสียงคล้ายระเบิดใกล้ตลาดสด"
              aria-invalid={!!errors.title}
              className="cz-field"
            />
          </Field>

          <Field
            label="เล่าเพิ่มเติม"
            optional
            htmlFor={fieldId(formId, "description")}
            error={errors.description}
            hint="เห็นอะไร ได้ยินอะไร มีใครอยู่ตรงนั้นบ้าง — เท่าที่จำได้"
          >
            <textarea
              id={fieldId(formId, "description")}
              name="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              maxLength={REPORT_LIMITS.description}
              aria-invalid={!!errors.description}
              className="cz-field resize-y"
            />
          </Field>
        </Step>

        {/* ── 3. Where ─────────────────────────────────────────────────── */}
        <Step hidden={step.id !== "where"}>
          <div id={fieldId(formId, "pin")} tabIndex={-1} className="scroll-mt-4 outline-none">
            {mapMounted && <ReportLocationPicker onChange={setPin} />}
            {errors.pin && <FieldError message={errors.pin} />}
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
            <div className="rounded-lg border border-[rgba(37,66,102,0.8)] bg-[#0a1524] px-3.5 py-3">
              <p className="flex items-center gap-2 text-[15px] text-ink">
                <IconMapPin size={16} stroke={1.8} className="shrink-0 text-azure" />
                จ.{pin.provinceName} · อ.{pin.districtName}
                {pin.subdistrictName ? ` · ต.${pin.subdistrictName}` : ""}
              </p>
              <p className="cz-hint mt-1">อ่านจากหมุดบนแผนที่ — ถ้าผิด ย้ายหมุดได้เลย</p>
              <input type="hidden" name="provinceCode" value={pin.provinceCode} />
              <input type="hidden" name="districtCode" value={pin.districtCode} />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label="จังหวัด"
                htmlFor={fieldId(formId, "provinceCode")}
                error={errors.provinceCode}
                required
              >
                <select
                  id={fieldId(formId, "provinceCode")}
                  name="provinceCode"
                  value={provinceCode}
                  onChange={(e) => {
                    setProvinceCode(e.target.value as ProvinceCode);
                    setDistrictCode("");
                  }}
                  aria-invalid={!!errors.provinceCode}
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
                error={errors.districtCode}
                required
              >
                <select
                  id={fieldId(formId, "districtCode")}
                  name="districtCode"
                  disabled={!provinceCode}
                  value={districtCode}
                  onChange={(e) => setDistrictCode(e.target.value)}
                  aria-invalid={!!errors.districtCode}
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
              error={errors.subdistrict}
            >
              <input
                id={fieldId(formId, "subdistrict")}
                type="text"
                name="subdistrict"
                value={subdistrict}
                onChange={(e) => setSubdistrict(e.target.value)}
                maxLength={REPORT_LIMITS.subdistrict}
                autoComplete="off"
                aria-invalid={!!errors.subdistrict}
                className="cz-field"
              />
            </Field>
          )}
        </Step>

        {/* ── 4. When ──────────────────────────────────────────────────── */}
        <Step hidden={step.id !== "when"}>
          <div>
            <p className="cz-label">วันที่เกิดเหตุ *</p>
            {/* Almost every report is about today or yesterday, and a date
                picker is the single hardest control on this form for someone
                who does not use one often. Two buttons answer it for most
                people; the calendar stays for everyone else. */}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                aria-pressed={occurredDate === today}
                onClick={() => {
                  setOccurredDate(today);
                  setClientErrors(({ occurredDate: _drop, ...rest }) => rest);
                }}
                className="cz-chip"
              >
                วันนี้
              </button>
              <button
                type="button"
                aria-pressed={occurredDate === yesterday}
                onClick={() => {
                  setOccurredDate(yesterday);
                  setClientErrors(({ occurredDate: _drop, ...rest }) => rest);
                }}
                className="cz-chip"
              >
                เมื่อวาน
              </button>
            </div>

            <label htmlFor={fieldId(formId, "occurredDate")} className="cz-label mt-4">
              หรือเลือกวันเอง
            </label>
            <input
              id={fieldId(formId, "occurredDate")}
              type="date"
              name="occurredDate"
              value={occurredDate}
              onChange={(e) => setOccurredDate(e.target.value)}
              min={REPORT_MIN_DATE}
              // Bangkok-local "today", matching the server's validation exactly —
              // UTC's own date lags Bangkok by up to 7 hours, which would block
              // today's actual date for part of every evening otherwise.
              max={today}
              aria-invalid={!!errors.occurredDate}
              className="cz-field"
            />
            {errors.occurredDate && <FieldError message={errors.occurredDate} />}
          </div>

          <Field
            label="เวลาโดยประมาณ"
            optional
            htmlFor={fieldId(formId, "occurredTime")}
            error={errors.occurredTime}
            hint="จำไม่ได้ก็ไม่ต้องกรอก ระบบจะบันทึกเป็นทั้งวัน"
          >
            <input
              id={fieldId(formId, "occurredTime")}
              type="time"
              name="occurredTime"
              value={occurredTime}
              onChange={(e) => setOccurredTime(e.target.value)}
              aria-invalid={!!errors.occurredTime}
              className="cz-field"
            />
          </Field>
        </Step>

        {/* ── 5. Anything else (all optional) ──────────────────────────── */}
        <Step hidden={step.id !== "extra"}>
          <Field
            label="จุดสังเกตใกล้ ๆ"
            optional
            htmlFor={fieldId(formId, "place")}
            error={errors.place}
            hint="เช่น หน้าโรงเรียน ปากซอย ริมถนนสายเก่า"
          >
            <input
              id={fieldId(formId, "place")}
              type="text"
              name="place"
              value={place}
              onChange={(e) => setPlace(e.target.value)}
              maxLength={REPORT_LIMITS.place}
              autoComplete="off"
              aria-invalid={!!errors.place}
              className="cz-field"
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field
              label="ผู้เสียชีวิต"
              optional
              htmlFor={fieldId(formId, "killed")}
              error={errors.killed}
            >
              <input
                id={fieldId(formId, "killed")}
                type="number"
                name="killed"
                value={killed}
                onChange={(e) => setKilled(e.target.value)}
                min={0}
                max={REPORT_LIMITS.casualtyMax}
                inputMode="numeric"
                placeholder="ไม่ทราบ"
                aria-invalid={!!errors.killed}
                className="cz-field"
              />
            </Field>

            <Field
              label="ผู้บาดเจ็บ"
              optional
              htmlFor={fieldId(formId, "injured")}
              error={errors.injured}
            >
              <input
                id={fieldId(formId, "injured")}
                type="number"
                name="injured"
                value={injured}
                onChange={(e) => setInjured(e.target.value)}
                min={0}
                max={REPORT_LIMITS.casualtyMax}
                inputMode="numeric"
                placeholder="ไม่ทราบ"
                aria-invalid={!!errors.injured}
                className="cz-field"
              />
            </Field>
          </div>

          <div>
            <span className="cz-label">
              มีรูปหรือคลิปไหม{" "}
              <span className="font-normal text-ink-muted">· วางลิงก์ได้ ถ้าทราบ</span>
            </span>
            <div className="flex flex-col gap-2">
              {mediaUrls.map((url, i) => (
                <div key={i} className="relative">
                  <IconLink
                    size={16}
                    stroke={1.8}
                    className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-muted"
                  />
                  <input
                    id={i === 0 ? fieldId(formId, "mediaUrls") : undefined}
                    type="url"
                    name="mediaUrl"
                    value={url}
                    onChange={(e) =>
                      setMediaUrls((list) => list.map((v, j) => (j === i ? e.target.value : v)))
                    }
                    inputMode="url"
                    placeholder="https://…"
                    aria-label={`ลิงก์รูปหรือคลิปที่ ${i + 1}`}
                    maxLength={REPORT_LIMITS.mediaUrlLength}
                    aria-invalid={i === 0 && !!errors.mediaUrls}
                    className="cz-field pl-10"
                  />
                </div>
              ))}
            </div>
            {mediaUrls.length < REPORT_LIMITS.mediaUrls && (
              <button
                type="button"
                onClick={() => setMediaUrls((list) => [...list, ""])}
                className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-[14.5px] text-azure"
              >
                <IconPlus size={15} stroke={2} />
                เพิ่มลิงก์
              </button>
            )}
            {errors.mediaUrls && <FieldError message={errors.mediaUrls} />}
          </div>
        </Step>

        {/* ── 6. Review, then send ─────────────────────────────────────── */}
        <Step hidden={!onReview}>
          {state.status === "error" && (
            <div role="alert" className="rounded-lg border border-danger/45 bg-danger/10 px-3.5 py-3">
              <p className="flex items-center gap-2 text-[15px] font-medium text-danger">
                <IconAlertTriangle size={17} stroke={1.9} className="shrink-0" />
                {state.message ?? "ยังส่งไม่ได้ — มีบางช่องที่ต้องแก้"}
              </p>
            </div>
          )}

          {/* Only what the *server* rejected is echoed here. A step's own
              "you have not answered this yet" message belongs on that step,
              not repeated in a summary the reporter has not reached. */}
          <dl className="divide-y divide-[rgba(37,66,102,0.45)] overflow-hidden rounded-lg border border-[rgba(37,66,102,0.7)]">
            <ReviewRow
              label={FIELD_LABEL.eventType}
              value={eventType ? EVENT_TYPE_LABEL[eventType] : null}
              error={serverErrors?.eventType}
              onEdit={() => goToField("eventType")}
            />
            <ReviewRow
              label={FIELD_LABEL.title}
              value={title}
              error={serverErrors?.title}
              onEdit={() => goToField("title")}
            />
            <ReviewRow
              label={FIELD_LABEL.description}
              value={description}
              error={serverErrors?.description}
              onEdit={() => goToField("description")}
            />
            <ReviewRow
              label="สถานที่"
              value={
                pin
                  ? `จ.${pin.provinceName} · อ.${pin.districtName}${pin.subdistrictName ? ` · ต.${pin.subdistrictName}` : ""} (ปักหมุดแล้ว)`
                  : [
                      PROVINCES.find((p) => p.code === provinceCode)?.name,
                      districts.find((d) => d.code === districtCode)?.name,
                      subdistrict,
                    ]
                      .filter(Boolean)
                      .join(" · ")
              }
              error={serverErrors?.pin ?? serverErrors?.provinceCode ?? serverErrors?.districtCode ?? serverErrors?.subdistrict}
              onEdit={() => goTo(STEPS.findIndex((s) => s.id === "where"))}
            />
            <ReviewRow
              label="วันเวลา"
              value={[thaiDate(occurredDate), occurredTime && `${occurredTime} น.`]
                .filter(Boolean)
                .join(" · ")}
              error={serverErrors?.occurredDate ?? serverErrors?.occurredTime}
              onEdit={() => goToField("occurredDate")}
            />
            <ReviewRow
              label={FIELD_LABEL.place}
              value={place}
              error={serverErrors?.place}
              onEdit={() => goToField("place")}
            />
            <ReviewRow
              label="ผู้เสียชีวิต / ผู้บาดเจ็บ"
              value={
                killed || injured
                  ? `${killed || "ไม่ทราบ"} / ${injured || "ไม่ทราบ"}`
                  : null
              }
              error={serverErrors?.killed ?? serverErrors?.injured}
              onEdit={() => goToField("killed")}
            />
            <ReviewRow
              label={FIELD_LABEL.mediaUrls}
              value={mediaUrls.filter((u) => u.trim()).join("\n")}
              error={serverErrors?.mediaUrls}
              onEdit={() => goToField("mediaUrls")}
            />
          </dl>

          <p className="cz-hint">
            รายงานนี้จะถูกบันทึกในสถานะ &ldquo;อยู่ระหว่างตรวจสอบ&rdquo; และแสดงในตารางด้านล่างทันที
            ไม่มีการเก็บชื่อ เบอร์โทร หรืออีเมลของผู้แจ้ง
          </p>
        </Step>
      </div>

      {/*
        Sticky rather than inline: the answer to a question can be taller than
        a phone (the map, the seventeen categories), and the way forward is the
        one control that must never require hunting for.
      */}
      <div className="sticky bottom-0 z-10 flex flex-col gap-2 border-t border-[rgba(37,66,102,0.55)] bg-[rgba(6,13,25,0.94)] px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-sm sm:px-5">
        <div className="flex items-center gap-2.5">
          {stepIndex > 0 && (
            <button
              type="button"
              onClick={() => goTo(stepIndex - 1)}
              className="cz-btn border border-[rgba(56,100,150,0.6)] px-4 text-ink-dim hover:text-ink"
            >
              <IconArrowLeft size={17} stroke={1.8} />
              ย้อนกลับ
            </button>
          )}

          {/*
            Distinct keys, and they matter: without them React reuses the one
            DOM node for both buttons and only swaps `type`. The reuse happens
            during the click that leaves the last question — so by the time the
            browser ran the default action for that click, the button it had
            been pressed on was a submit button, and the report filed itself
            without the reporter ever seeing the review screen.
          */}
          {onReview ? (
            <button
              key="submit"
              type="submit"
              disabled={pending}
              className="cz-btn flex-1 bg-[#1d4ed8] text-[16px] font-semibold text-white hover:bg-[#2563eb]"
            >
              {pending ? (
                <IconLoader2 size={18} stroke={2} className="animate-spin" />
              ) : (
                <IconSend size={18} stroke={1.8} />
              )}
              ส่งรายงาน
            </button>
          ) : (
            <button
              key="next"
              type="button"
              onClick={next}
              className="cz-btn flex-1 bg-[#1d4ed8] text-[16px] font-semibold text-white hover:bg-[#2563eb]"
            >
              {step.id === "extra" ? "ข้ามไปหน้าสรุป" : "ถัดไป"}
              <IconArrowRight size={18} stroke={1.8} />
            </button>
          )}
        </div>

        {/* The floating reCAPTCHA badge is hidden in globals.css because it
            would sit on top of the map picker. Google permits that only if
            this notice is shown instead, so the two must stay together. */}
        {RECAPTCHA_ENABLED && onReview && (
          <p className="cz-hint text-center">
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

/**
 * One step's fields.
 *
 * `hidden` rather than unmounted, so nothing typed is ever thrown away, and
 * the values of the steps not on screen still submit with the form.
 */
function Step({ hidden, children }: { hidden: boolean; children: React.ReactNode }) {
  return (
    <div hidden={hidden} className="flex flex-col gap-5">
      {children}
    </div>
  );
}

/** How far along, in words and in a bar — never in a bar alone. */
function Progress({ index }: { index: number }) {
  const pct = Math.round(((index + 1) / STEPS.length) * 100);
  return (
    <div className="border-b border-[rgba(37,66,102,0.45)] px-4 pt-3.5 pb-3 sm:px-5">
      <div className="flex items-baseline justify-between">
        <p className="text-[13.5px] text-ink-dim">
          ขั้นที่ <span className="num font-semibold text-ink">{index + 1}</span> จาก{" "}
          <span className="num">{STEPS.length}</span>
        </p>
        {/* Announced on every step change: nothing else tells a screen-reader
            user that the question has moved on. */}
        <p aria-live="polite" className="sr-only">
          ขั้นที่ {index + 1} จาก {STEPS.length} — {STEPS[index].title}
        </p>
        <p className="cz-hint">ไม่ต้องบอกชื่อ</p>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[rgba(37,66,102,0.7)]">
        <div
          className="h-full rounded-full bg-azure transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/** One event category as a tappable card — see `.cz-card` in globals.css. */
function TypeCard({
  value,
  label,
  checked,
  onChange,
}: {
  value: EventType;
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  const Icon = EVENT_ICON[value] ?? EVENT_ICON.other;
  return (
    <label className="cz-choice" style={{ "--cz-accent": EVENT_COLOR[value] } as React.CSSProperties}>
      <input type="radio" name="eventType" value={value} checked={checked} onChange={onChange} />
      <span className="cz-card">
        <Icon size={20} strokeWidth={1.8} className="shrink-0" style={{ color: EVENT_COLOR[value] }} aria-hidden />
        <span className="min-w-0">{label}</span>
        <IconCheck size={16} stroke={2.5} className="cz-tick shrink-0" aria-hidden />
      </span>
    </label>
  );
}

/** One answer on the review screen, with the way back to change it. */
function ReviewRow({
  label,
  value,
  error,
  onEdit,
}: {
  label: string;
  value: string | null | undefined;
  error?: string;
  onEdit: () => void;
}) {
  const filled = !!value && value.trim() !== "";
  return (
    <div className="flex items-start gap-3 bg-[rgba(10,21,36,0.5)] px-3.5 py-3">
      <div className="min-w-0 flex-1">
        <dt className="text-[12.5px] text-ink-muted">{label}</dt>
        <dd
          className={`mt-0.5 text-[15px] leading-snug break-words whitespace-pre-line ${
            filled ? "text-ink" : "text-ink-muted italic"
          }`}
        >
          {filled ? value : "— ไม่ได้กรอก"}
        </dd>
        {error && <FieldError message={error} />}
      </div>
      <button
        type="button"
        onClick={onEdit}
        className="inline-flex min-h-11 shrink-0 items-center gap-1 px-1 text-[14px] text-azure"
      >
        <IconPencil size={14} stroke={1.9} />
        แก้ไข
      </button>
    </div>
  );
}

/** `2565-12-06` read back the way the rest of the app writes dates. */
function thaiDate(value: string): string {
  if (!value) return "";
  const at = new Date(`${value}T00:00:00+07:00`);
  if (Number.isNaN(at.getTime())) return value;
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "long", calendar: "buddhist" }).format(at);
}

/**
 * One id scheme for both the control and anything that jumps to it, so the
 * two can never drift apart.
 */
function fieldId(formId: string, name: ReportFieldName): string {
  return `${formId}-${name}`;
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
        {optional && <span className="font-normal text-ink-muted"> · ไม่กรอกก็ได้</span>}
      </label>
      {hint && <p className="cz-hint mb-1.5 -mt-0.5">{hint}</p>}
      {children}
      {error && <FieldError message={error} />}
    </div>
  );
}

function FieldError({ message }: { message: string }) {
  return (
    <p className="mt-1.5 flex items-start gap-1.5 text-[14px] leading-snug text-danger">
      <IconX size={15} stroke={2.5} className="mt-0.5 shrink-0" />
      {message}
    </p>
  );
}
