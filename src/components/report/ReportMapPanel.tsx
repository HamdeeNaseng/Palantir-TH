"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
// Imported under a different name: `Map` here would shadow the global the
// `byId` indexes below are built with.
import MapGL, {
  AttributionControl,
  Layer,
  NavigationControl,
  Popup,
  Source,
  type LayerProps,
  type MapLayerMouseEvent,
  type MapRef,
} from "react-map-gl/maplibre";
import type { LngLatBoundsLike, StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { IconBuildingHospital, IconSatellite } from "@tabler/icons-react";
import {
  SATELLITE_DEFAULT_ON,
  SATELLITE_SOURCE_ID,
  satelliteLayer,
  satelliteSource,
  setSatelliteBasemap,
  type BasemapFill,
} from "@/lib/basemap";
import { formatThaiDate } from "@/lib/datetime";
import { EVENT_ICON } from "@/lib/event-icons";
import { EVENT_TYPE_LABEL } from "@/lib/labels";
import { EVENT_COLOR } from "@/lib/palette";
import {
  EVENT_BADGE_LAYER,
  EventBadgeSprite,
  addEventBadgeImages,
  buildEventBadgeImages,
} from "@/lib/map-event-icons";
import {
  FacilityHoverPopupBody,
  FacilityLegend,
  FacilityOverlay,
  facilityHitLayers,
  findFacilityHit,
  facilityIndex,
  useFacilityBadges,
} from "@/lib/map-facility-layer";
import { FacilityBadgeSprite } from "@/lib/map-facility-icons";
import { MapFullscreenButton, useMapFullscreen } from "@/lib/map-fullscreen";
import { useFacilities } from "@/lib/use-facilities";
import type { EventType } from "@/lib/types";
import type { EventFeature, EventFeatureCollection } from "@/server/shared-events";

/**
 * Where the citizen reports are, next to the network that would respond to
 * them.
 *
 * Two mark sets and nothing else. Every other console on this app draws the
 * whole corpus — 10k records from a dozen sources — and a citizen looking for
 * "has anyone else reported this" cannot find their own street in that. The
 * server hands this component only `src_citizen` submissions, already narrowed
 * by whatever the sidebar is set to, so the map, the count above the table and
 * the table itself can never disagree about what is being shown.
 *
 * The facilities are the second half of the question. A report is worth filing
 * because someone can act on it, and the โรงพยาบาล/สถานีตำรวจ pins say who is
 * near enough to. They are drawn from the same shared layer as `/network`,
 * `/investigate` and `/map`, so the glyphs mean the same thing everywhere.
 */

const SATELLITE_FILLS: readonly BasemapFill[] = [
  { layer: "thailand-fill", plain: 0.85, satellite: 0 },
  { layer: "province-fill", plain: 0.32, satellite: 0.12 },
];

/** The four provinces, used whenever there is nothing to frame instead. */
const BOUNDS: [[number, number], [number, number]] = [
  [99.95, 5.5],
  [102.2, 8.05],
];

const FIT_PADDING = 48;

/** Past this a single report would be framed at building zoom. */
const MAX_FIT_ZOOM = 13;

function style(): StyleSpecification {
  return {
    version: 8,
    sources: {
      thailand: { type: "geojson", data: "/data/thailand-provinces.geojson" },
      provinces: { type: "geojson", data: "/data/south-provinces.geojson" },
      districts: { type: "geojson", data: "/data/south-districts.geojson" },
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
        id: "province-fill",
        type: "fill",
        source: "provinces",
        paint: { "fill-color": "#12507f", "fill-opacity": 0.32 },
      },
      {
        id: "district-outline",
        type: "line",
        source: "districts",
        paint: { "line-color": "#38bdf8", "line-width": 0.6, "line-opacity": 0.4 },
      },
      {
        id: "province-outline",
        type: "line",
        source: "provinces",
        paint: { "line-color": "#38bdf8", "line-width": 1.4, "line-opacity": 0.9 },
      },
    ],
  };
}

