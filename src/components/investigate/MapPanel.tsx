"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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
  IconChevronRight,
  IconBuildingCommunity,
  IconCompass,
  IconRoute,
  IconSatellite,
  IconStack2,
} from "@tabler/icons-react";
import { EVENT_COLOR, EVENT_FAMILY_COLOR } from "@/lib/palette";
import { EVENT_FAMILY_ICON, EVENT_ICON, MAP_LAYER_ICON } from "@/lib/event-icons";
import {
  addEventBadgeImages,
  buildEventBadgeImages,
  EVENT_BADGE_LAYER,
  EventBadgeSprite,
} from "@/lib/map-event-icons";
import type { LinkableFamily } from "@/lib/events-replay";
import type { FlowLeg } from "@/lib/flow/types";
import {
  FLOW_CORRIDOR_LAYER,
  FLOW_DIRECTION_LAYER,
  FLOW_UNAVAILABLE_LABEL,
  registerFlowArrowIcon,
  toFlowFeatureCollection,
} from "@/lib/flow/map-layers";
import type { FlowUnavailableReason } from "@/lib/flow/use-flow-legs";
import type { FacilityMark } from "@/lib/facilities";
import { FacilityBadgeSprite } from "@/lib/map-facility-icons";
import {
  FACILITY_OVERLAY_ANCHOR_ID,
  FACILITY_OVERLAY_ANCHOR_LAYER,
  FacilityHoverPopupBody,
  FacilityLegend,
  FacilityOverlay,
  facilityHitLayers,
  facilityIndex,
  facilityHref,
  findFacilityHit,
  useFacilityBadges,
} from "@/lib/map-facility-layer";
import { useFacilities } from "@/lib/use-facilities";
import { useDistancePattern } from "@/lib/use-distance-pattern";
import { DistancePatternCard, DistancePatternLayers } from "@/lib/map-distance-pattern";
import {
  SATELLITE_DEFAULT_ON,
  SATELLITE_SOURCE_ID,
  satelliteLayer,
  satelliteSource,
  setSatelliteBasemap,
  type BasemapFill,
} from "@/lib/basemap";
import { EVENT_FAMILY_LABEL, EVENT_TYPE_LABEL } from "@/lib/labels";
import { EVENT_FAMILIES, typesInFamily, type EventType } from "@/lib/types";
import type { EventFeature, EventFeatureCollection } from "@/server/shared-events";

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
const FIT_PADDING = { top: 14, bottom: 74, left: 16, right: 190 };

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
  Icon: EVENT_FAMILY_ICON[family],
  types: typesInFamily(family).map((t) => ({
    type: t,
    label: EVENT_TYPE_LABEL[t],
    color: EVENT_COLOR[t],
    Icon: EVENT_ICON[t],
  })),
}));

/**
 * Where a dot goes when it is clicked.
 *
 * The canonical detail route is plural (`/cases/<id>`); `/case/<id>` exists as
 * an alias and only redirects here, so linking straight at the canonical form
 * saves the round trip. The id is the event candidate's `_id` — the same key
 * `getCaseDetail` reads — carried on every feature as `properties.id`.
 */
function caseHref(id: string): string {
  return `/cases/${encodeURIComponent(id)}`;
}

const VIEWS = ["แผนที่", "ความหนาแน่น", "ไฮบริด"] as const;
type View = (typeof VIEWS)[number];

/** Colour ramp shared by the heatmap layer. */
/**
 * Alphas top out at 0.62 rather than 0.95.
 *
 * The ramp is multiplied by `heatmap-opacity`, so the old 0.95 core was very
 * nearly opaque wherever density saturated — which over the four provinces is
 * most of the map. The hue progression is what carries the reading; the alpha
 * only needs to be enough to see it, and holding the core translucent is what
 * lets the imagery and the district lines stay legible underneath.
 */
