import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { distanceMetres, type Position } from "@/lib/geography";

/**
 * The road network, as a routing graph — the replacement for a self-hosted
 * routing service.
 *
 * Server-only: reads from disk, exactly like `@/lib/geography`. Built by
 * `scripts/fetch-roads.ts`, which does the deterministic half of the work
 * (node identity, adjacency, clipping) so a cold start here is a parse and an
 * index build rather than a topology rebuild.
 *
 * Absent file is a supported state, not a crash: the corridor layer is opt-in
 * and everything else on `/events` and `/map` must keep working for someone
 * who has only run the boundary fetch. `loadRoadGraph()` returns `null` and
 * the API reports the layer unavailable, the same way an unset provider used
 * to.
 */

const DATA_FILE = resolve(process.cwd(), "public/data/south-roads.graph.json");

/** `[fromIndex, toIndex, lengthMetres, speedKmh]`, directed. */
type EdgeTuple = [number, number, number, number];

interface RawGraph {
  nodes: [number, number][];
  edges: EdgeTuple[];
}

export interface RoadGraph {
  nodes: [number, number][];
  /** Per node, the outgoing edges — built once so Dijkstra never scans all edges. */
  adjacency: { to: number; length: number; speed: number }[][];
  /** Grid bucket -> node indices, for nearest-road lookup without an R-tree dependency. */
  grid: Map<string, number[]>;
}

/**
 * Snapping needs "which road is nearest this point", and scanning ~200k nodes
 * per event is too slow to do per request. A uniform lat/lng grid is enough
 * here and costs no dependency: the four provinces span ~2.5°, and at this
 * cell size a bucket holds a handful of nodes. Not an R-tree — the data is
 * points in a small, evenly-populated box, which is the case a grid handles
 * as well as a tree.
 */
const GRID_DEG = 0.01;

function cellKey(lng: number, lat: number): string {
  return `${Math.floor(lng / GRID_DEG)}:${Math.floor(lat / GRID_DEG)}`;
}

let cache: RoadGraph | null | undefined;

/** The graph, or `null` when `scripts/fetch-roads.ts` has not been run. */
export function loadRoadGraph(): RoadGraph | null {
  if (cache !== undefined) return cache;

  try {
    const raw = JSON.parse(readFileSync(DATA_FILE, "utf8")) as RawGraph;

    const adjacency: RoadGraph["adjacency"] = Array.from({ length: raw.nodes.length }, () => []);
    for (const [from, to, length, speed] of raw.edges) {
      adjacency[from]?.push({ to, length, speed });
    }

    const grid = new Map<string, number[]>();
    for (let i = 0; i < raw.nodes.length; i++) {
      const [lng, lat] = raw.nodes[i];
      const key = cellKey(lng, lat);
      const bucket = grid.get(key);
      if (bucket) bucket.push(i);
      else grid.set(key, [i]);
    }

    cache = { nodes: raw.nodes, adjacency, grid };
  } catch {
    // Not fetched yet, or unreadable. An honest "no network available".
    cache = null;
  }
  return cache;
}

/**
 * The nearest graph node to a point, searched outward one grid ring at a time.
 *
 * Rings rather than one fixed radius: a point in town hits a node in the first
 * ring, while one in the hills may need several, and sizing a single radius
 * for the worst case would make the common case scan far more than it needs.
 * Gives up past `maxRings` so a point far offshore fails fast instead of
 * walking the whole grid.
 */
export function nearestNode(
  graph: RoadGraph,
  point: Position,
  maxRings = 12,
): { index: number; distanceM: number } | null {
  const [lng, lat] = point;
  const cx = Math.floor(lng / GRID_DEG);
  const cy = Math.floor(lat / GRID_DEG);

  let best: number | null = null;
  let bestDistance = Infinity;

  for (let ring = 0; ring <= maxRings; ring++) {
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dy = -ring; dy <= ring; dy++) {
        // Only the ring's perimeter — the interior was covered by earlier rings.
        if (ring > 0 && Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue;
        for (const i of graph.grid.get(`${cx + dx}:${cy + dy}`) ?? []) {
          const d = distanceMetres(point, graph.nodes[i]);
          if (d < bestDistance) {
            bestDistance = d;
            best = i;
          }
        }
      }
    }
    // One extra ring after the first hit: the nearest node by straight-line
    // distance can sit in a neighbouring cell to the one the point falls in.
    if (best !== null && ring > 0) break;
  }

  return best === null ? null : { index: best, distanceM: bestDistance };
}

/**
 * Shortest path by road distance, as A* with a great-circle heuristic.
 *
 * Distance, not travel time, is what the cost function minimises — the
 * feasibility check downstream compares road distance against elapsed time,
 * and optimising the path for speed first would bake an assumed velocity into
 * the very number that check exists to test.
 *
 * The heuristic is straight-line distance to the target, which never exceeds
 * true road distance and so is admissible: A* returns the same path Dijkstra
 * would, after visiting far fewer nodes.
 *
 * The frontier is a plain array scanned for its minimum rather than a binary
 * heap. For the few-thousand-node frontiers these province-scale queries
 * produce that is fast enough, and a hand-rolled heap is a well-known source
 * of subtle bugs; if profiling ever says otherwise this is the place to change.
 */
export function shortestPath(
  graph: RoadGraph,
  fromIndex: number,
  toIndex: number,
  maxVisited = 200_000,
): { distanceM: number; geometry: Position[] } | null {
  if (fromIndex === toIndex) {
    return { distanceM: 0, geometry: [graph.nodes[fromIndex]] };
  }

  const target = graph.nodes[toIndex];
  const best = new Map<number, number>([[fromIndex, 0]]);
  const cameFrom = new Map<number, number>();
  const visited = new Set<number>();
  const frontier = new Map<number, number>([
    [fromIndex, distanceMetres(graph.nodes[fromIndex], target)],
  ]);

  let visits = 0;
  while (frontier.size > 0 && visits < maxVisited) {
    let current = -1;
    let currentScore = Infinity;
    for (const [node, score] of frontier) {
      if (score < currentScore) {
        currentScore = score;
        current = node;
      }
    }
    frontier.delete(current);
    if (visited.has(current)) continue;
    visited.add(current);
    visits++;

    if (current === toIndex) {
      const path: Position[] = [];
      for (let at: number | undefined = toIndex; at !== undefined; at = cameFrom.get(at)) {
        path.push(graph.nodes[at]);
      }
      path.reverse();
      return { distanceM: best.get(toIndex) ?? 0, geometry: path };
    }

    const costHere = best.get(current) ?? Infinity;
    for (const edge of graph.adjacency[current] ?? []) {
      if (visited.has(edge.to)) continue;
      const tentative = costHere + edge.length;
      if (tentative >= (best.get(edge.to) ?? Infinity)) continue;
      best.set(edge.to, tentative);
      cameFrom.set(edge.to, current);
      frontier.set(edge.to, tentative + distanceMetres(graph.nodes[edge.to], target));
    }
  }

  // Disconnected, or past the visit ceiling — no defensible route either way.
  return null;
}
