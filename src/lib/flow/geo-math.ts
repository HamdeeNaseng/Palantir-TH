import type { Position } from "@/lib/geography";
import type { CompassDirection } from "./types";

/**
 * Pure geometry helpers for the flow-analysis pipeline. No I/O, no runtime
 * dependency — same spirit as `distanceMetres` in `@/lib/geography`, and
 * deliberately hand-rolled rather than pulling in a turf bearing/polyline
 * package for a few dozen lines of well-known math.
 */

/** Metres per degree of latitude — the same constant the boundary code uses. */
const M_PER_DEG_LAT = 111_320;

/**
 * Straight-line distance in metres, flat-earth over a few kilometres.
 *
 * Lives here rather than in `@/lib/geography` because that module reads the
 * boundary files off disk at import time and can therefore never be pulled
 * into a browser bundle — and the facility editor needs to tell an analyst how
 * far they just dragged a pin. `geography` re-exports this one, so there is
 * still a single definition.
 */
export function distanceMetres(a: Position, b: Position): number {
  const meanLat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const dx = (a[0] - b[0]) * M_PER_DEG_LAT * Math.cos(meanLat);
  const dy = (a[1] - b[1]) * M_PER_DEG_LAT;
  return Math.hypot(dx, dy);
}

/** Initial great-circle bearing from a to b, in degrees clockwise from north [0, 360). */
export function bearingDeg(a: Position, b: Position): number {
  const lat1 = (a[1] * Math.PI) / 180;
  const lat2 = (b[1] * Math.PI) / 180;
  const dLng = ((b[0] - a[0]) * Math.PI) / 180;

  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  const theta = Math.atan2(y, x);
  return ((theta * 180) / Math.PI + 360) % 360;
}

const COMPASS_DIRECTIONS: readonly CompassDirection[] = [
  "N",
  "NE",
  "E",
  "SE",
  "S",
  "SW",
  "W",
  "NW",
];

/** Buckets a bearing into one of 8 compass points, each covering a 45° wedge centred on it. */
export function compassDirection(bearing: number): CompassDirection {
  const normalized = ((bearing % 360) + 360) % 360;
  const index = Math.round(normalized / 45) % 8;
  return COMPASS_DIRECTIONS[index];
}

// A polyline decoder lived here while routing came back as an encoded shape
// from an external service. The in-process graph returns coordinates
// directly, so there is nothing left to decode.
