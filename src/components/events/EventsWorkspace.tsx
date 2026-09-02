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
  scopedLinkGroups,
  scopedTimePaths,
} from "@/lib/events-replay";
import { useFlowLegs } from "@/lib/flow/use-flow-legs";
import SnapshotStatusNote from "@/components/layout/SnapshotStatusNote";
import { useLocalFilters } from "@/lib/use-local-filters";
import { buildEventsWorkspace } from "@/lib/view-models/events";
import type { EventsWorkspace as EventsWorkspaceData } from "@/lib/view-models/events";

/**
 * Replay pacing at 1x. The full window is walked in `PLAYBACK_FRAMES` ticks of
 * `PLAYBACK_TICK_MS`, so a whole span takes about a minute at 1x and the 2x/4x
 * buttons cut that to ~29s and ~14s. The earlier 240 frames at 80ms crossed
 * years of events in 19 seconds — and in practice faster still, since
 * `MapPanel` was running a second interval over the same playhead (now guarded
 * by `isControlled` there). Either way it was quicker than the map, the
 * cluster rings and the trend band could be read, which is the only reason to
 * watch a replay rather than a static map.
 *
 * `MIN_PLAYBACK_STEP_MS` keeps the playhead moving perceptibly on a short
 * window, where `span / PLAYBACK_FRAMES` would otherwise be a few seconds of
 * event time per tick; at 15 minutes a single day still takes ~11s to walk.
 */
