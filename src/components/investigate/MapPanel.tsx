"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Map, {
  AttributionControl,
  Layer,
  Popup,
  Source,
  type LayerProps,
  type MapLayerMouseEvent,
  type MapRef,
} from "react-map-gl/maplibre";
import type { ExpressionSpecification, StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  IconChevronDown,
  IconCurrentLocation,
  IconMap2,
  IconMinus,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlus,
  IconRoute,
  IconSatellite,
  IconStack2,
} from "@tabler/icons-react";
import { EVENT_COLOR } from "@/lib/palette";
import type { FlowLeg } from "@/lib/flow/types";
import {
  FLOW_CORRIDOR_LAYER,
  FLOW_DIRECTION_LAYER,
  FLOW_UNAVAILABLE_LABEL,
  registerFlowArrowIcon,
  toFlowFeatureCollection,
} from "@/lib/flow/map-layers";
import type { FlowUnavailableReason } from "@/lib/flow/use-flow-legs";
import {
  SATELLITE_DEFAULT_ON,
  SATELLITE_SOURCE_ID,
  satelliteLayer,
  satelliteSource,
  setSatelliteBasemap,
  type BasemapFill,
} from "@/lib/basemap";
import { EVENT_FAMILY_LABEL, EVENT_TYPE_LABEL } from "@/lib/labels";
import { EVENT_FAMILIES, typesInFamily } from "@/lib/types";
import type { EventFeatureCollection } from "@/server/investigate";

/**
 * Investigation map.
 *
 * Boundaries are authoritative DOPA polygons fetched by
 * scripts/fetch-boundaries.ts — not drawn by hand. MapLibre renders them and
 * the event layer through WebGL, so the event count is bounded by the GPU
 * rather than by the DOM.
 *
 * Composed with react-map-gl, which is what lets the layers be declared rather
 * than assembled: the replay filter, the view switcher and the optional
 * time-path and cluster overlays are now props on a `<Layer>` instead of five
 * effects reaching into a map instance after it loads. The popups are ordinary
 * JSX for the same reason, which also retires the hand-rolled HTML escaping
 * they used to need.
 *
 * The imagery basemap is still applied imperatively through the map ref — see
 * lib/basemap.ts. It has to change paint on layers that belong to the base
 * style rather than to this tree, and MapLibre's own setPaintProperty is the
 * honest way to do that; re-issuing the whole style object on every toggle
 * would make MapLibre diff (or worse, reload) a style that has not changed.
 */

/** Fitted to the four provinces, with room for the legend overlay. */
const BOUNDS: [[number, number], [number, number]] = [
  [99.95, 5.5],
  [102.2, 8.05],
];

/** Whole of Thailand, for the pull-back view. */
const THAILAND_BOUNDS: [[number, number], [number, number]] = [
  [97.3, 5.5],
  [105.7, 20.5],
];

/**
 * Keeps fitted geometry clear of the overlays: the legend on the right and the
 * timeline scrubber along the bottom. Without the bottom inset the four focus
 * provinces land directly behind the scrubber at national zoom.
 */
const FIT_PADDING = { top: 14, bottom: 74, left: 16, right: 170 };

const SOUTH = {
  provinces: "/data/south-provinces.geojson",
  districts: "/data/south-districts.geojson",
  subdistricts: "/data/south-subdistricts.geojson",
  villages: "/data/south-villages.geojson",
};

/**
 * Zoom at which the two finest levels are worth their download.
 *
 * ตำบล is ~780 KB and หมู่บ้าน ~200 KB — together more than every other layer
 * on this map combined, and both are illegible at province zoom. The sources
 * are mounted (which is what fetches them) only once the view is close enough
 * for them to mean something, and stay mounted afterwards so panning around at
 * detail zoom does not re-fetch.
 */
const DETAIL_MIN_ZOOM = 10;
/** The other 73 provinces, drawn dim so the focus area sits inside the country. */
const THAILAND = "/data/thailand-provinces.geojson";

/**
 * Every category the dots can take, grouped under its family.
 *
 * It used to be seven hand-picked types, which was already a legend that could
 * not explain three of the colours on the map. At seventeen that is no longer
 * a defensible shortcut: the family heading is what makes a long list readable
 * — the eye finds "ภัยพิบัติธรรมชาติ" first and the exact hazard second.
 */
const LEGEND = EVENT_FAMILIES.map((family) => ({
  family,
  label: EVENT_FAMILY_LABEL[family],
  types: typesInFamily(family).map((t) => ({ type: t, label: EVENT_TYPE_LABEL[t], color: EVENT_COLOR[t] })),
}));

const VIEWS = ["แผนที่", "ความหนาแน่น", "ไฮบริด"] as const;
type View = (typeof VIEWS)[number];

/** Colour ramp shared by the heatmap layer. */
const HEAT_RAMP: ExpressionSpecification = [
  "interpolate", ["linear"], ["heatmap-density"],
  0, "rgba(0,0,0,0)",
  0.2, "rgba(14,165,233,0.45)",
  0.4, "rgba(34,211,238,0.6)",
  0.6, "rgba(251,191,36,0.75)",
  0.8, "rgba(249,115,22,0.85)",
  1, "rgba(239,68,68,0.95)",
];

