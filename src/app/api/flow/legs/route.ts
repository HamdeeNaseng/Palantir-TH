import { NextResponse } from "next/server";
import { z } from "zod";
import { computeFlowSequences } from "@/server/flow/pipeline";

export const dynamic = "force-dynamic";

const pointSchema = z.object({
  id: z.string(),
  lng: z.number(),
  lat: z.number(),
  tsMs: z.number(),
  geoPrecisionM: z.number(),
});

/**
 * One sequence per event family, never one flat list: legs are chained inside
 * a sequence and never across two, which is what keeps a corridor from being
 * drawn between events of different families.
 */
const requestSchema = z.object({
  sequences: z.array(z.array(pointSchema).min(2)).min(1),
});

/**
 * Road-network corridors between consecutive events, for the opt-in
 * "เส้นทางตามถนนจริง" layer on `/events` and `/map`.
 *
 * The client already holds each event's coordinates and timestamp (they came
 * from the server as part of the page's own event features), so this takes
 * the points directly rather than re-querying Mongo by id — grouped into the
 * per-family sequences the caller wants chained.
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

  const result = computeFlowSequences(parsed.data.sequences);

  if (!result.ok) {
    return NextResponse.json(
      { legs: [], unavailable: true, reason: result.reason },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json({ legs: result.legs }, { headers: { "Cache-Control": "no-store" } });
}
