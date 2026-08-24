"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type {
  ExpressionSpecification,
  FilterSpecification,
  MapLayerMouseEvent,
  StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  IconChevronDown,
  IconCurrentLocation,
  IconMap2,
  IconMinus,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlus,
  IconStack2,
} from "@tabler/icons-react";
import { EVENT_COLOR } from "@/lib/palette";
import { EVENT_TYPE_LABEL } from "@/lib/labels";
import type { EventFeatureCollection } from "@/server/investigate";

/**
 * Investigation map.
 *
 * Boundaries are authoritative DOPA polygons fetched by
 * scripts/fetch-boundaries.ts — not drawn by hand. MapLibre renders them and
 * the event layer through WebGL, so the event count is bounded by the GPU
 * rather than by the DOM.
 *
 * There is deliberately no raster basemap: no tile provider key is configured,
 * and depending on one would add an external request and a terms-of-service
 * obligation for every page view. The administrative layers carry the map.
 */

/** Fitted to the four provinces, with room for the legend overlay. */
const BOUNDS: [[number, number], [number, number]] = [
  [99.95, 5.5],
  [102.2, 8.05],
];

/** Whole of Thailand, for the pull-back view. */
const THAILAND_BOUNDS: [[number, number], [number, number]] = [
  [97.3, 5.5],
  [105.7, 20.5],
];

/**
 * Keeps fitted geometry clear of the overlays: the legend on the right and the
 * timeline scrubber along the bottom. Without the bottom inset the four focus
 * provinces land directly behind the scrubber at national zoom.
 */
const FIT_PADDING = { top: 14, bottom: 74, left: 16, right: 170 };

const SOUTH = { provinces: "/data/south-provinces.geojson", districts: "/data/south-districts.geojson" };
/** The other 73 provinces, drawn dim so the focus area sits inside the country. */
const THAILAND = "/data/thailand-provinces.geojson";

const LEGEND = (
  ["unrest", "shooting", "explosion", "arson", "abduction", "raid", "narcotics"] as const
).map((t) => ({ type: t, label: EVENT_TYPE_LABEL[t], color: EVENT_COLOR[t] }));

const VIEWS = ["แผนที่", "ความหนาแน่น", "ไฮบริด"] as const;
type View = (typeof VIEWS)[number];

/** Colour ramp shared by the heatmap layer. */
const HEAT_RAMP: ExpressionSpecification = [
  "interpolate", ["linear"], ["heatmap-density"],
  0, "rgba(0,0,0,0)",
  0.2, "rgba(14,165,233,0.45)",
  0.4, "rgba(34,211,238,0.6)",
  0.6, "rgba(251,191,36,0.75)",
  0.8, "rgba(249,115,22,0.85)",
  1, "rgba(239,68,68,0.95)",
];

function baseStyle(): StyleSpecification {
  return {
    version: 8,
    // No `glyphs` key on purpose: the style has no symbol layers, so no font
    // stack is needed. Setting it to undefined is not the same as omitting it
    // — MapLibre validates the key and rejects the entire style if present but
    // not a string, which silently leaves the canvas blank.
    sources: {
      thailand: { type: "geojson", data: THAILAND },
      provinces: { type: "geojson", data: SOUTH.provinces, generateId: true },
      districts: { type: "geojson", data: SOUTH.districts },
    },
    layers: [
      { id: "sea", type: "background", paint: { "background-color": "#04070e" } },

      // National context: present but deliberately recessive, so the eye still
      // lands on the four provinces under investigation.
      {
        id: "thailand-fill",
        type: "fill",
        source: "thailand",
        paint: { "fill-color": "#0a1826", "fill-opacity": 0.85 },
      },
      {
        id: "thailand-outline",
        type: "line",
        source: "thailand",
        paint: {
          "line-color": "#1e3a5c",
          "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.3, 10, 0.7],
          "line-opacity": 0.8,
        },
      },

      {
        id: "province-fill",
        type: "fill",
        source: "provinces",
        paint: {
          "fill-color": "#12507f",
          // Brighter when zoomed out, where the area is small and needs to be
          // picked out of the country; calmer once it fills the viewport.
          "fill-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0.85, 8, 0.5, 11, 0.35],
        },
      },
      {
        id: "district-outline",
        type: "line",
        source: "districts",
        // Only meaningful once the user has zoomed past province level.
        minzoom: 8.2,
        paint: {
          "line-color": "#38bdf8",
          "line-width": 0.5,
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 8.2, 0, 9.5, 0.45],
        },
      },
      // Soft halo under the focus outline. At national zoom the four provinces
      // are only a few pixels across, so a hairline alone would disappear —
      // this is what makes the focus area findable when zoomed out.
      {
        id: "province-glow",
        type: "line",
        source: "provinces",
        paint: {
          "line-color": "#38bdf8",
          "line-width": ["interpolate", ["linear"], ["zoom"], 4, 7, 7, 9, 11, 12],
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0.3, 8, 0.16, 11, 0.08],
          "line-blur": ["interpolate", ["linear"], ["zoom"], 4, 5, 11, 9],
        },
      },
      {
        id: "province-outline",
        type: "line",
        source: "provinces",
        paint: {
          "line-color": "#38bdf8",
          "line-width": ["interpolate", ["linear"], ["zoom"], 4, 1.4, 6, 1.6, 10, 2],
          "line-opacity": 0.95,
        },
      },
    ],
  };
}

