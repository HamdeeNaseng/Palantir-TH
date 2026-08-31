"use client";

import { useMemo, useState } from "react";
import FilterSidebar from "./FilterSidebar";
import KpiRow from "./KpiRow";
import MapPanel from "./MapPanel";
import { NetworkPanel, RecentEventsPanel, SourceReliabilityPanel, TrendPanel } from "./MidPanels";
import CitizenSignalPanel from "./CitizenSignalPanel";
import CaseRail from "./CaseRail";
import SnapshotStatusNote from "@/components/layout/SnapshotStatusNote";
import { useLocalFilters } from "@/lib/use-local-filters";
import { buildInvestigationDashboard } from "@/lib/view-models/investigate";
import type { InvestigationDashboard } from "@/lib/view-models/investigate";

/**
 * The state owner for `/investigate`.
 *
 * Exists for the same reason `EventsWorkspace` does: the sidebar and the
 * dashboard have to agree on one set of filters, and that set is now client
 * state rather than a URL the server re-renders. The page component above is
 * back to being a thin server shell that produces the first paint.
 *
 * The layout below is the one that used to live in `page.tsx`, moved verbatim.
 * Panels like `KpiRow` and `MidPanels` have no `"use client"` of their own and
 * do not need one — imported from here they are simply part of this client
 * tree, and none of them touches a server-only API.
 */
export default function InvestigateWorkspace({
  initial,
  snapshotVersion,
  snapshotBuiltAtMs,
  isLocalDev,
}: {
  initial: InvestigationDashboard;
  snapshotVersion: string;
  snapshotBuiltAtMs: number;
  /** Decided on the server: `process.env` is not readable from here. */
  isLocalDev: boolean;
}) {
  // `local` is what lets the sidebar drop its apply button: once the dataset
  // is in hand a filter change costs one pass over it, so there is no reason
  // to make the analyst commit a batch of changes before seeing any of them.
  // Until then the button is still the only safe way to spend a round trip.
  const {
    view: data,
    apply,
    applyLive,
    reset,
    pending,
    local,
    snapshot,
  } = useLocalFilters<InvestigationDashboard>({
    path: "/investigate",
    initialFilters: initial.filters,
    initialView: initial,
    initialVersion: snapshotVersion,
    initialBuiltAtMs: snapshotBuiltAtMs,
    build: (snap, filters) => buildInvestigationDashboard(snap, filters, Date.now()),
  });

  /**
   * The hotspot the analyst clicked, which is what the right-hand rail shows.
   *
   * Held here rather than inside `MapPanel` because the rail is its sibling,
   * and kept as an id rather than the feature so a filter change cannot leave
   * the rail displaying an event the map no longer draws: the lookup below
   * runs against the current `data.events` and yields null when the selection
   * has been filtered out.
   */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedEvent = useMemo(
    () => data.events.features.find((f) => f.properties.id === selectedId) ?? null,
    [data.events, selectedId],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <FilterSidebar
        initial={data.filters}
        sources={data.facets.sources}
        onApply={local ? applyLive : apply}
        live={local}
        onReset={reset}
        pending={pending}
        footerNote={<SnapshotStatusNote snapshot={snapshot} />}
      />

      <main className="min-w-0 flex-1 bg-abyss p-2 lg:overflow-auto">
        {!data.live && (
          <p className="fixed top-[calc(var(--nav-h)_+_8px)] right-3 z-50 max-w-[92vw] rounded border border-amber/40 bg-[#211808]/95 px-3 py-1.5 text-[11px] text-amber shadow-lg">
            {/* The docker hint is a local-development instruction. On a hosted
                deployment there is no container to start, so showing it there
                sends the reader to fix the wrong thing; the real cause is in
                the server log written by loadBundle(). */}
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
        {/* The row floors add up, and have to be kept adding up: the left
            column is 82 + 360 + 204 with two 8 px gaps = 662, which is the
            first row's minimum, and 662 + 306 + one more gap = 976 is the
            grid's. Changing any one of them without the others lets a track
            collapse below the panel inside it. */}
        <div className="grid grid-cols-1 gap-2 lg:h-full lg:min-h-[976px] lg:grid-cols-[minmax(0,1fr)_clamp(320px,22vw,360px)] lg:grid-rows-[minmax(662px,1.85fr)_minmax(306px,1fr)]">
          {/*
            The map takes the slack rather than a fixed slice of it.

            It used to be a flat `268px` track, which made it *shorter* on a
            desktop than the `58vh` it gets on a phone, and left it that size
            on a 27-inch monitor with the extra height going to the chart row
            underneath. A floor plus the larger `fr` share means it starts at
            360 and grows with the viewport — on this console the map is the
            panel being read, and the three charts below it are reference.
          */}
          <div className="grid grid-cols-1 gap-2 lg:min-h-0 lg:grid-rows-[82px_minmax(360px,1.55fr)_minmax(204px,1fr)]">
            <KpiRow kpis={data.kpis} />
            <MapPanel events={data.events} onSelectFeature={setSelectedId} />

            <div className="grid grid-cols-1 gap-2 lg:min-h-0 lg:grid-cols-[1fr_1fr_1.15fr]">
              <TrendPanel trend={data.trend} />
              <NetworkPanel network={data.network} />
              <SourceReliabilityPanel sources={data.sources} />
            </div>
          </div>

          <CaseRail activeCase={data.activeCase} selectedEvent={selectedEvent} />

          <div className="grid grid-cols-1 gap-2 lg:col-span-2 lg:min-h-0 lg:grid-cols-[minmax(470px,0.61fr)_minmax(0,1fr)]">
            <RecentEventsPanel rows={data.recentEvents} total={data.totalMatched} />
            <CitizenSignalPanel citizen={data.citizen} />
          </div>
        </div>
      </main>
    </div>
  );
}
