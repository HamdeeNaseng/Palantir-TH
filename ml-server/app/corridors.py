"""Candidate corridors and their Bayesian posterior -- sections 6 and 7.

    P(R | E)  proportional to  P(E | R) P(R)

**Prior P(R)** comes only from the road graph: a detour penalty on how much
longer a candidate is than the shortest one, times a road-class weight proxied
by mean posted speed.

**Likelihood P(E | R)** is the honest one available here. There is no travel
trace to condition on, so the evidence is *other events*: how much decayed
event weight sits near the corridor, through a soft exponential kernel at the
district precision radius.

The kernel is soft on purpose. With a hard 8 km cut-off every candidate between
the same two districts captures the same anchors, the likelihood saturates, and
the posterior collapses onto the prior -- for a reason that is an artefact of
the cut-off rather than a fact about the corridors.

**Deliberately absent: implied velocity.** Section 4 showed it is determined by
timestamp resolution, not by travel. Multiplying it into the posterior would
launder a recording convention into a probability.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .config import ModelParams
from .graph import RoadGraph, Route, haversine_m


@dataclass
class CorridorPosterior:
    """One district pair, its candidate corridors, and how far evidence moved them."""

    routes: list[Route]
    prior: np.ndarray
    support: np.ndarray
    posterior: np.ndarray
    #: Total variation between posterior and prior. Near zero means the answer
    #: is the prior wearing a posterior's clothes, and must be labelled as such.
    evidence_shift: float

    def prior_dominated(self, threshold: float) -> bool:
        return self.evidence_shift < threshold


def candidate_routes(
    graph: RoadGraph, source_node: int, target_node: int, params: ModelParams
) -> list[Route]:
    """Up to `k_routes` genuinely distinct corridors, shortest first.

    Iterative edge penalty rather than Yen's algorithm. On a real road graph
    Yen returns near-identical paths -- the other carriageway of a dual
    carriageway, twenty metres apart over forty kilometres -- which is not an
    alternative in the sense an analyst means. Multiplying the cost of the
    edges just used forces the next search onto genuinely different roads.

    Two guards keep the set meaningful: a candidate more than `max_excess`
    times the shortest length is not a plausible alternative, and one sharing
    more than `max_overlap` of its edges with a candidate already held is the
    same corridor again.
    """
    first = graph.shortest_route(source_node, target_node)
    if first is None:
        return []

    limit = first.length_m * params.max_excess * 1.05
    weights = graph.e_len.copy()
    out: list[Route] = []
    edge_sets: list[set[int]] = []

    for _ in range(4 * params.k_routes):
        if len(out) >= params.k_routes:
            break
        route = graph.shortest_route(source_node, target_node, weights=weights, limit=limit)
        if route is None:
            break
        weights[route.edges] *= params.penalty  # push the next search off this corridor
        if out and route.length_m / out[0].length_m > params.max_excess:
            break
        edges = route.edge_set
        if any(
            len(edges & held) / min(len(edges), len(held)) > params.max_overlap
            for held in edge_sets
        ):
            continue
        out.append(route)
        edge_sets.append(edges)

    return out


def route_prior(routes: list[Route], params: ModelParams, max_speed_kmh: float) -> np.ndarray:
    """P(R): detour penalty times road-class weight, normalised over the candidate set."""
    lengths = np.array([r.length_m for r in routes])
    speeds = np.array([r.mean_speed_kmh for r in routes])
    logp = -params.beta_excess * (lengths / lengths.min() - 1) + params.gamma_class * np.log(
        np.maximum(speeds, 1.0) / max_speed_kmh
    )
    p = np.exp(logp - logp.max())
    return p / p.sum()


def route_support(
    graph: RoadGraph, route: Route, weights: np.ndarray, anchor_xy: np.ndarray, radius_m: float
) -> float:
    """How much decayed event weight sits near this corridor.

    The caller zeroes the two endpoints first: they contribute equally to every
    candidate, so leaving them in would only dilute the differences the
    posterior exists to express.
    """
    geom = graph.geometry(route.edges)
    d = haversine_m(geom[:, None, :], anchor_xy[None, :, :]).min(axis=0)
    return float((weights * np.exp(-d / radius_m)).sum())


def corridor_posterior(
    graph: RoadGraph,
    i: int,
    j: int,
    nodes: np.ndarray,
    anchor_xy: np.ndarray,
    weights: np.ndarray,
    params: ModelParams,
) -> CorridorPosterior | None:
    """Full posterior over the corridors linking anchors `i` and `j`."""
    routes = candidate_routes(graph, int(nodes[i]), int(nodes[j]), params)
    if not routes:
        return None

    w = weights.copy()
    w[i] = w[j] = 0.0

    prior = route_prior(routes, params, float(graph.e_speed.max()))
    support = np.array(
        [route_support(graph, r, w, anchor_xy, params.corridor_radius_m) for r in routes]
    )
    if support.max() > 0:
        support = support / support.max()

    loglik = params.lambda_support * support
    posterior = prior * np.exp(loglik - loglik.max())
    posterior /= posterior.sum()

    return CorridorPosterior(
        routes=routes,
        prior=prior,
        support=support,
        posterior=posterior,
        evidence_shift=float(np.abs(posterior - prior).sum() / 2),
    )


def segment_flow(
    graph: RoadGraph, contributions: list[tuple[CorridorPosterior, float]]
) -> np.ndarray:
    """Section 10 -- how often each road segment is implicated across all pairs.

        F(e) = sum over pairs, sum over candidate routes,
               weight(pair) * P(R | E) * [e in R]

    The result is a network flow map rather than an event map: it answers
    "which roads keep being implicated", not "where did things happen".
    """
    flow = np.zeros(graph.n_edges)
    for corridor, weight in contributions:
        for route, p in zip(corridor.routes, corridor.posterior):
            flow[route.edges] += weight * float(p)
    return flow