export default function MapPanel({ events }: { events: EventFeatureCollection }) {
  const holder = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [view, setView] = useState<View>("ไฮบริด");
  const [ready, setReady] = useState(false);
  const timeRange = useMemo(() => {
    const timestamps = events.features.map((feature) => feature.properties.ts);
    const now = Date.now();
    return {
      start: timestamps.length ? Math.min(...timestamps) : now,
      end: timestamps.length ? Math.max(...timestamps) : now,
    };
  }, [events]);
  const [currentTimestamp, setCurrentTimestamp] = useState(timeRange.end);
  const [playing, setPlaying] = useState(false);
  const visibleEvents = useMemo(
    () => events.features.filter((feature) => feature.properties.ts <= currentTimestamp).length,
    [currentTimestamp, events],
  );

  // Create the map once; data and paint changes are applied in later effects.
  useEffect(() => {
    if (!holder.current || map.current) return;

    const m = new maplibregl.Map({
      container: holder.current,
      style: baseStyle(),
      // Open on the four provinces under investigation. The rest of Thailand
      // is still drawn around them for context, and the "ดูทั้งประเทศ" button
      // pulls back to the national view.
      bounds: BOUNDS,
      fitBoundsOptions: { padding: FIT_PADDING },
      attributionControl: false,
      dragRotate: false,
    });
    map.current = m;
    // MapLibre swallows style and source failures unless you listen for them:
    // an invalid style just leaves a blank canvas and logs nothing. Keep this.
    m.on("error", (e) => console.error("[maplibre]", e.error?.message ?? String(e)));
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __map?: unknown }).__map = m;
    }

    m.on("load", () => {
      m.addSource("events", { type: "geojson", data: events as never });

      m.addLayer({
        id: "events-heat",
        type: "heatmap",
        source: "events",
        maxzoom: 12,
        paint: {
          // Weight by severity so a critical incident counts for more than a
          // routine one, instead of every point contributing equally.
          "heatmap-weight": ["interpolate", ["linear"], ["get", "severity"], 1, 0.25, 5, 1],
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 6, 0.7, 12, 2.4],
          "heatmap-color": HEAT_RAMP,
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 6, 14, 12, 42],
          "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 10, 0.85, 12, 0.35],
        },
      });

      // Positional uncertainty: a district centroid must not read like a GPS
      // fix, so the halo is sized from precision_m in real metres.
      m.addLayer({
        id: "events-uncertainty",
        type: "circle",
        source: "events",
        minzoom: 9,
        filter: [">", ["get", "precision_m"], 500],
        paint: {
          "circle-color": ["get", "color"],
          "circle-opacity": 0.07,
          "circle-stroke-color": ["get", "color"],
          "circle-stroke-opacity": 0.22,
          "circle-stroke-width": 0.6,
          // metres -> pixels at this latitude, per MapLibre's zoom scaling.
          "circle-radius": [
            "interpolate", ["exponential", 2], ["zoom"],
            9, ["/", ["get", "precision_m"], 120],
            14, ["/", ["get", "precision_m"], 4],
          ],
        },
      });

      m.addLayer({
        id: "events-point",
        type: "circle",
        source: "events",
        paint: {
          "circle-color": ["get", "color"],
          "circle-radius": [
            "interpolate", ["linear"], ["zoom"],
            6, ["interpolate", ["linear"], ["get", "severity"], 1, 2, 5, 4.5],
            12, ["interpolate", ["linear"], ["get", "severity"], 1, 5, 5, 11],
          ],
          "circle-opacity": ["interpolate", ["linear"], ["get", "severity"], 1, 0.6, 5, 0.95],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": ["interpolate", ["linear"], ["get", "severity"], 3, 0, 5, 0.8],
          "circle-stroke-opacity": 0.7,
        },
      });

      setReady(true);
    });

    const popup = new maplibregl.Popup({
      closeButton: false,
      className: "palantir-popup",
      offset: 10,
    });

    m.on("mouseenter", "events-point", (e: MapLayerMouseEvent) => {
      m.getCanvas().style.cursor = "pointer";
      const f = e.features?.[0];
      if (!f) return;
      const p = f.properties as Record<string, string | number>;
      const when = new Intl.DateTimeFormat("th-TH", {
        dateStyle: "medium",
        timeStyle: "short",
        calendar: "buddhist",
      }).format(new Date(Number(p.ts)));

      popup
        .setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number])
        .setHTML(
          `<div class="pp-title">${escapeHtml(String(p.title))}</div>
           <div class="pp-meta">อ.${escapeHtml(String(p.district))} จ.${escapeHtml(String(p.province))}</div>
           <div class="pp-meta">${when}</div>
           <div class="pp-row"><span>ความรุนแรง</span><b>${p.severity}/5</b></div>
           <div class="pp-row"><span>ความเชื่อมั่น</span><b>${p.confidence}%</b></div>
           <div class="pp-row"><span>ความละเอียดพิกัด</span><b>${PRECISION_LABEL[String(p.precision)] ?? "ไม่ระบุ"}</b></div>`,
        )
        .addTo(m);
    });
    m.on("mouseleave", "events-point", () => {
      m.getCanvas().style.cursor = "";
      popup.remove();
    });

    const boundaryPopup = new maplibregl.Popup({
      closeButton: false,
      className: "palantir-popup",
      offset: 8,
    });
    m.on("click", "province-fill", (e: MapLayerMouseEvent) => {
      const properties = e.features?.[0]?.properties as Record<string, string> | undefined;
      if (!properties) return;
      boundaryPopup
        .setLngLat(e.lngLat)
        .setHTML(
          `<div class="pp-title">${escapeHtml(properties.province_th)}</div>
           <div class="pp-meta">${escapeHtml(properties.province_en)}</div>
           <div class="pp-row"><span>รหัสจังหวัด</span><b>${escapeHtml(properties.province_code)}</b></div>`,
        )
        .addTo(m);
    });

    return () => {
      m.remove();
      map.current = null;
    };
    // Event data is pushed by the effect below; this effect must run once only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push new data when the filters change, without rebuilding the map.
  useEffect(() => {
    const src = map.current?.getSource("events") as maplibregl.GeoJSONSource | undefined;
    src?.setData(events as never);
  }, [events, ready]);

  useEffect(() => {
    setCurrentTimestamp(timeRange.end);
    setPlaying(false);
  }, [timeRange.end, timeRange.start]);

  // Event replay is a GPU-layer filter; advancing time does not create or
  // destroy DOM/SVG nodes and remains cheap as the feature count grows.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const timeFilter: FilterSpecification = ["<=", ["get", "ts"], currentTimestamp];
    m.setFilter("events-heat", timeFilter);
    m.setFilter("events-point", timeFilter);
    m.setFilter("events-uncertainty", [
      "all",
      [">", ["get", "precision_m"], 500],
      timeFilter,
    ]);
  }, [currentTimestamp, ready]);

  useEffect(() => {
    if (!playing || timeRange.end <= timeRange.start) return;
    const step = Math.max(60 * 60 * 1000, Math.ceil((timeRange.end - timeRange.start) / 120));
    const timer = window.setInterval(() => {
      setCurrentTimestamp((timestamp) => {
        if (timestamp >= timeRange.end) {
          setPlaying(false);
          return timeRange.end;
        }
        return Math.min(timeRange.end, timestamp + step);
      });
    }, 80);
    return () => window.clearInterval(timer);
  }, [playing, timeRange.end, timeRange.start]);

  // View switcher toggles layer visibility rather than restyling.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const vis = (id: string, on: boolean) =>
      m.getLayer(id) && m.setLayoutProperty(id, "visibility", on ? "visible" : "none");

    vis("events-heat", view !== "แผนที่");
    vis("events-point", view !== "ความหนาแน่น");
    vis("events-uncertainty", view === "ไฮบริด");
  }, [view, ready]);

  const nudgeZoom = (d: number) => map.current?.easeTo({ zoom: (map.current.getZoom() ?? 7) + d });
  const replayDate = new Intl.DateTimeFormat("th-TH", {
    day: "numeric",
    month: "short",
    year: "numeric",
    calendar: "buddhist",
  }).format(new Date(currentTimestamp));

  return (
    <section className="panel relative h-full min-h-0 overflow-hidden">
      {/* Size this with h-full/w-full, not `absolute inset-0`: maplibre-gl.css
          sets `.maplibregl-map { position: relative }` on its container, which
          overrides the absolute positioning. The inset offsets then stop
          stretching the box and it collapses to height 0 — the canvas renders
          but is clipped away, with no error anywhere. */}
      <div ref={holder} className="h-full w-full" />

      <div className="pointer-events-none absolute inset-0">
        {/* View switcher */}
        <div className="pointer-events-auto absolute top-2.5 left-3 flex items-center gap-1 rounded bg-[rgba(6,13,25,0.85)] p-0.5">
          {VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={
                v === view
                  ? "rounded bg-azure px-2.5 py-1 text-[11.5px] font-medium text-[#04070e]"
                  : "rounded px-2.5 py-1 text-[11.5px] text-ink-dim hover:text-ink"
              }
            >
              {v}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="pointer-events-auto absolute top-11 left-3 flex items-center gap-1.5 rounded border border-[rgba(56,100,150,0.5)] bg-[rgba(6,13,25,0.85)] px-2.5 py-1.5 text-[11.5px] text-ink-dim hover:text-ink"
        >
          <IconStack2 size={14} stroke={1.7} />
          ชั้นข้อมูล
          <IconChevronDown size={13} stroke={2} />
        </button>

        {/* Zoom + recentre */}
        <div className="pointer-events-auto absolute top-24 left-3 flex flex-col gap-1.5">
          <div className="flex flex-col overflow-hidden rounded border border-[rgba(56,100,150,0.5)] bg-[rgba(6,13,25,0.85)]">
            <button
              type="button"
              aria-label="ขยาย"
              onClick={() => nudgeZoom(0.6)}
              className="px-1.5 py-1 text-ink-dim hover:bg-[rgba(56,189,248,0.12)] hover:text-ink"
            >
              <IconPlus size={14} stroke={2} />
            </button>
            <button
              type="button"
              aria-label="ย่อ"
              onClick={() => nudgeZoom(-0.6)}
              className="border-t border-[rgba(56,100,150,0.4)] px-1.5 py-1 text-ink-dim hover:bg-[rgba(56,189,248,0.12)] hover:text-ink"
            >
              <IconMinus size={14} stroke={2} />
            </button>
          </div>
          <button
            type="button"
            aria-label="โฟกัส 4 จังหวัดชายแดนใต้"
            title="โฟกัส 4 จังหวัดชายแดนใต้"
            onClick={() => map.current?.fitBounds(BOUNDS, { padding: FIT_PADDING })}
            className="rounded border border-[rgba(56,100,150,0.5)] bg-[rgba(6,13,25,0.85)] px-1.5 py-1 text-ink-dim hover:text-ink"
          >
            <IconCurrentLocation size={14} stroke={1.8} />
          </button>
          <button
            type="button"
            aria-label="ดูทั้งประเทศ"
            title="ดูทั้งประเทศ"
            onClick={() => map.current?.fitBounds(THAILAND_BOUNDS, { padding: FIT_PADDING })}
            className="rounded border border-[rgba(56,100,150,0.5)] bg-[rgba(6,13,25,0.85)] px-1.5 py-1 text-ink-dim hover:text-ink"
          >
            <IconMap2 size={14} stroke={1.8} />
          </button>
        </div>

        {/* Legend */}
        <div className="absolute top-2.5 right-2.5 w-[152px] rounded border border-[rgba(56,100,150,0.45)] bg-[rgba(6,13,25,0.88)] p-2.5">
          <p className="mb-1.5 text-[11.5px] font-semibold text-ink">สัญลักษณ์</p>
          <ul className="space-y-1">
            {LEGEND.map((l) => (
              <li key={l.type} className="flex items-center gap-2 text-[10.5px] text-ink-dim">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: l.color, boxShadow: `0 0 5px ${l.color}` }}
                />
                {l.label}
              </li>
            ))}
            <li className="flex items-center gap-2 pt-1 text-[10.5px] text-ink-dim">
              <span className="h-2 w-3 shrink-0 rounded-[1px] bg-[#0c3150] ring-1 ring-azure/70" />
              พื้นที่เฝ้าระวัง 4 จังหวัด
            </li>
            <li className="flex items-center gap-2 text-[10.5px] text-ink-dim">
              <span className="h-2 w-3 shrink-0 rounded-[1px] bg-[#0a1826] ring-1 ring-[#1e3a5c]" />
              จังหวัดอื่น
            </li>
            <li className="flex items-center gap-2 text-[10.5px] text-ink-dim">
              <span className="h-px w-3 shrink-0 bg-azure" />
              ขอบเขตจังหวัด
            </li>
            <li className="flex items-center gap-2 text-[10.5px] text-ink-dim">
              <span className="h-px w-3 shrink-0 bg-azure/50" />
              ขอบเขตอำเภอ
            </li>
            <li className="flex items-center gap-2 text-[10.5px] text-ink-dim">
              <span className="h-2 w-2 shrink-0 rounded-full border border-ink-muted" />
              ขอบเขตความคลาดเคลื่อน
            </li>
          </ul>
        </div>

        <p className="absolute bottom-2 left-3 flex items-center gap-2 text-[9.5px] text-ink-muted">
          <span>ขอบเขตการปกครอง: กรมป้องกันและบรรเทาสาธารณภัย (DDPM)</span>
          <span className="text-ink-muted/50">·</span>
          <span className="num">{events.features.length.toLocaleString("en-US")} เหตุการณ์</span>
        </p>

        <div className="pointer-events-auto absolute bottom-6 left-1/2 w-[430px] -translate-x-1/2 rounded border border-[rgba(56,100,150,0.5)] bg-[rgba(6,13,25,0.9)] px-2.5 py-1.5 shadow-lg">
          <div className="mb-1 flex items-center gap-2">
            <button
              type="button"
              aria-label={playing ? "หยุดการเล่นเหตุการณ์" : "เล่นเหตุการณ์ตามเวลา"}
              onClick={() => {
                if (!playing && currentTimestamp >= timeRange.end) setCurrentTimestamp(timeRange.start);
                setPlaying((value) => !value);
              }}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-azure text-[#04070e] hover:bg-cyan"
            >
              {playing ? <IconPlayerPause size={11} /> : <IconPlayerPlay size={11} />}
            </button>
            <span className="num min-w-[82px] text-[10px] text-ink-dim">{replayDate}</span>
            <span className="ml-auto text-[9.5px] text-ink-muted">
              แสดง {visibleEvents.toLocaleString("en-US")} / {events.features.length.toLocaleString("en-US")}
            </span>
          </div>
          <input
            type="range"
            min={timeRange.start}
            max={timeRange.end}
            step={Math.max(1, Math.floor((timeRange.end - timeRange.start) / 500))}
            value={currentTimestamp}
            onChange={(event) => {
              setPlaying(false);
              setCurrentTimestamp(Number(event.target.value));
            }}
            aria-label="ช่วงเวลาที่แสดงบนแผนที่"
            className="block h-1 w-full cursor-pointer accent-sky-400"
          />
        </div>
      </div>
    </section>
  );
}

const PRECISION_LABEL: Record<string, string> = {
  gps: "GPS",
  address: "ระดับที่อยู่",
  village: "centroid หมู่บ้าน",
  subdistrict: "centroid ตำบล",
  district: "centroid อำเภอ",
  province: "centroid จังหวัด",
  unknown: "ไม่ระบุ",
};

/** Popup HTML is built by hand, so escape anything sourced from the data. */
function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}
