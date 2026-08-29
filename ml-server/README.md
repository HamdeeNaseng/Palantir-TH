# ml-server — Bayesian route prediction

Deploys the model from [`notebook/Bayesian Route Prediction.ipynb`](../notebook/Bayesian%20Route%20Prediction.ipynb)
as a batch job plus a read-only HTTP service.

```
event_candidates ──▶ run_batch.py ──▶ flow_* collections ──▶ run_server.py ──▶ /map
   (MongoDB)          fit + infer         (MongoDB)             FastAPI         web
```

The split is the whole design. Corridor inference costs several Dijkstra sweeps
per district pair — far too much to run inside a map interaction. So it runs
once, ahead of time, for every pattern the corpus exhibits, and the map's
routing call becomes a single indexed lookup.

---

## What it computes

| Notebook § | Produced | Stored in |
|---|---|---|
| 1–3 | Anchors snapped to the road network, with `matchConfidence` | `flow_anchors` |
| 6–7 | K candidate corridors per district pair with `P(R\|E)` | `flow_corridors` |
| 8 | Dirichlet–Multinomial next-district posterior + 90% CrI | `flow_forecasts` |
| 9 | Fitted `τ` and recency/corridor blend | `flow_model_runs.model.calibration` |
| 10 | Segment flow map, posterior-weighted | `flow_segments` |
| 11 | Walk-forward backtest against four baselines | `flow_model_runs.backtest` |
| 12 | The prediction card | `flow_forecasts` (`anchor_id: "__outlook__"`) |
| 2.4 | The direction test, re-run every batch | `flow_model_runs.data.direction_test` |

### What it deliberately does not compute

Ported along with the model, because they are the reason it has the shape it
has:

- **No directed transitions.** Within-day ordering measures as an ingestion
  artefact, so corridors are undirected. A directed `P(R_{t+1}|R_t)` would model
  the ingestion pipeline and report it as knowledge about the region.
- **No implied velocity in the likelihood.** Timestamps are day-resolution;
  velocity derived from them is an artefact of the recording convention.
- **No HMM, no GNN.** Both need a trustworthy observation sequence, which
  section 2.4 shows does not exist yet.

---

## Setup

```bash
cd ml-server
python -m venv .venv && .venv/Scripts/activate    # Windows
pip install -r requirements.txt
python test_smoke.py                              # no DB needed
```

Configuration is optional — with nothing set it reads the repo's `./.env` and
the road graph from `public/data/`. See [`.env.example`](.env.example) to point
it elsewhere. Both entry points print the resolved, password-masked database
before doing anything.

Needs `public/data/south-roads.graph.json`, which is generated and untracked:
`npm run gis:roads`.

## Running the batch

```bash
python run_batch.py                  # observed pairs, promote when done
python run_batch.py --dry-run        # fit and report, write nothing
python run_batch.py --pairs all      # every routable pair, not just observed
python run_batch.py --max-pairs 200  # quick pass while developing
python run_batch.py --no-promote     # write, leave the previous run live
```

On the current corpus — 10,173 events, 228 anchors — the two modes cost very
differently:

| Mode | Pairs | Time | Stored |
|---|---|---|---|
| `--pairs observed` | 1,032 co-occurring | ~5 min | ~29 MB |
| `--pairs all` | 25,878 routable (25,875 written, 3 unroutable) | ~2 h | ~700 MB |

**`--pairs all` is what the live run currently uses**, and the reason is
coverage rather than accuracy. Under `observed`, 34 of the 228 anchors had no
corridor at all and 176 had fewer than eight, so clicking one of them on the
map returned nothing. Under `all`, every anchor resolves against every other.

What it does *not* change is what the map draws by default. The overview takes
the strongest 60 by co-occurrence, and `segment_flow` weights each corridor by
its co-occurrence days — so the 24,843 pairs that were never observed together
carry weight zero and contribute nothing to either layer. They are the road-graph
prior, available when asked for, and every one of them is flagged
`prior_dominated`.

