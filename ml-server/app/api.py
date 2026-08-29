"""Read-only HTTP surface over the batch's output.

Every endpoint is an indexed MongoDB lookup against the live run. Nothing here
fits a model, routes a path, or touches the road graph -- that all happened in
the batch, which is the point: a map interaction cannot afford several Dijkstra
sweeps, and a corridor computed per request would also be a corridor nobody
could reproduce.

Two conventions worth knowing before wiring the console to it:

**Corridors are undirected.** They are stored once per pair. `GET /v1/route`
accepts either orientation and returns the geometry running in the direction
asked for, because a line drawn on a map has a direction even when the claim
behind it does not.

**Every response carries `meta`.** It names the run, the model version, and the
interpretation caveats. A caller that renders a corridor without the caveat is
showing an 8 km-resolution regional estimate as if it were a street-level
route, so the caveat travels with the payload rather than living in a document
somebody has to remember.
"""

from __future__ import annotations

from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from pymongo.database import Database

from . import db as dbm
from .batch import CAVEATS, MODEL_VERSION
from .config import Settings, load_settings

SETTINGS = load_settings()
_client_holder: dict[str, Any] = {}

app = FastAPI(
    title="Palantir-TH route prediction",
    version=MODEL_VERSION,
    description=__doc__,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(SETTINGS.cors_origins),
    allow_methods=["GET"],
    allow_headers=["*"],
)


def get_db() -> Database:
    """One pooled client for the process lifetime.

    Opening a MongoClient per request is the classic way to exhaust a
    connection pool under any real traffic.
    """
    if "client" not in _client_holder:
        from pymongo import MongoClient

        _client_holder["client"] = MongoClient(
            SETTINGS.mongodb_uri, serverSelectionTimeoutMS=8000, maxPoolSize=20
        )
    return _client_holder["client"][SETTINGS.mongodb_db]


def require_run(db: Database, run_id: str | None = None) -> dict:
    run = dbm.resolve_run(db, run_id)
    if not run:
        raise HTTPException(
            status_code=503,
            detail=(
                "no model run is live. Build one with `python run_batch.py` in ml-server/."
                if not run_id
                else f"run {run_id} not found"
            ),
        )
    return run


def meta_for(run: dict) -> dict:
    """What every response says about where its numbers came from."""
    backtest = run.get("backtest") or {}
    headline = backtest.get("headline") or {}
    model = run.get("model") or {}
    return {
        "run_id": run["run_id"],
        "model_version": run.get("model_version", MODEL_VERSION),
        "built_at": run.get("finished_at"),
        "tau_days": (model.get("calibration") or {}).get("tau_days"),
        "blend": (model.get("calibration") or {}).get("blend"),
        "skill": {
            "top3_accuracy": headline.get("top3_accuracy"),
            "random_top3_baseline": backtest.get("random_top3_baseline"),
            "log_loss": headline.get("log_loss"),
            "skill_vs_uniform": headline.get("skill_vs_uniform"),
        },
        "caveats": run.get("caveats", CAVEATS),
    }


def cache(response: Response, run: dict, seconds: int = 300) -> None:
    """The payload only changes when a batch promotes, so it is safely cacheable
    and the run id is a natural ETag."""
    response.headers["Cache-Control"] = f"public, max-age={seconds}"
    response.headers["ETag"] = f'"{run["run_id"]}"'


def resolve_anchor(db: Database, run_id: str, ref: str) -> dict:
    """Accept either an anchor id or a `lng,lat` pair.

    The console holds event coordinates, not anchor ids, so making it look up
    ids first would mean two round trips for every corridor drawn.
    """
    doc = db[dbm.ANCHORS].find_one({"run_id": run_id, "anchor_id": ref})
    if doc:
        return doc
    if "," in ref:
        try:
            lng, lat = (float(x) for x in ref.split(",", 1))
        except ValueError:
            raise HTTPException(status_code=400, detail=f"cannot parse {ref!r} as lng,lat")
        # A couple of hundred anchors is small enough to scan, and scanning
        # avoids adding a 2dsphere index whose only caller is this fallback.
        best, best_d2 = None, float("inf")
        for a in db[dbm.ANCHORS].find(
            {"run_id": run_id}, {"anchor_id": 1, "name": 1, "location": 1}
        ):
            x, y = a["location"]["coordinates"]
            d2 = (x - lng) ** 2 + (y - lat) ** 2
            if d2 < best_d2:
                best, best_d2 = a, d2
        if best is None:
            raise HTTPException(status_code=503, detail="run has no anchors")
        return best
    raise HTTPException(status_code=404, detail=f"no anchor {ref!r}")


