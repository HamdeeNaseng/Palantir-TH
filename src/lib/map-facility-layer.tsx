"use client";

import { useEffect, useRef, useState } from "react";
import { Layer, Source, type LayerProps, type MapRef } from "react-map-gl/maplibre";
import type { LayerSpecification, MapGeoJSONFeature } from "maplibre-gl";
import { IconChevronDown } from "@tabler/icons-react";
import {
  FACILITY_COLOR,
  FACILITY_ICON,
  FACILITY_KINDS,
  FACILITY_LABEL,
  FACILITY_STATUS_COLOR,
  FACILITY_STATUS_LABEL,
  facilityName,
  type FacilityKind,
  type FacilityMark,
} from "./facilities";
import {
  addFacilityBadgeImages,
  buildFacilityBadgeImages,
  FACILITY_BADGE_LAYER,
} from "./map-facility-icons";

/**
 * The facility mark, once, for every map that draws it.
 *
 * Two rings and a glyph, and the split is the point: the inner dot is *what* it
 * is (kind colour, the same one the `/network` list and filter chips use) and
 * the halo is *whether it is open* (status colour). That reading was built for
 * `/network`, but it is worth just as much beside an incident — "is there a
 * hospital near this, and is it answering" is the next question after "what
 * happened here" — so the same three layers, the same popup and the same key
 * now sit on `/investigate`, `/events` and `/map` too.
 *
 * Shared the way `flow/map-layers.ts` is shared: layer specs and pure helpers,
 * plus the presentational pieces. Deliberately *not* the interaction — each
 * host map has one click handler that must rank a facility against its own
 * layers (event dots, province fills, prediction anchors), and no module out
 * here can make that call for it. What it does give every host is one hit-layer
 * list and one hit resolver, so they all decide it the same way.
 */

export { FACILITY_BADGE_LAYER };

export const FACILITY_SOURCE_ID = "facilities";

export const FACILITY_HALO_LAYER = {
  id: "facility-halo",
  type: "circle",
  paint: {
    "circle-color": ["get", "status_color"],
    "circle-opacity": 0.22,
    "circle-stroke-color": ["get", "status_color"],
    "circle-stroke-opacity": 0.7,
    "circle-stroke-width": 1,
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 7, 6, 12, 13],
  },
} satisfies LayerProps;

export const FACILITY_DOT_LAYER = {
  id: "facility-dot",
  type: "circle",
  paint: {
    "circle-color": ["get", "color"],
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 7, 2.6, 12, 5.5],
    "circle-stroke-color": "#04070e",
    "circle-stroke-width": 1,
  },
} satisfies LayerProps;

/**
 * The one the `/network` list has selected — a ring, so the dot underneath
 * stays readable. Mounted only there: the other maps navigate on click rather
 * than holding a selection.
 */
export const FACILITY_SELECTED_LAYER = {
  id: "facility-selected",
  type: "circle",
  paint: {
    "circle-color": "transparent",
    "circle-stroke-color": "#ffffff",
    "circle-stroke-width": 2,
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 7, 9, 12, 17],
  },
} satisfies LayerProps;

/**
 * A layer that draws nothing and exists only to hold a place in the stack.
 *
 * MapLibre appends a layer to the top of the order *at the moment it is added*,
 * and half the overlays on these maps mount late — the facility badge waits on
 * a rasterise, the event dots and prediction lines on `/map` wait on a toggle.
 * Which one ends up on top would otherwise depend on which promise settled
 * first. With this pinned last in the base style, everything facility-related
 * mounts `beforeId` it and everything else keeps landing above, so the marks
 * sit under the event layer on every page, every time.
 *
 * `beforeId` pointing at a real overlay would not do: MapLibre throws when the
 * named layer is absent, and on `/map` the event dot layer usually is.
 */
export const FACILITY_OVERLAY_ANCHOR_ID = "facility-overlay-anchor";

export const FACILITY_OVERLAY_ANCHOR_LAYER: LayerSpecification = {
  id: FACILITY_OVERLAY_ANCHOR_ID,
  type: "line",
  source: "provinces",
  layout: { visibility: "none" },
  paint: {},
};

