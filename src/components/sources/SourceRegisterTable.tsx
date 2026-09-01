import Link from "next/link";
import { IconAlertTriangle, IconExternalLink } from "@tabler/icons-react";
import { ScoreBar } from "@/components/charts/Gauges";
import {
  CONNECTOR_LABEL,
  PRIORITY_COLOR,
  RUN_STATUS_COLOR,
  RUN_STATUS_LABEL,
  SCHEDULE_MODE_LABEL,
  TRUST_CLASS_COLOR,
  TRUST_CLASS_LABEL,
  categoryLabel,
  relativeThai,
} from "@/lib/source-labels";
import type { SourceRow } from "@/server/sources";

/**
 * The register itself: one row per source, sorted by what it contributed.
 *
 * Server-rendered, like `CaseTable` — eleven rows out of MongoDB is nothing a
 * client bundle should be assembling. The one interactive thing on a row is a
 * link into `/cases?src=…`, so "who reported this" and "show me what they
 * reported" stay one click apart.
 *
 * Columns drop out on narrow screens in order of how much they say about the
 * source's *health*: name, contribution and last run survive to the phone,
 * the catalog metadata comes back as the viewport earns it.
 */

const HEAD = "px-3 py-2 text-left text-[10.5px] font-normal whitespace-nowrap text-ink-muted";
const CELL = "px-3 py-3 align-middle sm:py-[9px]";
const AT_SM = "hidden sm:table-cell";
const AT_LG = "hidden lg:table-cell";
const AT_XL = "hidden xl:table-cell";

export default function SourceRegisterTable({
  rows,
  nowMs,
}: {
  rows: SourceRow[];
  /** Reference time for every relative label, fixed by the server render. */
  nowMs: number;
}) {
  return (
    <table className="w-full border-separate border-spacing-0">
      <thead className="sticky top-0 z-10 bg-[#0b1524]">
        <tr>
          <th className={HEAD}>แหล่งข้อมูล</th>
          <th className={`${HEAD} ${AT_LG}`}>หมวด / บทบาท</th>
          <th className={`${HEAD} ${AT_XL}`}>การเชื่อมต่อ</th>
          <th className={`${HEAD} ${AT_SM}`}>ความน่าเชื่อถือ</th>
          <th className={`${HEAD} text-right`}>เหตุการณ์</th>
          <th className={`${HEAD} ${AT_XL} text-right`}>เรกคอร์ดดิบ</th>
          <th className={`${HEAD} ${AT_SM}`}>รอบล่าสุด</th>
        </tr>
      </thead>

      <tbody>
        {rows.map((r) => (
          <Row key={r.id} row={r} nowMs={nowMs} />
        ))}
      </tbody>
    </table>
  );
}

