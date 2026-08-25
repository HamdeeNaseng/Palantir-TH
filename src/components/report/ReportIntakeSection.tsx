"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { IconChevronUp, IconSpeakerphone } from "@tabler/icons-react";
import ReportForm from "./ReportForm";
import type { DistrictOption } from "@/lib/report-form";
import type { ProvinceCode } from "@/lib/types";

/**
 * Collapsed by default so the table — the thing this page is titled for —
 * is what greets an analyst. The form is one click away, not the first thing
 * on the page, for anyone here to actually file a report.
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
        className="flex w-full items-center gap-2.5 px-4 py-3 text-left"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[rgba(56,189,248,0.14)] text-azure">
          <IconSpeakerphone size={16} stroke={1.8} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium text-ink">แจ้งเหตุการณ์ใหม่</span>
          <span className="block text-[11px] text-ink-muted">
            พบเห็นเหตุการณ์ผิดปกติ? แจ้งข้อมูลได้ที่นี่ — ไม่ต้องระบุตัวตน
          </span>
        </span>
        <IconChevronUp
          size={16}
          stroke={1.8}
          className={`shrink-0 text-ink-muted transition-transform ${open ? "" : "rotate-180"}`}
        />
      </button>

      {open && (
        <div className="border-t border-[rgba(37,66,102,0.45)]">
          <ReportForm
            key={resetKey}
            districtsByProvince={districtsByProvince}
            onSubmitted={() => {
              // "ส่งรายงานอีกฉบับ" means what it says — stay open with a blank
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
