"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconAlertTriangle, IconCircleCheck } from "@tabler/icons-react";
import { FACILITY_KINDS, FACILITY_LABEL, type FacilityKind } from "@/lib/facilities";
import { addFacility } from "@/server/facility-actions";

/**
 * Adding what the fetched layer does not have.
 *
 * The contributed data is thin exactly where an operations desk needs it most
 * — one rescue station and no evacuation centre across four provinces — so
 * this is not a convenience, it is how the layer becomes usable. What is added
 * lands in MongoDB and is marked "เพิ่มโดยเจ้าหน้าที่" everywhere it appears,
 * so a local addition is never mistaken for a surveyed record.
 *
 * The coordinate is typed rather than picked off the map. A picker is better
 * and is worth doing next; a text pair is what makes the feature complete
 * today, and the server resolves the อำเภอ from the point either way — so a
 * coordinate outside the four provinces is refused rather than stored.
 */
export default function AddFacilityPanel({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [kind, setKind] = useState<FacilityKind>("evacuation");
  const [name, setName] = useState("");
  const [lng, setLng] = useState("");
  const [lat, setLat] = useState("");
  const [phone, setPhone] = useState("");
  const [hours, setHours] = useState("");
  const [openedOn, setOpenedOn] = useState("");
  const [closedOn, setClosedOn] = useState("");
  const [by, setBy] = useState("");

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await addFacility({
        kind,
        name,
        lng,
        lat,
        phone: phone || null,
        openingHours: hours || null,
        openedOn,
        closedOn,
        by: by || null,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(true);
      setName("");
      setLng("");
      setLat("");
      setPhone("");
      setHours("");
      setOpenedOn("");
      setClosedOn("");
      router.refresh();
    });
  }

  return (
    <div className="border-b border-[rgba(37,66,102,0.45)] bg-[rgba(10,21,36,0.6)] p-3.5">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="min-w-0">
          <span className="mb-1 block text-[11px] text-ink-dim">ประเภท</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as FacilityKind)}
            className="min-h-9 w-full rounded border border-[rgba(37,66,102,0.8)] bg-[#0a1524] px-2.5 text-[12px] text-ink focus:border-azure focus:outline-none"
          >
            {FACILITY_KINDS.map((k) => (
              <option key={k} value={k}>
                {FACILITY_LABEL[k]}
              </option>
            ))}
          </select>
        </label>

        <label className="min-w-0">
          <span className="mb-1 block text-[11px] text-ink-dim">ชื่อสถานที่</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={160}
            placeholder="เช่น ศูนย์อพยพโรงเรียนบ้านตะโละ"
            className="min-h-9 w-full rounded border border-[rgba(37,66,102,0.8)] bg-[#0a1524] px-2.5 text-[12px] text-ink placeholder:text-ink-muted focus:border-azure focus:outline-none"
          />
        </label>

        <label className="min-w-0">
          <span className="mb-1 block text-[11px] text-ink-dim">ลองจิจูด (E)</span>
          <input
            value={lng}
            onChange={(e) => setLng(e.target.value)}
            inputMode="decimal"
            placeholder="101.2537"
            className="num min-h-9 w-full rounded border border-[rgba(37,66,102,0.8)] bg-[#0a1524] px-2.5 text-[12px] text-ink placeholder:text-ink-muted focus:border-azure focus:outline-none"
          />
        </label>

        <label className="min-w-0">
          <span className="mb-1 block text-[11px] text-ink-dim">ละติจูด (N)</span>
          <input
            value={lat}
            onChange={(e) => setLat(e.target.value)}
            inputMode="decimal"
            placeholder="6.8698"
            className="num min-h-9 w-full rounded border border-[rgba(37,66,102,0.8)] bg-[#0a1524] px-2.5 text-[12px] text-ink placeholder:text-ink-muted focus:border-azure focus:outline-none"
          />
        </label>

        <label className="min-w-0">
          <span className="mb-1 block text-[11px] text-ink-dim">เบอร์ตรง (ถ้ามี)</span>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            maxLength={60}
            inputMode="tel"
            placeholder="073-xxxxxx"
            className="num min-h-9 w-full rounded border border-[rgba(37,66,102,0.8)] bg-[#0a1524] px-2.5 text-[12px] text-ink placeholder:text-ink-muted focus:border-azure focus:outline-none"
          />
        </label>

        <label className="min-w-0">
          <span className="mb-1 block text-[11px] text-ink-dim">วันที่เริ่มทำการ (ถ้าทราบ)</span>
          <input
            type="date"
            value={openedOn}
            onChange={(e) => setOpenedOn(e.target.value)}
            max="2100-12-31"
            className="num min-h-9 w-full rounded border border-[rgba(37,66,102,0.8)] bg-[#0a1524] px-2.5 text-[12px] text-ink focus:border-azure focus:outline-none"
          />
        </label>

        <label className="min-w-0">
          <span className="mb-1 block text-[11px] text-ink-dim">วันที่ยกเลิก (ถ้ามี)</span>
          <input
            type="date"
            value={closedOn}
            onChange={(e) => setClosedOn(e.target.value)}
            max="2100-12-31"
            className="num min-h-9 w-full rounded border border-[rgba(37,66,102,0.8)] bg-[#0a1524] px-2.5 text-[12px] text-ink focus:border-azure focus:outline-none"
          />
        </label>

        <label className="min-w-0">
          <span className="mb-1 block text-[11px] text-ink-dim">เวลาทำการ (ถ้าทราบ)</span>
          <input
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            maxLength={120}
            placeholder="24/7 หรือ Mo-Fr 08:30-16:30"
            className="min-h-9 w-full rounded border border-[rgba(37,66,102,0.8)] bg-[#0a1524] px-2.5 text-[12px] text-ink placeholder:text-ink-muted focus:border-azure focus:outline-none"
          />
        </label>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <input
          value={by}
          onChange={(e) => setBy(e.target.value)}
          maxLength={80}
          placeholder="ผู้เพิ่ม"
          className="min-h-9 min-w-0 flex-1 rounded border border-[rgba(37,66,102,0.8)] bg-[#0a1524] px-2.5 text-[12px] text-ink placeholder:text-ink-muted focus:border-azure focus:outline-none"
        />
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="min-h-9 shrink-0 rounded bg-[#1d4ed8] px-3 text-[12px] font-medium text-white hover:bg-[#2563eb] disabled:opacity-60"
        >
          บันทึกสถานที่
        </button>
        <button
          type="button"
          onClick={onDone}
          className="min-h-9 shrink-0 rounded border border-[rgba(56,100,150,0.6)] px-3 text-[12px] text-ink-dim hover:text-ink"
        >
          ปิด
        </button>
      </div>

      {error && (
        <p className="mt-2 flex items-start gap-1.5 text-[11.5px] text-danger">
          <IconAlertTriangle size={14} stroke={2} className="mt-px shrink-0" />
          {error}
        </p>
      )}
      {saved && !error && (
        <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-mint">
          <IconCircleCheck size={14} stroke={2} />
          บันทึกแล้ว — สถานที่นี้จะขึ้นในรายการทันที
        </p>
      )}
    </div>
  );
}
