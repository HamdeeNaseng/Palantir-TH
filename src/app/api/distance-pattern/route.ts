import { NextResponse } from "next/server";
import { getDistancePattern } from "@/server/distance-pattern";
import type { DistancePattern } from "@/lib/distance-pattern";

export const dynamic = "force-dynamic";

/**
 * One case's 32-direction distance pattern, for the map layer on
 * `/investigate`.
 *
 * A route handler rather than page payload, for the same reason `/api/flow/*`
 * is one: the analyst looks at a handful of cases per session out of ~10,000,
 * and every pattern is ~1.5 KB projected. Shipping them all with the dashboard
 * would be megabytes to answer a question that has not been asked yet.
 *
 * `pattern: null` is a 200, not a 404. The batch is optional — on a fresh
 * clone, in CI, and in the Playwright suite it has never run — and a case
 * outside the last run is the same normal absence. The layer says so in its
 * own toggle row; the map keeps drawing everything else.
 */
export interface DistancePatternResponse {
  pattern: DistancePattern | null;
}

export async function GET(request: Request) {
  const eventId = new URL(request.url).searchParams.get("eventId");
  if (!eventId) {
    return NextResponse.json({ error: "eventId is required" }, { status: 400 });
  }

  const pattern = await getDistancePattern(eventId);
  const body: DistancePatternResponse = { pattern };

  return NextResponse.json(body, {
    // The batch rewrites this collection wholesale on every run, so a proxy
    // holding a pattern would keep serving neighbours from a superseded run.
    headers: { "Cache-Control": "no-store" },
  });
}
