"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
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
  /**
   * `apply` for a control that fires on every interaction rather than on a
   * button press. Only usable while `local` is true — see its own note.
   */
  applyLive: (next: InvestigationFilters) => void;
  reset: () => void;
  /** True while a fallback server navigation is in flight. */
  pending: boolean;
  /** True once filtering happens locally — nothing here hits the network. */
  local: boolean;
  snapshot: SnapshotState;
}

/**
 * How long after the last change a live filter session is considered over.
 *
 * Ticking four provinces is one act of filtering and should be one press of
 * Back, not four. Within the burst the history entry is rewritten in place;
 * the next change after a pause opens a new one.
 */
const LIVE_BURST_MS = 700;

export function useLocalFilters<TView>({
  path,
  initialFilters,
  initialView,
  initialVersion,
  initialBuiltAtMs,
  build,
}: {
  /** Where a fallback navigation goes, e.g. `/events`. */
  path: string;
  initialFilters: InvestigationFilters;
  /** What the server rendered for `initialFilters` — the first paint. */
  initialView: TView;
  /** The snapshot version `initialView` was built from, so a newer one wins. */
  initialVersion: string;
  /** When that snapshot was read from MongoDB, for deciding which copy is newer. */
  initialBuiltAtMs: number;
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

  /**
   * A snapshot is only usable if the server that built it could reach MongoDB.
   * One built during an outage carries `live: false` and no events; filtering
   * against it answers everything with nothing, which is worse than the server
   * round trip it replaces.
   */
  const held = snapshot.snapshot?.live ? snapshot.snapshot : null;

  /**
   * Rebuild locally when the filters have moved off what the server rendered,
   * or when the held copy is genuinely newer than the one the server rendered
   * from. Otherwise keep the server's own output: it is the same function over
   * the same data, so recomputing it would cost ~10k events of work to arrive
   * back where we started.
   *
   * Newer is decided on `builtAtMs`, not on the versions merely differing.
   * A hash says two datasets are not the same; it cannot say which came first,
   * and "different, therefore mine wins" is how a stale cache displaces a
   * fresher server render.
   */
  const useLocal =
    held !== null &&
    (filtersChanged ||
      (held.version !== initialVersion && held.builtAtMs > initialBuiltAtMs));

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

  /**
   * Applied continuously, as the analyst ticks boxes, with no button in
   * between. Two things make that safe here and nowhere else:
   *
   *   1. It is guarded on `held`. Without a local dataset `apply` answers a
   *      filter change with a server navigation, and doing that per checkbox
   *      would be a request storm — so a caller must not turn live filtering
   *      on until `local` says the browser can answer for itself.
   *   2. History entries are coalesced (see `LIVE_BURST_MS`), because
   *      `pushState` per interaction would bury whatever page the analyst
   *      came from under a dozen near-identical filter states.
   *
   * The rebuild itself is a transition — React's own `startTransition`, not
   * the hook's: it walks ~10k events and everything downstream of them and the
   * checkbox must not wait for that to paint, but it is also not a navigation,
   * and `pending` says a navigation is in flight.
   */
  const burstRef = useRef<number | null>(null);
  const applyLive = useCallback(
    (next: InvestigationFilters) => {
      if (!held) return;
      const query = serializeFilters(next);
      const url = query ? `${path}?${query}` : path;
      if (burstRef.current === null) window.history.pushState(null, "", url);
      else {
        window.clearTimeout(burstRef.current);
        window.history.replaceState(null, "", url);
      }
      burstRef.current = window.setTimeout(() => {
        burstRef.current = null;
      }, LIVE_BURST_MS);
      startTransition(() => setFilters(next));
    },
    [held, path],
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

  return {
    filters,
    view,
    apply,
    applyLive,
    reset,
    pending,
    local: useLocal || Boolean(held),
    snapshot,
  };
}
