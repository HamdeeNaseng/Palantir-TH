"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_FILTERS, parseFilters, serializeFilters, type InvestigationFilters } from "./filters";
import { useSnapshot, type SnapshotState } from "./use-snapshot";
import type { Snapshot } from "./snapshot";

/**
 * Filtering against the browser's copy of the dataset instead of the server's.
 *
 * Applying a filter used to mean `router.push("/events?...")`: a navigation, a
 * `force-dynamic` server render, and a full scan of 10,171 MongoDB documents,
 * for a question the browser already had the data to answer. Here the filters
 * are ordinary client state, the view model is rebuilt from the cached
 * snapshot with the same builder the server uses, and the URL is updated
 * through the History API — which keeps the address bar shareable and Back
 * working without asking the server anything.
 *
 * Until the snapshot arrives (a cold visit, a private window with IndexedDB
 * blocked, an offline first load) `apply` falls back to the old navigation, so
 * the page degrades to exactly its previous behaviour rather than to a dead
 * sidebar.
 */
export interface LocalFilters<TView> {
  filters: InvestigationFilters;
  /** The server's view model until a local snapshot can improve on it. */
  view: TView;
  apply: (next: InvestigationFilters) => void;
  reset: () => void;
  /** True while a fallback server navigation is in flight. */
  pending: boolean;
  /** True once filtering happens locally — nothing here hits the network. */
  local: boolean;
  snapshot: SnapshotState;
}

export function useLocalFilters<TView>({
  path,
  initialFilters,
  initialView,
  initialVersion,
  build,
}: {
  /** Where a fallback navigation goes, e.g. `/events`. */
  path: string;
  initialFilters: InvestigationFilters;
  /** What the server rendered for `initialFilters` — the first paint. */
  initialView: TView;
  /** The snapshot version `initialView` was built from, so a newer one wins. */
  initialVersion: string;
  build: (snapshot: Snapshot, filters: InvestigationFilters) => TView;
}): LocalFilters<TView> {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [filters, setFilters] = useState(initialFilters);
  const snapshot = useSnapshot();

  // A new `initialView` means the server re-rendered under us — a fallback
  // navigation landed, or the user followed a link with a query string. Its
  // filters become the current ones.
  useEffect(() => {
    setFilters(initialFilters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialView]);

  const filtersChanged = useMemo(
    () => serializeFilters(filters) !== serializeFilters(initialFilters),
    [filters, initialFilters],
  );

  const held = snapshot.snapshot;
  /**
   * Rebuild locally when the filters have moved off what the server rendered,
   * or when a refresh has brought data newer than the server render was built
   * from. Otherwise keep the server's own output: it is the same function over
   * the same data, so recomputing it would cost ~10k events of work to arrive
   * back where we started.
   */
  const useLocal = Boolean(held) && (filtersChanged || held!.version !== initialVersion);

  const view = useMemo(
    () => (useLocal && held ? build(held, filters) : initialView),
    // `build` is a fresh closure on every render in practice; depending on it
    // would defeat the memo, and it is pure over (snapshot, filters) by
    // contract, so those are the real inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [useLocal, held, filters, initialView],
  );

  /** Keeps the address bar in step with client state, without a server round trip. */
  const pushUrl = useCallback(
    (next: InvestigationFilters) => {
      const query = serializeFilters(next);
      window.history.pushState(null, "", query ? `${path}?${query}` : path);
    },
    [path],
  );

  const apply = useCallback(
    (next: InvestigationFilters) => {
      if (!held) {
        // No local dataset yet — do what the page has always done.
        setFilters(next);
        startTransition(() =>
          router.push(`${path}?${serializeFilters(next)}`, { scroll: false }),
        );
        return;
      }
      setFilters(next);
      pushUrl(next);
    },
    [held, path, pushUrl, router],
  );

  const reset = useCallback(() => {
    if (!held) {
      setFilters(DEFAULT_FILTERS);
      startTransition(() => router.push(path, { scroll: false }));
      return;
    }
    setFilters(DEFAULT_FILTERS);
    window.history.pushState(null, "", path);
  }, [held, path, router]);

  // Back and Forward move between filter states the same way they always did,
  // except now nothing is fetched: the URL is the input, the local snapshot is
  // the data. Without this the address bar would rewind while the page stood
  // still.
  useEffect(() => {
    const onPop = () => {
      const params = Object.fromEntries(new URLSearchParams(window.location.search));
      setFilters(parseFilters(params));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  return { filters, view, apply, reset, pending, local: useLocal || Boolean(held), snapshot };
}
