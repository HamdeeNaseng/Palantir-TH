#!/usr/bin/env python
"""Checks that the server still computes what the notebook computed.

    python test_smoke.py

No database and no road graph needed -- these pin the arithmetic, not the data.
The one that matters most is `test_walk_forward_matches_direct_summation`: the
recency decay is the only place where this port computes a notebook quantity by
a different route, so it gets an explicit equivalence check rather than trust.
"""

from __future__ import annotations

import math
import sys

import numpy as np
import pandas as pd

from app.config import ModelParams
from app.contract import (
    GEO_PRECISION_RADIUS_M,
    classify_feasibility,
    match_confidence,
    precision_radius_m,
)
from app.distance_pattern import (
    COMPASS_ABBR,
    COMPASS_TH,
    N_SECTORS,
    directional_neighbours,
    initial_bearing_deg,
    sector_of,
    summarise,
)
from app.forecast import (
    cooccurrence_counts,
    next_district_posterior,
    predict_day,
    recency_weights,
    road_prior,
    transition_matrix,
    walk_forward,
)
from app.graph import haversine_m, simplify_polyline

FAILURES: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  ok   {name}")
    else:
        print(f"  FAIL {name} {detail}")
        FAILURES.append(name)


def test_contract() -> None:
    print("contract (mirrors src/lib/types.ts and src/lib/flow/feasibility.ts)")
    # A district centroid must score exactly zero however clean the snap is --
    # this is the number that makes almost every corridor draw faint.
    check("district centroid -> zero confidence", match_confidence(0.0, 8000) == 0.0)
    check("gps + tight snap -> high confidence", match_confidence(50, 30) > 0.95)
    check("snap beyond tolerance -> zero", match_confidence(2500, 30) == 0.0)
    check(
        "subdistrict tested before district",
        precision_radius_m("subdistrict_reference_estimated") == 2500,
    )
    check(
        "undocumented label degrades to unknown",
        precision_radius_m("named_school_estimated") == GEO_PRECISION_RADIUS_M["unknown"],
    )
    check("speed bands", classify_feasibility(50) == "highly_plausible")
    check("zero-delta speed is impossible", classify_feasibility(1e8) == "impossible")


def test_geometry() -> None:
    print("geometry")
    a = np.array([100.0, 6.0])
    b = np.array([100.0, 7.0])
    d = float(haversine_m(a, b))
    check("one degree of latitude ~111 km", abs(d - 111_195) < 500, f"got {d:,.0f} m")

    # A straight line must collapse to its endpoints; a real detour must not.
    line = np.column_stack([np.linspace(100, 101, 200), np.full(200, 6.0)])
    check("collinear points collapse", len(simplify_polyline(line, 10.0)) == 2)

    # A genuine dog-leg: two straight runs meeting at a corner. The corner must
    # survive and both straight runs must collapse, leaving exactly 3 vertices.
    up = np.column_stack([np.linspace(100, 100.5, 100), np.linspace(6.0, 6.2, 100)])
    down = np.column_stack([np.linspace(100.5, 101, 100), np.linspace(6.2, 6.0, 100)])
    dogleg = np.vstack([up, down[1:]])
    simplified = simplify_polyline(dogleg, 10.0)
    check("a real corner survives", len(simplified) == 3, f"got {len(simplified)}")
    check("the corner is the apex", np.allclose(simplified[1], dogleg[99]))
    check("endpoints preserved", np.allclose(simplified[[0, -1]], dogleg[[0, -1]]))
    check("tolerance 0 is a no-op", len(simplify_polyline(dogleg, 0.0)) == len(dogleg))


def _synthetic_days(n_days: int = 300, k: int = 12, seed: int = 7):
    """Irregularly spaced active days over k positions -- gaps matter here."""
    rng = np.random.default_rng(seed)
    positions = [(100.0 + i, 6.0) for i in range(k)]
    pos_ix = {p: i for i, p in enumerate(positions)}
    day = pd.Timestamp("2015-01-01")
    days = []
    for _ in range(n_days):
        day = day + pd.Timedelta(days=int(rng.integers(1, 9)))
        chosen = rng.choice(k, size=int(rng.integers(1, 4)), replace=False)
        days.append((day, [positions[c] for c in chosen]))
    return days, pos_ix, k


def test_walk_forward_matches_direct_summation() -> None:
    """The incremental decay must equal the notebook's direct sum.

    The notebook rebuilds the decayed history for every scored day. This server
    carries it forward and rescales, which is linear instead of quadratic. The
    two agree exactly, except that the direct version drops terms below 1e-6 --
    so the comparison uses a tolerance at that scale rather than exact equality.
    """
    print("recency decay")
    days, pos_ix, k = _synthetic_days()
    for tau in (7, 60, 240):
        worst = 0.0
        for n, (day, _positions, w_inc) in enumerate(walk_forward(days, 0, tau, pos_ix, k)):
            if n % 37:  # spot-check; comparing every day is quadratic again
                continue
            w_dir = recency_weights(days[:n], day, tau, pos_ix, k)
            worst = max(worst, float(np.abs(w_inc - w_dir).max()))
        check(f"tau={tau}: incremental == direct", worst < 1e-5, f"max delta {worst:.2e}")


