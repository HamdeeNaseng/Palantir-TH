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
import type { Facility } from "@/lib/facilities";
import {
  FACILITY_SELECTED_LAYER,
  FacilityHoverPopupBody,
  FacilityLegend,
  FacilityOverlay,
  facilityHitLayers,
  findFacilityHit,
  useFacilityBadges,
} from "@/lib/map-facility-layer";
import { FacilityBadgeSprite } from "@/lib/map-facility-icons";

/**
 * Where the response network is.
 *
 * The marks themselves — halo, dot, glyph, popup and key — live in
 * `map-facility-layer.tsx`, because `/investigate`, `/events` and `/map` now
 * draw the same ones and a second definition here would drift from them within
 * two changes. What stays local is what only this page does: a selection ring
 * driven by the list beside it, a click that selects rather than navigates, and
 * the fly-to that keeps the two in view of each other.
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
  const [satellite, setSatellite] = useState(SATELLITE_DEFAULT_ON);
  const [ready, setReady] = useState(false);
  const [hover, setHover] = useState<Facility | null>(null);

  const { spriteRef, badgesReady } = useFacilityBadges(mapRef, ready);

  const mapStyle = useMemo(() => style(), []);
  const byId = useMemo(() => new Map(facilities.map((f) => [f.id, f])), [facilities]);
  const hitLayers = useMemo(() => facilityHitLayers(badgesReady), [badgesReady]);

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

  /** Selecting from the list flies to it — otherwise the ring is off-screen. */
  useEffect(() => {
    const f = selectedId ? byId.get(selectedId) : undefined;
    const map = mapRef.current?.getMap();
    if (!f || !map) return;
    map.easeTo({ center: [f.lng, f.lat], zoom: Math.max(map.getZoom(), 11), duration: 600 });
  }, [selectedId, byId]);

  function handleMove(e: MapLayerMouseEvent) {
    const facility = findFacilityHit(e.features, byId, badgesReady);
    setHover((prev) => (prev?.id === facility?.id ? prev : facility));
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
        interactiveLayerIds={hitLayers}
        cursor={hover ? "pointer" : undefined}
        onLoad={() => setReady(true)}
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => {
          const facility = findFacilityHit(e.features, byId, badgesReady);
          if (facility) onSelect(facility.id);
        }}
        // MapLibre swallows style and source failures unless you listen.
        onError={(e) => console.error("[maplibre]", e.error?.message ?? String(e))}
      >
        <NavigationControl showCompass={false} position="top-right" />
        <AttributionControl compact position="bottom-right" />

        {/* No `beforeId`: on this page the facilities are the top mark. */}
        <FacilityOverlay facilities={facilities} badgesReady={badgesReady} />

        <Source id="facility-selected-src" type="geojson" data={selectedData}>
          <Layer {...FACILITY_SELECTED_LAYER} />
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
            <FacilityHoverPopupBody
              facility={hover}
              action="คลิกเพื่อดูรายละเอียดและประสานงาน"
            />
          </Popup>
        )}
      </MapGL>

      <FacilityLegend variant="floating" />

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
