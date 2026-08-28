import { NextResponse } from "next/server";
import { z } from "zod";
import { computeFlowLegs } from "@/server/flow/pipeline";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  points: z
    .array(
      z.object({
        id: z.string(),
        lng: z.number(),
        lat: z.number(),
        tsMs: z.number(),
        geoPrecisionM: z.number(),
      }),
    )
    .min(2),
});

/**
 * Road-network corridors between consecutive events, for the opt-in
 * "เส้นทางตามถนนจริง" layer on `/events` and `/map`.
 *
 * The client already holds each event's coordinates and timestamp (they came
 * from the server as part of the page's own event features), so this takes
 * the points directly rather than re-querying Mongo by id.
 *
 * Routing runs in-process against the graph built by
 * `scripts/fetch-roads.ts`. With that file absent this reports the layer
 * unavailable rather than erroring, so a fresh clone, CI, and the Playwright
 * suite all keep working with the layer simply switched off.
 */
export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request body" }, { status: 400 });
  }

  const result = computeFlowLegs(parsed.data.points);

  if (!result.ok) {
    return NextResponse.json(
      { legs: [], unavailable: true, reason: result.reason },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json({ legs: result.legs }, { headers: { "Cache-Control": "no-store" } });
}
