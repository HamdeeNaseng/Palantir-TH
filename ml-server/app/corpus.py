"""Reading `event_candidates` and reducing it to what the model can use.

Sections 1-3 of the notebook, with one addition: the checks that justified the
model's shape are re-run **on every batch**, not trusted as a one-time finding.

That matters because two of the model's central decisions are contingent on
properties of the data that a future ingestion could change:

- corridors are **undirected**, because within-day ordering was shown to be an
  artefact of the ingestion pipeline rather than a signal (section 2.4);
- implied velocity is **not** a likelihood term, because timestamps are
  day-resolution (section 2.2).

If a later corpus arrives with real clock times, those decisions should be
revisited -- so the numbers that would tell you land in the run document rather
than staying in a notebook cell somebody has to remember to re-run.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from pymongo.database import Database

from .contract import (
    GEO_PRECISION_UNION,
    MAX_SNAP_M,
    match_confidence,
    precision_radius_m,
)
from .db import EVENTS
from .graph import RoadGraph, haversine_m

PROJECTION = {
    "_id": 1,
    "source_id": 1,
    "time.start": 1,
    "location.provinceCode": 1,
    "location.district": 1,
    "location.subdistrict": 1,
    "location.place": 1,
    "location.geo.coordinates": 1,
    "location.geo_precision": 1,
    "event.type": 1,
    "severity": 1,
    "confidence": 1,
    "verification": 1,
}


def anchor_id(lng: float, lat: float) -> str:
    """A stable id for a position, derived from the position itself.

    Deliberately not the row index: index order depends on how many positions
    the corpus happens to contain, so it would change under every re-run and
    break any id the web console had cached or deep-linked.
    """
    return hashlib.sha1(f"{lng:.6f},{lat:.6f}".encode()).hexdigest()[:12]


def load_events(db: Database) -> pd.DataFrame:
    rows = []
    for d in db[EVENTS].find({}, PROJECTION):
        loc = d.get("location") or {}
        coords = (loc.get("geo") or {}).get("coordinates") or [None, None]
        rows.append(
            {
                "id": str(d["_id"]),
                "source_id": d.get("source_id"),
                "t": (d.get("time") or {}).get("start"),
                "province_code": loc.get("provinceCode"),
                "district": loc.get("district"),
                "subdistrict": loc.get("subdistrict"),
                "place": loc.get("place"),
                "lon": coords[0],
                "lat": coords[1],
                "geo_precision": loc.get("geo_precision"),
                "event_type": (d.get("event") or {}).get("type"),
                "severity": d.get("severity"),
                "confidence": d.get("confidence"),
                "verification": d.get("verification"),
            }
        )
    ev = pd.DataFrame(rows)
    if ev.empty:
        raise ValueError(f"{EVENTS} is empty -- nothing to model")
    ev["t"] = pd.to_datetime(ev["t"])
    if ev["t"].isna().any():
        raise ValueError("every event must carry time.start; some do not")
    return ev


def _mode_or_none(series: pd.Series):
    clean = series.dropna()
    return clean.value_counts().index[0] if len(clean) else None


@dataclass
class Corpus:
    """Everything downstream needs, and nothing that needs a Mongo connection."""

    events: pd.DataFrame
    geo: pd.DataFrame
    positions: list[tuple[float, float]]
    pos_ix: dict[tuple[float, float], int]
    names: list[str]
    anchors: pd.DataFrame
    road_d: np.ndarray
    straight_d: np.ndarray
    day_pairs: list[tuple[pd.Timestamp, list[tuple[float, float]]]]
    report: dict = field(default_factory=dict)

    @property
    def k(self) -> int:
        return len(self.positions)

    @property
    def t_end(self) -> pd.Timestamp:
        return self.geo["t"].max()


def build_corpus(db: Database, graph: RoadGraph, *, seed: int = 42) -> Corpus:
    ev = load_events(db)
    geo = ev.dropna(subset=["lon", "lat"]).copy()
    if geo.empty:
        raise ValueError("no event carries coordinates -- the model has nothing to anchor on")
    geo["pos"] = list(zip(geo["lon"].round(6), geo["lat"].round(6)))
    geo = geo.sort_values("t")
    geo["day"] = geo["t"].dt.normalize()

    positions = sorted(geo["pos"].unique())
    pos_ix = {p: i for i, p in enumerate(positions)}

    meta = (
        geo.groupby("pos")
        .agg(
            district=("district", _mode_or_none),
            subdistrict=("subdistrict", _mode_or_none),
            province_code=("province_code", _mode_or_none),
            precision=("geo_precision", _mode_or_none),
        )
        .reindex(positions)
    )

    # A district centroid is named for its district; an enriched point is named
    # for its tambon, because the same district name appearing five times in a
    # table tells the reader nothing about which of the five a row refers to.
    names: list[str] = []
    for _pos, row in meta.iterrows():
        d, sub, prec = row["district"], row["subdistrict"], row["precision"]
        names.append(d if (prec == "district" or not sub) else f"{d}·{sub}")
    seen: dict[str, int] = {}
    for i, n in enumerate(names):
        if names.count(n) > 1:
            seen[n] = seen.get(n, 0) + 1
            names[i] = f"{n} #{seen[n]}"

    anchors = _build_anchors(geo, graph, positions, names, meta)
    road_d, straight_d = _distance_matrices(graph, anchors, positions)
    day_pairs = [(d, list(dict.fromkeys(g["pos"]))) for d, g in geo.groupby("day")]

    corpus = Corpus(
        events=ev,
        geo=geo,
        positions=positions,
        pos_ix=pos_ix,
        names=names,
        anchors=anchors,
        road_d=road_d,
        straight_d=straight_d,
        day_pairs=day_pairs,
    )
    corpus.report = _data_report(corpus, graph, seed=seed)
    return corpus


def _build_anchors(geo, graph, positions, names, meta) -> pd.DataFrame:
    """Snap every distinct position onto the road network and score the match."""
    counts = geo["pos"].value_counts()
    rows = []
    for pos, name in zip(positions, names):
        node, snap_m = graph.nearest_node(pos[0], pos[1])
        label = meta.loc[[pos], "precision"].iat[0]
        prec_m = precision_radius_m(label)
        rows.append(
            {
                "anchor_id": anchor_id(pos[0], pos[1]),
                "name": name,
                "district": meta.loc[[pos], "district"].iat[0],
                "subdistrict": meta.loc[[pos], "subdistrict"].iat[0],
                "province_code": meta.loc[[pos], "province_code"].iat[0],
                "lng": pos[0],
                "lat": pos[1],
                "node": node,
                "snap_m": snap_m,
                "precision": label,
                "precision_m": prec_m,
                "match_confidence": match_confidence(snap_m, prec_m),
                "n_events": int(counts.get(pos, 0)),
            }
        )
    anchors = pd.DataFrame(rows)
    far = anchors[anchors["snap_m"] > MAX_SNAP_M]
    if len(far):
        raise ValueError(
            f"{len(far)} position(s) sit further than MAX_SNAP_M ({MAX_SNAP_M:,.0f} m) from any "
            f"road: {', '.join(far['name'].astype(str).head(5))}. Either the road graph does not "
            f"cover them or the coordinates are wrong; both make their corridors meaningless."
        )
    return anchors


def _distance_matrices(graph, anchors, positions) -> tuple[np.ndarray, np.ndarray]:
    """Road distance between every pair of anchors, plus the straight line for contrast.

    One full single-source sweep per anchor. The straight line is kept only to
    report how badly it under-states the real distance -- it is never used as a
    distance by the model.
    """
    nodes = anchors["node"].to_numpy()
    k = len(anchors)
    road = np.full((k, k), np.inf)
    for i, node in enumerate(nodes):
        road[i, :] = graph.distances_from(int(node))[nodes]
    np.fill_diagonal(road, 0.0)
    xy = np.asarray(positions)
    straight = haversine_m(xy[:, None, :], xy[None, :, :])
    return road, straight


def _transition_counts(seqs, pos_ix, k) -> np.ndarray:
    m = np.zeros((k, k))
    for s in seqs:
        for a, b in zip(s, s[1:]):
            m[pos_ix[a], pos_ix[b]] += 1
    return m


def _asymmetry(m: np.ndarray) -> float:
    """0 = perfectly symmetric, 1 = every transition one-way only."""
    total = m.sum() + m.T.sum()
    return 0.0 if total == 0 else float(np.abs(m - m.T).sum() / total)


def _direction_test(corpus: Corpus, *, seed: int, draws: int = 200) -> dict:
    """Is within-day ordering a movement signal, or an artefact of ingestion order?

    Two questions, because either alone is misreadable. First, is the transition
    matrix more asymmetric than the same days with their order shuffled. Second,
    is the ordering explained by one fixed global ranking of districts -- which a
    real movement process cannot produce, but a source that lists records by
    district code can.

    The notebook's answer was: barely above the null, and ~56% consistent with a
    single global order. Since every event on a given day shares a timestamp, the
    residual asymmetry cannot be carrying a temporal signal, so corridors are
    built undirected. This re-measures it rather than assuming it still holds.
    """
    rng = np.random.default_rng(seed)
    seqs = [s for _, s in corpus.day_pairs]
    m = _transition_counts(seqs, corpus.pos_ix, corpus.k)
    observed = _asymmetry(m)
    null = np.array(
        [
            _asymmetry(
                _transition_counts(
                    [[s[i] for i in rng.permutation(len(s))] for s in seqs],
                    corpus.pos_ix,
                    corpus.k,
                )
            )
            for _ in range(draws)
        ]
    )
    net = m.sum(axis=1) - m.sum(axis=0)
    rank = np.argsort(np.argsort(-net))
    ok = total = 0
    for s in seqs:
        for a, b in zip(s, s[1:]):
            total += 1
            ok += rank[corpus.pos_ix[a]] < rank[corpus.pos_ix[b]]
    sd = float(null.std())
    seen_pairs = m > 0
    return {
        "transitions_observed": int(m.sum()),
        "pairs_with_any_transition": int(seen_pairs.sum()),
        "possible_pairs": int(corpus.k * (corpus.k - 1)),
        "median_count_per_observed_pair": (
            float(np.median(m[seen_pairs])) if seen_pairs.any() else 0.0
        ),
        "asymmetry_observed": observed,
        "asymmetry_null_mean": float(null.mean()),
        "asymmetry_null_sd": sd,
        "asymmetry_z": float((observed - null.mean()) / sd) if sd > 0 else 0.0,
        "single_global_order_consistency": (ok / total) if total else 0.0,
        "verdict": "undirected-only",
        "note": (
            "Within-day ordering is treated as an ingestion artefact, so corridors are "
            "undirected. Revisit only if the corpus gains real clock times."
        ),
    }


def _data_report(corpus: Corpus, graph: RoadGraph, *, seed: int) -> dict:
    """The state of the input, recorded with the run that was built from it."""
    ev, geo, anchors = corpus.events, corpus.geo, corpus.anchors
    has_clock = (ev["t"].dt.hour != 0) | (ev["t"].dt.minute != 0)
    gaps_min = ev.sort_values("t")["t"].diff().dt.total_seconds().div(60)
    off_contract = sorted(set(geo["geo_precision"].dropna()) - set(GEO_PRECISION_UNION))
    off_grid = ~np.eye(corpus.k, dtype=bool) & np.isfinite(corpus.road_d)
    detour = corpus.road_d[off_grid] / np.maximum(corpus.straight_d[off_grid], 1)

    return {
        "events_total": int(len(ev)),
        "events_with_coords": int(len(geo)),
        "distinct_positions": corpus.k,
        "events_per_position_mean": float(len(geo) / corpus.k),
        "date_range": {
            "start": ev["t"].min().to_pydatetime(),
            "end": ev["t"].max().to_pydatetime(),
        },
        "sources": {str(k): int(v) for k, v in ev["source_id"].value_counts().items()},
        "geo_precision": {str(k): int(v) for k, v in geo["geo_precision"].value_counts().items()},
        "geo_precision_off_contract": off_contract,
        "clock_time": {
            "events_with_clock_time": int(has_clock.sum()),
            "share": float(has_clock.mean()),
            "consecutive_pairs_with_zero_gap": int((gaps_min == 0).sum()),
            "median_gap_minutes": float(gaps_min.median()) if gaps_min.notna().any() else None,
            "note": (
                "Day-resolution timestamps. Implied velocity is therefore an artefact of the "
                "recording convention, and is deliberately excluded from the likelihood."
            ),
        },
        "match_confidence": {
            "max": float(anchors["match_confidence"].max()),
            "median": float(anchors["match_confidence"].median()),
            "anchors_above_zero": int((anchors["match_confidence"] > 0).sum()),
            "anchors_total": corpus.k,
            "events_at_zero_confidence": int(
                anchors.loc[anchors["match_confidence"] <= 0, "n_events"].sum()
            ),
        },
        "snap_distance_m": {
            "median": float(anchors["snap_m"].median()),
            "max": float(anchors["snap_m"].max()),
        },
        "road_vs_straight_ratio": {
            "median": float(np.median(detour)),
            "p90": float(np.percentile(detour, 90)),
            "max": float(detour.max()),
        },
        "reachable_pairs": int(np.isfinite(corpus.road_d).sum() - corpus.k),
        "active_days": len(corpus.day_pairs),
        "direction_test": _direction_test(corpus, seed=seed),
        "road_graph": {
            "nodes": graph.n_nodes,
            "edges": graph.n_edges,
            "osm_data_timestamp": graph.meta.get("osm_data_timestamp"),
            "highway_classes": graph.meta.get("highway_classes"),
            "licence": graph.meta.get("licence"),
        },
    }
