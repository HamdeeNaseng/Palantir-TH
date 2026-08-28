"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconCalendar, IconChevronDown } from "@tabler/icons-react";
import FilterShell from "@/components/layout/FilterShell";
import { PROVINCES } from "@/lib/geo";
import { EVENT_COLOR } from "@/lib/palette";
import { EVENT_FAMILY_LABEL, EVENT_TYPE_LABEL } from "@/lib/labels";
import {
  DEFAULT_FILTERS,
  RANGE_OPTIONS,
  serializeFilters,
  type InvestigationFilters,
} from "@/lib/filters";
import { EVENT_FAMILIES, typesInFamily } from "@/lib/types";
import type { EventType, ProvinceCode, VerificationStatus } from "@/lib/types";

/**
 * Every category, grouped by family. Derived from the vocabulary rather than
 * listed here: this used to be a second, hand-kept copy of the labels, and it
 * had already drifted from `EVENT_TYPE_LABEL` in two places before the list
 * grew to seventeen.
 */
const EVENT_TYPE_GROUPS = EVENT_FAMILIES.map((family) => ({
  family,
  label: EVENT_FAMILY_LABEL[family],
  types: typesInFamily(family),
}));

const VERIFICATION_OPTIONS: { value: VerificationStatus; label: string }[] = [
  { value: "verified", label: "ยืนยันแล้ว" },
  { value: "under_review", label: "อยู่ระหว่างตรวจสอบ" },
  { value: "unverifiable", label: "ยังไม่สามารถยืนยันได้" },
];

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-[rgba(37,66,102,0.45)] px-3.5 py-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[12px] font-medium text-ink-dim">{title}</h3>
        <div className="flex items-center gap-1.5">
          {action}
          <IconChevronDown size={13} stroke={2} className="text-ink-muted" />
        </div>
      </div>
      {children}
    </div>
  );
}

function Check({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <label className="filter-row">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="filter-box"
      />
      {label}
    </label>
  );
}