/** The layers a pointer can land on. The badge joins once its images exist. */
export const FACILITY_HIT_LAYERS = [FACILITY_DOT_LAYER.id, FACILITY_HALO_LAYER.id] as const;

export function facilityHitLayers(badgesReady: boolean): string[] {
  // Naming a layer that is not mounted makes `queryRenderedFeatures` complain
  // on every move, so the badge is only listed once it is actually there.
  return badgesReady ? [...FACILITY_HIT_LAYERS, FACILITY_BADGE_LAYER.id] : [...FACILITY_HIT_LAYERS];
}

/**
 * Marks by id, for the hit resolver below.
 *
 * A function rather than an inline `new Map(...)` at each call site because two
 * of the three host files import react-map-gl's `Map` under that very name, and
 * the shadowed constructor fails in a way that names neither.
 */
export function facilityIndex<T extends FacilityMark>(facilities: T[]): Map<string, T> {
  return new Map(facilities.map((f) => [f.id, f]));
}

// Generic over the record, so `/network` can index its full `Facility` rows
// through the same resolver the mark-only pages use.
export function findFacilityHit<T extends FacilityMark>(
  features: MapGeoJSONFeature[] | undefined,
  byId: Map<string, T>,
  badgesReady: boolean,
): T | null {
  if (!features?.length) return null;
  const layers = facilityHitLayers(badgesReady);
  const hit = features.find((f) => layers.includes(f.layer.id));
  if (!hit) return null;
  return byId.get(String(hit.properties?.id)) ?? null;
}

export function toFacilityFeatureCollection(facilities: FacilityMark[]) {
  return {
    type: "FeatureCollection" as const,
    features: facilities.map((f) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [f.lng, f.lat] },
      properties: {
        id: f.id,
        kind: f.kind,
        color: FACILITY_COLOR[f.kind],
        status_color: FACILITY_STATUS_COLOR[f.status],
        // 0 wins a collision — a facility somebody has actually reported on
        // keeps its glyph over one nobody has touched.
        status_rank: f.status === "unknown" ? 1 : 0,
      },
    })),
  };
}

/** OSM ids look like `node/1234`, so the slash has to survive the URL. */
export function facilityHref(id: string): string {
  return `/network/${encodeURIComponent(id)}`;
}

/**
 * Rasterise the glyphs once the style is up, then report that the symbol layer
 * may mount. Split from the render because decoding is asynchronous and the map
 * may be gone by the time it finishes — `cancelled` is what keeps this from
 * writing into an unmounted instance.
 *
 * Failing is survivable: `badgesReady` stays false, the badge layer never
 * mounts and never enters the hit list, and the dot and halo still draw.
 */
export function useFacilityBadges(mapRef: React.RefObject<MapRef | null>, ready: boolean) {
  const spriteRef = useRef<HTMLDivElement | null>(null);
  const [badgesReady, setBadgesReady] = useState(false);

  useEffect(() => {
    if (!ready || !spriteRef.current) return;
    let cancelled = false;

    buildFacilityBadgeImages(spriteRef.current)
      .then((badges) => {
        const map = mapRef.current?.getMap();
        if (cancelled || !map) return;
        addFacilityBadgeImages(map, badges);
        setBadgesReady(true);
      })
      .catch((err) => console.error("[maplibre] facility badge icons", err));

    return () => {
      cancelled = true;
    };
  }, [ready, mapRef]);

  return { spriteRef, badgesReady };
}

/**
 * The marks themselves. No handlers by design — see the module note.
 *
 * `beforeId` is how a host places the whole group; every layer takes the same
 * one, so they stack halo, dot, badge in mount order underneath it.
 */
export function FacilityOverlay({
  facilities,
  badgesReady,
  beforeId,
  sourceId = FACILITY_SOURCE_ID,
}: {
  facilities: FacilityMark[];
  badgesReady: boolean;
  beforeId?: string;
  sourceId?: string;
}) {
  return (
    <Source id={sourceId} type="geojson" data={toFacilityFeatureCollection(facilities)}>
      <Layer {...FACILITY_HALO_LAYER} beforeId={beforeId} />
      <Layer {...FACILITY_DOT_LAYER} beforeId={beforeId} />
      {badgesReady && <Layer {...FACILITY_BADGE_LAYER} beforeId={beforeId} />}
    </Source>
  );
}

