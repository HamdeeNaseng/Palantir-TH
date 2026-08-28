import type { Map as MapLibreMap } from "maplibre-gl";
import type { LayerProps } from "react-map-gl/maplibre";
import { FEASIBILITY_COLOR } from "@/lib/palette";
import type { FlowLeg } from "./types";
import type { FlowUnavailableReason } from "./use-flow-legs";

/**
 * MapLibre rendering for road-network flow corridors — shared by
 * `MapPanel.tsx` (`/events`) and `MapWorkspace.tsx` (`/map`), which each
 * mount their own independent `<Map>` instance (own style, own image
 * registry) but must draw the exact same corridor. Kept in one place so the
 * two never drift.
 */

/**
 * Registered once per map instance via `registerFlowArrowIcon`. Not a
 * sprite/`glyphs` URL: neither page's base style declares one (no symbol
 * layer needed one until this), and pulling in a font server just for a
 * rotated triangle would be a heavier dependency than the feature warrants.
 */
export const FLOW_ARROW_ICON_ID = "flow-direction-arrow";

/**
 * A small upward-pointing (north-up) white triangle, as raw RGBA pixels —
 * MapLibre's `addImage` accepts this directly, no canvas needed. Rotated per
 * feature by `icon-rotate`/`icon-rotation-alignment: "map"`, so "up" here is
 * what makes `bearingDeg`'s 0 = north convention line up with what's drawn.
 */
function buildFlowArrowImage(size: number): { width: number; height: number; data: Uint8Array } {
  const data = new Uint8Array(size * size * 4);
  const mid = size / 2;
  for (let y = 0; y < size; y++) {
    // Triangle tapers from a wide base at the bottom to a point at the top.
    const halfWidth = (mid * y) / size;
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (Math.abs(x - mid) <= halfWidth) {
        data[i] = 255;
        data[i + 1] = 255;
        data[i + 2] = 255;
        data[i + 3] = 235;
      }
    }
  }
  return { width: size, height: size, data };
}

/** Registers the arrow icon on a map instance, once — safe to call on every `onLoad`. */
export function registerFlowArrowIcon(map: MapLibreMap): void {
  if (!map.hasImage(FLOW_ARROW_ICON_ID)) {
    map.addImage(FLOW_ARROW_ICON_ID, buildFlowArrowImage(20));
  }
}

/**
 * Real road-network corridors — solid, colour-coded by implied-speed
 * feasibility, deliberately distinct from a dashed straight-line "recent
 * movement" path so the two never read as the same claim.
 */
export const FLOW_CORRIDOR_LAYER = {
  id: "flow-corridor-line",
  type: "line",
  paint: {
    "line-color": [
      "match", ["get", "feasibility"],
      "highly_plausible", FEASIBILITY_COLOR.highly_plausible,
      "likely", FEASIBILITY_COLOR.likely,
      "possible", FEASIBILITY_COLOR.possible,
      "very_unlikely", FEASIBILITY_COLOR.very_unlikely,
      "impossible", FEASIBILITY_COLOR.impossible,
      FEASIBILITY_COLOR.possible,
    ],
    "line-width": 2.2,
    // A weak road-snap (low geo_precision, e.g. a district centroid) reads as
    // a fainter, less certain corridor rather than the same solid claim.
    "line-opacity": ["interpolate", ["linear"], ["get", "matchConfidence"], 0, 0.25, 1, 0.9],
  },
} satisfies LayerProps;

/** Direction arrows along each corridor, from `icon-rotate` bound to the leg's route heading. */
export const FLOW_DIRECTION_LAYER = {
  id: "flow-corridor-arrows",
  type: "symbol",
  layout: {
    "symbol-placement": "line",
    "symbol-spacing": 90,
    "icon-image": FLOW_ARROW_ICON_ID,
    "icon-size": 0.8,
    "icon-rotate": ["get", "bearingDeg"],
    "icon-rotation-alignment": "map",
    "icon-allow-overlap": true,
    "icon-ignore-placement": true,
  },
  paint: {
    "icon-opacity": ["interpolate", ["linear"], ["get", "matchConfidence"], 0, 0.35, 1, 0.95],
  },
} satisfies LayerProps;

/**
 * Why the corridor layer is unavailable, in the UI's language. Shared so
 * `/events` and `/map` explain the same failure the same way — and so the
 * layer never just silently draws nothing, which reads as "no corridors
 * exist" when it actually means "nothing could be computed".
 */
export const FLOW_UNAVAILABLE_LABEL: Record<FlowUnavailableReason, string> = {
  "no-road-data": "ยังไม่มีข้อมูลโครงข่ายถนน — ให้รัน npm run gis:roads",
};

/** `FlowLeg[]` -> the GeoJSON `FeatureCollection` both `FLOW_CORRIDOR_LAYER` and `FLOW_DIRECTION_LAYER` read. */
export function toFlowFeatureCollection(legs: FlowLeg[]) {
  return {
    type: "FeatureCollection" as const,
    features: legs.map((leg) => ({
      type: "Feature" as const,
      geometry: { type: "LineString" as const, coordinates: leg.geometry },
      properties: {
        feasibility: leg.feasibility,
        bearingDeg: leg.bearingDeg,
        matchConfidence: leg.matchConfidence,
      },
    })),
  };
}
