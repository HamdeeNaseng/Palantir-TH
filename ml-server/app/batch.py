"""The batch job: fit the model over the whole corpus and store every pattern.

This is the deployment shape the notebook implies. Corridor inference costs a
few Dijkstra sweeps per district pair, which is far too much to do inside a map
interaction -- so it is done once, ahead of time, for every pair the corpus
actually exhibits, and the map's "routing" call becomes a single indexed
MongoDB lookup.

**Runs are immutable and promoted, never edited.** Everything is written under
a fresh `run_id` with the run marked `building`; only after all of it lands
does the run become `live` and the previous one `superseded`. A batch that dies
half-way leaves the previous model serving untouched, and a rollback is a
status flip rather than a re-run.

Order matters within a run: outputs are written before the run is promoted, so
no reader can ever observe a live run whose documents are still arriving.
"""

from __future__ import annotations

import time
import uuid
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from pymongo import UpdateOne
from pymongo.database import Database

from . import db as dbm
from .config import ModelParams, Settings
from .corpus import Corpus, build_corpus
from .corridors import CorridorPosterior, corridor_posterior, segment_flow
from .forecast import (
    Calibration,
    backtest,
    calibrate,
    cooccurrence_counts,
    next_district_posterior,
    predict_day,
    recency_weights,
    road_prior,
    transition_matrix,
)
from .graph import RoadGraph, simplify_polyline

MODEL_VERSION = "bayesian-route-prediction/1.0"

#: Immaterial against the 8 km positional uncertainty of the endpoints, and it
#: cuts stored corridor geometry by roughly five times.
GEOMETRY_TOLERANCE_M = 10.0

CAVEATS = [
    "These are candidate event-flow corridors, not the travel route of any person. "
    "Nothing in the corpus links two events to the same actor.",
    "Resolution is district-level, not street-level. Coordinates are district centroids "
    "with a nominal error of 8 km, so a corridor is the shortest path between two "
    "centroids -- a regional approximation.",
    "Corridors are undirected. Within-day ordering was measured to be an ingestion "
    "artefact, so any N/NE/E figure derived from it would be inventing data.",
    "Implied velocity is excluded. Day-resolution timestamps make it an artefact of the "
    "recording convention rather than a measurement of travel.",
    "A corridor whose evidence_shift is below the prior_dominated threshold is the prior "
    "restated. Label it as such rather than showing the percentage bare.",
]


@dataclass
class BatchOptions:
    pairs: str = "observed"  # observed | all
    min_cooccurrence: int = 1
    max_pairs: int = 0  # 0 = no cap
    top_segments: int = 5000
    forecast_top_k: int = 12
    keep_runs: int = 3
    promote: bool = True
    dry_run: bool = False
    progress_every: int = 100


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _log(msg: str) -> None:
    print(f"[{_now():%H:%M:%S}] {msg}", flush=True)


def _pair_counts(corpus: Corpus) -> dict[tuple[int, int], int]:
    """How many days each undirected district pair was active together."""
    counts: dict[tuple[int, int], int] = defaultdict(int)
    for _day, positions in corpus.day_pairs:
        idx = sorted({corpus.pos_ix[p] for p in positions})
        for a in range(len(idx)):
            for b in range(a + 1, len(idx)):
                counts[(idx[a], idx[b])] += 1
    return dict(counts)


def _select_pairs(corpus: Corpus, counts: dict, opts: BatchOptions) -> list[tuple[int, int, int]]:
    """Which pairs to compute corridors for, strongest co-occurrence first.

    `observed` is the default because an unobserved pair has no co-occurrence
    evidence to condition on -- its corridor would be the prior, computed
    expensively. `all` exists for the case where the map must be able to route
    between any two anchors without a fallback.
    """
    if opts.pairs == "all":
        selected = [
            (i, j, counts.get((i, j), 0))
            for i in range(corpus.k)
            for j in range(i + 1, corpus.k)
            if np.isfinite(corpus.road_d[i, j])
        ]
    elif opts.pairs == "observed":
        selected = [
            (i, j, c)
            for (i, j), c in counts.items()
            if c >= opts.min_cooccurrence and np.isfinite(corpus.road_d[i, j])
        ]
    else:
        raise ValueError(f"unknown pair selection {opts.pairs!r} (expected 'observed' or 'all')")

    selected.sort(key=lambda t: -t[2])
    if opts.max_pairs:
        selected = selected[: opts.max_pairs]
    return selected


