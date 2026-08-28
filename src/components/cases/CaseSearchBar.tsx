"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconLoader2, IconSearch, IconX } from "@tabler/icons-react";
import { casesHref, type CaseFilters } from "@/lib/case-filters";

/**
 * Free-text search over the register.
 *
 * Submit-driven rather than debounced-as-you-type: each keystroke would be a
 * regex scan over the whole collection, and a table that reshuffles under the
 * cursor is hard to read. The query stays in the URL so a search is a link
 * someone else can open.
 */
export default function CaseSearchBar({
  filters,
  basePath = "/cases",
}: {
  filters: CaseFilters;
  basePath?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(filters.q);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => setQ(filters.q), [filters.q]);

  const go = (next: string) =>
    startTransition(() =>
      router.push(casesHref(filters, { q: next, page: 1 }, basePath), { scroll: false }),
    );

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        go(q.trim());
      }}
      className="relative min-w-0 flex-1"
    >
      {pending ? (
        <IconLoader2
          size={14}
          stroke={2}
          className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 animate-spin text-azure"
        />
      ) : (
        <IconSearch
          size={14}
          stroke={1.8}
          className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-muted"
        />
      )}

      <input
        ref={input}
        type="search"
        name="q"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && q) {
            setQ("");
            go("");
          }
        }}
        placeholder="ค้นหาหัวข้อ ตำบล อำเภอ ประเภทของแหล่งข้อมูล หรือรหัสเคส แล้วกด Enter"
        aria-label="ค้นหาเคส"
        className="h-11 w-full rounded border border-[rgba(37,66,102,0.8)] bg-[#0a1524] pr-16 pl-8 text-[16px] text-ink placeholder:text-ink-muted focus:border-azure focus:outline-none sm:h-8 sm:text-[12px]"
      />

      {q && (
        <button
          type="button"
          aria-label="ล้างคำค้นหา"
          onClick={() => {
            setQ("");
            go("");
            input.current?.focus();
          }}
          className="absolute top-1/2 right-16 flex h-9 w-7 -translate-y-1/2 items-center justify-center text-ink-muted hover:text-ink sm:right-14 sm:h-auto sm:w-auto"
        >
          <IconX size={13} stroke={2} />
        </button>
      )}

      <button
        type="submit"
        className="absolute top-1/2 right-1 h-9 -translate-y-1/2 rounded bg-[rgba(56,189,248,0.16)] px-3 text-[12.5px] text-azure hover:bg-[rgba(56,189,248,0.28)] sm:h-6 sm:px-2.5 sm:text-[11px]"
      >
        ค้นหา
      </button>
    </form>
  );
}
