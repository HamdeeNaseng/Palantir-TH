"""Which district next -- sections 8, 9 and 11.

Three pieces, in the order the notebook establishes them:

**Co-occurrence (8).** Undirected counts of districts active in the same
window. Undirected because section 2.4 showed within-day ordering is an
ingestion artefact; counting A->B separately from B->A would model the
ingestion pipeline and report it as knowledge about the region.

**A road-distance Dirichlet prior (8).** `alpha_ij` falls off exponentially
with road distance, so districts close along the network are more likely
before any data is seen, and a pair never yet observed does not get
probability zero. This is where the road graph earns its keep statistically.

**Calibration, not guesswork (9).** `tau` and the recency/corridor blend are
fitted by maximising predictive likelihood on a validation window strictly
later than training. The notebook's finding was blunt: the fitted `tau` lands
in the months, and the hours-scale value intuition suggests makes the model
measurably worse.

Everything reports a **backtest against dumber baselines (11)**, because a
Bayesian model always produces a confident-looking posterior and the only
question that matters is whether it beats guessing.

One deviation from the notebook, for speed rather than for modelling. The
notebook recomputes the decayed history from scratch for every scored day,
which is quadratic in the number of days and fine for one interactive pass.
Here the same quantity comes from its exact recursion --

    w(t2) = w(t1) * exp(-(t2 - t1) / tau) + (events on the days between)

-- which is linear, and the difference in the numbers is that this version
does *not* drop days once their weight falls under 1e-6. It is the same
estimator, computed exactly rather than truncated.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Iterator

import numpy as np
import pandas as pd
from scipy import stats

from .config import ModelParams

DayPairs = list[tuple[pd.Timestamp, list]]


def cooccurrence_counts(
    day_pairs: DayPairs, pos_ix: dict, k: int, *, half_life_days: float | None = None, t_ref=None
) -> np.ndarray:
    """Undirected same-window co-occurrence counts, optionally time-decayed."""
    c = np.zeros((k, k))
    for day, positions in day_pairs:
        w = 1.0
        if half_life_days is not None and t_ref is not None:
            w = math.exp(-(t_ref - day).days / half_life_days)
        idx = [pos_ix[p] for p in positions]
        for a in range(len(idx)):
            for b in range(a + 1, len(idx)):
                c[idx[a], idx[b]] += w
                c[idx[b], idx[a]] += w
    return c


def road_prior(road_d: np.ndarray, params: ModelParams) -> np.ndarray:
    """Dirichlet concentration from road distance: alpha_ij = alpha0 * q_ij."""
    q = np.exp(-np.where(np.isfinite(road_d), road_d, 1e9) / params.d0_m)
    np.fill_diagonal(q, 0.0)
    row = q.sum(axis=1, keepdims=True)
    q = np.divide(q, row, out=np.zeros_like(q), where=row > 0)
    return params.alpha0 * q


def transition_matrix(counts: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    """Row-normalised `alpha + counts`. Hoisted out of the per-day loop, which is
    the only reason calibration over a grid finishes in seconds."""
    trans = alpha + counts
    row = trans.sum(axis=1, keepdims=True)
    k = len(trans)
    return np.divide(trans, row, out=np.full_like(trans, 1.0 / k), where=row > 0)


def recency_weights(history: DayPairs, t_ref, tau_days: float, pos_ix: dict, k: int) -> np.ndarray:
    """Decayed event weight per district, from every day strictly before `t_ref`.

    Direct summation. Used for one-off queries -- the API's as-of weighting and
    the batch's final state. Loops that sweep many days use `walk_forward`.
    """
    w = np.zeros(k)
    for day, positions in history:
        if day >= t_ref:
            break
        f = math.exp(-(t_ref - day).days / tau_days)
        if f < 1e-6:
            continue
        for p in positions:
            w[pos_ix[p]] += f
    return w


def walk_forward(
    days: DayPairs, start_index: int, tau_days: float, pos_ix: dict, k: int
) -> Iterator[tuple[pd.Timestamp, list, np.ndarray]]:
    """Yield each day from `start_index` with the decayed weight of every earlier day.

    The weight vector is carried forward and rescaled rather than rebuilt, which
    is what makes a grid search over tau tractable. Days before `start_index`
    warm the state up without being scored.

    A copy is yielded rather than the running vector. Handing out the live array
    would alias: a caller that keeps what it was given would find every past day
    silently rewritten to the latest state.
    """
    w = np.zeros(k)
    prev: pd.Timestamp | None = None
    for n, (day, positions) in enumerate(days):
        if prev is not None:
            gap = (day - prev).days
            if gap:
                w *= math.exp(-gap / tau_days)
        if n >= start_index:
            yield day, positions, w.copy()
        for p in positions:
            w[pos_ix[p]] += 1.0
        prev = day


def predict_day(w_recency: np.ndarray, trans: np.ndarray, blend: float) -> np.ndarray:
    """P(district active), recency blended with corridor co-occurrence.

    `base` is where activity has recently been; `spread` pushes that through the
    row-normalised co-occurrence matrix to ask where it tends to appear
    alongside.
    """
    base = w_recency + 1e-9
    base = base / base.sum()
    p = (1 - blend) * base + blend * (base @ trans)
    total = p.sum()
    return p / total if total > 0 else np.full(len(p), 1 / len(p))


def _score(days, start_index, trans, tau, blend, pos_ix, k) -> tuple[float, float]:
    """Mean log-loss and top-3 hit rate over the districts actually active each day."""
    ll, hits, n = 0.0, 0, 0
    for _day, positions, w in walk_forward(days, start_index, tau, pos_ix, k):
        if w.sum() == 0:
            continue
        p = predict_day(w, trans, blend)
        top3 = set(np.argpartition(-p, 3)[:3])
        for pos in positions:
            j = pos_ix[pos]
            ll += math.log(max(p[j], 1e-12))
            hits += j in top3
            n += 1
    if n == 0:
        return float("inf"), 0.0
    return -ll / n, hits / n


@dataclass
class Calibration:
    tau_days: int
    blend: float
    tau_grid: list[dict]
    blend_grid: list[dict]
    split: dict


def calibrate(corpus, params: ModelParams) -> Calibration:
    """Fit tau, then the blend, both on a validation window later than training.

    Chronological split, never random: a random split lets the future leak into
    the training set and every score after that is optimistic.
    """
    split_train = pd.Timestamp(params.split_train)
    split_valid = pd.Timestamp(params.split_valid)
    days = corpus.day_pairs
    n_train = sum(1 for d, _ in days if d < split_train)
    n_valid = sum(1 for d, _ in days if split_train <= d < split_valid)
    n_test = len(days) - n_train - n_valid

    if not n_train or not n_valid:
        raise ValueError(
            f"the chronological split leaves train={n_train} valid={n_valid} days. Adjust "
            f"split_train/split_valid to match the corpus date range "
            f"({corpus.events['t'].min().date()} to {corpus.events['t'].max().date()})."
        )

    # Validation is scored against a model fitted on training days only; the
    # walk supplies recency from those same days without scoring them.
    valid_window = days[: n_train + n_valid]
    alpha = road_prior(corpus.road_d, params)
    trans = transition_matrix(cooccurrence_counts(days[:n_train], corpus.pos_ix, corpus.k), alpha)

    tau_rows = []
    for tau in params.tau_grid:
        nll, top3 = _score(valid_window, n_train, trans, tau, 0.5, corpus.pos_ix, corpus.k)
        tau_rows.append({"tau_days": int(tau), "val_logloss": nll, "val_top3": top3})
    best_tau = int(min(tau_rows, key=lambda r: r["val_logloss"])["tau_days"])

    blend_rows = []
    for blend in params.blend_grid:
        nll, top3 = _score(valid_window, n_train, trans, best_tau, blend, corpus.pos_ix, corpus.k)
        blend_rows.append({"blend": float(blend), "val_logloss": nll, "val_top3": top3})
    best_blend = float(min(blend_rows, key=lambda r: r["val_logloss"])["blend"])

    return Calibration(
        tau_days=best_tau,
        blend=best_blend,
        tau_grid=tau_rows,
        blend_grid=blend_rows,
        split={
            "train_days": n_train,
            "valid_days": n_valid,
            "test_days": n_test,
            "split_train": params.split_train,
            "split_valid": params.split_valid,
        },
    )


def backtest(corpus, params: ModelParams, cal: Calibration) -> dict:
    """Walk-forward over the held-out window, against four dumber baselines.

    | model         | uses                                               |
    |---------------|----------------------------------------------------|
    | M0 uniform    | every anchor equally likely                        |
    | M1 base rate  | historical frequency, no recency                   |
    | M2 recency    | time decay only                                    |
    | M3 road prior | road-distance Dirichlet, no observed co-occurrence  |
    | M4 full       | recency + Dirichlet-Multinomial corridor           |

    M3 is expected to lose to uniform. That is the finding, not a bug: road
    distance is not a predictor on its own, it is a *prior* that spreads
    probability sensibly over pairs never yet seen.
    """
    split_valid = pd.Timestamp(params.split_valid)
    days = corpus.day_pairs
    n_hist = sum(1 for d, _ in days if d < split_valid)
    test = days[n_hist:]
    if not test:
        raise ValueError("no held-out days after split_valid -- cannot backtest")

    k, pos_ix = corpus.k, corpus.pos_ix
    alpha = road_prior(corpus.road_d, params)
    counts = cooccurrence_counts(days[:n_hist], pos_ix, k)

    trans_full = transition_matrix(counts, alpha)
    trans_road = transition_matrix(np.zeros((k, k)), alpha)
    identity = np.eye(k)  # blend=0 never consults it, but keeps one code path

    base_rate = np.zeros(k)
    for _, positions in days[:n_hist]:
        for p in positions:
            base_rate[pos_ix[p]] += 1
    base_rate = base_rate / base_rate.sum()

    def run(kind: str) -> dict:
        ll, hits, n = 0.0, 0, 0
        for _day, positions, w in walk_forward(days, n_hist, cal.tau_days, pos_ix, k):
            if kind == "uniform":
                p = np.full(k, 1 / k)
            elif kind == "baserate":
                p = base_rate
            elif w.sum() == 0:
                continue
            elif kind == "recency":
                p = predict_day(w, identity, 0.0)
            elif kind == "roadprior":
                p = predict_day(w, trans_road, 1.0)
            else:
                p = predict_day(w, trans_full, cal.blend)
            top3 = set(np.argpartition(-p, 3)[:3])
            for pos in positions:
                j = pos_ix[pos]
                ll += math.log(max(p[j], 1e-12))
                hits += j in top3
                n += 1
        return {"log_loss": -ll / n, "top3_accuracy": hits / n, "predictions": n}

    models = {
        "M0_uniform": "uniform",
        "M1_base_rate": "baserate",
        "M2_recency": "recency",
        "M3_road_prior": "roadprior",
        "M4_full": "full",
    }
    results = {name: run(kind) for name, kind in models.items()}
    reference = results["M0_uniform"]["log_loss"]
    for r in results.values():
        r["skill_vs_uniform"] = 1 - r["log_loss"] / reference

    return {
        "window": {
            "start": test[0][0].to_pydatetime(),
            "end": test[-1][0].to_pydatetime(),
            "active_days": len(test),
        },
        "models": results,
        "headline": results["M4_full"],
        "random_top3_baseline": 3 / k,
        "note": (
            "M4 wins on calibration, not on ranking -- its top-3 accuracy is close to the "
            "base-rate model's. Show the top-3 number next to the random baseline whenever a "
            "prediction is displayed; it is the ceiling district/day resolution allows, not a "
            "defect of the model."
        ),
    }


def next_district_posterior(counts: np.ndarray, alpha: np.ndarray, i: int):
    """Dirichlet posterior for row `i`, with a 90% credible interval per district.

    The posterior of `Dir(alpha + c)` has Beta marginals, so the interval is
    exact rather than sampled -- and reporting it is the whole point: a
    posterior mean of 0.08 on three observations is a different claim from the
    same 0.08 on three hundred.

    Entries with zero concentration -- the self-transition, which both the road
    prior and the co-occurrence counts set to zero -- are pinned to a degenerate
    interval at zero. `beta.ppf` returns NaN there, and NaN is not representable
    in JSON: it would survive into Mongo and then break a browser's parser at
    the far end of the API.
    """
    row = alpha[i] + counts[i]
    total = row.sum()
    if total <= 0:
        zeros = np.zeros_like(row)
        return zeros, zeros.copy(), zeros.copy()
    mean = row / total
    positive = row > 0
    lo = np.zeros_like(row)
    hi = np.zeros_like(row)
    lo[positive] = stats.beta.ppf(0.05, row[positive], total - row[positive])
    hi[positive] = stats.beta.ppf(0.95, row[positive], total - row[positive])
    return mean, lo, hi
