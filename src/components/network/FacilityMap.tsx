"use client";

import { useEffect, useMemo, useRef, useState } from "react";
// Imported under a different name: `Map` here would shadow the global the
// `byId` index below is built with.
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
import type { StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { IconSatellite } from "@tabler/icons-react";
import {
  SATELLITE_DEFAULT_ON,
  SATELLITE_SOURCE_ID,
  satelliteLayer,
  satelliteSource,
  setSatelliteBasemap,
  type BasemapFill,
} from "@/lib/basemap";
import {
  FACILITY_COLOR,
  FACILITY_ICON,
  FACILITY_KINDS,
  FACILITY_LABEL,
  FACILITY_STATUS_COLOR,
  FACILITY_STATUS_LABEL,
  facilityName,
  type Facility,
  type FacilityKind,
} from "@/lib/facilities";
import {
  addFacilityBadgeImages,
  buildFacilityBadgeImages,
  FACILITY_BADGE_LAYER,
  FacilityBadgeSprite,
} from "@/lib/map-facility-icons";

/**
 * Where the response network is.
 *
 * Two rings per facility, and the split is the point: the inner dot is *what*
 * it is (kind colour, the same one the list and the filter chips use) and the
 * halo is *whether it is open* (status colour). An operations desk reads them
 * in that order — find the fire stations, then see which one is answering —
 * and one combined colour could not carry both without inventing eighteen
 * hues nobody can hold in their head.
 */

const SATELLITE_FILLS: readonly BasemapFill[] = [
  { layer: "thailand-fill", plain: 0.85, satellite: 0 },
  { layer: "province-fill", plain: 0.32, satellite: 0.12 },
];

const BOUNDS: [[number, number], [number, number]] = [
  [99.95, 5.5],
  [102.2, 8.05],
];

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

const HALO_LAYER = {
  id: "facility-halo",
  type: "circle",
  paint: {
    "circle-color": ["get", "status_color"],
    "circle-opacity": 0.22,
    "circle-stroke-color": ["get", "status_color"],
    "circle-stroke-opacity": 0.7,
    "circle-stroke-width": 1,
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 7, 6, 12, 13],
  },
} satisfies LayerProps;

const DOT_LAYER = {
  id: "facility-dot",
  type: "circle",
  paint: {
    "circle-color": ["get", "color"],
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 7, 2.6, 12, 5.5],
    "circle-stroke-color": "#04070e",
    "circle-stroke-width": 1,
  },
} satisfies LayerProps;

/** The one the list has selected — a ring, so the dot underneath stays readable. */
const SELECTED_LAYER = {
  id: "facility-selected",
  type: "circle",
  paint: {
    "circle-color": "transparent",
    "circle-stroke-color": "#ffffff",
    "circle-stroke-width": 2,
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 7, 9, 12, 17],
  },
} satisfies LayerProps;

const HIT_LAYERS = ["facility-dot", "facility-halo"];

