"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DEFAULT_CASE_FILTERS,
  casesHref,
  serializeCaseFilters,
  type CaseFilters,
} from "./case-filters";

/**
 * The register's answer to `useFilterDraft` — a filter change is applied as it
 * is made, with no "ใช้ตัวกรอง" in between.
 *
 * `/investigate` and `/events` can do that for free: the dataset is already in
 * the browser, so a change costs one pass over it (see `use-local-filters`).
 * `/cases` and `/report` cannot. Their rows are paged, their facet counts are
 * computed per query, and both come from a MongoDB aggregation — the filters
 * here are still a URL the server renders. So "live" is bought differently:
 *
 *   1. **Debounced.** Ticking four districts is one intention, and it should
 *      cost one query. Only the last state of a burst is ever requested; the
 *      three superseded ones are cancelled before they leave the browser,
 *      which is what keeps per-checkbox filtering from being a request storm.
 *   2. **Coalesced in history.** The first change of a burst gets a history
 *      entry, the rest replace it — same rule as `LIVE_BURST_MS` upstream, so
 *      one act of filtering stays one press of Back rather than a dozen.
 *   3. **Resync-guarded.** The sidebar follows the server's filters (Back, a
 *      removed chip, a shared link), but a render that lands *while an edit is
 *      still in flight* is describing the past. Adopting it would visibly
 *      untick the box the analyst just ticked, so the incoming set is ignored
 *      until the one we sent comes home.
 */
export interface LiveCaseFilters {
  /** What the sidebar renders — the applied set, edits included. */
  filters: CaseFilters;
  patch: (next: Partial<CaseFilters>) => void;
  /** Send whatever is still debounced right now, e.g. "ดูผลลัพธ์" on a phone. */
  apply: () => void;
  reset: () => void;
  /** True while a navigation is in flight. */
  pending: boolean;
}

/** Long enough to absorb a run of ticks, short enough to feel like an answer. */
const DEBOUNCE_MS = 400;

/** How long after the last navigation a filtering burst is considered over. */
const BURST_MS = 900;

export function useLiveCaseFilters({
  initial,
  basePath,
}: {
  /** The applied filters, as the server currently understands them. */
  initial: CaseFilters;
  basePath: string;
}): LiveCaseFilters {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [filters, setFilters] = useState<CaseFilters>(initial);

  /** The query string of the edit we last sent, until the server echoes it. */
  const sent = useRef<string | null>(null);
  const timer = useRef<number | null>(null);
  /** The change waiting out the debounce, so `apply` can flush it. */
  const queued = useRef<CaseFilters | null>(null);
  const lastNavAt = useRef(0);

  const cancel = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  useEffect(() => cancel, []);

  // Back, Forward, a removed chip, or a link with a query string: the applied
  // filters moved without this component remounting, and the panel follows
  // rather than contradicting the table beside it. See (3) above for why an
  // in-flight edit outranks the render that overtakes it.
  useEffect(() => {
    const incoming = serializeCaseFilters(initial);
    if (incoming === sent.current) {
      sent.current = null;
      setFilters(initial);
      return;
    }
    if (sent.current !== null) return;
    setFilters(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  const go = useCallback(
    (next: CaseFilters) => {
      const href = casesHref(next, { page: 1 }, basePath);
      const sameBurst = Date.now() - lastNavAt.current < BURST_MS;
      lastNavAt.current = Date.now();
      startTransition(() => {
        if (sameBurst) router.replace(href, { scroll: false });
        else router.push(href, { scroll: false });
      });
    },
    [basePath, router],
  );

  const schedule = useCallback(
    (next: CaseFilters) => {
      queued.current = next;
      // Recorded now rather than when the request goes out: a render arriving
      // in the meantime is still describing a state the analyst has left.
      sent.current = serializeCaseFilters({ ...next, page: 1 });
      cancel();
      timer.current = window.setTimeout(() => {
        timer.current = null;
        const target = queued.current;
        queued.current = null;
        if (target) go(target);
      }, DEBOUNCE_MS);
    },
    [go],
  );

  /**
   * Merged here rather than inside a `setFilters` updater: an updater may be
   * re-run by React mid-render, and scheduling a navigation from inside one is
   * a side effect in a place that promises to have none. Reading `filters`
   * from the closure is sound because every caller is a discrete event, which
   * React flushes synchronously — the next click already sees this one.
   */
  const patch = useCallback(
    (next: Partial<CaseFilters>) => {
      // Any narrowing returns to page 1; page 7 of a different result set is
      // not a page anybody asked for.
      const merged: CaseFilters = { ...filters, ...next, page: 1 };
      setFilters(merged);
      schedule(merged);
    },
    [filters, schedule],
  );

  const apply = useCallback(() => {
    const target = queued.current ?? filters;
    cancel();
    queued.current = null;
    sent.current = serializeCaseFilters({ ...target, page: 1 });
    go(target);
  }, [filters, go]);

  const reset = useCallback(() => {
    cancel();
    queued.current = null;
    // Sort order is how the analyst reads the table, not how they narrowed it,
    // so clearing the filters leaves it alone.
    const next: CaseFilters = { ...DEFAULT_CASE_FILTERS, sort: filters.sort, dir: filters.dir };
    setFilters(next);
    sent.current = serializeCaseFilters(next);
    // Clearing everything is its own act, never folded into the burst that
    // preceded it — Back after a reset returns to the filtered view.
    lastNavAt.current = 0;
    go(next);
  }, [filters.sort, filters.dir, go]);

  return { filters, patch, apply, reset, pending };
}
