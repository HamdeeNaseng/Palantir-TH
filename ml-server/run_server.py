#!/usr/bin/env python
"""Serve the batch's output over HTTP.

    python run_server.py                 # 127.0.0.1:8000
    python run_server.py --reload        # development
    python run_server.py --host 0.0.0.0 --port 8080

Read-only: it answers from what `run_batch.py` stored and never writes. The
resolved database is printed at startup for the same reason the batch prints
it -- a server pointed at the wrong cluster looks fine until the numbers do not.
"""

from __future__ import annotations

import argparse

import uvicorn

from app.config import load_settings
from app.db import use_utf8_stdout


def main() -> int:
    settings = load_settings()
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--host", default=settings.api_host)
    parser.add_argument("--port", type=int, default=settings.api_port)
    parser.add_argument("--reload", action="store_true", help="restart on source changes")
    parser.add_argument("--workers", type=int, default=1)
    args = parser.parse_args()

    use_utf8_stdout()
    print(settings.describe())
    print(f"cors    : {', '.join(settings.cors_origins)}")
    print(f"docs    : http://{args.host}:{args.port}/docs\n")

    uvicorn.run(
        "app.api:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        # uvicorn rejects workers > 1 together with reload; reload wins because
        # it is only ever passed deliberately.
        workers=1 if args.reload else args.workers,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