def _linestring(graph: RoadGraph, edges: np.ndarray) -> dict:
    coords = simplify_polyline(graph.geometry(edges), GEOMETRY_TOLERANCE_M)
    return {"type": "LineString", "coordinates": [[round(x, 6), round(y, 6)] for x, y in coords]}


def _corridor_doc(
    run_id: str,
    corpus: Corpus,
    graph: RoadGraph,
    i: int,
    j: int,
    days: int,
    result: CorridorPosterior,
    params: ModelParams,
) -> dict:
    a, b = corpus.anchors.iloc[i], corpus.anchors.iloc[j]
    routes = []
    for rank, (route, prior, support, post) in enumerate(
        zip(result.routes, result.prior, result.support, result.posterior), start=1
    ):
        routes.append(
            {
                "rank": rank,
                "length_m": route.length_m,
                "mean_speed_kmh": route.mean_speed_kmh,
                "edge_count": int(len(route.edges)),
                "prior": float(prior),
                "support": float(support),
                "posterior": float(post),
                "geometry": _linestring(graph, route.edges),
            }
        )
    straight = float(corpus.straight_d[i, j])
    road = float(corpus.road_d[i, j])
    return {
        "run_id": run_id,
        "from_id": a["anchor_id"],
        "to_id": b["anchor_id"],
        "from_name": a["name"],
        "to_name": b["name"],
        "cooccurrence_days": int(days),
        "road_distance_m": road,
        "straight_distance_m": straight,
        "detour_ratio": road / straight if straight > 0 else None,
        # The weaker endpoint governs, exactly as computeLeg does in pipeline.ts.
        "match_confidence": float(min(a["match_confidence"], b["match_confidence"])),
        "evidence_shift": result.evidence_shift,
        "prior_dominated": result.prior_dominated(params.evidence_prior_dominated_max),
        "routes": routes,
    }


def _write(db: Database, collection: str, docs: list[dict], key: tuple[str, ...]) -> int:
    """Upsert in bulk on the collection's unique key. Idempotent per run_id."""
    if not docs:
        return 0
    ops = [UpdateOne({k: d[k] for k in key}, {"$set": d}, upsert=True) for d in docs]
    for start in range(0, len(ops), 500):
        db[collection].bulk_write(ops[start : start + 500], ordered=False)
    return len(docs)


def run_batch(settings: Settings, opts: BatchOptions) -> dict:
    params = settings.params
    run_id = f"{_now():%Y%m%dT%H%M%SZ}-{uuid.uuid4().hex[:6]}"
    started = _now()
    t0 = time.time()

    _log(f"run {run_id}")
    print(settings.describe(), flush=True)

    graph = RoadGraph(settings.road_graph_path, settings.road_meta_path)
    _log(f"road graph: {graph.n_nodes:,} nodes, {graph.n_edges:,} edges")

    with dbm.mongo(settings) as db:
        dbm.ensure_indexes(db)

        _log("building corpus (reading events, snapping anchors, road distance matrix)")
        corpus = build_corpus(db, graph, seed=params.seed)
        report = corpus.report
        _log(
            f"corpus: {report['events_total']:,} events, "
            f"{report['events_with_coords']:,} with coordinates, {corpus.k} anchors, "
            f"{report['active_days']:,} active days"
        )
        _log(
            f"direction test: z={report['direction_test']['asymmetry_z']:+.2f}, "
            f"global-order consistency "
            f"{report['direction_test']['single_global_order_consistency']:.1%} "
            f"-> {report['direction_test']['verdict']}"
        )

        _log("calibrating tau and blend on the validation window")
        cal = calibrate(corpus, params)
        _log(f"tau* = {cal.tau_days} days, blend* = {cal.blend}  ({cal.split})")

        _log("backtesting against baselines on the held-out window")
        bt = backtest(corpus, params, cal)
        m4, m1 = bt["models"]["M4_full"], bt["models"]["M1_base_rate"]
        _log(
            f"M4 log-loss {m4['log_loss']:.3f} (skill {m4['skill_vs_uniform']:+.1%}), "
            f"top-3 {m4['top3_accuracy']:.1%} vs base-rate {m1['top3_accuracy']:.1%}, "
            f"random {bt['random_top3_baseline']:.1%}"
        )

        if opts.dry_run:
            _log("dry run: nothing written")
            return {
                "run_id": run_id,
                "dry_run": True,
                "calibration": cal.__dict__,
                "backtest": bt,
                "data": report,
            }

        # Mark the run as building before any output lands, so an interrupted
        # batch is visibly incomplete rather than silently partial.
        db[dbm.RUNS].insert_one(
            {
                "run_id": run_id,
                "status": dbm.STATUS_BUILDING,
                "model_version": MODEL_VERSION,
                "started_at": started,
                "finished_at": None,
            }
        )

        try:
            outputs = _write_outputs(db, run_id, corpus, graph, cal, params, opts)
        except Exception:
            db[dbm.RUNS].update_one(
                {"run_id": run_id},
                {"$set": {"status": dbm.STATUS_FAILED, "finished_at": _now()}},
            )
            raise

        duration = time.time() - t0
        db[dbm.RUNS].update_one(
            {"run_id": run_id},
            {
                "$set": {
                    "finished_at": _now(),
                    "duration_s": duration,
                    "model": {
                        "version": MODEL_VERSION,
                        "params": params.to_dict(),
                        "geometry_tolerance_m": GEOMETRY_TOLERANCE_M,
                        "calibration": {
                            "tau_days": cal.tau_days,
                            "blend": cal.blend,
                            "tau_grid": cal.tau_grid,
                            "blend_grid": cal.blend_grid,
                            "split": cal.split,
                        },
                    },
                    "data": report,
                    "backtest": bt,
                    "outputs": outputs,
                    "options": opts.__dict__,
                    "caveats": CAVEATS,
                }
            },
        )

        if opts.promote:
            dbm.promote(db, run_id)
            _log(f"promoted {run_id} to live")
            dropped = dbm.prune_runs(db, opts.keep_runs)
            if dropped:
                _log(f"pruned {len(dropped)} superseded run(s): {', '.join(dropped)}")
        else:
            _log(f"run {run_id} left unpromoted (status: building)")

        _log(f"done in {duration:.1f}s -- {outputs}")
        return {"run_id": run_id, "outputs": outputs, "backtest": bt, "duration_s": duration}