/**
 * Land/sea separation for the plain basemap. Named because the satellite
 * toggle has to put them back, and a second literal copy of the ramp is
 * exactly the kind of thing that drifts.
 */
const THAILAND_FILL_OPACITY = 0.85;
const PROVINCE_FILL_OPACITY: ExpressionSpecification = [
  "interpolate", ["linear"], ["zoom"],
  4, 0.85,
  8, 0.5,
  11, 0.35,
];

/**
 * Over imagery the dark landmass is dropped entirely and the focus tint is cut
 * to a wash — just enough to keep the four provinces distinguishable from the
 * rest of the country, without burying what the imagery is being consulted for.
 */
const SATELLITE_FILLS: readonly BasemapFill[] = [
  { layer: "thailand-fill", plain: THAILAND_FILL_OPACITY, satellite: 0 },
  { layer: "province-fill", plain: PROVINCE_FILL_OPACITY, satellite: 0.12 },
];

function baseStyle(): StyleSpecification {
  return {
    version: 8,
    // No `glyphs` key on purpose: the style has no symbol layers, so no font
    // stack is needed. Setting it to undefined is not the same as omitting it
    // — MapLibre validates the key and rejects the entire style if present but
    // not a string, which silently leaves the canvas blank.
    sources: {
      thailand: { type: "geojson", data: THAILAND },
      provinces: { type: "geojson", data: SOUTH.provinces, generateId: true },
      districts: { type: "geojson", data: SOUTH.districts },
      [SATELLITE_SOURCE_ID]: satelliteSource(),
    },
    layers: [
      { id: "sea", type: "background", paint: { "background-color": "#04070e" } },
      // Hidden by default; see lib/basemap.ts. Sits here so every outline,
      // heatmap and marker below still draws on top of the imagery.
      satelliteLayer(),

      // National context: present but deliberately recessive, so the eye still
      // lands on the four provinces under investigation.
      {
        id: "thailand-fill",
        type: "fill",
        source: "thailand",
        paint: { "fill-color": "#0a1826", "fill-opacity": THAILAND_FILL_OPACITY },
      },
      {
        id: "thailand-outline",
        type: "line",
        source: "thailand",
        paint: {
          "line-color": "#1e3a5c",
          "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.3, 10, 0.7],
          "line-opacity": 0.8,
        },
      },

      {
        id: "province-fill",
        type: "fill",
        source: "provinces",
        paint: {
          "fill-color": "#12507f",
          // Brighter when zoomed out, where the area is small and needs to be
          // picked out of the country; calmer once it fills the viewport.
          "fill-opacity": PROVINCE_FILL_OPACITY,
        },
      },
      {
        id: "district-outline",
        type: "line",
        source: "districts",
        // Only meaningful once the user has zoomed past province level.
        minzoom: 8.2,
        paint: {
          "line-color": "#38bdf8",
          "line-width": 0.5,
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 8.2, 0, 9.5, 0.45],
        },
      },
      // Soft halo under the focus outline. At national zoom the four provinces
      // are only a few pixels across, so a hairline alone would disappear —
      // this is what makes the focus area findable when zoomed out.
      {
        id: "province-glow",
        type: "line",
        source: "provinces",
        paint: {
          "line-color": "#38bdf8",
          "line-width": ["interpolate", ["linear"], ["zoom"], 4, 7, 7, 9, 11, 12],
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0.3, 8, 0.16, 11, 0.08],
          "line-blur": ["interpolate", ["linear"], ["zoom"], 4, 5, 11, 9],
        },
      },
      {
        id: "province-outline",
        type: "line",
        source: "provinces",
        paint: {
          "line-color": "#38bdf8",
          "line-width": ["interpolate", ["linear"], ["zoom"], 4, 1.4, 6, 1.6, 10, 2],
          "line-opacity": 0.95,
        },
      },
    ],
  };
}

/**
 * The event layers, as plain specs.
 *
 * Declared at module scope so they are identical objects on every render —
 * `<Layer>` diffs its props, and rebuilding these inline would ask MapLibre to
 * re-evaluate every paint expression each time the parent re-renders. Only
 * `filter` and `layout.visibility` change at runtime, and both are passed in
 * as props at the call site.
 */
const HEAT_LAYER = {
  id: "events-heat",
  type: "heatmap",
  maxzoom: 12,
  paint: {
    // Weight by severity so a critical incident counts for more than a
    // routine one, instead of every point contributing equally.
    "heatmap-weight": ["interpolate", ["linear"], ["get", "severity"], 1, 0.25, 5, 1],
    "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 6, 0.7, 12, 2.4],
    "heatmap-color": HEAT_RAMP,
    "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 6, 14, 12, 42],
    "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 10, 0.85, 12, 0.35],
  },
} satisfies LayerProps;

// Positional uncertainty: a district centroid must not read like a GPS fix, so
// the halo is sized from precision_m in real metres.
const UNCERTAINTY_LAYER = {
  id: "events-uncertainty",
  type: "circle",
  minzoom: 9,
  paint: {
    "circle-color": ["get", "color"],
    "circle-opacity": 0.07,
    "circle-stroke-color": ["get", "color"],
    "circle-stroke-opacity": 0.22,
    "circle-stroke-width": 0.6,
    // metres -> pixels at this latitude, per MapLibre's zoom scaling.
    "circle-radius": [
      "interpolate", ["exponential", 2], ["zoom"],
      9, ["/", ["get", "precision_m"], 120],
      14, ["/", ["get", "precision_m"], 4],
    ],
  },
} satisfies LayerProps;

