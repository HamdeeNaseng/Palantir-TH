import type { FeasibilityBand } from "./types";

/**
 * Upper speed (km/h) each band tolerates before falling into the next, less
 * plausible one. Deliberately generous rather than tuned to a single travel
 * mode — the south's roads carry everything from motorbikes to pickups, and
 * this is a feasibility *screen*, not a claim about how the trip was made.
 * `impossible` is everything above `veryUnlikely`.
 */
export const FEASIBILITY_SPEED_BANDS_KMH = {
  highlyPlausible: 80,
  likely: 120,
  possible: 150,
  veryUnlikely: 200,
} as const;

/** Bands the implied travel speed between two road-network-matched events. */
export function classifyFeasibility(impliedSpeedKmh: number): FeasibilityBand {
  if (impliedSpeedKmh <= FEASIBILITY_SPEED_BANDS_KMH.highlyPlausible) return "highly_plausible";
  if (impliedSpeedKmh <= FEASIBILITY_SPEED_BANDS_KMH.likely) return "likely";
  if (impliedSpeedKmh <= FEASIBILITY_SPEED_BANDS_KMH.possible) return "possible";
  if (impliedSpeedKmh <= FEASIBILITY_SPEED_BANDS_KMH.veryUnlikely) return "very_unlikely";
  return "impossible";
}

/**
 * Beyond this much positional error the coordinate says nothing about which
 * road an event was on — `GEO_PRECISION_RADIUS_M.district` (8 km), since a
 * district centroid is a label for an area, not a location within it.
 */
const USELESS_PRECISION_M = 8000;

/**
 * How far a snap can move a point before it stops being evidence. Generous
 * because the graph carries only the through network (motorway–tertiary), so
 * an event on a residential street legitimately snaps a few hundred metres to
 * the nearest road this app actually knows about.
 */
const SNAP_TOLERANCE_M = 2000;

/**
 * How confidently a point was placed on the road network, as two independent
 * doubts multiplied together.
 *
 *   - **How precise the coordinate was to begin with.** A GPS fix is a
 *     location; a district centroid is an area's label. The latter must score
 *     near zero however neatly it snaps, because a tidy snap of a centroid is
 *     an accident of where the centroid fell, not evidence about the event.
 *   - **How far snapping had to move it.** A point already beside a road is a
 *     stronger match than one dragged a kilometre to reach one.
 *
 * Multiplied, not averaged: either doubt alone is enough to make the corridor
 * endpoint untrustworthy, and averaging would let a confident-looking snap
 * paper over a coordinate that was never precise enough to snap at all.
 *
 * (An earlier version divided the snap distance *by* the precision radius,
 * which inverted the first rule — it scored a district centroid higher than a
 * GPS fix. The corridor's opacity is driven by this number, so that made the
 * least trustworthy legs the boldest ones on the map.)
 */
export function matchConfidence(snapDistanceM: number, geoPrecisionM: number): number {
  if (geoPrecisionM <= 0) return 0;
  const precisionScore = clamp01(1 - geoPrecisionM / USELESS_PRECISION_M);
  const snapScore = clamp01(1 - snapDistanceM / SNAP_TOLERANCE_M);
  return precisionScore * snapScore;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
