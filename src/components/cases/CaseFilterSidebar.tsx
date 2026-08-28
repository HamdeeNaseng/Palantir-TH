"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconChevronDown } from "@tabler/icons-react";
import FilterShell from "@/components/layout/FilterShell";
import { PROVINCE_BY_CODE } from "@/lib/geo";
import {
  DEFAULT_CASE_FILTERS,
  casesHref,
  type CaseFilters,
} from "@/lib/case-filters";
import type { CaseFacets } from "@/server/cases";
import type { EventType, ProvinceCode, VerificationStatus } from "@/lib/types";

/**
 * Filters for the case register.
 *
 * Every option carries the number of records behind it, and those counts are
 * computed with that option's own dimension lifted out of the query (see
 * `buildMatch` in server/cases.ts). So the list still shows what selecting a
 * different province would give you, instead of zeroing out the moment you
 * pick one.
 *
 * The options themselves come from the data too — districts and place types
 * are whatever the sources actually reported, never a hand-written list that
 * can drift away from the collection.
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
        {action}
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
  title,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  count?: number;
  title?: string;
}) {
  return (
    <label
      title={title ?? label}
      className="filter-row"
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="filter-box"
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && (
        <span className="num shrink-0 text-[10.5px] text-ink-muted">
          {count.toLocaleString("en-US")}
        </span>
      )}
    </label>
  );
}

const GhostButton = ({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    className="rounded border border-[rgba(56,100,150,0.5)] px-1.5 py-0.5 text-[10px] text-ink-muted hover:text-ink"
  >
    {children}
  </button>
);

export default function CaseFilterSidebar({
  initial,
  facets,
  span,
  basePath = "/cases",
  hideSourceFilter = false,
}: {
  initial: CaseFilters;
  facets: CaseFacets;
  span: { from: string; to: string } | null;
  basePath?: string;
  /** Hide the source picker where the page already pins one source. */
  hideSourceFilter?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [f, setF] = useState<CaseFilters>(initial);

  // Back/forward and the "ล้างตัวกรอง" chips in the header change the URL
  // without remounting this component; without this the panel would keep
  // showing the filters the user has navigated away from.
  useEffect(() => setF(initial), [initial]);

  const patch = (next: Partial<CaseFilters>) => setF((prev) => ({ ...prev, ...next }));

  const apply = () =>
    startTransition(() => router.push(casesHref(f, { page: 1 }, basePath), { scroll: false }));

  const reset = () => {
    setF({ ...DEFAULT_CASE_FILTERS, sort: f.sort, dir: f.dir });
    startTransition(() => router.push(basePath, { scroll: false }));
  };

  // Only offer districts inside the provinces currently ticked. "อื่น ๆ" has no
  // province name to match on, so its presence means show everything, and an
  // empty province marks a still-selected district that no longer matches
  // anything — hiding that one would hide the checkbox that releases it.
  const selectedNames = new Set(
    f.provinces.map((c) => PROVINCE_BY_CODE.get(c)?.name).filter(Boolean) as string[],
  );
  const districtOptions =
    f.provinces.length === 0 || f.provinces.includes("other")
      ? facets.districts
      : facets.districts.filter((d) => d.province === "" || selectedNames.has(d.province));

  // Counted the way the chip row counts, so the badge on the closed drawer and
  // the removable chips above the table always agree.
  const activeCount =
    (f.q ? 1 : 0) +
    (f.from || f.to ? 1 : 0) +
    f.provinces.length +
    f.districts.length +
    f.eventTypes.length +
    f.verification.length +
    f.placeTypes.length +
    (!hideSourceFilter && f.sourceId !== DEFAULT_CASE_FILTERS.sourceId ? 1 : 0) +
    (f.hasMedia ? 1 : 0);

  return (
    <FilterShell
      title="ตัวกรองเคส"
      resetLabel="ล้างทั้งหมด"
      onReset={reset}
      onApply={apply}
      pending={pending}
      activeCount={activeCount}
      width="lg:w-[212px]"
    >
        <Section
          title="ช่วงวันที่เกิดเหตุ"
          action={
            span ? (
              <GhostButton onClick={() => patch({ from: "", to: "" })}>ทั้งหมด</GhostButton>
            ) : undefined
          }
        >
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-[11px] text-ink-muted">
              <span className="w-8 shrink-0">ตั้งแต่</span>
              <input
                type="date"
                value={f.from}
                min={span?.from}
                max={span?.to}
                onChange={(e) => patch({ from: e.target.value })}
                className="num min-h-11 min-w-0 flex-1 rounded border border-[rgba(37,66,102,0.7)] bg-[#0a1524] px-2 py-1 text-[16px] text-ink focus:border-azure focus:outline-none lg:min-h-0 lg:text-[11.5px]"
              />
            </label>
            <label className="flex items-center gap-2 text-[11px] text-ink-muted">
              <span className="w-8 shrink-0">ถึง</span>
              <input
                type="date"
                value={f.to}
                min={span?.from}
                max={span?.to}
                onChange={(e) => patch({ to: e.target.value })}
                className="num min-h-11 min-w-0 flex-1 rounded border border-[rgba(37,66,102,0.7)] bg-[#0a1524] px-2 py-1 text-[16px] text-ink focus:border-azure focus:outline-none lg:min-h-0 lg:text-[11.5px]"
              />
            </label>
          </div>
          {span && (
            <p className="num mt-2 text-[10px] text-ink-muted">
              บันทึกครอบคลุม {span.from} ถึง {span.to}
            </p>
          )}
        </Section>

        {facets.provinces.length > 0 && (
          <Section
            title="จังหวัด"
            action={<GhostButton onClick={() => patch({ provinces: [], districts: [] })}>ทั้งหมด</GhostButton>}
          >
            {facets.provinces.map((p) => (
              <Check
                key={p.code}
                label={p.label}
                count={p.n}
                checked={f.provinces.includes(p.code)}
                onChange={() =>
                  patch({ provinces: toggle<ProvinceCode>(f.provinces, p.code), districts: [] })
                }
              />
            ))}
          </Section>
        )}

        {districtOptions.length > 0 && (
          <Section
            title={`อำเภอ (${districtOptions.length})`}
            action={<GhostButton onClick={() => patch({ districts: [] })}>ทั้งหมด</GhostButton>}
          >
            <div className="max-h-[188px] overflow-y-auto pr-1">
              {districtOptions.map((d) => (
                <Check
                  key={`${d.province}/${d.name}`}
                  label={d.name}
                  title={`อ.${d.name} จ.${d.province}`}
                  count={d.n}
                  checked={f.districts.includes(d.name)}
                  onChange={() => patch({ districts: toggle(f.districts, d.name) })}
                />
              ))}
            </div>
          </Section>
        )}

        {facets.eventTypes.length > 0 && (
          <Section
            title="ประเภทเหตุ"
            action={<GhostButton onClick={() => patch({ eventTypes: [] })}>ทั้งหมด</GhostButton>}
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

        {facets.verification.length > 0 && (
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
        )}

        {facets.placeTypes.length > 0 && (
          <Section
            title="ประเภทสถานที่"
            action={<GhostButton onClick={() => patch({ placeTypes: [] })}>ทั้งหมด</GhostButton>}
          >
            <div className="max-h-[172px] overflow-y-auto pr-1">
              {facets.placeTypes.map((p) => (
                <Check
                  key={p.value}
                  // The source prefixes every value with "สถานที่"; dropping it
                  // leaves the part that actually distinguishes one from another.
                  label={p.value.replace(/^สถานที่/, "") || "ไม่ระบุประเภท"}
                  title={p.value}
                  count={p.n}
                  checked={f.placeTypes.includes(p.value)}
                  onChange={() => patch({ placeTypes: toggle(f.placeTypes, p.value) })}
                />
              ))}
            </div>
          </Section>
        )}

        <Section title={hideSourceFilter ? "หลักฐาน" : "แหล่งข้อมูล"}>
          {!hideSourceFilter && (
            <div className="relative mb-3">
              <select
                value={f.sourceId}
                onChange={(e) => patch({ sourceId: e.target.value })}
                className="w-full appearance-none rounded border border-[rgba(37,66,102,0.7)] bg-[#0a1524] px-2.5 py-1.5 pr-7 text-[12px] text-ink-dim focus:border-azure focus:outline-none"
              >
                <option value="all">ทั้งหมด</option>
                {facets.sources.map((s) => (
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
          )}

          <label className="filter-row justify-between">
            <span>
              เฉพาะที่มีหลักฐานแนบ
              <span className="num ml-1 text-[10.5px] text-ink-muted">
                {facets.withMedia.toLocaleString("en-US")}
              </span>
            </span>
            <input
              type="checkbox"
              checked={f.hasMedia}
              onChange={() => patch({ hasMedia: !f.hasMedia })}
              className="peer sr-only"
            />
            <span className="relative h-4 w-8 shrink-0 rounded-full bg-[rgba(56,100,150,0.4)] transition-colors after:absolute after:top-0.5 after:left-0.5 after:h-3 after:w-3 after:rounded-full after:bg-white after:transition-transform peer-checked:bg-azure peer-checked:after:translate-x-4" />
          </label>
        </Section>
    </FilterShell>
  );
}
