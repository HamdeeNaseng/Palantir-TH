import { RUN_STATUS_COLOR, RUN_STATUS_LABEL, relativeThai } from "@/lib/source-labels";
import type { RunRow } from "@/server/sources";

/**
 * The `ingestion_runs` tail — the observability half of the register.
 *
 * A run is only interesting for two things: whether it worked, and what it
 * brought in. Both are on the row; the source's own catalog metadata is in
 * the table to the left and is not repeated here.
 */
export default function IngestionRunsPanel({
  runs,
  nowMs,
}: {
  runs: RunRow[];
  nowMs: number;
}) {
  return (
    <section className="panel flex min-h-0 flex-col">
      <header className="flex shrink-0 items-center justify-between border-b border-[rgba(37,66,102,0.45)] px-3.5 py-2.5">
        <h2 className="panel-title">รอบดึงข้อมูลล่าสุด</h2>
        <span className="num text-[10.5px] text-ink-muted">{runs.length} รอบ</span>
      </header>

      {runs.length === 0 ? (
        <p className="px-3.5 py-6 text-center text-[11.5px] text-ink-muted">
          ยังไม่มีรอบดึงข้อมูลที่บันทึกไว้
        </p>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {runs.map((r) => {
            const color = RUN_STATUS_COLOR[r.status];
            return (
              <li
                key={r.id}
                className="border-t border-[rgba(37,66,102,0.3)] px-3.5 py-2 first:border-t-0"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: color, boxShadow: `0 0 5px ${color}` }}
                  />
                  <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink" title={r.sourceName}>
                    {r.sourceName}
                  </span>
                  <span className="shrink-0 text-[10.5px]" style={{ color }}>
                    {RUN_STATUS_LABEL[r.status]}
                  </span>
                </div>

                <p className="num mt-0.5 pl-3.5 text-[10.5px] text-ink-muted">
                  {relativeThai(r.startedAtMs, nowMs)} · ดึงมา{" "}
                  {r.downloaded.toLocaleString("en-US")} · ใหม่{" "}
                  <span className={r.added > 0 ? "text-ink-dim" : undefined}>
                    {r.added.toLocaleString("en-US")}
                  </span>
                  {r.failed > 0 && (
                    <span className="text-flame"> · พลาด {r.failed.toLocaleString("en-US")}</span>
                  )}
                </p>

                {r.error && (
                  <p
                    className="mt-0.5 truncate pl-3.5 text-[10.5px] text-flame"
                    title={r.error}
                  >
                    {r.error}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
