"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Map, {
  AttributionControl,
  Layer,
  Popup,
  Source,
  type LayerProps,
  type MapLayerMouseEvent,
  type MapRef,
} from "react-map-gl/maplibre";
import type { DataDrivenPropertyValueSpecification, StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  IconBuildingCommunity,
  IconChevronDown,
  IconCurrentLocation,
  IconMap2,
  IconMinus,
  IconPlus,
  IconRoute,
  IconSatellite,
  IconStack2,
  IconTimeline,
} from "@tabler/icons-react";
import { AREA_DENSITY_SCALE } from "@/lib/palette";
import { scopedLinkGroups } from "@/lib/events-replay";
import { useFlowLegs } from "@/lib/flow/use-flow-legs";
import {
  FLOW_CORRIDOR_LAYER,
  FLOW_DIRECTION_LAYER,
  FLOW_UNAVAILABLE_LABEL,
  registerFlowArrowIcon,
  toFlowFeatureCollection,
} from "@/lib/flow/map-layers";
import {
  PREDICTION_ANCHOR_HIT_LAYER,
  PREDICTION_ANCHOR_LAYER,
  PREDICTION_CORRIDOR_HIT_LAYER,
  PREDICTION_CORRIDOR_LAYER,
  PREDICTION_SEGMENT_LAYER,
  PREDICTION_SELECTED_LAYER,
  PREDICTION_UNAVAILABLE_LABEL,
} from "@/lib/flow/prediction-layers";
import { useAnchorDetail, usePrediction } from "@/lib/flow/use-prediction";
import PredictionPanel from "./PredictionPanel";
import {
  SATELLITE_SOURCE_ID,
  SATELLITE_DEFAULT_ON,
  satelliteLayer,
  satelliteSource,
  setSatelliteBasemap,
  type BasemapFill,
} from "@/lib/basemap";
import type { FacilityMark } from "@/lib/facilities";
import { FacilityBadgeSprite } from "@/lib/map-facility-icons";
import {
  FACILITY_OVERLAY_ANCHOR_ID,
  FACILITY_OVERLAY_ANCHOR_LAYER,
  FacilityHoverPopupBody,
  FacilityLegend,
  FacilityOverlay,
  facilityHitLayers,
  facilityHref,
  facilityIndex,
  findFacilityHit,
  useFacilityBadges,
} from "@/lib/map-facility-layer";
import { useFacilities } from "@/lib/use-facilities";
import type { EventFeatureCollection } from "@/server/shared-events";
import type { AreaLevel, MapOverview } from "@/server/map-overview";

/**
 * The whole page is the map.
 *
 * Its one idea: **the unit of analysis follows the zoom.** Pulled back, the
 * question is which จังหวัด carries the weight; pushed in, it becomes which
 * ตำบล inside one อำเภอ does. Same encoding, same colour scale, three
 * resolutions — so moving between them is reading further into one picture
 * rather than switching charts.
 *
 * The dot layer is off by default and that is deliberate, not an oversight. At
 * four-province zoom a thousand points is a smear that says "the south"; the
 * choropleth is what actually answers "where". Dots become useful once you are
 * inside one อำเภอ, which is exactly where the toggle is worth reaching for.
 */

const BOUNDS: [[number, number], [number, number]] = [
  [99.95, 5.5],
  [102.2, 8.05],
];

const THAILAND_BOUNDS: [[number, number], [number, number]] = [
  [97.3, 5.5],
  [105.7, 20.5],
];

/** Keeps fitted geometry clear of the two overlay columns. */
/**
 * Room left for the furniture that sits on top of the map, so a fitted area
 * lands in the clear part of it rather than under the level picker.
 *
 * These are also a hazard: MapLibre cannot satisfy a fit whose padding is
 * wider than the container, and rather than clamping it gives up and leaves
 * the camera wherever it was — which on a phone meant opening `/map` to a view
 * of the whole world. The desktop numbers describe the desktop furniture
 * (190 px of controls on the left, a 268 px rail on the right); below `lg`
 * that furniture is a collapsed button and a bottom sheet, and the padding has
 * to describe *those* instead.
 */
const FIT_PADDING = { top: 16, bottom: 88, left: 190, right: 268 };
const FIT_PADDING_NARROW = { top: 56, bottom: 150, left: 12, right: 12 };

const DATA = {
  thailand: "/data/thailand-provinces.geojson",
  provinces: "/data/south-provinces.geojson",
  districts: "/data/south-districts.geojson",
  subdistricts: "/data/south-subdistricts.geojson",
};

/**
 * Where each level takes over when the level selector is on อัตโนมัติ.
 *
 * Chosen so a level appears at the zoom where its areas are big enough to
 * carry a colour: ตำบล at province zoom are a few pixels across and would
 * render as noise.
 */
const AUTO_BREAKS: { level: AreaLevel; minZoom: number }[] = [
  { level: "subdistrict", minZoom: 10.5 },
  { level: "district", minZoom: 8.2 },
  { level: "province", minZoom: 0 },
];