export default function FilterSidebar({ initial }: { initial: InvestigationFilters }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [f, setF] = useState<InvestigationFilters>(initial);

  const patch = (next: Partial<InvestigationFilters>) => setF((prev) => ({ ...prev, ...next }));

  const apply = () => {
    startTransition(() => router.push(`/investigate?${serializeFilters(f)}`, { scroll: false }));
  };

  const reset = () => {
    setF(DEFAULT_FILTERS);
    startTransition(() => router.push("/investigate", { scroll: false }));
  };

  // What the closed drawer reports on a phone: how far this view has been
  // narrowed away from the defaults, not how many boxes happen to be ticked.
  const activeCount =
    (f.range !== DEFAULT_FILTERS.range ? 1 : 0) +
    (f.provinces.length !== DEFAULT_FILTERS.provinces.length ? 1 : 0) +
    f.eventTypes.length +
    (f.verification.length !== DEFAULT_FILTERS.verification.length ? 1 : 0) +
    (f.sourceId !== DEFAULT_FILTERS.sourceId ? 1 : 0) +
    (f.trustedOnly !== DEFAULT_FILTERS.trustedOnly ? 1 : 0);

  return (
    <FilterShell
      title="ตัวกรอง"
      resetLabel="ล้างตัวกรอง"
      onReset={reset}
      onApply={apply}
      pending={pending}
      activeCount={activeCount}
    >
        <Section title="ช่วงเวลา">
          <div className="overflow-hidden rounded border border-[rgba(37,66,102,0.6)]">
            {RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => patch({ range: opt.value })}
                aria-pressed={opt.value === f.range}
                className="filter-option"
              >
                {opt.label}
              </button>
            ))}
            <div className="flex items-center justify-end border-t border-[rgba(37,66,102,0.6)] px-2.5 py-1.5">
              <IconCalendar size={13} stroke={1.8} className="text-ink-muted" />
            </div>
          </div>
        </Section>

        <Section
          title="จังหวัด"
          action={
            <button
              type="button"
              onClick={() => patch({ provinces: PROVINCES.map((p) => p.code) })}
              className="rounded border border-[rgba(56,100,150,0.5)] px-1.5 py-0.5 text-[10px] text-ink-muted hover:text-ink"
            >
              เลือกทั้งหมด
            </button>
          }
        >
          {PROVINCES.map((p) => (
            <Check
              key={p.code}
              label={p.name}
              checked={f.provinces.includes(p.code)}
              onChange={() => patch({ provinces: toggle<ProvinceCode>(f.provinces, p.code) })}
            />
          ))}
          <Check
            label="อื่น ๆ 3 จังหวัด"
            checked={f.provinces.includes("other")}
            onChange={() => patch({ provinces: toggle<ProvinceCode>(f.provinces, "other") })}
          />
        </Section>

        <Section
          title="ประเภทเหตุ"
          action={
            <button
              type="button"
              onClick={() => patch({ eventTypes: [] })}
              className="rounded border border-[rgba(56,100,150,0.5)] px-1.5 py-0.5 text-[10px] text-ink-muted hover:text-ink"
            >
              เลือกทั้งหมด
            </button>
          }
        >
          <div className="flex flex-wrap gap-1.5">
            {EVENT_TYPE_GROUPS.map((g) => (
              <div key={g.family} className="w-full">
                <p className="mt-1 mb-1 text-[10px] text-ink-muted first:mt-0">{g.label}</p>
                <div className="flex flex-wrap gap-1.5">
                  {g.types.map((t) => {
                    const on = f.eventTypes.includes(t);
                    const color = EVENT_COLOR[t];
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => patch({ eventTypes: toggle<EventType>(f.eventTypes, t) })}
                        className="chip min-h-9 px-3 text-[12.5px] lg:min-h-0 lg:px-2 lg:text-[11px]"
                        style={{
                          color,
                          borderColor: on ? color : `${color}55`,
                          background: on ? `${color}26` : "transparent",
                        }}
                      >
                        {EVENT_TYPE_LABEL[t]}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="สถานะการยืนยัน">
          {VERIFICATION_OPTIONS.map((v) => (
            <Check
              key={v.value}
              label={v.label}
              checked={f.verification.includes(v.value)}
              onChange={() =>
                patch({ verification: toggle<VerificationStatus>(f.verification, v.value) })
              }
            />
          ))}
        </Section>

        <Section title="แหล่งข้อมูล">
          <div className="relative">
            <select
              value={f.sourceId}
              onChange={(e) => patch({ sourceId: e.target.value })}
              className="min-h-11 w-full appearance-none rounded border border-[rgba(37,66,102,0.7)] bg-[#0a1524] px-2.5 py-1.5 text-[16px] text-ink-dim focus:border-azure focus:outline-none lg:min-h-0 lg:text-[12px]"
            >
              <option value="all">ทั้งหมด</option>
              <option value="src_dsi_wcid">DSI-WCID</option>
              <option value="src_acled">ACLED</option>
              <option value="src_ucdp">UCDP GED</option>
              <option value="src_isoc4">กอ.รมน.ภาค 4 สน.</option>
              <option value="src_local_news">ข่าวท้องถิ่น</option>
              <option value="src_thaipbs">Thai PBS</option>
              <option value="src_citizen">รายงานประชาชน</option>
            </select>
            <IconChevronDown
              size={13}
              stroke={2}
              className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-ink-muted"
            />
          </div>

          <label className="filter-row mt-3 justify-between">
            เฉพาะแหล่งข้อมูลที่เชื่อถือได้
            <input
              type="checkbox"
              checked={f.trustedOnly}
              onChange={() => patch({ trustedOnly: !f.trustedOnly })}
              className="sr-only peer"
            />
            <span className="relative h-4 w-8 shrink-0 rounded-full bg-[rgba(56,100,150,0.4)] transition-colors peer-checked:bg-azure after:absolute after:top-0.5 after:left-0.5 after:h-3 after:w-3 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-4" />
          </label>
        </Section>
    </FilterShell>
  );
}
