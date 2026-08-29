import { NextResponse } from "next/server";
import { getAnchorDetail, isFailure } from "@/server/flow/predictions";

export const dynamic = "force-dynamic";

/**
 * One anchor's next-district posterior and its own candidate corridors.
 *
 * Split from the bundle because 228 anchors' forecasts are about a megabyte
 * and at most one is being read at a time.
 */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const result = await getAnchorDetail(id);

  // A healthy run that simply has no such anchor — a stale id from a previous
  // run, most likely. Distinct from the model being absent, and a different
  // thing for the caller to do about it.
  if (result === null) {
    return NextResponse.json({ error: "unknown anchor" }, { status: 404 });
  }

  if (isFailure(result)) {
    return NextResponse.json(
      { unavailable: true, reason: result.reason },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
