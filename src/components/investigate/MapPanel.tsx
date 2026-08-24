"use client";

import { useState } from "react";
import { IconChevronDown, IconCurrentLocation, IconMinus, IconPlus, IconStack2 } from "@tabler/icons-react";
import { EVENT_COLOR } from "@/lib/palette";
import type { HeatBlob, MapMarker } from "@/server/investigate";

/**
 * Coastline of the four Deep South provinces, hand-traced into the 0-100
 * projection from src/lib/geo.ts: the Gulf sits in the upper right, land fills
 * the rest and runs off the bottom edge toward the Malaysian border. Kept as
 * plain points so the same outline drives both the SVG fill and the CSS
 * clip-path that keeps the heat layer on land.
 */
const LAND: [number, number][] = [
  [11.1, 0], [15, 11.4], [23.9, 26.4], [33.3, 34.3], [40.6, 30], [47.2, 30.7],
  [51.7, 37.1], [58.3, 33.6], [65, 37.1], [71.1, 46.4], [76.1, 56.4],
  [82.8, 65], [90.6, 73.6], [96.7, 80], [100, 88], [100, 100],
  [0, 100], [0, 30], [3.9, 17.9], [5.6, 0],
];

const LAND_PATH = `${LAND.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join(" ")} Z`;
const LAND_CLIP = `polygon(${LAND.map(([x, y]) => `${x}% ${y}%`).join(", ")})`;

/** Songkhla lake, the one inland water body large enough to read at this scale. */
const LAKE = "M7.5,2 C11,6 12,14 10.5,20 C9,26 6.5,24 6,17 C5.6,11 5.5,5 7.5,2 Z";

const MAIN_ROADS = [
  "M15,12 L28,28 L41,31 L52,37 L66,38 L74,50 L84,66 L94,77",
  "M52,37 L50,52 L54,68 L62,82",
];
const MINOR_ROADS = [
  "M41,31 L38,46 L44,60 L40,76",
  "M66,38 L72,54 L68,70",
  "M28,28 L22,44 L27,62",
];

const PROVINCE_LABELS = [
  { name: "สงขลา", x: 21, y: 20 },
  { name: "ปัตตานี", x: 51, y: 22 },
  { name: "ยะลา", x: 47, y: 55 },
  { name: "นราธิวาส", x: 79, y: 74 },
];

const LEGEND: { label: string; color: string }[] = [
  { label: "เหตุรุนแรง", color: EVENT_COLOR.unrest },
  { label: "สถานการณ์ปะทะ", color: EVENT_COLOR.shooting },
  { label: "ยิง/ประทะ", color: EVENT_COLOR.crime },
  { label: "ลอบวางระเบิด", color: EVENT_COLOR.explosion },
  { label: "วางเพลิง", color: EVENT_COLOR.arson },
  { label: "วางระเบิด", color: EVENT_COLOR.abduction },
  { label: "ตรวจค้น/จับกุม", color: EVENT_COLOR.raid },
];

const VIEWS = ["แผนที่", "ดาวเทียม", "ไฮบริด"] as const;

