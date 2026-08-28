"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";

/**
 * The destination tabs.
 *
 * Eight Thai labels do not fit across a 360 px phone, and dropping any of them
 * behind a hamburger would hide the two destinations (`/report`, `/map`) that a
 * phone visitor is most likely to want. So below `lg` the strip stays a strip
 * and scrolls sideways instead — with the active tab scrolled into view on
 * arrival, since a tab you cannot see is the same as one that isn't there.
 */

export type NavTab = { href: string; label: string };

export default function NavTabs({
  tabs,
  active,
  variant,
  className = "",
}: {
  tabs: NavTab[];
  active: string;
  /** `bar` sits inside the header row (desktop); `strip` is its own row. */
  variant: "bar" | "strip";
  className?: string;
}) {
  const scroller = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = scroller.current?.querySelector<HTMLElement>("[data-active='true']");
    if (!el) return;
    // `nearest` on the block axis: this must not scroll the page itself, only
    // the strip. Instant rather than smooth — an animation on first paint
    // reads as the layout still settling.
    el.scrollIntoView({ inline: "center", block: "nearest", behavior: "instant" });
  }, [active]);

  const strip = variant === "strip";

  return (
    <nav
      ref={scroller}
      aria-label="ส่วนงาน"
      className={[
        "no-scrollbar flex items-stretch overflow-x-auto overscroll-x-contain",
        strip ? "h-10 gap-0 px-safe sm:h-[38px]" : "ml-1 h-full gap-1",
        className,
      ].join(" ")}
    >
      {tabs.map((tab) => {
        const isActive = tab.href === active;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            data-active={isActive}
            aria-current={isActive ? "page" : undefined}
            className={[
              "flex shrink-0 items-center whitespace-nowrap border-b-2 transition-colors",
              strip ? "px-3.5 text-[13px] sm:text-[12.5px]" : "px-3 text-[12.5px]",
              isActive
                ? "border-azure font-medium text-azure"
                : "border-transparent text-ink-dim hover:bg-[rgba(56,189,248,0.07)] hover:text-ink",
            ].join(" ")}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
