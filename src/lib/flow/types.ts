import type { Position } from "@/lib/geography";

/**
 * Domain types for the road-network flow-analysis pipeline (P0 scope only —
 * see the plan for the P1-P3 items this deliberately does not build:
 * segment-flow aggregation, time-decay weighting, K-shortest paths, (T)NKDE,
 * Markov/HMM/Bayesian prediction).
 */

/** One event, reduced to what the pipeline needs — decoupled from Mongo. */
export interface TimedPoint {
  id: string;
  lng: number;
  lat: number;
  tsMs: number;
  /** Nominal positional error in metres — GEO_PRECISION_RADIUS_M for the event's geo_precision. */
  geoPrecisionM: number;
}

/** Where a point landed once snapped onto the road network. */
export interface RoadMatch {
  point: Position;
  snapDistanceM: number;
  /** 0-1, derived from how far the snap moved the point relative to its own geo_precision radius. */
  matchConfidence: number;
}

/**
 * Never a boolean — "did this move at a plausible speed" is a band, not a
 * fact, because road distance and elapsed time are both approximations.
 */
export type FeasibilityBand =
  | "impossible"
  | "very_unlikely"
  | "possible"
  | "likely"
  | "highly_plausible";

export type CompassDirection = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";

/** One event-to-event corridor: the real road path, not a straight line. */
export interface FlowLeg {
  fromId: string;
  toId: string;
  deltaMs: number;
  roadDistanceM: number;
  /** Decoded route geometry, [lng, lat] pairs in travel order. */
  geometry: Position[];
  impliedSpeedKmh: number;
  feasibility: FeasibilityBand;
  /** Heading of the route's final segment, not raw start->end bearing. */
  bearingDeg: number;
  direction: CompassDirection;
  /** matchConfidence of the weaker of the two endpoints' road snaps. */
  matchConfidence: number;
}
