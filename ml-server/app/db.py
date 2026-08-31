"""MongoDB access: collection names, indexes, and the live-run pointer.

**Runs are immutable and versioned.** A batch writes every document tagged
with its own `run_id` and only flips the `status` of that run to `live` once
all of it has landed. Readers resolve `live` first and query by that id.

The consequence is the one that matters operationally: a batch that dies
half-way leaves a `building` run behind and the previously-live run still
serving. A partial model never displaces a complete one, and a rollback is a
status flip rather than a re-run.
"""

from __future__ import annotations

import sys
from contextlib import contextmanager
from typing import Iterator

from pymongo import ASCENDING, DESCENDING, MongoClient
from pymongo.database import Database

from .config import Settings

# Source corpus (read-only -- this service never writes to it).
EVENTS = "event_candidates"

# The facility network, pushed by scripts/push-geodata.ts. Also read-only here.
# Every document is one GeoJSON feature; the facilities live under one layer.
GEO_FEATURES = "geo_features"
FACILITY_LAYER = "south-facilities"

# Everything the batch produces. The `flow_` prefix keeps the model's output
# visibly separate from the ingestion collections in any Mongo shell.
RUNS = "flow_model_runs"
ANCHORS = "flow_anchors"
CORRIDORS = "flow_corridors"
FORECASTS = "flow_forecasts"
SEGMENTS = "flow_segments"

#: Per-case distance-pattern results, one document per case per run.
#:
#: It does not take the `flow_` prefix because it is not part of the
#: route-prediction model and shares none of its run lifecycle -- see
#: `distance_pattern.py` for why it keeps its own.
CASE_PATTERNS = "result_batch_processing"

OUTPUT_COLLECTIONS = (RUNS, ANCHORS, CORRIDORS, FORECASTS, SEGMENTS, CASE_PATTERNS)

STATUS_BUILDING = "building"
STATUS_LIVE = "live"
STATUS_SUPERSEDED = "superseded"
STATUS_FAILED = "failed"


@contextmanager
def mongo(settings: Settings, *, timeout_ms: int = 8000) -> Iterator[Database]:
    """A connected database, or a diagnosable failure -- never a silent one."""
    client = MongoClient(settings.mongodb_uri, serverSelectionTimeoutMS=timeout_ms)
    try:
        client.admin.command("ping")
    except Exception as exc:
        client.close()
        raise ConnectionError(
            f"cannot reach {settings.mongodb_uri.split('@')[-1]} "
            f"(db={settings.mongodb_db}). For a local URI check the container is up: "
            f"`docker compose up -d mongo`. For mongodb+srv check network access and the "
            f"IP allow-list. Original error: {type(exc).__name__}: {exc}"
        ) from exc
    try:
        yield client[settings.mongodb_db]
    finally:
        client.close()


def ensure_indexes(db: Database) -> None:
    """Idempotent. Every index here backs a query the API actually issues."""
    db[RUNS].create_index([("status", ASCENDING), ("finished_at", DESCENDING)])
    db[RUNS].create_index([("run_id", ASCENDING)], unique=True)

    db[ANCHORS].create_index([("run_id", ASCENDING), ("anchor_id", ASCENDING)], unique=True)
    db[ANCHORS].create_index([("run_id", ASCENDING), ("n_events", DESCENDING)])

    # The routing lookup the map makes. Pairs are stored undirected with
    # from_id < to_id, so the API normalises before querying.
    db[CORRIDORS].create_index(
        [("run_id", ASCENDING), ("from_id", ASCENDING), ("to_id", ASCENDING)], unique=True
    )
    # The same lookup with the endpoints swapped. Corridors are undirected and
    # stored once, so a caller asking b->a has to be served off an index too.
    db[CORRIDORS].create_index([("run_id", ASCENDING), ("to_id", ASCENDING), ("from_id", ASCENDING)])
    # The overview read sorts by co-occurrence and breaks ties on road distance.
    # Both keys belong in the index: under `--pairs all` almost every corridor
    # is tied at zero co-occurrence, so a one-key index would leave MongoDB
    # sorting tens of thousands of geometry-carrying documents in memory.
    db[CORRIDORS].create_index(
        [("run_id", ASCENDING), ("cooccurrence_days", DESCENDING), ("road_distance_m", ASCENDING)]
    )

    db[FORECASTS].create_index([("run_id", ASCENDING), ("anchor_id", ASCENDING)], unique=True)
    db[SEGMENTS].create_index([("run_id", ASCENDING), ("flow", DESCENDING)])

    # One result per case per run, which is what makes a re-run idempotent
    # rather than duplicating every case.
    db[CASE_PATTERNS].create_index([("run_id", ASCENDING), ("event_id", ASCENDING)], unique=True)
    # The join this collection exists for: given a case, its newest pattern.
    # `computed_at` descending is part of the key so the lookup is a single
    # index seek rather than a sort over every run's copy of that case.
    db[CASE_PATTERNS].create_index([("event_id", ASCENDING), ("computed_at", DESCENDING)])
    # Listing a run, and ranking within it -- the "which cases are most
    # isolated" read. `coverage` ascending puts the starved cases first.
    db[CASE_PATTERNS].create_index(
        [("run_id", ASCENDING), ("summary.coverage", ASCENDING)]
    )
    db[CASE_PATTERNS].create_index([("run_id", ASCENDING), ("anchor_id", ASCENDING)])


def live_run(db: Database) -> dict | None:
    """The run the API serves. Newest live run wins if several are marked."""
    return db[RUNS].find_one({"status": STATUS_LIVE}, sort=[("finished_at", DESCENDING)])


def resolve_run(db: Database, run_id: str | None) -> dict | None:
    """A named run, or the live one when unnamed."""
    if run_id:
        return db[RUNS].find_one({"run_id": run_id})
    return live_run(db)


def promote(db: Database, run_id: str) -> None:
    """Make `run_id` the served run and retire whatever held that role.

    Retire-then-promote, not the reverse: a brief window with no live run makes
    the API answer "no model yet", which is honest. The reverse order can leave
    two runs live at once and the API silently mixing documents from both.
    """
    db[RUNS].update_many(
        {"status": STATUS_LIVE, "run_id": {"$ne": run_id}},
        {"$set": {"status": STATUS_SUPERSEDED}},
    )
    db[RUNS].update_one({"run_id": run_id}, {"$set": {"status": STATUS_LIVE}})


def prune_runs(db: Database, keep: int) -> list[str]:
    """Drop the documents of superseded runs beyond the newest `keep`.

    Corridor documents carry route geometry and are by far the largest output,
    so old runs are worth reclaiming. The live run and any run still building
    are never touched.
    """
    if keep < 1:
        return []
    old = list(
        db[RUNS].find({"status": {"$in": [STATUS_SUPERSEDED, STATUS_FAILED]}})
        .sort("finished_at", DESCENDING)
        .skip(keep)
    )
    dropped = []
    for run in old:
        rid = run["run_id"]
        for coll in (ANCHORS, CORRIDORS, FORECASTS, SEGMENTS):
            db[coll].delete_many({"run_id": rid})
        db[RUNS].delete_one({"run_id": rid})
        dropped.append(rid)
    return dropped


def use_utf8_stdout() -> None:
    """District names are Thai; a Windows console defaults to cp1252 and raises
    UnicodeEncodeError mid-run. Reconfiguring beats losing a 20-minute batch to
    a print statement."""
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
