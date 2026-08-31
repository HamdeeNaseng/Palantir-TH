"use client";

import { useEffect, useState } from "react";
import type { DistancePatternResponse } from "@/app/api/distance-pattern/route";
import type { DistancePattern } from "./distance-pattern";

/**
 * The distance pattern of whichever case is selected, fetched on demand.
 *
 * Deliberately *not* the module-scope cache `useFacilities` uses. That list is
 * one filter-independent constant shared by three maps; this is one document
 * out of ~10,000, and caching every case an analyst clicks through a session
 * would grow without bound to save a request that costs ~1.5 KB. A small
 * bounded map is kept instead, so clicking back and forth between two cases
 * does not re-fetch either.
 *
 * `null` with `loading: false` and `failed: false` is the normal "the batch
 * has not covered this case" answer, and the caller renders that as an absent
 * layer rather than an error.
 */

const CACHE_LIMIT = 24;
const cache = new Map<string, DistancePattern | null>();

function remember(eventId: string, pattern: DistancePattern | null) {
  // Insertion-ordered, so the oldest key is the first one `keys()` yields.
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(eventId, pattern);
}

export interface DistancePatternState {
  pattern: DistancePattern | null;
  loading: boolean;
  failed: boolean;
}

export function useDistancePattern(eventId: string | null): DistancePatternState {
  const [pattern, setPattern] = useState<DistancePattern | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!eventId) {
      setPattern(null);
      setFailed(false);
      setLoading(false);
      return;
    }

    if (cache.has(eventId)) {
      setPattern(cache.get(eventId) ?? null);
      setFailed(false);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setFailed(false);
    // Cleared immediately: keeping the previous case's spokes on screen while
    // the new one loads would draw one case's surroundings around another.
    setPattern(null);

    fetch(`/api/distance-pattern?eventId=${encodeURIComponent(eventId)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<DistancePatternResponse>;
      })
      .then((data) => {
        remember(eventId, data.pattern);
        if (!cancelled) setPattern(data.pattern);
      })
      .catch(() => {
        // Not remembered: a flaky request must not become the cached answer.
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [eventId]);

  return { pattern, loading, failed };
}
