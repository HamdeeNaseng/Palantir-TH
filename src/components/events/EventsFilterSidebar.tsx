"use client";

import { IconCalendar } from "@tabler/icons-react";
import FilterShell from "@/components/layout/FilterShell";
import { Check, Section, SectionAction, toggle } from "@/components/filters/FilterSection";
import EventTypeFilter, { countsByType } from "@/components/filters/EventTypeFilter";
import { PROVINCES } from "@/lib/geo";
import {
  DEFAULT_FILTERS,
  RANGE_OPTIONS,
  type InvestigationFilters,
} from "@/lib/filters";
import { fromInputDateTime, toInputDateTime } from "@/lib/datetime";
import { useFilterDraft } from "@/lib/use-filter-draft";
import type { EventsWorkspace as EventsWorkspaceData } from "@/lib/view-models/events";
import type { ProvinceCode, VerificationStatus } from "@/lib/types";

/**
 * Filters for `/events` — the same `InvestigationFilters` URL grammar, and now
 * literally the same parts `/investigate`'s sidebar is built from: `Section`,
 * `Check` and the "ประเภทเหตุ" chip grid all live in `@/components/filters`,
 * so the one filter a reader meets on both tabs cannot drift between them
 * again. What stays local to this page is the facet counts it feeds those
 * parts and the NOT URL-persisted "การตั้งค่าการเล่น" section — the playhead
 * is ephemeral session state, not a filter.
 *
 * Applying no longer navigates. `onApply` hands the selection to
 * `EventsWorkspace`, which re-derives the page from the dataset already in the
 * browser; the URL still updates, but through the History API rather than a
 * round trip. See `@/lib/use-local-filters`.
 */

export default function EventsFilterSidebar({
  initial,
  facets,
  onApply,
  live = false,
  onReset,
  pending = false,
  footerNote,
  playbackStartMs,
  playbackEndMs,
  spanStartMs,
  spanEndMs,
  onPlaybackRangeChange,
  autoPlay,
  onAutoPlayChange,
}: {
  initial: InvestigationFilters;
  facets: EventsWorkspaceData["facets"];
  onApply: (filters: InvestigationFilters) => void;
  /** Applies each change as it is made — see `useFilterDraft`. */
  live?: boolean;
  onReset: () => void;
  pending?: boolean;
  footerNote?: React.ReactNode;
  playbackStartMs: number;
  playbackEndMs: number;
  spanStartMs: number;
  spanEndMs: number;
  onPlaybackRangeChange: (startMs: number, endMs: number) => void;
  autoPlay: boolean;
  onAutoPlayChange: (v: boolean) => void;
}) {
  const { filters: f, patch, apply, reset } = useFilterDraft({
    initial,
    live,
    onApply,
    onReset,
  });

  const activeCount =
    (f.range !== DEFAULT_FILTERS.range ? 1 : 0) +
    (f.provinces.length !== DEFAULT_FILTERS.provinces.length ? 1 : 0) +
    f.eventTypes.length +
    (f.verification.length !== DEFAULT_FILTERS.verification.length ? 1 : 0) +
    (f.sourceId !== DEFAULT_FILTERS.sourceId ? 1 : 0) +
    (f.trustedOnly !== DEFAULT_FILTERS.trustedOnly ? 1 : 0);

  return (
    <FilterShell
      title="ตัวกรองเหตุการณ์"
      resetLabel="รีเซ็ต"
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
          {facets.provinces.map((p) => (
            <Check
              key={p.code}
              label={p.label}
              count={p.n}
              checked={f.provinces.includes(p.code)}
              onChange={() => patch({ provinces: toggle<ProvinceCode>(f.provinces, p.code) })}
            />
          ))}
        </Section>

        <EventTypeFilter
          selected={f.eventTypes}
          onChange={(eventTypes) => patch({ eventTypes })}
          counts={countsByType(facets.eventTypes)}
        />

        <Section title="สถานะการยืนยัน">
          {facets.verification.map((v) => (
            <Check
              key={v.value}
              label={v.label}
              count={v.n}
              checked={f.verification.includes(v.value)}
              onChange={() =>
                patch({ verification: toggle<VerificationStatus>(f.verification, v.value) })
              }
            />
          ))}
        </Section>

        <Section title="การตั้งค่าการเล่น">
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-[11px] text-ink-muted">
              <span className="w-12 shrink-0">เริ่มจาก</span>
              <input
                type="datetime-local"
                value={toInputDateTime(new Date(playbackStartMs))}
                min={toInputDateTime(new Date(spanStartMs))}
                max={toInputDateTime(new Date(playbackEndMs))}
                onChange={(e) => {
                  if (!e.target.value) return;
                  onPlaybackRangeChange(fromInputDateTime(e.target.value).getTime(), playbackEndMs);
                }}
                className="num min-h-11 min-w-0 flex-1 rounded border border-[rgba(37,66,102,0.7)] bg-[#0a1524] px-2 py-1 text-[16px] text-ink focus:border-azure focus:outline-none lg:min-h-0 lg:text-[11px]"
              />
            </label>
            <label className="flex items-center gap-2 text-[11px] text-ink-muted">
              <span className="w-12 shrink-0">สิ้นสุด</span>
              <input
                type="datetime-local"
                value={toInputDateTime(new Date(playbackEndMs))}
                min={toInputDateTime(new Date(playbackStartMs))}
                max={toInputDateTime(new Date(spanEndMs))}
                onChange={(e) => {
                  if (!e.target.value) return;
                  onPlaybackRangeChange(playbackStartMs, fromInputDateTime(e.target.value).getTime());
                }}
                className="num min-h-11 min-w-0 flex-1 rounded border border-[rgba(37,66,102,0.7)] bg-[#0a1524] px-2 py-1 text-[16px] text-ink focus:border-azure focus:outline-none lg:min-h-0 lg:text-[11px]"
              />
            </label>
          </div>

          <label className="filter-row mt-3 justify-between">
            เล่นอัตโนมัติ
            <input
              type="checkbox"
              checked={autoPlay}
              onChange={() => onAutoPlayChange(!autoPlay)}
              className="peer sr-only"
            />
            <span className="relative h-4 w-8 shrink-0 rounded-full bg-[rgba(56,100,150,0.4)] transition-colors peer-checked:bg-azure after:absolute after:top-0.5 after:left-0.5 after:h-3 after:w-3 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-4" />
          </label>
        </Section>
    </FilterShell>
  );
}
