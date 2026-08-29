"use client";

import {
  IconChevronsLeft,
  IconChevronsRight,
  IconPlayerPause,
  IconPlayerPlay,
} from "@tabler/icons-react";
import { formatThaiDate } from "@/lib/datetime";
import type { EventsWorkspace as EventsWorkspaceData } from "@/lib/view-models/events";

/**
 * The dedicated replay scrubber — a histogram of the full matched span with a
 * draggable playhead, replacing the small one MapPanel used to own on its own
 * (that one is hidden here; see the controlled-mode note in `MapPanel.tsx`).
 */
export default function TimelinePanel({
  data,
  currentTimestamp,
  onTimestampChange,
  playing,
  onPlayingChange,
  speed,
  onSpeedChange,
  playbackStartMs,
  playbackEndMs,
}: {
  data: EventsWorkspaceData;
  currentTimestamp: number;
  onTimestampChange: (ts: number) => void;
  playing: boolean;
  onPlayingChange: (playing: boolean) => void;
  speed: 1 | 2 | 4;
  onSpeedChange: (speed: 1 | 2 | 4) => void;
  playbackStartMs: number;
  playbackEndMs: number;
}) {
  const buckets = data.histogram.buckets;
  const maxCount = Math.max(1, ...buckets.map((b) => b.count));
  const span = Math.max(1, playbackEndMs - playbackStartMs);
  const pct = ((currentTimestamp - playbackStartMs) / span) * 100;

  const step = (delta: number) => {
    const bucketSpan = buckets.length ? span / buckets.length : 86400000;
    onTimestampChange(
      Math.max(playbackStartMs, Math.min(playbackEndMs, currentTimestamp + delta * bucketSpan)),
    );
  };

  return (
    <section className="panel flex flex-col px-3 py-2.5">
      <div className="mb-1.5 flex items-center justify-between">
        <h3 className="panel-title">ไทม์ไลน์เหตุการณ์</h3>
        <span className="num text-[11px] text-ink-dim">
          {formatThaiDate(new Date(currentTimestamp))}
        </span>
      </div>

      <div className="relative h-[70px] w-full">
        <svg viewBox="0 0 600 70" preserveAspectRatio="none" className="h-full w-full">
          {buckets.map((b, i) => {
            const w = 600 / buckets.length;
            const h = (b.count / maxCount) * 60;
            const played = b.endMs <= currentTimestamp;
            return (
              <rect
                key={i}
                x={i * w + w * 0.1}
                y={64 - h}
                width={w * 0.8}
                height={h}
                fill={played ? "#38bdf8" : "#1e344f"}
              />
            );
          })}
        </svg>
        <div
          className="pointer-events-none absolute top-0 bottom-[6px] w-px bg-azure shadow-[0_0_6px_#38bdf8]"
          style={{ left: `${Math.max(0, Math.min(100, pct))}%` }}
        />
        <input
          type="range"
          min={playbackStartMs}
          max={playbackEndMs}
          step={Math.max(1, Math.floor(span / 1000))}
          value={currentTimestamp}
          onChange={(e) => {
            onPlayingChange(false);
            onTimestampChange(Number(e.target.value));
          }}
          aria-label="ตำแหน่งไทม์ไลน์"
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </div>

      <div className="mt-1.5 flex items-center justify-between">
        <span className="text-[10px] text-ink-muted">
          เก่าสุด · {formatThaiDate(new Date(playbackStartMs))}
        </span>

        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="ย้อนกลับ"
            onClick={() => step(-10)}
            className="rounded border border-[rgba(56,100,150,0.5)] p-1 text-ink-dim hover:text-ink"
          >
            <IconChevronsLeft size={13} stroke={2} />
          </button>
          <button
            type="button"
            aria-label={playing ? "หยุด" : "เล่น"}
            onClick={() => {
              if (!playing && currentTimestamp >= playbackEndMs) onTimestampChange(playbackStartMs);
              onPlayingChange(!playing);
            }}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-azure text-[#04070e] hover:bg-cyan"
          >
            {playing ? <IconPlayerPause size={13} /> : <IconPlayerPlay size={13} />}
          </button>
          <button
            type="button"
            aria-label="ถัดไป"
            onClick={() => step(10)}
            className="rounded border border-[rgba(56,100,150,0.5)] p-1 text-ink-dim hover:text-ink"
          >
            <IconChevronsRight size={13} stroke={2} />
          </button>

          <div className="ml-2 flex overflow-hidden rounded border border-[rgba(56,100,150,0.5)]">
            {([1, 2, 4] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onSpeedChange(s)}
                className={
                  s === speed
                    ? "bg-azure px-2 py-0.5 text-[10.5px] font-medium text-[#04070e]"
                    : "px-2 py-0.5 text-[10.5px] text-ink-dim hover:text-ink"
                }
              >
                {s}x
              </button>
            ))}
          </div>
        </div>

        <span className="text-[10px] text-ink-muted">
          ล่าสุด · {formatThaiDate(new Date(playbackEndMs))}
        </span>
      </div>
    </section>
  );
}