/** What hovering a pin says. `action` differs per page — see each caller. */
export function FacilityHoverPopupBody({
  facility,
  action,
}: {
  facility: FacilityMark;
  action: string;
}) {
  return (
    <>
      <div className="pp-title">{facilityName(facility)}</div>
      <div
        className="pp-meta pp-type"
        style={{ "--pp-type-color": FACILITY_COLOR[facility.kind] } as React.CSSProperties}
      >
        {FACILITY_LABEL[facility.kind]}
      </div>
      <div className="pp-meta">
        อ.{facility.district} จ.{facility.province}
      </div>
      <div className="pp-row">
        <span>สถานะ</span>
        <b>{FACILITY_STATUS_LABEL[facility.status]}</b>
      </div>
      <div className="pp-action">{action}</div>
    </>
  );
}

function KindRows() {
  return (
    <ul className="flex flex-col gap-0.5">
      {(FACILITY_KINDS as readonly FacilityKind[]).map((kind) => {
        const Icon = FACILITY_ICON[kind];
        return (
          <li key={kind} className="flex items-center gap-1.5 text-[10px] text-ink-dim">
            <Icon
              size={11}
              strokeWidth={2}
              className="shrink-0"
              style={{ color: FACILITY_COLOR[kind] }}
              aria-hidden
            />
            {FACILITY_LABEL[kind]}
          </li>
        );
      })}
    </ul>
  );
}

function StatusRows() {
  return (
    <ul className="flex flex-col gap-0.5">
      {(["open", "closed", "unknown"] as const).map((s) => (
        <li key={s} className="flex items-center gap-1.5 text-[10px] text-ink-dim">
          <span
            className="h-2 w-2 shrink-0 rounded-full border"
            style={{
              borderColor: FACILITY_STATUS_COLOR[s],
              background: `${FACILITY_STATUS_COLOR[s]}44`,
            }}
          />
          {FACILITY_STATUS_LABEL[s]}
        </li>
      ))}
    </ul>
  );
}

/**
 * The key. Nine glyphs is past what anyone decodes from memory, so the marks
 * are not readable without it.
 *
 * Two shapes because the maps have two different amounts of room. `/network`
 * and `/map` have a spare corner and take `floating`; `/investigate` and
 * `/events` already carry a legend rail for the event families, so there the
 * group folds into it — closed by default, because twelve more rows unfolded
 * would push the event rows off the first screenful of a rail that scrolls.
 */
export function FacilityLegend({
  variant,
  positionClass = "right-2.5 bottom-8",
}: {
  variant: "floating" | "inline";
  /** Where the floating box sits — `/map` has a reading rail to clear. */
  positionClass?: string;
}) {
  const [open, setOpen] = useState(false);

  if (variant === "inline") {
    return (
      <li className="mt-1 border-t border-[rgba(37,66,102,0.6)] pt-1.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="pointer-events-auto flex w-full items-center justify-between gap-1.5 text-[9.5px] text-ink-muted hover:text-ink-dim"
        >
          เครือข่ายตอบสนอง
          <IconChevronDown
            size={10}
            stroke={2}
            className={open ? "rotate-180 transition-transform" : "transition-transform"}
            aria-hidden
          />
        </button>
        {open && (
          <div className="mt-1 flex flex-col gap-1.5">
            <KindRows />
            <div>
              <p className="mb-1 text-[9.5px] text-ink-muted">วงรอบ = สถานะ</p>
              <StatusRows />
            </div>
          </div>
        )}
      </li>
    );
  }

  return (
    <div className={`pointer-events-none absolute ${positionClass} hidden max-w-[150px] rounded border border-[rgba(37,66,102,0.7)] bg-[rgba(6,13,25,0.86)] px-2 py-1.5 lg:block`}>
      <p className="mb-1 text-[9.5px] text-ink-muted">สัญลักษณ์</p>
      <KindRows />
      <div className="mt-1.5 border-t border-[rgba(37,66,102,0.6)] pt-1.5">
        <p className="mb-1 text-[9.5px] text-ink-muted">วงรอบ = สถานะ</p>
        <StatusRows />
      </div>
    </div>
  );
}
