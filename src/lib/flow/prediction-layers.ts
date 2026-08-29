import type { LayerProps } from "react-map-gl/maplibre";
import type { PredictionUnavailableReason } from "./prediction";

/**
 * MapLibre rendering for the Bayesian route-prediction layers.
 *
 * Kept apart from `map-layers.ts` because the two draw different claims and
 * must not look alike. A `FlowLeg` corridor is coloured by implied-speed
 * feasibility — an assertion about two specific events. These layers are a
 * statistical summary over the whole corpus at 8 km resolution, so they use a
 * different hue family and never borrow the feasibility ramp.
 */

/**
 * Segment flow — how often a road is implicated across all district pairs.
 *
 * Drawn under the corridors and under the event dots: it is context, a
 * background of "roads that keep coming up", not a foreground claim. Width
 * rather than colour carries the magnitude, so it stays legible over both the
 * dark basemap and satellite imagery.
 */
export const PREDICTION_SEGMENT_LAYER = {
  id: "prediction-segment-line",
  type: "line",
  paint: {
    "line-color": "#38bdf8",
    "line-width": [
      "interpolate",
      ["linear"],
      ["get", "flow_normalised"],
      0,
      0.6,
      1,
      5,
    ],
    // Deliberately low: hundreds of overlapping segments at high opacity would
    // read as a solid wash rather than a network.
    "line-opacity": [
      "interpolate",
      ["linear"],
      ["get", "flow_normalised"],
      0,
      0.18,
      1,
      0.55,
    ],
  },
} satisfies LayerProps;

/**
 * Candidate corridors between district pairs.
 *
 * Two encodings, and they answer different questions:
 *
 * - **width = co-occurrence** — how often this pair was actually active
 *   together, which is the observed part.
 * - **opacity = match confidence** — how much to trust that the corridor
 *   belongs on these roads at all. It is exactly zero for district centroids,
 *   so nearly every corridor draws faint. That is the honest render: the
 *   endpoints carry ±8 km of positional error and the road chosen is the one
 *   nearest a centroid, not the one anything happened on.
 *
 * The floor of 0.3 keeps a zero-confidence corridor visible rather than
 * invisible — a line nobody can see makes the same claim as no line at all,
 * which is not what zero confidence means.
 */
export const PREDICTION_CORRIDOR_LAYER = {
  id: "prediction-corridor-line",
  type: "line",
  paint: {
    "line-color": "#c084fc",
    "line-width": [
      "interpolate",
      ["linear"],
      ["get", "cooccurrence_days"],
      1,
      1.2,
      120,
      4.5,
    ],
    "line-opacity": [
      "max",
      0.3,
      ["interpolate", ["linear"], ["get", "match_confidence"], 0, 0.3, 1, 0.9],
    ],
  },
} satisfies LayerProps;

/** A wider transparent line so a corridor can be tapped on a phone. */
export const PREDICTION_CORRIDOR_HIT_LAYER = {
  id: "prediction-corridor-hit",
  type: "line",
  paint: { "line-color": "#000000", "line-opacity": 0, "line-width": 14 },
} satisfies LayerProps;

/** The corridors of the selected anchor, drawn over the rest. */
export const PREDICTION_SELECTED_LAYER = {
  id: "prediction-corridor-selected",
  type: "line",
  paint: {
    "line-color": "#f0abfc",
    "line-width": ["interpolate", ["linear"], ["get", "posterior"], 0, 1.5, 1, 5],
    "line-opacity": 0.95,
  },
} satisfies LayerProps;

/**
 * Anchors — the district centroids the corridors run between.
 *
 * Sized by time-decayed recency weight rather than raw event count: the model
 * conditions on recency, so the map should show what the model is looking at.
 */
export const PREDICTION_ANCHOR_LAYER = {
  id: "prediction-anchor-dot",
  type: "circle",
  paint: {
    "circle-color": "#c084fc",
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 2.5, 13, 6],
    "circle-opacity": 0.85,
    "circle-stroke-color": "#04070e",
    "circle-stroke-width": 0.6,
  },
} satisfies LayerProps;

/** Bigger, invisible target so an anchor can be tapped with a finger. */
export const PREDICTION_ANCHOR_HIT_LAYER = {
  id: "prediction-anchor-hit",
  type: "circle",
  paint: { "circle-color": "#000000", "circle-opacity": 0, "circle-radius": 14 },
} satisfies LayerProps;

/**
 * Why the layer cannot draw, in the UI's language.
 *
 * Never let it silently draw nothing: an empty map reads as "no corridors
 * exist", when it actually means "no model has been built".
 */
export const PREDICTION_UNAVAILABLE_LABEL: Record<PredictionUnavailableReason, string> = {
  "no-model-run": "ยังไม่มีผลจากโมเดล — ให้รัน python run_batch.py ใน ml-server/",
  "db-unreachable": "เชื่อมต่อฐานข้อมูลไม่ได้",
};
