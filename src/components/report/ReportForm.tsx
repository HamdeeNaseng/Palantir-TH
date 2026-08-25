"use client";

import { useActionState, useId, useMemo, useState } from "react";
import Link from "next/link";
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconLink,
  IconLoader2,
  IconPlus,
  IconSend,
  IconX,
} from "@tabler/icons-react";
import { PROVINCES } from "@/lib/geo";
import { toInputDate } from "@/lib/datetime";
import {
  HONEYPOT_FIELD,
  REPORT_EVENT_TYPES,
  REPORT_FORM_IDLE,
  REPORT_LIMITS,
  REPORT_MIN_DATE,
  type DistrictOption,
} from "@/lib/report-form";
import type { ProvinceCode } from "@/lib/types";
import { submitCitizenReport } from "@/server/report-intake";

/**
 * The citizen intake form.
 *
 * Deliberately asks for no name, phone, or email — see the note in
 * `report-intake.ts` on why. Every field it does ask for maps straight onto
 * `event_candidates`, so nothing here is collected only to be discarded.
 */
export default function ReportForm({
  districtsByProvince,
  onSubmitted,
}: {
  districtsByProvince: Record<ProvinceCode, DistrictOption[]>;
  /** Fired when "ส่งรายงานอีกฉบับ" is clicked — a fresh form is wanted. */
  onSubmitted?: () => void;
}) {
  const [state, formAction, pending] = useActionState(submitCitizenReport, REPORT_FORM_IDLE);
  const [provinceCode, setProvinceCode] = useState<ProvinceCode | "">("");
  const [mediaCount, setMediaCount] = useState(1);
  const formId = useId();

  const districts = useMemo(
    () => (provinceCode ? districtsByProvince[provinceCode] : []),
    [provinceCode, districtsByProvince],
  );

  if (state.status === "success") {
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
        <IconCircleCheck size={28} stroke={1.5} className="text-mint" />
        <p className="text-[13.5px] text-ink">{state.message ?? "บันทึกรายงานเรียบร้อยแล้ว"}</p>
        <p className="max-w-md text-[11.5px] leading-relaxed text-ink-muted">
          รายงานนี้ยังเป็นข้อมูลที่ &ldquo;อยู่ระหว่างตรวจสอบ&rdquo; ไม่ใช่ข้อเท็จจริงที่ยืนยันแล้ว
          — สามารถดูสิ่งที่ถูกบันทึกไว้ได้ที่ลิงก์ด้านล่าง
        </p>
        <div className="flex items-center gap-2">
          {state.caseId && (
            <Link
              href={`/cases/${encodeURIComponent(state.caseId)}?ref=${encodeURIComponent("/report")}`}
              className="rounded bg-[rgba(56,189,248,0.14)] px-3 py-1.5 text-[11.5px] text-azure hover:bg-[rgba(56,189,248,0.24)]"
            >
              ดูรายงานที่บันทึกไว้
            </Link>
          )}
          <button
            type="button"
            onClick={() => onSubmitted?.()}
            className="rounded border border-[rgba(56,100,150,0.6)] px-3 py-1.5 text-[11.5px] text-ink-dim hover:text-ink"
          >
            ส่งรายงานอีกฉบับ
          </button>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="grid grid-cols-2 gap-x-4 gap-y-3 p-4">
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

      {state.status === "error" && state.message && !state.fieldErrors && (
        <div className="col-span-2 flex items-center gap-2 rounded border border-danger/40 bg-danger/10 px-3 py-2 text-[11.5px] text-danger">
          <IconAlertTriangle size={14} stroke={1.8} />
          {state.message}
        </div>
      )}

      <Field label="ประเภทเหตุการณ์" htmlFor={`${formId}-eventType`} error={state.fieldErrors?.eventType} required>
        <select
          id={`${formId}-eventType`}
          name="eventType"
          required
          defaultValue=""
          className={selectClass}
        >
          <option value="" disabled>
            เลือกประเภท
          </option>
          {REPORT_EVENT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="วันที่เกิดเหตุ" htmlFor={`${formId}-occurredDate`} error={state.fieldErrors?.occurredDate} required>
        <input
          id={`${formId}-occurredDate`}
          type="date"
          name="occurredDate"
          required
          min={REPORT_MIN_DATE}
          // Bangkok-local "today", matching the server's validation exactly —
          // UTC's own date lags Bangkok by up to 7 hours, which would block
          // today's actual date for part of every evening otherwise.
          max={toInputDate(new Date())}
          className={inputClass}
        />
      </Field>

      <Field label="หัวข้อสั้น ๆ" htmlFor={`${formId}-title`} error={state.fieldErrors?.title} required className="col-span-2">
        <input
          id={`${formId}-title`}
          type="text"
          name="title"
          required
          maxLength={REPORT_LIMITS.title}
          placeholder="เช่น ได้ยินเสียงคล้ายระเบิดใกล้ตลาดสด"
          className={inputClass}
        />
      </Field>

      <Field
        label="รายละเอียดเพิ่มเติม (ถ้ามี)"
        htmlFor={`${formId}-description`}
        error={state.fieldErrors?.description}
        className="col-span-2"
      >
        <textarea
          id={`${formId}-description`}
          name="description"
          rows={3}
          maxLength={REPORT_LIMITS.description}
          className={`${inputClass} resize-none`}
        />
      </Field>

      <Field label="เวลาโดยประมาณ (ถ้าทราบ)" htmlFor={`${formId}-occurredTime`} error={state.fieldErrors?.occurredTime}>
        <input id={`${formId}-occurredTime`} type="time" name="occurredTime" className={inputClass} />
      </Field>

      <div />

      <Field label="จังหวัด" htmlFor={`${formId}-provinceCode`} error={state.fieldErrors?.provinceCode} required>
        <select
          id={`${formId}-provinceCode`}
          name="provinceCode"
          required
          defaultValue=""
          onChange={(e) => setProvinceCode(e.target.value as ProvinceCode)}
          className={selectClass}
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

      <Field label="อำเภอ" htmlFor={`${formId}-districtCode`} error={state.fieldErrors?.districtCode} required>
        <select
          id={`${formId}-districtCode`}
          name="districtCode"
          required
          disabled={!provinceCode}
          defaultValue=""
          className={selectClass}
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

      <Field label="ตำบล (ถ้าทราบ)" htmlFor={`${formId}-subdistrict`} error={state.fieldErrors?.subdistrict}>
        <input
          id={`${formId}-subdistrict`}
          type="text"
          name="subdistrict"
          maxLength={REPORT_LIMITS.subdistrict}
          className={inputClass}
        />
      </Field>

      <Field label="จุดสังเกต/สถานที่ (ถ้าทราบ)" htmlFor={`${formId}-place`} error={state.fieldErrors?.place}>
        <input id={`${formId}-place`} type="text" name="place" maxLength={REPORT_LIMITS.place} className={inputClass} />
      </Field>

      <Field label="จำนวนผู้เสียชีวิต (ถ้าทราบ)" htmlFor={`${formId}-killed`} error={state.fieldErrors?.killed}>
        <input id={`${formId}-killed`} type="number" name="killed" min={0} className={inputClass} />
      </Field>

      <Field label="จำนวนผู้บาดเจ็บ (ถ้าทราบ)" htmlFor={`${formId}-injured`} error={state.fieldErrors?.injured}>
        <input id={`${formId}-injured`} type="number" name="injured" min={0} className={inputClass} />
      </Field>

      <div className="col-span-2">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[11px] text-ink-dim">ลิงก์หลักฐาน (ถ้ามี — ภาพ วิดีโอ หรือโพสต์)</span>
          {mediaCount < REPORT_LIMITS.mediaUrls && (
            <button
              type="button"
              onClick={() => setMediaCount((n) => Math.min(REPORT_LIMITS.mediaUrls, n + 1))}
              className="inline-flex items-center gap-1 text-[10.5px] text-azure hover:underline"
            >
              <IconPlus size={11} stroke={2} />
              เพิ่มลิงก์
            </button>
          )}
        </div>
        <div className="space-y-1.5">
          {Array.from({ length: mediaCount }, (_, i) => (
            <div key={i} className="relative">
              <IconLink
                size={13}
                stroke={1.8}
                className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-muted"
              />
              <input
                type="url"
                name="mediaUrl"
                placeholder="https://…"
                maxLength={REPORT_LIMITS.mediaUrlLength}
                className={`${inputClass} pl-8`}
              />
            </div>
          ))}
        </div>
        {state.fieldErrors?.mediaUrls && (
          <p className="mt-1 text-[10.5px] text-danger">{state.fieldErrors.mediaUrls}</p>
        )}
      </div>

      <div className="col-span-2 flex items-center justify-between border-t border-[rgba(37,66,102,0.45)] pt-3">
        <p className="max-w-[380px] text-[10.5px] leading-relaxed text-ink-muted">
          รายงานนี้จะถูกบันทึกในสถานะ &ldquo;อยู่ระหว่างตรวจสอบ&rdquo; และแสดงในตารางด้านล่างทันที
          ไม่มีการเก็บชื่อ เบอร์โทร หรืออีเมลของผู้แจ้ง
        </p>
        <button
          type="submit"
          disabled={pending}
          className="flex shrink-0 items-center gap-2 rounded bg-[#1d4ed8] px-4 py-2 text-[12.5px] font-medium text-white hover:bg-[#2563eb] disabled:opacity-70"
        >
          {pending ? <IconLoader2 size={14} stroke={2} className="animate-spin" /> : <IconSend size={14} stroke={1.8} />}
          ส่งรายงาน
        </button>
      </div>
    </form>
  );
}

const inputClass =
  "w-full rounded border border-[rgba(37,66,102,0.8)] bg-[#0a1524] px-2.5 py-1.5 text-[12px] text-ink placeholder:text-ink-muted focus:border-azure focus:outline-none";
const selectClass = `${inputClass} appearance-none`;

function Field({
  label,
  htmlFor,
  error,
  required,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1 block text-[11px] text-ink-dim">
        {label}
        {required && <span className="text-danger"> *</span>}
      </label>
      {children}
      {error && (
        <p className="mt-1 flex items-center gap-1 text-[10.5px] text-danger">
          <IconX size={10} stroke={2.5} />
          {error}
        </p>
      )}
    </div>
  );
}
