"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Map, {
  AttributionControl,
  Layer,
  NavigationControl,
  Source,
  type LayerProps,
  type MapRef,
} from "react-map-gl/maplibre";
import type { StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { IconSatellite } from "@tabler/icons-react";
import {
  SATELLITE_SOURCE_ID,
  satelliteLayer,
  satelliteSource,
  setSatelliteBasemap,
  type BasemapFill,
} from "@/lib/basemap";

/**
 * Where one case was placed on the map.
 *
 * The uncertainty ring is the point of this component, not decoration. Almost
 * every record in the collection is geocoded to an อำเภอ centroid, which draws
 * as a pin that looks like a GPS fix and is not one. The ring is sized from the
 * record's own `precision_m`, so the drawing shows how much of the district the
 * claim actually covers.
 *
 * Boundaries are the DDPM polygons already served from /data. Satellite
 * imagery is available but off by default, for the same reason as the
 * dashboard map — no tile key is configured and none should be required to
 * view a case. Turned on, it is what shows whether a district-centroid pin is
 * sitting on a town or on a rubber plantation, which is exactly the question
 * the uncertainty ring raises.
 */

const SATELLITE_FILLS: readonly BasemapFill[] = [
  { layer: "thailand-fill", plain: 0.85, satellite: 0 },
  { layer: "province-fill", plain: 0.32, satellite: 0.12 },
];

/**
 * Zoom at which ตำบล and หมู่บ้าน are worth fetching — see the same constant in
 * MapPanel. A case pinned to an อำเภอ centroid opens well below this, so the
 * ~1 MB of fine detail is only pulled for the cases precise enough to use it.
 */
const DETAIL_MIN_ZOOM = 10;

const SUBDISTRICT_OUTLINE_LAYER = {
  id: "subdistrict-outline",
  type: "line",
  minzoom: DETAIL_MIN_ZOOM,
  paint: {
    "line-color": "#7dd3fc",
    "line-width": 0.4,
    "line-opacity": ["interpolate", ["linear"], ["zoom"], 10, 0, 11.5, 0.35],
  },
} satisfies LayerProps;

const VILLAGE_LAYER = {
  id: "village-point",
  type: "circle",
  minzoom: 11,
  paint: {
    "circle-color": "#e2f2ff",
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 1.4, 15, 3],
    "circle-opacity": ["interpolate", ["linear"], ["zoom"], 11, 0.35, 14, 0.8],
  },
} satisfies LayerProps;

const M_PER_DEG_LAT = 111_320;

function boundsAround(lng: number, lat: number, metres: number): [[number, number], [number, number]] {
  // Show roughly three times the uncertainty so the ring sits inside the frame
  // with the surrounding district visible around it.
  const span = Math.max(metres, 400) * 3;
  const dLat = span / M_PER_DEG_LAT;
  const dLng = span / (M_PER_DEG_LAT * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  return [
    [lng - dLng, lat - dLat],
    [lng + dLng, lat + dLat],
  ];
}

/**
 * Administrative context only. The case's own point is a `<Source>` in the
 * tree below, so it re-renders from props instead of forcing the whole style
 * to be rebuilt every time the parent passes a different case.
 */
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
        paint: { "line-color": "#38bdf8", "line-width": 0.6, "line-opacity": 0.45 },
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

const UNCERTAINTY_LAYER = {
  id: "here-uncertainty",
  type: "circle",
  paint: {
    "circle-color": ["get", "color"],
    "circle-opacity": 0.1,
    "circle-stroke-color": ["get", "color"],
    "circle-stroke-opacity": 0.45,
    "circle-stroke-width": 1,
    // metres -> pixels, following MapLibre's exponential zoom scaling.
    "circle-radius": [
      "interpolate", ["exponential", 2], ["zoom"],
      8, ["/", ["get", "precision_m"], 480],
      15, ["/", ["get", "precision_m"], 3.75],
    ],
  },
} satisfies LayerProps;

const POINT_LAYER = {
  id: "here-point",
  type: "circle",
  paint: {
    "circle-color": ["get", "color"],
    "circle-radius": 5,
    "circle-stroke-color": "#ffffff",
    "circle-stroke-width": 1.2,
    "circle-stroke-opacity": 0.85,
  },
} satisfies LayerProps;

export default function CaseLocationMap({
  lng,
  lat,
  precisionM,
  color,
}: {
  lng: number;
  lat: number;
  precisionM: number;
  color: string;
}) {
  const mapRef = useRef<MapRef | null>(null);
  const [satellite, setSatellite] = useState(false);
  const [detail, setDetail] = useState(false);

  // Built once: the base style carries no case-specific data any more, so it
  // never needs re-issuing to MapLibre.
  const mapStyle = useMemo(() => style(), []);

  const here = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: [
        {
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [lng, lat] },
          properties: { precision_m: precisionM, color },
        },
      ],
    }),
    [lng, lat, precisionM, color],
  );

  const applySatellite = useCallback((next: boolean) => {
    const map = mapRef.current?.getMap();
    if (map) setSatelliteBasemap(map, next, SATELLITE_FILLS);
    setSatellite(next);
  }, []);

  return (
    <div className="relative h-full w-full">
      <Map
        ref={mapRef}
        initialViewState={{
          bounds: boundsAround(lng, lat, precisionM),
          fitBoundsOptions: { padding: 24 },
        }}
        mapStyle={mapStyle}
        // Sized with width/height 100% rather than `absolute inset-0`:
        // maplibre-gl.css forces `position: relative` on its container, which
        // cancels the insets and collapses the box to zero height with no
        // error anywhere.
        style={{ width: "100%", height: "100%" }}
        attributionControl={false}
        dragRotate={false}
        // MapLibre swallows style and source failures unless you listen.
        onError={(e) => console.error("[maplibre]", e.error?.message ?? String(e))}
        // Re-applies the choice to a freshly loaded style, so toggling
        // satellite and then navigating to another case keeps the imagery.
        onLoad={(e) => {
          const map = mapRef.current?.getMap();
          if (map && satellite) setSatelliteBasemap(map, true, SATELLITE_FILLS);
          setDetail(e.target.getZoom() >= DETAIL_MIN_ZOOM);
        }}
        onZoomEnd={(e) => setDetail((on) => on || e.viewState.zoom >= DETAIL_MIN_ZOOM)}
      >
        <NavigationControl showCompass={false} position="top-right" />
        {/* Credits the imagery provider only while its tiles are on screen. */}
        <AttributionControl compact position="bottom-right" />
        {detail && (
          <>
            <Source id="subdistricts" type="geojson" data="/data/south-subdistricts.geojson">
              <Layer {...SUBDISTRICT_OUTLINE_LAYER} />
            </Source>
            <Source id="villages" type="geojson" data="/data/south-villages.geojson">
              <Layer {...VILLAGE_LAYER} />
            </Source>
          </>
        )}

        <Source id="here" type="geojson" data={here}>
          <Layer {...UNCERTAINTY_LAYER} />
          <Layer {...POINT_LAYER} />
        </Source>
      </Map>

      <button
        type="button"
        onClick={() => applySatellite(!satellite)}
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