const HEAT_RAMP: ExpressionSpecification = [
  "interpolate", ["linear"], ["heatmap-density"],
  0, "rgba(0,0,0,0)",
  0.2, "rgba(14,165,233,0.30)",
  0.4, "rgba(34,211,238,0.40)",
  0.6, "rgba(251,191,36,0.50)",
  0.8, "rgba(249,115,22,0.56)",
  1, "rgba(239,68,68,0.62)",
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

      // Draws nothing. Everything facility-related mounts below it and every
      // event layer above it, whatever order the two finish loading in — see
      // `FACILITY_OVERLAY_ANCHOR_LAYER`.
      FACILITY_OVERLAY_ANCHOR_LAYER,
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
    /**
     * Fades out as the map zooms in, and much earlier than it used to.
     *
     * Zoomed out the heatmap is the content — there is nothing underneath it
     * worth reading, so it stays strong. Zoomed in it becomes context for the
     * detail the analyst came for (imagery, boundaries, marks, spokes), and
     * the old curve held 0.85 all the way to z10 and 0.35 at z12, which buried
     * exactly the view where the detail matters most.
     */
    "heatmap-opacity": [
      "interpolate", ["linear"], ["zoom"],
      8, 0.62,
      10, 0.38,
      11.5, 0.16,
    ],
  },
} satisfies LayerProps;

/**
 * Positional uncertainty: a district centroid must not read like a GPS fix, so
 * the halo is sized from precision_m in real metres.
 *
 * **The fill is almost nil on purpose, and the ring carries the meaning.** The
 * corpus puts ~44 events on each district centroid, so this layer draws ~44
 * identical circles on the same pixels; alpha compounds as 1-(1-a)^n, which
 * turned the old 0.07 fill into a 96% opaque disc and the four provinces into
 * one flat red field. At 0.014 the same stack lands near 45%, and where two
 * districts' 8 km halos merely overlap it stays a wash rather than a wall.
 *
 * The stroke is raised to compensate. What this layer has to say is "the true
 * position is somewhere inside this boundary" — that is a ring, and a ring is
 * also the part that does not compound, because only its own pixels stack.
 */
