"""Per-case distance pattern: what lies around a case, in which of 32 directions.

The question this answers, for one case at a time:

    Standing at the case, looking out along each of the 32 compass rhumbs,
    what is the nearest facility in that direction, how far is it in a
    straight line, and how far is it along the road?

This is the notebook `notebook/Distance Pattern.ipynb` reduced to the part that
belongs in a batch. The notebook explores; this stores one document per case so
the console can read a pattern back with a single indexed lookup instead of
recomputing a Dijkstra sweep inside a map interaction -- the same reasoning that
put corridors in `flow_corridors` rather than behind a request.

Three decisions worth knowing before reading the output.

**The FK is `event_id`, pointing at `event_candidates._id`.** The `cases`
collection is empty in every environment this has been run against, and
`case_corrections.event_id` already establishes that in this app a "case" *is*
an event candidate. Joining to `cases` instead would produce zero documents.

**Facilities are the neighbour set, not other cases.** Cases are geocoded to
district centroids -- thousands of them share a few hundred coordinates -- so
case-to-case bearings are bearings between centroids and mean nothing. The
facility layer carries real OSM positions, so "what is around this case" has an
answer. `--neighbours events` exists for comparison and is labelled in the
output as the degenerate view it is.

**Work is done once per distinct position, then fanned out to every case that
shares it.** With ~10k cases on ~200 coordinates that is a ~45x saving on the
expensive half, and it is also the honest structure: two cases at the same
centroid have the same surroundings, and the stored `anchor_id` says so.

Runs are versioned by `run_id` and never edited, matching `batch.py`. They are
*not* registered in `flow_model_runs`: that collection's `live_run()` resolves
"the newest live run" with no notion of kind, so putting a second model in it
would let a distance-pattern run answer a route-prediction query. Readers here
resolve the newest run instead, via `latest_run_id()`.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

import numpy as np
import pandas as pd
from pymongo import DESCENDING
from pymongo.database import Database

from .contract import precision_radius_m
from .db import CASE_PATTERNS, EVENTS, FACILITY_LAYER, GEO_FEATURES
from .graph import RoadGraph, haversine_m

MODEL_VERSION = "distance-pattern/1.0"

#: 32 rhumbs is the finest division of the classical compass; each spans 11.25
#: degrees. The named direction sits at the CENTRE of its sector, so north runs
#: from 354.375 through 5.625 rather than starting at zero.
N_SECTORS = 32
SECTOR_DEG = 360.0 / N_SECTORS

COMPASS_ABBR = (
    "N", "NbE", "NNE", "NEbN", "NE", "NEbE", "ENE", "EbN",
    "E", "EbS", "ESE", "SEbE", "SE", "SEbS", "SSE", "SbE",
    "S", "SbW", "SSW", "SWbS", "SW", "SWbW", "WSW", "WbS",
    "W", "WbN", "WNW", "NWbW", "NW", "NWbN", "NNW", "NbW",
)

#: Thai names follow the classical eight winds -- อุดร, อีสาน, บูรพา, อาคเนย์,
#: ทักษิณ, หรดี, ประจิม, พายัพ -- with the half and quarter winds composed from
#: them. Stored on every sector so a consumer never has to carry this table.
COMPASS_TH = (
    "อุดร (เหนือ)", "เหนือค่อนอีสาน", "เหนือ-อีสาน", "อีสานค่อนเหนือ",
    "อีสาน (ตอ.เฉียงเหนือ)", "อีสานค่อนบูรพา", "บูรพา-อีสาน", "บูรพาค่อนเหนือ",
    "บูรพา (ตะวันออก)", "บูรพาค่อนใต้", "บูรพา-อาคเนย์", "อาคเนย์ค่อนบูรพา",
    "อาคเนย์ (ตอ.เฉียงใต้)", "อาคเนย์ค่อนใต้", "ใต้-อาคเนย์", "ใต้ค่อนบูรพา",
    "ทักษิณ (ใต้)", "ใต้ค่อนประจิม", "ใต้-หรดี", "หรดีค่อนใต้",
    "หรดี (ตต.เฉียงใต้)", "หรดีค่อนประจิม", "ประจิม-หรดี", "ประจิมค่อนใต้",
    "ประจิม (ตะวันตก)", "ประจิมค่อนเหนือ", "ประจิม-พายัพ", "พายัพค่อนประจิม",
    "พายัพ (ตต.เฉียงเหนือ)", "พายัพค่อนเหนือ", "เหนือ-พายัพ", "เหนือค่อนประจิม",
)

assert len(COMPASS_ABBR) == len(COMPASS_TH) == N_SECTORS

#: Default search radius. A neighbour beyond it is recorded as "no neighbour in
#: that direction", which is the finding -- an empty sector is a gap in cover,
#: not missing data. 25 km is `GEO_PRECISION_RADIUS_M["province"]`: past that
#: the positional uncertainty of a coarse case exceeds the measurement.
DEFAULT_RADIUS_M = 25_000.0

#: Two points closer than this are the same place. Filters an anchor matching
#: itself, and cases stacked on an identical district centroid.
COINCIDENT_M = 1.0

CAVEATS = [
    "A sector with no neighbour means nothing was found within the search radius, "
    "not that nothing exists there. Widening the radius changes the answer.",
    "Most cases are geocoded to a district centroid with a nominal error of 8 km. "
    "The pattern therefore describes the district, not the incident's actual "
    "surroundings, and cases sharing a centroid share one pattern by construction.",
    "The road graph carries motorway through tertiary only. Village roads and lanes "
    "are absent, so road distance and detour_ratio are over-stated in rural areas. "
    "Use them to rank, not as driving distances.",
    "Road distance is measured between snapped nodes. Where snap_m is large the "
    "point sits far from any mapped road and its road distance is unreliable.",
    "Facility coverage is OpenStreetMap coverage. A sparsely mapped area looks "
    "sparsely served, and the two are not the same thing.",
    "Distances are not travel times: the graph is weighted by length, and ignores "
    "traffic, checkpoints, and time of day.",
]


def initial_bearing_deg(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Forward azimuth at `a` looking at `b`, degrees clockwise from true north.

    Compass convention (0=N, 90=E), not the mathematical one (0=E, anti-clockwise).
    Takes [lng, lat] and broadcasts over leading axes, exactly like `haversine_m`.

    The bearing of a great circle changes along its length; this is the value at
    the start, which is the one that answers "leaving here, in which direction".
    """
    lo1, la1 = np.radians(a[..., 0]), np.radians(a[..., 1])
    lo2, la2 = np.radians(b[..., 0]), np.radians(b[..., 1])
    dlo = lo2 - lo1
    y = np.sin(dlo) * np.cos(la2)
    x = np.cos(la1) * np.sin(la2) - np.sin(la1) * np.cos(la2) * np.cos(dlo)
    return np.degrees(np.arctan2(y, x)) % 360.0


