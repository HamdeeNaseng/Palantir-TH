"use client";

import { useState } from "react";
import { IconChevronDown, IconChevronLeft, IconInfoCircle } from "@tabler/icons-react";
import type {
  PredictionBundle,
  PredictionForecast,
  PredictionForecastEntry,
} from "@/lib/flow/prediction";

/**
 * What the route-prediction model says, and what it is not entitled to say.
 *
 * The panel exists as much for the second half as the first. The model is
 * *well calibrated and weak* — it beats every baseline on log-loss while
 * getting the district into its top three about 15% of the time. Either half
 * alone misleads, so the skill row always shows the accuracy next to the
 * random baseline it has to be read against, and the corpus cut-off is stated
 * rather than implied.
 */

interface Props {
  bundle: PredictionBundle;
  forecast: PredictionForecast | null;
  forecastLoading: boolean;
  onClearSelection: () => void;
}

export default function PredictionPanel({
  bundle,
  forecast,
  forecastLoading,
  onClearSelection,
}: Props) {
  const [open, setOpen] = useState(false);
  const { run, outlook } = bundle;

  return (
    /**
     * Three bands: a fixed header, a body that scrolls, and a footer that does
     * not. The footer holds the skill row and the caveat, and those have to
     * survive a short viewport — an earlier version made them `sticky` inside
     * a scrolling column, which pinned them *over* the forecast rows instead of
     * reserving space for them.
     */
    <div className="flex min-h-0 flex-col rounded border border-[rgba(56,100,150,0.5)] bg-[rgba(6,13,25,0.9)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-10 w-full shrink-0 items-center gap-1.5 px-2.5 py-2 text-left lg:min-h-0 lg:cursor-default"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[11.5px] font-semibold text-ink">
            คาดการณ์พื้นที่ถัดไป
          </span>
          <span className="num block text-[9.5px] text-ink-muted">
            {run.tauDays !== null ? `τ = ${run.tauDays} วัน · ` : ""}
            {outlook?.asOf ? `ณ ${outlook.asOf.slice(0, 10)}` : "—"}
          </span>
        </span>
        <IconChevronDown
          size={14}
          stroke={2}
          className={`shrink-0 text-ink-muted transition-transform lg:hidden ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      <div className={`flex min-h-0 flex-col lg:flex ${open ? "flex" : "hidden"}`}>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {forecast ? (
            <AnchorForecast
              forecast={forecast}
              loading={forecastLoading}
              onBack={onClearSelection}
            />
          ) : (
            <Outlook bundle={bundle} loading={forecastLoading} />
          )}
        </div>

        {/* The two numbers that keep the rest honest. Accuracy alone reads as
            a failure; skill alone reads as a solved problem. Outside the
            scrolling body on purpose: a caveat that scrolls away is a caveat
            that was not given. */}
        <div className="shrink-0 border-t border-[rgba(37,66,102,0.6)] px-2.5 py-2">
          <div className="flex items-baseline justify-between text-[10px]">
            <span className="text-ink-muted">แม่นยำ 3 อันดับแรก</span>
            <span className="num text-ink-dim">
              {pct(run.skill.top3)}
              <span className="text-ink-muted">
                {" "}
                (สุ่ม {pct(run.skill.randomTop3)})
              </span>
            </span>
          </div>
          <p className="mt-1 flex gap-1 text-[9.5px] leading-relaxed text-ink-muted">
            <IconInfoCircle size={12} stroke={1.7} className="mt-px shrink-0" />
            <span>
              ช่องทางที่เหตุการณ์เชื่อมโยงกันตามถนน{" "}
              <b className="font-semibold text-amber">ไม่ใช่เส้นทางเดินทางของบุคคล</b> ·
              ความละเอียดระดับอำเภอ (±8 กม.)
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}

function Outlook({ bundle, loading }: { bundle: PredictionBundle; loading: boolean }) {
  const { outlook } = bundle;
  if (!outlook || outlook.top.length === 0) {
    return <p className="px-2.5 pb-2 text-[10px] text-ink-muted">ไม่มีผลคาดการณ์ในรันนี้</p>;
  }

  const max = Math.max(...outlook.top.map((t) => t.probability), 0.0001);

  return (
    <div className="px-2.5 pb-2">
      {outlook.focus && (
        <p className="mb-1.5 truncate text-[10px] text-ink-muted">
          จุดตั้งต้น <span className="text-ink-dim">{outlook.focus.name}</span>
        </p>
      )}
      <ul className="flex flex-col gap-[3px]">
        {outlook.top.slice(0, 5).map((row) => (
          <li key={row.anchorId} className="flex items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-[11px] text-ink-dim">{row.name}</span>
            <span className="h-1.5 w-[52px] shrink-0 overflow-hidden rounded-[1px] bg-[rgba(56,100,150,0.25)]">
              <span
                className="block h-full rounded-[1px] bg-[#c084fc]"
                style={{ width: `${Math.max(6, (row.probability / max) * 100)}%` }}
              />
            </span>
            <span className="num w-[34px] shrink-0 text-right text-[10px] text-ink-dim">
              {pct(row.probability)}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-[9.5px] text-ink-muted">
        {loading ? "กำลังโหลด…" : "แตะจุดสีม่วงบนแผนที่เพื่อดูรายอำเภอ"}
      </p>
    </div>
  );
}

function AnchorForecast({
  forecast,
  loading,
  onBack,
}: {
  forecast: PredictionForecast;
  loading: boolean;
  onBack: () => void;
}) {
  // Scale to the widest interval, not the largest mean: a bar clipped at its
  // own mean would hide exactly the uncertainty this view exists to show.
  const max = Math.max(...forecast.entries.map((e) => e.high), 0.0001);

  return (
    <div className="px-2.5 pb-2">
      <button
        type="button"
        onClick={onBack}
        className="-ml-1 mb-1 flex items-center gap-0.5 text-[10px] text-ink-muted hover:text-ink"
      >
        <IconChevronLeft size={12} stroke={2} />
        ภาพรวม
      </button>
      <p className="truncate text-[11px] font-semibold text-ink">{forecast.name}</p>
      <p className="num mb-1.5 text-[9.5px] text-ink-muted">
        {forecast.observations.toLocaleString("en-US")} ครั้งที่พบร่วมหน้าต่างเดียวกัน
      </p>

      {/* With no co-occurrence at all, every number below is the road-distance
          prior on its own — and the backtest puts that *below* uniform
          guessing. Ranked bars would read as evidence, so the reader is told
          outright that there is none. */}
      {forecast.observations === 0 && (
        <p className="mb-1.5 rounded border border-amber/40 bg-[#211808]/70 px-1.5 py-1 text-[9.5px] leading-relaxed text-amber">
          ยังไม่เคยพบร่วมกับอำเภอใดในหน้าต่างเดียวกัน — ตัวเลขด้านล่างมาจาก prior
          ระยะทางถนนล้วน ไม่ใช่หลักฐาน
        </p>
      )}

      {loading ? (
        <p className="text-[10px] text-ink-muted">กำลังโหลด…</p>
      ) : (
        <ul className="flex flex-col gap-[3px]">
          {forecast.entries.slice(0, 5).map((entry) => (
            <IntervalRow key={entry.anchorId} entry={entry} max={max} />
          ))}
        </ul>
      )}

      <p className="mt-1.5 text-[9.5px] leading-relaxed text-ink-muted">
        แถบคือช่วงความเชื่อมั่น 90% — ยิ่งกว้างยิ่งมีข้อมูลน้อย
      </p>
    </div>
  );
}

/**
 * One district, drawn as its credible interval with the mean marked on it.
 *
 * The interval is the bar, not an error whisker bolted onto a bar of the
 * mean. A posterior of 0.08 from three observations and 0.08 from three
 * hundred are different claims, and drawing the mean alone renders them
 * identically.
 */
function IntervalRow({ entry, max }: { entry: PredictionForecastEntry; max: number }) {
  const left = (entry.low / max) * 100;
  const width = Math.max(2, ((entry.high - entry.low) / max) * 100);
  const mean = (entry.mean / max) * 100;

  return (
    <li className="flex items-center gap-1.5">
      <span className="min-w-0 flex-1 truncate text-[11px] text-ink-dim" title={entry.name}>
        {entry.name}
      </span>
      <span className="relative h-2 w-[62px] shrink-0 overflow-hidden rounded-[1px] bg-[rgba(56,100,150,0.25)]">
        <span
          className="absolute top-0 h-full rounded-[1px] bg-[rgba(192,132,252,0.45)]"
          style={{ left: `${left}%`, width: `${width}%` }}
        />
        <span
          className="absolute top-0 h-full w-px bg-[#f0abfc]"
          style={{ left: `${Math.min(99, mean)}%` }}
        />
      </span>
      <span className="num w-[34px] shrink-0 text-right text-[10px] text-ink-dim">
        {pct(entry.mean)}
      </span>
    </li>
  );
}

function pct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}
