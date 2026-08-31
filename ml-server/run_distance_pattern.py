#!/usr/bin/env python
"""Compute the 32-direction distance pattern for every case and store it in MongoDB.

    python run_distance_pattern.py                    # every case, facilities, with road
    python run_distance_pattern.py --dry-run          # compute and report, write nothing
    python run_distance_pattern.py --radius-km 10     # a tighter neighbourhood
    python run_distance_pattern.py --no-road          # straight-line only, no graph needed
    python run_distance_pattern.py --limit-cases 200  # a quick pass for development

Writes one document per case to the results collection, keyed by `event_id`
(the `event_candidates._id` foreign key). Exit status is non-zero on failure,
so this drops straight into cron or CI without a wrapper.
"""

from __future__ import annotations

import argparse
import sys

from app.config import load_settings
from app.db import CASE_PATTERNS, use_utf8_stdout
from app.distance_pattern import DEFAULT_RADIUS_M
from app.pattern_batch import PatternBatchOptions, run_pattern_batch


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--radius-km",
        type=float,
        default=DEFAULT_RADIUS_M / 1000,
        help="how far each direction looks before reporting the sector empty "
        f"(default {DEFAULT_RADIUS_M / 1000:.0f})",
    )
    parser.add_argument(
        "--neighbours",
        choices=("facilities", "events"),
        default="facilities",
        help="what the 32 directions look for. 'facilities' (default) uses the OSM facility "
        "layer, which carries real positions. 'events' compares cases against each other and "
        "is mostly degenerate, because cases share district centroids.",
    )
    parser.add_argument(
        "--no-road",
        action="store_true",
        help="skip road distance and detour ratio; straight-line only, no road graph required",
    )
    parser.add_argument("--keep-runs", type=int, default=2,
                        help="runs to retain, newest first (default 2)")
    parser.add_argument("--limit-cases", type=int, default=0,
                        help="cap on cases processed (0 = every case)")
    parser.add_argument("--dry-run", action="store_true",
                        help="compute and report; write nothing to MongoDB")
    args = parser.parse_args()

    use_utf8_stdout()
    settings = load_settings()
    opts = PatternBatchOptions(
        radius_m=args.radius_km * 1000.0,
        neighbours=args.neighbours,
        with_road=not args.no_road,
        keep_runs=args.keep_runs,
        limit_cases=args.limit_cases,
        dry_run=args.dry_run,
    )

    try:
        result = run_pattern_batch(settings, opts)
    except Exception as exc:
        print(f"\nbatch failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1

    if not result.get("dry_run"):
        print(f"\ncollection: {CASE_PATTERNS}   run_id: {result['run_id']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
