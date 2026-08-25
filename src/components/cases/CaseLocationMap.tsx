"use client";

import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import type { StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

/**
 * Where one case was placed on the map.
 *
 * The uncertainty ring is the point of this component, not decoration. Almost
 * every record in the collection is geocoded to an อำเภอ centroid, which draws
 * as a pin that looks like a GPS fix and is not one. The ring is sized from the
 * record's own `precision_m`, so the drawing shows how much of the district the
 * claim actually covers.
 *
 * Boundaries are the DDPM polygons already served from /data; there is no
 * raster basemap here for the same reason as the dashboard map — no tile key is
 * configured and none should be required to view a case.
 */

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

function style(lng: number, lat: number, precisionM: number, color: string): StyleSpecification {
  return {
    version: 8,
    sources: {
      thailand: { type: "geojson", data: "/data/thailand-provinces.geojson" },
      provinces: { type: "geojson", data: "/data/south-provinces.geojson" },
      districts: { type: "geojson", data: "/data/south-districts.geojson" },
      here: {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: [lng, lat] },
              properties: { precision_m: precisionM },
            },
          ],
        },
      },
    },
    layers: [
      { id: "sea", type: "background", paint: { "background-color": "#04070e" } },
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
      {
        id: "here-uncertainty",
        type: "circle",
        source: "here",
        paint: {
          "circle-color": color,
          "circle-opacity": 0.1,
          "circle-stroke-color": color,
          "circle-stroke-opacity": 0.45,
          "circle-stroke-width": 1,
          // metres -> pixels, following MapLibre's exponential zoom scaling.
          "circle-radius": [
            "interpolate", ["exponential", 2], ["zoom"],
            8, ["/", ["get", "precision_m"], 480],
            15, ["/", ["get", "precision_m"], 3.75],
          ],
        },
      },
      {
        id: "here-point",
        type: "circle",
        source: "here",
        paint: {
          "circle-color": color,
          "circle-radius": 5,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.2,
          "circle-stroke-opacity": 0.85,
        },
      },
    ],
  };
}

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
  const holder = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!holder.current) return;

    const map = new maplibregl.Map({
      container: holder.current,
      style: style(lng, lat, precisionM, color),
      bounds: boundsAround(lng, lat, precisionM),
      fitBoundsOptions: { padding: 24 },
      attributionControl: false,
      dragRotate: false,
    });
    // MapLibre swallows style and source failures unless you listen for them.
    map.on("error", (e) => console.error("[maplibre]", e.error?.message ?? String(e)));
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    return () => map.remove();
  }, [lng, lat, precisionM, color]);

  // Sized with h-full/w-full rather than `absolute inset-0`: maplibre-gl.css
  // forces `position: relative` on its container, which cancels the insets and
  // collapses the box to zero height with no error anywhere.
  return <div ref={holder} className="h-full w-full" />;
}
