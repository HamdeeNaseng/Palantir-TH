"""The data contract, and the honesty checks that go with it.

Everything here is a port of a rule that already exists in the TypeScript app,
kept in one file so a drift between the two is a one-line diff rather than a
hunt:

- `GEO_PRECISION_RADIUS_M` and the `GeoPrecision` union -- `src/lib/types.ts`
- `matchConfidence`, `USELESS_PRECISION_M`, `SNAP_TOLERANCE_M`, `MAX_SNAP_M`
  and the feasibility speed bands -- `src/lib/flow/feasibility.ts`

The point of the port is that the batch and the running app must answer the
same question the same way. If they disagree, the map shows one number and the
model believes another.
"""

from __future__ import annotations

# src/lib/types.ts -- GEO_PRECISION_RADIUS_M
GEO_PRECISION_RADIUS_M: dict[str, int] = {
    "gps": 30,
    "address": 150,
    "village": 800,
    "subdistrict": 2500,
    "district": 8000,
    "province": 25_000,
    "unknown": 25_000,
}

GEO_PRECISION_UNION = tuple(GEO_PRECISION_RADIUS_M)

# src/lib/flow/feasibility.ts
USELESS_PRECISION_M = 8000.0
SNAP_TOLERANCE_M = 2000.0
MAX_SNAP_M = 12_000.0

FEASIBILITY_SPEED_BANDS_KMH = (
    ("highly_plausible", 80.0),
    ("likely", 120.0),
    ("possible", 150.0),
    ("very_unlikely", 200.0),
)


def classify_feasibility(kmh: float) -> str:
    for name, ceiling in FEASIBILITY_SPEED_BANDS_KMH:
        if kmh <= ceiling:
            return name
    return "impossible"


def precision_radius_m(label: str | None) -> int:
    """Nominal positional error for a geo_precision label, including off-contract ones.

    Labels inside the union map straight through. Beyond it, only an explicit
    administrative keyword earns a tighter radius -- `subdistrict_reference_estimated`
    is a subdistrict-level estimate and is treated as one.

    Everything else falls back to `unknown` (25 km), which drives matchConfidence
    to zero. That is deliberately conservative: a label like `named_school_estimated`
    may well be the most precise point in the corpus, but nothing in the record says
    how it was derived, and guessing a tight radius would let an unverifiable point
    outweigh a documented one.
    """
    if label in GEO_PRECISION_RADIUS_M:
        return GEO_PRECISION_RADIUS_M[label]
    text = str(label).lower()
    for key in ("gps", "subdistrict", "village", "district", "province", "address"):
        if key in text:  # 'subdistrict' is tested before 'district'
            return GEO_PRECISION_RADIUS_M[key]
    return GEO_PRECISION_RADIUS_M["unknown"]


def match_confidence(snap_m: float, precision_m: float) -> float:
    """How much to trust that this event belongs on the road it snapped to.

        (1 - precision/8000) * (1 - snap/2000)

    Multiplied, not averaged: either doubt on its own is enough to make the
    corridor endpoint unreliable, and averaging would let a tight snap paper
    over an 8 km positional error.

    For a district centroid the first factor is exactly zero, whatever the snap
    quality -- which is the correct answer, and the reason the map draws almost
    every corridor faint.
    """
    if precision_m <= 0:
        return 0.0
    prec = min(max(1 - precision_m / USELESS_PRECISION_M, 0.0), 1.0)
    snap = min(max(1 - snap_m / SNAP_TOLERANCE_M, 0.0), 1.0)
    return prec * snap
