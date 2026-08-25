"use client";

import { useState } from "react";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { SeverityPill } from "@/components/investigate/MidPanels";
import { SEVERITY_LABEL, VERIFICATION_LABEL } from "@/lib/labels";
import { VERIFICATION_COLOR } from "@/lib/palette";
import { formatThaiDate } from "@/lib/datetime";
import type { EventFeature } from "@/server/shared-events";

const PAGE_SIZE = 5;

/**
 * "ลำดับเหตุการณ์ล่าสุดที่เล่น" — same table conventions as `/investigate`'s
 * `RecentEventsPanel` (including its honest-null `SeverityPill`), but the rows
 * are whatever the playhead has reached so far, not just "most recent by date".
 */
export default function RecentPlayedPanel({ played }: { played: EventFeature[] }) {
  const [page, setPage] = useState(0);
  const rows = [...played].sort((a, b) => b.properties.ts - a.properties.ts);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const clampedPage = Math.min(page, pageCount - 1);
  const pageRows = rows.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE);

  return (
    <section className="panel flex flex-col">
      <header className="border-b border-[rgba(37,66,102,0.45)] px-3.5 py-2.5">
        <h3 className="panel-title">ลำดับเหตุการณ์ล่าสุดที่เล่น</h3>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {pageRows.length === 0 ? (
          <p className="px-3.5 py-6 text-center text-[11.5px] text-ink-muted">
            ยังไม่มีเหตุการณ์ในช่วงที่เล่นไปแล้ว
          </p>
        ) : (
          <table className="w-full border-separate border-spacing-0">
            <thead className="sticky top-0 bg-[#0b1524]">
              <tr className="text-[10.5px] text-ink-muted">
                <th className="px-3.5 py-1.5 text-left font-normal">วันที่</th>
                <th className="py-1.5 text-left font-normal">จังหวัด</th>
                <th className="py-1.5 text-left font-normal">ประเภทเหตุ</th>
                <th className="px-3.5 py-1.5 text-left font-normal">สถานะยืนยัน</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => {
                const p = r.properties;
                const color = VERIFICATION_COLOR[p.verification];
                return (
                  <tr key={p.id} className="border-t border-[rgba(37,66,102,0.3)]">
                    <td className="num px-3.5 py-[7px] text-[11px] whitespace-nowrap text-ink-dim">
                      {formatThaiDate(new Date(p.ts))}
                    </td>
                    <td className="py-[7px] text-[11.5px] whitespace-nowrap text-ink-dim">{p.province}</td>
                    <td className="py-[7px] whitespace-nowrap">
                      <SeverityPill
                        level={p.severity_known ? p.severity : 0}
                        label={p.severity_known ? SEVERITY_LABEL[p.severity] : "ไม่ระบุ"}
                      />
                    </td>
                    <td className="px-3.5 py-[7px] whitespace-nowrap">
                      <span
                        className="chip"
                        style={{ color, borderColor: `${color}66`, background: `${color}1f` }}
                      >
                        {VERIFICATION_LABEL[p.verification]}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <footer className="flex items-center justify-between border-t border-[rgba(37,66,102,0.45)] px-3.5 py-1.5">
        <span className="num text-[10.5px] text-ink-muted">
          {rows.length === 0 ? 0 : clampedPage * PAGE_SIZE + 1}-
          {Math.min(rows.length, (clampedPage + 1) * PAGE_SIZE)} จาก {rows.length.toLocaleString("en-US")} เหตุการณ์
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="หน้าก่อนหน้า"
            disabled={clampedPage === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="flex h-5 w-5 items-center justify-center rounded border border-[rgba(56,100,150,0.5)] text-ink-dim disabled:opacity-30"
          >
            <IconChevronLeft size={12} stroke={2} />
          </button>
          <span className="num px-1 text-[10.5px] text-ink-dim">{clampedPage + 1}</span>
          <button
            type="button"
            aria-label="หน้าถัดไป"
            disabled={clampedPage >= pageCount - 1}
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            className="flex h-5 w-5 items-center justify-center rounded border border-[rgba(56,100,150,0.5)] text-ink-dim disabled:opacity-30"
          >
            <IconChevronRight size={12} stroke={2} />
          </button>
        </div>
      </footer>
    </section>
  );
}
