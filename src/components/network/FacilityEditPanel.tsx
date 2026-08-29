"use client";

import { useMemo, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  IconAlertTriangle,
  IconArrowBackUp,
  IconCircleCheck,
  IconDeviceFloppy,
  IconDragDrop,
} from "@tabler/icons-react";
import {
  FACILITY_COLOR,
  FACILITY_KINDS,
  FACILITY_LABEL,
  facilityName,
  type Facility,
  type FacilityKind,
} from "@/lib/facilities";
import { distanceMetres } from "@/lib/flow/geo-math";
import { editFacility } from "@/server/facility-actions";

/**
 * The same map the case pages use. Client-only: MapLibre touches `window` on
 * import, and it already draws exactly what is wanted here — one point, its
 * uncertainty, and a marker that can be dragged when editing is switched on.
 */
const CaseLocationMap = dynamic(() => import("@/components/cases/CaseLocationMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-[11.5px] text-ink-muted">
      กำลังโหลดแผนที่…
    </div>
  ),
});

/**
 * Correcting one facility.
 *
 * Every field starts at what the record currently says, and only what actually
 * changed is sent — see `editFacility`, which refuses an edit that changes
 * nothing rather than writing an empty correction into the log.
 *
 * Nothing here overwrites the fetched layer. A correction to an OSM record is
 * stored beside it and replayed on read, which is why the panel can say where
 * each value came from: the next `npm run gis:facilities` will not undo this.
 */
