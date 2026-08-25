import { IconCalendarTime, IconGauge, IconPlayerPlay, IconTarget } from "@tabler/icons-react";
import Sparkline from "@/components/charts/Sparkline";
import { RiskMeter } from "@/components/charts/Gauges";
import type { DensityScore } from "@/lib/events-replay";
import type { EventsWorkspace as EventsWorkspaceData } from "@/server/events";

/**
 * The 4 KPI cards from the mockup. Distinct from `/investigate`'s `KpiRow` —
 * different questions (progress through a replay, not a filtered snapshot).
 */
export default function EventsKpiRow({
  data,
  playedCount,
  density,
}: {
  data: EventsWorkspaceData;
  playedCount: number;
  density: DensityScore;
}) {
  const playedPct = data.totalMatched > 0 ? Math.round((playedCount / data.totalMatched) * 100) : 0;

  return (
    <div className="grid h-full grid-cols-4 gap-2">
      <article className="panel flex h-full items-start gap-3 px-3.5 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] text-ink-dim">เหตุการณ์ทั้งหมด</p>
          <p className="num mt-0.5 text-[26px] leading-none font-semibold tracking-tight text-ink">
            {data.totalMatched.toLocaleString("en-US")}
          </p>
          <p className="mt-2 text-[11px] text-ink-muted">เหตุการณ์ที่ตรงกับตัวกรอง</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <IconTarget size={17} stroke={1.7} className="text-azure/80" />
          <Sparkline points={data.histogram.buckets.map((b) => b.count)} />
        </div>
      </article>

      <article className="panel flex h-full items-start gap-3 px-3.5 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] text-ink-dim">ช่วงเวลาที่กำลังเล่น</p>
          {data.span ? (
            <>
              <p className="text-[15px] leading-tight font-semibold text-ink">{data.span.label}</p>
              <p className="mt-2 text-[11px] text-ink-muted">ระยะเวลา {data.span.durationLabel}</p>
            </>
          ) : (
            <p className="mt-1 text-[13px] text-ink-muted italic">ไม่มีเหตุการณ์ในช่วงที่เลือก</p>
          )}
        </div>
        <IconCalendarTime size={17} stroke={1.7} className="shrink-0 text-azure/80" />
      </article>

      <article className="panel flex h-full items-start gap-3 px-3.5 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] text-ink-dim">เหตุการณ์ที่เล่นไปแล้ว</p>
          <p className="num mt-0.5 text-[26px] leading-none font-semibold tracking-tight text-ink">
            {playedCount.toLocaleString("en-US")}
            <span className="text-[14px] text-ink-muted"> / {data.totalMatched.toLocaleString("en-US")}</span>
          </p>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[rgba(56,100,150,0.25)]">
            <div className="h-full rounded-full bg-azure" style={{ width: `${playedPct}%` }} />
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <IconPlayerPlay size={17} stroke={1.7} className="text-azure/80" />
          <span className="num text-[11px] text-ink-muted">{playedPct}%</span>
        </div>
      </article>

      <article className="panel flex h-full items-start gap-3 px-3.5 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] text-ink-dim">ความหนาแน่นเหตุการณ์</p>
          <p
            className="mt-0.5 text-[20px] leading-none font-semibold"
            style={{
              color: density.band === "สูง" ? "#ef4444" : density.band === "ปานกลาง" ? "#f59e0b" : "#22c55e",
            }}
          >
            {density.band}
          </p>
          <p className="mt-2 text-[11px] text-ink-muted">
            พื้นที่เสี่ยง{density.band === "สูง" ? "สูง" : density.band === "ปานกลาง" ? "ปานกลางถึงสูง" : "ต่ำ"}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-center gap-1">
          <RiskMeter value={density.score} width={64} />
          <IconGauge size={13} stroke={1.7} className="text-azure/60" />
        </div>
      </article>
    </div>
  );
}
