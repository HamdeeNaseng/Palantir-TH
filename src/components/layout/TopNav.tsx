import Link from "next/link";
import {
  IconBell,
  IconChevronDown,
  IconGridDots,
  IconHelpCircle,
  IconSearch,
  IconUserCircle,
} from "@tabler/icons-react";

const TABS = [
  { href: "/investigate", label: "สืบสวน" },
  { href: "/events", label: "เหตุการณ์" },
  { href: "/cases", label: "เคส" },
  { href: "/report", label: "รายงาน" },
  { href: "/network", label: "เครือข่าย" },
  { href: "/map", label: "แผนที่" },
  { href: "/sources", label: "แหล่งข้อมูล" },
  { href: "/hypotheses", label: "สมมติฐาน" },
];

export default function TopNav({ active }: { active: string }) {
  return (
    <header className="flex h-[38px] shrink-0 items-center gap-3 border-b border-[rgba(37,66,102,0.55)] bg-[#060d19] px-3">
      <button
        type="button"
        aria-label="เมนูแอปพลิเคชัน"
        className="text-ink-muted transition-colors hover:text-ink"
      >
        <IconGridDots size={19} stroke={1.8} />
      </button>

      <Link href="/investigate" className="text-[16px] font-semibold tracking-tight text-ink">
        Palantir <span className="text-azure">TH</span>
      </Link>

      <nav className="ml-1 flex h-full items-center gap-1">
        {TABS.map((tab) => {
          const isActive = tab.href === active;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={
                isActive
                  ? "flex h-full items-center border-b-2 border-azure px-3 text-[12.5px] font-medium text-azure"
                  : "flex h-full items-center border-b-2 border-transparent px-3 text-[12.5px] text-ink-dim transition-colors hover:bg-[rgba(56,189,248,0.07)] hover:text-ink"
              }
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

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
            className="h-7 w-[210px] rounded border border-[rgba(37,66,102,0.8)] bg-[#0a1524] pr-2 pl-8 text-[12px] text-ink placeholder:text-ink-muted focus:border-azure focus:outline-none"
          />
        </label>

        <button type="button" aria-label="การแจ้งเตือน" className="relative text-ink-dim hover:text-ink">
          <IconBell size={18} stroke={1.7} />
          <span className="absolute -top-1 -right-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-danger px-1 text-[9px] font-semibold text-white">
            2
          </span>
        </button>

        <button type="button" aria-label="ช่วยเหลือ" className="text-ink-dim hover:text-ink">
          <IconHelpCircle size={18} stroke={1.7} />
        </button>

        <div className="flex items-center gap-1.5 border-l border-[rgba(37,66,102,0.6)] pl-3">
          <IconUserCircle size={20} stroke={1.6} className="text-azure" />
          <span className="text-[12.5px] text-ink-dim">นักวิเคราะห์</span>
          <IconChevronDown size={14} stroke={2} className="text-ink-muted" />
        </div>
      </div>
    </header>
  );
}
