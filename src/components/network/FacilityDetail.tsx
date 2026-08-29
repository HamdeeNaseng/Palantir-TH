"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  IconAlertTriangle,
  IconCalendarEvent,
  IconClock,
  IconExternalLink,
  IconMapPin,
  IconPhone,
  IconPhonePlus,
  IconRefresh,
} from "@tabler/icons-react";
import {
  EMERGENCY_LINE,
  FACILITY_COLOR,
  FACILITY_ICON,
  FACILITY_LABEL,
  FACILITY_STATUS_COLOR,
  FACILITY_STATUS_LABEL,
  facilityName,
  scheduledOpen,
  thaiDate,
  yearsOfService,
  type Facility,
  type FacilityStatus,
} from "@/lib/facilities";
import { logFacilityContact, setFacilityStatus } from "@/server/facility-actions";
import type { FacilityLogEntry } from "@/server/facilities";

/**
 * One facility, and the two things a desk does with it: say whether it is open
 * and record that it was contacted.
 *
 * Both writes append to `facility_log`; nothing here edits a record. What that
 * buys on screen is the history below — "ปิด, 03:12, แจ้งโดยศูนย์ ปภ." stays
 * readable after someone marks it open again at 06:00, which is the only way
 * a shift handover can tell a stale status from a corrected one.
 */

const STATUS_CHOICES: FacilityStatus[] = ["open", "closed", "unknown"];

