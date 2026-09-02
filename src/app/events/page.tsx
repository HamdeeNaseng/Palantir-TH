import TopNav from "@/components/layout/TopNav";
import EventsWorkspace from "@/components/events/EventsWorkspace";
import { parseFilters } from "@/lib/filters";
import { getEventsWorkspace } from "@/server/events";

export const dynamic = "force-dynamic";

/**
 * Server-rendered first paint, client-filtered from then on.
 *
 * The URL is still the input: a shared or reloaded link renders exactly what
 * it names, from MongoDB, before any JavaScript runs. What changed is what
 * happens after — `EventsWorkspace` caches the dataset and answers later
 * filter changes itself, so this page runs once per visit rather than once per
 * checkbox.
 */
export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = parseFilters(await searchParams);
  const { data, snapshotVersion, snapshotBuiltAtMs } = await getEventsWorkspace(filters);
  const isLocalDev = process.env.NODE_ENV === "development" && !process.env.VERCEL;

  return (
    <div className="flex min-h-dvh flex-col lg:h-screen lg:min-w-[1180px] lg:overflow-hidden">
      <TopNav active="/events" />
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <EventsWorkspace
          initial={data}
          snapshotVersion={snapshotVersion}
          snapshotBuiltAtMs={snapshotBuiltAtMs}
          isLocalDev={isLocalDev}
        />
      </div>
    </div>
  );
}
