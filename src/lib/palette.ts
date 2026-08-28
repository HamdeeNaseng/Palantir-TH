import type { EventFamily, EventType, VerificationStatus } from "./types";
import type { FeasibilityBand } from "./flow/types";

/**
 * One colour per event type, shared by the map, legend, chips and tables.
 *
 * Seventeen categories is past what hue alone can separate reliably, so the
 * newer entries are grouped by tone rather than spread across the wheel: the
 * natural hazards run cool-to-earth (water, sky, soil, burn, parch) and the
 * อุบัติภัย pair sits in rose. Read a dot as its family first; the exact type
 * is decoded from the legend beside it, never from memory. Any further growth
 * in this vocabulary should move the map to `EVENT_FAMILY_COLOR` instead of
 * squeezing more hues in here.
 */
export const EVENT_COLOR: Record<EventType, string> = {
  unrest: "#ef4444",
  shooting: "#f97316",
  explosion: "#d946ef",
  arson: "#3b82f6",
  abduction: "#22d3ee",
  raid: "#22c55e",
  narcotics: "#a855f7",
  crime: "#f59e0b",
  gang: "#eab308",
  flood: "#0ea5e9",
  storm: "#818cf8",
  landslide: "#92400e",
  wildfire: "#c2410c",
  drought: "#ca8a04",
  fire: "#f43f5e",
  accident: "#f472b6",
  other: "#94a3b8",
};

/**
 * One colour per family, for the trend chart and anywhere else that plots the
 * rolled-up groups. The first five are the exact colours the trend series has
 * always used, so adding the two new families changed nothing already on
 * screen.
 */
export const EVENT_FAMILY_COLOR: Record<EventFamily, string> = {
  violence: "#3b82f6",
  gang: "#a855f7",
  narcotics: "#22c55e",
  crime: "#f59e0b",
  disaster: "#06b6d4",
  safety: "#f43f5e",
  other: "#64748b",
};

/**
 * Event density per administrative area, on `/map`.
 *
 * A sequential ramp, so: one hue, ordered by lightness — five steps of amber
 * climbing from 0.55 to 0.91 in OKLab L. Never the cyan→amber→red ramp the
 * heatmap uses: that one is a rainbow, which reads as *categories* and makes
 * "a bit more" look like "a different kind of thing".
 *
 * There is deliberately no step for zero. An area with no events is left
 * unfilled rather than given the darkest colour, because the two darkest amber
 * steps sit at 1.2:1 and 1.9:1 against this map's landmass and would be
 * indistinguishable from empty land anyway — a scale whose bottom is invisible
 * is a scale that lies about its bottom.
 */
export const AREA_DENSITY_SCALE = [
  "#b45309",
  "#d97706",
  "#f59e0b",
  "#fbbf24",
  "#fde68a",
] as const;

export const SEVERITY_COLOR: Record<number, string> = {
  1: "#22c55e",
  2: "#84cc16",
  3: "#f59e0b",
  4: "#f97316",
  5: "#ef4444",
};

export const VERIFICATION_COLOR: Record<VerificationStatus, string> = {
  verified: "#22c55e",
  under_review: "#f59e0b",
  unverifiable: "#64809f",
};

/**
 * Implied travel speed feasibility for a road-network corridor leg on
 * `/events`. Green-to-red like `SEVERITY_COLOR`, because both read the same
 * way: further right is more concerning, never a different kind of thing.
 */
export const FEASIBILITY_COLOR: Record<FeasibilityBand, string> = {
  highly_plausible: "#22c55e",
  likely: "#84cc16",
  possible: "#f59e0b",
  very_unlikely: "#f97316",
  impossible: "#ef4444",
};