Re-run it whenever `event_candidates` changes materially. It is a cron job, not
a request path.

### Runs are immutable and promoted

Every document is written under a fresh `run_id` while the run is marked
`building`. Only once all of it has landed does that run become `live` and the
previous one `superseded`.

So a batch that dies half-way leaves the previous model serving untouched, and a
rollback is a status flip rather than a re-run. The API always resolves `live`
first, and `?run_id=` pins any endpoint to a specific run for comparison.
`--keep-runs` controls how many superseded runs are retained before their
documents are pruned.

## Running the API

```bash
python run_server.py                 # 127.0.0.1:8000, /docs for OpenAPI
python run_server.py --reload
```

| Endpoint | Purpose |
|---|---|
| `GET /health` | Liveness, and whether a run is live |
| `GET /v1/run` | Full provenance: params, calibration, backtest, data contract |
| `GET /v1/runs` | Recent runs and their status |
| `GET /v1/anchors` | All anchors, GeoJSON points |
| **`GET /v1/route?from=&to=`** | **Candidate corridors between two anchors, GeoJSON** |
| `GET /v1/corridors?limit=` | Strongest corridors overall, GeoJSON |
| `GET /v1/segments?limit=` | Network flow map, GeoJSON |
| `GET /v1/forecast/{anchor}` | Next-district posterior with 90% CrI |
| `GET /v1/outlook` | The prediction card |

`from`, `to`, and `{anchor}` each accept either an `anchor_id` or a `lng,lat`
pair — the console holds event coordinates, not anchor ids, so requiring ids
would mean two round trips per corridor drawn.

Corridors are stored once per pair and undirected. `/v1/route` accepts either
orientation and returns the geometry running the way you asked, because a line
on a map has a direction even when the claim behind it does not.

Responses carry `Cache-Control: public, max-age=300` and the run id as `ETag`;
the payload only changes when a batch promotes.

---

## How the web console reads it

**The Next.js app does not call this API.** It reads the `flow_*` collections
from MongoDB directly, through its own pooled client. The batch is a cron job
and the console is a reader of what that job left behind, so putting a Python
process in the request path would only add a thing that can be down.

```
run_batch.py ──▶ flow_* in MongoDB ──▶ src/server/flow/predictions.ts ──▶ /map
```

| File | Role |
|---|---|
| `src/server/flow/predictions.ts` | Resolves the live run, reads the four collections |
| `src/app/api/flow/prediction/route.ts` | The layer bundle: anchors, corridors, segments, outlook |
| `src/app/api/flow/prediction/anchor/route.ts` | One anchor's forecast, on click |
| `src/lib/flow/prediction.ts` | Types mirroring the stored documents |
| `src/lib/flow/prediction-layers.ts` | MapLibre paint for the corridor, segment and anchor layers |
| `src/lib/flow/use-prediction.ts` | Fetch-once hooks |
| `src/components/map/PredictionPanel.tsx` | Outlook, per-anchor posterior, skill row, caveats |
| `e2e/map-prediction.spec.ts` | Asserts the whole path, MongoDB through to the drawn layer |

Two toggles on `/map` turn it on — **ช่องทางคาดการณ์ (Bayesian)** and
**ความถี่การใช้ถนน** — both off by default, and both disable themselves with a
reason when no run is live. Clicking a district anchor loads its next-district
posterior with 90% credible intervals.

So this FastAPI service is **not required to run the console**. It stays useful
for anything outside Next.js: notebooks, a scheduler checking whether a batch
promoted, another service wanting the same corridors, or `/docs` when you want
to read a payload by hand.

### Three things the UI must show

The model is well calibrated and weak, and those are not in tension. Displaying
the numbers without their context would overstate it:

1. **`prior_dominated`.** When true, evidence barely moved the road-graph prior
   — a bare "51%" would imply evidence that is not there. Label it.
2. **Top-3 accuracy against the random baseline.** Both are on every response
   at `meta.skill`. Currently ~15% against ~1.3% random: about eleven times
   better than guessing, and nowhere near accurate. That is the ceiling
   district/day resolution allows, not a defect.