const POINT_LAYER = {
  id: "events-point",
  type: "circle",
  paint: {
    "circle-color": ["get", "color"],
    "circle-radius": [
      "interpolate", ["linear"], ["zoom"],
      6, ["interpolate", ["linear"], ["get", "severity"], 1, 2, 5, 4.5],
      12, ["interpolate", ["linear"], ["get", "severity"], 1, 5, 5, 11],
    ],
    "circle-opacity": ["interpolate", ["linear"], ["get", "severity"], 1, 0.6, 5, 0.95],
    "circle-stroke-color": "#ffffff",
    "circle-stroke-width": ["interpolate", ["linear"], ["get", "severity"], 3, 0, 5, 0.8],
    "circle-stroke-opacity": 0.7,
  },
} satisfies LayerProps;

const TIME_PATH_LAYER = {
  id: "time-path-line",
  type: "line",
  paint: {
    "line-color": "#38bdf8",
    "line-width": 1.6,
    "line-dasharray": [2, 1.6],
    "line-opacity": 0.85,
  },
} satisfies LayerProps;

const CLUSTER_GLOW_LAYER = {
  id: "clusters-glow",
  type: "circle",
  paint: {
    "circle-color": ["match", ["get", "tier"], "high", "#ef4444", "#f59e0b"],
    "circle-radius": ["match", ["get", "tier"], "high", 26, 20],
    "circle-opacity": 0.16,
    "circle-blur": 0.9,
  },
} satisfies LayerProps;

const CLUSTER_RING_LAYER = {
  id: "clusters-ring",
  type: "circle",
  paint: {
    "circle-color": "transparent",
    "circle-radius": ["match", ["get", "tier"], "high", 7, 5.5],
    "circle-stroke-color": ["match", ["get", "tier"], "high", "#ef4444", "#f59e0b"],
    "circle-stroke-width": 1.6,
  },
} satisfies LayerProps;

const SUBDISTRICT_OUTLINE_LAYER = {
  id: "subdistrict-outline",
  type: "line",
  minzoom: DETAIL_MIN_ZOOM,
  paint: {
    "line-color": "#7dd3fc",
    "line-width": 0.4,
    // Sits below the อำเภอ line in weight at every zoom, so the hierarchy of
    // จังหวัด > อำเภอ > ตำบล stays readable rather than becoming a mesh.
    "line-opacity": ["interpolate", ["linear"], ["zoom"], 10, 0, 11.5, 0.3],
  },
} satisfies LayerProps;

/** หมู่บ้าน as dots — no labels, because no style here declares `glyphs`. */
const VILLAGE_LAYER = {
  id: "village-point",
  type: "circle",
  minzoom: 11,
  paint: {
    "circle-color": "#e2f2ff",
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 1.2, 15, 2.6],
    "circle-opacity": ["interpolate", ["linear"], ["zoom"], 11, 0.3, 14, 0.75],
  },
} satisfies LayerProps;

/** The two layers a click or hover is allowed to hit. */
const INTERACTIVE_LAYERS = ["events-point", "province-fill"];

/** What a hovered event dot needs to draw its popup. */
interface HoverInfo {
  lng: number;
  lat: number;
  props: Record<string, string | number>;
}

interface BoundaryInfo {
  lng: number;
  lat: number;
  nameTh: string;
  nameEn: string;
  code: string;
}

export interface MapCluster {
  lng: number;
  lat: number;
  tier: "high" | "medium";
  label: string;
}

interface MapPanelProps {
  events: EventFeatureCollection;
  /**
   * Controlled-mode playhead. When both `currentTimestamp` and
   * `onTimestampChange` are supplied, this component drives its layers off
   * the parent's state instead of its own, and hides its bottom scrubber bar
   * (the parent owns the only playhead UI — `/events`'s dedicated Timeline
   * panel). Omit both, as `/investigate` does today, and MapPanel is exactly
   * as self-contained as before.
   */
  currentTimestamp?: number;
  onTimestampChange?: (ts: number) => void;
  playing?: boolean;
  onPlayingChange?: (playing: boolean) => void;
  /** Fires on hover/unhover of a point — lets a sibling panel track it. */
  onHoverFeature?: (id: string | null) => void;
  /** Fires on click of a point. */
  onSelectFeature?: (id: string | null) => void;
  /** A short, already-scoped recent-movement line — see `scopedTimePath`. */
  timePath?: [number, number][];
  /** Statistically-significant district clusters — see `districtClusters`. */
  clusters?: MapCluster[];
  /**
   * Real road-network corridors — see `useFlowLegs`. Presence of
   * `onFlowCorridorsEnabledChange` (not this) controls whether the toggle
   * renders at all; this is just the data once it's enabled and resolved.
   */
  flowLegs?: FlowLeg[];
  flowCorridorsEnabled?: boolean;
  onFlowCorridorsEnabledChange?: (enabled: boolean) => void;
  /** True once the server has said the routing engine can't serve this. */
  flowUnavailable?: boolean;
  /** Which failure it was, so the checkbox can explain itself. */
  flowReason?: FlowUnavailableReason | null;
}

