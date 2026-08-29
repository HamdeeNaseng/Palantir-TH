"use client";

import type { Map as MapLibreMap } from "maplibre-gl";
import type { LayerProps } from "react-map-gl/maplibre";
import {
  FACILITY_COLOR,
  FACILITY_ICON,
  FACILITY_KINDS,
  type FacilityKind,
} from "./facilities";
import {
  addBadgeImages,
  buildBadgeImages,
  BADGE_GLYPH,
  type BadgeImage,
} from "./map-badges";

/**
 * The Lucide glyph for each kind of facility, drawn on the map.
 *
 * Nine coloured dots are nine coloured dots. On `/network` that is worse than
 * on the event map, because the question being asked is almost always about
 * one kind — "where is the nearest fire station" — and answering it from
 * colour alone means holding a nine-entry legend in your head while scanning.
 * The glyph is the same one the list rows and the filter checkboxes use, so
 * the three views name a facility identically.
 *
 * Unlike the event badges these start at a low zoom and are the *primary*
 * mark: there are 217 facilities across four provinces, not ten thousand
 * incidents, so a glyph per facility is legible where a glyph per event would
 * be a wall. Collision is still on — where a hospital and its clinic share a
 * street the map thins rather than stacks — and the dot underneath always
 * survives, so nothing is ever hidden entirely.
 */

const IMAGE_PREFIX = "facility-badge-";

export type FacilityBadgeImage = BadgeImage;

/** Every facility glyph, rendered by React but never shown — see `buildBadgeImages`. */
export function FacilityBadgeSprite({ ref }: { ref: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} hidden aria-hidden>
      {FACILITY_KINDS.map((kind) => {
        const Glyph = FACILITY_ICON[kind];
        return (
          <Glyph
            key={kind}
            data-facility-kind={kind}
            size={BADGE_GLYPH}
            strokeWidth={2.2}
            color={FACILITY_COLOR[kind]}
          />
        );
      })}
    </div>
  );
}

export function buildFacilityBadgeImages(container: HTMLElement): Promise<FacilityBadgeImage[]> {
  return buildBadgeImages(
    container,
    "facilityKind",
    IMAGE_PREFIX,
    (key) => FACILITY_COLOR[key as FacilityKind] ?? FACILITY_COLOR.aid,
  );
}

export function addFacilityBadgeImages(map: MapLibreMap, badges: FacilityBadgeImage[]): void {
  addBadgeImages(map, badges);
}

/**
 * The badge layer, mounted only once the images are registered — a symbol
 * layer whose `icon-image` does not resolve logs a missing-image error per
 * feature.
 *
 * `symbol-sort-key` puts the facilities somebody has actually reported on
 * first (`status_rank` is 0 for open/closed, 1 for unknown), so when badges
 * collide the one carrying real information is the one that survives.
 */
export const FACILITY_BADGE_LAYER = {
  id: "facility-badge",
  type: "symbol",
  layout: {
    "icon-image": ["concat", IMAGE_PREFIX, ["get", "kind"]],
    "icon-size": ["interpolate", ["linear"], ["zoom"], 7, 0.62, 12, 1],
    // Above the dot rather than on it: the dot carries the kind colour and the
    // halo carries the status, and a glyph printed over them would take both.
    "icon-anchor": "bottom",
    "icon-offset": [0, -9],
    "icon-allow-overlap": false,
    "symbol-sort-key": ["get", "status_rank"],
  },
  paint: {
    "icon-opacity": 0.96,
  },
} satisfies LayerProps;
