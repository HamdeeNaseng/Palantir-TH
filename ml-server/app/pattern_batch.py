"""The distance-pattern batch: compute one pattern per case and store it.

The shape mirrors `batch.py` -- a fresh `run_id`, outputs written before
anything is promoted, older runs pruned -- with one structural difference that
is the whole reason this module exists separately.

**Work is done per distinct position, not per case.** Cases are geocoded to
district centroids, so ten thousand cases sit on a few hundred coordinates. The
expensive half (snapping to the road network and a Dijkstra sweep per anchor)
runs once per coordinate; the result is then written out for every case that
shares it, tagged with the `anchor_id` they have in common. Computing per case
would run the same sweep forty-odd times over and produce identical answers.

There is no `flow_model_runs` document for these runs. That collection's
`live_run()` means "newest live run" with no notion of which model wrote it, so
registering a second model in it would let a distance-pattern run satisfy a
route-prediction query. Runs here are resolved by `distance_pattern.latest_run_id`.
"""

from __future__ import annotations

import math
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from pymongo import UpdateOne
from pymongo.database import Database

from . import db as dbm
from . import distance_pattern as dp
from .config import Settings
from .contract import precision_radius_m
from .graph import RoadGraph


@dataclass
class PatternBatchOptions:
    radius_m: float = dp.DEFAULT_RADIUS_M
    neighbours: str = "facilities"  # facilities | events
    with_road: bool = True
    keep_runs: int = 2
    limit_cases: int = 0  # 0 = every case
    dry_run: bool = False
    progress_every: int = 50


def _severity(value) -> int | None:
    """The 1-5 severity, or None when the record does not carry one.

    43 documents in the corpus store a word — info/low/medium/high/critical —
    where the schema says `1..5`, and `int("high")` ends a 15-second batch with
    a ValueError after the expensive work is already done.

    They are recorded as *unreported* rather than mapped onto numbers. The
    vocabulary has five words and the scale has five levels, so a mapping looks
    obvious, but nothing documents which word means which level: the Thai scale
    runs ต่ำ / ปานกลาง / สูง / สูงมาก / วิกฤต, and deciding whether "high" is
    3 or 4 would change the colour and size of the dot on the map on the
    strength of a guess. `null` is already what the schema uses for "the source
    did not say", and that is the honest answer here.
    """
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, np.integer)):
        return int(value)
    return None


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _log(msg: str) -> None:
    print(f"[{_now():%H:%M:%S}] {msg}", flush=True)


def _neighbour_set(db: Database, cases: pd.DataFrame, opts: PatternBatchOptions) -> pd.DataFrame:
    """What the 32 directions look for.

    `facilities` is the default and the only one that answers a useful question.
    `events` exists so the degenerate case-to-case view can be produced for
    comparison; it is labelled in `params.neighbours` so a reader can tell which
    they are looking at.
    """
    if opts.neighbours == "facilities":
        return dp.load_facilities(db)
    if opts.neighbours == "events":
        # Collapse to distinct positions first: without it every sector's
        # "nearest" is one of the hundreds of cases stacked on the same centroid.
        sites = (
            cases.groupby(["lng", "lat"], as_index=False)
            .agg(n_cases=("event_id", "size"), district=("district", "first"),
                 province_code=("province_code", "first"))
        )
        sites["id"] = [dp.position_id(r.lng, r.lat) for r in sites.itertuples()]
        sites["kind"] = "case_site"
        sites["name"] = sites["district"].fillna("?") + " (" + sites["n_cases"].astype(str) + " เคส)"
        return sites
    raise ValueError(f"unknown neighbour set {opts.neighbours!r} (expected 'facilities' or 'events')")