@app.get("/health")
def health(db: Database = Depends(get_db)) -> dict:
    """Liveness plus whether there is anything to serve."""
    try:
        run = dbm.live_run(db)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database unreachable: {exc}") from exc
    return {
        "ok": True,
        "model_version": MODEL_VERSION,
        "live_run": run["run_id"] if run else None,
        "built_at": run.get("finished_at") if run else None,
    }


@app.get("/v1/run")
def get_run(
    response: Response, run_id: str | None = None, db: Database = Depends(get_db)
) -> dict:
    """Full provenance: fitted parameters, calibration grids, backtest, data contract.

    This is what a console should read before displaying any number from the
    model -- it carries the top-3 accuracy and the random baseline it has to be
    shown against.
    """
    run = require_run(db, run_id)
    cache(response, run)
    run.pop("_id", None)
    return run


@app.get("/v1/runs")
def list_runs(limit: int = Query(10, ge=1, le=50), db: Database = Depends(get_db)) -> dict:
    runs = list(
        db[dbm.RUNS].find(
            {},
            {"_id": 0, "run_id": 1, "status": 1, "finished_at": 1, "duration_s": 1, "outputs": 1},
        ).sort("finished_at", -1).limit(limit)
    )
    return {"runs": runs}


@app.get("/v1/anchors")
def get_anchors(
    response: Response, run_id: str | None = None, db: Database = Depends(get_db)
) -> dict:
    """Every district anchor as GeoJSON points.

    `match_confidence` is on each feature and is zero for district centroids.
    Drive corridor opacity from it rather than hiding it: a faint line is an
    honest line here.
    """
    run = require_run(db, run_id)
    cache(response, run)
    features = [
        {
            "type": "Feature",
            "geometry": a["location"],
            "properties": {
                "anchor_id": a["anchor_id"],
                "name": a["name"],
                "district": a.get("district"),
                "subdistrict": a.get("subdistrict"),
                "province_code": a.get("province_code"),
                "n_events": a["n_events"],
                "geo_precision": a.get("geo_precision"),
                "precision_m": a.get("precision_m"),
                "match_confidence": a["match_confidence"],
                "recency_weight": a.get("recency_weight"),
            },
        }
        for a in db[dbm.ANCHORS].find({"run_id": run["run_id"]}).sort("n_events", -1)
    ]
    return {"type": "FeatureCollection", "features": features, "meta": meta_for(run)}


def _route_features(doc: dict, reverse: bool) -> list[dict]:
    features = []
    for r in doc["routes"]:
        coords = r["geometry"]["coordinates"]
        features.append(
            {
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": list(reversed(coords)) if reverse else coords,
                },
                "properties": {
                    "rank": r["rank"],
                    "posterior": r["posterior"],
                    "prior": r["prior"],
                    "support": r["support"],
                    "length_m": r["length_m"],
                    "mean_speed_kmh": r["mean_speed_kmh"],
                    "from_name": doc["to_name"] if reverse else doc["from_name"],
                    "to_name": doc["from_name"] if reverse else doc["to_name"],
                    "match_confidence": doc["match_confidence"],
                    "prior_dominated": doc["prior_dominated"],
                    "cooccurrence_days": doc["cooccurrence_days"],
                },
            }
        )
    return features


@app.get("/v1/route")
def get_route(
    response: Response,
    frm: str = Query(..., alias="from", description="anchor id, or 'lng,lat'"),
    to: str = Query(..., description="anchor id, or 'lng,lat'"),
    run_id: str | None = None,
    db: Database = Depends(get_db),
) -> dict:
    """**The routing call the map makes.** Candidate corridors between two anchors.

    Returns a GeoJSON FeatureCollection, one LineString per candidate, ordered
    by rank. Style width or opacity by `posterior` and opacity by
    `match_confidence`, and when `prior_dominated` is true say so next to the
    percentage -- it means the evidence barely moved the road-graph prior, and a
    bare "51%" would overstate what the data supports.
    """
    run = require_run(db, run_id)
    rid = run["run_id"]
    a = resolve_anchor(db, rid, frm)
    b = resolve_anchor(db, rid, to)
    if a["anchor_id"] == b["anchor_id"]:
        raise HTTPException(status_code=400, detail="from and to resolve to the same anchor")

    doc = db[dbm.CORRIDORS].find_one(
        {"run_id": rid, "from_id": a["anchor_id"], "to_id": b["anchor_id"]}
    )
    reverse = False
    if not doc:
        doc = db[dbm.CORRIDORS].find_one(
            {"run_id": rid, "from_id": b["anchor_id"], "to_id": a["anchor_id"]}
        )
        reverse = doc is not None
    if not doc:
        raise HTTPException(
            status_code=404,
            detail=(
                f"no precomputed corridor for {a['name']} <-> {b['name']}. This run covered "
                f"{run.get('options', {}).get('pairs', 'observed')} pairs; rebuild with "
                f"`--pairs all` to cover every routable pair."
            ),
        )

    cache(response, run)
    return {
        "type": "FeatureCollection",
        "features": _route_features(doc, reverse),
        "meta": {
            **meta_for(run),
            "from": {"anchor_id": a["anchor_id"], "name": a["name"]},
            "to": {"anchor_id": b["anchor_id"], "name": b["name"]},
            "road_distance_m": doc["road_distance_m"],
            "straight_distance_m": doc["straight_distance_m"],
            "detour_ratio": doc["detour_ratio"],
            "evidence_shift": doc["evidence_shift"],
            "prior_dominated": doc["prior_dominated"],
        },
    }


