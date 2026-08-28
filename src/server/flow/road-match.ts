import { matchConfidence } from "@/lib/flow/feasibility";
import type { RoadMatch, TimedPoint } from "@/lib/flow/types";
import { nearestNode, type RoadGraph } from "./road-graph";

/**
 * Snaps one event onto the road network — the map-matching step, done against
 * the local graph rather than a routing service.
 *
 * Returns the graph node index alongside the geometry, because the path
 * search needs the node and re-deriving it later would mean snapping twice.
 * `null` when nothing is near enough to be defensible: the four provinces
 * have coastline and forest where the nearest through-road is kilometres
 * away, and snapping to it would invent a corridor through terrain that has
 * no road at all.
 */
export interface RoadSnap extends RoadMatch {
  nodeIndex: number;
}

/**
 * Past this, the snap is not evidence of anything. Deliberately well beyond
 * `GEO_PRECISION_RADIUS_M.district` (8 km) so a district-centroid event still
 * snaps — it just snaps with a low `matchConfidence`, which is the honest
 * signal, rather than being dropped outright.
 */
const MAX_SNAP_M = 12_000;

export function snapToRoad(graph: RoadGraph, point: TimedPoint): RoadSnap | null {
  const found = nearestNode(graph, [point.lng, point.lat]);
  if (!found || found.distanceM > MAX_SNAP_M) return null;

  return {
    nodeIndex: found.index,
    point: graph.nodes[found.index],
    snapDistanceM: found.distanceM,
    matchConfidence: matchConfidence(found.distanceM, point.geoPrecisionM),
  };
}
