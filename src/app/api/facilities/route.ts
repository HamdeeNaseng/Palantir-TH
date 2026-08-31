import { NextResponse } from "next/server";
import { toFacilityMark, type FacilityMark } from "@/lib/facilities";
import { getNetwork } from "@/server/facilities";

export const dynamic = "force-dynamic";

/**
 * The response network as map marks, for every map that is not `/network`.
 *
 * A route handler rather than page payload because this list is deliberately
 * *not* filtered: `/investigate`, `/events` and `/map` all derive their payload
 * from the URL filter grammar, and a facility does not stop existing because
 * the analyst narrowed to one province. Putting it in those payloads would put
 * a filter-independent constant behind a per-filter recompute — and on the two
 * console pages it would mean versioning the IndexedDB snapshot as well.
 *
 * The projection is the point: the marks need nine fields, and sending the full
 * records instead would be ~5x the bytes for data no map reads.
 */
export interface FacilitiesResponse {
  facilities: FacilityMark[];
  /** True when MongoDB answered — the status ring means something. */
  live: boolean;
  /** False when the fetched OSM layer has never been produced on this machine. */
  osmLayerPresent: boolean;
}

export async function GET() {
  const data = await getNetwork();

  const body: FacilitiesResponse = {
    facilities: data.facilities.map(toFacilityMark),
    live: data.live,
    osmLayerPresent: data.osmLayerPresent,
  };

  return NextResponse.json(body, {
    // Status comes from an append-only log anyone can write to, so a proxy
    // holding this would show a closed shelter as open.
    headers: { "Cache-Control": "no-store" },
  });
}
