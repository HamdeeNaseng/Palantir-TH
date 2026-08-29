import TopNav from "@/components/layout/TopNav";
import InvestigateWorkspace from "@/components/investigate/InvestigateWorkspace";
import { parseFilters } from "@/lib/filters";
import { getInvestigationDashboard } from "@/server/investigate";

export const dynamic = "force-dynamic";

/**
 * Server-rendered first paint, client-filtered from then on.
 *
 * The URL is still the input: a shared or reloaded link renders exactly what
 * it names, from MongoDB, before any JavaScript runs. What changed is what
 * happens after — `InvestigateWorkspace` caches the dataset and answers later
 * filter changes itself, so this page runs once per visit rather than once per
 * checkbox.
 */
export default async function InvestigatePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = parseFilters(await searchParams);
  const { data, snapshotVersion, snapshotBuiltAtMs } = await getInvestigationDashboard(filters);
  const isLocalDev = process.env.NODE_ENV === "development" && !process.env.VERCEL;

  return (
    // Two layouts, one tree. At `lg` this is the fixed analyst console: a
    // viewport-height shell that never scrolls, with each panel scrolling
    // inside its own cell. Below it the dashboard stops pretending to be a
    // dashboard and becomes an ordinary scrolling column, because a 1180 px
    // floor on a 390 px screen is just a horizontal scrollbar over a layout
    // nobody can read.
    <div className="flex min-h-dvh flex-col lg:h-screen lg:min-w-[1180px] lg:overflow-hidden">
      <TopNav active="/investigate" />
      <InvestigateWorkspace
        initial={data}
        snapshotVersion={snapshotVersion}
        snapshotBuiltAtMs={snapshotBuiltAtMs}
        isLocalDev={isLocalDev}
      />
    </div>
  );
}
