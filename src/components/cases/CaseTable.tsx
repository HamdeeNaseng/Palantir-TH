import Link from "next/link";
import {
  IconArrowNarrowDown,
  IconArrowNarrowUp,
  IconChevronRight,
  IconPaperclip,
  IconSelector,
} from "@tabler/icons-react";
import CaseRowLink from "./CaseRowLink";
import { VERIFICATION_COLOR } from "@/lib/palette";
import { formatByPrecision } from "@/lib/datetime";
import { casesHref, type CaseFilters, type CaseSortKey } from "@/lib/case-filters";
import type { CaseRow } from "@/server/cases";

/**
 * The register table.
 *
 * Server-rendered: a page is 50 rows out of MongoDB, so there is nothing here
 * that needs to be a client bundle. Sorting and paging are links, which keeps
 * every view of the table addressable and the back button meaningful.
 */

/** Which direction a column should open in when it is first clicked. */
const FIRST_DIR: Record<CaseSortKey, "asc" | "desc"> = {
  date: "desc",
  province: "asc",
  type: "asc",
  verification: "asc",
  confidence: "desc",
};

function SortHeader({
  label,
  sortKey,
  filters,
  className,
  basePath,
}: {
  label: string;
  sortKey: CaseSortKey;
  filters: CaseFilters;
  className?: string;
  basePath: string;
}) {
  const active = filters.sort === sortKey;
  const dir = active ? (filters.dir === "asc" ? "desc" : "asc") : FIRST_DIR[sortKey];
  const Icon = !active ? IconSelector : filters.dir === "asc" ? IconArrowNarrowUp : IconArrowNarrowDown;

  return (
    <th scope="col" className={className} aria-sort={active ? (filters.dir === "asc" ? "ascending" : "descending") : "none"}>
      <Link
        href={casesHref(filters, { sort: sortKey, dir }, basePath)}
        scroll={false}
        className={
          active
            ? "inline-flex items-center gap-1 font-medium text-azure"
            : "inline-flex items-center gap-1 text-ink-muted hover:text-ink"
        }
      >
        {label}
        <Icon size={12} stroke={2} className={active ? "" : "opacity-50"} />
      </Link>
    </th>
  );
}

/** Column header that carries no ordering — nothing to click. */
const PlainHeader = ({ label, className }: { label: string; className?: string }) => (
  <th scope="col" className={className}>
    {label}
  </th>
);

function VerificationChip({ label, status }: { label: string; status: CaseRow["verification"] }) {
  const color = VERIFICATION_COLOR[status];
  return (
    <span
      className="chip"
      style={{ color, borderColor: `${color}66`, background: `${color}1f` }}
    >
      {label}
    </span>
  );
}

function Severity({ severity, label }: { severity: number | null; label: string }) {
  // A source that reported nothing implying severity is not the same as one
  // that reported "low". Show the gap as a gap.
  if (severity === null || severity < 1 || severity > 5) {
    return (
      <span className="text-[11px] text-ink-muted" title="แหล่งข้อมูลไม่ได้ระบุระดับความรุนแรง">
        {label}
      </span>
    );
  }
  const color = ["", "#22c55e", "#84cc16", "#f59e0b", "#f97316", "#ef4444"][severity];
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px]" style={{ color }}>
      <span
        className="num flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-semibold"
        style={{ background: `${color}26`, border: `1px solid ${color}` }}
      >
        {severity}
      </span>
      {label}
    </span>
  );
}

const HEAD = "px-3 py-2 text-left text-[10.5px] font-normal whitespace-nowrap";
const CELL = "px-3 py-3 align-middle sm:py-[9px]";

/**
 * Ten columns is a reasonable register on a 1180 px console and an unreadable
 * one on a phone. Rather than a second card layout to keep in step with this
 * table, the columns drop out in order of how much they add to *identifying*
 * a case: date, headline, and status survive to the narrowest screen, and the
 * rest come back as the viewport earns them. Every hidden field is still on
 * the case's own page, one tap away.
 */
const AT_SM = "hidden sm:table-cell";
const AT_LG = "hidden lg:table-cell";
const AT_XL = "hidden xl:table-cell";

