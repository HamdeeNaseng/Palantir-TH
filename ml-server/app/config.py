"""Runtime settings and the model's hyper-parameters.

Two rules carried over from the notebook, for the same reasons:

1. **The resolved database is always printed.** A server pointed at the wrong
   cluster looks exactly like one pointed at the right cluster until the
   numbers disagree, so `describe()` runs at every entry point.
2. **Hyper-parameters live in one frozen object.** Every batch run records it
   verbatim, so a stored posterior can always be traced back to the constants
   that produced it.

Where this deliberately differs from the notebook: the notebook reads
`./.env` at the repo root and nothing else, because analysis has to be
reproducible. A deployed server has the opposite requirement -- the hosting
environment must be able to override the connection string -- so the search
order here is shell env, then `ml-server/.env`, then the repo's `./.env`.
The safety property the notebook was protecting is preserved by printing which
of the three won.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field, asdict
from pathlib import Path

from dotenv import dotenv_values


def repo_root(start: Path | None = None) -> Path:
    """The directory holding package.json."""
    start = (start or Path(__file__)).resolve()
    for d in (start, *start.parents):
        if (d / "package.json").exists():
            return d
    raise RuntimeError(f"package.json not found above {start} -- run this inside the repo")


ROOT = repo_root()
ML_DIR = ROOT / "ml-server"


def _load_env() -> tuple[dict[str, str], str]:
    """Merge the env files, lowest precedence first. Returns (values, provenance)."""
    layers: list[tuple[str, dict[str, str]]] = []
    for path in (ROOT / ".env", ML_DIR / ".env"):
        if path.exists():
            layers.append((str(path), {k: v for k, v in dotenv_values(path).items() if v}))
    merged: dict[str, str] = {}
    sources: dict[str, str] = {}
    for name, values in layers:
        for k, v in values.items():
            merged[k] = v
            sources[k] = name
    for k in ("MONGODB_URI", "MONGODB_DB", "ROAD_GRAPH_PATH", "ROAD_META_PATH"):
        if os.environ.get(k):
            merged[k] = os.environ[k]
            sources[k] = "shell environment"
    return merged, sources.get("MONGODB_URI", "(unset)")


_ENV, _URI_SOURCE = _load_env()


def mask_uri(uri: str) -> str:
    """Credentials must not reach a log line."""
    return re.sub(r"://([^:/@]+):[^@]*@", lambda m: f"://{m.group(1)}:***@", uri)


@dataclass(frozen=True)
class ModelParams:
    """Every constant the posteriors depend on, recorded with each batch run.

    The values are the ones validated in the notebook. `tau_days` and `blend`
    are absent on purpose: they are *fitted*, not chosen, and land in the run
    document as results (see `forecast.calibrate`).
    """

    seed: int = 42

    # Section 6 -- candidate corridors via iterative edge penalty.
    # Yen's algorithm returns near-identical paths on a real road graph (the
    # other carriageway of a dual carriageway, 20 m apart over 43 km), which is
    # not an "alternative" in the sense an analyst means.
    k_routes: int = 3
    penalty: float = 1.6
    max_overlap: float = 0.6
    max_excess: float = 1.8

    # Section 7 -- Bayesian corridor posterior.
    beta_excess: float = 6.0
    gamma_class: float = 1.0
    lambda_support: float = 0.9
    corridor_radius_m: float = 8000.0  # GEO_PRECISION_RADIUS_M.district

    # Section 8 -- Dirichlet-Multinomial over the next district.
    alpha0: float = 4.0
    d0_m: float = 25_000.0

    # Section 9/11 -- temporal splits. Chronological, never random: a random
    # split leaks the future into the training set.
    split_train: str = "2020-01-01"
    split_valid: str = "2024-01-01"
    tau_grid: tuple[int, ...] = (1, 3, 7, 14, 30, 60, 120, 240, 365, 730)
    blend_grid: tuple[float, ...] = (0.0, 0.25, 0.5, 0.75, 1.0)

    # Section 12 -- a posterior this close to its prior is prior-dominated and
    # must be labelled as such rather than shown as if evidence backed it.
    evidence_prior_dominated_max: float = 0.15

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass(frozen=True)
class Settings:
    mongodb_uri: str
    mongodb_db: str
    road_graph_path: Path
    road_meta_path: Path
    uri_source: str
    api_host: str = "127.0.0.1"
    api_port: int = 8000
    # The Next.js dev server and whatever origin the deployed console runs on.
    cors_origins: tuple[str, ...] = ("http://localhost:3000", "http://127.0.0.1:3000")
    params: ModelParams = field(default_factory=ModelParams)

    def describe(self) -> str:
        return (
            f"mongodb : {mask_uri(self.mongodb_uri)}\n"
            f"database: {self.mongodb_db}\n"
            f"uri from: {self.uri_source}\n"
            f"graph   : {self.road_graph_path}"
        )


def load_settings() -> Settings:
    uri = _ENV.get("MONGODB_URI")
    if not uri:
        raise KeyError(
            "MONGODB_URI is not set. Looked in the shell environment, "
            f"{ML_DIR / '.env'}, and {ROOT / '.env'}."
        )
    graph = Path(_ENV.get("ROAD_GRAPH_PATH") or ROOT / "public/data/south-roads.graph.json")
    meta = Path(_ENV.get("ROAD_META_PATH") or ROOT / "public/data/south-roads.meta.json")
    origins = _ENV.get("ML_CORS_ORIGINS")
    kwargs = {}
    if origins:
        kwargs["cors_origins"] = tuple(o.strip() for o in origins.split(",") if o.strip())
    if _ENV.get("ML_API_HOST"):
        kwargs["api_host"] = _ENV["ML_API_HOST"]
    if _ENV.get("ML_API_PORT"):
        kwargs["api_port"] = int(_ENV["ML_API_PORT"])
    return Settings(
        mongodb_uri=uri,
        mongodb_db=_ENV.get("MONGODB_DB") or "palantir_th",
        road_graph_path=graph,
        road_meta_path=meta,
        uri_source=_URI_SOURCE,
        **kwargs,
    )
