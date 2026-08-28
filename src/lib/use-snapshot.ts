"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readCachedSnapshot, writeCachedSnapshot } from "./snapshot-cache";
import { SNAPSHOT_SCHEMA, type Snapshot } from "./snapshot";

/**
 * Keeps one copy of the dataset in the browser and re-reads MongoDB on a
 * schedule, so filtering never touches the network.
 *
 * The order on mount is IndexedDB first, network second. A returning visitor
 * gets a filterable dataset in a few milliseconds off disk, and the fetch that
 * follows only replaces it if the server's version differs — which the server
 * answers with a 304 when it does not.
 */

/** How often the browser goes back to MongoDB for a fresh dataset. */
export const SNAPSHOT_REFRESH_MS = 5 * 60_000;

export type SnapshotStatus =
  /** No usable dataset yet — filters still go through the server. */
  | "loading"
  /** A dataset is in hand and filtering is local. */
  | "ready"
  /** Usable dataset in hand, and a refresh is in flight behind it. */
  | "refreshing"
  /** No usable dataset and the last attempt failed. */
  | "error";

export interface SnapshotState {
  snapshot: Snapshot | null;
  status: SnapshotStatus;
  /** When this browser last reached the server, whatever the answer was. */
  syncedAtMs: number | null;
  /** Why the last fetch failed, for the sidebar to show. */
  error: string | null;
  /** Force a refresh now, ignoring the schedule. */
  refresh: () => void;
}

/** Returns the new snapshot, or null when the server says nothing changed. */
async function fetchSnapshot(
  currentVersion: string | null,
  signal: AbortSignal,
): Promise<Snapshot | null> {
  const response = await fetch("/api/snapshot", {
    signal,
    // Freshness is decided here, against our own sync clock, not by the HTTP
    // cache; the conditional request below is what makes an unchanged poll
    // cost a few hundred bytes instead of 372 KB.
    cache: "no-store",
    headers: currentVersion ? { "If-None-Match": `"${currentVersion}"` } : undefined,
  });

  if (response.status === 304) return null;
  if (!response.ok) throw new Error(`/api/snapshot responded ${response.status}`);

  const snapshot = (await response.json()) as Snapshot;
  if (snapshot.schema !== SNAPSHOT_SCHEMA) {
    throw new Error(`snapshot schema ${snapshot.schema}, this build expects ${SNAPSHOT_SCHEMA}`);
  }
  return snapshot;
}

export function useSnapshot(): SnapshotState {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [status, setStatus] = useState<SnapshotStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [syncedAtMs, setSyncedAtMs] = useState<number | null>(null);

  /**
   * State the scheduler reads without depending on it. Keeping the held
   * version and the last sync instant in refs is what lets the polling effect
   * mount once for the life of the page, instead of tearing down and
   * rescheduling every time new data lands.
   */
  const versionRef = useRef<string | null>(null);
  const syncedAtRef = useRef(0);
  const inFlightRef = useRef<AbortController | null>(null);

  const sync = useCallback(async () => {
    // A refresh already running is the one we want; starting a second would
    // just race it for the same bytes.
    if (inFlightRef.current) return;
    const controller = new AbortController();
    inFlightRef.current = controller;
    setStatus((s) => (s === "ready" ? "refreshing" : s));

    try {
      const next = await fetchSnapshot(versionRef.current, controller.signal);
      if (next) {
        versionRef.current = next.version;
        setSnapshot(next);
        void writeCachedSnapshot(next);
      }
      // A 304 is a successful sync: it confirms the held copy is current, and
      // the schedule should restart from now rather than retry in a tight loop.
      syncedAtRef.current = Date.now();
      setSyncedAtMs(syncedAtRef.current);
      setError(null);
      setStatus("ready");
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : String(err));
      // A failed refresh is not a lost dataset: keep serving the one in hand
      // and say so, rather than dropping the page back to server round trips.
      setStatus(versionRef.current ? "ready" : "error");
      console.error("[useSnapshot] refresh failed:", err);
    } finally {
      inFlightRef.current = null;
    }
  }, []);

  // Cache first, then network — see the module comment.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const cachedSnapshot = await readCachedSnapshot();
      if (cancelled) return;
      if (cachedSnapshot) {
        versionRef.current = cachedSnapshot.version;
        setSnapshot(cachedSnapshot);
        setStatus("ready");
      }
      void sync();
    })();
    return () => {
      cancelled = true;
      inFlightRef.current?.abort();
    };
  }, [sync]);

  useEffect(() => {
    const timer = window.setInterval(() => void sync(), SNAPSHOT_REFRESH_MS);

    // A background tab's timers are throttled to minutes or stopped outright,
    // so the interval alone would quietly stop meaning "every five minutes".
    // Returning to the tab checks whether the schedule was missed and catches
    // up immediately if it was, rather than waiting out the next tick.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - syncedAtRef.current >= SNAPSHOT_REFRESH_MS) void sync();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [sync]);

  const refresh = useCallback(() => void sync(), [sync]);

  return { snapshot, status, syncedAtMs, error, refresh };
}
