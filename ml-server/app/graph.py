"""The OSM road network: CSR adjacency, shortest paths, and route geometry.

Loads `public/data/south-roads.graph.json`, the routing graph
`scripts/fetch-roads.ts` builds from Overpass -- a node array plus directed
edge tuples `[from, to, lengthMetres, speedKmh]`, motorway through tertiary.

Paths minimise **distance, not travel time**, for the reason recorded in
`src/server/flow/road-graph.ts`: optimising on time bakes an assumed speed into
the very numbers the feasibility check exists to test.

Where this differs from the notebook: the notebook's Dijkstra is a pure-Python
heap, which is fine for the 60 pairs it demonstrates and far too slow for the
thousands a batch covers. The relaxation here is handed to
`scipy.sparse.csgraph`, which is the same algorithm at C speed over the same
CSR arrays. Distances are identical; the search is bounded by `limit` so a
short corridor does not pay for a full-graph sweep.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra

EARTH_RADIUS_M = 6_371_000.0


def haversine_m(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Great-circle distance in metres. Mirrors distanceMetres() in src/lib/geography.ts."""
    lo1, la1 = np.radians(a[..., 0]), np.radians(a[..., 1])
    lo2, la2 = np.radians(b[..., 0]), np.radians(b[..., 1])
    h = np.sin((la2 - la1) / 2) ** 2 + np.cos(la1) * np.cos(la2) * np.sin((lo2 - lo1) / 2) ** 2
    return 2 * EARTH_RADIUS_M * np.arcsin(np.sqrt(h))


@dataclass(frozen=True)
class Route:
    """One corridor: the edges it uses, how long it is, what class of road it runs on."""

    edges: np.ndarray
    length_m: float
    mean_speed_kmh: float

    @property
    def edge_set(self) -> set[int]:
        return set(self.edges.tolist())


class RoadGraph:
    def __init__(self, graph_path: Path, meta_path: Path):
        if not graph_path.exists():
            raise FileNotFoundError(
                f"{graph_path} missing. It is a generated artefact (~10 MB) built from "
                f"Overpass and not tracked in git, so a fresh clone will not have it. "
                f"Build it with `npm run gis:roads`."
            )
        with open(graph_path, encoding="utf-8") as f:
            raw = json.load(f)
        self.meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}

        self.nodes = np.asarray(raw["nodes"], dtype=np.float64)
        edges = np.asarray(raw["edges"], dtype=np.float64)
        del raw

        # CSR: sorting the directed edges by source makes a node out-edge list one
        # contiguous slice, which is what both scipy and the edge-recovery walk want.
        order = np.argsort(edges[:, 0], kind="stable")
        self.e_src = edges[order, 0].astype(np.int64)
        self.e_dst = edges[order, 1].astype(np.int64)
        # A zero-length edge is an explicit zero in a CSR matrix, which scipy reads
        # as "no edge". Clamping keeps a degenerate edge traversable.
        self.e_len = np.maximum(edges[order, 2], 0.1)
        self.e_speed = edges[order, 3]
        self.n_nodes = len(self.nodes)
        self.n_edges = len(self.e_src)
        self.indptr = np.searchsorted(self.e_src, np.arange(self.n_nodes + 1)).astype(np.int32)
        del edges

        assert self.indptr[-1] == self.n_edges, "CSR index does not cover every edge"
        self._base: csr_matrix | None = None

    def _matrix(self, weights: np.ndarray) -> csr_matrix:
        """A CSR view over the same topology with the given edge weights.

        Built from (data, indices, indptr) rather than from coordinate triples,
        because the coordinate constructor sums duplicate (u, v) entries and
        would fuse the parallel edges a road graph legitimately contains.
        """
        return csr_matrix(
            (weights, self.e_dst.astype(np.int32), self.indptr),
            shape=(self.n_nodes, self.n_nodes),
        )

    @property
    def base_matrix(self) -> csr_matrix:
        if self._base is None:
            self._base = self._matrix(self.e_len)
        return self._base

    def nearest_node(self, lng: float, lat: float) -> tuple[int, float]:
        """Nearest graph node, and how far the snap moved the point.

        Brute force over ~119k nodes is a couple of milliseconds in numpy. The
        grid index in `road-graph.ts` exists for per-request latency, which a
        batch job does not have.
        """
        d2 = (self.nodes[:, 0] - lng) ** 2 + (self.nodes[:, 1] - lat) ** 2
        i = int(np.argmin(d2))
        return i, float(haversine_m(np.array([lng, lat]), self.nodes[i]))

    def distances_from(self, source: int) -> np.ndarray:
        """Road distance from one node to every node (inf where unreachable)."""
        return dijkstra(self.base_matrix, directed=True, indices=source)

    def _edges_from_predecessors(
        self, pred: np.ndarray, source: int, target: int, weights: np.ndarray
    ) -> np.ndarray | None:
        """Node-predecessor chain to edge indices, in travel order.

        scipy reports which *node* preceded each node. Recovering the *edge*
        matters because route length and road class both hang off the edge, and
        with parallel edges the answer is not unique -- the traversed one is the
        cheapest under the weights the search actually ran with.
        """
        if target == source:
            return np.empty(0, dtype=np.int64)
        out: list[int] = []
        at = target
        while at != source:
            prev = int(pred[at])
            if prev < 0:
                return None
            lo, hi = int(self.indptr[prev]), int(self.indptr[prev + 1])
            cand = np.flatnonzero(self.e_dst[lo:hi] == at)
            if cand.size == 0:
                return None
            k = lo + int(cand[np.argmin(weights[lo + cand])])
            out.append(k)
            at = prev
        out.reverse()
        return np.asarray(out, dtype=np.int64)

    def shortest_route(
        self, source: int, target: int, weights: np.ndarray | None = None, limit: float = np.inf
    ) -> Route | None:
        """Cheapest path under `weights`, searching no further than `limit`.

        `limit` is what keeps the batch tractable: a corridor between adjacent
        districts is found without sweeping the whole southern network.
        """
        w = self.e_len if weights is None else weights
        matrix = self.base_matrix if weights is None else self._matrix(w)
        dist, pred = dijkstra(
            matrix, directed=True, indices=source, return_predecessors=True, limit=limit
        )
        if not np.isfinite(dist[target]):
            return None
        edges = self._edges_from_predecessors(pred, source, target, w)
        if edges is None or edges.size == 0:
            return None
        return Route(
            edges=edges,
            length_m=float(self.e_len[edges].sum()),
            mean_speed_kmh=float(self.e_speed[edges].mean()),
        )

    def geometry(self, edges: np.ndarray) -> np.ndarray:
        """[lng, lat] polyline of a route, in travel order."""
        return np.vstack([self.nodes[int(self.e_src[edges[0]])], self.nodes[self.e_dst[edges]]])


