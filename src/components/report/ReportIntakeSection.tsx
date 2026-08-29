"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { IconChevronUp, IconLock, IconSpeakerphone, IconClock } from "@tabler/icons-react";
import ReportForm from "./ReportForm";
import type { DistrictOption } from "@/lib/report-form";
import type { ProvinceCode } from "@/lib/types";

/**
 * The one thing on this page a member of the public came here to do.
 *
 * Still collapsed by default — the table below is what an analyst opens
 * `/report` for, and this page serves both — but the closed state is now a
 * proper invitation rather than a row: a plain-language promise of what
 * happens, the two facts that decide whether someone starts at all (no name
 * required, about two minutes), and a button big enough to hit with a thumb.
 * A citizen who cannot tell that this page will take their report is a report
 * that never gets filed.
 */
export default function ReportIntakeSection({
  districtsByProvince,
}: {
  districtsByProvince: Record<ProvinceCode, DistrictOption[]>;
}) {
  const [open, setOpen] = useState(false);
  // Bumping this remounts ReportForm with a blank `useActionState`, which is
  // the only way to clear it — the hook has no reset function of its own.
  const [resetKey, setResetKey] = useState(0);
  const router = useRouter();

  return (
    <section className="panel shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3.5 px-4 py-4 text-left sm:px-5"
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[rgba(56,189,248,0.14)] text-azure">
          <IconSpeakerphone size={21} stroke={1.7} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[17px] leading-snug font-semibold text-ink sm:text-[16px]">
            แจ้งเหตุการณ์ใหม่
          </span>
          <span className="mt-0.5 block text-[14px] leading-relaxed text-ink-dim">
            พบเห็นเหตุการณ์ผิดปกติ? เล่าให้ฟังทีละคำถาม ตอบเท่าที่รู้ก็พอ
          </span>
          <span className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-ink-muted">
            <span className="inline-flex items-center gap-1.5">
              <IconLock size={13} stroke={1.8} />
              ไม่ต้องบอกชื่อหรือเบอร์โทร
            </span>
            <span className="inline-flex items-center gap-1.5">
              <IconClock size={13} stroke={1.8} />
              ใช้เวลาประมาณ 2 นาที
            </span>
          </span>
        </span>
        <span
          className={`flex h-10 shrink-0 items-center gap-1.5 rounded-lg px-3.5 text-[14px] font-medium ${
            open ? "text-ink-dim" : "bg-[#1d4ed8] text-white"
          }`}
        >
          {open ? "ปิด" : "เริ่มแจ้ง"}
          <IconChevronUp
            size={16}
            stroke={2}
            className={`transition-transform ${open ? "" : "rotate-180"}`}
          />
        </span>
      </button>

      {open && (
        <div className="border-t border-[rgba(37,66,102,0.45)]">
          <ReportForm
            key={resetKey}
            districtsByProvince={districtsByProvince}
            onSubmitted={() => {
              // "แจ้งอีกเรื่อง" means what it says — stay open with a blank
              // form, not collapse back to the CTA the user already got past.
              setResetKey((k) => k + 1);
              router.refresh();
            }}
          />
        </div>
      )}
    </section>
  );
}
