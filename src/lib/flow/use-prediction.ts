"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PredictionBundle,
  PredictionCorridorProps,
  PredictionFeatureCollection,
  PredictionForecast,
  PredictionUnavailableReason,
} from "./prediction";

/**
 * The precomputed route-prediction model, fetched on demand.
 *
 * Opt-in and fetched once per session. The payload only changes when the batch
 * in `ml-server/` promotes a new run — a cron-scale event, not something the
 * user can trigger — so re-fetching on every toggle would be spending
 * bandwidth to learn nothing.
 *
 * `unavailable` is sticky: once the server has said there is no model, asking
 * again on the next toggle cannot produce a different answer until somebody
 * runs the batch.
 */

interface PredictionState {
  bundle: PredictionBundle | null;
  loading: boolean;
  reason: PredictionUnavailableReason | null;
}

export function usePrediction(enabled: boolean): PredictionState {
  const [bundle, setBundle] = useState<PredictionBundle | null>(null);
  const [reason, setReason] = useState<PredictionUnavailableReason | null>(null);
  const [loading, setLoading] = useState(false);
  const requested = useRef(false);

  useEffect(() => {
    if (!enabled || requested.current) return;
    requested.current = true;

    let cancelled = false;
    setLoading(true);

    fetch("/api/flow/prediction")
      .then((res) => res.json())
      .then((data: PredictionBundle | { unavailable: true; reason: PredictionUnavailableReason }) => {
        if (cancelled) return;
        if ("unavailable" in data) {
          setReason(data.reason);
          return;
        }
        setBundle(data);
      })
      .catch(() => {
        // A network failure is not the same as "no model exists", but from the
        // layer's point of view both mean it cannot draw. The database wording
        // is the honest one for an unreachable server.
        if (!cancelled) setReason("db-unreachable");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { bundle, loading, reason };
}

interface AnchorDetail {
  forecast: PredictionForecast;
  corridors: PredictionFeatureCollection<PredictionCorridorProps>;
}

interface AnchorDetailState {
  detail: AnchorDetail | null;
  loading: boolean;
  select: (anchorId: string | null) => void;
  selectedId: string | null;
}

/**
 * One anchor's forecast, on click.
 *
 * Cached by anchor id, because clicking back and forth between two districts
 * to compare them is the normal way this gets read, and re-fetching a forecast
 * that cannot have changed makes that comparison feel broken.
 */
export function useAnchorDetail(): AnchorDetailState {
  const cache = useRef(new Map<string, AnchorDetail>());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AnchorDetail | null>(null);
  const [loading, setLoading] = useState(false);

  const select = useCallback((anchorId: string | null) => {
    setSelectedId(anchorId);
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }

    const cached = cache.current.get(selectedId);
    if (cached) {
      setDetail(cached);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setDetail(null);

    fetch(`/api/flow/prediction/anchor?id=${encodeURIComponent(selectedId)}`)
      // A 404 is an unknown anchor, not a payload. Parsing it anyway would
      // cache an object with no forecast on it and render blank rows.
      .then((res) => (res.ok ? res.json() : null))
      .then((data: AnchorDetail | { unavailable: true } | null) => {
        if (cancelled || data === null || "unavailable" in data) return;
        cache.current.set(selectedId, data);
        setDetail(data);
      })
      .catch(() => {
        if (!cancelled) setDetail(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  return { detail, loading, select, selectedId };
}
