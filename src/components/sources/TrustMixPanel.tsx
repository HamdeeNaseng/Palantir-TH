import { TRUST_CLASS_COLOR, TRUST_CLASS_LABEL } from "@/lib/source-labels";
import type { TrustSlice } from "@/server/sources";

/**
 * What the register is actually made of, by the trust class of whoever
 * reported it.
 *
 * This is the page's one editorial claim: a dataset that is 90% one class is
 * a different dataset from a balanced one, and nothing else on the console
 * shows that. A single stacked bar rather than a pie — the comparison being
 * made is between shares of one whole, and a bar reads that at this size.
 */
export default function TrustMixPanel({ mix }: { mix: TrustSlice[] }) {
  const total = mix.reduce((s, m) => s + m.events, 0);

  return (
    <section className="panel flex min-h-0 flex-col">
      <header className="shrink-0 border-b border-[rgba(37,66,102,0.45)] px-3.5 py-2.5">
        <h2 className="panel-title">ส่วนผสมของชั้นความน่าเชื่อถือ</h2>
        <p className="num text-[10.5px] text-ink-muted">
          {total.toLocaleString("en-US")} เหตุการณ์ · {mix.length} ชั้น
        </p>
      </header>

      {total === 0 ? (
        <p className="px-3.5 py-6 text-center text-[11.5px] text-ink-muted">
          ยังไม่มีเหตุการณ์ให้แยกชั้น
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3">
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-[rgba(56,100,150,0.25)]">
            {mix
              .filter((m) => m.events > 0)
              .map((m) => (
                <span
                  key={m.trustClass}
                  className="block h-full first:rounded-l-full last:rounded-r-full"
                  style={{ width: `${m.share}%`, background: TRUST_CLASS_COLOR[m.trustClass] }}
                  title={`${TRUST_CLASS_LABEL[m.trustClass]} ${m.share.toFixed(1)}%`}
                />
              ))}
          </div>

          <ul className="mt-3 flex flex-col gap-1.5">
            {mix.map((m) => (
              <li key={m.trustClass} className="flex items-center gap-2">
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-[1px]"
                  style={{ background: TRUST_CLASS_COLOR[m.trustClass] }}
                />
                <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-dim">
                  {TRUST_CLASS_LABEL[m.trustClass]}
                  <span className="ml-1 text-ink-muted">({m.sources})</span>
                </span>
                <span className="num shrink-0 text-[11px] text-ink">
                  {m.events.toLocaleString("en-US")}
                </span>
                <span className="num w-11 shrink-0 text-right text-[10.5px] text-ink-muted">
                  {m.share.toFixed(1)}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
