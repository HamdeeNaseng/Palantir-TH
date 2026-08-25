import TopNav from "@/components/layout/TopNav";
import EventsWorkspace from "@/components/events/EventsWorkspace";
import { parseFilters } from "@/lib/filters";
import { getEventsWorkspace } from "@/server/events";

export const dynamic = "force-dynamic";

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = parseFilters(await searchParams);
  const data = await getEventsWorkspace(filters);

  return (
    <div className="flex h-screen min-w-[1180px] flex-col overflow-hidden">
      <TopNav active="/events" />
      <div className="flex min-h-0 flex-1">
        <EventsWorkspace data={data} />
      </div>
    </div>
  );
}
