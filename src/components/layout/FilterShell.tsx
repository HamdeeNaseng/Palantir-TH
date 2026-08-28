"use client";

import { useEffect, useRef, useState } from "react";
import { IconFilter, IconLoader2, IconX } from "@tabler/icons-react";

/**
 * The chrome every filter sidebar in the console shares: a title row with a
 * reset, a scrolling body, and an "ใช้ตัวกรอง" footer.
 *
 * Below `lg` the same panel becomes an off-canvas drawer opened from a bar
 * above the content. That is the only place 190–212 px of permanent controls
 * can go on a phone — `/cases` and `/report` previously answered the question
 * with `hidden lg:flex`, which left a phone visitor with no way to filter at
 * all.
 *
 * The drawer is a plain translated `<aside>` rather than a modal `<dialog>`,
 * because the same element has to be an ordinary in-flow sidebar at `lg` and
 * a dialog cannot stop being one. What that costs is a focus trap, so the
 * pieces of one are put back by hand: Escape closes, the backdrop closes, the
 * page behind it stops scrolling, and the off-screen panel is `inert` so the
 * tab key never walks into controls nobody can see.
 */
export default function FilterShell({
  title,
  resetLabel,
  onReset,
  onApply,
  pending = false,
  activeCount = 0,
  width = "lg:w-[188px]",
  children,
}: {
  title: string;
  resetLabel: string;
  onReset: () => void;
  onApply: () => void;
  pending?: boolean;
  /** How many filters are narrowing the view, shown on the closed trigger. */
  activeCount?: number;
  /** Desktop width as a Tailwind class, since the sidebars differ by 24 px. */
  width?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  // Assume desktop until the media query has been read, so the panel is never
  // inert for a server-rendered wide viewport.
  const [desktop, setDesktop] = useState(true);
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => setDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // Escape, and a body that does not scroll underneath the open drawer.
  useEffect(() => {
    if (!open || desktop) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Focus moves into the panel so the keyboard follows the eye.
    panel.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, desktop]);

  const closed = !desktop && !open;

  const apply = () => {
    onApply();
    setOpen(false);
  };

  const reset = () => {
    onReset();
    setOpen(false);
  };

  return (
    <>
      {/* Trigger — its own row above the content below `lg`. */}
      <div className="px-safe flex shrink-0 items-center gap-2 border-b border-[rgba(37,66,102,0.55)] bg-[#070e1b] py-2 lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[rgba(56,100,150,0.5)] px-3 text-[13px] text-ink-dim"
        >
          <IconFilter size={16} stroke={1.8} />
          {title}
          {activeCount > 0 && (
            <span className="num rounded-full bg-azure px-1.5 text-[11px] font-semibold text-[#04070e]">
              {activeCount}
            </span>
          )}
        </button>
        {activeCount > 0 && (
          <button
            type="button"
            onClick={onReset}
            className="min-h-10 px-1 text-[12px] text-azure"
          >
            {resetLabel}
          </button>
        )}
      </div>

      {open && !desktop && (
        <div
          onClick={() => setOpen(false)}
          aria-hidden="true"
          className="fixed inset-0 z-40 bg-black/65 lg:hidden"
        />
      )}

      <aside
        ref={panel}
        tabIndex={-1}
        inert={closed}
        aria-label={title}
        className={[
          "fixed inset-y-0 left-0 z-50 flex w-[86vw] max-w-[330px] flex-col border-r border-[rgba(37,66,102,0.55)] bg-[#070e1b] transition-transform duration-200 ease-out outline-none",
          open ? "translate-x-0" : "-translate-x-full",
          "lg:static lg:z-auto lg:max-w-none lg:translate-x-0 lg:transition-none",
          width,
          "lg:shrink-0",
        ].join(" ")}
      >
        <div className="flex items-center justify-between gap-2 border-b border-[rgba(37,66,102,0.55)] px-3.5 py-2.5">
          <h2 className="text-[14px] font-semibold text-ink lg:text-[13px]">{title}</h2>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={reset}
              className="rounded border border-[rgba(56,100,150,0.5)] px-2 py-1 text-[11.5px] text-ink-muted hover:text-ink lg:px-1.5 lg:py-0.5 lg:text-[10.5px]"
            >
              {resetLabel}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="ปิดตัวกรอง"
              className="-mr-1 flex h-9 w-9 items-center justify-center text-ink-muted lg:hidden"
            >
              <IconX size={18} stroke={2} />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>

        <div className="pb-safe border-t border-[rgba(37,66,102,0.55)] p-3 lg:pb-3">
          <button
            type="button"
            onClick={apply}
            disabled={pending}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#1d4ed8] text-[13.5px] font-medium text-white transition-colors hover:bg-[#2563eb] disabled:opacity-70 lg:min-h-0 lg:rounded lg:py-2 lg:text-[12.5px]"
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
    </>
  );
}