def _write_outputs(
    db: Database,
    run_id: str,
    corpus: Corpus,
    graph: RoadGraph,
    cal: Calibration,
    params: ModelParams,
    opts: BatchOptions,
) -> dict:
    """Anchors, corridors, forecasts, segments -- in that order."""
    nodes = corpus.anchors["node"].to_numpy()
    anchor_xy = np.asarray(corpus.positions)
    as_of = corpus.t_end + pd.Timedelta(days=1)

    # The weighting the corridor likelihood and the outlook both condition on:
    # every active day up to the end of the corpus, decayed at the fitted tau.
    w_now = recency_weights(corpus.day_pairs, as_of, cal.tau_days, corpus.pos_ix, corpus.k)

    anchor_docs = []
    for idx, row in corpus.anchors.iterrows():
        anchor_docs.append(
            {
                "run_id": run_id,
                "anchor_id": row["anchor_id"],
                "name": row["name"],
                "district": row["district"],
                "subdistrict": row["subdistrict"],
                "province_code": row["province_code"],
                "location": {"type": "Point", "coordinates": [row["lng"], row["lat"]]},
                "snap_m": float(row["snap_m"]),
                "geo_precision": row["precision"],
                "precision_m": int(row["precision_m"]),
                "match_confidence": float(row["match_confidence"]),
                "n_events": int(row["n_events"]),
                "recency_weight": float(w_now[idx]),
            }
        )
    n_anchors = _write(db, dbm.ANCHORS, anchor_docs, ("run_id", "anchor_id"))
    _log(f"anchors: {n_anchors}")

    counts = _pair_counts(corpus)
    selected = _select_pairs(corpus, counts, opts)
    _log(f"corridors: computing {len(selected):,} pairs ({opts.pairs})")

    corridor_docs: list[dict] = []
    contributions: list[tuple[CorridorPosterior, float]] = []
    unroutable = 0
    t_start = time.time()
    for n, (i, j, days) in enumerate(selected, start=1):
        result = corridor_posterior(graph, i, j, nodes, anchor_xy, w_now, params)
        if result is None:
            unroutable += 1
            continue
        corridor_docs.append(
            _corridor_doc(run_id, corpus, graph, i, j, days, result, params)
        )
        contributions.append((result, float(days)))
        if n % opts.progress_every == 0:
            rate = n / (time.time() - t_start)
            _log(f"  {n:,}/{len(selected):,} pairs ({rate:.1f}/s)")
        # Flushed in batches so a long run holds a bounded amount of geometry
        # in memory rather than every corridor at once.
        if len(corridor_docs) >= 500:
            _write(db, dbm.CORRIDORS, corridor_docs, ("run_id", "from_id", "to_id"))
            corridor_docs = []
    _write(db, dbm.CORRIDORS, corridor_docs, ("run_id", "from_id", "to_id"))
    n_corridors = db[dbm.CORRIDORS].count_documents({"run_id": run_id})
    _log(f"corridors: {n_corridors:,} written, {unroutable} unroutable")

    n_forecasts = _write_forecasts(db, run_id, corpus, cal, params, opts, w_now, as_of)
    n_segments = _write_segments(db, run_id, graph, contributions, opts)

    return {
        "anchors": n_anchors,
        "corridors": n_corridors,
        "corridors_unroutable": unroutable,
        "forecasts": n_forecasts,
        "segments": n_segments,
    }