export default function FacilityDetail({
  facility,
  showOpenLink = false,
}: {
  facility: Facility;
  /** The link to this facility's own page — hidden on that page itself. */
  showOpenLink?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [by, setBy] = useState("");
  const [statusNote, setStatusNote] = useState("");
  const [channel, setChannel] = useState("");
  const [contactNote, setContactNote] = useState("");
  const [log, setLog] = useState<FacilityLogEntry[] | null>(null);

  const line = EMERGENCY_LINE[facility.kind];
  const Icon = FACILITY_ICON[facility.kind];

  /**
   * The published hours, read at render. `null` means the record does not say
   * — shown as "ไม่ระบุเวลาทำการ", never as closed.
   */
  const onSchedule = scheduledOpen(facility.openingHours, Date.now());
  /** Only when the record carries a founding date — never estimated. */
  const years = yearsOfService(facility, Date.now());

  useEffect(() => {
    let cancelled = false;
    setLog(null);
    fetch(`/api/network/log?id=${encodeURIComponent(facility.id)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { entries: FacilityLogEntry[] }) => {
        if (!cancelled) setLog(data.entries);
      })
      .catch(() => {
        if (!cancelled) setLog([]);
      });
    return () => {
      cancelled = true;
    };
  }, [facility.id]);

  function saveStatus(status: FacilityStatus) {
    setError(null);
    startTransition(async () => {
      const result = await setFacilityStatus({
        facilityId: facility.id,
        status,
        note: statusNote || null,
        by: by || null,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setStatusNote("");
      router.refresh();
      refreshLog();
    });
  }

  function saveContact() {
    setError(null);
    startTransition(async () => {
      const result = await logFacilityContact({
        facilityId: facility.id,
        channel: channel || null,
        note: contactNote || null,
        by: by || null,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setChannel("");
      setContactNote("");
      router.refresh();
      refreshLog();
    });
  }

  function refreshLog() {
    fetch(`/api/network/log?id=${encodeURIComponent(facility.id)}`)
      .then((r) => r.json())
      .then((data: { entries: FacilityLogEntry[] }) => setLog(data.entries))
      .catch(() => undefined);
  }

  return (
    <div className="flex min-h-0 flex-col gap-2 overflow-y-auto">
      <section className="panel p-3.5">
        <div className="flex items-start gap-2.5">
          <span
            className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
            style={{
              background: `${FACILITY_COLOR[facility.kind]}22`,
              color: FACILITY_COLOR[facility.kind],
            }}
          >
            <Icon size={17} strokeWidth={1.8} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[14px] leading-snug font-semibold text-ink">
              {facilityName(facility)}
            </h2>
            <p className="mt-0.5 text-[11.5px] text-ink-dim">
              {FACILITY_LABEL[facility.kind]}
              {facility.operator ? ` · ${facility.operator}` : ""}
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-[11.5px] text-ink-muted">
              <IconMapPin size={13} stroke={1.8} className="shrink-0" />
              {facility.subdistrict ? `ต.${facility.subdistrict} · ` : ""}อ.{facility.district} จ.
              {facility.province}
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-[11.5px] text-ink-muted">
              <IconClock size={13} stroke={1.8} className="shrink-0" />
              {facility.openingHours
                ? `${facility.openingHours} — ${
                    onSchedule === null
                      ? "อ่านตารางเวลาไม่ได้"
                      : onSchedule
                        ? "ตามตารางคือช่วงเปิด"
                        : "ตามตารางคือนอกเวลาทำการ"
                  }`
                : "ไม่ระบุเวลาทำการ"}
            </p>
            {(facility.openedOn || facility.closedOn) && (
              <p className="mt-1 flex items-start gap-1.5 text-[11.5px] text-ink-muted">
                <IconCalendarEvent size={13} stroke={1.8} className="mt-0.5 shrink-0" />
                <span>
                  {facility.openedOn ? `เริ่มทำการ ${thaiDate(facility.openedOn)}` : "ไม่ทราบวันเริ่มทำการ"}
                  {facility.closedOn ? ` · ยกเลิก ${thaiDate(facility.closedOn)}` : ""}
                  {years !== null && (
                    <span className="text-ink-dim">
                      {" "}
                      (<span className="num">{years}</span> ปี)
                    </span>
                  )}
                </span>
              </p>
            )}
            <p className="mt-1 text-[10.5px] text-ink-muted">
              ที่มา: {facility.source === "osm" ? "OpenStreetMap" : "เพิ่มโดยเจ้าหน้าที่"}
              {facility.editedAtMs ? " · แก้ไขโดยเจ้าหน้าที่แล้ว" : ""}
            </p>
            {showOpenLink && (
              <Link
                href={`/network/${encodeURIComponent(facility.id)}`}
                className="mt-2 inline-flex items-center gap-1.5 text-[11.5px] text-azure hover:underline"
              >
                เปิดหน้าข้อมูลเต็มและแก้ไข
                <IconExternalLink size={12} stroke={1.9} />
              </Link>
            )}
          </div>
        </div>
      </section>

      {/* ── Coordination ─────────────────────────────────────────────── */}
      <section className="panel p-3.5">
        <h3 className="panel-title mb-2">ติดต่อประสานงาน</h3>
        <a
          href={`tel:${line.number}`}
          className="flex items-center gap-2.5 rounded-lg border border-[rgba(56,189,248,0.4)] bg-[rgba(56,189,248,0.1)] px-3 py-2.5 text-azure"
        >
          <IconPhone size={17} stroke={1.9} className="shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="num block text-[16px] leading-none font-semibold">{line.number}</span>
            <span className="mt-0.5 block text-[11px] text-ink-dim">{line.label}</span>
          </span>
        </a>
        {facility.phone ? (
          <a
            href={`tel:${facility.phone.replace(/[^+0-9]/g, "")}`}
            className="mt-2 flex items-center gap-2.5 rounded-lg border border-[rgba(56,100,150,0.5)] px-3 py-2 text-ink-dim hover:text-ink"
          >
            <IconPhonePlus size={15} stroke={1.8} className="shrink-0" />
            <span className="num text-[13px]">{facility.phone}</span>
            <span className="ml-auto text-[10.5px] text-ink-muted">เบอร์ตรงของหน่วย</span>
          </a>
        ) : (
          <p className="cz-hint mt-2 text-[10.5px]">
            ข้อมูลไม่มีเบอร์ตรงของหน่วยนี้ — ใช้สายด่วนด้านบน
          </p>
        )}
      </section>

      {/* ── Status ───────────────────────────────────────────────────── */}
      <section className="panel p-3.5">
        <h3 className="panel-title mb-1">สถานะตอนนี้</h3>
        <p className="text-[10.5px] leading-relaxed text-ink-muted">
          สิ่งที่ศูนย์รู้ ณ ตอนนี้ — ไม่ใช่เวลาทำการที่ประกาศไว้
        </p>
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {STATUS_CHOICES.map((s) => {
            const active = facility.status === s;
            return (
              <button
                key={s}
                type="button"
                disabled={pending}
                onClick={() => saveStatus(s)}
                aria-pressed={active}
                className="rounded-lg border px-2 py-2 text-[11.5px] transition-colors disabled:opacity-60"
                style={{
                  borderColor: active ? FACILITY_STATUS_COLOR[s] : "rgba(56,100,150,0.5)",
                  background: active ? `${FACILITY_STATUS_COLOR[s]}24` : "transparent",
                  color: active ? FACILITY_STATUS_COLOR[s] : undefined,
                }}
              >
                {FACILITY_STATUS_LABEL[s]}
              </button>
            );
          })}
        </div>
        {facility.statusAtMs && (
          <p className="mt-2 text-[10.5px] text-ink-muted">
            ล่าสุด {when(facility.statusAtMs)}
            {facility.statusBy ? ` · แจ้งโดย ${facility.statusBy}` : ""}
            {facility.statusNote ? ` · ${facility.statusNote}` : ""}
          </p>
        )}
        <input
          value={statusNote}
          onChange={(e) => setStatusNote(e.target.value)}
          maxLength={500}
          placeholder="หมายเหตุ (ถ้ามี) เช่น ปิดปรับปรุงถึงพรุ่งนี้"
          className="mt-2 w-full rounded border border-[rgba(37,66,102,0.8)] bg-[#0a1524] px-2.5 py-2 text-[12px] text-ink placeholder:text-ink-muted focus:border-azure focus:outline-none"
        />
      </section>

      {/* ── Log ──────────────────────────────────────────────────────── */}
      <section className="panel p-3.5">
        <h3 className="panel-title mb-2">บันทึกการประสานงาน</h3>
        <div className="flex flex-col gap-1.5">
          <input
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            maxLength={80}
            placeholder={`ช่องทาง เช่น โทร ${line.number}, วิทยุ, ลงพื้นที่`}
            className="w-full rounded border border-[rgba(37,66,102,0.8)] bg-[#0a1524] px-2.5 py-2 text-[12px] text-ink placeholder:text-ink-muted focus:border-azure focus:outline-none"
          />
          <textarea
            value={contactNote}
            onChange={(e) => setContactNote(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="ผลการติดต่อ เช่น รับสาย ส่งชุดออกแล้ว"
            className="w-full resize-y rounded border border-[rgba(37,66,102,0.8)] bg-[#0a1524] px-2.5 py-2 text-[12px] text-ink placeholder:text-ink-muted focus:border-azure focus:outline-none"
          />
          <div className="flex items-center gap-1.5">
            <input
              value={by}
              onChange={(e) => setBy(e.target.value)}
              maxLength={80}
              placeholder="ผู้บันทึก"
              className="min-w-0 flex-1 rounded border border-[rgba(37,66,102,0.8)] bg-[#0a1524] px-2.5 py-2 text-[12px] text-ink placeholder:text-ink-muted focus:border-azure focus:outline-none"
            />
            <button
              type="button"
              disabled={pending}
              onClick={saveContact}
              className="shrink-0 rounded bg-[#1d4ed8] px-3 py-2 text-[12px] font-medium text-white hover:bg-[#2563eb] disabled:opacity-60"
            >
              บันทึก
            </button>
          </div>
          <p className="text-[10.5px] leading-relaxed text-ink-muted">
            ชื่อผู้บันทึกเป็นข้อความที่พิมพ์เอง ระบบไม่ได้ยืนยันตัวตน
          </p>
        </div>

        {error && (
          <p className="mt-2 flex items-start gap-1.5 text-[11.5px] text-danger">
            <IconAlertTriangle size={14} stroke={2} className="mt-px shrink-0" />
            {error}
          </p>
        )}

        <div className="mt-3 border-t border-[rgba(37,66,102,0.45)] pt-2">
          {log === null ? (
            <p className="flex items-center gap-1.5 text-[11px] text-ink-muted">
              <IconRefresh size={12} stroke={1.8} className="animate-spin" />
              กำลังโหลดประวัติ…
            </p>
          ) : log.length === 0 ? (
            <p className="text-[11px] text-ink-muted">ยังไม่มีบันทึกสำหรับสถานที่นี้</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {log.map((entry) => (
                <li key={entry.id} className="text-[11.5px] leading-snug">
                  <span className="num text-ink-muted">{when(entry.atMs)}</span>{" "}
                  {entry.type === "status" ? (
                    <span style={{ color: FACILITY_STATUS_COLOR[entry.status ?? "unknown"] }}>
                      {FACILITY_STATUS_LABEL[entry.status ?? "unknown"]}
                    </span>
                  ) : entry.type === "edit" ? (
                    <span className="text-amber">
                      แก้ไขข้อมูล{entry.changes ? ` · ${changedFields(entry.changes)}` : ""}
                    </span>
                  ) : (
                    <span className="text-azure">ติดต่อ{entry.channel ? ` · ${entry.channel}` : ""}</span>
                  )}
                  {entry.note && <span className="text-ink-dim"> — {entry.note}</span>}
                  {entry.by && <span className="text-ink-muted"> ({entry.by})</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

/** Which fields one correction touched, in the words the form uses. */
function changedFields(changes: NonNullable<FacilityLogEntry["changes"]>): string {
  const names: string[] = [];
  if (changes.name !== undefined) names.push("ชื่อ");
  if (changes.kind !== undefined) names.push("ประเภท");
  if (changes.phone !== undefined) names.push("เบอร์");
  if (changes.openingHours !== undefined) names.push("เวลาทำการ");
  if (changes.openedOn !== undefined) names.push("วันเริ่มทำการ");
  if (changes.closedOn !== undefined) names.push("วันยกเลิก");
  if (changes.lng !== undefined || changes.lat !== undefined) names.push("ตำแหน่ง");
  return names.join(", ");
}

/** Buddhist-era date and 24-hour clock, as everywhere else in the console. */
function when(atMs: number): string {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "short",
    timeStyle: "short",
    calendar: "buddhist",
    timeZone: "Asia/Bangkok",
  }).format(new Date(atMs));
}