def sector_of(bearing_deg) -> np.ndarray:
    """Rhumb index 0-31 for a bearing.

    The half-width shift rotates the sector boundaries off the named directions
    before flooring, which is what puts each name at the centre of its sector.
    """
    return (((np.asarray(bearing_deg, float) + SECTOR_DEG / 2) % 360.0) // SECTOR_DEG).astype(int)


def position_id(lng: float, lat: float) -> str:
    """Stable id for a coordinate, derived from the coordinate.

    Same construction as `corpus.anchor_id`, and deliberately so: a case here
    and an anchor there at the same centroid get the same id, which is what
    lets the two models' outputs be joined.
    """
    return hashlib.sha1(f"{lng:.6f},{lat:.6f}".encode()).hexdigest()[:12]


def load_facilities(db: Database) -> pd.DataFrame:
    """The facility layer as points. Areas were already reduced to centres upstream."""
    rows = []
    for d in db[GEO_FEATURES].find(
        {"layer": FACILITY_LAYER, "geometry.type": "Point"},
        {"geometry.coordinates": 1, "properties": 1},
    ):
        p = d.get("properties") or {}
        coords = (d.get("geometry") or {}).get("coordinates") or []
        if len(coords) < 2:
            continue
        rows.append(
            {
                "id": str(d["_id"]),
                "lng": float(coords[0]),
                "lat": float(coords[1]),
                "kind": p.get("kind") or "other",
                # Roughly a third of OSM features are unnamed. Keep the null
                # rather than inventing a label: a consumer that sees None knows
                # the source had nothing, which "(unnamed)" would hide.
                "name": p.get("name_th") or p.get("name_en"),
                "district": p.get("district_th"),
                "province_code": p.get("province_code"),
            }
        )
    fac = pd.DataFrame(rows)
    if fac.empty:
        raise ValueError(
            f"no '{FACILITY_LAYER}' features in {GEO_FEATURES} -- push them with "
            f"`npx tsx scripts/push-geodata.ts` before running this batch"
        )
    return fac


def load_cases(db: Database) -> pd.DataFrame:
    """Every case that carries a coordinate.

    A case without one has no surroundings to describe, so it is skipped rather
    than stored with an empty pattern -- the count of skipped cases is reported
    by the batch so the omission is visible.
    """
    rows = []
    for d in db[EVENTS].find(
        {"location.geo.type": "Point"},
        {
            "location": 1,
            "event.type": 1,
            "event.title": 1,
            "severity": 1,
            "verification": 1,
            "time.start": 1,
        },
    ):
        loc = d.get("location") or {}
        coords = (loc.get("geo") or {}).get("coordinates") or []
        if len(coords) < 2:
            continue
        rows.append(
            {
                "event_id": str(d["_id"]),
                "lng": float(coords[0]),
                "lat": float(coords[1]),
                "district": loc.get("district"),
                "subdistrict": loc.get("subdistrict"),
                "province_code": loc.get("provinceCode"),
                "geo_precision": loc.get("geo_precision"),
                "event_type": (d.get("event") or {}).get("type"),
                "title": (d.get("event") or {}).get("title"),
                "severity": d.get("severity"),
                "verification": d.get("verification"),
                "occurred_at": (d.get("time") or {}).get("start"),
            }
        )
    cases = pd.DataFrame(rows)
    if cases.empty:
        raise ValueError(f"no document in {EVENTS} carries location.geo -- nothing to describe")
    return cases


def directional_neighbours(
    anchor_xy: np.ndarray,
    nbr_xy: np.ndarray,
    *,
    radius_m: float = DEFAULT_RADIUS_M,
    drop_coincident: bool = True,
) -> tuple[np.ndarray, np.ndarray]:
    """Nearest neighbour per compass sector, for every anchor.

    Returns `(dist_m, nbr_idx)`, both shaped `(n_anchors, 32)`. `dist_m` holds
    `inf` and `nbr_idx` holds `-1` where a sector is empty.

    The full pairwise matrix is computed rather than a spatial index: the input
    is a few hundred positions against a few hundred facilities, where the
    matrix is both faster than building a tree and far easier to check.
    """
    anchor_xy = np.asarray(anchor_xy, float).reshape(-1, 2)
    nbr_xy = np.asarray(nbr_xy, float).reshape(-1, 2)
    n = len(anchor_xy)

    d = haversine_m(anchor_xy[:, None, :], nbr_xy[None, :, :])
    sec = sector_of(initial_bearing_deg(anchor_xy[:, None, :], nbr_xy[None, :, :]))

    blocked = ~np.isfinite(d) | (d > radius_m)
    if drop_coincident:
        blocked |= d < COINCIDENT_M
    d = np.where(blocked, np.inf, d)

    dist = np.full((n, N_SECTORS), np.inf)
    idx = np.full((n, N_SECTORS), -1, dtype=int)
    rows = np.arange(n)
    for s in range(N_SECTORS):
        masked = np.where(sec == s, d, np.inf)
        j = masked.argmin(axis=1)
        v = masked[rows, j]
        hit = np.isfinite(v)
        dist[hit, s] = v[hit]
        idx[hit, s] = j[hit]
    return dist, idx


def road_distances(
    graph: RoadGraph,
    anchor_xy: np.ndarray,
    nbr_xy: np.ndarray,
    idx: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Road distance for the pairs the straight-line pass already chose.

    One single-source sweep per anchor covers all of its (at most 32) targets at
    once. Doing it per pair would be 32 sweeps for the same answer.

    Returns `(road_m, snap_anchor_m, snap_nbr_m)` shaped `(n,32)`, `(n,)`,
    `(n,32)`. The anchor's snap is one value per anchor, not per sector -- it is
    the same distance whichever direction is being looked at.

    `road_m` is `inf` where the two sit in different components of the graph,
    which happens and is reported rather than silently dropped.
    """
    anchor_xy = np.asarray(anchor_xy, float).reshape(-1, 2)
    nbr_xy = np.asarray(nbr_xy, float).reshape(-1, 2)

    anchor_node = np.zeros(len(anchor_xy), dtype=int)
    snap_anchor = np.full(len(anchor_xy), np.nan)
    for i, (lng, lat) in enumerate(anchor_xy):
        anchor_node[i], snap_anchor[i] = graph.nearest_node(float(lng), float(lat))

    # Snap only the facilities some sector actually selected.
    nbr_node = np.zeros(len(nbr_xy), dtype=int)
    snap_nbr = np.full(len(nbr_xy), np.nan)
    for j in np.unique(idx[idx >= 0]):
        nbr_node[j], snap_nbr[j] = graph.nearest_node(float(nbr_xy[j, 0]), float(nbr_xy[j, 1]))

    road = np.full(idx.shape, np.inf)
    snap_b = np.full(idx.shape, np.nan)
    for i in range(len(anchor_xy)):
        hit = idx[i] >= 0
        if not hit.any():
            continue
        reach = graph.distances_from(int(anchor_node[i]))
        road[i, hit] = reach[nbr_node[idx[i][hit]]]
        snap_b[i, hit] = snap_nbr[idx[i][hit]]
    return road, snap_anchor, snap_b


@dataclass(frozen=True)
class PatternParams:
    """Everything that changes the numbers, recorded on every document."""

    radius_m: float = DEFAULT_RADIUS_M
    n_sectors: int = N_SECTORS
    neighbours: str = "facilities"  # facilities | events
    with_road: bool = True

    def to_dict(self) -> dict:
        return {
            "radius_m": self.radius_m,
            "n_sectors": self.n_sectors,
            "sector_deg": SECTOR_DEG,
            "neighbours": self.neighbours,
            "with_road": self.with_road,
            "model_version": MODEL_VERSION,
        }


def summarise(dist_row: np.ndarray, road_row: np.ndarray | None) -> dict:
    """The scalar shape of one pattern, for ranking and filtering.

    `coverage` counts the directions that have anything at all. `anisotropy` is
    the coefficient of variation of the distances that exist -- high means the
    surroundings are lopsided, low means evenly ringed. It needs at least three
    directions to mean anything, and is null below that rather than a number
    computed from two samples.

    `road_nearest_m` can come out *below* `nearest_m`. That is not a bug: road
    distance is measured between snapped graph nodes, so it may undercut the
    straight line between the true points by up to the two snap distances.
    Where `anchor.snap_m` is large, read both numbers with that in mind.
    """
    filled = np.isfinite(dist_row)
    n = int(filled.sum())
    vals = dist_row[filled]
    out: dict = {
        "coverage": n,
        "empty_sectors": int(N_SECTORS - n),
        "nearest_m": float(vals.min()) if n else None,
        "farthest_m": float(vals.max()) if n else None,
        "mean_m": float(vals.mean()) if n else None,
        "median_m": float(np.median(vals)) if n else None,
        "anisotropy": float(vals.std() / vals.mean()) if n >= 3 and vals.mean() > 0 else None,
    }
    if road_row is not None:
        ok = filled & np.isfinite(road_row)
        if ok.any():
            ratio = road_row[ok] / np.maximum(dist_row[ok], 1.0)
            out["road_nearest_m"] = float(road_row[ok].min())
            out["median_detour_ratio"] = float(np.median(ratio))
            out["max_detour_ratio"] = float(ratio.max())
            out["unreachable_sectors"] = int((filled & ~np.isfinite(road_row)).sum())
        else:
            out["road_nearest_m"] = None
            out["median_detour_ratio"] = None
            out["max_detour_ratio"] = None
            out["unreachable_sectors"] = n
    return out


def sector_docs(
    dist_row: np.ndarray,
    idx_row: np.ndarray,
    neighbours: pd.DataFrame,
    road_row: np.ndarray | None,
    snap_b_row: np.ndarray | None,
) -> list[dict]:
    """The filled sectors, in compass order.

    Empty sectors are omitted rather than stored as 32 mostly-null subdocuments;
    `summary.empty_sectors` counts them and `empty` lists which, so nothing is
    lost and the typical document stays about a third of the size.
    """
    out = []
    for s in range(N_SECTORS):
        j = int(idx_row[s])
        if j < 0:
            continue
        nb = neighbours.iloc[j]
        straight = float(dist_row[s])
        doc = {
            "sector": s,
            "abbr": COMPASS_ABBR[s],
            "name_th": COMPASS_TH[s],
            "bearing_deg": s * SECTOR_DEG,
            "neighbour": {
                "id": nb["id"],
                "kind": nb["kind"],
                "name": nb["name"],
                "district": nb.get("district"),
                "location": {"type": "Point", "coordinates": [float(nb["lng"]), float(nb["lat"])]},
            },
            "straight_m": straight,
        }
        if road_row is not None:
            road = float(road_row[s])
            doc["road_m"] = road if np.isfinite(road) else None
            doc["detour_ratio"] = road / max(straight, 1.0) if np.isfinite(road) else None
            # The anchor's own snap is constant across all 32 sectors and lives
            # on `anchor.snap_m`; only the neighbour's varies per direction.
            doc["snap_neighbour_m"] = None if snap_b_row is None else finite_or_none(snap_b_row[s])
        out.append(doc)
    return out


def finite_or_none(v) -> float | None:
    """NaN is not valid BSON-friendly data here; absent is the honest encoding."""
    v = float(v)
    return v if np.isfinite(v) else None


def latest_run_id(db: Database) -> str | None:
    """The newest distance-pattern run present.

    Deliberately not `db.live_run()`: that resolves the newest *flow* run and
    has no notion of which model wrote a document.
    """
    doc = db[CASE_PATTERNS].find_one({}, {"run_id": 1}, sort=[("computed_at", DESCENDING)])
    return doc["run_id"] if doc else None


def pattern_for_case(db: Database, event_id: str, run_id: str | None = None) -> dict | None:
    """One case's stored pattern -- the FK join this collection exists for."""
    query: dict = {"event_id": event_id}
    if run_id:
        query["run_id"] = run_id
    return db[CASE_PATTERNS].find_one(query, sort=[("computed_at", DESCENDING)])