def run_pattern_batch(settings: Settings, opts: PatternBatchOptions) -> dict:
    run_id = f"{_now():%Y%m%dT%H%M%SZ}-{uuid.uuid4().hex[:6]}"
    started = _now()
    t0 = time.time()

    _log(f"distance-pattern run {run_id}")
    print(settings.describe(), flush=True)

    graph = None
    if opts.with_road:
        graph = RoadGraph(settings.road_graph_path, settings.road_meta_path)
        _log(f"road graph: {graph.n_nodes:,} nodes, {graph.n_edges:,} edges")
    else:
        _log("road distance disabled (--no-road): straight-line only")

    with dbm.mongo(settings) as db:
        dbm.ensure_indexes(db)

        cases = dp.load_cases(db)
        total_cases = len(cases)
        if opts.limit_cases:
            cases = cases.head(opts.limit_cases)
        neighbours = _neighbour_set(db, cases, opts).reset_index(drop=True)
        _log(f"cases: {len(cases):,} with coordinates (of {total_cases:,})")
        # Counted, not silently dropped: a corpus that starts writing words
        # where the schema says 1-5 is a pipeline change worth seeing in the
        # batch log rather than discovering in a blank column months later.
        odd_severity = sum(1 for v in cases["severity"] if _severity(v) is None and v is not None
                           and not (isinstance(v, float) and math.isnan(v)))
        if odd_severity:
            _log(f"  note: {odd_severity:,} case(s) carry a non-numeric severity "
                 f"-> recorded as unreported")
        _log(f"neighbours: {len(neighbours):,} ({opts.neighbours})")

        # The saving that makes this batch cheap. Round to the same 6 decimals
        # position_id uses, so two cases that share an id share a group.
        # The names must not start with an underscore: itertuples() renames
        # such columns to positional _1/_2 and the attribute access below
        # would break at write time, long after the expensive work is done.
        cases = cases.assign(
            pos_lng=cases["lng"].round(6),
            pos_lat=cases["lat"].round(6),
        )
        positions = (
            cases.groupby(["pos_lng", "pos_lat"], as_index=False)
            .agg(n_cases=("event_id", "size"))
            .sort_values(["pos_lng", "pos_lat"])
            .reset_index(drop=True)
        )
        _log(
            f"distinct positions: {len(positions):,} "
            f"({len(cases) / max(len(positions), 1):.1f} cases each) -- "
            f"the road pass runs once per position, not once per case"
        )

        anchor_xy = positions[["pos_lng", "pos_lat"]].to_numpy(float)
        nbr_xy = neighbours[["lng", "lat"]].to_numpy(float)

        t_geo = time.time()
        dist, idx = dp.directional_neighbours(
            anchor_xy, nbr_xy, radius_m=opts.radius_m,
            # Against the facility layer a facility standing exactly on the case
            # is a real answer. Against the case sites it is the anchor itself.
            drop_coincident=(opts.neighbours == "events"),
        )
        _log(f"directional pass: {dist.shape} in {time.time() - t_geo:.2f}s")

        if graph is not None:
            t_road = time.time()
            road, snap_a, snap_b = dp.road_distances(graph, anchor_xy, nbr_xy, idx)
            _log(
                f"road pass: {len(positions):,} sweeps in {time.time() - t_road:.1f}s "
                f"(anchor snap: median {np.nanmedian(snap_a):,.0f} m, "
                f"max {np.nanmax(snap_a):,.0f} m)"
            )
        else:
            road = snap_a = snap_b = None

        filled = np.isfinite(dist)
        _log(
            f"coverage: {filled.sum(1).mean():.1f}/{dp.N_SECTORS} sectors per position "
            f"(min {filled.sum(1).min()}, max {filled.sum(1).max()})"
        )

        params = dp.PatternParams(
            radius_m=opts.radius_m, neighbours=opts.neighbours, with_road=opts.with_road
        )
        stats = _run_stats(dist, road, filled, positions, graph)

        if opts.dry_run:
            _log("dry run: nothing written")
            return {"run_id": run_id, "dry_run": True, "stats": stats}

        written = _write_cases(
            db, run_id, started, cases, positions, neighbours,
            dist, idx, road, snap_a, snap_b, params, opts,
        )

        duration = time.time() - t0
        dropped = _prune(db, run_id, opts.keep_runs)
        if dropped:
            _log(f"pruned {len(dropped)} older run(s): {', '.join(dropped)}")

        _log(f"done in {duration:.1f}s -- {written:,} case documents in {dbm.CASE_PATTERNS}")
        return {
            "run_id": run_id,
            "cases": written,
            "positions": len(positions),
            "duration_s": duration,
            "stats": stats,
        }


def _run_stats(dist, road, filled, positions, graph) -> dict:
    """What the run found, at the level of the whole corpus.

    Copied onto every document rather than kept in a run collection, so a case
    read in isolation still carries the context needed to read its own numbers.
    """
    vals = dist[filled]
    stats = {
        "positions": int(len(positions)),
        "mean_coverage": float(filled.sum(1).mean()),
        "positions_with_empty_sectors": int((filled.sum(1) < dp.N_SECTORS).sum()),
        "nearest_m_median": float(np.median(vals)) if vals.size else None,
        "road_graph": None,
    }
    if road is not None:
        ok = filled & np.isfinite(road)
        ratio = road[ok] / np.maximum(dist[ok], 1.0)
        stats["reachable_share"] = float(ok.sum() / filled.sum()) if filled.any() else None
        stats["detour_ratio_median"] = float(np.median(ratio)) if ratio.size else None
        stats["detour_ratio_p90"] = float(np.percentile(ratio, 90)) if ratio.size else None
    if graph is not None:
        stats["road_graph"] = {
            "nodes": graph.n_nodes,
            "edges": graph.n_edges,
            "osm_data_timestamp": graph.meta.get("osm_data_timestamp"),
            "highway_classes": graph.meta.get("highway_classes"),
        }
    return stats


