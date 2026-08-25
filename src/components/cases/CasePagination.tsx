import Link from "next/link";
import {
  IconChevronLeft,
  IconChevronRight,
  IconChevronsLeft,
  IconChevronsRight,
} from "@tabler/icons-react";
import { casesHref, type CaseFilters } from "@/lib/case-filters";

/** How many numbered pages to show either side of the current one. */
const WINDOW = 2;

function pageWindow(page: number, pageCount: number): (number | "gap")[] {
  const pages = new Set<number>([1, pageCount]);
  for (let p = page - WINDOW; p <= page + WINDOW; p++) {
    if (p >= 1 && p <= pageCount) pages.add(p);
  }

  const sorted = [...pages].sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  for (const [i, p] of sorted.entries()) {
    if (i > 0 && p - sorted[i - 1] > 1) out.push("gap");
    out.push(p);
  }
  return out;
}

const STEP =
  "flex h-6 w-6 items-center justify-center rounded border border-[rgba(56,100,150,0.5)] text-ink-dim hover:border-azure hover:text-ink";
const STEP_OFF =
  "flex h-6 w-6 items-center justify-center rounded border border-[rgba(56,100,150,0.25)] text-ink-muted/50";

export default function CasePagination({
  filters,
  page,
  pageCount,
  total,
  pageSize,
  basePath = "/cases",
}: {
  filters: CaseFilters;
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  basePath?: string;
}) {
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  const step = (p: number) => casesHref(filters, { page: p }, basePath);

  return (
    <nav
      aria-label="หน้าของตารางเคส"
      className="flex items-center justify-between gap-3 border-t border-[rgba(37,66,102,0.45)] px-3.5 py-2"
    >
      <p className="num text-[11px] text-ink-muted">
        แสดง {first.toLocaleString("en-US")}–{last.toLocaleString("en-US")} จาก{" "}
        <span className="text-ink-dim">{total.toLocaleString("en-US")}</span> เคส
      </p>

      <div className="flex items-center gap-1">
        {page > 1 ? (
          <>
            <Link href={step(1)} scroll={false} aria-label="หน้าแรก" className={STEP}>
              <IconChevronsLeft size={13} stroke={2} />
            </Link>
            <Link href={step(page - 1)} scroll={false} aria-label="หน้าก่อนหน้า" className={STEP}>
              <IconChevronLeft size={13} stroke={2} />
            </Link>
          </>
        ) : (
          <>
            <span className={STEP_OFF} aria-hidden="true">
              <IconChevronsLeft size={13} stroke={2} />
            </span>
            <span className={STEP_OFF} aria-hidden="true">
              <IconChevronLeft size={13} stroke={2} />
            </span>
          </>
        )}

        {pageWindow(page, pageCount).map((p, i) =>
          p === "gap" ? (
            <span key={`gap-${i}`} className="px-1 text-[11px] text-ink-muted">
              …
            </span>
          ) : p === page ? (
            <span
              key={p}
              aria-current="page"
              className="num flex h-6 min-w-6 items-center justify-center rounded bg-azure px-1.5 text-[11px] font-medium text-[#04070e]"
            >
              {p}
            </span>
          ) : (
            <Link
              key={p}
              href={step(p)}
              scroll={false}
              className="num flex h-6 min-w-6 items-center justify-center rounded border border-[rgba(56,100,150,0.5)] px-1.5 text-[11px] text-ink-dim hover:border-azure hover:text-ink"
            >
              {p}
            </Link>
          ),
        )}

        {page < pageCount ? (
          <>
            <Link href={step(page + 1)} scroll={false} aria-label="หน้าถัดไป" className={STEP}>
              <IconChevronRight size={13} stroke={2} />
            </Link>
            <Link href={step(pageCount)} scroll={false} aria-label="หน้าสุดท้าย" className={STEP}>
              <IconChevronsRight size={13} stroke={2} />
            </Link>
          </>
        ) : (
          <>
            <span className={STEP_OFF} aria-hidden="true">
              <IconChevronRight size={13} stroke={2} />
            </span>
            <span className={STEP_OFF} aria-hidden="true">
              <IconChevronsRight size={13} stroke={2} />
            </span>
          </>
        )}
      </div>
    </nav>
  );
}