export default function FacilityEditPanel({ facility }: { facility: Facility }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [kind, setKind] = useState<FacilityKind>(facility.kind);
  const [name, setName] = useState(facility.nameTh ?? "");
  const [phone, setPhone] = useState(facility.phone ?? "");
  const [hours, setHours] = useState(facility.openingHours ?? "");
  const [openedOn, setOpenedOn] = useState(facility.openedOn ?? "");
  const [closedOn, setClosedOn] = useState(facility.closedOn ?? "");
  const [lng, setLng] = useState(String(facility.lng));
  const [lat, setLat] = useState(String(facility.lat));
  const [note, setNote] = useState("");
  const [by, setBy] = useState("");
  /**
   * Dragging is opt-in.
   *
   * A read-only map that moves the pin on a stray click is how a correct
   * position becomes a wrong one without anybody deciding to change it — the
   * same reason `CaseLocationMap` defaults `editable` to false.
   */
  const [dragging, setDragging] = useState(false);

  /** The pin as the map should draw it — invalid text simply leaves it put. */
  const point = useMemo(() => {
    const nextLng = Number(lng);
    const nextLat = Number(lat);
    return Number.isFinite(nextLng) && Number.isFinite(nextLat)
      ? ([nextLng, nextLat] as [number, number])
      : ([facility.lng, facility.lat] as [number, number]);
  }, [lng, lat, facility.lng, facility.lat]);

  /** How far the pin has been dragged from where the record says it is. */
  const movedM = useMemo(
    () => Math.round(distanceMetres([facility.lng, facility.lat], point)),
    [facility.lng, facility.lat, point],
  );

  function moveTo(next: { lng: number; lat: number }) {
    // Six decimals is ~0.1 m — past what any of these sources can support, and
    // enough that a drag never reads as a jump.
    setLng(next.lng.toFixed(6));
    setLat(next.lat.toFixed(6));
  }

  function submit() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await editFacility({
        facilityId: facility.id,
        // A name is never cleared to empty — an unnamed facility keeps the
        // generated label instead, so the field is only sent when it has text.
        ...(name.trim() ? { name: name.trim() } : {}),
        kind,
        phone: phone.trim() || null,
        openingHours: hours.trim() || null,
        openedOn,
        closedOn,
        lng,
        lat,
        note: note || null,
        by: by || null,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(true);
      setNote("");
      setDragging(false);
      router.refresh();
    });
  }

  return (
    <section className="panel p-3.5">
      <h2 className="panel-title mb-1">แก้ไขข้อมูล</h2>
      <p className="mb-3 text-[10.5px] leading-relaxed text-ink-muted">
        {facility.source === "osm"
          ? "บันทึกเป็นการแก้ไขทับข้อมูล OpenStreetMap — ดึงข้อมูลใหม่แล้วการแก้ไขนี้ยังอยู่"
          : "สถานที่นี้เจ้าหน้าที่เพิ่มเอง การแก้ไขจะถูกบันทึกเป็นประวัติ ไม่ทับของเดิม"}
      </p>

      <div className="mb-3 overflow-hidden rounded-lg border border-[rgba(37,66,102,0.7)]">
        <div className="h-[300px] w-full">
          <CaseLocationMap
            // Keyed on the mode so MapLibre rebuilds the marker layer rather
            // than being asked to swap a GeoJSON dot for a draggable Marker
            // in place.
            key={dragging ? "edit" : "view"}
            lng={point[0]}
            lat={point[1]}
            // A facility position is a locator, not a footprint — 150 m is the
            // same honest radius the read-only view uses.
            precisionM={150}
            color={FACILITY_COLOR[facility.kind]}
            estimated={facility.source === "osm" && movedM === 0}
            editable={dragging}
            onMove={moveTo}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-[rgba(37,66,102,0.6)] px-3 py-2">
          <button
            type="button"
            onClick={() => setDragging((v) => !v)}
            aria-pressed={dragging}
            className={`inline-flex min-h-9 items-center gap-1.5 rounded border px-2.5 text-[11.5px] ${
              dragging
                ? "border-azure bg-[rgba(56,189,248,0.16)] text-azure"
                : "border-[rgba(56,100,150,0.5)] text-ink-dim hover:text-ink"
            }`}
          >
            <IconDragDrop size={14} stroke={1.8} />
            {dragging ? "กำลังแก้ตำแหน่ง — ลากหมุดหรือแตะแผนที่" : "แก้ตำแหน่งด้วยการลากหมุด"}
          </button>

          {movedM > 0 && (
            <>
              <span className="text-[11.5px] text-amber">
                ย้ายแล้ว <span className="num">{movedM.toLocaleString("en-US")}</span> ม.
                จากตำแหน่งเดิม
              </span>
              <button
                type="button"
                onClick={() => {
                  setLng(String(facility.lng));
                  setLat(String(facility.lat));
                }}
                className="inline-flex min-h-9 items-center gap-1.5 text-[11.5px] text-ink-muted hover:text-ink"
              >
                <IconArrowBackUp size={14} stroke={1.8} />
                คืนตำแหน่งเดิม
              </button>
            </>
          )}

          <span className="ml-auto text-[10.5px] text-ink-muted">
            ตำแหน่งใหม่จะยังไม่ถูกบันทึกจนกว่าจะกด &ldquo;บันทึกการแก้ไข&rdquo;
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <Field label="ชื่อสถานที่">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={160}
            placeholder={facilityName(facility)}
            className="cz-field"
          />
        </Field>

        <Field label="ประเภท">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as FacilityKind)}
            className="cz-field cz-select"
          >
            {FACILITY_KINDS.map((k) => (
              <option key={k} value={k}>
                {FACILITY_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="เบอร์ตรงของหน่วย" hint="เว้นว่างได้ ถ้าไม่มี">
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            maxLength={60}
            inputMode="tel"
            placeholder="073-xxxxxx"
            className="cz-field num"
          />
        </Field>

        <Field label="เวลาทำการ" hint="เช่น 24/7 หรือ Mo-Fr 08:30-16:30">
          <input
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            maxLength={120}
            className="cz-field"
          />
        </Field>

        <Field label="วันที่เริ่มทำการ/ก่อตั้ง" hint="ปี ค.ศ. — เว้นว่างได้ถ้าไม่ทราบ">
          <input
            type="date"
            value={openedOn}
            onChange={(e) => setOpenedOn(e.target.value)}
            max="2100-12-31"
            className="cz-field num"
          />
        </Field>

        <Field label="วันที่สิ้นสุดทำการ/ยกเลิก" hint="กรอกเมื่อหน่วยนี้ปิดถาวรแล้ว">
          <input
            type="date"
            value={closedOn}
            onChange={(e) => setClosedOn(e.target.value)}
            max="2100-12-31"
            className="cz-field num"
          />
        </Field>

        <Field label="ลองจิจูด (E)" hint="พิมพ์เองหรือลากหมุดก็ได้ — ค่าตรงกันเสมอ">
          <input
            value={lng}
            onChange={(e) => setLng(e.target.value)}
            inputMode="decimal"
            className="cz-field num"
          />
        </Field>

        <Field label="ละติจูด (N)" hint="ย้ายจุดแล้วระบบจะอ่านอำเภอใหม่ให้เองตอนบันทึก">
          <input
            value={lat}
            onChange={(e) => setLat(e.target.value)}
            inputMode="decimal"
            className="cz-field num"
          />
        </Field>
      </div>

      <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <Field label="เหตุผลที่แก้" hint="จะแสดงในประวัติ">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder="เช่น ย้ายที่ตั้งใหม่เมื่อปีที่แล้ว"
            className="cz-field"
          />
        </Field>

        <Field label="ผู้แก้ไข" hint="ระบบไม่ได้ยืนยันตัวตน">
          <input
            value={by}
            onChange={(e) => setBy(e.target.value)}
            maxLength={80}
            className="cz-field"
          />
        </Field>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="cz-btn bg-[#1d4ed8] text-white hover:bg-[#2563eb] disabled:opacity-60"
        >
          <IconDeviceFloppy size={16} stroke={1.8} />
          บันทึกการแก้ไข
        </button>
        {saved && !error && (
          <span className="flex items-center gap-1.5 text-[12px] text-mint">
            <IconCircleCheck size={15} stroke={2} />
            บันทึกแล้ว
          </span>
        )}
      </div>

      {error && (
        <p className="mt-2 flex items-start gap-1.5 text-[12px] text-danger">
          <IconAlertTriangle size={14} stroke={2} className="mt-px shrink-0" />
          {error}
        </p>
      )}
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="min-w-0 block">
      <span className="cz-label">{label}</span>
      {hint && <span className="cz-hint mb-1 -mt-0.5 block">{hint}</span>}
      {children}
    </label>
  );
}
