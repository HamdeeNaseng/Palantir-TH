"use client";

import { useRouter } from "next/navigation";
import type { MouseEvent } from "react";

/**
 * Makes a whole table row clickable without breaking it as a table.
 *
 * The row keeps its native `row` semantics and the real anchor lives in the
 * title cell, so keyboard and screen-reader users get one ordinary link rather
 * than a `role="link"` that hides the row from the table's structure. This
 * handler is a mouse affordance layered on top of that link, not a substitute
 * for it.
 */
export default function CaseRowLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();

  const onClick = (e: MouseEvent<HTMLTableRowElement>) => {
    // Let the anchor, and anything else interactive, handle its own click.
    if ((e.target as HTMLElement).closest("a, button, input, select, textarea")) return;
    // Dragging out a selection is not a navigation request.
    if (window.getSelection()?.toString()) return;

    if (e.metaKey || e.ctrlKey || e.shiftKey) {
      window.open(href, "_blank", "noopener,noreferrer");
      return;
    }
    router.push(href);
  };

  return (
    <tr onClick={onClick} className={className}>
      {children}
    </tr>
  );
}