const LEVEL_META: Record<AreaLevel, { label: string; codeField: string; nameField: string; source: string }> = {
  province: { label: "จังหวัด", codeField: "province_code", nameField: "province_th", source: "provinces" },
  district: { label: "อำเภอ", codeField: "district_code", nameField: "district_th", source: "districts" },
  subdistrict: {
    label: "ตำบล",
    codeField: "subdistrict_code",
    nameField: "subdistrict_th",
    source: "subdistricts",
  },
};

const SATELLITE_FILLS: readonly BasemapFill[] = [
  { layer: "thailand-fill", plain: 0.85, satellite: 0 },
  { layer: "province-base", plain: 0.28, satellite: 0.06 },
];

function baseStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      thailand: { type: "geojson", data: DATA.thailand },
      provinces: { type: "geojson", data: DATA.provinces },
      districts: { type: "geojson", data: DATA.districts },
      [SATELLITE_SOURCE_ID]: satelliteSource(),
    },
    layers: [
      { id: "sea", type: "background", paint: { "background-color": "#04070e" } },
      satelliteLayer(),
      {
        id: "thailand-fill",
        type: "fill",
        source: "thailand",
        paint: { "fill-color": "#0a1826", "fill-opacity": 0.85 },
      },
      {
        id: "thailand-outline",
        type: "line",
        source: "thailand",
        paint: { "line-color": "#1e3a5c", "line-width": 0.4, "line-opacity": 0.8 },
      },
      // The land the choropleth is painted onto. Kept separate from the
      // density fill so an area with no events still reads as land rather
      // than as sea.
      {
        id: "province-base",
        type: "fill",
        source: "provinces",
        paint: { "fill-color": "#0d2136", "fill-opacity": 0.28 },
      },
      {
        id: "district-line",
        type: "line",
        source: "districts",
        minzoom: 8,
        paint: {
          "line-color": "#38bdf8",
          "line-width": 0.4,
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 8, 0, 9.5, 0.3],
        },
      },
      {
        id: "province-line",
        type: "line",
        source: "provinces",
        paint: { "line-color": "#38bdf8", "line-width": 1.2, "line-opacity": 0.85 },
      },

      // Draws nothing. The facility marks mount below it and every point, flow
      // and prediction layer above it, whatever order they finish loading in —
      // see `FACILITY_OVERLAY_ANCHOR_LAYER`. Above the choropleth, because a
      // pin lost inside a dark fill is a pin nobody finds.
      FACILITY_OVERLAY_ANCHOR_LAYER,
    ],
  };
}

/**
 * Count -> colour, as a MapLibre expression.
 *
 * The counts are baked into a `match` on the area code rather than joined
 * through `feature-state`: feature-state has to be set per feature after the
 * source loads, which means a frame where every area is unpainted and a second
 * pass on every filter change. A match expression arrives with the style.
 */
function densityColor(
  counts: Record<string, number>,
  max: number,
  codeField: string,
): DataDrivenPropertyValueSpecification<string> {
  const entries = Object.entries(counts);
  if (entries.length === 0) return "rgba(0,0,0,0)";

  // Equal-interval buckets over the observed range. Quantiles would even out
  // the colour distribution, but they would also make "twice as dark" stop
  // meaning "twice as many", which is the one thing this scale is for.
  const step = Math.max(1, max) / AREA_DENSITY_SCALE.length;
  const bucketed: Record<string, string[]> = {};
  for (const [code, n] of entries) {
    const index = Math.min(AREA_DENSITY_SCALE.length - 1, Math.floor((n - 0.0001) / step));
    (bucketed[AREA_DENSITY_SCALE[index]] ??= []).push(code);
  }

  const match: unknown[] = ["match", ["get", codeField]];
  for (const [color, codes] of Object.entries(bucketed)) {
    match.push(codes, color);
  }
  // Areas with no events fall through to fully transparent — see the note on
  // AREA_DENSITY_SCALE for why zero gets no step of its own.
  match.push("rgba(0,0,0,0)");
  return match as DataDrivenPropertyValueSpecification<string>;
}

interface AreaPopup {
  lng: number;
  lat: number;
  name: string;
  parent: string | null;
  n: number;
}

