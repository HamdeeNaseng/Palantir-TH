"use client";

import type { Map as MapLibreMap } from "maplibre-gl";
import type { LayerProps } from "react-map-gl/maplibre";
import { EVENT_ICON } from "./event-icons";
import { EVENT_COLOR } from "./palette";
import { EVENT_TYPES, type EventType } from "./types";
import {
  addBadgeImages,
  buildBadgeImages,
  BADGE_GLYPH,
  type BadgeImage,
} from "./map-badges";

/**
 * Type glyphs drawn on the map itself, above the event dots.
 *
 * The dots are unchanged — same colour, same severity-driven radius, same
 * hit target. This adds a second, redundant encoding on top of them, which is
 * the point: at seventeen categories a field of coloured dots is a field of
 * coloured dots, and the analyst has to keep crossing back to the legend to
 * read one. A 💣 above the dot is read without the round trip, and it survives
 * the reader who cannot separate #ef4444 from #22c55e at all.
 *
 * Only from `EVENT_BADGE_MIN_ZOOM` up, and colliding badges are dropped rather
 * than stacked: at province zoom the dots are 4px across and hundreds deep, so
 * a glyph per dot there would be noise covering the very pattern the heatmap
 * and the dot field are there to show.
 *
 * The rasterising mechanism is shared with `/network`'s facility badges — see
 * `map-badges.tsx`.
 */

/** `icon-image` ids are `${prefix}${EventType}`, built by the layer expression. */
const IMAGE_PREFIX = "event-badge-";

/** Below this the dots are a few pixels across and a glyph per dot is noise. */
export const EVENT_BADGE_MIN_ZOOM = 10.5;

export type EventBadgeImage = BadgeImage;

/** Every type glyph, rendered by React but never shown — see `buildBadgeImages`. */
export function EventBadgeSprite({ ref }: { ref: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} hidden aria-hidden>
      {EVENT_TYPES.map((type) => {
        const Glyph = EVENT_ICON[type];
        return (
          <Glyph
            key={type}
            data-event-type={type}
            size={BADGE_GLYPH}
            strokeWidth={2.2}
            color={EVENT_COLOR[type]}
          />
        );
      })}
    </div>
  );
}

export function buildEventBadgeImages(container: HTMLElement): Promise<EventBadgeImage[]> {
  return buildBadgeImages(
    container,
    "eventType",
    IMAGE_PREFIX,
    (key) => EVENT_COLOR[key as EventType] ?? EVENT_COLOR.other,
  );
}

export function addEventBadgeImages(map: MapLibreMap, badges: EventBadgeImage[]): void {
  addBadgeImages(map, badges);
}

/**
 * The badge layer. Mounted only once the images are in — a symbol layer whose
 * `icon-image` does not resolve makes MapLibre log a missing-image error per
 * feature — and filtered by the same replay expression as the dots, so a badge
 * never outlives the point it belongs to.
 */
export const EVENT_BADGE_LAYER = {
  id: "events-badge",
  type: "symbol",
  minzoom: EVENT_BADGE_MIN_ZOOM,
  layout: {
    "icon-image": ["concat", IMAGE_PREFIX, ["get", "type"]],
    "icon-size": ["interpolate", ["linear"], ["zoom"], EVENT_BADGE_MIN_ZOOM, 0.75, 14, 1],
    // Sits above the dot rather than on it: the dot's colour is a reading in
    // its own right and a glyph printed over it would take half of it away.
    "icon-anchor": "bottom",
    "icon-offset": [0, -9],
    // Let the badges collide out. Where events pile up the dots still show
    // every one of them; it is only the labelling that thins.
    "icon-allow-overlap": false,
    // Lower sorts first and wins the collision, so the worst incident in a
    // cluster is the one that keeps its glyph.
    "symbol-sort-key": ["-", 5, ["get", "severity"]],
  },
  paint: {
    "icon-opacity": [
      "interpolate", ["linear"], ["zoom"],
      EVENT_BADGE_MIN_ZOOM, 0,
      EVENT_BADGE_MIN_ZOOM + 1, 0.95,
    ],
  },
} satisfies LayerProps;
