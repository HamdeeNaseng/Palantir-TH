"use client";

import { useEffect, useState } from "react";
import { DEFAULT_FILTERS, type InvestigationFilters } from "./filters";

/**
 * The selection a filter sidebar is holding, and how it reaches the page.
 *
 * `/investigate` and `/events` had a byte-identical copy of this each — the
 * draft, the resync effect, apply, reset — and live filtering would have made
 * that two byte-identical copies of something subtle. The two consoles present
 * the same vocabulary through the same `FilterShell`, so how a tick becomes an
 * applied filter is not somewhere they should be free to differ.
 *
 * `live` is the whole reason this is not just `useState`. Once the browser
 * holds the dataset (`useLocalFilters`' `local`) a filter change costs one pass
 * over it rather than a MongoDB read, so there is nothing left for a commit
 * button to save the analyst from and every edit is applied as it is made. On
 * a cold visit `onApply` is still a server navigation, one per checkbox would
 * be a request storm, and the button is the only safe way to spend it.
 */
export interface FilterDraft {
  /** What the sidebar renders — the draft, or in live mode the applied set. */
  filters: InvestigationFilters;
  patch: (next: Partial<InvestigationFilters>) => void;
  /** The button path. A no-op in live mode, where it has already been sent. */
  apply: () => void;
  reset: () => void;
}

export function useFilterDraft({
  initial,
  live,
  onApply,
  onReset,
}: {
  /** The applied filters, as the page currently understands them. */
  initial: InvestigationFilters;
  live: boolean;
  onApply: (filters: InvestigationFilters) => void;
  onReset: () => void;
}): FilterDraft {
  const [filters, setFilters] = useState<InvestigationFilters>(initial);

  // Back, Forward, or a fallback navigation changed the applied filters
  // elsewhere; the draft follows rather than silently contradicting the page
  // beside it. In live mode this is also how an applied change comes home —
  // as the very object that was sent up, so `setFilters` bails on identity.
  useEffect(() => {
    setFilters(initial);
  }, [initial]);

  /**
   * A draft is still kept in live mode rather than reading straight off
   * `initial`, because a live apply is a transition: the page's rebuild is
   * deferred so the dashboard cannot make the checkbox wait for it, and a
   * checkbox whose `checked` came back through that deferral would visibly lag
   * the click.
   *
   * The merge is computed here and not inside a `setFilters` updater on
   * purpose. An updater may be re-run by React mid-render, and calling the
   * parent's setState from inside one is the "Cannot update a component while
   * rendering a different component" warning. Reading `filters` from the
   * closure is sound for the same reason it looks risky: these all come from
   * discrete events, which React flushes synchronously, so the next click
   * already sees this one.
   *
   * Sending from the handler rather than from an effect on the draft also
   * keeps the data flow one-way. An effect cannot tell an edit from `initial`
   * moving underneath it — which is what Back, Forward and a fallback
   * navigation all do — and would answer the navigation by re-applying the
   * pre-navigation draft, silently undoing it.
   */
  const patch = (next: Partial<InvestigationFilters>) => {
    const merged = { ...filters, ...next };
    setFilters(merged);
    if (live) onApply(merged);
  };

  /**
   * The footer button. In live mode every edit has already been sent, and
   * re-sending the same set would only cost a duplicate history entry — so
   * there the button is purely "close the drawer".
   */
  const apply = () => {
    if (!live) onApply(filters);
  };

  const reset = () => {
    setFilters(DEFAULT_FILTERS);
    onReset();
  };

  return { filters, patch, apply, reset };
}
