import Link from "next/link";
import {
  IconBell,
  IconChevronDown,
  IconGridDots,
  IconHelpCircle,
  IconSearch,
  IconUserCircle,
} from "@tabler/icons-react";
import NavTabs, { type NavTab } from "./NavTabs";

const TABS: NavTab[] = [
  { href: "/report", label: "รายงาน" },
  { href: "/investigate", label: "สืบสวน" },
  { href: "/events", label: "เหตุการณ์" },
  { href: "/cases", label: "เคส" },
  { href: "/network", label: "เครือข่าย" },
  { href: "/map", label: "แผนที่" },
  { href: "/sources", label: "แหล่งข้อมูล" },
  { href: "/hypotheses", label: "สมมติฐาน" },
];

/**
 * One row on a wide screen, two on a narrow one: identity and account actions
 * stay on the first, the tabs drop to a scrolling strip on the second. The
 * combined height is published as `--nav-h` (see globals.css) because the
 * floating "no database" notices are pinned beneath it.
 */
export default function TopNav({ active }: { active: string }) {
  return (
    <header className="shrink-0 border-b border-[rgba(37,66,102,0.55)] bg-[#060d19]">
      <div className="px-safe flex h-11 items-center gap-2 sm:h-[38px] sm:gap-3 sm:px-3">
        <button
          type="button"
          aria-label="เมนูแอปพลิเคชัน"
          className="hidden text-ink-muted transition-colors hover:text-ink sm:block"
        >
          <IconGridDots size={19} stroke={1.8} />
        </button>

        <Link
          href="/report"
          className="shrink-0 text-[16px] font-semibold tracking-tight text-ink"
        >
          Palantir <span className="text-azure">TH</span>
        </Link>

        {/* Inline with the account row only where all eight labels fit. */}
        <NavTabs tabs={TABS} active={active} variant="bar" className="hidden lg:flex" />

        <div className="ml-auto flex items-center gap-3">
          <label className="relative hidden md:block">
            <IconSearch
              size={14}
              stroke={1.8}
              className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-muted"
            />
            <input
              type="search"
              placeholder="ค้นหา (Ctrl + K)"
              className="h-7 w-[150px] rounded border border-[rgba(37,66,102,0.8)] bg-[#0a1524] pr-2 pl-8 text-[12px] text-ink placeholder:text-ink-muted focus:border-azure focus:outline-none lg:w-[210px]"
            />
          </label>

          <button
            type="button"
            aria-label="การแจ้งเตือน"
            className="relative flex h-9 w-9 items-center justify-center text-ink-dim hover:text-ink sm:h-auto sm:w-auto"
          >
            <IconBell size={18} stroke={1.7} />
            <span className="absolute top-1 right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-danger px-1 text-[9px] font-semibold text-white sm:-top-1 sm:-right-1.5">
              2
            </span>
          </button>

          <button
            type="button"
            aria-label="ช่วยเหลือ"
            className="hidden text-ink-dim hover:text-ink sm:block"
          >
            <IconHelpCircle size={18} stroke={1.7} />
          </button>

          <div className="flex items-center gap-1.5 sm:border-l sm:border-[rgba(37,66,102,0.6)] sm:pl-3">
            <IconUserCircle size={20} stroke={1.6} className="text-azure" />
            {/* The role, not the person — worth its width only once there is
                width to spare. */}
            <span className="hidden text-[12.5px] text-ink-dim lg:inline">นักวิเคราะห์</span>
            <IconChevronDown size={14} stroke={2} className="hidden text-ink-muted lg:block" />
          </div>
        </div>
      </div>

      <NavTabs
        tabs={TABS}
        active={active}
        variant="strip"
        className="border-t border-[rgba(37,66,102,0.4)] lg:hidden"
      />
    </header>
  );
}
