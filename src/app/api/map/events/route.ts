import { NextResponse } from "next/server";
import { parseFilters } from "@/lib/filters";
import { getMapEvents } from "@/server/map-overview";

export const dynamic = "force-dynamic";

/**
 * Event points for `/map`, on demand.
 *
 * The only route handler in the app, and it exists because it has a caller
 * that a server component cannot serve: the dot layer is opt-in, so its ~6.5 MB
 * of points must not be in the page payload, and turning the layer on happens
 * long after the server component has finished rendering.
 *
 * It takes the same query grammar as the pages (`parseFilters`), so whatever
 * filters the map is showing are the filters the points come back for.
 */
export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const events = await getMapEvents(parseFilters(params));

  return NextResponse.json(events, {
    // A filtered event set is derived state, not a document — revalidating is
    // the caller's job via the query string, so don't let a proxy hold it.
    headers: { "Cache-Control": "no-store" },
  });
}
