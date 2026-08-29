"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { IconHistory, IconMapPinPlus, IconSearch, IconX } from "@tabler/icons-react";
import FilterShell from "@/components/layout/FilterShell";
import { Check, Section, SectionAction, toggle } from "@/components/filters/FilterSection";
import FacilityDetail from "./FacilityDetail";
import AddFacilityPanel from "./AddFacilityPanel";
import { PROVINCES } from "@/lib/geo";
import {
  EMERGENCY_LINE,
  FACILITY_COLOR,
  FACILITY_ICON,
  FACILITY_KINDS,
  FACILITY_LABEL,
  FACILITY_STATUS_COLOR,
  FACILITY_STATUS_LABEL,
  facilityName,
  HISTORICAL_STATE_LABEL,
  stateOn,
  thaiDate,
  type Facility,
  type FacilityKind,
  type FacilityStatus,
  type HistoricalState,
} from "@/lib/facilities";
import type { NetworkData } from "@/server/facilities";

/**
 * `/network` — the response network: who can be sent, where they are, whether
 * they are open, and how to reach them.
 *
 * Filtering is entirely client-side and deliberately so: the whole list is a
 * few hundred rows and arrives with the page, so a checkbox costs a re-render
 * rather than a round trip. The URL is not the input here (unlike
 * `/investigate` and `/events`) because there is no expensive server query to
 * name — a shared link to "the fire stations in ยะลา" would be re-deriving in
 * the browser either way.
 *
 * The map is loaded client-side only: MapLibre touches `window` on import, and
 * the list beside it is the part worth server-rendering.
 */

const FacilityMap = dynamic(() => import("./FacilityMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-[11.5px] text-ink-muted">
      กำลังโหลดแผนที่…
    </div>
  ),
});

const STATUSES: FacilityStatus[] = ["open", "closed", "unknown"];

