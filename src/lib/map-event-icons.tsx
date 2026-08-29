"use client";

import type { Map as MapLibreMap } from "maplibre-gl";
import type { LayerProps } from "react-map-gl/maplibre";
import { EVENT_ICON } from "./event-icons";
import { EVENT_COLOR } from "./palette";
import { EVENT_TYPES, type EventType } from "./types";

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
 */

/** `icon-image` ids are `${prefix}${EventType}`, built by the layer expression. */
const IMAGE_PREFIX = "event-badge-";

/**
 * Badge geometry, in CSS pixels — `SCALE` is baked into the rasterised image
 * and handed back to MapLibre as `pixelRatio`, so the glyph stays sharp on a
 * HiDPI display instead of being upscaled from a 20px bitmap.
 */
const PLATE = 20;
const GLYPH = 13;
const SCALE = 2;

/** The panel background the rest of the UI uses, so a badge reads as chrome. */
const PLATE_FILL = "rgba(6,13,25,0.88)";

/** Below this the dots are a few pixels across and a glyph per dot is noise. */
export const EVENT_BADGE_MIN_ZOOM = 10.5;

/**
 * Every type glyph, rendered by React but never shown.
 *
 * MapLibre needs raster images, and the glyphs are Lucide *components* — the
 * path data is closed over inside them and is not reachable as data. Rather
 * than copy 17 icons' geometry into this repo (where it would silently drift
 * from `EVENT_ICON`), the components are rendered once into a hidden node and
 * `registerEventBadgeIcons` serialises what React produced. `EVENT_ICON` stays
 * the single definition of which glyph means what.
 */
export function EventBadgeSprite({ ref }: { ref: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} hidden aria-hidden>
      {EVENT_TYPES.map((type) => {
        const Glyph = EVENT_ICON[type];
        return (
          <Glyph
            key={type}
            data-event-type={type}
            size={GLYPH}
            strokeWidth={2.2}
            color={EVENT_COLOR[type]}
          />
        );
      })}
    </div>
  );
}

/** One badge: a dark rounded plate outlined in the type's colour, glyph centred. */
function badgeMarkup(glyph: SVGSVGElement, color: string): string {
  const inner = glyph.cloneNode(true) as SVGSVGElement;
  // Nested `<svg>`, positioned by x/y/width/height against the outer viewBox.
  // The class Lucide puts on it is dead weight inside a data: URI.
  inner.removeAttribute("class");
  inner.setAttribute("x", String((PLATE - GLYPH) / 2));
  inner.setAttribute("y", String((PLATE - GLYPH) / 2));
  inner.setAttribute("width", String(GLYPH));
  inner.setAttribute("height", String(GLYPH));

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${PLATE * SCALE}" height="${PLATE * SCALE}" viewBox="0 0 ${PLATE} ${PLATE}">`,
    `<rect x="0.5" y="0.5" width="${PLATE - 1}" height="${PLATE - 1}" rx="5" fill="${PLATE_FILL}" stroke="${color}" stroke-opacity="0.75" stroke-width="1"/>`,
    new XMLSerializer().serializeToString(inner),
    `</svg>`,
  ].join("");
}

function loadImage(markup: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image(PLATE * SCALE, PLATE * SCALE);
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("badge image failed to decode"));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  });
}

export interface EventBadgeImage {
  id: string;
  image: HTMLImageElement;
}

/**
 * Rasterises the sprite. Deliberately takes no map: decoding is asynchronous,
 * and a function that both awaits and then writes to a map instance is a
 * function that can write to one the caller has already unmounted. The caller
 * awaits this, checks it still wants the result, and only then calls
 * `addEventBadgeImages`.
 */
export function buildEventBadgeImages(container: HTMLElement): Promise<EventBadgeImage[]> {
  const glyphs = Array.from(container.querySelectorAll<SVGSVGElement>("svg[data-event-type]"));

  return Promise.all(
    glyphs.map(async (glyph) => {
      const type = glyph.dataset.eventType as EventType;
      const markup = badgeMarkup(glyph, EVENT_COLOR[type] ?? EVENT_COLOR.other);
      return { id: `${IMAGE_PREFIX}${type}`, image: await loadImage(markup) };
    }),
  );
}

/**
 * Adds the rasterised badges to a map's image registry. Already-registered ids
 * are skipped, so a second call — React re-running the effect, or a style
 * reload — is cheap rather than an error.
 */
export function addEventBadgeImages(map: MapLibreMap, badges: EventBadgeImage[]): void {
  for (const { id, image } of badges) {
    if (!map.hasImage(id)) map.addImage(id, image, { pixelRatio: SCALE });
  }
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