def _write_cases(
    db: Database,
    run_id: str,
    computed_at: datetime,
    cases: pd.DataFrame,
    positions: pd.DataFrame,
    neighbours: pd.DataFrame,
    dist: np.ndarray,
    idx: np.ndarray,
    road,
    snap_a,
    snap_b,
    params: dp.PatternParams,
    opts: PatternBatchOptions,
) -> int:
    """Fan each position's pattern out to every case standing on it."""
    pos_row = {
        (float(r.pos_lng), float(r.pos_lat)): i for i, r in enumerate(positions.itertuples())
    }
    param_doc = params.to_dict()

    docs: list[dict] = []
    written = 0
    for case in cases.itertuples():
        p = pos_row[(float(case.pos_lng), float(case.pos_lat))]
        road_row = None if road is None else road[p]
        summary = dp.summarise(dist[p], road_row)
        precision_m = precision_radius_m(case.geo_precision)
        docs.append(
            {
                # Deterministic id: re-running the same run_id overwrites rather
                # than duplicating, and the id says what the document is about.
                "_id": f"{run_id}:{case.event_id}",
                "run_id": run_id,
                "kind": "distance_pattern",
                "model_version": dp.MODEL_VERSION,
                "computed_at": computed_at,
                # The foreign key. `event_candidates._id` -- in this app a case
                # IS an event candidate; see distance_pattern.py.
                "event_id": case.event_id,
                # Cases sharing a centroid share a pattern; this is how a reader
                # can tell, and how these join to flow_anchors.
                "anchor_id": dp.position_id(float(case.pos_lng), float(case.pos_lat)),
                "case": {
                    "district": case.district,
                    "subdistrict": case.subdistrict,
                    "province_code": case.province_code,
                    "event_type": case.event_type,
                    "title": case.title,
                    "severity": _severity(case.severity),
                    "verification": case.verification,
                    "occurred_at": case.occurred_at,
                },
                "anchor": {
                    "location": {
                        "type": "Point",
                        "coordinates": [float(case.pos_lng), float(case.pos_lat)],
                    },
                    "geo_precision": case.geo_precision,
                    # The number that decides how much of this pattern is real:
                    # at 8 km the anchor could be anywhere in the district.
                    "precision_m": int(precision_m),
                    # How far the case sits from the nearest mapped road. One
                    # value per anchor, so it lives here rather than being
                    # repeated on all 32 sectors. Large means the road
                    # distances below are measured from somewhere else.
                    "snap_m": None if snap_a is None else dp.finite_or_none(snap_a[p]),
                    "cases_at_this_position": int(positions.at[p, "n_cases"]),
                },
                "params": param_doc,
                "summary": summary,
                "sectors": dp.sector_docs(
                    dist[p], idx[p], neighbours, road_row,
                    None if snap_b is None else snap_b[p],
                ),
                "empty": [s for s in range(dp.N_SECTORS) if idx[p, s] < 0],
                "caveats": dp.CAVEATS,
            }
        )
        if len(docs) >= 500:
            written += _flush(db, docs)
            docs = []
            if opts.progress_every and (written // 500) % max(opts.progress_every // 50, 1) == 0:
                _log(f"  {written:,}/{len(cases):,} cases written")
    written += _flush(db, docs)
    return written


def _flush(db: Database, docs: list[dict]) -> int:
    """Upsert on `_id`, so a re-run of the same run_id is idempotent."""
    if not docs:
        return 0
    db[dbm.CASE_PATTERNS].bulk_write(
        [UpdateOne({"_id": d["_id"]}, {"$set": d}, upsert=True) for d in docs],
        ordered=False,
    )
    return len(docs)


def _prune(db: Database, keep_run_id: str, keep: int) -> list[str]:
    """Drop all but the newest `keep` runs. The run just written is never dropped.

    One document per case per run means an unpruned collection grows by the full
    corpus every time the batch runs, so the default is deliberately tight.
    """
    if keep < 1:
        return []
    runs = db[dbm.CASE_PATTERNS].distinct("run_id")
    # run_id begins with a UTC timestamp, so lexical order is chronological.
    stale = sorted((r for r in runs if r != keep_run_id), reverse=True)[keep - 1:]
    for rid in stale:
        db[dbm.CASE_PATTERNS].delete_many({"run_id": rid})
    return stale