export default function FacilityMap({
  facilities,
  selectedId,
  onSelect,
}: {
  facilities: Facility[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const mapRef = useRef<MapRef | null>(null);
  const spriteRef = useRef<HTMLDivElement | null>(null);
  const [satellite, setSatellite] = useState(SATELLITE_DEFAULT_ON);
  const [ready, setReady] = useState(false);
  const [badgesReady, setBadgesReady] = useState(false);
  const [hover, setHover] = useState<{ lng: number; lat: number; props: Facility } | null>(null);

  const mapStyle = useMemo(() => style(), []);
  const byId = useMemo(() => new Map(facilities.map((f) => [f.id, f])), [facilities]);

  const data = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: facilities.map((f) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [f.lng, f.lat] },
        properties: {
          id: f.id,
          kind: f.kind,
          color: FACILITY_COLOR[f.kind],
          status_color: FACILITY_STATUS_COLOR[f.status],
          // 0 wins a collision — a facility somebody has actually reported on
          // keeps its glyph over one nobody has touched.
          status_rank: f.status === "unknown" ? 1 : 0,
        },
      })),
    }),
    [facilities],
  );

  const selectedData = useMemo(() => {
    const f = selectedId ? byId.get(selectedId) : undefined;
    return {
      type: "FeatureCollection" as const,
      features: f
        ? [
            {
              type: "Feature" as const,
              geometry: { type: "Point" as const, coordinates: [f.lng, f.lat] },
              properties: {},
            },
          ]
        : [],
    };
  }, [selectedId, byId]);

  // Imagery lives in the base style, so it is toggled through the instance
  // rather than through this tree; `ready` gates it until the style has loaded.
  useEffect(() => {
    const m = mapRef.current?.getMap();
    if (!m || !ready) return;
    setSatelliteBasemap(m, satellite, SATELLITE_FILLS);
  }, [satellite, ready]);

  /**
   * Rasterise the Lucide glyphs once the style is up, then mount the symbol
   * layer. Split in two because decoding is asynchronous and the map may be
   * gone by the time it finishes — `cancelled` is what keeps this from writing
   * into an unmounted instance.
   */
  useEffect(() => {
    if (!ready || !spriteRef.current) return;
    let cancelled = false;

    buildFacilityBadgeImages(spriteRef.current)
      .then((badges) => {
        const map = mapRef.current?.getMap();
        if (cancelled || !map) return;
        addFacilityBadgeImages(map, badges);
        setBadgesReady(true);
      })
      .catch((err) => console.error("[maplibre] facility badge icons", err));

    return () => {
      cancelled = true;
    };
  }, [ready]);

  /** Selecting from the list flies to it — otherwise the ring is off-screen. */
  useEffect(() => {
    const f = selectedId ? byId.get(selectedId) : undefined;
    const map = mapRef.current?.getMap();
    if (!f || !map) return;
    map.easeTo({ center: [f.lng, f.lat], zoom: Math.max(map.getZoom(), 11), duration: 600 });
  }, [selectedId, byId]);

  function handleMove(e: MapLayerMouseEvent) {
    const hit = e.features?.find((f) => HIT_LAYERS.includes(f.layer.id));
    if (!hit) {
      setHover(null);
      return;
    }
    const facility = byId.get(String(hit.properties?.id));
    if (!facility) return;
    setHover((prev) =>
      prev?.props.id === facility.id
        ? prev
        : { lng: facility.lng, lat: facility.lat, props: facility },
    );
  }

  return (
    <div className="relative h-full w-full">
      {/* Off-screen source of the badge images — see `map-badges.tsx`. */}
      <FacilityBadgeSprite ref={spriteRef} />

      <MapGL
        ref={mapRef}
        initialViewState={{ bounds: BOUNDS, fitBoundsOptions: { padding: 24 } }}
        mapStyle={mapStyle}
        style={{ width: "100%", height: "100%" }}
        attributionControl={false}
        dragRotate={false}
        interactiveLayerIds={HIT_LAYERS}
        cursor={hover ? "pointer" : undefined}
        onLoad={() => setReady(true)}
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => {
          const hit = e.features?.find((f) => HIT_LAYERS.includes(f.layer.id));
          if (hit) onSelect(String(hit.properties?.id));
        }}
        // MapLibre swallows style and source failures unless you listen.
        onError={(e) => console.error("[maplibre]", e.error?.message ?? String(e))}
      >
        <NavigationControl showCompass={false} position="top-right" />
        <AttributionControl compact position="bottom-right" />

        <Source id="facilities" type="geojson" data={data}>
          <Layer {...HALO_LAYER} />
          <Layer {...DOT_LAYER} />
          {badgesReady && <Layer {...FACILITY_BADGE_LAYER} />}
        </Source>
        <Source id="facility-selected-src" type="geojson" data={selectedData}>
          <Layer {...SELECTED_LAYER} />
        </Source>

        {hover && (
          <Popup
            longitude={hover.lng}
            latitude={hover.lat}
            closeButton={false}
            closeOnClick={false}
            className="palantir-popup"
            offset={12}
          >
            <div className="pp-title">{facilityName(hover.props)}</div>
            <div
              className="pp-meta pp-type"
              style={{ "--pp-type-color": FACILITY_COLOR[hover.props.kind] } as React.CSSProperties}
            >
              {FACILITY_LABEL[hover.props.kind]}
            </div>
            <div className="pp-meta">
              อ.{hover.props.district} จ.{hover.props.province}
            </div>
            <div className="pp-row">
              <span>สถานะ</span>
              <b>{FACILITY_STATUS_LABEL[hover.props.status]}</b>
            </div>
            <div className="pp-action">คลิกเพื่อดูรายละเอียดและประสานงาน</div>
          </Popup>
        )}
      </MapGL>

      {/* The glyphs are only readable with the key beside them — nine icons is
          past what anyone decodes from memory. */}
      <div className="pointer-events-none absolute right-2.5 bottom-8 hidden max-w-[150px] rounded border border-[rgba(37,66,102,0.7)] bg-[rgba(6,13,25,0.86)] px-2 py-1.5 lg:block">
        <p className="mb-1 text-[9.5px] text-ink-muted">สัญลักษณ์</p>
        <ul className="flex flex-col gap-0.5">
          {(FACILITY_KINDS as readonly FacilityKind[]).map((kind) => {
            const Icon = FACILITY_ICON[kind];
            return (
              <li key={kind} className="flex items-center gap-1.5 text-[10px] text-ink-dim">
                <Icon
                  size={11}
                  strokeWidth={2}
                  className="shrink-0"
                  style={{ color: FACILITY_COLOR[kind] }}
                  aria-hidden
                />
                {FACILITY_LABEL[kind]}
              </li>
            );
          })}
        </ul>
        <div className="mt-1.5 border-t border-[rgba(37,66,102,0.6)] pt-1.5">
          <p className="mb-1 text-[9.5px] text-ink-muted">วงรอบ = สถานะ</p>
          <ul className="flex flex-col gap-0.5">
            {(["open", "closed", "unknown"] as const).map((s) => (
              <li key={s} className="flex items-center gap-1.5 text-[10px] text-ink-dim">
                <span
                  className="h-2 w-2 shrink-0 rounded-full border"
                  style={{
                    borderColor: FACILITY_STATUS_COLOR[s],
                    background: `${FACILITY_STATUS_COLOR[s]}44`,
                  }}
                />
                {FACILITY_STATUS_LABEL[s]}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setSatellite((v) => !v)}
        aria-pressed={satellite}
        title="สลับภาพถ่ายดาวเทียม"
        className={`absolute top-2.5 left-2.5 flex items-center gap-1.5 rounded border px-2 py-1 text-[10.5px] ${
          satellite
            ? "border-azure bg-[rgba(56,189,248,0.18)] text-azure"
            : "border-[rgba(56,100,150,0.5)] bg-[rgba(6,13,25,0.85)] text-ink-dim hover:text-ink"
        }`}
      >
        <IconSatellite size={12} stroke={1.7} />
        ดาวเทียม
      </button>
    </div>
  );
}
