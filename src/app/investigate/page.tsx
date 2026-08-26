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
    <div className="flex h-screen min-w-[1180px] flex-col overflow-hidden">
      <TopNav active="/investigate" />

      <div className="flex min-h-0 flex-1">
        <FilterSidebar initial={filters} />

        <main className="min-w-0 flex-1 overflow-auto bg-abyss p-2">
          {!data.live && (
            <p className="fixed top-[46px] right-3 z-50 rounded border border-amber/40 bg-[#211808]/95 px-3 py-1.5 text-[11px] text-amber shadow-lg">
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
              bottom panel drags the whole first row out of proportion. */}
          <div className="grid h-full min-h-[884px] grid-cols-[minmax(0,1fr)_clamp(320px,22vw,360px)] grid-rows-[minmax(570px,1.85fr)_minmax(306px,1fr)] gap-2">
            <div className="grid min-h-0 grid-rows-[82px_268px_minmax(204px,1fr)] gap-2">
              <KpiRow kpis={data.kpis} />
              <MapPanel events={data.events} />

              <div className="grid min-h-0 grid-cols-[1fr_1fr_1.15fr] gap-2">
                <TrendPanel trend={data.trend} />
                <NetworkPanel network={data.network} />
                <SourceReliabilityPanel sources={data.sources} />
              </div>
            </div>

            <CaseRail activeCase={data.activeCase} />

            <div className="col-span-2 grid min-h-0 grid-cols-[minmax(470px,0.61fr)_minmax(0,1fr)] gap-2">
              <RecentEventsPanel rows={data.recentEvents} total={data.totalMatched} />
              <CitizenSignalPanel citizen={data.citizen} />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