export default function CaseTable({
  rows,
  filters,
  href,
  basePath = "/cases",
}: {
  rows: CaseRow[];
  filters: CaseFilters;
  /** Builds the detail link for a row, carrying the list state along. */
  href: (row: CaseRow) => string;
  basePath?: string;
}) {
  return (
    <table className="w-full border-separate border-spacing-0">
      <thead className="sticky top-0 z-10 bg-[#0b1524]">
        <tr className="border-b border-[rgba(37,66,102,0.55)]">
          <SortHeader
            label="วันที่เกิดเหตุ"
            sortKey="date"
            filters={filters}
            className={`${HEAD} whitespace-normal sm:whitespace-nowrap`}
            basePath={basePath}
          />
          <PlainHeader label="หัวข้อที่แหล่งข้อมูลรายงาน" className={HEAD} />
          <SortHeader label="ประเภท" sortKey="type" filters={filters} className={`${HEAD} ${AT_SM}`} basePath={basePath} />
          <SortHeader label="พื้นที่" sortKey="province" filters={filters} className={`${HEAD} ${AT_LG}`} basePath={basePath} />
          <SortHeader label="สถานะ" sortKey="verification" filters={filters} className={`${HEAD} ${AT_SM}`} basePath={basePath} />
          <PlainHeader label="ความรุนแรง" className={`${HEAD} ${AT_LG}`} />
          <SortHeader
            label="ความเชื่อมั่น"
            sortKey="confidence"
            filters={filters}
            className={`${HEAD} ${AT_XL} text-right`}
            basePath={basePath}
          />
          <PlainHeader label="แหล่งข้อมูล" className={`${HEAD} ${AT_XL}`} />
          <PlainHeader label="แนบ" className={`${HEAD} ${AT_SM} text-center`} />
          <th scope="col" className={HEAD}>
            <span className="sr-only">เปิดเคส</span>
          </th>
        </tr>
      </thead>

      <tbody>
        {rows.map((r) => (
          <CaseTableRow key={r.id} row={r} href={href(r)} />
        ))}
      </tbody>
    </table>
  );
}

/** Split out so `CaseRowLink` stays a thin client shell around server markup. */
function CaseTableRow({ row: r, href }: { row: CaseRow; href: string }) {
  return (
    <CaseRowLink
      href={href}
      className="cursor-pointer border-t border-[rgba(37,66,102,0.3)] hover:bg-[rgba(56,189,248,0.06)]"
    >
      <td className={`${CELL} num w-[88px] text-[11px] whitespace-normal text-ink-dim sm:w-auto sm:whitespace-nowrap`}>
        {formatByPrecision(r.at, r.timePrecision)}
        {r.timePrecision === "day" && (
          <span className="ml-1 text-ink-muted" title="แหล่งข้อมูลระบุความละเอียดของเวลาเป็นระดับวัน">
            ·วัน
          </span>
        )}
      </td>

      <td className={`${CELL} max-w-[62vw] sm:max-w-[300px]`}>
        <Link
          href={href}
          className="block truncate text-[13px] text-ink hover:text-azure hover:underline sm:text-[12px]"
          title={r.title}
        >
          {r.title}
        </Link>
        {r.place && (
          <span className="block truncate text-[10.5px] text-ink-muted" title={r.place}>
            {r.place}
          </span>
        )}
        {/* The status column is gone at this width, so it rides along here
            rather than leaving a claim on the screen with no standing. */}
        <span className="mt-1 flex sm:hidden">
          <VerificationChip label={r.verificationLabel} status={r.verification} />
        </span>
      </td>

      <td className={`${CELL} ${AT_SM} whitespace-nowrap`}>
        <span
          className="inline-flex items-center gap-1.5 text-[11.5px]"
          style={{ color: r.typeColor }}
          title={r.rawType ?? undefined}
        >
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: r.typeColor, boxShadow: `0 0 5px ${r.typeColor}` }}
          />
          {r.typeLabel}
        </span>
      </td>

      <td className={`${CELL} ${AT_LG} text-[11.5px] whitespace-nowrap text-ink-dim`}>
        {r.subdistrict ? `ต.${r.subdistrict} ` : ""}
        อ.{r.district}
        <span className="ml-1 text-ink-muted">จ.{r.province}</span>
      </td>

      <td className={`${CELL} ${AT_SM} whitespace-nowrap`}>
        <VerificationChip label={r.verificationLabel} status={r.verification} />
      </td>

      <td className={`${CELL} ${AT_LG} whitespace-nowrap`}>
        <Severity severity={r.severity} label={r.severityLabel} />
      </td>

      <td className={`${CELL} ${AT_XL} num text-right text-[11.5px] whitespace-nowrap text-ink-dim`}>
        {r.confidence}%
      </td>

      <td className={`${CELL} ${AT_XL} text-[11px] whitespace-nowrap text-ink-dim`}>{r.sourceName}</td>

      <td className={`${CELL} ${AT_SM} text-center whitespace-nowrap`}>
        {r.mediaCount > 0 ? (
          <span
            className="inline-flex items-center gap-0.5 text-[11px] text-cyan"
            title={`มีไฟล์แนบ ${r.mediaCount} รายการ`}
          >
            <IconPaperclip size={12} stroke={1.8} />
            <span className="num">{r.mediaCount}</span>
          </span>
        ) : (
          <span className="text-[11px] text-ink-muted">–</span>
        )}
      </td>

      <td className={`${CELL} text-right`}>
        <IconChevronRight size={14} stroke={2} className="text-ink-muted" />
      </td>
    </CaseRowLink>
  );
}
