"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconCalendar, IconChevronDown, IconFilter, IconLoader2 } from "@tabler/icons-react";
import { PROVINCES } from "@/lib/geo";
import { EVENT_COLOR } from "@/lib/palette";
import {
  DEFAULT_FILTERS,
  RANGE_OPTIONS,
  serializeFilters,
  type InvestigationFilters,
} from "@/lib/filters";
import type { EventType, ProvinceCode, VerificationStatus } from "@/lib/types";

const EVENT_TYPE_CHIPS: { value: EventType; label: string }[] = [
  { value: "unrest", label: "เหตุไม่สงบ" },
  { value: "shooting", label: "ยิง/ปะทะ" },
  { value: "explosion", label: "ลอบวางระเบิด" },
  { value: "arson", label: "วางเพลิง" },
  { value: "raid", label: "ตรวจค้น/จับกุม" },
  { value: "narcotics", label: "ยาเสพติด" },
  { value: "abduction", label: "ลักพาตัว" },
  { value: "crime", label: "อาชญากรรม" },
  { value: "gang", label: "กิจกรรมกลุ่ม" },
  { value: "other", label: "อื่น ๆ" },
];

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
    <label className="flex cursor-pointer items-center gap-2 py-[3px] text-[12px] text-ink-dim hover:text-ink">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="h-3.5 w-3.5 shrink-0 appearance-none rounded-[3px] border border-[rgba(90,140,190,0.7)] bg-transparent checked:border-azure checked:bg-azure checked:after:block checked:after:text-[10px] checked:after:leading-[13px] checked:after:font-bold checked:after:text-[#04070e] checked:after:content-['✓']"
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

  return (
    <aside className="flex w-[188px] shrink-0 flex-col border-r border-[rgba(37,66,102,0.55)] bg-[#070e1b]">
      <div className="flex items-center justify-between border-b border-[rgba(37,66,102,0.55)] px-3.5 py-2.5">
        <h2 className="text-[13px] font-semibold text-ink">ตัวกรอง</h2>
        <button
          type="button"
          onClick={reset}
          className="rounded border border-[rgba(56,100,150,0.5)] px-1.5 py-0.5 text-[10.5px] text-ink-muted hover:text-ink"
        >
          ล้างตัวกรอง
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
            {EVENT_TYPE_CHIPS.map((c) => {
              const on = f.eventTypes.includes(c.value);
              const color = EVENT_COLOR[c.value];
              return (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => patch({ eventTypes: toggle<EventType>(f.eventTypes, c.value) })}
                  className="chip"
                  style={{
                    color,
                    borderColor: on ? color : `${color}55`,
                    background: on ? `${color}26` : "transparent",
                  }}
                >
                  {c.label}
                </button>
              );
            })}
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
              className="w-full appearance-none rounded border border-[rgba(37,66,102,0.7)] bg-[#0a1524] px-2.5 py-1.5 text-[12px] text-ink-dim focus:border-azure focus:outline-none"
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

          <label className="mt-3 flex cursor-pointer items-center justify-between gap-2 text-[11.5px] text-ink-dim">
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