/**
 * How far off the point might be, in metres converted to pixels.
 *
 * Kept even on a map this small, because it is the difference between the two
 * kinds of mark here: a pin dropped at the scene is worth a few metres, and a
 * report filed with no pin sits on its อำเภอ's representative point and covers
 * most of the district. Drawn as a ring rather than a fuzzy blob so it reads as
 * "somewhere in here", and faded out above street zoom where it would swamp
 * the very street the reader came to look at.
 */
const UNCERTAINTY_LAYER = {
  id: "report-uncertainty",
  type: "circle",
  paint: {
    "circle-color": "transparent",
    "circle-stroke-color": ["get", "color"],
    "circle-stroke-width": 0.8,
    "circle-stroke-opacity": [
      "interpolate", ["linear"], ["zoom"],
      9, 0.42,
      11, 0.34,
      12.5, 0,
    ],
    "circle-radius": [
      "interpolate", ["exponential", 2], ["zoom"],
      9, ["/", ["get", "precision_m"], 120],
      14, ["/", ["get", "precision_m"], 4],
    ],
  },
} satisfies LayerProps;

/**
 * A ring under every report, and the reason this map is readable at all.
 *
 * The response network is ~217 pins across four provinces; three citizen
 * reports drawn as 4px dots among them are three dots among two hundred. The
 * halo does not add information — it says which of the two mark sets this page
 * is actually about, so the context cannot outshout the subject.
 */
const HALO_LAYER = {
  id: "report-halo",
  type: "circle",
  paint: {
    "circle-color": ["get", "color"],
    "circle-opacity": 0.16,
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 10, 12, 24],
    "circle-stroke-color": ["get", "color"],
    "circle-stroke-width": 1,
    "circle-stroke-opacity": 0.55,
  },
} satisfies LayerProps;

/** Same paint as the dots on `/investigate`, so one mark means one thing. */
const POINT_LAYER = {
  id: "report-point",
  type: "circle",
  paint: {
    "circle-color": ["get", "color"],
    "circle-radius": [
      "interpolate", ["linear"], ["zoom"],
      6, ["interpolate", ["linear"], ["get", "severity"], 1, 3.5, 5, 6],
      12, ["interpolate", ["linear"], ["get", "severity"], 1, 6, 5, 12],
    ],
    "circle-opacity": 0.92,
    "circle-stroke-color": "#ffffff",
    "circle-stroke-width": 0.9,
    "circle-stroke-opacity": 0.75,
  },
} satisfies LayerProps;

/** Bounding box of the marks, or the four provinces when there are none. */
function boundsOf(features: EventFeature[]): LngLatBoundsLike {
  if (features.length === 0) return BOUNDS;

  let [w, s, e, n] = [180, 90, -180, -90];
  for (const f of features) {
    const [lng, lat] = f.geometry.coordinates;
    if (lng < w) w = lng;
    if (lng > e) e = lng;
    if (lat < s) s = lat;
    if (lat > n) n = lat;
  }

  // A single report has no extent, so `fitBounds` would zoom to its maximum.
  // Padding the box by ~1.1 km gives it a neighbourhood to sit in.
  const pad = 0.01;
  return [
    [w - pad, s - pad],
    [e + pad, n + pad],
  ];
}

type Hover =
  | { kind: "report"; feature: EventFeature }
  | { kind: "facility"; id: string }
  | null;

