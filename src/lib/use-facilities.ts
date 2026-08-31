"use client";

import { useEffect, useState } from "react";
import type { FacilitiesResponse } from "@/app/api/facilities/route";
import type { FacilityMark } from "./facilities";

/**
 * The response network, fetched once per session and shared by every map.
 *
 * Cached at module scope rather than in a ref, because the three consoles that
 * draw this overlay are three separate components a client navigation swaps
 * between — a per-component `requested` ref would fetch the same 217 rows again
 * on every visit to `/events`. The in-flight promise is held for the same
 * reason: `/map` mounts one map, and nothing stops a future page mounting two.
 *
 * A failure is not fatal. `failed` lets the layer say so in its own toggle row;
 * the map keeps drawing everything else.
 */

let cache: FacilityMark[] | null = null;
let inflight: Promise<FacilityMark[]> | null = null;

function load(): Promise<FacilityMark[]> {
  if (cache) return Promise.resolve(cache);
  if (inflight) return inflight;

  inflight = fetch("/api/facilities")
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<FacilitiesResponse>;
    })
    .then((data) => {
      cache = data.facilities;
      return cache;
    })
    .finally(() => {
      // Cleared either way: a failed attempt must not be the answer every later
      // caller awaits, or one flaky request would disable the layer for good.
      inflight = null;
    });

  return inflight;
}

export interface FacilitiesState {
  facilities: FacilityMark[];
  loading: boolean;
  failed: boolean;
}

const EMPTY: FacilityMark[] = [];

export function useFacilities(enabled: boolean): FacilitiesState {
  const [facilities, setFacilities] = useState<FacilityMark[]>(cache ?? EMPTY);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!enabled || cache) {
      if (cache) setFacilities(cache);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setFailed(false);

    load()
      .then((list) => {
        if (!cancelled) setFacilities(list);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { facilities, loading, failed };
}
