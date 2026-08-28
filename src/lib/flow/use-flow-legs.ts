"use client";

import { useEffect, useRef, useState } from "react";
import type { EventFeature } from "@/server/shared-events";
import type { FlowLeg } from "./types";

function legKey(fromId: string, toId: string): string {
  return `${fromId}:${toId}`;
}

/** Why the layer cannot draw — `null` while it can. */
export type FlowUnavailableReason = "no-road-data";

interface FlowLegsResult {
  legs: FlowLeg[];
  /** True once the server has said the routing engine can't serve this — stop asking. */
  unavailable: boolean;
  /** Which failure it was, so the UI can say something more useful than "off". */
  reason: FlowUnavailableReason | null;
  loading: boolean;
}

/**
 * Real road-network corridors for a chronological window of events, via
 * `POST /api/flow/legs`. Opt-in (`enabled`) and cached across scrubs by
 * event-id pair in a ref, so moving the playhead only fetches the pairs that
 * just entered the window — most of a window survives from one tick to the
 * next, the same locality `scopedTimePath`'s straight-line version gets for
 * free by staying client-side.
 */
export function useFlowLegs(window: EventFeature[], enabled: boolean): FlowLegsResult {
  const cacheRef = useRef(new Map<string, FlowLeg>());
  const [legs, setLegs] = useState<FlowLeg[]>([]);
  const [reason, setReason] = useState<FlowUnavailableReason | null>(null);
  const [loading, setLoading] = useState(false);
  const unavailable = reason !== null;

  useEffect(() => {
    if (!enabled || unavailable || window.length < 2) {
      setLegs([]);
      return;
    }

    const cache = cacheRef.current;
    const pairs = window.slice(1).map((to, i) => [window[i], to] as const);
    const resolve = () =>
      pairs
        .map(([from, to]) => cache.get(legKey(from.properties.id, to.properties.id)))
        .filter((leg): leg is FlowLeg => leg !== undefined);

    const missing = pairs.some(
      ([from, to]) => !cache.has(legKey(from.properties.id, to.properties.id)),
    );
    if (!missing) {
      setLegs(resolve());
      return;
    }

    let cancelled = false;
    setLoading(true);

    const points = window.map((f) => ({
      id: f.properties.id,
      lng: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
      tsMs: f.properties.ts,
      geoPrecisionM: f.properties.precision_m,
    }));

    fetch("/api/flow/legs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ points }),
    })
      .then((res) => res.json())
      .then((data: { legs: (FlowLeg | null)[]; unavailable?: boolean; reason?: FlowUnavailableReason }) => {
        if (cancelled) return;
        if (data.unavailable) {
          setReason(data.reason ?? "no-road-data");
          setLegs([]);
          return;
        }
        for (const leg of data.legs) {
          if (leg) cache.set(legKey(leg.fromId, leg.toId), leg);
        }
        setLegs(resolve());
      })
      .catch(() => {
        if (!cancelled) setLegs([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [window, enabled, unavailable]);

  return { legs, unavailable, reason, loading };
}
