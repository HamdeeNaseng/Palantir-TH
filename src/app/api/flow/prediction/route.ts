import { NextResponse } from "next/server";
import { getPredictionBundle, isFailure } from "@/server/flow/predictions";

export const dynamic = "force-dynamic";

/**
 * The Bayesian route-prediction model, for the opt-in layers on `/map`.
 *
 * A route handler rather than page data for the same reason the dot layer is
 * one: the payload is a few hundred kilobytes and the layer is off by default,
 * so it must not ride along in every render of the page.
 *
 * An absent model is a 200 with `unavailable`, never an error status. A fresh
 * clone has never run `ml-server/run_batch.py`, and that has to leave the map
 * working with the layer switched off — the same contract
 * `/api/flow/legs` has for a missing road graph.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const corridorLimit = clamp(params.get("corridors"), 60, 1, 400);
  const segmentLimit = clamp(params.get("segments"), 1200, 1, 5000);

  const result = await getPredictionBundle({ corridorLimit, segmentLimit });

  if (isFailure(result)) {
    return NextResponse.json(
      { unavailable: true, reason: result.reason },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(result, {
    // Only changes when a batch promotes a new run, which is a cron-scale
    // event — but the run id is what makes it safe to cache at all, so it goes
    // on the response as the validator.
    headers: {
      "Cache-Control": "no-store",
      ETag: `"${result.run.runId}"`,
    },
  });
}

/**
 * `Number(null)` is 0, not NaN, so an absent parameter has to be rejected
 * before the numeric check — otherwise every default silently clamps to `min`
 * and the layer draws one corridor instead of sixty.
 */
function clamp(raw: string | null, fallback: number, min: number, max: number): number {
  if (raw === null || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}
