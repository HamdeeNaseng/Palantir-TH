"use client";

import type { Map as MapLibreMap } from "maplibre-gl";

/**
 * Turning Lucide components into MapLibre images.
 *
 * MapLibre needs raster images; the glyphs are React *components* whose path
 * data is closed over inside them and is not reachable as data. So every badge
 * on every map in this app is made the same way: render the components once
 * into a hidden node, serialise what React produced, rasterise it, and hand
 * the result to `map.addImage`. Copying icon geometry into this repo instead
 * would give the maps a second definition of which glyph means what, and it
 * would drift from `EVENT_ICON` / `FACILITY_ICON` the first time either
 * changed.
 *
 * This module is the mechanism only. What each map badges — and at what zoom,
 * with what collision behaviour — belongs to `map-event-icons.tsx` and
 * `map-facility-icons.tsx`, because those are product decisions, not shared
 * plumbing.
 */

/**
 * Badge geometry, in CSS pixels — `BADGE_SCALE` is baked into the rasterised
 * image and handed back to MapLibre as `pixelRatio`, so the glyph stays sharp
 * on a HiDPI display instead of being upscaled from a 20 px bitmap.
 */
export const BADGE_PLATE = 20;
export const BADGE_GLYPH = 13;
export const BADGE_SCALE = 2;

/** The panel background the rest of the UI uses, so a badge reads as chrome. */
const PLATE_FILL = "rgba(6,13,25,0.88)";

export interface BadgeImage {
  id: string;
  image: HTMLImageElement;
}

/** One badge: a dark rounded plate outlined in the subject's colour, glyph centred. */
function badgeMarkup(glyph: SVGSVGElement, color: string): string {
  const inner = glyph.cloneNode(true) as SVGSVGElement;
  // Nested `<svg>`, positioned by x/y/width/height against the outer viewBox.
  // The class Lucide puts on it is dead weight inside a data: URI.
  inner.removeAttribute("class");
  inner.setAttribute("x", String((BADGE_PLATE - BADGE_GLYPH) / 2));
  inner.setAttribute("y", String((BADGE_PLATE - BADGE_GLYPH) / 2));
  inner.setAttribute("width", String(BADGE_GLYPH));
  inner.setAttribute("height", String(BADGE_GLYPH));

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${BADGE_PLATE * BADGE_SCALE}" height="${BADGE_PLATE * BADGE_SCALE}" viewBox="0 0 ${BADGE_PLATE} ${BADGE_PLATE}">`,
    `<rect x="0.5" y="0.5" width="${BADGE_PLATE - 1}" height="${BADGE_PLATE - 1}" rx="5" fill="${PLATE_FILL}" stroke="${color}" stroke-opacity="0.75" stroke-width="1"/>`,
    new XMLSerializer().serializeToString(inner),
    `</svg>`,
  ].join("");
}

function loadImage(markup: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image(BADGE_PLATE * BADGE_SCALE, BADGE_PLATE * BADGE_SCALE);
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("badge image failed to decode"));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  });
}

/**
 * Rasterises a hidden sprite node into one image per glyph.
 *
 * Deliberately takes no map: decoding is asynchronous, and a function that
 * both awaits and then writes to a map instance is a function that can write
 * to one the caller has already unmounted. The caller awaits this, checks it
 * still wants the result, and only then calls `addBadgeImages`.
 *
 * `dataAttr` is the dataset key the sprite tagged each glyph with (`eventType`
 * for `data-event-type`), and `colorOf` turns that key into the plate colour.
 */
export function buildBadgeImages(
  container: HTMLElement,
  dataAttr: string,
  idPrefix: string,
  colorOf: (key: string) => string,
): Promise<BadgeImage[]> {
  const selector = `svg[data-${dataAttr.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}]`;
  const glyphs = Array.from(container.querySelectorAll<SVGSVGElement>(selector));

  return Promise.all(
    glyphs.map(async (glyph) => {
      const key = glyph.dataset[dataAttr] ?? "";
      return { id: `${idPrefix}${key}`, image: await loadImage(badgeMarkup(glyph, colorOf(key))) };
    }),
  );
}

/**
 * Adds rasterised badges to a map's image registry. Already-registered ids are
 * skipped, so a second call — React re-running the effect, or a style reload —
 * is cheap rather than an error.
 */
export function addBadgeImages(map: MapLibreMap, badges: BadgeImage[]): void {
  for (const { id, image } of badges) {
    if (!map.hasImage(id)) map.addImage(id, image, { pixelRatio: BADGE_SCALE });
  }
}
