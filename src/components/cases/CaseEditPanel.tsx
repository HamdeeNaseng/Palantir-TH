"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconDeviceFloppy, IconPencil, IconX } from "@tabler/icons-react";
import CaseLocationMap from "./CaseLocationMap";
import { saveCaseCorrection } from "@/server/case-corrections";
import { EVENT_TYPE_LABEL, GEO_PRECISION_LABEL, SEVERITY_LABEL, VERIFICATION_LABEL } from "@/lib/labels";
import { EVENT_COLOR } from "@/lib/palette";
import { EVENT_TYPES, GEO_PRECISION_RADIUS_M } from "@/lib/types";
import { formatThaiDateTime } from "@/lib/datetime";
import type {
  CaseCorrectionChanges,
  CaseCorrectionDoc,
  EventCandidateDoc,
  EventType,
  GeoPrecision,
  SeverityLevel,
  VerificationStatus,
} from "@/lib/types";

/**
 * Analyst edit mode for one case.
 *
 * What it writes is a *correction*, never an edit: the source's claim stays
 * exactly as it was, and this records a disagreement with it. That is why the
 * form shows "แหล่งข้อมูลรายงาน" beside every field it can change — the
 * analyst is not filling in a blank record, they are contradicting a specific
 * published value, and the UI should make that the visible act.
 *
 * The location editor is the reason this is a panel and not a dialog. Most
 * records in the collection sit on an อำเภอ centroid, so "correcting" them is
 * mostly a spatial act — drag the pin to where it actually happened — and that
 * needs the map at full width with the uncertainty ring still drawn.
 */

const VERIFICATIONS: VerificationStatus[] = ["verified", "under_review", "unverifiable"];
const PRECISIONS: GeoPrecision[] = [
  "gps",
  "address",
  "village",
  "subdistrict",
  "district",
  "province",
  "unknown",
];