3. **`meta.caveats`.** Five strings, carried on every response. The first one is
   the one that matters: these are *candidate event-flow corridors*, not the
   travel route of any person.

---

## Current results

From the latest run (`GET /v1/run`):

| Model | log-loss | top-3 | skill vs uniform |
|---|---|---|---|
| M0 uniform | 5.429 | 0.0% | — |
| M1 base rate | 4.252 | 16.3% | +21.7% |
| M2 recency | 4.263 | 15.7% | +21.5% |
| M3 road prior | 5.655 | 0.0% | **−4.2%** |
| **M4 full** | **3.649** | 15.0% | **+32.8%** |

Fitted `τ* = 240 days`, `blend* = 0.5`.

Read these the way the notebook does:

- **M4 wins on calibration, not on ranking.** It beats every baseline on
  log-loss but does *not* beat the base rate on top-3. If all you need is a
  three-name shortlist, the simpler model is enough.
- **M3 losing to uniform is the finding, not a bug.** Road distance is not a
  predictor by itself. It is a *prior* that spreads probability sensibly over
  pairs never yet observed, and it only pays off inside M4.
- **`τ` in the months contradicts intuition, and the data wins.** The notebook's
  source document suggested hours. Fitting gives 240 days, because the corpus is
  day-resolution and what the model detects is slow drift in where activity
  sits, not tactical rhythm.

## What would actually improve it

In priority order, unchanged from the notebook's section 13 — the first item
needs no new data at all:

1. Finish geocoding `location.place`; ~160 events already carry clock times but
   no coordinates.
2. Record *how* a point was geocoded in `geo_precision`, matching the union in
   `src/lib/types.ts`. Labels like `named_school_estimated` are currently
   degraded to `unknown` (25 km) — possibly the most precise points in the
   corpus, discarded for lack of provenance.
3. Capture minute-resolution event times on the next ingest. That is what makes
   the feasibility bands and any directional claim work at all.
4. Route `citizen_reports` (real GPS) into the same pipeline, so the likelihood
   has observations that genuinely bind to roads.

## Layout

```
ml-server/
├── run_batch.py     # CLI: fit and store
├── run_server.py    # CLI: serve
├── test_smoke.py    # arithmetic checks, no DB required
└── app/
    ├── config.py    # settings + the frozen hyper-parameters recorded per run
    ├── contract.py  # port of src/lib/types.ts + src/lib/flow/feasibility.ts
    ├── db.py        # collections, indexes, the live-run pointer
    ├── graph.py     # CSR road network, Dijkstra, RDP simplification
    ├── corpus.py    # events -> anchors, distances, the data report
    ├── corridors.py # candidate routes + Bayesian posterior (§6–7, §10)
    ├── forecast.py  # Dirichlet-Multinomial, calibration, backtest (§8–9, §11)
    ├── batch.py     # orchestration and the run lifecycle
    └── api.py       # FastAPI read surface
```

### Where this departs from the notebook

Three deliberate differences, all recorded here so the numbers stay traceable:

- **Dijkstra runs in `scipy.sparse.csgraph`, not a Python heap.** Same
  algorithm over the same CSR arrays, identical distances, roughly a hundred
  times faster — which is what makes thousands of pairs feasible.
- **Recency decay uses its exact recursion** rather than re-summing history per
  day: linear instead of quadratic. `test_smoke.py` asserts the two agree.
  The recursion does *not* drop terms below `1e-6`, so it is the same estimator
  computed exactly rather than truncated.
- **Stored geometry is simplified to a 10 m tolerance** (~5× smaller). Against
  the 8 km positional uncertainty the endpoints already carry, this discards
  nothing the model claims to know. The tolerance is recorded on every run.

Env resolution also differs, on purpose: the notebook reads `./.env` and
nothing else so analysis stays reproducible, while a deployed server has to let
its environment override the connection string. The safety property is kept by
printing which source won.
