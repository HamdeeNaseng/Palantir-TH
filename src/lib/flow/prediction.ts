import type { Position } from "@/lib/geography";

/**
 * Domain types for the Bayesian route-prediction model built by `ml-server/`.
 *
 * Distinct from `./types.ts`, which describes the in-process P0 pipeline
 * (`computeFlowLegs`) — that one answers "what road path connects these two
 * events", per request, from event coordinates the client already holds. This
 * one answers "which corridors does the corpus as a whole implicate, and where
 * is activity likely next", precomputed by a batch job.
 *
 * The distinction matters at the UI level too. A `FlowLeg` is an observation
 * about two specific events; a `PredictionCorridor` is a statistical claim
 * about a district pair, at 8 km resolution, and it carries the caveats that
 * go with that.
 */

/** Why the prediction layers cannot draw — `null` while they can. */
export type PredictionUnavailableReason = "no-model-run" | "db-unreachable";

/**
 * How the model scored on its held-out window.
 *
 * `top3` must never be shown without `randomTop3` beside it. On the current
 * corpus they are ~0.15 and ~0.013 — about eleven times better than guessing,
 * and nowhere near accurate. Either number alone misleads in one direction or
 * the other.
 */
export interface PredictionSkill {
  top3: number | null;
  randomTop3: number | null;
  logLoss: number | null;
  skillVsUniform: number | null;
}

/** Provenance for everything else in the bundle. */
export interface PredictionRunMeta {
  runId: string;
  modelVersion: string;
  /** ISO 8601, or null for a run that never finished. */
  builtAt: string | null;
  /** Fitted time-decay constant in days — not a chosen one. */
  tauDays: number | null;
  /** Fitted recency/corridor mix, 0 = recency only, 1 = corridor only. */
  blend: number | null;
  skill: PredictionSkill;
  /** The interpretation limits, carried from the batch rather than restated here. */
  caveats: string[];
  corpus: {
    events: number | null;
    anchors: number | null;
    activeDays: number | null;
    /** Last event in the corpus, ISO 8601. The model knows nothing after it. */
    dataThrough: string | null;
  };
}

/** One district anchor: a centroid snapped onto the road network. */
export interface PredictionAnchorProps {
  anchor_id: string;
  name: string;
  district: string | null;
  n_events: number;
  /**
   * 0–1. Exactly zero for a district centroid, whose ±8 km error makes the
   * road it snapped to arbitrary. Drives corridor opacity — a faint line here
   * is the honest render, not something to tune away.
   */
  match_confidence: number;
  /** Time-decayed event weight at the end of the corpus. */
  recency_weight: number;
}

/** One candidate corridor between two anchors, as drawn. */
export interface PredictionCorridorProps {
  from_id: string;
  to_id: string;
  from_name: string;
  to_name: string;
  /** 1 = most likely of the candidates for this pair. */
  rank: number;
  posterior: number;
  prior: number;
  length_m: number;
  /** Days this pair was active in the same window. */
  cooccurrence_days: number;
  match_confidence: number;
  /**
   * True when evidence barely moved the road-graph prior. The percentage is
   * then the prior restated, and showing it bare would claim support that is
   * not there.
   */
  prior_dominated: boolean;
}

/** One road segment of the network flow map. */
export interface PredictionSegmentProps {
  /** 0–1 against the busiest segment in the run. */
  flow_normalised: number;
  flow: number;
}

export interface PredictionFeature<P> {
  type: "Feature";
  geometry: { type: "LineString"; coordinates: Position[] } | { type: "Point"; coordinates: Position };
  properties: P;
}

export interface PredictionFeatureCollection<P> {
  type: "FeatureCollection";
  features: PredictionFeature<P>[];
}

/** One district in a next-district posterior, with its credible interval. */
export interface PredictionForecastEntry {
  anchorId: string;
  name: string;
  mean: number;
  /** 90% credible interval. The width is the point: 0.08 on three
   *  observations and 0.08 on three hundred are different claims. */
  low: number;
  high: number;
  cooccurrenceDays: number;
  roadDistanceM: number | null;
}

export interface PredictionForecast {
  anchorId: string;
  name: string;
  observations: number;
  entries: PredictionForecastEntry[];
}

/** The section-12 prediction card: where activity is expected next. */
export interface PredictionOutlook {
  /**
   * The day after the last event in the corpus — deliberately not "today".
   * The model knows nothing about the gap between the two.
   */
  asOf: string | null;
  focus: { anchorId: string; name: string } | null;
  top: { anchorId: string; name: string; probability: number }[];
}

/** Everything the map layers need, in one payload. */
export interface PredictionBundle {
  run: PredictionRunMeta;
  outlook: PredictionOutlook | null;
  anchors: PredictionFeatureCollection<PredictionAnchorProps>;
  corridors: PredictionFeatureCollection<PredictionCorridorProps>;
  segments: PredictionFeatureCollection<PredictionSegmentProps>;
}

/** What the API returns when there is nothing to draw yet. */
export interface PredictionUnavailable {
  unavailable: true;
  reason: PredictionUnavailableReason;
}

export type PredictionResponse = PredictionBundle | PredictionUnavailable;

export function isPredictionUnavailable(
  value: PredictionResponse,
): value is PredictionUnavailable {
  return "unavailable" in value;
}