export default function MapPanel({
  events,
  currentTimestamp: controlledTimestamp,
  onTimestampChange,
  playing: controlledPlaying,
  onPlayingChange,
  onHoverFeature,
  onSelectFeature,
  timePath,
  clusters,
  flowLegs,
  flowCorridorsEnabled,
  onFlowCorridorsEnabledChange,
  flowUnavailable,
  flowReason,
}: MapPanelProps) {
  const mapRef = useRef<MapRef | null>(null);
  const [view, setView] = useState<View>("ไฮบริด");
  const [satellite, setSatellite] = useState(SATELLITE_DEFAULT_ON);
  const [layersOpen, setLayersOpen] = useState(false);
  // The legend is a permanent 152 px rail beside a desktop map and a third of
  // a phone screen on top of one, so below `lg` it starts as its header only.
  const [legendOpen, setLegendOpen] = useState(false);
  const [ready, setReady] = useState(false);
  // Sticky: once the analyst has been in close, the files are cached anyway.
  const [detail, setDetail] = useState(false);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [boundary, setBoundary] = useState<BoundaryInfo | null>(null);
  const timeRange = useMemo(() => {
    const timestamps = events.features.map((feature) => feature.properties.ts);
    const now = Date.now();
    return {
      start: timestamps.length ? Math.min(...timestamps) : now,
      end: timestamps.length ? Math.max(...timestamps) : now,
    };
  }, [events]);
  const isControlled = controlledTimestamp !== undefined && onTimestampChange !== undefined;
  const [internalTimestamp, setInternalTimestamp] = useState(timeRange.end);
  const [internalPlaying, setInternalPlaying] = useState(false);
  const currentTimestamp = isControlled ? controlledTimestamp : internalTimestamp;
  const setCurrentTimestamp = isControlled ? onTimestampChange : setInternalTimestamp;
  const playing = isControlled ? (controlledPlaying ?? false) : internalPlaying;
  const setPlaying = isControlled ? (onPlayingChange ?? (() => {})) : setInternalPlaying;
  const visibleEvents = useMemo(
    () => events.features.filter((feature) => feature.properties.ts <= currentTimestamp).length,
    [currentTimestamp, events],
  );

  // Built once. `<Map mapStyle>` re-issues the style to MapLibre whenever the
  // object identity changes, and the base style genuinely never changes — the
  // satellite toggle edits it in place instead.
  const mapStyle = useMemo(() => baseStyle(), []);

  /**
   * Event replay is a GPU-layer filter: advancing time re-evaluates an
   * expression, it does not create or destroy DOM nodes, so it stays cheap as
   * the feature count grows.
   */
  const timeFilter = useMemo<ExpressionSpecification>(
    () => ["<=", ["get", "ts"], currentTimestamp],
    [currentTimestamp],
  );
  const uncertaintyFilter = useMemo<ExpressionSpecification>(
    () => ["all", [">", ["get", "precision_m"], 500], timeFilter],
    [timeFilter],
  );

  const timePathData = useMemo(
    () => ({
      type: "Feature" as const,
      geometry: { type: "LineString" as const, coordinates: timePath ?? [] },
      properties: {},
    }),
    [timePath],
  );

  const flowLegsData = useMemo(() => toFlowFeatureCollection(flowLegs ?? []), [flowLegs]);

  const clusterData = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: (clusters ?? []).map((c) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [c.lng, c.lat] },
        properties: { tier: c.tier, label: c.label },
      })),
    }),
    [clusters],
  );

  // Imagery lives in the base style, so it is toggled through the instance
  // rather than through this tree. `ready` gates it: the layers do not exist
  // until the style has loaded.
  useEffect(() => {
    const m = mapRef.current?.getMap();
    if (!m || !ready) return;
    setSatelliteBasemap(m, satellite, SATELLITE_FILLS);
  }, [satellite, ready]);

  /**
   * One handler for both interactive layers, because a click can legitimately
   * land on both: the dot the analyst meant, and the province polygon under
   * it. Each is answered on its own terms rather than one swallowing the other.
   */
  const handleClick = useCallback(
    (e: MapLayerMouseEvent) => {
      const point = e.features?.find((f) => f.layer.id === "events-point");
      const province = e.features?.find((f) => f.layer.id === "province-fill");

      onSelectFeature?.(point ? String(point.properties.id) : null);

      if (province) {
        const props = province.properties as Record<string, string>;
        setBoundary({
          lng: e.lngLat.lng,
          lat: e.lngLat.lat,
          nameTh: props.province_th,
          nameEn: props.province_en,
          code: props.province_code,
        });
      }
    },
    [onSelectFeature],
  );

  /**
   * The last id handed to `onHoverFeature`.
   *
   * A ref rather than a read of `hover`, because `mousemove` fires on every
   * pixel and the parent must be told only when the hovered identity actually
   * changes. Deciding that *inside* a `setHover` updater — which is what this
   * used to do — calls the parent's setState from within a function React may
   * run mid-render, which is exactly the "Cannot update a component while
   * rendering a different component" warning.
   */
  const reportedHoverRef = useRef<string | null>(null);

  const reportHover = useCallback(
    (id: string | null) => {
      if (reportedHoverRef.current === id) return;
      reportedHoverRef.current = id;
      onHoverFeature?.(id);
    },
    [onHoverFeature],
  );

  const handleMouseMove = useCallback(
    (e: MapLayerMouseEvent) => {
      const f = e.features?.find((feature) => feature.layer.id === "events-point");
      if (!f) {
        reportHover(null);
        // Same value bails out of a re-render on React's own identity check.
        setHover(null);
        return;
      }
      const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates as [number, number];
      const props = f.properties as Record<string, string | number>;
      reportHover(String(props.id));
      // Returning `prev` unchanged for the same dot keeps the popup from
      // re-rendering on every pixel of movement across it.
      setHover((prev) => (prev?.props.id === props.id ? prev : { lng, lat, props }));
    },
    [reportHover],
  );

  const handleMouseLeave = useCallback(() => {
    setHover(null);
    reportHover(null);
  }, [reportHover]);

  const nudgeZoom = (d: number) =>
    mapRef.current?.easeTo({ zoom: (mapRef.current.getZoom() ?? 7) + d });

  // Controlled mode: the parent (e.g. EventsWorkspace) owns the initial
  // timestamp and any reset-on-refilter behaviour; MapPanel must not
  // unilaterally snap it back to `timeRange.end` out from under the parent.
  useEffect(() => {
    if (isControlled) return;
    setCurrentTimestamp(timeRange.end);
    setPlaying(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeRange.end, timeRange.start, isControlled]);

  // Tracks the latest timestamp outside React state so the interval below can
  // read "where are we right now" without depending on `currentTimestamp` (which
  // would tear the interval down and rebuild it every single tick). A plain
  // ref instead of the functional-setState form (`setCurrentTimestamp(prev =>
  // ...)`) because in controlled mode `setCurrentTimestamp` is the parent's
  // callback, which — unlike a `useState` setter — has no functional-update form.
  const latestTimestampRef = useRef(currentTimestamp);
  useEffect(() => {
    latestTimestampRef.current = currentTimestamp;
  }, [currentTimestamp]);

  useEffect(() => {
    if (!playing || timeRange.end <= timeRange.start) return;
    const step = Math.max(60 * 60 * 1000, Math.ceil((timeRange.end - timeRange.start) / 120));
    const timer = window.setInterval(() => {
      const t = latestTimestampRef.current;
      if (t >= timeRange.end) {
        setPlaying(false);
        return;
      }
      const next = Math.min(timeRange.end, t + step);
      latestTimestampRef.current = next;
      setCurrentTimestamp(next);
    }, 80);
    return () => window.clearInterval(timer);
  }, [playing, timeRange.end, timeRange.start]);

  const replayDate = new Intl.DateTimeFormat("th-TH", {
    day: "numeric",
    month: "short",
    year: "numeric",
    calendar: "buddhist",
  }).format(new Date(currentTimestamp));

  return (
    <section className="panel relative h-[58vh] max-h-[520px] min-h-[320px] overflow-hidden lg:h-full lg:max-h-none lg:min-h-0">
      {/* Size this with width/height 100%, not `absolute inset-0`:
          maplibre-gl.css sets `.maplibregl-map { position: relative }` on the
          container react-map-gl creates, which overrides absolute positioning.
          The inset offsets then stop stretching the box and it collapses to
          height 0 — the canvas renders but is clipped away, with no error
          anywhere. */}
      <Map
        ref={mapRef}
        // Open on the four provinces under investigation. The rest of Thailand
        // is still drawn around them for context, and the "ดูทั้งประเทศ" button
        // pulls back to the national view.
        initialViewState={{ bounds: BOUNDS, fitBoundsOptions: { padding: FIT_PADDING } }}
        mapStyle={mapStyle}
        style={{ width: "100%", height: "100%" }}
        attributionControl={false}
        dragRotate={false}
        interactiveLayerIds={INTERACTIVE_LAYERS}
        cursor={hover ? "pointer" : undefined}
        onLoad={(e) => {
          setReady(true);
          setDetail(e.target.getZoom() >= DETAIL_MIN_ZOOM);
          registerFlowArrowIcon(e.target);
        }}
        onZoomEnd={(e) => setDetail((on) => on || e.viewState.zoom >= DETAIL_MIN_ZOOM)}
        onClick={handleClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        // MapLibre swallows style and source failures unless you listen for
        // them: an invalid style just leaves a blank canvas and logs nothing.
        onError={(e) => console.error("[maplibre]", e.error?.message ?? String(e))}
      >
        {/* Credits the imagery provider only while its tiles are on screen —
            MapLibre lists a source when a visible layer uses it, and nothing
            else in this style carries an attribution. */}
        <AttributionControl compact position="bottom-right" />

        {detail && (
          <>
            <Source id="subdistricts" type="geojson" data={SOUTH.subdistricts}>
              <Layer {...SUBDISTRICT_OUTLINE_LAYER} beforeId="district-outline" />
            </Source>
            <Source id="villages" type="geojson" data={SOUTH.villages}>
              <Layer {...VILLAGE_LAYER} beforeId="district-outline" />
            </Source>
          </>
        )}

        <Source id="events" type="geojson" data={events}>
          <Layer
            {...HEAT_LAYER}
            filter={timeFilter}
            layout={{ visibility: view !== "แผนที่" ? "visible" : "none" }}
          />
          <Layer
            {...UNCERTAINTY_LAYER}
            filter={uncertaintyFilter}
            layout={{ visibility: view === "ไฮบริด" ? "visible" : "none" }}
          />
          <Layer
            {...POINT_LAYER}
            filter={timeFilter}
            layout={{ visibility: view !== "ความหนาแน่น" ? "visible" : "none" }}
          />
        </Source>

        {/* Rendered only when a parent actually supplies these —
            `/investigate`'s plain usage never creates them, so its map is
            unchanged. */}
        {timePath !== undefined && (
          <Source id="time-path" type="geojson" data={timePathData}>
            <Layer {...TIME_PATH_LAYER} />
          </Source>
        )}
        {clusters !== undefined && (
          <Source id="clusters" type="geojson" data={clusterData}>
            <Layer {...CLUSTER_GLOW_LAYER} />
            <Layer {...CLUSTER_RING_LAYER} />
          </Source>
        )}
        {flowCorridorsEnabled && flowLegs !== undefined && (
          <Source id="flow-legs" type="geojson" data={flowLegsData}>
            <Layer {...FLOW_CORRIDOR_LAYER} />
            <Layer {...FLOW_DIRECTION_LAYER} />
          </Source>
        )}

        {hover && (
          <Popup
            longitude={hover.lng}
            latitude={hover.lat}
            closeButton={false}
            closeOnClick={false}
            className="palantir-popup"
            offset={10}
          >
            <div className="pp-title">{String(hover.props.title)}</div>
            <div className="pp-meta">
              อ.{String(hover.props.district)} จ.{String(hover.props.province)}
            </div>
            <div className="pp-meta">{hoverWhen(hover)}</div>
            <div className="pp-row">
              <span>ความรุนแรง</span>
              <b>{hover.props.severity}/5</b>
            </div>
            <div className="pp-row">
              <span>ความเชื่อมั่น</span>
              <b>{hover.props.confidence}%</b>
            </div>
            <div className="pp-row">
              <span>ความละเอียดพิกัด</span>
              <b>{PRECISION_LABEL[String(hover.props.precision)] ?? "ไม่ระบุ"}</b>
            </div>
          </Popup>
        )}

        {boundary && (
          <Popup
            longitude={boundary.lng}
            latitude={boundary.lat}
            closeButton={false}
            className="palantir-popup"
            offset={8}
            onClose={() => setBoundary(null)}
          >
            <div className="pp-title">{boundary.nameTh}</div>
            <div className="pp-meta">{boundary.nameEn}</div>
            <div className="pp-row">
              <span>รหัสจังหวัด</span>
              <b>{boundary.code}</b>
            </div>
          </Popup>
        )}
      </Map>

      <div className="pointer-events-none absolute inset-0">
        {/* View switcher */}
        <div className="pointer-events-auto absolute top-2 left-2 flex items-center gap-1 rounded bg-[rgba(6,13,25,0.85)] p-0.5 lg:top-2.5 lg:left-3">
          {VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={
                v === view
                  ? "min-h-9 rounded bg-azure px-3 text-[12.5px] font-medium text-[#04070e] lg:min-h-0 lg:px-2.5 lg:py-1 lg:text-[11.5px]"
                  : "min-h-9 rounded px-3 text-[12.5px] text-ink-dim hover:text-ink lg:min-h-0 lg:px-2.5 lg:py-1 lg:text-[11.5px]"
              }
            >
              {v}
            </button>
          ))}
        </div>

        <div className="pointer-events-auto absolute top-11 left-2 lg:left-3">
          <button
            type="button"
            onClick={() => setLayersOpen((v) => !v)}
            aria-expanded={layersOpen}
            className="flex items-center gap-1.5 rounded border border-[rgba(56,100,150,0.5)] bg-[rgba(6,13,25,0.85)] px-2.5 py-1.5 text-[11.5px] text-ink-dim hover:text-ink"
          >
            <IconStack2 size={14} stroke={1.7} />
            ชั้นข้อมูล
            <IconChevronDown
              size={13}
              stroke={2}
              className={layersOpen ? "rotate-180 transition-transform" : "transition-transform"}
            />
          </button>

          {layersOpen && (
            <div className="mt-1 w-[186px] rounded border border-[rgba(56,100,150,0.5)] bg-[rgba(6,13,25,0.92)] p-2.5">
              <label className="flex cursor-pointer items-start gap-2 text-[11.5px] text-ink-dim hover:text-ink">
                <input
                  type="checkbox"
                  checked={satellite}
                  onChange={() => setSatellite((v) => !v)}
                  className="mt-[2px] h-3.5 w-3.5 shrink-0 appearance-none rounded-[3px] border border-[rgba(90,140,190,0.7)] bg-transparent checked:border-azure checked:bg-azure checked:after:block checked:after:text-[10px] checked:after:leading-[13px] checked:after:font-bold checked:after:text-[#04070e] checked:after:content-['✓']"
                />
                <span>
                  <span className="flex items-center gap-1.5 text-ink">
                    <IconSatellite size={13} stroke={1.7} />
                    ภาพถ่ายดาวเทียม
                  </span>
                  <span className="mt-0.5 block text-[10px] leading-relaxed text-ink-muted">
                    ดึงไทล์จากผู้ให้บริการภายนอก — เปิดเมื่อต้องการเท่านั้น
                  </span>
                </span>
              </label>

              {onFlowCorridorsEnabledChange && (
                <label
                  className={
                    flowUnavailable
                      ? "mt-2 flex cursor-not-allowed items-start gap-2 text-[11.5px] text-ink-muted/60"
                      : "mt-2 flex cursor-pointer items-start gap-2 text-[11.5px] text-ink-dim hover:text-ink"
                  }
                  title={flowReason ? FLOW_UNAVAILABLE_LABEL[flowReason] : undefined}
                >
                  <input
                    type="checkbox"
                    checked={Boolean(flowCorridorsEnabled) && !flowUnavailable}
                    disabled={flowUnavailable}
                    onChange={() => onFlowCorridorsEnabledChange(!flowCorridorsEnabled)}
                    className="mt-[2px] h-3.5 w-3.5 shrink-0 appearance-none rounded-[3px] border border-[rgba(90,140,190,0.7)] bg-transparent checked:border-azure checked:bg-azure checked:after:block checked:after:text-[10px] checked:after:leading-[13px] checked:after:font-bold checked:after:text-[#04070e] checked:after:content-['✓'] disabled:opacity-40"
                  />
                  <span>
                    <span className="flex items-center gap-1.5 text-ink">
                      <IconRoute size={13} stroke={1.7} />
                      เส้นทางตามถนนจริง
                    </span>
                    <span className="mt-0.5 block text-[10px] leading-relaxed text-ink-muted">
                      {flowReason
                        ? FLOW_UNAVAILABLE_LABEL[flowReason]
                        : "คำนวณเส้นทางบนโครงข่ายถนนจริงจากข้อมูล OSM (ทดลอง)"}
                    </span>
                  </span>
                </label>
              )}
            </div>
          )}
        </div>

        {/* Zoom + recentre */}
        <div className="pointer-events-auto absolute top-24 left-2 flex flex-col gap-1.5 lg:left-3">
          <div className="flex flex-col overflow-hidden rounded border border-[rgba(56,100,150,0.5)] bg-[rgba(6,13,25,0.85)]">
            <button
              type="button"
              aria-label="ขยาย"
              onClick={() => nudgeZoom(0.6)}
              className="px-1.5 py-1 text-ink-dim hover:bg-[rgba(56,189,248,0.12)] hover:text-ink"
            >
              <IconPlus size={14} stroke={2} />
            </button>
            <button
              type="button"
              aria-label="ย่อ"
              onClick={() => nudgeZoom(-0.6)}
              className="border-t border-[rgba(56,100,150,0.4)] px-1.5 py-1 text-ink-dim hover:bg-[rgba(56,189,248,0.12)] hover:text-ink"
            >
              <IconMinus size={14} stroke={2} />
            </button>
          </div>
          <button
            type="button"
            aria-label="โฟกัส 4 จังหวัดชายแดนใต้"
            title="โฟกัส 4 จังหวัดชายแดนใต้"
            onClick={() => mapRef.current?.fitBounds(BOUNDS, { padding: FIT_PADDING })}
            className="rounded border border-[rgba(56,100,150,0.5)] bg-[rgba(6,13,25,0.85)] px-1.5 py-1 text-ink-dim hover:text-ink"
          >
            <IconCurrentLocation size={14} stroke={1.8} />
          </button>
          <button
            type="button"
            aria-label="ดูทั้งประเทศ"
            title="ดูทั้งประเทศ"
            onClick={() => mapRef.current?.fitBounds(THAILAND_BOUNDS, { padding: FIT_PADDING })}
            className="rounded border border-[rgba(56,100,150,0.5)] bg-[rgba(6,13,25,0.85)] px-1.5 py-1 text-ink-dim hover:text-ink"
          >
            <IconMap2 size={14} stroke={1.8} />
          </button>
        </div>

        {/* Legend */}
        <div className="pointer-events-auto absolute top-14 right-2 flex max-h-[calc(100%-4rem)] w-[136px] flex-col overflow-y-auto rounded border border-[rgba(56,100,150,0.45)] bg-[rgba(6,13,25,0.88)] p-2.5 lg:top-2.5 lg:right-2.5 lg:max-h-[calc(100%-1.25rem)] lg:w-[152px]">
          <button
            type="button"
            onClick={() => setLegendOpen((v) => !v)}
            aria-expanded={legendOpen}
            className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-semibold text-ink lg:cursor-default"
          >
            สัญลักษณ์
            <IconChevronDown
              size={14}
              stroke={2}
              className={`ml-auto text-ink-muted transition-transform lg:hidden ${
                legendOpen ? "rotate-180" : ""
              }`}
            />
          </button>
          <ul className={`space-y-1 lg:block ${legendOpen ? "block" : "hidden"}`}>
            {LEGEND.map((g) => (
              <li key={g.family}>
                <p className="text-[9.5px] tracking-wide text-ink-muted uppercase">{g.label}</p>
                <ul className="mt-0.5 space-y-1">
                  {g.types.map((l) => (
                    <li key={l.type} className="flex items-center gap-2 text-[10.5px] text-ink-dim">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ background: l.color, boxShadow: `0 0 5px ${l.color}` }}
                      />
                      {l.label}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
            <li className="flex items-center gap-2 pt-1 text-[10.5px] text-ink-dim">
              <span className="h-2 w-3 shrink-0 rounded-[1px] bg-[#0c3150] ring-1 ring-azure/70" />
              พื้นที่เฝ้าระวัง 4 จังหวัด
            </li>
            <li className="flex items-center gap-2 text-[10.5px] text-ink-dim">
              <span className="h-2 w-3 shrink-0 rounded-[1px] bg-[#0a1826] ring-1 ring-[#1e3a5c]" />
              จังหวัดอื่น
            </li>
            <li className="flex items-center gap-2 text-[10.5px] text-ink-dim">
              <span className="h-px w-3 shrink-0 bg-azure" />
              ขอบเขตจังหวัด
            </li>
            <li className="flex items-center gap-2 text-[10.5px] text-ink-dim">
              <span className="h-px w-3 shrink-0 bg-azure/50" />
              ขอบเขตอำเภอ
            </li>
            <li className="flex items-center gap-2 text-[10.5px] text-ink-dim">
              <span className="h-px w-3 shrink-0 bg-[#7dd3fc]/40" />
              ขอบเขตตำบล
            </li>
            <li className="flex items-center gap-2 text-[10.5px] text-ink-dim">
              <span className="h-1 w-1 shrink-0 rounded-full bg-[#e2f2ff]" />
              หมู่บ้าน (OSM)
            </li>
            <li className="flex items-center gap-2 text-[10.5px] text-ink-dim">
              <span className="h-2 w-2 shrink-0 rounded-full border border-ink-muted" />
              ขอบเขตความคลาดเคลื่อน
            </li>
          </ul>
        </div>

        <p className="absolute bottom-1 left-2 flex flex-wrap items-center gap-x-2 text-[9.5px] text-ink-muted lg:bottom-2 lg:left-3 lg:flex-nowrap">
          <span>ขอบเขตการปกครอง: กรมป้องกันและบรรเทาสาธารณภัย (DDPM)</span>
          <span className="text-ink-muted/50">·</span>
          <span className="num">{events.features.length.toLocaleString("en-US")} เหตุการณ์</span>
        </p>

        {/* Own playhead UI only in uncontrolled mode — a controlling parent
            (e.g. EventsWorkspace) has its own dedicated Timeline panel, and
            two playheads on screen at once would just fight each other. */}
        {!isControlled && (
          <div className="pointer-events-auto absolute inset-x-2 bottom-6 rounded border border-[rgba(56,100,150,0.5)] bg-[rgba(6,13,25,0.9)] px-2.5 py-1.5 shadow-lg lg:inset-x-auto lg:left-1/2 lg:w-[430px] lg:-translate-x-1/2">
            <div className="mb-1 flex items-center gap-2">
              <button
                type="button"
                aria-label={playing ? "หยุดการเล่นเหตุการณ์" : "เล่นเหตุการณ์ตามเวลา"}
                onClick={() => {
                  if (!playing && currentTimestamp >= timeRange.end) setCurrentTimestamp(timeRange.start);
                  setInternalPlaying((value) => !value);
                }}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-azure text-[#04070e] hover:bg-cyan"
              >
                {playing ? <IconPlayerPause size={11} /> : <IconPlayerPlay size={11} />}
              </button>
              <span className="num min-w-[82px] text-[10px] text-ink-dim">{replayDate}</span>
              <span className="ml-auto text-[9.5px] text-ink-muted">
                แสดง {visibleEvents.toLocaleString("en-US")} / {events.features.length.toLocaleString("en-US")}
              </span>
            </div>
            <input
              type="range"
              min={timeRange.start}
              max={timeRange.end}
              step={Math.max(1, Math.floor((timeRange.end - timeRange.start) / 500))}
              value={currentTimestamp}
              onChange={(event) => {
                setInternalPlaying(false);
                setCurrentTimestamp(Number(event.target.value));
              }}
              aria-label="ช่วงเวลาที่แสดงบนแผนที่"
              className="block h-6 w-full cursor-pointer accent-sky-400 lg:h-1"
            />
          </div>
        )}
      </div>
    </section>
  );
}

const PRECISION_LABEL: Record<string, string> = {
  gps: "GPS",
  address: "ระดับที่อยู่",
  village: "centroid หมู่บ้าน",
  subdistrict: "centroid ตำบล",
  district: "centroid อำเภอ",
  province: "centroid จังหวัด",
  unknown: "ไม่ระบุ",
};

/** Popup timestamp, in the Buddhist-era calendar the rest of the UI uses. */
function hoverWhen(hover: HoverInfo): string {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    calendar: "buddhist",
  }).format(new Date(Number(hover.props.ts)));
}