export default function NetworkWorkspace({ data }: { data: NetworkData }) {
  const [kinds, setKinds] = useState<FacilityKind[]>([]);
  const [provinces, setProvinces] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<FacilityStatus[]>([]);
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  /**
   * "As of" — the day the network is being asked about. Empty means today,
   * which is the same as no historical filter at all.
   */
  const [asOf, setAsOf] = useState("");
  /**
   * Only a handful of records carry a founding date, so a historical view that
   * dropped the undated ones would show three hospitals in 2010 and read as a
   * finding rather than as missing data. They are kept by default and counted
   * separately, and this switch is how someone narrows to what is actually
   * evidenced.
   */
  const [datedOnly, setDatedOnly] = useState(false);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data.facilities.filter((f) => {
      if (kinds.length && !kinds.includes(f.kind)) return false;
      if (provinces.length && !provinces.includes(f.provinceCode)) return false;
      if (statuses.length && !statuses.includes(f.status)) return false;
      if (asOf) {
        const state = stateOn(f, asOf);
        if (state === "not_yet" || state === "ended") return false;
        if (state === "unknown" && datedOnly) return false;
      }
      if (!needle) return true;
      return [f.nameTh, f.nameEn, f.district, f.subdistrict, FACILITY_LABEL[f.kind]]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle));
    });
  }, [data.facilities, kinds, provinces, statuses, q, asOf, datedOnly]);

  /** What the "as of" day does to the whole set — shown beside the control. */
  const asOfCounts = useMemo(() => {
    const counts: Record<HistoricalState, number> = {
      active: 0,
      not_yet: 0,
      ended: 0,
      unknown: 0,
    };
    if (!asOf) return counts;
    for (const f of data.facilities) counts[stateOn(f, asOf)] += 1;
    return counts;
  }, [data.facilities, asOf]);

  const selected = useMemo(
    () => data.facilities.find((f) => f.id === selectedId) ?? null,
    [data.facilities, selectedId],
  );

  const activeCount =
    kinds.length + provinces.length + statuses.length + (q.trim() ? 1 : 0) + (asOf ? 1 : 0);

  function reset() {
    setKinds([]);
    setProvinces([]);
    setStatuses([]);
    setQ("");
    setAsOf("");
    setDatedOnly(false);
  }

  return (
    <>
      <FilterShell
        title="ตัวกรองเครือข่าย"
        resetLabel="ล้างตัวกรอง"
        onReset={reset}
        onApply={() => undefined}
        live
        activeCount={activeCount}
        width="lg:w-[204px]"
        footerNote={
          <span>
            ที่ตั้งจาก OpenStreetMap (ODbL) — สถานที่ที่ไม่ปรากฏหมายถึง
            &ldquo;ยังไม่ถูกทำแผนที่&rdquo; ไม่ใช่ &ldquo;ไม่มี&rdquo;
          </span>
        }
      >
        <Section
          title="ประเภทสถานที่"
          action={<SectionAction onClick={() => setKinds([])}>เลือกทั้งหมด</SectionAction>}
        >
          {FACILITY_KINDS.map((kind) => {
            const Icon = FACILITY_ICON[kind];
            return (
              <label key={kind} className="filter-row">
                <input
                  type="checkbox"
                  checked={kinds.includes(kind)}
                  onChange={() => setKinds((list) => toggle(list, kind))}
                  className="filter-box"
                />
                <Icon
                  size={13}
                  strokeWidth={1.9}
                  className="shrink-0"
                  style={{ color: FACILITY_COLOR[kind] }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate">{FACILITY_LABEL[kind]}</span>
                <span className="num shrink-0 text-[10.5px] text-ink-muted">
                  {data.counts.byKind[kind].toLocaleString("en-US")}
                </span>
              </label>
            );
          })}
        </Section>

        <Section
          title="จังหวัด"
          action={<SectionAction onClick={() => setProvinces([])}>เลือกทั้งหมด</SectionAction>}
        >
          {PROVINCES.map((p) => (
            <Check
              key={p.code}
              label={p.name}
              checked={provinces.includes(p.code)}
              onChange={() => setProvinces((list) => toggle(list, p.code))}
            />
          ))}
        </Section>

        <Section title="ย้อนเวลา">
          <p className="cz-hint mb-2 text-[10.5px]">
            ดูว่ามีหน่วยใดอยู่ในพื้นที่ ณ วันนั้น จากวันที่ก่อตั้ง/ยกเลิกที่บันทึกไว้
          </p>
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={asOf}
              onChange={(e) => setAsOf(e.target.value)}
              max="2100-12-31"
              aria-label="ดูเครือข่าย ณ วันที่"
              className="num min-h-9 min-w-0 flex-1 rounded border border-[rgba(37,66,102,0.8)] bg-[#0a1524] px-2 text-[12px] text-ink focus:border-azure focus:outline-none"
            />
            {asOf && (
              <button
                type="button"
                onClick={() => setAsOf("")}
                aria-label="ล้างวันที่"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-[rgba(56,100,150,0.5)] text-ink-muted hover:text-ink"
              >
                <IconX size={14} stroke={2} />
              </button>
            )}
          </div>
          {asOf && (
            <>
              <ul className="mt-2 flex flex-col gap-0.5 text-[10.5px] text-ink-muted">
                <li>
                  {HISTORICAL_STATE_LABEL.active}{" "}
                  <span className="num text-ink-dim">{asOfCounts.active}</span>
                </li>
                <li>
                  {HISTORICAL_STATE_LABEL.not_yet}{" "}
                  <span className="num text-ink-dim">{asOfCounts.not_yet}</span>
                </li>
                <li>
                  {HISTORICAL_STATE_LABEL.ended}{" "}
                  <span className="num text-ink-dim">{asOfCounts.ended}</span>
                </li>
                <li>
                  {HISTORICAL_STATE_LABEL.unknown}{" "}
                  <span className="num text-ink-dim">{asOfCounts.unknown}</span>
                </li>
              </ul>
              <Check
                label="เฉพาะที่มีวันที่บันทึกไว้"
                checked={datedOnly}
                onChange={() => setDatedOnly((v) => !v)}
              />
            </>
          )}
        </Section>

        <Section title="สถานะ">
          {STATUSES.map((s) => (
            <Check
              key={s}
              label={FACILITY_STATUS_LABEL[s]}
              checked={statuses.includes(s)}
              onChange={() => setStatuses((list) => toggle(list, s))}
            />
          ))}
        </Section>
      </FilterShell>

      <main className="flex min-w-0 flex-1 flex-col gap-2 bg-abyss p-2 lg:overflow-hidden">
        {!data.osmLayerPresent && (
          <p className="rounded border border-amber/40 bg-[#211808]/95 px-3 py-1.5 text-[11px] text-amber">
            ยังไม่ได้ดึงชั้นข้อมูลสถานที่ — รัน <code className="font-mono">npm run gis:facilities</code>{" "}
            เพื่อดึงจาก OpenStreetMap (ตอนนี้แสดงเฉพาะที่เจ้าหน้าที่เพิ่มเอง)
          </p>
        )}
        {!data.live && (
          <p className="rounded border border-amber/40 bg-[#211808]/95 px-3 py-1.5 text-[11px] text-amber">
            เชื่อมต่อ MongoDB ไม่ได้ — สถานะและบันทึกการประสานงานจะยังไม่ถูกบันทึก
          </p>
        )}

        {asOf && (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded border border-[rgba(56,189,248,0.4)] bg-[rgba(56,189,248,0.08)] px-3 py-1.5 text-[11px] text-azure">
            <IconHistory size={14} stroke={1.8} className="shrink-0" />
            กำลังดูเครือข่าย ณ {thaiDate(asOf)} — ซ่อนหน่วยที่ยังไม่ก่อตั้ง (
            <span className="num">{asOfCounts.not_yet}</span>) และที่ยกเลิกแล้ว (
            <span className="num">{asOfCounts.ended}</span>)
            {!datedOnly && (
              <span className="text-ink-muted">
                · รวมอีก <span className="num">{asOfCounts.unknown}</span> แห่งที่ไม่ทราบช่วงเวลา
              </span>
            )}
          </p>
        )}

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1fr)_clamp(300px,25vw,360px)]">
          <div className="grid min-h-0 grid-cols-1 gap-2 lg:grid-rows-[minmax(240px,1fr)_minmax(200px,1fr)]">
            <section className="panel min-h-[280px] overflow-hidden lg:min-h-0">
              <FacilityMap facilities={rows} selectedId={selectedId} onSelect={setSelectedId} />
            </section>

            <section className="panel flex min-h-0 flex-col">
              <div className="flex items-center gap-2 border-b border-[rgba(37,66,102,0.45)] px-3.5 py-2.5">
                <div className="min-w-0">
                  <h1 className="panel-title whitespace-nowrap">เครือข่ายตอบสนอง</h1>
                  <p className="num text-[10.5px] text-ink-muted">
                    {rows.length.toLocaleString("en-US")} จาก{" "}
                    {data.counts.total.toLocaleString("en-US")} แห่ง
                    {data.counts.manual > 0 && ` · เพิ่มเอง ${data.counts.manual}`}
                  </p>
                </div>
                <div className="relative ml-auto min-w-0 flex-1 sm:max-w-[280px]">
                  <IconSearch
                    size={14}
                    stroke={1.8}
                    className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-muted"
                  />
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="ค้นหาชื่อ ตำบล อำเภอ"
                    aria-label="ค้นหาสถานที่"
                    className="min-h-9 w-full rounded border border-[rgba(37,66,102,0.8)] bg-[#0a1524] py-1.5 pr-2.5 pl-8 text-[12px] text-ink placeholder:text-ink-muted focus:border-azure focus:outline-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setAdding((v) => !v)}
                  aria-expanded={adding}
                  className="flex min-h-9 shrink-0 items-center gap-1.5 rounded border border-[rgba(56,189,248,0.45)] bg-[rgba(56,189,248,0.1)] px-2.5 text-[11.5px] text-azure"
                >
                  <IconMapPinPlus size={14} stroke={1.8} />
                  เพิ่มสถานที่
                </button>
              </div>

              {adding && <AddFacilityPanel onDone={() => setAdding(false)} />}

              <div className="min-h-0 flex-1 overflow-auto">
                {rows.length === 0 ? (
                  <p className="px-3.5 py-6 text-center text-[12px] text-ink-muted">
                    ไม่พบสถานที่ที่ตรงกับตัวกรอง
                  </p>
                ) : (
                  <table className="w-full border-collapse text-[12px]">
                    <thead className="sticky top-0 z-10 bg-[#0a1220] text-[10.5px] text-ink-muted">
                      <tr>
                        <th className="px-3 py-1.5 text-left font-normal">สถานที่</th>
                        <th className="px-2 py-1.5 text-left font-normal">พื้นที่</th>
                        <th className="px-2 py-1.5 text-left font-normal">สถานะ</th>
                        <th className="px-3 py-1.5 text-right font-normal">ติดต่อ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((f) => (
                        <FacilityRow
                          key={f.id}
                          facility={f}
                          selected={f.id === selectedId}
                          onSelect={() => setSelectedId(f.id)}
                        />
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>
          </div>

          <div className="flex min-h-0 flex-col lg:overflow-hidden">
            {selected ? (
              <FacilityDetail key={selected.id} facility={selected} showOpenLink />
            ) : (
              <section className="panel flex flex-1 items-center justify-center px-6 py-10 text-center">
                <p className="max-w-[220px] text-[12px] leading-relaxed text-ink-muted">
                  เลือกสถานที่จากรายการหรือบนแผนที่ เพื่อดูเบอร์ติดต่อ ปรับสถานะ
                  และบันทึกการประสานงาน
                </p>
              </section>
            )}
          </div>
        </div>
      </main>
    </>
  );
}

function FacilityRow({
  facility,
  selected,
  onSelect,
}: {
  facility: Facility;
  selected: boolean;
  onSelect: () => void;
}) {
  const Icon = FACILITY_ICON[facility.kind];
  const line = EMERGENCY_LINE[facility.kind];
  return (
    <tr
      onClick={onSelect}
      aria-selected={selected}
      className={`cursor-pointer border-b border-[rgba(37,66,102,0.3)] ${
        selected ? "bg-[rgba(56,189,248,0.1)]" : "hover:bg-[rgba(56,189,248,0.05)]"
      }`}
    >
      <td className="px-3 py-1.5">
        <span className="flex items-center gap-1.5">
          <Icon
            size={13}
            strokeWidth={1.9}
            className="shrink-0"
            style={{ color: FACILITY_COLOR[facility.kind] }}
            aria-hidden
          />
          <span className="min-w-0">
            <span className="block truncate text-ink">{facilityName(facility)}</span>
            <span className="block text-[10.5px] text-ink-muted">
              {FACILITY_LABEL[facility.kind]}
            </span>
          </span>
        </span>
      </td>
      <td className="px-2 py-1.5 text-ink-dim">
        อ.{facility.district}
        <span className="block text-[10.5px] text-ink-muted">จ.{facility.province}</span>
      </td>
      <td className="px-2 py-1.5">
        <span
          className="chip"
          style={{
            color: FACILITY_STATUS_COLOR[facility.status],
            borderColor: `${FACILITY_STATUS_COLOR[facility.status]}66`,
            background: `${FACILITY_STATUS_COLOR[facility.status]}1a`,
          }}
        >
          {FACILITY_STATUS_LABEL[facility.status]}
        </span>
        {facility.contactCount > 0 && (
          <span className="num mt-0.5 block text-[10px] text-ink-muted">
            ประสาน {facility.contactCount} ครั้ง
          </span>
        )}
      </td>
      <td className="num px-3 py-1.5 text-right">
        <a
          href={`tel:${line.number}`}
          onClick={(e) => e.stopPropagation()}
          className="text-azure hover:underline"
        >
          {line.number}
        </a>
        {facility.phone && (
          <span className="block text-[10px] text-ink-muted">{facility.phone}</span>
        )}
      </td>
    </tr>
  );
}
