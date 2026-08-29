#!/usr/bin/env python
"""Fit the Bayesian route-prediction model and store every pattern in MongoDB.

    python run_batch.py                      # observed pairs, promote when done
    python run_batch.py --dry-run            # fit and report, write nothing
    python run_batch.py --pairs all          # every routable pair, not just observed
    python run_batch.py --no-promote         # write, leave the previous run live
    python run_batch.py --max-pairs 200      # a quick pass for development

Exit status is non-zero on failure, so this drops straight into cron or a CI
job without a wrapper.
"""

from __future__ import annotations

import argparse
import sys

from app.batch import BatchOptions, run_batch
from app.config import load_settings
from app.db import use_utf8_stdout


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--pairs",
        choices=("observed", "all"),
        default="observed",
        help="which district pairs get corridors. 'observed' (default) covers every pair that "
        "has co-occurred at least --min-cooccurrence times; 'all' covers every routable pair, "
        "which takes considerably longer and mostly stores the prior.",
    )
    parser.add_argument("--min-cooccurrence", type=int, default=1,
                        help="minimum co-occurrence days for --pairs observed (default 1)")
    parser.add_argument("--max-pairs", type=int, default=0,
                        help="cap on pairs, strongest co-occurrence first (0 = no cap)")
    parser.add_argument("--top-segments", type=int, default=5000,
                        help="how many road segments of the flow map to store (default 5000)")
    parser.add_argument("--forecast-top-k", type=int, default=12,
                        help="districts kept per forecast document (default 12)")
    parser.add_argument("--keep-runs", type=int, default=3,
                        help="superseded runs to retain before pruning (default 3)")
    parser.add_argument("--no-promote", action="store_true",
                        help="write the run but leave the previous one live")
    parser.add_argument("--dry-run", action="store_true",
                        help="fit and report; write nothing to MongoDB")
    args = parser.parse_args()

    use_utf8_stdout()
    settings = load_settings()
    opts = BatchOptions(
        pairs=args.pairs,
        min_cooccurrence=args.min_cooccurrence,
        max_pairs=args.max_pairs,
        top_segments=args.top_segments,
        forecast_top_k=args.forecast_top_k,
        keep_runs=args.keep_runs,
        promote=not args.no_promote,
        dry_run=args.dry_run,
    )

    try:
        run_batch(settings, opts)
    except Exception as exc:
        print(f"\nbatch failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
