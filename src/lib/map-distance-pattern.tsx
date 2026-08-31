"use client";

import { Layer, Source, type LayerProps } from "react-map-gl/maplibre";
import { FACILITY_ICON, type FacilityKind } from "./facilities";
import {
  kindLabel,
  radiusRing,
  spokeColor,
  toSpokeEndFeatureCollection,
  toSpokeFeatureCollection,
  type DistancePattern,
} from "./distance-pattern";

/**
 * The 32-direction distance pattern of one case, drawn on the map.
 *
 * Read the layer as: from this case, in each of 32 compass directions, the
 * nearest facility within the search radius. The **colour of a spoke is the
 * kind of facility it lands on** — the same `FACILITY_COLOR` the pins and the
 * `/network` chips use — so a line and its destination match without a legend
 * lookup, and a case ringed in one colour is visibly served by one kind of
 * thing.
 *
 * A gap between two spokes is a direction with nothing inside the radius, and
 * that is the layer's real finding. The dashed ring is drawn for exactly that
 * reason: without it "nothing to the north" looks like a claim about the north
 * rather than about a 25 km circle.
 *
 * Layer specs and pure helpers only, like `map-facility-layer.tsx` — the click
 * that selects a case belongs to the host map, which has to rank this against
 * its own event and boundary layers.
 */

export const PATTERN_SOURCE_ID = "distance-pattern";
export const PATTERN_RING_SOURCE_ID = "distance-pattern-ring";
export const PATTERN_ENDS_SOURCE_ID = "distance-pattern-ends";

/**
 * A wide, near-transparent under-stroke in the same colour.
 *
 * 32 one-pixel lines converging on a point is a hairball at low zoom; the halo
 * gives the bundle a readable mass while keeping each spoke's colour, and it
 * fades out as the map zooms in and the lines separate on their own.
 */
export const PATTERN_SPOKE_HALO_LAYER = {
  id: "pattern-spoke-halo",
  type: "line",
  paint: {
    "line-color": ["get", "color"],
    "line-width": ["interpolate", ["linear"], ["zoom"], 7, 4.5, 12, 2.5],
    "line-opacity": ["interpolate", ["linear"], ["zoom"], 7, 0.22, 12, 0.08],
    "line-blur": 1.4,
  },
} satisfies LayerProps;

export const PATTERN_SPOKE_LAYER = {
  id: "pattern-spoke",
  type: "line",
  layout: { "line-cap": "round" },
  paint: {
    "line-color": ["get", "color"],
    "line-width": ["interpolate", ["linear"], ["zoom"], 7, 1.1, 12, 2.2],
    "line-opacity": 0.92,
  },
} satisfies LayerProps;

/** The connected facility, so the endpoint reads even with the pins hidden. */
export const PATTERN_END_LAYER = {
  id: "pattern-end",
  type: "circle",
  paint: {
    "circle-color": ["get", "color"],
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 7, 2.4, 12, 4.6],
    "circle-stroke-color": "#04070e",
    "circle-stroke-width": 1,
  },
} satisfies LayerProps;

/** Where "no neighbour in that direction" stops being a claim about the world. */
export const PATTERN_RADIUS_LAYER = {
  id: "pattern-radius",
  type: "line",
  paint: {
    "line-color": "#7dd3fc",
    "line-width": 1,
    "line-dasharray": [3, 3],
    "line-opacity": 0.4,
  },
} satisfies LayerProps;

/** The case the pattern belongs to — drawn under the event dot already there. */
export const PATTERN_ANCHOR_LAYER = {
  id: "pattern-anchor",
  type: "circle",
  paint: {
    "circle-color": "transparent",
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 7, 7, 12, 13],
    "circle-stroke-color": "#ffffff",
    "circle-stroke-width": 1.6,
    "circle-stroke-opacity": 0.85,
  },
} satisfies LayerProps;

export const PATTERN_LAYER_IDS = [
  PATTERN_SPOKE_HALO_LAYER.id,
  PATTERN_SPOKE_LAYER.id,
  PATTERN_END_LAYER.id,
  PATTERN_RADIUS_LAYER.id,
  PATTERN_ANCHOR_LAYER.id,
] as const;

/**
 * Every layer of the overlay, for a host that has a pattern to draw.
 *
 * `beforeId` puts the whole thing under the facility marks and the event dots:
 * these are context lines and must never cover the incident they describe.
 */
export function DistancePatternLayers({
  pattern,
  beforeId,
}: {
  pattern: DistancePattern | null;
  beforeId?: string;
}) {
  if (!pattern) return null;

  const spokes = toSpokeFeatureCollection(pattern);
  const ends = toSpokeEndFeatureCollection(pattern);
  const ring = radiusRing(pattern.lng, pattern.lat, pattern.radiusM);
  const anchor = {
    type: "FeatureCollection" as const,
    features: [
      {
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [pattern.lng, pattern.lat] },
        properties: {},
      },
    ],
  };

  return (
    <>
      <Source id={PATTERN_RING_SOURCE_ID} type="geojson" data={ring}>
        <Layer {...PATTERN_RADIUS_LAYER} beforeId={beforeId} />
      </Source>
      <Source id={PATTERN_SOURCE_ID} type="geojson" data={spokes}>
        <Layer {...PATTERN_SPOKE_HALO_LAYER} beforeId={beforeId} />
        <Layer {...PATTERN_SPOKE_LAYER} beforeId={beforeId} />
      </Source>
      <Source id={PATTERN_ENDS_SOURCE_ID} type="geojson" data={ends}>
        <Layer {...PATTERN_END_LAYER} beforeId={beforeId} />
      </Source>
      <Source id="distance-pattern-anchor" type="geojson" data={anchor}>
        <Layer {...PATTERN_ANCHOR_LAYER} beforeId={beforeId} />
      </Source>
    </>
  );
}