const PLAYBACK_FRAMES = 480;
const PLAYBACK_TICK_MS = 120;
const MIN_PLAYBACK_STEP_MS = 900000;

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
export default function EventsWorkspace({
  initial,
  snapshotVersion,
  snapshotBuiltAtMs,
  isLocalDev,
}: {
  initial: EventsWorkspaceData;
  snapshotVersion: string;
  snapshotBuiltAtMs: number;
  /** Decided on the server: `process.env` is not readable from here. */
  isLocalDev: boolean;
}) {
  // The server rendered `initial` for the URL's filters. From here on, every
  // filter change is answered from the snapshot in IndexedDB — same builder,
  // no navigation, no MongoDB read. `data` is whichever of the two is current.
  //
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
  } = useLocalFilters<EventsWorkspaceData>({
    path: "/events",
    initialFilters: initial.filters,
    initialView: initial,
    initialVersion: snapshotVersion,
    initialBuiltAtMs: snapshotBuiltAtMs,
    build: (snap, filters) => buildEventsWorkspace(snap, filters, Date.now()),
  });

  const features = data.events.features;

  const [internalTimestamp, setCurrentTimestamp] = useState(data.span?.endMs ?? Date.now());
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<1 | 2 | 4>(1);
  const [playbackStartMs, setPlaybackStartMs] = useState(data.span?.startMs ?? Date.now());
  const [playbackEndMs, setPlaybackEndMs] = useState(data.span?.endMs ?? Date.now());
  const [autoPlay, setAutoPlay] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [flowCorridorsEnabled, setFlowCorridorsEnabled] = useState(false);

  // A fresh filter selection covers a different span — resync the playback
  // window rather than carrying over a timestamp that may no longer even fall
  // inside it.
  //
  // Keyed on the span rather than on `data` identity: the five-minute snapshot
  // refresh rebuilds `data` on its own schedule, and resetting the playhead
  // mid-replay because a background sync happened to land is not something the
  // person watching it asked for. A refresh that genuinely extends the record
  // does move the span, and that one does resync.
  //
  // Derived during this render rather than applied by an effect, because an
  // effect lands one commit too late: everything below would compute once
  // against the outgoing playhead and then immediately again against the reset
  // one, and `districtClusters` — a Poisson scan of every played event — is
  // the most expensive thing on that path. Measured at two full runs of it per
  // filter change. React re-runs this component before committing, so the
  // reset is visible to the memos below on the first pass and the second finds
  // its dependencies unchanged.
  //
  // No `Date.now()` fallback here, unlike the initial state above: this must
  // be pure, and it would differ between the two passes. An empty result set
  // therefore leaves the playhead and window where they were instead of
  // snapping them to now — which is also the better answer, since a filter
  // that matches nothing is usually one the analyst is about to widen again.
  const spanStartMs = data.span?.startMs;
  const spanEndMs = data.span?.endMs;
  const spanKey = `${spanStartMs ?? ""}:${spanEndMs ?? ""}`;
  const [syncedSpanKey, setSyncedSpanKey] = useState(spanKey);
  const spanMoved = spanKey !== syncedSpanKey;
  const currentTimestamp = spanMoved ? (spanEndMs ?? internalTimestamp) : internalTimestamp;
  if (spanMoved) {
    setSyncedSpanKey(spanKey);
    setCurrentTimestamp(currentTimestamp);
    setPlaybackStartMs(spanStartMs ?? playbackStartMs);
    setPlaybackEndMs(spanEndMs ?? playbackEndMs);
    setPlaying(autoPlay);
  }

  // Playback tick — same shape as MapPanel's own uncontrolled timer, lifted
  // here since this is now the single source of truth for the playhead.
  useEffect(() => {
    if (!playing || playbackEndMs <= playbackStartMs) return;
    const baseStep = Math.max(
      MIN_PLAYBACK_STEP_MS,
      Math.ceil((playbackEndMs - playbackStartMs) / PLAYBACK_FRAMES),
    );
    const step = baseStep * speed;
    const timer = window.setInterval(() => {
      setCurrentTimestamp((t) => {
        if (t >= playbackEndMs) {
          setPlaying(false);
          return playbackEndMs;
        }
        return Math.min(playbackEndMs, t + step);
      });
    }, PLAYBACK_TICK_MS);
    return () => window.clearInterval(timer);
  }, [playing, playbackStartMs, playbackEndMs, speed]);

  const playedFeatures = useMemo(() => playedSoFar(features, currentTimestamp), [features, currentTimestamp]);
  // One chain per event family, and only for the families a link line is
  // meaningful for — see `scopedLinkGroups`. The straight lines and the road
  // corridors are two renderings of exactly the same grouping.
  const linkGroups = useMemo(
    () => scopedLinkGroups(features, currentTimestamp),
    [features, currentTimestamp],
  );
  const timePaths = useMemo(
    () => scopedTimePaths(features, currentTimestamp),
    [features, currentTimestamp],
  );
  const {
    legs: flowLegs,
    unavailable: flowUnavailable,
    reason: flowReason,
  } = useFlowLegs(linkGroups, flowCorridorsEnabled);
  const clusters = useMemo(() => districtClusters(features, currentTimestamp), [features, currentTimestamp]);
  const density = useMemo(
    () => densityScore(features, currentTimestamp, data.totalDistrictsInScope),
    [features, currentTimestamp, data.totalDistrictsInScope],
  );
  const phenomena = useMemo(() => phenomenaSummary(clusters), [clusters]);

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
        onApply={local ? applyLive : apply}
        live={local}
        onReset={reset}
        pending={pending}
        footerNote={<SnapshotStatusNote snapshot={snapshot} />}
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

      <main className="min-w-0 flex-1 bg-abyss p-2 lg:overflow-auto">
        {!data.live && (
          <p className="fixed top-[calc(var(--nav-h)_+_8px)] right-3 z-50 max-w-[92vw] rounded border border-amber/40 bg-[#211808]/95 px-3 py-1.5 text-[11px] text-amber shadow-lg">
            {/* The docker hint is a local-development instruction, and naming
                MongoDB at all is a guess: `live` is false for any failed read,
                including a snapshot_cache that has never been built. Saying
                "cannot connect" on a hosted deployment cost a full debugging
                session chasing a connection that was answering in 280 ms. */}
            {isLocalDev ? (
              <>
                กำลังแสดงสถานะไม่มีข้อมูล — ยังเชื่อมต่อ MongoDB ไม่ได้ ให้รัน{" "}
                <code className="font-mono">docker compose up -d</code> แล้ว{" "}
                <code className="font-mono">npm run db:seed</code>
              </>
            ) : (
              <>กำลังแสดงสถานะไม่มีข้อมูล — ยังอ่านข้อมูลไม่ได้ในขณะนี้</>
            )}
          </p>
        )}

        <div className="grid grid-cols-1 gap-2 lg:h-full lg:min-h-[1162px] lg:grid-cols-[minmax(0,1fr)_clamp(300px,22vw,340px)] lg:grid-rows-[minmax(894px,3.5fr)_minmax(260px,1fr)]">
          <div className="grid grid-cols-1 gap-2 lg:min-h-0 lg:grid-rows-[82px_minmax(440px,1fr)_128px]">
            <EventsKpiRow data={data} playedCount={playedFeatures.length} density={density} />

            <MapPanel
              events={data.events}
              currentTimestamp={currentTimestamp}
              onTimestampChange={setCurrentTimestamp}
              playing={playing}
              onPlayingChange={setPlaying}
              onHoverFeature={setHoveredId}
              onSelectFeature={setSelectedId}
              timePaths={timePaths}
              clusters={clusters.map((c) => ({ lng: c.lng, lat: c.lat, tier: c.tier, label: c.district }))}
              flowLegs={flowLegs}
              flowCorridorsEnabled={flowCorridorsEnabled}
              onFlowCorridorsEnabledChange={setFlowCorridorsEnabled}
              flowUnavailable={flowUnavailable}
              flowReason={flowReason}
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

          <div className="grid grid-cols-1 gap-2 lg:col-span-2 lg:min-h-0 lg:grid-cols-3">
            <EventsTrendPanel data={data} currentTimestamp={currentTimestamp} />
            <RecentPlayedPanel played={playedFeatures} />
            <PhenomenaSummaryPanel insights={phenomena.insights} />
          </div>
        </div>
      </main>
    </>
  );
}