function Row({ row: r, nowMs }: { row: SourceRow; nowMs: number }) {
  return (
    <tr className="border-t border-[rgba(37,66,102,0.3)] hover:bg-[rgba(56,189,248,0.06)]">
      <td className={`${CELL} max-w-[52vw] sm:max-w-[260px]`}>
        <div className="flex items-center gap-1.5">
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{
              background: PRIORITY_COLOR[r.priority],
              boxShadow: `0 0 5px ${PRIORITY_COLOR[r.priority]}`,
            }}
            title={`ลำดับความสำคัญ ${r.priority}`}
          />
          <Link
            href={`/cases?src=${encodeURIComponent(r.id)}`}
            className="truncate text-[12.5px] text-ink hover:text-azure hover:underline sm:text-[12px]"
            title={`${r.name} — ดูเคสจากแหล่งนี้`}
          >
            {r.name}
          </Link>
          {!r.enabled && (
            <span className="chip shrink-0 border-[rgba(100,128,159,0.5)] text-[10px] text-ink-muted">
              ปิดใช้งาน
            </span>
          )}
        </div>

        <div className="mt-0.5 flex items-center gap-1.5">
          <span className="num truncate text-[10.5px] text-ink-muted">{r.id}</span>
          {r.endpoint && (
            <a
              href={r.endpoint}
              target="_blank"
              rel="noreferrer noopener"
              className="shrink-0 text-ink-muted hover:text-azure"
              title={r.endpoint}
              aria-label={`เปิดต้นทางของ ${r.shortName}`}
            >
              <IconExternalLink size={11} stroke={1.8} />
            </a>
          )}
        </div>

        {/* The last-run column is gone at this width; a failure must not
            disappear with it, so the chip rides along here instead. */}
        <span className="mt-1 flex sm:hidden">
          <LastRun row={r} nowMs={nowMs} />
        </span>
      </td>

      <td className={`${CELL} ${AT_LG} max-w-[220px]`}>
        <span className="block truncate text-[11.5px] text-ink-dim" title={r.category}>
          {categoryLabel(r.category)}
        </span>
        {r.role && (
          <span className="block truncate text-[10.5px] text-ink-muted" title={r.role}>
            {r.role}
          </span>
        )}
      </td>

      <td className={`${CELL} ${AT_XL} whitespace-nowrap`}>
        <span className="text-[11.5px] text-ink-dim">{CONNECTOR_LABEL[r.connectorType]}</span>
        <span className="block text-[10.5px] text-ink-muted">
          {SCHEDULE_MODE_LABEL[r.scheduleMode]} · {r.scheduleFrequency}
        </span>
      </td>

      <td className={`${CELL} ${AT_SM} whitespace-nowrap`}>
        <span
          className="chip border-transparent text-[10.5px]"
          style={{
            color: TRUST_CLASS_COLOR[r.trustClass],
            background: `${TRUST_CLASS_COLOR[r.trustClass]}1a`,
          }}
        >
          {TRUST_CLASS_LABEL[r.trustClass]}
        </span>
        <span className="mt-1 flex items-center gap-2">
          <span className="w-[64px]">
            <ScoreBar value={r.trustScore} />
          </span>
          <span className="num text-[10.5px] text-ink-muted">{r.trustScore}%</span>
        </span>
      </td>

      <td className={`${CELL} whitespace-nowrap`}>
        <div className="flex items-center justify-end gap-2">
          <span className="num text-[12px] text-ink">{r.events.toLocaleString("en-US")}</span>
          <span className="hidden h-1.5 w-[52px] overflow-hidden rounded-full bg-[rgba(56,100,150,0.25)] sm:block">
            <span
              className="block h-full rounded-full bg-azure"
              style={{ width: `${Math.max(r.share, r.events > 0 ? 2 : 0)}%` }}
            />
          </span>
        </div>
        <p className="num mt-0.5 text-right text-[10px] text-ink-muted">
          {r.events > 0 ? `${r.share.toFixed(1)}%` : "ไม่มีข้อมูล"}
          {r.corroborations > 0 && (
            <span title="เหตุการณ์ของแหล่งอื่นที่อ้างแหล่งนี้เป็นการยืนยันร่วม">
              {" "}
              · ยืนยันร่วม {r.corroborations.toLocaleString("en-US")}
            </span>
          )}
        </p>
      </td>

      <td className={`${CELL} ${AT_XL} num text-right text-[11.5px] whitespace-nowrap text-ink-dim`}>
        {r.rawRecords.toLocaleString("en-US")}
      </td>

      <td className={`${CELL} ${AT_SM} whitespace-nowrap`}>
        <LastRun row={r} nowMs={nowMs} />
        <span className="mt-0.5 block text-[10px] text-ink-muted">
          ข้อมูลล่าสุด {relativeThai(r.latestEventMs, nowMs)}
        </span>
      </td>
    </tr>
  );
}

function LastRun({ row: r, nowMs }: { row: SourceRow; nowMs: number }) {
  if (!r.lastRun) {
    return <span className="text-[11px] text-ink-muted">ยังไม่เคยดึงข้อมูล</span>;
  }

  const color = RUN_STATUS_COLOR[r.lastRun.status];

  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="chip border-transparent text-[10.5px]"
        style={{ color, background: `${color}1a` }}
        title={r.lastRun.error ?? undefined}
      >
        {r.lastRun.error && <IconAlertTriangle size={10} stroke={2} />}
        {RUN_STATUS_LABEL[r.lastRun.status]}
      </span>
      <span className="text-[10.5px] text-ink-muted">{relativeThai(r.lastRun.atMs, nowMs)}</span>
    </span>
  );
}