function km(metres: number | null): string {
  return metres === null ? "—" : `${(metres / 1000).toFixed(2)} กม.`;
}

/**
 * The reading panel for the drawn pattern.
 *
 * Rendered inside the host map's legend rail rather than as a floating card.
 * On `/investigate` the map is 266 px tall and every corner of it is already
 * taken — view switcher, layer list, zoom cluster, scrubber — so a card large
 * enough to read would have to cover one of them. The rail is also where this
 * belongs semantically: it is a key for what the lines on screen mean.
 *
 * Leads with coverage rather than a distance, because "11 of 32 directions
 * have anything within 25 km" is the finding an analyst acts on; the nearest
 * facility is the follow-up. `precision_m` is stated whenever the anchor is a
 * district centroid — at 8 km of positional error this describes the district,
 * not the incident, and a panel that showed two-decimal kilometres without
 * saying so would be presenting false precision.
 */
export function DistancePatternCard({
  pattern,
  loading,
  onClear,
}: {
  pattern: DistancePattern | null;
  loading: boolean;
  onClear: () => void;
}) {
  if (loading) {
    return (
      <div className="mb-1.5 border-b border-[rgba(56,100,150,0.35)] pb-1.5 text-[10.5px] text-ink-muted">
        กำลังโหลดรูปแบบระยะทาง…
      </div>
    );
  }
  if (!pattern) return null;

  const coarse = pattern.precisionM >= 8000;
  // Which kinds this case is actually ringed by, commonest first — the colour
  // key for the lines on screen, built from the lines on screen.
  const kinds = new Map<string, number>();
  for (const s of pattern.sectors) {
    kinds.set(s.neighbour.kind, (kinds.get(s.neighbour.kind) ?? 0) + 1);
  }
  const ranked = [...kinds.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div className="mb-2 border-b border-[rgba(56,100,150,0.35)] pb-2">
      <div className="flex items-start justify-between gap-1.5">
        <span className="text-[11px] font-semibold text-ink">รูปแบบระยะทาง 32 ทิศ</span>
        <button
          type="button"
          onClick={onClear}
          className="shrink-0 text-[10px] text-ink-muted hover:text-ink"
        >
          ล้าง
        </button>
      </div>

      <p className="mt-1 text-[10.5px] leading-relaxed text-ink-dim">
        มีหน่วยงานอยู่{" "}
        <span className="font-medium text-ink">
          {pattern.summary.coverage} จาก 32 ทิศ
        </span>{" "}
        ในรัศมี {Math.round(pattern.radiusM / 1000)} กม.
        {pattern.summary.emptySectors > 0 && (
          <> — อีก {pattern.summary.emptySectors} ทิศไม่มีอะไรเลยในรัศมีนี้</>
        )}
      </p>

      <dl className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-1 text-[10.5px]">
        <dt className="text-ink-muted">ใกล้ที่สุด</dt>
        <dd className="text-right text-ink">{km(pattern.summary.nearestM)}</dd>
        <dt className="text-ink-muted">เฉลี่ย</dt>
        <dd className="text-right text-ink">{km(pattern.summary.meanM)}</dd>
        {pattern.summary.medianDetourRatio !== null && (
          <>
            <dt className="text-ink-muted">อ้อมตามถนน</dt>
            <dd className="text-right text-ink">
              {pattern.summary.medianDetourRatio.toFixed(2)} เท่า
            </dd>
          </>
        )}
      </dl>

      {ranked.length > 0 && (
        <div className="mt-2 border-t border-[rgba(56,100,150,0.3)] pt-1.5">
          <span className="text-[10px] text-ink-muted">สีเส้น = ชนิดหน่วยงานปลายทาง</span>
          <ul className="mt-1 flex flex-col gap-0.5">
            {ranked.map(([kind, n]) => {
              const Icon = FACILITY_ICON[kind as FacilityKind];
              return (
                <li key={kind} className="flex items-center gap-1.5 text-[10.5px] text-ink-dim">
                  {/* The same colour the line on the map takes, from the same
                      function — a key that could drift from the drawing is
                      worse than no key. */}
                  <span
                    aria-hidden
                    className="h-0.5 w-3.5 shrink-0 rounded-full"
                    style={{ background: spokeColor(kind) }}
                  />
                  {Icon && <Icon size={11} strokeWidth={1.8} className="shrink-0" aria-hidden />}
                  <span className="truncate">{kindLabel(kind)}</span>
                  <span className="ml-auto text-ink-muted">{n}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {coarse && (
        <p className="mt-2 border-t border-[rgba(56,100,150,0.3)] pt-1.5 text-[10px] leading-relaxed text-amber">
          พิกัดเคสนี้เป็นจุดกึ่งกลางอำเภอ (คลาดเคลื่อน ±
          {(pattern.precisionM / 1000).toFixed(0)} กม.) ตัวเลขนี้จึงอธิบาย
          <em className="not-italic font-medium"> อำเภอ </em>
          ไม่ใช่จุดเกิดเหตุ
          {pattern.casesAtPosition > 1 && <> — อีก {pattern.casesAtPosition - 1} เคสใช้พิกัดเดียวกัน</>}
        </p>
      )}
    </div>
  );
}
