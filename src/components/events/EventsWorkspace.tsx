"use client";

import { useEffect, useMemo, useState } from "react";
import EventsFilterSidebar from "./EventsFilterSidebar";
import EventsKpiRow from "./EventsKpiRow";
import MapPanel from "@/components/investigate/MapPanel";
import TimelinePanel from "./TimelinePanel";
import EventsTrendPanel from "./EventsTrendPanel";
import RecentPlayedPanel from "./RecentPlayedPanel";
import PhenomenaSummaryPanel from "./PhenomenaSummaryPanel";
import InspectSummaryPanel from "./InspectSummaryPanel";
import {
  densityScore,
  districtClusters,
  phenomenaSummary,
  playedSoFar,
  scopedTimePath,
} from "@/lib/events-replay";
import type { EventsWorkspace as EventsWorkspaceData } from "@/server/events";

/**
 * The state owner for `/events`.
 *
 * Wraps both the filter sidebar and the main content (a deviation from
 * `/investigate`'s plain-sibling page shape) because the sidebar's "การตั้งค่า
 * การเล่น" section needs the same playback state as everything else here —
 * there is nowhere else for that state to live without prop-drilling through
 * the server page or inventing a context provider for four fields.
 *
 * Everything playhead-dependent (played-so-far, density, clusters, the scoped
 * time-path, phenomena insights, the trend highlight band) is derived with
 * `useMemo` off the one `EventFeatureCollection` the server shipped once —
 * see `src/lib/events-replay.ts` for why this stays client-side instead of a
 * server round trip per scrub tick.
 */
export default function EventsWorkspace({ data }: { data: EventsWorkspaceData }) {
  const features = data.events.features;

  const [currentTimestamp, setCurrentTimestamp] = useState(data.span?.endMs ?? Date.now());
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<1 | 2 | 4>(1);
  const [playbackStartMs, setPlaybackStartMs] = useState(data.span?.startMs ?? Date.now());
  const [playbackEndMs, setPlaybackEndMs] = useState(data.span?.endMs ?? Date.now());
  const [autoPlay, setAutoPlay] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // A fresh filter selection ships a brand-new `data` (different span, event
  // set) — resync the playback window rather than carrying over a timestamp
  // that may no longer even fall inside the new span.
  useEffect(() => {
    setCurrentTimestamp(data.span?.endMs ?? Date.now());
    setPlaybackStartMs(data.span?.startMs ?? Date.now());
    setPlaybackEndMs(data.span?.endMs ?? Date.now());
    setPlaying(autoPlay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Playback tick — same shape as MapPanel's own uncontrolled timer, lifted
  // here since this is now the single source of truth for the playhead.
  useEffect(() => {
    if (!playing || playbackEndMs <= playbackStartMs) return;
    const baseStep = Math.max(3600000, Math.ceil((playbackEndMs - playbackStartMs) / 240));
    const step = baseStep * speed;
    const timer = window.setInterval(() => {
      setCurrentTimestamp((t) => {
        if (t >= playbackEndMs) {
          setPlaying(false);
          return playbackEndMs;
        }
        return Math.min(playbackEndMs, t + step);
      });
    }, 80);
    return () => window.clearInterval(timer);
  }, [playing, playbackStartMs, playbackEndMs, speed]);

  const playedFeatures = useMemo(() => playedSoFar(features, currentTimestamp), [features, currentTimestamp]);
  const pathCoords = useMemo(() => scopedTimePath(features, currentTimestamp), [features, currentTimestamp]);
  const clusters = useMemo(() => districtClusters(features, currentTimestamp), [features, currentTimestamp]);
  const density = useMemo(
    () => densityScore(features, currentTimestamp, data.totalDistrictsInScope),
    [features, currentTimestamp, data.totalDistrictsInScope],
  );
  const phenomena = useMemo(() => phenomenaSummary(features, currentTimestamp), [features, currentTimestamp]);

  const inspectFeature = useMemo(() => {
    const byId = hoveredId ?? selectedId;
    if (byId) {
      const found = features.find((f) => f.properties.id === byId);
      if (found) return found;
    }
    return playedFeatures.length ? playedFeatures[playedFeatures.length - 1] : null;
  }, [features, hoveredId, selectedId, playedFeatures]);

  return (
    <>
      <EventsFilterSidebar
        initial={data.filters}
        facets={data.facets}
        playbackStartMs={playbackStartMs}
        playbackEndMs={playbackEndMs}
        spanStartMs={data.span?.startMs ?? playbackStartMs}
        spanEndMs={data.span?.endMs ?? playbackEndMs}
        onPlaybackRangeChange={(startMs, endMs) => {
          setPlaybackStartMs(startMs);
          setPlaybackEndMs(endMs);
          setCurrentTimestamp((t) => Math.max(startMs, Math.min(endMs, t)));
        }}
        autoPlay={autoPlay}
        onAutoPlayChange={setAutoPlay}
      />

      <main className="min-w-0 flex-1 overflow-auto bg-abyss p-2">
        {!data.live && (
          <p className="fixed top-[46px] right-3 z-50 rounded border border-amber/40 bg-[#211808]/95 px-3 py-1.5 text-[11px] text-amber shadow-lg">
            กำลังแสดงสถานะไม่มีข้อมูล — ยังเชื่อมต่อ MongoDB ไม่ได้ ให้รัน{" "}
            <code className="font-mono">docker compose up -d</code> แล้ว{" "}
            <code className="font-mono">npm run db:seed</code>
          </p>
        )}

        <div className="grid h-full min-h-[884px] grid-cols-[minmax(0,1fr)_clamp(300px,22vw,340px)] grid-rows-[minmax(560px,1.75fr)_minmax(260px,1fr)] gap-2">
          <div className="grid min-h-0 grid-rows-[82px_minmax(220px,1fr)_128px] gap-2">
            <EventsKpiRow data={data} playedCount={playedFeatures.length} density={density} />

            <MapPanel
              events={data.events}
              currentTimestamp={currentTimestamp}
              onTimestampChange={setCurrentTimestamp}
              playing={playing}
              onPlayingChange={setPlaying}
              onHoverFeature={setHoveredId}
              onSelectFeature={setSelectedId}
              timePath={pathCoords}
              clusters={clusters.map((c) => ({ lng: c.lng, lat: c.lat, tier: c.tier, label: c.district }))}
            />

            <TimelinePanel
              data={data}
              currentTimestamp={currentTimestamp}
              onTimestampChange={setCurrentTimestamp}
              playing={playing}
              onPlayingChange={setPlaying}
              speed={speed}
              onSpeedChange={setSpeed}
              playbackStartMs={playbackStartMs}
              playbackEndMs={playbackEndMs}
            />
          </div>

          <InspectSummaryPanel feature={inspectFeature} />

          <div className="col-span-2 grid min-h-0 grid-cols-3 gap-2">
            <EventsTrendPanel data={data} currentTimestamp={currentTimestamp} />
            <RecentPlayedPanel played={playedFeatures} />
            <PhenomenaSummaryPanel insights={phenomena.insights} />
          </div>
        </div>
      </main>
    </>
  );
}
