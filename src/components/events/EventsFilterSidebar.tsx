"use client";

import { IconCalendar, IconChevronDown } from "@tabler/icons-react";
import FilterShell from "@/components/layout/FilterShell";
import { PROVINCES } from "@/lib/geo";
import { EVENT_ICON } from "@/lib/event-icons";
import {
  DEFAULT_FILTERS,
  RANGE_OPTIONS,
  type InvestigationFilters,
} from "@/lib/filters";
import { fromInputDateTime, toInputDateTime } from "@/lib/datetime";
import { useFilterDraft } from "@/lib/use-filter-draft";
import type { EventsWorkspace as EventsWorkspaceData } from "@/lib/view-models/events";
import type { EventType, ProvinceCode, VerificationStatus } from "@/lib/types";

/**
 * Filters for `/events` — the same `InvestigationFilters` URL grammar and
 * Section/Check markup `/investigate`'s sidebar uses (that file doesn't
 * export them, and they're ~40 lines of pure presentation, not worth a
 * cross-page dependency to share), plus facet counts from the server and a
 * new, NOT URL-persisted "การตั้งค่าการเล่น" section — the playhead is
 * ephemeral session state, not a filter.
 *
 * Applying no longer navigates. `onApply` hands the selection to
 * `EventsWorkspace`, which re-derives the page from the dataset already in the
 * browser; the URL still updates, but through the History API rather than a
 * round trip. See `@/lib/use-local-filters`.
 */

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
  count,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  count?: number;
}) {
  return (
    <label className="filter-row">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="filter-box"
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && (
        <span className="num shrink-0 text-[10.5px] text-ink-muted">{count.toLocaleString("en-US")}</span>
      )}
    </label>
  );
}

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
            <button
              type="button"
              onClick={() => patch({ provinces: PROVINCES.map((p) => p.code) })}
              className="rounded border border-[rgba(56,100,150,0.5)] px-1.5 py-0.5 text-[10px] text-ink-muted hover:text-ink"
            >
              เลือกทั้งหมด
            </button>
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

        {facets.eventTypes.length > 0 && (
          <Section
            title="ประเภทเหตุการณ์"
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
              {facets.eventTypes.map((t) => {
                const on = f.eventTypes.includes(t.value);
                const Icon = EVENT_ICON[t.value] ?? EVENT_ICON.other;
                return (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => patch({ eventTypes: toggle<EventType>(f.eventTypes, t.value) })}
                    className="chip"
                    style={{
                      color: t.color,
                      borderColor: on ? t.color : `${t.color}55`,
                      background: on ? `${t.color}26` : "transparent",
                    }}
                  >
                    <Icon size={12} strokeWidth={2} className="shrink-0" aria-hidden />
                    {t.label}
                    <span className="num opacity-70">{t.n.toLocaleString("en-US")}</span>
                  </button>
                );
              })}
            </div>
          </Section>
        )}

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
