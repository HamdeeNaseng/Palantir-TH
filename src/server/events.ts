import { DEFAULT_FILTERS, type InvestigationFilters } from "@/lib/filters";
import { buildEventsWorkspace, type EventsWorkspace } from "@/lib/view-models/events";
import { getSnapshot } from "./snapshot";
import type { Snapshot } from "@/lib/snapshot";

/**
 * `/events`' first paint.
 *
 * All the aggregation this used to do moved to `@/lib/view-models/events`, so
 * the browser can run it against its own cached snapshot on every later filter
 * change. What is left here is the half that genuinely needs a server: reading
 * MongoDB. The page renders the same view model either way, from the same
 * function.
 *
 * The snapshot is returned alongside it so the page can tell the client which
 * version its server-rendered view was built from — a client holding anything
 * newer rebuilds instead of showing data that has already moved on.
 */
export async function getEventsWorkspace(
  filters: InvestigationFilters = DEFAULT_FILTERS,
): Promise<{ data: EventsWorkspace; snapshotVersion: Snapshot["version"]; snapshotBuiltAtMs: number }> {
  const snapshot = await getSnapshot();
  const data = buildEventsWorkspace(snapshot, filters, Date.now());

  return {
    // The features are dropped on the way out, not skipped during the build:
    // every aggregate below them — facets, histogram, span, totalMatched — is
    // computed from the full match and survives, so the first paint is still
    // the real answer for these filters. Only the map's dots are deferred, and
    // `EventsWorkspace` rebuilds them from the snapshot it fetches anyway.
    // Measured: 6.68 MB of RSC payload for a set the client immediately
    // recreates, which on a throttled phone is seconds of parsing.
    data: { ...data, events: { ...data.events, features: [] }, eventsDeferred: true },
    snapshotVersion: snapshot.version,
    snapshotBuiltAtMs: snapshot.builtAtMs,
  };
}

export type { EventsWorkspace };