def _write_forecasts(db, run_id, corpus, cal, params, opts, w_now, as_of) -> int:
    """Per-anchor next-district posteriors, plus one global outlook document."""
    alpha = road_prior(corpus.road_d, params)
    counts = cooccurrence_counts(corpus.day_pairs, corpus.pos_ix, corpus.k)
    ids = corpus.anchors["anchor_id"].tolist()

    docs = []
    for i in range(corpus.k):
        mean, lo, hi = next_district_posterior(counts, alpha, i)
        order = np.argsort(-mean)[: opts.forecast_top_k]
        docs.append(
            {
                "run_id": run_id,
                "anchor_id": ids[i],
                "scope": "anchor",
                "name": corpus.names[i],
                "as_of": as_of.to_pydatetime(),
                "recency_weight": float(w_now[i]),
                "observations": int(counts[i].sum()),
                "top": [
                    {
                        "anchor_id": ids[j],
                        "name": corpus.names[j],
                        "posterior_mean": float(mean[j]),
                        "cri90_low": float(lo[j]),
                        "cri90_high": float(hi[j]),
                        "cooccurrence_days": float(counts[i, j]),
                        "road_distance_m": (
                            float(corpus.road_d[i, j])
                            if np.isfinite(corpus.road_d[i, j])
                            else None
                        ),
                    }
                    for j in order
                ],
            }
        )

    # The section 12 prediction card: where activity is expected next, given
    # everything up to the end of the corpus.
    trans = transition_matrix(counts, alpha)
    p = predict_day(w_now, trans, cal.blend)
    order = np.argsort(-p)[: opts.forecast_top_k]
    focus = int(np.argmax(w_now))
    docs.append(
        {
            "run_id": run_id,
            "anchor_id": "__outlook__",
            "scope": "global",
            "name": "current outlook",
            "as_of": as_of.to_pydatetime(),
            "tau_days": cal.tau_days,
            "blend": cal.blend,
            "focus": {"anchor_id": ids[focus], "name": corpus.names[focus],
                      "recency_weight": float(w_now[focus])},
            "top": [
                {
                    "anchor_id": ids[j],
                    "name": corpus.names[j],
                    "probability": float(p[j]),
                    "recency_weight": float(w_now[j]),
                }
                for j in order
            ],
        }
    )

    n = _write(db, dbm.FORECASTS, docs, ("run_id", "anchor_id"))
    _log(f"forecasts: {n} ({corpus.k} anchors + 1 outlook)")
    return n


def _write_segments(db, run_id, graph, contributions, opts) -> int:
    """Section 10 -- which road segments keep being implicated, posterior-weighted."""
    if not contributions:
        _log("segments: none (no corridors)")
        return 0
    flow = segment_flow(graph, contributions)
    used = np.flatnonzero(flow > 0)
    if used.size == 0:
        return 0
    top = used[np.argsort(-flow[used])[: opts.top_segments]]
    peak = float(flow[top].max())

    docs = []
    for k in top:
        src, dst = int(graph.e_src[k]), int(graph.e_dst[k])
        docs.append(
            {
                "run_id": run_id,
                "edge_index": int(k),
                "flow": float(flow[k]),
                "flow_normalised": float(flow[k] / peak),
                "length_m": float(graph.e_len[k]),
                "speed_kmh": float(graph.e_speed[k]),
                "geometry": {
                    "type": "LineString",
                    "coordinates": [
                        [round(float(graph.nodes[src][0]), 6), round(float(graph.nodes[src][1]), 6)],
                        [round(float(graph.nodes[dst][0]), 6), round(float(graph.nodes[dst][1]), 6)],
                    ],
                },
            }
        )
    db[dbm.SEGMENTS].delete_many({"run_id": run_id})
    for start in range(0, len(docs), 1000):
        db[dbm.SEGMENTS].insert_many(docs[start : start + 1000], ordered=False)
    _log(f"segments: {len(docs):,} of {used.size:,} with flow > 0 (peak {peak:.1f})")
    return len(docs)
