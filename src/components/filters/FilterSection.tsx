"use client";

import { IconChevronDown } from "@tabler/icons-react";

/**
 * The two pieces of sidebar furniture `/investigate` and `/events` both draw:
 * a titled, collapsible-looking section and a counted checkbox row.
 *
 * Both files used to carry their own copy. They were identical apart from the
 * count `span` — which the investigate copy simply lacked — so the shared
 * version keeps `count` optional and renders nothing when it is absent, and
 * neither page changes shape by adopting it.
 */

export function Section({
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

export function Check({
  checked,
  onChange,
  label,
  count,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  /** Omitted where the page has no facet counts to show. */
  count?: number;
}) {
  return (
    <label className="filter-row">
      <input type="checkbox" checked={checked} onChange={onChange} className="filter-box" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && (
        <span className="num shrink-0 text-[10.5px] text-ink-muted">
          {count.toLocaleString("en-US")}
        </span>
      )}
    </label>
  );
}

/** The one-liner every sidebar wrote for itself to flip a value in a list. */
export function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/** The small outlined button that sits in a section header. */
export function SectionAction({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded border border-[rgba(56,100,150,0.5)] px-1.5 py-0.5 text-[10px] text-ink-muted hover:text-ink"
    >
      {children}
    </button>
  );
}
