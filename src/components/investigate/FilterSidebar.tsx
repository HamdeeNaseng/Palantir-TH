"use client";

import { IconCalendar, IconChevronDown } from "@tabler/icons-react";
import FilterShell from "@/components/layout/FilterShell";
import { Check, Section, SectionAction, toggle } from "@/components/filters/FilterSection";
import EventTypeFilter from "@/components/filters/EventTypeFilter";
import { PROVINCES } from "@/lib/geo";
import { useFilterDraft } from "@/lib/use-filter-draft";
import {
  DEFAULT_FILTERS,
  RANGE_OPTIONS,
  type InvestigationFilters,
} from "@/lib/filters";
import type { SourceFacet } from "@/lib/view-models/investigate";
import type { ProvinceCode, VerificationStatus } from "@/lib/types";

const VERIFICATION_OPTIONS: { value: VerificationStatus; label: string }[] = [
  { value: "verified", label: "ยืนยันแล้ว" },
  { value: "under_review", label: "อยู่ระหว่างตรวจสอบ" },
  { value: "unverifiable", label: "ยังไม่สามารถยืนยันได้" },
];

/**
 * Applying no longer navigates: `onApply` hands the selection to
 * `InvestigateWorkspace`, which rebuilds the dashboard from the dataset
 * already cached in the browser. See `@/lib/use-local-filters`.
 */
export default function FilterSidebar({
  initial,
  sources,
  onApply,
  live = false,
  onReset,
  pending = false,
  footerNote,
}: {
  initial: InvestigationFilters;
  /** From `source_registry`, with counts — never a hand-written list. */
  sources: SourceFacet[];
  onApply: (filters: InvestigationFilters) => void;
  /** Applies each change as it is made — see `useFilterDraft`. */
  live?: boolean;
  onReset: () => void;
  pending?: boolean;
  footerNote?: React.ReactNode;
}) {
  const { filters: f, patch, apply, reset } = useFilterDraft({
    initial,
    live,
    onApply,
    onReset,
  });

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
      live={live}
      pending={pending}
      activeCount={activeCount}
      footerNote={footerNote}
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
            <SectionAction onClick={() => patch({ provinces: PROVINCES.map((p) => p.code) })}>
              เลือกทั้งหมด
            </SectionAction>
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

        <EventTypeFilter
          selected={f.eventTypes}
          onChange={(eventTypes) => patch({ eventTypes })}
        />

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
              {/* Straight from `source_registry`, with the count each one
                  would match. The seven ids hard-coded here before had drifted
                  so far that every single option filtered the page to zero:
                  five of them are not in the registry at all, and the other
                  two are on no event. */}
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label} ({s.n.toLocaleString("en-US")})
                </option>
              ))}
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