export default function ReportMapPanel({
  points,
  plotted,
  unplaced,
  truncated,
  live,
  filtered,
  backRef,
}: {
  points: EventFeatureCollection;
  plotted: number;
  unplaced: number;
  truncated: boolean;
  live: boolean;
  /** Whether the sidebar is narrowing the set — changes what "0" means. */
  filtered: boolean;
  /** `?ref=` trail so a case opened from here can come back to this view. */
  backRef: string;
}) {
  const router = useRouter();
  const mapRef = useRef<MapRef | null>(null);
  const [satellite, setSatellite] = useState(SATELLITE_DEFAULT_ON);
  const [ready, setReady] = useState(false);
  const [showFacilities, setShowFacilities] = useState(true);
  const [hover, setHover] = useState<Hover>(null);

  const { fullscreen, toggle: toggleFullscreen, shellClass } = useMapFullscreen(mapRef);

  const { facilities, failed: facilitiesFailed } = useFacilities(showFacilities);
  const { spriteRef: facilitySpriteRef, badgesReady: facilityBadgesReady } = useFacilityBadges(
    mapRef,
    ready,
  );
  const facilityById = useMemo(() => facilityIndex(facilities), [facilities]);

  // The event glyphs are rasterised the same way the facility ones are, but
  // from this component's own sprite — `useFacilityBadges` only owns its set.
  const eventSpriteRef = useRef<HTMLDivElement | null>(null);
  const [eventBadgesReady, setEventBadgesReady] = useState(false);

  const mapStyle = useMemo(() => style(), []);
  const features = points.features;

  useEffect(() => {
    const map = mapRef.current?.getMap();
    const container = eventSpriteRef.current;
    if (!map || !ready || !container) return;

    let cancelled = false;
    buildEventBadgeImages(container)
      .then((badges) => {
        if (cancelled) return;
        addEventBadgeImages(map, badges);
        setEventBadgesReady(true);
      })
      .catch((err) => console.error("[report-map] badge rasterise failed", err));

    return () => {
      cancelled = true;
    };
  }, [ready]);

  // Imagery lives in the base style, so it is toggled through the instance
  // rather than through this tree; `ready` gates it until the style has loaded.
  useEffect(() => {
    const m = mapRef.current?.getMap();
    if (!m || !ready) return;
    setSatelliteBasemap(m, satellite, SATELLITE_FILLS);
  }, [satellite, ready]);

  /**
   * Follow the filters. `/report` is a server component reading the filter set
   * out of the URL, so a sidebar change arrives here as a new `points` prop —
   * and a map still framed on the previous selection would be showing the
   * right marks in the wrong place. Refit whenever the set changes, and never
   * past `MAX_FIT_ZOOM`, so narrowing to one report gives its neighbourhood
   * rather than its roof.
   */
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !ready) return;
    map.fitBounds(boundsOf(features), {
      padding: FIT_PADDING,
      maxZoom: MAX_FIT_ZOOM,
      duration: 600,
    });
  }, [features, ready]);

  const interactiveLayerIds = useMemo(
    () => [
      POINT_LAYER.id,
      ...(eventBadgesReady ? [EVENT_BADGE_LAYER.id] : []),
      ...(showFacilities ? facilityHitLayers(facilityBadgesReady) : []),
    ],
    [eventBadgesReady, showFacilities, facilityBadgesReady],
  );

  /** Reports win a tie: this is their map, the facilities are the context. */
  function hitAt(e: MapLayerMouseEvent): Hover {
    const report = e.features?.find(
      (f) => f.layer.id === POINT_LAYER.id || f.layer.id === EVENT_BADGE_LAYER.id,
    );
    if (report) {
      const id = report.properties?.id as string | undefined;
      const feature = id ? features.find((f) => f.properties.id === id) : undefined;
      if (feature) return { kind: "report", feature };
    }
    const facility = findFacilityHit(e.features, facilityById, facilityBadgesReady);
    return facility ? { kind: "facility", id: facility.id } : null;
  }

  const hoveredFacility = hover?.kind === "facility" ? facilityById.get(hover.id) : undefined;

  return (
    <section className={shellClass("panel relative flex shrink-0 flex-col", "flex flex-col")}>
      {!fullscreen && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5">
          <div className="min-w-0">
            <h2 className="panel-title whitespace-nowrap">แผนที่รายงานจากประชาชน</h2>
            <p className="text-[10.5px] leading-relaxed text-ink-muted">
              เฉพาะเรื่องที่ประชาชนแจ้งเข้ามา พร้อมจุดของเครือข่ายตอบสนองที่อยู่ใกล้เคียง
            </p>
          </div>
          <p className="num ml-auto text-[10.5px] whitespace-nowrap text-ink-dim">
            {plotted.toLocaleString("en-US")} จุดบนแผนที่
          </p>
        </div>
      )}

      {/* Never shown. The sources React renders the glyphs into so they can be
          rasterised for the map — see `map-badges.tsx`. */}
      <EventBadgeSprite ref={eventSpriteRef} />
      <FacilityBadgeSprite ref={facilitySpriteRef} />

      {/* Sized with width/height 100% on a fixed-height box rather than
          `absolute inset-0`: maplibre-gl.css forces `position: relative` on
          its container, which cancels the insets and collapses the box to zero
          height with no error anywhere. */}
      <div
        className={`relative w-full ${
          fullscreen ? "min-h-0 flex-1" : "h-[340px] sm:h-[420px]"
        }`}
      >
        <MapGL
          ref={mapRef}
          initialViewState={{ bounds: boundsOf(features), fitBoundsOptions: { padding: FIT_PADDING, maxZoom: MAX_FIT_ZOOM } }}
          mapStyle={mapStyle}
          style={{ width: "100%", height: "100%" }}
          attributionControl={false}
          dragRotate={false}
          interactiveLayerIds={interactiveLayerIds}
          cursor={hover ? "pointer" : undefined}
          onLoad={() => setReady(true)}
          onMouseMove={(e) => {
            const next = hitAt(e);
            setHover((prev) => {
              if (prev === null && next === null) return prev;
              if (prev?.kind === "report" && next?.kind === "report") {
                return prev.feature.properties.id === next.feature.properties.id ? prev : next;
              }
              if (prev?.kind === "facility" && next?.kind === "facility") {
                return prev.id === next.id ? prev : next;
              }
              return next;
            });
          }}
          onMouseLeave={() => setHover(null)}
          onClick={(e) => {
            const hit = hitAt(e);
            // Only reports lead anywhere from this page. A facility pin is
            // context for a citizen, not a record they have business opening.
            if (hit?.kind === "report") {
              router.push(`/cases/${encodeURIComponent(hit.feature.properties.id)}${backRef}`);
            }
          }}
          // MapLibre swallows style and source failures unless you listen.
          onError={(e) => console.error("[maplibre]", e.error?.message ?? String(e))}
        >
          <NavigationControl showCompass={false} position="top-right" />
          <AttributionControl compact position="bottom-right" />

          {showFacilities && (
            <FacilityOverlay facilities={facilities} badgesReady={facilityBadgesReady} />
          )}

          {/* After the facilities, so a report is never buried under the
              context drawn to explain it. */}
          <Source id="report-points" type="geojson" data={points}>
            <Layer {...UNCERTAINTY_LAYER} />
            <Layer {...HALO_LAYER} />
            <Layer {...POINT_LAYER} />
            {eventBadgesReady && <Layer {...EVENT_BADGE_LAYER} />}
          </Source>

          {hover?.kind === "report" && (
            <Popup
              longitude={hover.feature.geometry.coordinates[0]}
              latitude={hover.feature.geometry.coordinates[1]}
              closeButton={false}
              closeOnClick={false}
              className="palantir-popup"
              offset={12}
            >
              <div className="pp-title">{hover.feature.properties.title}</div>
              <PopupType type={hover.feature.properties.type} />
              <div className="pp-meta">{formatThaiDate(new Date(hover.feature.properties.ts))}</div>
              <div className="pp-row">
                <span>พื้นที่</span>
                <b>
                  อ.{hover.feature.properties.district} จ.{hover.feature.properties.province}
                </b>
              </div>
              <div className="pp-action">คลิกเพื่อดูรายละเอียดรายงาน</div>
            </Popup>
          )}

          {hoveredFacility && (
            <Popup
              longitude={hoveredFacility.lng}
              latitude={hoveredFacility.lat}
              closeButton={false}
              closeOnClick={false}
              className="palantir-popup"
              offset={12}
            >
              <FacilityHoverPopupBody
                facility={hoveredFacility}
                action="จุดของเครือข่ายตอบสนองที่อยู่ใกล้เคียง"
              />
            </Popup>
          )}
        </MapGL>

        <button
          type="button"
          onClick={() => setSatellite((v) => !v)}
          aria-pressed={satellite}
          title="สลับภาพถ่ายดาวเทียม"
          className={`absolute top-2.5 z-10 flex items-center gap-1.5 rounded border px-2 py-1 text-[10.5px] ${
            fullscreen ? "left-[92px]" : "left-2.5"
          } ${
            satellite
              ? "border-azure bg-[rgba(56,189,248,0.18)] text-azure"
              : "border-[rgba(56,100,150,0.5)] bg-[rgba(6,13,25,0.85)] text-ink-dim hover:text-ink"
          }`}
        >
          <IconSatellite size={12} stroke={1.7} />
          ดาวเทียม
        </button>

        <button
          type="button"
          onClick={() => setShowFacilities((v) => !v)}
          aria-pressed={showFacilities}
          disabled={facilitiesFailed}
          title={
            facilitiesFailed
              ? "โหลดข้อมูลเครือข่ายไม่สำเร็จ"
              : "แสดง/ซ่อนจุดของเครือข่ายตอบสนอง"
          }
          className={`absolute top-11 z-10 flex items-center gap-1.5 rounded border px-2 py-1 text-[10.5px] disabled:opacity-50 ${
            fullscreen ? "left-[92px]" : "left-2.5"
          } ${
            showFacilities && !facilitiesFailed
              ? "border-azure bg-[rgba(56,189,248,0.18)] text-azure"
              : "border-[rgba(56,100,150,0.5)] bg-[rgba(6,13,25,0.85)] text-ink-dim hover:text-ink"
          }`}
        >
          <IconBuildingHospital size={12} stroke={1.7} />
          เครือข่าย
        </button>

        {/* Bottom-LEFT here, unlike the other consoles: this map is short, its
            bottom-right already carries MapLibre's attribution, and the
            full-screen control has the better claim to the free corner. */}
        {showFacilities && !facilitiesFailed && (
          <FacilityLegend variant="floating" positionClass="left-2.5 bottom-2.5" />
        )}

        <MapFullscreenButton fullscreen={fullscreen} onToggle={toggleFullscreen} />

        {/* The three nothings, told apart — the same distinction the table's
            own empty state makes, because a blank map is just as ambiguous. */}
        {plotted === 0 && (
          <div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center px-6">
            <p className="pointer-events-auto max-w-sm rounded border border-[rgba(56,100,150,0.5)] bg-[rgba(6,13,25,0.9)] px-3 py-2 text-center text-[11.5px] leading-relaxed text-ink-dim">
              {!live
                ? "เชื่อมต่อฐานข้อมูลไม่ได้ จึงยังไม่มีจุดที่จะแสดง"
                : filtered
                  ? "ไม่มีรายงานที่ตรงกับตัวกรองในพื้นที่นี้"
                  : "ยังไม่มีรายงานจากประชาชนที่ระบุพิกัด"}
            </p>
          </div>
        )}
      </div>

      {/* Provenance, and what is not on the map. */}
      <p className="flex flex-wrap items-center gap-x-2 px-3.5 py-1.5 text-[9.5px] text-ink-muted">
        <span>ขอบเขตการปกครอง: กรมป้องกันและบรรเทาสาธารณภัย (DDPM)</span>
        {unplaced > 0 && (
          <>
            <span className="text-ink-muted/50">·</span>
            {/* Stated, not hidden: these reports matched the filters and are
                drawn nowhere. */}
            <span className="text-amber">
              <span className="num">{unplaced.toLocaleString("en-US")}</span>{" "}
              รายงานไม่มีพิกัด จึงไม่ปรากฏบนแผนที่
            </span>
          </>
        )}
        {truncated && (
          <>
            <span className="text-ink-muted/50">·</span>
            <span className="text-amber">แสดงเฉพาะจุดแรก ๆ เท่านั้น กรุณากรองให้แคบลง</span>
          </>
        )}
        {facilitiesFailed && (
          <>
            <span className="text-ink-muted/50">·</span>
            <span className="text-amber">โหลดจุดเครือข่ายตอบสนองไม่สำเร็จ</span>
          </>
        )}
      </p>
    </section>
  );
}

/**
 * The hovered report's category, spelled out — same row, same colour handling
 * as the popup on `/investigate`, so a reader who has seen one has seen both.
 * `--pp-type-color` rather than `color`: the stylesheet mixes it toward ink
 * until it clears contrast on the popup's white card.
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
