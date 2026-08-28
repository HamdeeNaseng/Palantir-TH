import TopNav from "@/components/layout/TopNav";
import FilterSidebar from "@/components/investigate/FilterSidebar";
import KpiRow from "@/components/investigate/KpiRow";
import MapPanel from "@/components/investigate/MapPanel";
import {
  NetworkPanel,
  RecentEventsPanel,
  SourceReliabilityPanel,
  TrendPanel,
} from "@/components/investigate/MidPanels";
import CitizenSignalPanel from "@/components/investigate/CitizenSignalPanel";
import CaseRail from "@/components/investigate/CaseRail";
import { parseFilters } from "@/lib/filters";
import { getInvestigationDashboard } from "@/server/investigate";

export const dynamic = "force-dynamic";

export default async function InvestigatePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = parseFilters(await searchParams);
  const data = await getInvestigationDashboard(filters);
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

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <FilterSidebar initial={filters} />

        <main className="min-w-0 flex-1 bg-abyss p-2 lg:overflow-auto">
          {!data.live && (
            <p className="fixed top-[calc(var(--nav-h)_+_8px)] right-3 z-50 max-w-[92vw] rounded border border-amber/40 bg-[#211808]/95 px-3 py-1.5 text-[11px] text-amber shadow-lg">
              {/* The docker hint is a local-development instruction. On a
                  hosted deployment there is no container to start, so showing
                  it there sends the reader to fix the wrong thing; the real
                  cause is in the server log written by loadBundle(). */}
              {isLocalDev ? (
                <>
                  ยังเชื่อมต่อ MongoDB ไม่ได้ ให้รัน{" "}
                  <code className="font-mono">docker compose up -d</code> แล้ว{" "}
                  <code className="font-mono">npm run db:seed</code>
                </>
              ) : (
                <>ยังเชื่อมต่อฐานข้อมูลไม่ได้ — ไม่มีข้อมูลแสดงในขณะนี้</>
              )}
            </p>
          )}

          {/* h-full gives the fr rows a definite size to divide. Without it the
              grid is auto-height, fr resolves against content, and the taller
              bottom panel drags the whole first row out of proportion. Below
              `lg` that is exactly what we want instead: one column, each panel
              as tall as it needs to be. */}
          <div className="grid grid-cols-1 gap-2 lg:h-full lg:min-h-[884px] lg:grid-cols-[minmax(0,1fr)_clamp(320px,22vw,360px)] lg:grid-rows-[minmax(570px,1.85fr)_minmax(306px,1fr)]">
            <div className="grid grid-cols-1 gap-2 lg:min-h-0 lg:grid-rows-[82px_268px_minmax(204px,1fr)]">
              <KpiRow kpis={data.kpis} />
              <MapPanel events={data.events} />

              <div className="grid grid-cols-1 gap-2 lg:min-h-0 lg:grid-cols-[1fr_1fr_1.15fr]">
                <TrendPanel trend={data.trend} />
                <NetworkPanel network={data.network} />
                <SourceReliabilityPanel sources={data.sources} />
              </div>
            </div>

            <CaseRail activeCase={data.activeCase} />

            <div className="grid grid-cols-1 gap-2 lg:col-span-2 lg:min-h-0 lg:grid-cols-[minmax(470px,0.61fr)_minmax(0,1fr)]">
              <RecentEventsPanel rows={data.recentEvents} total={data.totalMatched} />
              <CitizenSignalPanel citizen={data.citizen} />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