export default function CaseEditPanel({
  event,
  history,
  locationFallback,
}: {
  /** The corrected view — what the analyst is editing forward from. */
  event: EventCandidateDoc;
  /** Existing corrections, newest first. */
  history: CaseCorrectionDoc[];
  /**
   * Where to open the map for a case that has no coordinates — its own ตำบล or
   * อำเภอ. 186 records carry an address but no point, and those are the ones
   * where placing a pin is worth the most; opening the map over the Gulf and
   * asking the analyst to find มายอ would waste that.
   */
  locationFallback: { centre: [number, number]; label: string } | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const coordinates = event.location.geo?.coordinates ?? null;
  const [form, setForm] = useState({
    lng: coordinates?.[0] ?? null,
    lat: coordinates?.[1] ?? null,
    precision: event.location.geo_precision ?? "unknown",
    type: event.event.type,
    severity: event.severity,
    verification: event.verification,
    killed: event.casualties.killed,
    injured: event.casualties.injured,
    summary: event.event.summary ?? null,
    by: "",
    note: "",
  });

  const color = EVENT_COLOR[form.type] ?? EVENT_COLOR.other;
  const precisionM = GEO_PRECISION_RADIUS_M[form.precision];
  /** A pin exists right now — either the case's own, or one just placed. */
  const hasPin = form.lng !== null && form.lat !== null;
  /**
   * The map can be opened at all. A case with no coordinates still gets one,
   * framed on its ตำบล/อำเภอ, so the analyst can supply the point the source
   * never published — which is the single most valuable correction here.
   */
  const placeable = hasPin || locationFallback !== null;

  function submit() {
    setError(null);
    setSaved(null);

    const changes: CaseCorrectionChanges = {
      event_type: form.type,
      severity: form.severity,
      verification: form.verification,
      killed: form.killed,
      injured: form.injured,
      summary: form.summary,
    };
    // Only send geo when there is a full pin — a half-set coordinate is not a
    // correction, and the server would reject it anyway.
    if (form.lng !== null && form.lat !== null) {
      changes.geo = { coordinates: [form.lng, form.lat], precision: form.precision };
    }

    startTransition(async () => {
      const result = await saveCaseCorrection({
        eventId: event._id,
        correctedBy: form.by,
        note: form.note,
        changes,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(`บันทึกแล้ว — แก้ไข ${result.changedFields} ฟิลด์`);
      setForm((f) => ({ ...f, note: "" }));
      // The page is server-rendered; pull the new corrected view rather than
      // patching local state, so what is on screen is what was actually stored.
      router.refresh();
    });
  }

  if (!open) {
    return (
      <div className="flex items-center gap-2">
        {history.length > 0 && (
          <span className="text-[10.5px] text-ink-muted">
            แก้ไขแล้ว <span className="num">{history.length}</span> ครั้ง · ล่าสุด{" "}
            {formatThaiDateTime(history[0].corrected_at)}
          </span>
        )}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 rounded border border-[rgba(56,100,150,0.6)] px-2.5 py-1 text-[11.5px] text-ink-dim hover:border-azure hover:text-azure"
        >
          <IconPencil size={13} stroke={1.8} />
          แก้ไขข้อมูล
        </button>
      </div>
    );
  }

  return (
    <section className="panel">
      <header className="flex items-center justify-between gap-3 border-b border-[rgba(37,66,102,0.45)] px-4 py-2.5">
        <h2 className="panel-title">แก้ไขข้อมูลเคส</h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="inline-flex items-center gap-1 text-[11px] text-ink-muted hover:text-ink"
        >
          <IconX size={13} stroke={1.8} />
          ปิด
        </button>
      </header>

      <p className="border-b border-[rgba(37,66,102,0.3)] bg-[rgba(56,189,248,0.05)] px-4 py-2 text-[10.5px] leading-relaxed text-ink-muted">
        การแก้ไขจะถูกบันทึกเป็น <b className="text-ink-dim">ชั้นข้อมูลแก้ไข</b> แยกต่างหาก
        ไม่ทับข้อมูลเดิมที่แหล่งข้อมูลรายงาน — ย้อนดูและย้อนกลับได้เสมอ
      </p>

      {/* ------------------------------------------------------- location */}
      {placeable ? (
        <div className="border-b border-[rgba(37,66,102,0.3)]">
          <div className="h-[320px] w-full">
            <CaseLocationMap
              lng={form.lng}
              lat={form.lat}
              precisionM={precisionM}
              color={color}
              centre={locationFallback?.centre}
              editable
              onMove={({ lng, lat }) => setForm((f) => ({ ...f, lng, lat }))}
            />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
            <span className="text-[10.5px] text-ink-muted">
              {hasPin
                ? "ลากหมุด หรือคลิกบนแผนที่เพื่อย้ายตำแหน่ง"
                : `เคสนี้ยังไม่มีพิกัด — คลิกบนแผนที่เพื่อกำหนดจุดเกิดเหตุ${
                    locationFallback ? ` (แสดง${locationFallback.label})` : ""
                  }`}
            </span>
            {hasPin && (
              <span className="num text-[11px] text-ink-dim">
                {form.lat!.toFixed(6)}, {form.lng!.toFixed(6)}
              </span>
            )}
            {hasPin && coordinates && (form.lng !== coordinates[0] || form.lat !== coordinates[1]) && (
              <button
                type="button"
                onClick={() =>
                  setForm((f) => ({ ...f, lng: coordinates[0], lat: coordinates[1] }))
                }
                className="text-[10.5px] text-azure hover:underline"
              >
                คืนค่าพิกัดเดิม
              </button>
            )}
            {/* Clearing a pin the analyst just placed, without saving it. A
                case with no coordinates is a legitimate state — the source
                genuinely published none — so backing out has to be possible. */}
            {hasPin && !coordinates && (
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, lng: null, lat: null }))}
                className="text-[10.5px] text-azure hover:underline"
              >
                ล้างหมุด
              </button>
            )}
            {hasPin && (
              <Field label="ความละเอียดพิกัด">
                <Select
                  value={form.precision}
                  onChange={(v) => setForm((f) => ({ ...f, precision: v as GeoPrecision }))}
                  options={PRECISIONS.map((p) => ({ value: p, label: GEO_PRECISION_LABEL[p] }))}
                />
              </Field>
            )}
          </div>
          {!coordinates && hasPin && (
            <p className="px-4 pb-2.5 text-[10px] leading-relaxed text-ink-muted">
              แหล่งข้อมูลไม่ได้เผยแพร่พิกัด หมุดนี้จึงเป็นการระบุตำแหน่งโดยนักวิเคราะห์ —
              เลือกความละเอียดให้ตรงกับหลักฐานที่ใช้
            </p>
          )}
        </div>
      ) : (
        <p className="border-b border-[rgba(37,66,102,0.3)] px-4 py-3 text-[11.5px] text-ink-muted">
          เคสนี้ไม่มีพิกัด และระบบจับคู่ตำบล/อำเภอกับขอบเขต DDPM ไม่ได้ จึงยังเปิดแผนที่ให้ปักหมุดไม่ได้
        </p>
      )}

      {/* --------------------------------------------------------- fields */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 px-4 py-3">
        <Field label="ประเภทเหตุการณ์" reported={EVENT_TYPE_LABEL[event.event.type]}>
          <Select
            value={form.type}
            onChange={(v) => setForm((f) => ({ ...f, type: v as EventType }))}
            options={EVENT_TYPES.map((t) => ({ value: t, label: EVENT_TYPE_LABEL[t] }))}
          />
        </Field>

        <Field
          label="ระดับความรุนแรง"
          reported={event.severity === null ? "ไม่ได้รายงาน" : `${event.severity}/5`}
        >
          <Select
            value={form.severity === null ? "" : String(form.severity)}
            onChange={(v) =>
              setForm((f) => ({ ...f, severity: v === "" ? null : (Number(v) as SeverityLevel) }))
            }
            options={[
              { value: "", label: "ไม่ระบุ" },
              ...[1, 2, 3, 4, 5].map((n) => ({
                value: String(n),
                label: `${n}/5 — ${SEVERITY_LABEL[n]}`,
              })),
            ]}
          />
        </Field>

        <Field label="สถานะการยืนยัน" reported={VERIFICATION_LABEL[event.verification]}>
          <Select
            value={form.verification}
            onChange={(v) => setForm((f) => ({ ...f, verification: v as VerificationStatus }))}
            options={VERIFICATIONS.map((v) => ({ value: v, label: VERIFICATION_LABEL[v] }))}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field
            label="ผู้เสียชีวิต"
            reported={event.casualties.killed === null ? "ไม่ได้รายงาน" : String(event.casualties.killed)}
          >
            <NumberInput
              value={form.killed}
              onChange={(n) => setForm((f) => ({ ...f, killed: n }))}
            />
          </Field>
          <Field
            label="ผู้บาดเจ็บ"
            reported={event.casualties.injured === null ? "ไม่ได้รายงาน" : String(event.casualties.injured)}
          >
            <NumberInput
              value={form.injured}
              onChange={(n) => setForm((f) => ({ ...f, injured: n }))}
            />
          </Field>
        </div>

        <div className="col-span-2">
          <Field label="รายละเอียดเหตุการณ์">
            <textarea
              value={form.summary ?? ""}
              onChange={(e) =>
                setForm((f) => ({ ...f, summary: e.target.value === "" ? null : e.target.value }))
              }
              rows={3}
              className="w-full rounded border border-[rgba(56,100,150,0.5)] bg-[#060d19] px-2 py-1.5 text-[11.5px] text-ink"
            />
          </Field>
        </div>
      </div>

      {/* ------------------------------------------------------ attribution */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-[rgba(37,66,102,0.3)] px-4 py-3">
        <Field label="ผู้แก้ไข">
          <input
            value={form.by}
            onChange={(e) => setForm((f) => ({ ...f, by: e.target.value }))}
            placeholder="ชื่อหรือหน่วยงาน"
            className="w-full rounded border border-[rgba(56,100,150,0.5)] bg-[#060d19] px-2 py-1.5 text-[11.5px] text-ink"
          />
          <span className="mt-1 block text-[10px] text-ink-muted">
            ระบบยังไม่มีการยืนยันตัวตน ชื่อนี้จึงเป็นเพียงคำอ้าง ไม่ใช่การยืนยัน
          </span>
        </Field>
        <Field label="เหตุผลที่แก้ไข">
          <input
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            placeholder="เช่น ตรวจสอบกับรายงานตำรวจแล้ว"
            className="w-full rounded border border-[rgba(56,100,150,0.5)] bg-[#060d19] px-2 py-1.5 text-[11.5px] text-ink"
          />
        </Field>
      </div>

      <div className="flex items-center gap-3 border-t border-[rgba(37,66,102,0.45)] px-4 py-2.5">
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded bg-azure px-3 py-1.5 text-[11.5px] font-medium text-[#04070e] hover:bg-cyan disabled:opacity-50"
        >
          <IconDeviceFloppy size={13} stroke={1.8} />
          {pending ? "กำลังบันทึก…" : "บันทึกการแก้ไข"}
        </button>
        {error && <span className="text-[11px] text-[#f87171]">{error}</span>}
        {saved && <span className="text-[11px] text-[#4ade80]">{saved}</span>}
      </div>
    </section>
  );
}

// -------------------------------------------------------------- small pieces

function Field({
  label,
  reported,
  children,
}: {
  label: string;
  /** What the source said, shown so a change reads as a disagreement. */
  reported?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-baseline gap-2">
        <span className="text-[10.5px] text-ink-muted">{label}</span>
        {reported && (
          <span className="text-[10px] text-ink-muted/70">แหล่งข้อมูล: {reported}</span>
        )}
      </span>
      {children}
    </label>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded border border-[rgba(56,100,150,0.5)] bg-[#060d19] px-2 py-1.5 text-[11.5px] text-ink"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Empty means "unknown", which is a different claim from zero — hence `null`. */
function NumberInput({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <input
      type="number"
      min={0}
      value={value === null ? "" : value}
      placeholder="ไม่ระบุ"
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      className="num w-full rounded border border-[rgba(56,100,150,0.5)] bg-[#060d19] px-2 py-1.5 text-[11.5px] text-ink"
    />
  );
}