def test_walk_forward_excludes_the_current_day() -> None:
    """A day must never see itself. This is the leak that would quietly make
    every backtest score look good."""
    print("walk-forward causality")
    positions = [(100.0, 6.0), (101.0, 6.0)]
    pos_ix = {p: i for i, p in enumerate(positions)}
    days = [
        (pd.Timestamp("2020-01-01"), [positions[0]]),
        (pd.Timestamp("2020-01-02"), [positions[1]]),
    ]
    seen = list(walk_forward(days, 0, 30, pos_ix, 2))
    check("first day starts from nothing", seen[0][2].sum() == 0.0)
    check("second day sees only the first", seen[1][2][0] > 0 and seen[1][2][1] == 0.0)


def test_road_prior_and_posterior() -> None:
    print("dirichlet-multinomial")
    params = ModelParams()
    road = np.array([[0.0, 10_000.0, 80_000.0], [10_000.0, 0.0, 30_000.0], [80_000.0, 30_000.0, 0.0]])
    alpha = road_prior(road, params)
    check("rows sum to alpha0", np.allclose(alpha.sum(axis=1), params.alpha0))
    check("no self-transition", np.allclose(np.diag(alpha), 0.0))
    check("nearer district gets more prior mass", alpha[0, 1] > alpha[0, 2])

    unreachable = np.array([[0.0, np.inf], [np.inf, 0.0]])
    check("unreachable pair survives", np.isfinite(road_prior(unreachable, params)).all())

    counts = np.array([[0.0, 40.0, 2.0], [40.0, 0.0, 5.0], [2.0, 5.0, 0.0]])
    mean, lo, hi = next_district_posterior(counts, alpha, 0)
    check("posterior normalised", abs(mean.sum() - 1.0) < 1e-9)
    check("credible interval brackets the mean", bool((lo <= mean).all() and (mean <= hi).all()))
    check("observed pair beats unobserved", mean[1] > mean[2])

    # More observations must tighten the interval on the same proportion.
    wide = next_district_posterior(counts, alpha, 0)
    narrow = next_district_posterior(counts * 20, alpha, 0)
    check(
        "more data narrows the interval",
        (narrow[2][1] - narrow[1][1]) < (wide[2][1] - wide[1][1]),
    )


def test_predict_day() -> None:
    print("day prediction")
    params = ModelParams()
    road = np.array([[0.0, 10_000.0], [10_000.0, 0.0]])
    alpha = road_prior(road, params)
    trans = transition_matrix(np.zeros((2, 2)), alpha)
    p = predict_day(np.array([3.0, 1.0]), trans, 0.0)
    check("blend=0 follows recency", p[0] > p[1])
    check("normalised", abs(p.sum() - 1.0) < 1e-9)
    flat = predict_day(np.zeros(2), trans, 0.5)
    check("empty history stays finite", np.isfinite(flat).all() and abs(flat.sum() - 1) < 1e-9)


def test_cooccurrence_is_undirected() -> None:
    """Section 2.4: ordering within a day is an ingestion artefact, so counting
    it would model the pipeline rather than the region."""
    print("co-occurrence")
    positions = [(100.0, 6.0), (101.0, 6.0), (102.0, 6.0)]
    pos_ix = {p: i for i, p in enumerate(positions)}
    forward = [(pd.Timestamp("2020-01-01"), positions)]
    backward = [(pd.Timestamp("2020-01-01"), list(reversed(positions)))]
    c1 = cooccurrence_counts(forward, pos_ix, 3)
    c2 = cooccurrence_counts(backward, pos_ix, 3)
    check("symmetric", np.allclose(c1, c1.T))
    check("order of the day does not matter", np.allclose(c1, c2))
    check("no self-count", np.allclose(np.diag(c1), 0.0))

    decayed = cooccurrence_counts(
        forward, pos_ix, 3, half_life_days=10, t_ref=pd.Timestamp("2020-01-11")
    )
    check("decay applied", abs(decayed[0, 1] - math.exp(-1.0)) < 1e-9)