@app.get("/v1/corridors")
def top_corridors(
    response: Response,
    limit: int = Query(60, ge=1, le=500),
    min_cooccurrence: int = Query(1, ge=0),
    best_only: bool = Query(True, description="only the highest-posterior route per pair"),
    run_id: str | None = None,
    db: Database = Depends(get_db),
) -> dict:
    """The strongest corridors overall -- a default map layer with no pair chosen.

    `best_only` keeps one line per pair, which is what a background layer wants;
    turn it off to see the full candidate set for every pair.
    """
    run = require_run(db, run_id)
    cursor = (
        db[dbm.CORRIDORS]
        .find({"run_id": run["run_id"], "cooccurrence_days": {"$gte": min_cooccurrence}})
        .sort("cooccurrence_days", -1)
        .limit(limit)
    )
    features = []
    for doc in cursor:
        route_features = _route_features(doc, reverse=False)
        if best_only:
            route_features = route_features[:1]
        for f in route_features:
            f["properties"]["from_id"] = doc["from_id"]
            f["properties"]["to_id"] = doc["to_id"]
        features.extend(route_features)
    cache(response, run)
    return {"type": "FeatureCollection", "features": features, "meta": meta_for(run)}


@app.get("/v1/segments")
def get_segments(
    response: Response,
    limit: int = Query(1500, ge=1, le=5000),
    run_id: str | None = None,
    db: Database = Depends(get_db),
) -> dict:
    """The network flow map: which road segments keep being implicated.

    This is not an event map. A segment scores highly because many district
    pairs' posterior-weighted corridors run over it, so it answers "which roads
    keep coming up", not "where did things happen".
    """
    run = require_run(db, run_id)
    features = [
        {
            "type": "Feature",
            "geometry": s["geometry"],
            "properties": {
                "flow": s["flow"],
                "flow_normalised": s["flow_normalised"],
                "speed_kmh": s["speed_kmh"],
                "length_m": s["length_m"],
            },
        }
        for s in db[dbm.SEGMENTS].find({"run_id": run["run_id"]}).sort("flow", -1).limit(limit)
    ]
    cache(response, run)
    return {"type": "FeatureCollection", "features": features, "meta": meta_for(run)}


@app.get("/v1/forecast/{anchor_ref}")
def get_forecast(
    anchor_ref: str,
    response: Response,
    run_id: str | None = None,
    db: Database = Depends(get_db),
) -> dict:
    """Dirichlet-Multinomial posterior over which district is active alongside this one.

    Each entry carries a 90% credible interval. Render the interval, not just
    the mean: 0.08 on three observations and 0.08 on three hundred are
    different claims, and only the interval distinguishes them.
    """
    run = require_run(db, run_id)
    rid = run["run_id"]
    anchor = resolve_anchor(db, rid, anchor_ref)
    doc = db[dbm.FORECASTS].find_one(
        {"run_id": rid, "anchor_id": anchor["anchor_id"]}, {"_id": 0}
    )
    if not doc:
        raise HTTPException(status_code=404, detail=f"no forecast for {anchor_ref!r}")
    cache(response, run)
    return {**doc, "meta": meta_for(run)}


@app.get("/v1/outlook")
def get_outlook(
    response: Response, run_id: str | None = None, db: Database = Depends(get_db)
) -> dict:
    """The prediction card: where activity is expected next, as of the corpus end.

    `as_of` is the day after the last event in the corpus, not today. The model
    knows nothing about the gap between the two, and dating this "now" would
    imply otherwise.
    """
    run = require_run(db, run_id)
    doc = db[dbm.FORECASTS].find_one(
        {"run_id": run["run_id"], "anchor_id": "__outlook__"}, {"_id": 0}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="run has no outlook document")
    cache(response, run)
    return {**doc, "meta": meta_for(run)}
