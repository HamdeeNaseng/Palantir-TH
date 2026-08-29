import {
  IconBook2,
  IconShieldCheck,
  IconTarget,
  IconTrendingUp,
} from "@tabler/icons-react";
import Sparkline from "@/components/charts/Sparkline";
import { ConfidenceRing } from "@/components/charts/Gauges";
import type { KpiCard } from "@/lib/view-models/investigate";

const ICONS = {
  target: IconTarget,
  shield: IconShieldCheck,
  book: IconBook2,
  gauge: IconTrendingUp,
} as const;

export default function KpiRow({ kpis }: { kpis: KpiCard[] }) {
  return (
    <div className="grid h-full grid-cols-2 gap-2 sm:grid-cols-4">
      {kpis.map((k) => {
        const Icon = ICONS[k.icon];
        return (
          <article key={k.key} className="panel flex h-full items-start gap-3 px-3.5 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-[12px] leading-snug text-ink-dim sm:truncate">{k.label}</p>
              <p className="num mt-0.5 text-[26px] leading-none font-semibold tracking-tight text-ink">
                {k.value}
              </p>
              <p
                className={`mt-2 text-[11px] ${
                  k.deltaTone === "up" ? "text-mint" : k.deltaTone === "down" ? "text-flame" : "text-ink-muted"
                }`}
              >
                {k.delta}
                {k.deltaNote ? <span className="text-ink-muted"> {k.deltaNote}</span> : null}
              </p>
            </div>

            <div className="flex shrink-0 flex-col items-end gap-1.5">
              {k.ring !== undefined ? (
                <ConfidenceRing value={k.ring} />
              ) : (
                <>
                  <Icon size={17} stroke={1.7} className="text-azure/80" />
                  <span className="hidden sm:block">
                    <Sparkline points={k.spark} />
                  </span>
                </>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
