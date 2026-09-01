import {
  IconAlertTriangle,
  IconClockPlay,
  IconDatabase,
  IconPlugConnected,
} from "@tabler/icons-react";
import { relativeThai } from "@/lib/source-labels";
import type { SourceDashboard } from "@/server/sources";

/**
 * Four numbers that say whether the pipeline is healthy, in the order an
 * analyst asks them: how many pipes exist, how much came through them, how
 * much of it is still raw, and whether anything has gone quiet.
 *
 * Deliberately not the investigate KPI row: those cards carry sparklines and
 * period-over-period deltas over the event stream, and none of these four is
 * an event count with a comparable previous window.
 */
export default function SourceKpiRow({ data }: { data: SourceDashboard }) {
  const { totals, builtAtMs } = data;

  const runRate =
    totals.runs > 0 ? Math.round((totals.runsSuccessful / totals.runs) * 100) : null;

  const cards = [
    {
      key: "sources",
      icon: IconPlugConnected,
      label: "แหล่งข้อมูลที่เชื่อมต่อ",
      value: totals.enabled.toLocaleString("en-US"),
      note: `จากที่ขึ้นทะเบียน ${totals.sources.toLocaleString("en-US")} แห่ง`,
      tone: "muted" as const,
    },
    {
      key: "events",
      icon: IconDatabase,
      label: "เหตุการณ์ที่ได้จากแหล่งข้อมูล",
      value: totals.events.toLocaleString("en-US"),
      note: `เรกคอร์ดดิบสะสม ${totals.rawRecords.toLocaleString("en-US")}`,
      tone: "muted" as const,
    },
    {
      key: "runs",
      icon: IconClockPlay,
      label: "รอบดึงข้อมูลที่สำเร็จ",
      value: runRate === null ? "—" : `${runRate}%`,
      note:
        totals.runs > 0
          ? `${totals.runsSuccessful.toLocaleString("en-US")} จาก ${totals.runs.toLocaleString("en-US")} รอบ`
          : "ยังไม่มีรอบดึงข้อมูล",
      tone: runRate === null ? ("muted" as const) : runRate >= 90 ? ("good" as const) : ("warn" as const),
    },
    {
      key: "silent",
      icon: IconAlertTriangle,
      label: "แหล่งข้อมูลที่ยังไม่ส่งข้อมูล",
      value: totals.silent.toLocaleString("en-US"),
      // The freshest record in the whole register is the other half of this
      // card: "nothing is silent" and "nothing has arrived for a month" are
      // different problems, and one number alone cannot tell them apart.
      note: `ข้อมูลล่าสุด ${relativeThai(totals.latestEventMs, builtAtMs)}`,
      tone: totals.silent > 0 ? ("warn" as const) : ("good" as const),
    },
  ];

  const TONE = {
    good: "text-mint",
    warn: "text-amber",
    muted: "text-ink-muted",
  };

  return (
    <div className="grid h-full grid-cols-2 gap-2 sm:grid-cols-4">
      {cards.map((c) => (
        <article key={c.key} className="panel flex h-full items-start gap-3 px-3.5 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-[12px] leading-snug text-ink-dim sm:truncate">{c.label}</p>
            <p className="num mt-0.5 text-[26px] leading-none font-semibold tracking-tight text-ink">
              {c.value}
            </p>
            <p className={`mt-2 truncate text-[11px] ${TONE[c.tone]}`} title={c.note}>
              {c.note}
            </p>
          </div>
          <c.icon size={17} stroke={1.7} className="mt-0.5 shrink-0 text-azure/80" />
        </article>
      ))}
    </div>
  );
}
