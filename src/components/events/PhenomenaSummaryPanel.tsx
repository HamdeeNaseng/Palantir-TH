import { IconAlertTriangle, IconInfoCircle, IconMoodEmpty } from "@tabler/icons-react";
import type { PhenomenonInsight } from "@/lib/events-replay";

/**
 * "สรุปปรากฏการณ์" — built only from `districtClusters`' computed Poisson
 * significance (see `@/lib/events-replay`), never a generated narrative. An
 * empty list is the honest, expected answer when nothing in the current
 * window clears significance — same tone as `CitizenSignalPanel`'s existing
 * "ไม่พบพื้นที่..." empty state.
 */
export default function PhenomenaSummaryPanel({ insights }: { insights: PhenomenonInsight[] }) {
  return (
    <section className="panel flex flex-col">
      <header className="border-b border-[rgba(37,66,102,0.45)] px-3.5 py-2.5">
        <h3 className="panel-title">สรุปปรากฏการณ์</h3>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-2.5">
        {insights.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 py-4 text-center">
            <IconMoodEmpty size={20} stroke={1.5} className="text-ink-muted" />
            <p className="text-[11.5px] text-ink-muted">ยังไม่พบรูปแบบที่มีนัยสำคัญในช่วงนี้</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {insights.map((insight) => {
              const Icon = insight.tone === "warning" ? IconAlertTriangle : IconInfoCircle;
              const color = insight.tone === "warning" ? "#ef4444" : "#38bdf8";
              return (
                <li key={insight.id} className="flex items-start gap-2">
                  <Icon size={14} stroke={1.8} className="mt-0.5 shrink-0" color={color} />
                  <p className="text-[11.5px] leading-snug text-ink-dim">{insight.text}</p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
