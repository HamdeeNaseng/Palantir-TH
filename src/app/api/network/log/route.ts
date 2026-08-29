import { NextResponse } from "next/server";
import { getFacilityLog } from "@/server/facilities";

export const dynamic = "force-dynamic";

/**
 * One facility's coordination history.
 *
 * A route rather than part of the page payload: the log of every facility is
 * unbounded and only ever read one at a time, when a row is selected. The
 * page itself carries only the newest status per facility, which is what the
 * list and the map colour by.
 */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

  const entries = await getFacilityLog(id);
  return NextResponse.json({ entries }, { headers: { "Cache-Control": "no-store" } });
}
