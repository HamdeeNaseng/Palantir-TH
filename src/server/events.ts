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
  return {
    data: buildEventsWorkspace(snapshot, filters, Date.now()),
    snapshotVersion: snapshot.version,
    snapshotBuiltAtMs: snapshot.builtAtMs,
  };
}

export type { EventsWorkspace };
