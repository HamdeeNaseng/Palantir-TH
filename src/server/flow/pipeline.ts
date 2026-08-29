import { bearingDeg, compassDirection } from "@/lib/flow/geo-math";
import { classifyFeasibility } from "@/lib/flow/feasibility";
import type { FlowLeg, TimedPoint } from "@/lib/flow/types";
import { loadRoadGraph, shortestPath, type RoadGraph } from "./road-graph";
import { snapToRoad, type RoadSnap } from "./road-match";

/**
 * Temporal sequencing -> map matching -> shortest road path -> time-distance
 * feasibility -> route direction. The P0 items only — segment-flow
 * aggregation, time-decay weighting, K-shortest paths, (T)NKDE, and
 * Markov/HMM/Bayesian prediction are deliberately not built here.
 *
 * Entirely in-process: the graph is a cached module singleton, so this does no
 * I/O per request beyond the first cold-start read.
 */

export type FlowResult =
  | { ok: true; legs: (FlowLeg | null)[] }
  /** The road graph has not been fetched — `npm run gis:roads`. */
  | { ok: false; reason: "no-road-data" };

/**
 * Several independent chains in one pass — one per event family, since a
 * corridor between two events of different families asserts a movement nobody
 * claimed. The graph is loaded once for all of them; each sequence is chained
 * strictly within itself.
 */
export function computeFlowSequences(sequences: TimedPoint[][]): FlowResult {
  const graph = loadRoadGraph();
  if (!graph) return { ok: false, reason: "no-road-data" };

  return { ok: true, legs: sequences.flatMap((points) => legsOfSequence(graph, points)) };
}

function legsOfSequence(graph: RoadGraph, points: TimedPoint[]): (FlowLeg | null)[] {
  const sorted = [...points].sort((a, b) => a.tsMs - b.tsMs);
  if (sorted.length < 2) return [];

  const snaps = sorted.map((p) => snapToRoad(graph, p));

  return sorted.slice(1).map((to, i) => computeLeg(graph, sorted[i], snaps[i], to, snaps[i + 1]));
}

/**
 * One event-to-event corridor. `null` — never a thrown error — when this pair
 * cannot be routed: a pair that fails must not cost the rest of the sequence,
 * the same way `toEventFeature` skips a geo-less event rather than failing the
 * whole collection.
 */
function computeLeg(
  graph: RoadGraph,
  from: TimedPoint,
  fromSnap: RoadSnap | null,
  to: TimedPoint,
  toSnap: RoadSnap | null,
): FlowLeg | null {
  if (!fromSnap || !toSnap) return null;

  const path = shortestPath(graph, fromSnap.nodeIndex, toSnap.nodeIndex);
  if (!path || path.geometry.length < 2) return null;

  const deltaMs = Math.max(1, to.tsMs - from.tsMs);
  const impliedSpeedKmh = (path.distanceM / (deltaMs / 1000)) * 3.6;

  // Heading of the route's final segment, not the raw start->end bearing: a
  // corridor that curves north at its end is heading north, whatever the
  // straight line between the two events says.
  const [penultimate, last] = path.geometry.slice(-2);
  const bearing = bearingDeg(penultimate, last);

  return {
    fromId: from.id,
    toId: to.id,
    deltaMs: to.tsMs - from.tsMs,
    roadDistanceM: path.distanceM,
    geometry: path.geometry,
    impliedSpeedKmh,
    feasibility: classifyFeasibility(impliedSpeedKmh),
    bearingDeg: bearing,
    direction: compassDirection(bearing),
    matchConfidence: Math.min(fromSnap.matchConfidence, toSnap.matchConfidence),
  };
}
