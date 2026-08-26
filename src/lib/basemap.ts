import type {
  ExpressionSpecification,
  LayerSpecification,
  Map as MapLibreMap,
  RasterSourceSpecification,
} from "maplibre-gl";

/**
 * The satellite basemap — the default view for every map in this app.
 *
 * It is on by default because of the thing the administrative polygons cannot
 * give: ground truth. An อำเภอ outline says nothing about whether a pin sits
 * on a road, a school, or a rubber plantation — and for a citizen placing that
 * pin from a phone, the imagery is often the only way to recognise where they
 * are. The polygons-only view is still one toggle away.
 *
 * The cost of that default is real and worth stating: every page view now
 * fetches third-party tiles and inherits that provider's terms. Set
 * `NEXT_PUBLIC_SATELLITE_TILE_URL` (or a MapTiler key) to control which
 * provider that is, and flip `SATELLITE_DEFAULT_ON` to ship the keyless
 * polygon view again.
 *
 * The provider is resolved in three steps, most explicit first:
 *
 *   1. `NEXT_PUBLIC_SATELLITE_TILE_URL` — any tile source you are licensed
 *      for, including one that needs no key.
 *   2. `NEXT_PUBLIC_MAPTILER_KEY` — the preferred route. MapTiler's Hybrid map
 *      is served as ordinary raster tiles, and unlike bare imagery it carries
 *      road and place labels. That matters more here than image quality does:
 *      none of these styles declare `glyphs`, so the polygons cannot render a
 *      single label of their own, and a citizen looking for their street has
 *      nothing to read without them.
 *   3. Esri World Imagery — keyless and CORS-enabled, so the toggle does
 *      something the moment someone clones this repo. ArcGIS Online's terms
 *      attach conditions to sustained and commercial use, so this is a
 *      starting point, not a deployment decision.
 */

export const SATELLITE_SOURCE_ID = "satellite";
export const SATELLITE_LAYER_ID = "satellite";

/**
 * Whether every map opens with the imagery already on. The toggle in each map
 * still flips it; this is only the state it starts in.
 */
export const SATELLITE_DEFAULT_ON = true;

const ESRI_TILE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

const ESRI_ATTRIBUTION =
  "ภาพถ่ายดาวเทียม: Esri, Maxar, Earthstar Geographics, and the GIS User Community";

/**
 * Which MapTiler map to draw. `hybrid` is imagery with labels and roads;
 * `satellite` is imagery alone. Both are served as raster tiles, which is what
 * lets either drop into the same layer the Esri fallback uses — a MapTiler
 * *vector* style would mean replacing this app's entire dark polygon design.
 */
const MAPTILER_MAP_ID = process.env.NEXT_PUBLIC_MAPTILER_MAP || "hybrid";

const MAPTILER_ATTRIBUTION =
  "ภาพถ่ายดาวเทียม: © MapTiler © OpenStreetMap contributors";

const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY || "";

/**
 * Whether the imagery comes from a keyed account rather than the open
 * fallback. Exported so the UI can say which one it is about to call.
 */
export const SATELLITE_PROVIDER: "maptiler" | "esri" | "custom" =
  process.env.NEXT_PUBLIC_SATELLITE_TILE_URL ? "custom" : MAPTILER_KEY ? "maptiler" : "esri";

// `process.env.NEXT_PUBLIC_*` is written out in full at every site on purpose:
// Next.js inlines these at build time by literal match, so reading one through
// a variable would silently resolve to undefined in the browser.
export const SATELLITE_TILE_URL =
  process.env.NEXT_PUBLIC_SATELLITE_TILE_URL ||
  (MAPTILER_KEY
    ? `https://api.maptiler.com/maps/${MAPTILER_MAP_ID}/{z}/{x}/{y}.jpg?key=${MAPTILER_KEY}`
    : ESRI_TILE_URL);

/**
 * Shown by MapLibre's attribution control whenever the layer is visible, and
 * only then — the control credits sources that a visible layer actually uses.
 * It tracks the URL above, because a tile source overridden without its
 * attribution would credit the wrong provider, which is worse than crediting
 * none.
 */
export const SATELLITE_ATTRIBUTION =
  process.env.NEXT_PUBLIC_SATELLITE_ATTRIBUTION ||
  (SATELLITE_PROVIDER === "maptiler" ? MAPTILER_ATTRIBUTION : ESRI_ATTRIBUTION);

/** MapTiler publishes to z20; ArcGIS World Imagery to z19 over most of Thailand. */
export const SATELLITE_MAX_ZOOM =
  Number(process.env.NEXT_PUBLIC_SATELLITE_MAX_ZOOM) ||
  (SATELLITE_PROVIDER === "maptiler" ? 20 : 19);

export function satelliteSource(): RasterSourceSpecification {
  return {
    type: "raster",
    tiles: [SATELLITE_TILE_URL],
    tileSize: 256,
    maxzoom: SATELLITE_MAX_ZOOM,
    attribution: SATELLITE_ATTRIBUTION,
  };
}

/**
 * Belongs directly above the `sea` background and below every boundary layer,
 * so outlines and event markers stay on top of the imagery.
 */
export function satelliteLayer(): LayerSpecification {
  return {
    id: SATELLITE_LAYER_ID,
    type: "raster",
    source: SATELLITE_SOURCE_ID,
    // On by default: imagery is what makes a pin legible to a citizen, so it
    // is the view every map opens with. The toggle turns it off.
    layout: { visibility: SATELLITE_DEFAULT_ON ? "visible" : "none" },
    paint: { "raster-opacity": 1 },
  };
}

/**
 * A fill whose opacity has to give way when imagery is underneath it.
 *
 * The landmass fills exist to separate land from sea on a map that has no
 * basemap. With imagery on they are doing the opposite job — hiding the thing
 * the user switched to — so each one carries the value it takes in both modes
 * rather than being faded by a blanket rule that would also wash out the
 * outlines.
 */
export interface BasemapFill {
  layer: string;
  plain: ExpressionSpecification | number;
  satellite: ExpressionSpecification | number;
}

/** Flips the imagery on or off and re-balances the fills over it. */
export function setSatelliteBasemap(
  map: MapLibreMap,
  on: boolean,
  fills: readonly BasemapFill[],
): void {
  if (map.getLayer(SATELLITE_LAYER_ID)) {
    map.setLayoutProperty(SATELLITE_LAYER_ID, "visibility", on ? "visible" : "none");
  }
  for (const fill of fills) {
    if (!map.getLayer(fill.layer)) continue;
    map.setPaintProperty(fill.layer, "fill-opacity", on ? fill.satellite : fill.plain);
  }
}
