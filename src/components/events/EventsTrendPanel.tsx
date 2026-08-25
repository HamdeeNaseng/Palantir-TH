import AnomalyLine from "@/components/charts/AnomalyLine";
import { rollingMean } from "@/lib/stats";
import type { EventsWorkspace as EventsWorkspaceData } from "@/server/events";

/** How far back "ช่วงที่กำลังเล่น" reaches from the playhead, in buckets of history. */
const HIGHLIGHT_LOOKBACK_MS = 180 * 86400000;

function bucketIndexAt(buckets: EventsWorkspaceData["histogram"]["buckets"], atMs: number): number {
  for (let i = 0; i < buckets.length; i++) {
    if (atMs < buckets[i].endMs) return i;
  }
  return Math.max(0, buckets.length - 1);
}

/**
 * Full-span event count over time, with the currently-playing window
 * highlighted — the mockup's แนวโน้มตามไทม์ไลน์. Reuses `AnomalyLine` with its
 * generalized `band` prop rather than a chart built from scratch.
 */
export default function EventsTrendPanel({
  data,
  currentTimestamp,
}: {
  data: EventsWorkspaceData;
  currentTimestamp: number;
}) {
  const buckets = data.histogram.buckets;
  const counts = buckets.map((b) => b.count);
  const average = rollingMean(counts, Math.max(2, Math.round(buckets.length / 8)));
  const labels = buckets.map((b) => b.label);

  const endIdx = bucketIndexAt(buckets, currentTimestamp);
  const startIdx = bucketIndexAt(buckets, currentTimestamp - HIGHLIGHT_LOOKBACK_MS);

  return (
    <section className="panel flex flex-col">
      <header className="flex items-center justify-between border-b border-[rgba(37,66,102,0.45)] px-3.5 py-2.5">
        <h3 className="panel-title">แนวโน้มตามไทม์ไลน์</h3>
        <span className="text-[10.5px] text-ink-muted">{data.histogram.bucketLabel}</span>
      </header>

      <div className="flex-1 px-2 pt-3">
        {buckets.length > 1 ? (
          <AnomalyLine
            daily={counts}
            average={average}
            anomalyIndex={[]}
            labels={labels}
            height={150}
            band={{ start: startIdx, end: endIdx, color: "#38bdf8", label: "ช่วงที่กำลังเล่น" }}
          />
        ) : (
          <p className="py-8 text-center text-[11.5px] text-ink-muted">
            ไม่มีข้อมูลเพียงพอสำหรับแสดงแนวโน้ม
          </p>
        )}
      </div>

      <div className="flex items-center gap-4 px-3.5 pb-2.5 text-[10px] text-ink-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-px w-4 bg-azure" />
          จำนวนเหตุการณ์
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-px w-4 border-t border-dashed border-ink-dim" />
          ค่าเฉลี่ย
        </span>
      </div>
    </section>
  );
}