export default function MapPanel({ markers, heat }: { markers: MapMarker[]; heat: HeatBlob[] }) {
  const [view, setView] = useState<(typeof VIEWS)[number]>("ไฮบริด");
  const [zoom, setZoom] = useState(1);

  const satellite = view !== "แผนที่";

  return (
    <section className="panel relative h-full min-h-0 overflow-hidden">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
        <defs>
          <linearGradient id="sea" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#061524" />
            <stop offset="100%" stopColor="#03080f" />
          </linearGradient>
          <linearGradient id="land" x1="0" y1="0" x2="0.4" y2="1">
            <stop offset="0%" stopColor={satellite ? "#12241c" : "#0d1b2c"} />
            <stop offset="55%" stopColor={satellite ? "#182b1f" : "#102135"} />
            <stop offset="100%" stopColor={satellite ? "#0f1d18" : "#0b1626"} />
          </linearGradient>
        </defs>

        <rect width="100" height="100" fill="url(#sea)" />

        <g transform={`translate(50 50) scale(${zoom}) translate(-50 -50)`}>
          <path d={LAND_PATH} fill="url(#land)" stroke="rgba(84,150,210,0.45)" strokeWidth="0.28" />
          <path d={LAKE} fill="#061524" stroke="rgba(84,150,210,0.3)" strokeWidth="0.18" />

          {MINOR_ROADS.map((d) => (
            <path
              key={d}
              d={d}
              fill="none"
              stroke="rgba(120,180,230,0.4)"
              strokeWidth="0.18"
              strokeDasharray="1.1 0.9"
            />
          ))}
          {MAIN_ROADS.map((d) => (
            <path key={d} d={d} fill="none" stroke="rgba(120,190,240,0.55)" strokeWidth="0.26" />
          ))}
        </g>
      </svg>

      {/* Density surface. Drawn as HTML rather than SVG circles because the
          viewBox is stretched ~4:1 to fit the panel, which would smear circles
          into horizontal bands. Clipped to the coastline so heat stays on land. */}
      <div
        className="pointer-events-none absolute inset-0 [filter:blur(9px)]"
        style={{ clipPath: LAND_CLIP, transform: `scale(${zoom})` }}
      >
        {heat.map((b, i) => {
          const size = 26 + b.intensity * 70;
          const hot = b.intensity > 0.5;
          return (
            <span
              key={i}
              className="absolute rounded-full"
              style={{
                left: `${b.x}%`,
                top: `${b.y}%`,
                width: size,
                height: size,
                marginLeft: -size / 2,
                marginTop: -size / 2,
                opacity: 0.3 + b.intensity * 0.6,
                background: hot
                  ? "radial-gradient(circle, rgba(251,191,36,0.95) 0%, rgba(249,115,22,0.6) 38%, rgba(239,68,68,0.22) 70%, transparent 100%)"
                  : "radial-gradient(circle, rgba(34,211,238,0.5) 0%, rgba(14,165,233,0.18) 55%, transparent 100%)",
              }}
            />
          );
        })}
      </div>

      {/* Markers live in their own absolutely-positioned layer so they keep a
          fixed pixel size regardless of the panel's aspect ratio. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ transform: `scale(${zoom})` }}
      >
        {markers.map((m) => {
          const color = EVENT_COLOR[m.type];
          const size = m.severity >= 4 ? 9 : m.severity >= 3 ? 7 : 5;
          return (
            <span
              key={m.id}
              title={`${m.title} — อ.${m.district} จ.${m.province}`}
              className="absolute rounded-full"
              style={{
                left: `${m.x}%`,
                top: `${m.y}%`,
                width: size,
                height: size,
                marginLeft: -size / 2,
                marginTop: -size / 2,
                background: color,
                boxShadow: `0 0 ${size}px ${color}, 0 0 2px #fff inset`,
                opacity: m.severity >= 3 ? 1 : 0.75,
              }}
            />
          );
        })}
      </div>

      <div className="pointer-events-none absolute inset-0">
        {PROVINCE_LABELS.map((p) => (
          <span
            key={p.name}
            className="absolute -translate-x-1/2 text-[13px] font-semibold text-ink/85"
            style={{ left: `${p.x}%`, top: `${p.y}%`, textShadow: "0 1px 6px #000" }}
          >
            {p.name}
          </span>
        ))}
      </div>

      {/* View switcher */}
      <div className="absolute top-2.5 left-3 flex items-center gap-1 rounded bg-[rgba(6,13,25,0.85)] p-0.5">
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
        className="absolute top-11 left-3 flex items-center gap-1.5 rounded border border-[rgba(56,100,150,0.5)] bg-[rgba(6,13,25,0.85)] px-2.5 py-1.5 text-[11.5px] text-ink-dim hover:text-ink"
      >
        <IconStack2 size={14} stroke={1.7} />
        ชั้นข้อมูล
        <IconChevronDown size={13} stroke={2} />
      </button>

      {/* Zoom + recentre */}
      <div className="absolute top-24 left-3 flex flex-col gap-1.5">
        <div className="flex flex-col overflow-hidden rounded border border-[rgba(56,100,150,0.5)] bg-[rgba(6,13,25,0.85)]">
          <button
            type="button"
            aria-label="ขยาย"
            onClick={() => setZoom((z) => Math.min(2.2, +(z + 0.2).toFixed(2)))}
            className="px-1.5 py-1 text-ink-dim hover:bg-[rgba(56,189,248,0.12)] hover:text-ink"
          >
            <IconPlus size={14} stroke={2} />
          </button>
          <button
            type="button"
            aria-label="ย่อ"
            onClick={() => setZoom((z) => Math.max(1, +(z - 0.2).toFixed(2)))}
            className="border-t border-[rgba(56,100,150,0.4)] px-1.5 py-1 text-ink-dim hover:bg-[rgba(56,189,248,0.12)] hover:text-ink"
          >
            <IconMinus size={14} stroke={2} />
          </button>
        </div>
        <button
          type="button"
          aria-label="กลับสู่มุมมองเริ่มต้น"
          onClick={() => setZoom(1)}
          className="rounded border border-[rgba(56,100,150,0.5)] bg-[rgba(6,13,25,0.85)] px-1.5 py-1 text-ink-dim hover:text-ink"
        >
          <IconCurrentLocation size={14} stroke={1.8} />
        </button>
      </div>

      {/* Scale bar */}
      <div className="absolute bottom-3 left-3 text-[10px] text-ink-dim">
        <div className="h-1.5 w-16 border-x border-b border-ink-dim" />
        <span className="mt-0.5 inline-block">20 km</span>
      </div>

      {/* Legend */}
      <div className="absolute top-2.5 right-2.5 w-[152px] rounded border border-[rgba(56,100,150,0.45)] bg-[rgba(6,13,25,0.88)] p-2.5">
        <p className="mb-1.5 text-[11.5px] font-semibold text-ink">สัญลักษณ์</p>
        <ul className="space-y-1">
          {LEGEND.map((l) => (
            <li key={l.label} className="flex items-center gap-2 text-[10.5px] text-ink-dim">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: l.color, boxShadow: `0 0 5px ${l.color}` }}
              />
              {l.label}
            </li>
          ))}
          <li className="flex items-center gap-2 pt-1 text-[10.5px] text-ink-dim">
            <span className="h-px w-3 shrink-0 bg-[rgba(120,190,240,0.9)]" />
            เส้นทางหลัก
          </li>
          <li className="flex items-center gap-2 text-[10.5px] text-ink-dim">
            <span className="h-px w-3 shrink-0 border-t border-dashed border-[rgba(120,180,230,0.9)]" />
            เส้นทางรอง
          </li>
          <li className="flex items-center gap-2 text-[10.5px] text-ink-dim">
            <span className="h-2 w-2 shrink-0 rounded-[2px] bg-danger" />
            พื้นที่เสี่ยงสูง
          </li>
        </ul>
      </div>
    </section>
  );
}