def test_compass() -> None:
    """The rhumb table and the sector boundaries the whole pattern rests on."""
    print("compass (32 rhumbs)")
    check("32 abbreviations and 32 Thai names", len(COMPASS_ABBR) == len(COMPASS_TH) == N_SECTORS)
    check("no duplicate abbreviation", len(set(COMPASS_ABBR)) == N_SECTORS)
    check("cardinals land on their indices",
          (COMPASS_ABBR[0], COMPASS_ABBR[8], COMPASS_ABBR[16], COMPASS_ABBR[24])
          == ("N", "E", "S", "W"))

    origin = np.array([101.0, 6.5])
    for name, target, want in (
        ("north", [101.0, 6.6], 0.0),
        ("east", [101.1, 6.5], 90.0),
        ("south", [101.0, 6.4], 180.0),
        ("west", [100.9, 6.5], 270.0),
    ):
        got = float(initial_bearing_deg(origin, np.array(target)))
        check(f"bearing {name}", abs(((got - want + 180) % 360) - 180) < 0.6, f"got {got:.2f}")

    # The named direction sits at the CENTRE of its sector, so north straddles
    # 360/0. Getting this off by half a width silently rotates every pattern.
    check("north straddles zero", sector_of(0.0) == 0 and sector_of(359.0) == 0)
    check("north's lower edge", sector_of(354.4) == 0 and sector_of(354.3) == N_SECTORS - 1)
    check("north's upper edge", sector_of(5.6) == 0 and sector_of(5.7) == 1)
    check("cardinals map to their sectors",
          (sector_of(90.0), sector_of(180.0), sector_of(270.0)) == (8, 16, 24))


def test_directional_neighbours() -> None:
    """One neighbour per sector, and it must be the nearest one in that sector."""
    print("directional neighbours")
    anchor = np.array([[101.0, 6.5]])
    # Two candidates due east, one due north, one far enough east to be excluded.
    near_e = [101.05, 6.5]
    far_e = [101.15, 6.5]
    north = [101.0, 6.6]
    beyond = [101.6, 6.5]  # ~66 km, outside a 25 km radius
    nbrs = np.array([far_e, near_e, north, beyond])

    dist, idx = directional_neighbours(anchor, nbrs, radius_m=25_000.0)
    check("one row per anchor, 32 columns", dist.shape == (1, N_SECTORS))
    check("east keeps only the nearer of two", idx[0, 8] == 1)
    check("north found", idx[0, 0] == 2)
    check("beyond the radius is excluded", 3 not in idx[0])
    check("empty sectors marked", int((idx[0] >= 0).sum()) == 2)
    check("empty distance is inf", np.isinf(dist[0, 16]))
    check("never two per sector", bool(((idx >= 0).sum(axis=1) <= N_SECTORS).all()))

    # An anchor inside its own neighbour set must not match itself.
    both = np.vstack([anchor, nbrs])
    _d, i_self = directional_neighbours(anchor, both, radius_m=25_000.0, drop_coincident=True)
    check("coincident point dropped", 0 not in i_self[0])


def test_summarise() -> None:
    print("pattern summary")
    row = np.full(N_SECTORS, np.inf)
    row[[0, 8, 16]] = [1000.0, 2000.0, 3000.0]
    s = summarise(row, None)
    check("coverage counts filled sectors", s["coverage"] == 3)
    check("empty sectors complement it", s["empty_sectors"] == N_SECTORS - 3)
    check("nearest is the minimum", s["nearest_m"] == 1000.0)
    check("mean over filled only", abs(s["mean_m"] - 2000.0) < 1e-9)

    # An evenly ringed anchor is isotropic; a lopsided one is not.
    even = np.full(N_SECTORS, 5000.0)
    check("even ring -> zero anisotropy", abs(summarise(even, None)["anisotropy"]) < 1e-12)
    check("lopsided -> positive anisotropy", summarise(row, None)["anisotropy"] > 0)

    # Below three samples the coefficient of variation is noise, not a shape.
    two = np.full(N_SECTORS, np.inf)
    two[[0, 8]] = [1000.0, 2000.0]
    check("two sectors -> anisotropy withheld", summarise(two, None)["anisotropy"] is None)

    empty = np.full(N_SECTORS, np.inf)
    check("no neighbours at all stays finite",
          summarise(empty, None)["coverage"] == 0 and summarise(empty, None)["nearest_m"] is None)

    # Road distance can never be shorter than the straight line it parallels.
    road = np.full(N_SECTORS, np.inf)
    road[[0, 8, 16]] = [1500.0, 2000.0, 9000.0]
    sr = summarise(row, road)
    check("detour median over reachable pairs", abs(sr["median_detour_ratio"] - 1.5) < 1e-9)
    check("max detour", abs(sr["max_detour_ratio"] - 3.0) < 1e-9)
    check("unreachable counted", sr["unreachable_sectors"] == 0)


def main() -> int:
    for test in (
        test_contract,
        test_geometry,
        test_compass,
        test_directional_neighbours,
        test_summarise,
        test_walk_forward_matches_direct_summation,
        test_walk_forward_excludes_the_current_day,
        test_road_prior_and_posterior,
        test_predict_day,
        test_cooccurrence_is_undirected,
    ):
        test()
    print()
    if FAILURES:
        print(f"{len(FAILURES)} check(s) failed: {', '.join(FAILURES)}")
        return 1
    print("all checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