export default function MapWorkspace({
  data,
  eventsQuery,
}: {
  data: MapOverview;
  /** The page's own filter query string, so the points match what is shown. */
  eventsQuery: string;
}) {
  const router = useRouter();
  const mapRef = useRef<MapRef | null>(null);
  const [zoom, setZoom] = useState(7);
  const [manualLevel, setManualLevel] = useState<AreaLevel | "auto">("auto");
  const [showAreas, setShowAreas] = useState(true);
  const [showDots, setShowDots] = useState(false);
  const [showFlowCorridors, setShowFlowCorridors] = useState(false);
  /**
   * The two precomputed layers from the Bayesian model in `ml-server/`. Both
   * off by default and independent: the corridor layer is a claim about pairs
   * of districts, the segment layer is a summary over every pair, and reading
   * one on top of the other is usually reading neither.
   */
  const [showPrediction, setShowPrediction] = useState(false);
  const [showSegments, setShowSegments] = useState(false);
  /**
   * The response network, on by default and never filtered.
   *
   * The one layer on this page that does not answer to the query string: a
   * hospital does not stop existing because the analyst narrowed to one month
   * of one province, and the reason to look at it here is precisely to see
   * what sits near the areas the choropleth just darkened.
   */
  const [showFacilities, setShowFacilities] = useState(true);
  const [satellite, setSatellite] = useState(SATELLITE_DEFAULT_ON);
  const [ready, setReady] = useState(false);
  const [popup, setPopup] = useState<AreaPopup | null>(null);
  const [facilityHover, setFacilityHover] = useState<FacilityMark | null>(null);
  const [events, setEvents] = useState<EventFeatureCollection | null>(null);
  const [eventsError, setEventsError] = useState(false);
  /**
   * Two panels of furniture that are permanent fixtures on a 1440 px screen
   * would cover most of a phone. Below `lg` they collapse to their headers and
   * the reader opens the one they want; at `lg` the `lg:` classes below force
   * both open regardless of this state, so the analyst view is unchanged.
   */
  const [controlsOpen, setControlsOpen] = useState(false);
  const [rankedOpen, setRankedOpen] = useState(false);

  const mapStyle = useMemo(() => baseStyle(), []);

  const {
    facilities,
    loading: facilitiesLoading,
    failed: facilitiesFailed,
  } = useFacilities(showFacilities);
  const { spriteRef: facilitySpriteRef, badgesReady: facilityBadgesReady } = useFacilityBadges(
    mapRef,
    ready,
  );
  const facilityById = useMemo(() => facilityIndex(facilities), [facilities]);

  /**
   * Points are fetched the first time a layer that needs them is switched on,
   * never before — see `getMapEvents`. Kept afterwards, so toggling either
   * layer back and forth costs one request, not one per flip; the corridor
   * layer reads the same fetched set as the dots and neither waits on the
   * other.
   */
  useEffect(() => {
    if ((!showDots && !showFlowCorridors) || events) return;
    const controller = new AbortController();
    fetch(`/api/map/events?${eventsQuery}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((fc: EventFeatureCollection) => setEvents(fc))
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setEventsError(true);
      });
    return () => controller.abort();
  }, [showDots, showFlowCorridors, events, eventsQuery]);

  /**
   * The most recent events in the filtered set, chronologically and grouped by
   * family — the same "recent movement" window `/events` draws, anchored to
   * the latest matched event rather than to a playhead, because this page has
   * no scrubber. The fetched collection is not guaranteed sorted, and
   * `scopedLinkGroups`' binary search requires it.
   */
  const linkGroups = useMemo(() => {
    if (!showFlowCorridors || !events) return [];
    const sorted = [...events.features].sort((a, b) => a.properties.ts - b.properties.ts);
    const latest = sorted.at(-1);
    return latest ? scopedLinkGroups(sorted, latest.properties.ts) : [];
  }, [showFlowCorridors, events]);

  const {
    legs: flowLegs,
    unavailable: flowUnavailable,
    reason: flowReason,
  } = useFlowLegs(linkGroups, showFlowCorridors);

  const flowLegsData = useMemo(() => toFlowFeatureCollection(flowLegs), [flowLegs]);

  /**
   * The precomputed model, read out of MongoDB by `/api/flow/prediction`.
   * Fetched once, the first time either layer is switched on — it only changes
   * when the batch promotes a new run.
   */
  const wantsPrediction = showPrediction || showSegments;
  const { bundle: prediction, reason: predictionReason } = usePrediction(wantsPrediction);
  const predictionUnavailable = predictionReason !== null;
  const {
    detail: anchorDetail,
    loading: anchorLoading,
    select: selectAnchor,
    selectedId: selectedAnchorId,
  } = useAnchorDetail();

  const level: AreaLevel =
    manualLevel === "auto"
      ? (AUTO_BREAKS.find((b) => zoom >= b.minZoom)?.level ?? "province")
      : manualLevel;

  const meta = LEVEL_META[level];
  const counts = data.counts[level];
  const max = data.max[level];

  const fillColor = useMemo(
    () => densityColor(counts, max, meta.codeField),
    [counts, max, meta.codeField],
  );

  // ตำบล is the only level whose polygons are not already in the base style;
  // ~780 KB, so it is mounted only when that level is actually being drawn.
  const needsSubdistricts = level === "subdistrict";

  const areaLayer = useMemo<LayerProps>(
    () => ({
      id: "area-density",
      type: "fill",
      paint: { "fill-color": fillColor, "fill-opacity": showAreas ? 0.78 : 0 },
    }),
    [fillColor, showAreas],
  );

  /**
   * Anchor first, so it wins the hit test against the choropleth it sits on.
   * MapLibre returns features in layer order, and `handleClick` reads that
   * order as priority.
   */
  const interactiveLayerIds = useMemo(() => {
    const ids: string[] = [];
    if (showPrediction && prediction) ids.push(PREDICTION_ANCHOR_HIT_LAYER.id);
    if (showFacilities) ids.push(...facilityHitLayers(facilityBadgesReady));
    if (showAreas) ids.push("area-density");
    return ids;
  }, [showAreas, showPrediction, prediction, showFacilities, facilityBadgesReady]);

  const applySatellite = useCallback((next: boolean) => {
    const map = mapRef.current?.getMap();
    if (map) setSatelliteBasemap(map, next, SATELLITE_FILLS);
    setSatellite(next);
  }, []);

  const handleClick = useCallback(
    (e: MapLayerMouseEvent) => {
      // The anchor is tested before the choropleth beneath it: a click that
      // lands on both is a click on the smaller, deliberately-aimed target.
      const anchor = e.features?.find(
        (feature) => feature.layer.id === PREDICTION_ANCHOR_HIT_LAYER.id,
      );
      if (anchor) {
        const id = String((anchor.properties as Record<string, unknown>).anchor_id ?? "");
        if (id) {
          selectAnchor(id === selectedAnchorId ? null : id);
          setPopup(null);
          return;
        }
      }

      // Same rule one step down: a pin is a smaller, deliberately-aimed target
      // than the area it stands in.
      const facility = findFacilityHit(e.features, facilityById, facilityBadgesReady);
      if (facility) {
        setPopup(null);
        router.push(facilityHref(facility.id));
        return;
      }

      const f = e.features?.find((feature) => feature.layer.id === "area-density");
      if (!f) {
        setPopup(null);
        return;
      }
      const props = f.properties as Record<string, string>;
      const code = String(props[meta.codeField]);
      setPopup({
        lng: e.lngLat.lng,
        lat: e.lngLat.lat,
        name: String(props[meta.nameField]),
        parent:
          level === "subdistrict"
            ? `อ.${props.district_th}`
            : level === "district"
              ? `จ.${props.province_th}`
              : null,
        n: counts[code] ?? 0,
      });
    },
    [
      counts,
      level,
      meta.codeField,
      meta.nameField,
      facilityById,
      facilityBadgesReady,
      router,
      selectAnchor,
      selectedAnchorId,
    ],
  );

  /**
   * Frames one area from the extent the server sent with it.
   *
   * The controls that call this are disabled until `ready`: the ranked list is
   * server-rendered and readable immediately, but the map instance it steers
   * arrives later, and a row that silently does nothing when clicked is worse
   * than one that visibly cannot be clicked yet.
   */
  const flyTo = useCallback((bbox: [number, number, number, number]) => {
    const width = mapRef.current?.getMap().getContainer().clientWidth ?? 0;
    mapRef.current?.fitBounds(
      [
        [bbox[0], bbox[1]],
        [bbox[2], bbox[3]],
      ],
      {
        padding: width >= 1024 ? FIT_PADDING : FIT_PADDING_NARROW,
        maxZoom: 12.5,
        duration: 800,
      },
    );
  }, []);

  /**
   * Measured off the live container rather than a media query, because the
   * question is only ever "does this padding fit in this box".
   */
  const fitPadding = useCallback(() => {
    const width = mapRef.current?.getMap().getContainer().clientWidth ?? 0;
    return width >= 1024 ? FIT_PADDING : FIT_PADDING_NARROW;
  }, []);

  /**
   * The only hover this page has. The choropleth answers on click because its
   * targets are whole districts; a pin is small enough that hovering it is how
   * anyone asks what it is.
   */
  const handleMouseMove = useCallback(
    (e: MapLayerMouseEvent) => {
      const facility = findFacilityHit(e.features, facilityById, facilityBadgesReady);
      setFacilityHover((prev) => (prev?.id === facility?.id ? prev : facility));
    },
    [facilityById, facilityBadgesReady],
  );

  const nudgeZoom = (d: number) =>
    mapRef.current?.easeTo({ zoom: (mapRef.current.getZoom() ?? 7) + d });

  const scaleStops = useMemo(() => {
    const step = Math.max(1, max) / AREA_DENSITY_SCALE.length;
    return AREA_DENSITY_SCALE.map((color, i) => ({
      color,
      from: Math.floor(i * step) + 1,
      to: i === AREA_DENSITY_SCALE.length - 1 ? max : Math.floor((i + 1) * step),
    }));
  }, [max]);

  return (
    <div className="relative min-h-0 flex-1">
      {/* Off-screen source of the badge images — see `map-badges.tsx`. */}
      <FacilityBadgeSprite ref={facilitySpriteRef} />

      <Map
        ref={mapRef}
        initialViewState={{ bounds: BOUNDS, fitBoundsOptions: { padding: 16 } }}
        mapStyle={mapStyle}
        style={{ width: "100%", height: "100%" }}
        attributionControl={false}
        dragRotate={false}
        interactiveLayerIds={interactiveLayerIds}
        cursor={facilityHover || interactiveLayerIds.length > 0 ? "pointer" : undefined}
        onLoad={(e) => {
          setReady(true);
          e.target.fitBounds(BOUNDS, { padding: fitPadding(), duration: 0 });
          setZoom(e.target.getZoom());
          // The style declares the land fills at their plain opacity; with
          // imagery on from the start they have to be re-balanced once.
          setSatelliteBasemap(e.target, satellite, SATELLITE_FILLS);
          registerFlowArrowIcon(e.target);
        }}
        onZoomEnd={(e) => setZoom(e.viewState.zoom)}
        onClick={handleClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setFacilityHover(null)}
        onError={(e) => console.error("[maplibre]", e.error?.message ?? String(e))}
      >
        <AttributionControl compact position="bottom-right" />

        {needsSubdistricts && (
          <Source id="subdistricts" type="geojson" data={DATA.subdistricts}>
            <Layer {...areaLayer} beforeId="district-line" />
          </Source>
        )}
        {level === "district" && (
          <Source id="district-fill" type="geojson" data={DATA.districts}>
            <Layer {...areaLayer} beforeId="district-line" />
          </Source>
        )}
        {level === "province" && (
          <Source id="province-fill" type="geojson" data={DATA.provinces}>
            <Layer {...areaLayer} beforeId="district-line" />
          </Source>
        )}

        {/* Above the choropleth, below the dots — see the anchor layer. */}
        {showFacilities && (
          <FacilityOverlay
            facilities={facilities}
            badgesReady={facilityBadgesReady}
            beforeId={FACILITY_OVERLAY_ANCHOR_ID}
          />
        )}

        {showDots && events && (
          <Source id="events" type="geojson" data={events}>
            <Layer
              id="event-dot"
              type="circle"
              paint={{
                "circle-color": ["get", "color"],
                "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 1.6, 13, 4.5],
                "circle-opacity": 0.9,
                "circle-stroke-color": "#04070e",
                "circle-stroke-width": 0.4,
              }}
            />
          </Source>
        )}

        {showFlowCorridors && (
          <Source id="flow-legs" type="geojson" data={flowLegsData}>
            <Layer {...FLOW_CORRIDOR_LAYER} />
            <Layer {...FLOW_DIRECTION_LAYER} />
          </Source>
        )}

        {/* Model output, drawn beneath the event dots: it is a summary of the
            corpus, and the dots are the corpus. */}
        {showSegments && prediction && (
          <Source id="prediction-segments" type="geojson" data={prediction.segments}>
            <Layer {...PREDICTION_SEGMENT_LAYER} />
          </Source>
        )}

        {showPrediction && prediction && (
          <>
            <Source id="prediction-corridors" type="geojson" data={prediction.corridors}>
              <Layer {...PREDICTION_CORRIDOR_LAYER} />
              <Layer {...PREDICTION_CORRIDOR_HIT_LAYER} />
            </Source>

            {/* The selected anchor's own corridors, including the alternatives
                the overview layer leaves out. */}
            {anchorDetail && (
              <Source id="prediction-selected" type="geojson" data={anchorDetail.corridors}>
                <Layer {...PREDICTION_SELECTED_LAYER} />
              </Source>
            )}

            <Source id="prediction-anchors" type="geojson" data={prediction.anchors}>
              <Layer {...PREDICTION_ANCHOR_LAYER} />
              <Layer {...PREDICTION_ANCHOR_HIT_LAYER} />
            </Source>
          </>
        )}

        {facilityHover && (
          <Popup
            longitude={facilityHover.lng}
            latitude={facilityHover.lat}
            closeButton={false}
            closeOnClick={false}
            className="palantir-popup"
            offset={12}
          >
            <FacilityHoverPopupBody facility={facilityHover} action="คลิกเพื่อเปิดหน้าเครือข่าย" />
          </Popup>
        )}

        {popup && (
          <Popup
            longitude={popup.lng}
            latitude={popup.lat}
            closeButton={false}
            className="palantir-popup"
            offset={8}
            onClose={() => setPopup(null)}
          >
            <div className="pp-title">
              {popup.name}
              {popup.parent ? ` · ${popup.parent}` : ""}
            </div>
            <div className="pp-row">
              <span>เหตุการณ์</span>
              <b>{popup.n.toLocaleString("en-US")}</b>
            </div>
          </Popup>
        )}
      </Map>

      <div className="pointer-events-none absolute inset-0">
        {/* Level + layers */}
        {/* Above the reading rail: on a phone the open controls card and the
            bottom sheet occupy the same band, and without this the sheet — later
            in the DOM — paints over the layer list the reader just opened. */}
        <div className="pointer-events-auto absolute top-2.5 left-2 z-10 flex w-[178px] flex-col gap-1.5 lg:left-3">
          <button
            type="button"
            onClick={() => setControlsOpen((v) => !v)}
            aria-expanded={controlsOpen}
            className="flex min-h-10 w-full items-center gap-1.5 rounded border border-[rgba(56,100,150,0.5)] bg-[rgba(6,13,25,0.9)] px-2.5 text-[12.5px] text-ink-dim lg:hidden"
          >
            <IconStack2 size={15} stroke={1.7} />
            ตัวเลือกแผนที่
            <IconChevronDown
              size={14}
              stroke={2}
              className={`ml-auto transition-transform ${controlsOpen ? "rotate-180" : ""}`}
            />
          </button>

          <div
            className={`rounded border border-[rgba(56,100,150,0.5)] bg-[rgba(6,13,25,0.9)] p-2.5 lg:block ${
              controlsOpen ? "block" : "hidden"
            }`}
          >
          <p className="mb-1.5 text-[11.5px] font-semibold text-ink">หน่วยพื้นที่</p>
          <div className="mb-2 flex flex-col gap-0.5">
            {(["auto", "province", "district", "subdistrict"] as const).map((option) => {
              const active = manualLevel === option;
              const label =
                option === "auto"
                  ? `อัตโนมัติ (${LEVEL_META[level].label})`
                  : LEVEL_META[option].label;
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => setManualLevel(option)}
                  className={
                    active
                      ? "rounded bg-azure px-2 py-1 text-left text-[11px] font-medium text-[#04070e]"
                      : "rounded px-2 py-1 text-left text-[11px] text-ink-dim hover:bg-[rgba(56,189,248,0.1)] hover:text-ink"
                  }
                >
                  {label}
                </button>
              );
            })}
          </div>

          <p className="mb-1 text-[11.5px] font-semibold text-ink">ชั้นข้อมูล</p>
          <Toggle checked={showAreas} onChange={() => setShowAreas((v) => !v)} label="ความหนาแน่นรายพื้นที่" />
          <Toggle
            checked={showDots}
            onChange={() => setShowDots((v) => !v)}
            label={
              showDots && !events && !eventsError
                ? "จุดเหตุการณ์ (กำลังโหลด…)"
                : eventsError
                  ? "จุดเหตุการณ์ (โหลดไม่สำเร็จ)"
                  : "จุดเหตุการณ์"
            }
          />
          <Toggle
            checked={showFacilities}
            onChange={() => setShowFacilities((v) => !v)}
            label={
              facilitiesLoading
                ? "หน่วยงาน/เครือข่าย (กำลังโหลด…)"
                : facilitiesFailed
                  ? "หน่วยงาน/เครือข่าย (โหลดไม่สำเร็จ)"
                  : "หน่วยงาน/เครือข่าย"
            }
            icon={<IconBuildingCommunity size={12} stroke={1.7} />}
            title="ด่านตรวจ ตำรวจ กู้ภัย ดับเพลิง ศูนย์อพยพ และโรงพยาบาล — แสดงทั้งหมดเสมอ ไม่ขึ้นกับตัวกรองเหตุการณ์"
          />
          <Toggle
            checked={showFlowCorridors && !flowUnavailable}
            onChange={() => setShowFlowCorridors((v) => !v)}
            label="เส้นทางตามถนนจริง (ล่าสุด)"
            icon={<IconRoute size={12} stroke={1.7} />}
            disabled={flowUnavailable}
            title={
              flowReason
                ? FLOW_UNAVAILABLE_LABEL[flowReason]
                : "เส้นทางบนโครงข่ายถนนจริงระหว่างเหตุการณ์ล่าสุดในกลุ่มเดียวกัน — เหตุรุนแรง กิจกรรมกลุ่ม ยาเสพติด อาชญากรรม (ทดลอง)"
            }
          />
          <Toggle
            checked={showPrediction && !predictionUnavailable}
            onChange={() => setShowPrediction((v) => !v)}
            label="ช่องทางคาดการณ์ (Bayesian)"
            icon={<IconRoute size={12} stroke={1.7} />}
            disabled={predictionUnavailable}
            title={
              predictionReason
                ? PREDICTION_UNAVAILABLE_LABEL[predictionReason]
                : "ช่องทางที่เหตุการณ์เชื่อมโยงกันตามถนน คำนวณล่วงหน้าจากทั้งคลังข้อมูล"
            }
          />
          <Toggle
            checked={showSegments && !predictionUnavailable}
            onChange={() => setShowSegments((v) => !v)}
            label="ความถี่การใช้ถนน"
            icon={<IconTimeline size={12} stroke={1.7} />}
            disabled={predictionUnavailable}
            title={
              predictionReason
                ? PREDICTION_UNAVAILABLE_LABEL[predictionReason]
                : "ถนนเส้นที่ถูกเชื่อมโยงซ้ำบ่อยที่สุด ถ่วงด้วย posterior ของแต่ละช่องทาง"
            }
          />
          <Toggle
            checked={satellite}
            onChange={() => applySatellite(!satellite)}
            label="ภาพถ่ายดาวเทียม"
            icon={<IconSatellite size={12} stroke={1.7} />}
            disabled={!ready}
          />
          </div>
        </div>

        {/* Zoom + framing. Bottom-left is where a mouse expects them and where
            the mobile ranked sheet needs the room, so on a phone they move to
            the free edge instead. */}
        <div className="pointer-events-auto absolute top-2.5 right-2 flex flex-col gap-1.5 lg:top-auto lg:right-auto lg:bottom-6 lg:left-3">
          <div className="flex flex-col overflow-hidden rounded border border-[rgba(56,100,150,0.5)] bg-[rgba(6,13,25,0.85)]">
            <button
              type="button"
              aria-label="ขยาย"
            disabled={!ready}
              onClick={() => nudgeZoom(0.6)}
              className="px-1.5 py-1 text-ink-dim hover:bg-[rgba(56,189,248,0.12)] hover:text-ink"
            >
              <IconPlus size={14} stroke={2} />
            </button>
            <button
              type="button"
              aria-label="ย่อ"
            disabled={!ready}
              onClick={() => nudgeZoom(-0.6)}
              className="border-t border-[rgba(56,100,150,0.4)] px-1.5 py-1 text-ink-dim hover:bg-[rgba(56,189,248,0.12)] hover:text-ink"
            >
              <IconMinus size={14} stroke={2} />
            </button>
          </div>
          <button
            type="button"
            aria-label="โฟกัส 4 จังหวัดชายแดนใต้"
            disabled={!ready}
            title="โฟกัส 4 จังหวัดชายแดนใต้"
            onClick={() => mapRef.current?.fitBounds(BOUNDS, { padding: fitPadding() })}
            className="rounded border border-[rgba(56,100,150,0.5)] bg-[rgba(6,13,25,0.85)] px-1.5 py-1 text-ink-dim hover:text-ink"
          >
            <IconCurrentLocation size={14} stroke={1.8} />
          </button>
          <button
            type="button"
            aria-label="ดูทั้งประเทศ"
            disabled={!ready}
            title="ดูทั้งประเทศ"
            onClick={() => mapRef.current?.fitBounds(THAILAND_BOUNDS, { padding: fitPadding() })}
            className="rounded border border-[rgba(56,100,150,0.5)] bg-[rgba(6,13,25,0.85)] px-1.5 py-1 text-ink-dim hover:text-ink"
          >
            <IconMap2 size={14} stroke={1.8} />
          </button>
        </div>

        {/* The reading rail: ranked areas, and the model panel under them when
            it is on. Both belong on this side — the left column is controls,
            and it has no room for a panel once the layer list is in it. The
            ranked list yields the height, because it scrolls and the model
            panel does not. */}
        <div
          className={`pointer-events-auto absolute inset-x-2 flex flex-col gap-1.5 overflow-hidden lg:inset-x-auto lg:top-2.5 lg:right-2.5 lg:bottom-auto lg:max-h-[calc(100%-1.25rem)] lg:w-[254px] ${
            // With the model panel in it the sheet has to grow, and it has to
            // clear MapLibre's attribution — which wraps to two lines on a
            // narrow screen. At 42vh and `bottom-9` the panel's caveat is the
            // first thing lost, and that is the one thing that must not be.
            wantsPrediction && prediction
              ? "bottom-16 max-h-[68vh] lg:bottom-auto"
              : "bottom-9 max-h-[42vh]"
          }`}
        >
        {/* Collapsed on a phone, this is just its own header, so it must not
            claim the sheet's free space — the panel below needs it. At `lg` the
            list is always open and takes the slack instead. */}
        <div
          className={`flex flex-col rounded border border-[rgba(56,100,150,0.5)] bg-[rgba(6,13,25,0.9)] lg:min-h-0 lg:flex-1 ${
            rankedOpen ? "min-h-0 flex-1" : "shrink-0"
          }`}
        >
          <div className="flex items-center gap-2 border-b border-[rgba(37,66,102,0.6)] px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-[11.5px] font-semibold text-ink">
                {meta.label}ที่มีเหตุการณ์มากที่สุด
              </p>
              <p className="num text-[10px] text-ink-muted">
                {data.touched[level].toLocaleString("en-US")} {meta.label}มีเหตุการณ์ ·{" "}
                {data.totals.placed.toLocaleString("en-US")} จุด
              </p>
            </div>
            <button
              type="button"
              onClick={() => setRankedOpen((v) => !v)}
              aria-expanded={rankedOpen}
              aria-label="สลับรายการอันดับพื้นที่"
              className="-mr-1 flex h-9 w-9 shrink-0 items-center justify-center text-ink-muted lg:hidden"
            >
              <IconChevronDown
                size={18}
                stroke={2}
                className={`transition-transform ${rankedOpen ? "rotate-180" : ""}`}
              />
            </button>
          </div>

          <ul className={`min-h-0 flex-1 overflow-y-auto lg:block ${rankedOpen ? "block" : "hidden"}`}>
            {data.top[level].map((row) => (
              <li key={row.code}>
                <button
                  type="button"
                  onClick={() => flyTo(row.bbox)}
                  disabled={!ready}
                  className="flex min-h-10 w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-[rgba(56,189,248,0.08)] disabled:cursor-default disabled:hover:bg-transparent lg:min-h-0"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11.5px] text-ink">{row.name}</span>
                    {row.parent && (
                      <span className="block truncate text-[10px] text-ink-muted">{row.parent}</span>
                    )}
                  </span>
                  {/* A bar, not just a number: rank is the question here, and a
                      column of digits makes the reader do the comparing. */}
                  <span className="flex w-[64px] shrink-0 items-center gap-1.5">
                    <span className="h-1.5 flex-1 overflow-hidden rounded-[1px] bg-[rgba(56,100,150,0.25)]">
                      <span
                        className="block h-full rounded-[1px]"
                        style={{
                          width: `${max ? Math.max(6, (row.n / max) * 100) : 0}%`,
                          background: AREA_DENSITY_SCALE[AREA_DENSITY_SCALE.length - 2],
                        }}
                      />
                    </span>
                    <span className="num w-[28px] text-right text-[10.5px] text-ink-dim">
                      {row.n.toLocaleString("en-US")}
                    </span>
                  </span>
                </button>
              </li>
            ))}
            {data.top[level].length === 0 && (
              <li className="px-3 py-3 text-[11px] text-ink-muted">
                ไม่มีเหตุการณ์ที่ตรงกับตัวกรองในช่วงเวลานี้
              </li>
            )}
          </ul>

          {/* Scale */}
          <div
            className={`border-t border-[rgba(37,66,102,0.6)] px-3 py-2 lg:block ${
              rankedOpen ? "block" : "hidden"
            }`}
          >
            <p className="mb-1 text-[10px] text-ink-muted">จำนวนเหตุการณ์ต่อ{meta.label}</p>
            <div className="flex items-center gap-1.5">
              <div className="flex flex-1 overflow-hidden rounded-[2px]">
                {scaleStops.map((stop) => (
                  <span
                    key={stop.color}
                    title={`${stop.from}–${stop.to}`}
                    className="h-2 flex-1"
                    style={{ background: stop.color }}
                  />
                ))}
              </div>
            </div>
            <div className="num mt-0.5 flex justify-between text-[9.5px] text-ink-muted">
              <span>1</span>
              <span>{max.toLocaleString("en-US")}</span>
            </div>
            <p className="mt-1 text-[9.5px] leading-relaxed text-ink-muted">
              พื้นที่ที่ไม่มีเหตุการณ์จะไม่ถูกระบายสี
            </p>
          </div>
        </div>

        {wantsPrediction && prediction && (
          <PredictionPanel
            bundle={prediction}
            forecast={anchorDetail?.forecast ?? null}
            forecastLoading={anchorLoading}
            onClearSelection={() => selectAnchor(null)}
          />
        )}
        </div>

        {/* Provenance + what is not on the map */}
        {showFacilities && (
          <FacilityLegend variant="floating" positionClass="right-[272px] bottom-8" />
        )}

        <p className="absolute inset-x-2 bottom-1.5 flex flex-wrap items-center justify-center gap-x-2 text-center text-[9.5px] text-ink-muted lg:inset-x-auto lg:bottom-2 lg:left-1/2 lg:-translate-x-1/2 lg:flex-nowrap lg:whitespace-nowrap">
          <span>ขอบเขตการปกครอง: กรมป้องกันและบรรเทาสาธารณภัย (DDPM)</span>
          {data.totals.unplaced > 0 && (
            <>
              <span className="text-ink-muted/50">·</span>
              {/* Stated, not hidden: these events matched the filters and are
                  counted nowhere on this page. */}
              <span className="text-amber">
                <span className="num">{data.totals.unplaced.toLocaleString("en-US")}</span>{" "}
                เหตุการณ์ไม่มีพิกัด จึงไม่ปรากฏบนแผนที่
              </span>
            </>
          )}
          {data.totals.offArea > 0 && (
            <>
              <span className="text-ink-muted/50">·</span>
              <span className="text-amber">
                <span className="num">{data.totals.offArea.toLocaleString("en-US")}</span>{" "}
                จุดอยู่นอกเขต 4 จังหวัด
              </span>
            </>
          )}
        </p>
      </div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  icon,
  disabled,
  title,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <label
      title={title}
      className={`flex items-center gap-2 py-[3px] text-[11px] ${
        disabled ? "text-ink-muted opacity-60" : "cursor-pointer text-ink-dim hover:text-ink"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="h-3.5 w-3.5 shrink-0 appearance-none rounded-[3px] border border-[rgba(90,140,190,0.7)] bg-transparent checked:border-azure checked:bg-azure checked:after:block checked:after:text-[10px] checked:after:leading-[13px] checked:after:font-bold checked:after:text-[#04070e] checked:after:content-['✓']"
      />
      <span className="flex items-center gap-1.5">
        {icon}
        {label}
      </span>
    </label>
  );
}