def simplify_polyline(points: np.ndarray, tolerance_m: float) -> np.ndarray:
    """Ramer-Douglas-Peucker, with the tolerance given in metres.

    Road geometry from OSM is far denser than a map needs: a 44 km corridor
    arrives as ~620 vertices, and three candidates per district pair would put
    tens of megabytes of coordinates into Mongo for no visible difference.

    A tolerance in the tens of metres is immaterial against the 8 km positional
    uncertainty the endpoints already carry, so this trades nothing the model
    claims to know. The tolerance used is recorded on the run document.

    Iterative rather than recursive: a 5,000-vertex corridor is a plausible
    input and Python's recursion limit is not a property worth depending on.
    """
    n = len(points)
    if n < 3 or tolerance_m <= 0:
        return points

    # Metres per degree at this latitude, so the tolerance can be applied in a
    # locally-planar frame instead of on the sphere.
    lat0 = float(np.radians(points[:, 1].mean()))
    m_per_deg_lat = 111_132.0
    m_per_deg_lng = 111_320.0 * math.cos(lat0)
    xy = np.column_stack([points[:, 0] * m_per_deg_lng, points[:, 1] * m_per_deg_lat])

    keep = np.zeros(n, dtype=bool)
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        lo, hi = stack.pop()
        if hi <= lo + 1:
            continue
        a, b = xy[lo], xy[hi]
        seg = b - a
        seg_len2 = float(seg @ seg)
        rel = xy[lo + 1 : hi] - a
        if seg_len2 == 0:
            dist = np.hypot(rel[:, 0], rel[:, 1])
        else:
            t = np.clip((rel @ seg) / seg_len2, 0.0, 1.0)
            proj = t[:, None] * seg
            dist = np.hypot(rel[:, 0] - proj[:, 0], rel[:, 1] - proj[:, 1])
        far = int(np.argmax(dist))
        if dist[far] > tolerance_m:
            idx = lo + 1 + far
            keep[idx] = True
            stack.append((lo, idx))
            stack.append((idx, hi))
    return points[keep]
