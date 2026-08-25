"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconCalendar, IconChevronDown, IconFilter, IconLoader2 } from "@tabler/icons-react";
import { PROVINCES } from "@/lib/geo";
import {
  DEFAULT_FILTERS,
  RANGE_OPTIONS,
  serializeFilters,
  type InvestigationFilters,
} from "@/lib/filters";
import { fromInputDateTime, toInputDateTime } from "@/lib/datetime";
import type { EventsWorkspace as EventsWorkspaceData } from "@/server/events";
import type { EventType, ProvinceCode, VerificationStatus } from "@/lib/types";

/**
 * Filters for `/events` — the same `InvestigationFilters` URL grammar and
 * Section/Check markup `/investigate`'s sidebar uses (that file doesn't
 * export them, and they're ~40 lines of pure presentation, not worth a
 * cross-page dependency to share), plus facet counts from the server and a
 * new, NOT URL-persisted "การตั้งค่าการเล่น" section — the playhead is
 * ephemeral session state, not a filter.
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
    <label className="flex cursor-pointer items-center gap-2 py-[3px] text-[12px] text-ink-dim hover:text-ink">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="h-3.5 w-3.5 shrink-0 appearance-none rounded-[3px] border border-[rgba(90,140,190,0.7)] bg-transparent checked:border-azure checked:bg-azure checked:after:block checked:after:text-[10px] checked:after:leading-[13px] checked:after:font-bold checked:after:text-[#04070e] checked:after:content-['✓']"
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
  playbackStartMs: number;
  playbackEndMs: number;
  spanStartMs: number;
  spanEndMs: number;
  onPlaybackRangeChange: (startMs: number, endMs: number) => void;
  autoPlay: boolean;
  onAutoPlayChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [f, setF] = useState<InvestigationFilters>(initial);

  const patch = (next: Partial<InvestigationFilters>) => setF((prev) => ({ ...prev, ...next }));

  const apply = () =>
    startTransition(() => router.push(`/events?${serializeFilters(f)}`, { scroll: false }));

  const reset = () => {
    setF(DEFAULT_FILTERS);
    startTransition(() => router.push("/events", { scroll: false }));
  };

  return (
    <aside className="flex w-[188px] shrink-0 flex-col border-r border-[rgba(37,66,102,0.55)] bg-[#070e1b]">
      <div className="flex items-center justify-between border-b border-[rgba(37,66,102,0.55)] px-3.5 py-2.5">
        <h2 className="text-[13px] font-semibold text-ink">ตัวกรองเหตุการณ์</h2>
        <button
          type="button"
          onClick={reset}
          className="rounded border border-[rgba(56,100,150,0.5)] px-1.5 py-0.5 text-[10.5px] text-ink-muted hover:text-ink"
        >
          รีเซ็ต
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title="ช่วงเวลา">
          <div className="overflow-hidden rounded border border-[rgba(37,66,102,0.6)]">
            {RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => patch({ range: opt.value })}
                className={
                  opt.value === f.range
                    ? "block w-full bg-[rgba(56,189,248,0.16)] px-2.5 py-1.5 text-left text-[12px] text-ink"
                    : "block w-full px-2.5 py-1.5 text-left text-[12px] text-ink-dim hover:bg-[rgba(56,189,248,0.07)]"
                }
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
                className="num min-w-0 flex-1 rounded border border-[rgba(37,66,102,0.7)] bg-[#0a1524] px-2 py-1 text-[11px] text-ink focus:border-azure focus:outline-none"
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
                className="num min-w-0 flex-1 rounded border border-[rgba(37,66,102,0.7)] bg-[#0a1524] px-2 py-1 text-[11px] text-ink focus:border-azure focus:outline-none"
              />
            </label>
          </div>

          <label className="mt-3 flex cursor-pointer items-center justify-between gap-2 text-[11.5px] text-ink-dim">
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
      </div>

      <div className="border-t border-[rgba(37,66,102,0.55)] p-3">
        <button
          type="button"
          onClick={apply}
          disabled={pending}
          className="flex w-full items-center justify-center gap-2 rounded bg-[#1d4ed8] py-2 text-[12.5px] font-medium text-white transition-colors hover:bg-[#2563eb] disabled:opacity-70"
        >
          {pending ? (
            <IconLoader2 size={14} stroke={2} className="animate-spin" />
          ) : (
            <IconFilter size={14} stroke={1.8} />
          )}
          ใช้ตัวกรอง
        </button>
      </div>
    </aside>
  );
}
