"use client";

import { useEffect, useRef, useState } from "react";
import type { LinkGroup } from "@/lib/events-replay";
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
 * Real road-network corridors for the recent-movement window, via
 * `POST /api/flow/legs`. Opt-in (`enabled`) and cached across scrubs by
 * event-id pair in a ref, so moving the playhead only fetches the pairs that
 * just entered the window — most of a window survives from one tick to the
 * next, the same locality `scopedTimePaths`' straight-line version gets for
 * free by staying client-side.
 *
 * Takes the per-family `LinkGroup[]` rather than one flat window, and chains
 * each group separately: a corridor is only ever routed between two events of
 * the same family, exactly like the straight lines it replaces. Sending one
 * flat array here would have quietly re-introduced the cross-family pair at
 * every group boundary.
 */
export function useFlowLegs(groups: LinkGroup[], enabled: boolean): FlowLegsResult {
  const cacheRef = useRef(new Map<string, FlowLeg>());
  const [legs, setLegs] = useState<FlowLeg[]>([]);
  const [reason, setReason] = useState<FlowUnavailableReason | null>(null);
  const [loading, setLoading] = useState(false);
  const unavailable = reason !== null;

  useEffect(() => {
    const sequences = groups.filter((g) => g.features.length >= 2);
    if (!enabled || unavailable || sequences.length === 0) {
      setLegs([]);
      return;
    }

    const cache = cacheRef.current;
    const pairs = sequences.flatMap((g) =>
      g.features.slice(1).map((to, i) => [g.features[i], to] as const),
    );
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

    // One request, one sequence per family: the route chains consecutive
    // points *within* a sequence and never across them.
    const body = {
      sequences: sequences.map((g) =>
        g.features.map((f) => ({
          id: f.properties.id,
          lng: f.geometry.coordinates[0],
          lat: f.geometry.coordinates[1],
          tsMs: f.properties.ts,
          geoPrecisionM: f.properties.precision_m,
        })),
      ),
    };

    fetch("/api/flow/legs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
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
  }, [groups, enabled, unavailable]);

  return { legs, unavailable, reason, loading };
}