const UNCERTAINTY_LAYER = {
  id: "events-uncertainty",
  type: "circle",
  // Below z9 the halos are a few pixels and say nothing; by z12 they are
  // viewport-scale and say nothing. The band between is where the shape reads.
  // z12 is also where the heatmap stops, which gives the map one rule rather
  // than two: below it the washes give context, above it the imagery and the
  // marks have the screen to themselves.
  minzoom: 9,
  maxzoom: 12.5,
  paint: {
    "circle-color": ["get", "color"],
    /**
     * Fades to almost nothing as the circles grow.
     *
     * The radius scales exponentially with zoom, so an 8 km halo is ~67 px
     * across at z9 and larger than the viewport by z14. Past the point where
     * its edge is off-screen a fill says nothing a reader can act on — it is
     * just a tint over everything — while the ring still marks where the
     * uncertainty ends. So the fill is spent early and given up late.
     */
    "circle-opacity": [
      "interpolate", ["linear"], ["zoom"],
      9, 0.05,
      11, 0.03,
      12.5, 0,
    ],
    "circle-stroke-color": ["get", "color"],
    /**
     * Held to z12, then gone.
     *
     * Measured, not guessed: at z12.8 an 8 km halo is ~1,300 px across, so a
     * couple of hundred of them cross every pixel and even a 0.1 stroke
     * compounds to solid — the fill was never the only offender. A ring whose
     * shape you cannot see has stopped saying "somewhere inside this" and
     * started saying nothing.
     *
     * The claim is not lost at those zooms, it moves: the pinned case draws
     * its own search ring, and its popup states ความละเอียดพิกัด outright,
     * which is the one event a reader at street zoom is actually asking about.
     */
    "circle-stroke-opacity": [
      "interpolate", ["linear"], ["zoom"],
      9, 0.42,
      11, 0.34,
      12.5, 0,
    ],
    "circle-stroke-width": 0.8,
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

/**
 * Coloured by family, from the same `EVENT_FAMILY_COLOR` the trend chart uses:
 * with four separate chains on screen at once, one shared cyan would read as a
 * single tangled path rather than four independent ones.
 */
const TIME_PATH_LAYER = {
  id: "time-path-line",
  type: "line",
  paint: {
    "line-color": [
      "match",
      ["get", "family"],
      "violence",
      EVENT_FAMILY_COLOR.violence,
      "gang",
      EVENT_FAMILY_COLOR.gang,
      "narcotics",
      EVENT_FAMILY_COLOR.narcotics,
      "crime",
      EVENT_FAMILY_COLOR.crime,
      "#38bdf8",
    ] as ExpressionSpecification,
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

/**
 * The layers a click or hover resolves to an event. The badge is in here as
 * well as the dot: it is drawn directly above its own dot and covers the
 * pixels an analyst would otherwise aim at, so leaving it inert would make the
 * glyph the one part of a marker that does not answer the pointer.
 */
const EVENT_HIT_LAYERS = ["events-point", EVENT_BADGE_LAYER.id];

/** Everything a click or hover is allowed to hit, badges aside. */
const INTERACTIVE_LAYERS = ["events-point", "province-fill"];

/** What a hovered event dot needs to draw its popup. */
interface HoverInfo {
  lng: number;
  lat: number;
  props: Record<string, string | number>;
}

/**
 * The case a click pinned open.
 *
 * Carries the id as well as the properties, because unlike the hover popup
 * this one has to survive the pointer moving away — it is compared against the
 * next click to decide open-or-close, and it renders a link.
 */
interface SelectedCase extends HoverInfo {
  id: string;
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
  /**
   * The short, already-scoped recent-movement lines — one per event family,
   * never one chain across families. See `scopedTimePaths`.
   */
  timePaths?: { family: LinkableFamily; coordinates: [number, number][] }[];
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
  timePaths,
  clusters,
  flowLegs,
  flowCorridorsEnabled,
  onFlowCorridorsEnabledChange,
  flowUnavailable,
  flowReason,
}: MapPanelProps) {
  const router = useRouter();
  const mapRef = useRef<MapRef | null>(null);
  const [view, setView] = useState<View>("ไฮบริด");
  const [satellite, setSatellite] = useState(SATELLITE_DEFAULT_ON);
  const [layersOpen, setLayersOpen] = useState(false);
  // The legend is a permanent 152 px rail beside a desktop map and a third of
  // a phone screen on top of one, so below `lg` it starts as its header only.
  const [legendOpen, setLegendOpen] = useState(false);
  const [ready, setReady] = useState(false);
  // Gates the badge layer: see `map-event-icons.tsx` on why it must not mount
  // before its images are registered.
  const [badgesReady, setBadgesReady] = useState(false);
  const spriteRef = useRef<HTMLDivElement | null>(null);
  // Sticky: once the analyst has been in close, the files are cached anyway.
  const [detail, setDetail] = useState(false);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [facilityHover, setFacilityHover] = useState<FacilityMark | null>(null);
  const [boundary, setBoundary] = useState<BoundaryInfo | null>(null);
  /**
   * The response network, on by default.
   *
   * Internal state rather than a prop: the controlled/uncontrolled split on
   * this component exists for the playhead, because `/events` owns one in a
   * separate Timeline panel. Nothing outside reads or drives this layer, and a
   * prop would turn the bare `<MapPanel events={...} />` on `/investigate`
   * into an uncontrolled case of a second axis for no gain.
   */
  const [showFacilities, setShowFacilities] = useState(true);
  /**
   * The 32-direction distance pattern, on by default.
   *
   * On, because clicking a dot is now what asks for it — a click that drew
   * nothing until the analyst had found a toggle first would just look broken.
   * The switch stays so the spokes can be hidden on a dense view without
   * giving up the pinned label, which is the other half of the same click.
   */
  const [showPattern, setShowPattern] = useState(true);
  const [patternEventId, setPatternEventId] = useState<string | null>(null);
  /** The case a click pinned. Independent of `showPattern`: hiding the spokes
   *  must not also take away the label. */
  const [selected, setSelected] = useState<SelectedCase | null>(null);
  const {
    facilities,
    loading: facilitiesLoading,
    failed: facilitiesFailed,
  } = useFacilities(showFacilities);
  const {
    pattern,
    loading: patternLoading,
    failed: patternFailed,
  } = useDistancePattern(showPattern ? patternEventId : null);
  const { spriteRef: facilitySpriteRef, badgesReady: facilityBadgesReady } = useFacilityBadges(
    mapRef,
    ready,
  );
  const facilityById = useMemo(() => facilityIndex(facilities), [facilities]);
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

  // Naming a layer that is not in the style yet makes MapLibre's
  // queryRenderedFeatures complain, so the badge joins this list only once it
  // is actually mounted.
  const interactiveLayerIds = useMemo(
    () => [
      ...INTERACTIVE_LAYERS,
      ...(badgesReady ? [EVENT_BADGE_LAYER.id] : []),
      ...(showFacilities ? facilityHitLayers(facilityBadgesReady) : []),
    ],
    [badgesReady, showFacilities, facilityBadgesReady],
  );

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

  /**
   * One halo per distinct position, not one per event.
   *
   * Positional uncertainty is a property of the *coordinate*, not of each
   * record standing on it — and this corpus puts roughly 44 events on every
   * district centroid, one of them 781. Drawn from the event collection the
   * layer therefore stacked 44 identical circles on the same pixels, where
   * alpha compounds as 1-(1-a)^n: at a 0.13 stroke that is 99.7% opaque, so
   * the wash ended up measuring how many events shared a centroid rather than
   * how uncertain the position was, and no opacity low enough to fix it left a
   * visible ring for the positions holding a single event.
   *
   * Deduplicating drops ~9,700 circles to ~228 and makes the alpha mean what
   * it says. The earliest timestamp at each position is kept so the halo
   * appears during replay as soon as anything there does, and the winning
   * feature's colour stands for the position — which is one honest colour
   * instead of forty-four stacked ones.
   */
  const uncertaintyData = useMemo(() => {
    // A plain object, not `new Map()`: react-map-gl's `Map` is imported into
    // this module under that very name, and the shadowed constructor fails in
    // a way that names neither of them. `map-facility-layer.tsx` hit the same
    // trap and left the same note.
    const byPosition: Record<string, EventFeature> = {};
    for (const f of events.features) {
      const [lng, lat] = f.geometry.coordinates;
      const key = `${lng.toFixed(5)},${lat.toFixed(5)}`;
      const held = byPosition[key];
      if (!held || f.properties.ts < held.properties.ts) byPosition[key] = f;
    }
    return { type: "FeatureCollection" as const, features: Object.values(byPosition) };
  }, [events]);

  const timePathData = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: (timePaths ?? []).map((path) => ({
        type: "Feature" as const,
        geometry: { type: "LineString" as const, coordinates: path.coordinates },
        properties: { family: path.family },
      })),
    }),
    [timePaths],
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

  // Rasterise the type glyphs once the style is up. Failure here is not fatal
  // — `badgesReady` simply stays false and the map is the plain dot field it
  // was before — so it is logged rather than surfaced.
  useEffect(() => {
    const m = mapRef.current?.getMap();
    const sprite = spriteRef.current;
    if (!m || !ready || !sprite) return;

    let cancelled = false;
    buildEventBadgeImages(sprite)
      .then((badges) => {
        if (cancelled) return;
        addEventBadgeImages(m, badges);
        setBadgesReady(true);
      })
      .catch((err) => console.error("[maplibre] event badge icons", err));

    return () => {
      cancelled = true;
    };
  }, [ready]);

  /**
   * One handler for both interactive layers, because a click can legitimately
   * land on both: the dot the analyst meant, and the province polygon under
   * it. Each is answered on its own terms rather than one swallowing the other.
   */
  const handleClick = useCallback(
    (e: MapLayerMouseEvent) => {
      const point = e.features?.find((f) => EVENT_HIT_LAYERS.includes(f.layer.id));
      const province = e.features?.find((f) => f.layer.id === "province-fill");

      onSelectFeature?.(point ? String(point.properties.id) : null);

      // Events first, facilities second, the polygon underneath last: the
      // event mark draws above the facility mark, so the topmost visible
      // target is the one that has to answer — and on these two pages the
      // subject is the incident, not the station beside it.

      // A dot is a case, and clicking it keeps the analyst on the map: it pins
      // the case's label and draws that case's 32 directions around it.
      //
      // It used to navigate straight to `/cases/<id>`, which made the primary
      // gesture on the map a one-way exit — the surroundings the analyst was
      // reading disappeared the moment they asked about one of them. The case
      // page is still one click away, from a link inside the pinned label,
      // which is also reachable in a way the hover popup never was.
      //
      // Any dot replaces whatever was showing, including the one already
      // pinned. It is deliberately not a toggle: with the label closable on
      // its own, a second click on the same dot is how the analyst asks for
      // that label back, and a toggle would instead wipe the spokes they were
      // still reading. Clearing is the empty-map click below, which is one
      // gesture for one meaning.
      if (point) {
        const id = String(point.properties.id);
        setSelected({ id, lng: e.lngLat.lng, lat: e.lngLat.lat, props: point.properties });
        setPatternEventId(id);
        return;
      }

      // Returns before the province branch, so clicking a pin never also
      // leaves a boundary popup open behind the navigation. Nothing is cleared
      // on the way out: the page is about to change anyway, and clearing would
      // only be visible as a flicker.
      const facility = findFacilityHit(e.features, facilityById, facilityBadgesReady);
      if (facility) {
        router.push(facilityHref(facility.id));
        return;
      }

      // Anything that is not a mark is the map itself, and clicking the map
      // puts it back to rest — label and spokes both. This is the only way to
      // clear the overlay, which is what makes it predictable: the analyst
      // never has to remember which dot was the pinned one to get rid of it.
      setSelected(null);
      setPatternEventId(null);

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
    [onSelectFeature, router, facilityById, facilityBadgesReady],
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
      const f = e.features?.find((feature) => EVENT_HIT_LAYERS.includes(feature.layer.id));
      if (!f) {
        reportHover(null);
        // Same value bails out of a re-render on React's own identity check.
        setHover(null);
        // One popup at a time. A pin sitting under an event dot is a normal
        // arrangement, and two boxes stacked on the cursor read as a bug.
        const facility = findFacilityHit(e.features, facilityById, facilityBadgesReady);
        setFacilityHover((prev) => (prev?.id === facility?.id ? prev : facility));
        return;
      }
      const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates as [number, number];
      const props = f.properties as Record<string, string | number>;
      reportHover(String(props.id));
      setFacilityHover(null);
      // Returning `prev` unchanged for the same dot keeps the popup from
      // re-rendering on every pixel of movement across it.
      setHover((prev) => (prev?.props.id === props.id ? prev : { lng, lat, props }));
    },
    [reportHover, facilityById, facilityBadgesReady],
  );

  const handleMouseLeave = useCallback(() => {
    setHover(null);
    setFacilityHover(null);
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

  // Uncontrolled mode only. A controlling parent (`EventsWorkspace`) runs its
  // own tick at its own pace, and this one used to keep running alongside it:
  // two intervals advancing the same playhead, so `/events` replayed at
  // roughly the sum of both rates no matter what its speed buttons said, with
  // the two writers interleaving into a visible stutter. Whoever owns the
  // timestamp owns the ticking.
  useEffect(() => {
    if (isControlled || !playing || timeRange.end <= timeRange.start) return;
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
  }, [isControlled, playing, timeRange.end, timeRange.start]);

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
        interactiveLayerIds={interactiveLayerIds}
        cursor={hover || facilityHover ? "pointer" : undefined}
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

        {/* Under the events, above the boundaries — see the anchor layer. */}
        {showFacilities && (
          <FacilityOverlay
            facilities={facilities}
            badgesReady={facilityBadgesReady}
            beforeId={FACILITY_OVERLAY_ANCHOR_ID}
          />
        )}

        {/* Its own source, holding one feature per position — see
            `uncertaintyData`. Same `beforeId` as the heatmap, so both washes
            still sit under every outline and mark. */}
        <Source id="events-positions" type="geojson" data={uncertaintyData}>
          <Layer
            {...UNCERTAINTY_LAYER}
            beforeId="district-outline"
            filter={uncertaintyFilter}
            layout={{ visibility: view === "ไฮบริด" ? "visible" : "none" }}
          />
        </Source>

        <Source id="events" type="geojson" data={events}>
          {/*
            The two red washes, pinned as low as they can go and still be read.

            Both are area fills over the whole corpus — the heatmap at 0.85
            opacity, and the uncertainty halos at 0.07 each but hundreds deep,
            which compounds to the same solid red. Added in source order they
            landed on top of the entire base style, burying the imagery, the
            boundary lines, the facility marks and the pattern spokes beneath
            them. `district-outline` puts both under every outline and every
            mark on the map, which is the only way a zoomed-in view stays
            readable.

            One step lower — `thailand-fill`, immediately above the satellite
            layer — looks the same over imagery (`SATELLITE_FILLS` drops those
            fills to 0 and 0.12 there) but is wrong on the plain basemap: the
            province fill is opaque enough to bury the heat, and the whole
            content of the ความหนาแน่น view with it. Above the two flat fills
            and below everything else is the placement that holds in both.

            Declared heat-first so it stays under the halos, as it always was:
            `beforeId` inserts at the same slot, so the later of the two lands
            on top of the earlier.
          */}
          <Layer
            {...HEAT_LAYER}
            beforeId="district-outline"
            filter={timeFilter}
            layout={{ visibility: view !== "แผนที่" ? "visible" : "none" }}
          />
          <Layer
            {...POINT_LAYER}
            filter={timeFilter}
            layout={{ visibility: view !== "ความหนาแน่น" ? "visible" : "none" }}
          />
          {/* The type glyph above each dot — same filter, same visibility, so
              it can never say something the dot underneath it does not. */}
          {badgesReady && (
            <Layer
              {...EVENT_BADGE_LAYER}
              filter={timeFilter}
              layout={{
                ...EVENT_BADGE_LAYER.layout,
                visibility: view !== "ความหนาแน่น" ? "visible" : "none",
              }}
            />
          )}
        </Source>

        {/*
          Above the uncertainty halos and the facility marks they point at,
          below the incident dots.

          The dots stay on top because the case is the subject and a spoke is
          context about it. Everything else the spokes cross is either a wash
          (the halos) or the mark at the far end of the line, and a line that
          disappeared under the thing it connects to would be worse than one
          drawn over it.

          Declared after the events source so `events-point` exists by the time
          these mount; MapLibre throws on a `beforeId` it cannot find.
        */}
        {showPattern && <DistancePatternLayers pattern={pattern} beforeId={POINT_LAYER.id} />}

        {/* Rendered only when a parent actually supplies these —
            `/investigate`'s plain usage never creates them, so its map is
            unchanged. */}
        {timePaths !== undefined && (
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
            <PopupType type={String(hover.props.type) as EventType} />
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
            <div className="pp-action">
              คลิกเพื่อปักหมุดและดูรูปแบบระยะทาง
              <IconChevronRight size={11} stroke={2.2} aria-hidden />
            </div>
          </Popup>
        )}

        {/*
          The pinned label. Same fields as the hover popup, plus the two things
          hover cannot offer: it stays put when the pointer leaves, so it can
          carry a real link to the case, and it has a close button.

          Rendered after the hover popup so that while the pointer still rests
          on the dot just clicked, the pinned one is the copy on top.
        */}
        {selected && (
          <Popup
            longitude={selected.lng}
            latitude={selected.lat}
            closeButton
            closeOnClick={false}
            // Closes the label and leaves the spokes drawn. The two answer
            // different questions — "what happened here" and "what is around
            // it" — and the label is the one that sits over the map it
            // describes, so dismissing it to see underneath must not also
            // throw away the pattern that was the reason for looking.
            onClose={() => setSelected(null)}
            className="palantir-popup"
            offset={10}
          >
            <div className="pp-title">{String(selected.props.title)}</div>
            <PopupType type={String(selected.props.type) as EventType} />
            <div className="pp-meta">
              อ.{String(selected.props.district)} จ.{String(selected.props.province)}
            </div>
            <div className="pp-meta">{hoverWhen(selected)}</div>
            <div className="pp-row">
              <span>ความรุนแรง</span>
              <b>{selected.props.severity}/5</b>
            </div>
            <div className="pp-row">
              <span>ความเชื่อมั่น</span>
              <b>{selected.props.confidence}%</b>
            </div>
            <div className="pp-row">
              <span>ความละเอียดพิกัด</span>
              <b>{PRECISION_LABEL[String(selected.props.precision)] ?? "ไม่ระบุ"}</b>
            </div>
            {showPattern && pattern && (
              <div className="pp-row">
                <span>หน่วยงานรอบจุด</span>
                <b>{pattern.summary.coverage}/32 ทิศ</b>
              </div>
            )}
            {/* A real link, not a router.push on the row: the case page is
                worth opening in a new tab, and middle-click and ⌘-click only
                work on an anchor. */}
            <Link href={caseHref(selected.id)} className="pp-action" prefetch={false}>
              เปิดหน้าเคส
              <IconChevronRight size={11} stroke={2.2} aria-hidden />
            </Link>
          </Popup>
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

        {/* Above the zoom cluster below it: the open list now reaches past
            `top-24`, and without this the later-in-DOM buttons paint over the
            bottom row and swallow the click that lands on it. */}
        <div className="pointer-events-auto absolute top-11 left-2 z-10 lg:left-3">
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

              <label className="mt-2 flex cursor-pointer items-start gap-2 text-[11.5px] text-ink-dim hover:text-ink">
                <input
                  type="checkbox"
                  checked={showFacilities}
                  onChange={() => setShowFacilities((v) => !v)}
                  className="mt-[2px] h-3.5 w-3.5 shrink-0 appearance-none rounded-[3px] border border-[rgba(90,140,190,0.7)] bg-transparent checked:border-azure checked:bg-azure checked:after:block checked:after:text-[10px] checked:after:leading-[13px] checked:after:font-bold checked:after:text-[#04070e] checked:after:content-['✓']"
                />
                <span>
                  <span className="flex items-center gap-1.5 text-ink">
                    <IconBuildingCommunity size={13} stroke={1.7} />
                    หน่วยงาน/เครือข่าย
                    {facilitiesLoading && <span className="text-ink-muted">(กำลังโหลด…)</span>}
                    {facilitiesFailed && <span className="text-amber">(โหลดไม่สำเร็จ)</span>}
                  </span>
                  <span className="mt-0.5 block text-[10px] leading-relaxed text-ink-muted">
                    ด่านตรวจ ตำรวจ กู้ภัย ดับเพลิง ศูนย์อพยพ และโรงพยาบาล — แสดงทั้งหมดเสมอ
                    ไม่ขึ้นกับตัวกรองเหตุการณ์
                  </span>
                </span>
              </label>

              <label
                className="mt-2 flex cursor-pointer items-start gap-2 text-[11.5px] text-ink-dim hover:text-ink"
                data-testid="distance-pattern-toggle"
              >
                <input
                  type="checkbox"
                  checked={showPattern}
                  onChange={() => setShowPattern((v) => !v)}
                  className="mt-[2px] h-3.5 w-3.5 shrink-0 appearance-none rounded-[3px] border border-[rgba(90,140,190,0.7)] bg-transparent checked:border-azure checked:bg-azure checked:after:block checked:after:text-[10px] checked:after:leading-[13px] checked:after:font-bold checked:after:text-[#04070e] checked:after:content-['✓']"
                />
                <span>
                  <span className="flex items-center gap-1.5 text-ink">
                    <IconCompass size={13} stroke={1.7} />
                    รูปแบบระยะทาง 32 ทิศ
                    {patternLoading && <span className="text-ink-muted">(กำลังโหลด…)</span>}
                    {patternFailed && <span className="text-amber">(โหลดไม่สำเร็จ)</span>}
                  </span>
                  <span className="mt-0.5 block text-[10px] leading-relaxed text-ink-muted">
                    {showPattern
                      ? "คลิกจุดเหตุการณ์เพื่อปักหมุด และดูว่าแต่ละทิศมีหน่วยงานใดใกล้ที่สุด — สีเส้นตามชนิดหน่วยงาน · ปิดป้ายได้โดยเส้นยังอยู่ · คลิกที่ว่างบนแผนที่เพื่อล้างทั้งหมด"
                      : "ปิดอยู่ — คลิกจุดเหตุการณ์ยังปักหมุดแสดงป้ายเคสได้ แต่จะไม่วาดเส้น 32 ทิศ"}
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
                        : "คำนวณเส้นทางบนโครงข่ายถนนจริงจากข้อมูล OSM เชื่อมเฉพาะเหตุในกลุ่มเดียวกัน (ทดลอง)"}
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
        <div className="pointer-events-auto absolute top-14 right-2 flex max-h-[calc(100%-4rem)] w-[152px] flex-col overflow-y-auto rounded border border-[rgba(56,100,150,0.45)] bg-[rgba(6,13,25,0.88)] p-2.5 lg:top-2.5 lg:right-2.5 lg:max-h-[calc(100%-1.25rem)] lg:w-[172px]">
          {/* Above the symbol key, because it describes the one thing the
              analyst just asked for — and it is the only part of the rail that
              changes with a click. Mounted only when there is something to
              say, so an empty block never pushes the key down. */}
          {showPattern && (patternLoading || pattern) && (
            <DistancePatternCard
              pattern={pattern}
              loading={patternLoading}
              onClear={() => setPatternEventId(null)}
            />
          )}
          {/* The layer is on, a case is chosen, and the batch simply has no
              row for it. Said plainly rather than left as a map that did
              nothing when clicked. */}
          {showPattern && patternEventId && !patternLoading && !pattern && !patternFailed && (
            <p className="mb-2 border-b border-amber/30 pb-2 text-[10px] leading-relaxed text-amber">
              ยังไม่มีรูปแบบระยะทางของเคสนี้ — รัน{" "}
              <code className="font-mono">run_distance_pattern.py</code> ใน ml-server/ ก่อน
            </p>
          )}

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
                <p className="flex items-center gap-1 text-[9.5px] tracking-wide text-ink-muted uppercase">
                  <g.Icon size={10} strokeWidth={2} className="shrink-0" aria-hidden />
                  {g.label}
                </p>
                <ul className="mt-0.5 space-y-1">
                  {g.types.map((l) => (
                    <li key={l.type} className="flex items-center gap-1.5 text-[10.5px] text-ink-dim">
                      {/* Dot then glyph, in that order and both in the type's
                          colour: the dot is what the map draws at every zoom,
                          the glyph what it adds once close enough to read one.
                          A legend that showed only the glyph would stop
                          explaining the marker the analyst is actually
                          looking at. */}
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ background: l.color, boxShadow: `0 0 5px ${l.color}` }}
                      />
                      <l.Icon
                        size={11}
                        strokeWidth={2}
                        className="shrink-0"
                        style={{ color: l.color }}
                        aria-hidden
                      />
                      {l.label}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
            {/* Basemap and boundary rows. The swatch stays — it is the only
                thing that says what weight and colour to look for — and the
                glyph names the kind of thing it is, which three near-identical
                hairlines cannot do on their own. */}
            <li className="flex items-center gap-1.5 pt-1 text-[10.5px] text-ink-dim">
              <span className="h-2 w-3 shrink-0 rounded-[1px] bg-[#0c3150] ring-1 ring-azure/70" />
              <MAP_LAYER_ICON.surveillance_area size={11} strokeWidth={2} className="shrink-0 text-azure" aria-hidden />
              พื้นที่เฝ้าระวัง 4 จังหวัด
            </li>
            <li className="flex items-center gap-1.5 text-[10.5px] text-ink-dim">
              <span className="h-2 w-3 shrink-0 rounded-[1px] bg-[#0a1826] ring-1 ring-[#1e3a5c]" />
              <MAP_LAYER_ICON.other_province size={11} strokeWidth={2} className="shrink-0 text-ink-muted" aria-hidden />
              จังหวัดอื่น
            </li>
            <li className="flex items-center gap-1.5 text-[10.5px] text-ink-dim">
              <span className="h-px w-3 shrink-0 bg-azure" />
              <MAP_LAYER_ICON.province_boundary size={11} strokeWidth={2} className="shrink-0 text-azure" aria-hidden />
              ขอบเขตจังหวัด
            </li>
            <li className="flex items-center gap-1.5 text-[10.5px] text-ink-dim">
              <span className="h-px w-3 shrink-0 bg-azure/50" />
              <MAP_LAYER_ICON.district_boundary size={11} strokeWidth={2} className="shrink-0 text-azure/60" aria-hidden />
              ขอบเขตอำเภอ
            </li>
            <li className="flex items-center gap-1.5 text-[10.5px] text-ink-dim">
              <span className="h-px w-3 shrink-0 bg-[#7dd3fc]/40" />
              <MAP_LAYER_ICON.subdistrict_boundary size={11} strokeWidth={2} className="shrink-0 text-[#7dd3fc]/60" aria-hidden />
              ขอบเขตตำบล
            </li>
            <li className="flex items-center gap-1.5 text-[10.5px] text-ink-dim">
              <span className="h-1 w-1 shrink-0 rounded-full bg-[#e2f2ff]" />
              <MAP_LAYER_ICON.osm_village size={11} strokeWidth={2} className="shrink-0 text-[#e2f2ff]" aria-hidden />
              หมู่บ้าน (OSM)
            </li>
            <li className="flex items-center gap-1.5 text-[10.5px] text-ink-dim">
              <span className="h-2 w-2 shrink-0 rounded-full border border-ink-muted" />
              <MAP_LAYER_ICON.uncertainty_boundary size={11} strokeWidth={2} className="shrink-0 text-ink-muted" aria-hidden />
              ขอบเขตความคลาดเคลื่อน
            </li>
            {showFacilities && <FacilityLegend variant="inline" />}
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

      {/* Never shown. The source React renders the type glyphs into so they can
          be rasterised for the map — see `map-event-icons.tsx`. */}
      <EventBadgeSprite ref={spriteRef} />
      <FacilityBadgeSprite ref={facilitySpriteRef} />
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

/**
 * The hovered dot's category, spelled out.
 *
 * The popup used to name the place, the time and three numbers but never what
 * kind of event it was — the colour of the dot was the only place that lived,
 * which is exactly the single-channel encoding this change is undoing.
 */
function PopupType({ type }: { type: EventType }) {
  const Icon = EVENT_ICON[type] ?? EVENT_ICON.other;
  const color = EVENT_COLOR[type] ?? EVENT_COLOR.other;
  return (
    <div
      className="pp-meta pp-type flex items-center gap-1.5"
      style={{ "--pp-type-color": color } as React.CSSProperties}
    >
      <Icon size={11} strokeWidth={2} className="shrink-0" aria-hidden />
      {EVENT_TYPE_LABEL[type] ?? type}
    </div>
  );
}

/** Popup timestamp, in the Buddhist-era calendar the rest of the UI uses. */
function hoverWhen(hover: HoverInfo): string {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    calendar: "buddhist",
  }).format(new Date(Number(hover.props.ts)));
}
