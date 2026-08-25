import {
  IconChevronDown,
  IconChevronRight,
  IconCar,
  IconDeviceMobile,
  IconFlame,
  IconMapPin,
  IconUser,
  IconUsers,
} from "@tabler/icons-react";
import StackedArea from "@/components/charts/StackedArea";
import { ScoreBar } from "@/components/charts/Gauges";
import type { InvestigationDashboard } from "@/server/investigate";

function PanelHead({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <header className="flex items-center justify-between border-b border-[rgba(37,66,102,0.45)] px-3.5 py-2.5">
      <h3 className="panel-title">{title}</h3>
      {action}
    </header>
  );
}

const GhostButton = ({ children }: { children: React.ReactNode }) => (
  <button
    type="button"
    className="flex items-center gap-1 rounded border border-[rgba(56,100,150,0.5)] px-2 py-0.5 text-[10.5px] text-ink-muted hover:text-ink"
  >
    {children}
  </button>
);

/** แนวโน้มเหตุการณ์ — ช่วงเวลาและหน่วยเวลาตามตัวกรองที่เลือก */
export function TrendPanel({ trend }: { trend: InvestigationDashboard["trend"] }) {
  return (
    <section className="panel flex flex-col">
      <PanelHead
        title={`แนวโน้มเหตุการณ์ (${trend.bucketLabel})`}
        action={
          <GhostButton>
            ทุกปืน
            <IconChevronDown size={12} stroke={2} />
          </GhostButton>
        }
      />
      <div className="flex-1 px-2 pt-3">
        <StackedArea series={trend.series} labels={trend.labels} max={trend.max} />
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 px-3.5 pt-1 pb-3">
        {trend.series.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5 text-[10px] text-ink-muted">
            <span className="h-1.5 w-1.5 rounded-[1px]" style={{ background: s.color }} />
            {s.label}
          </li>
        ))}
      </ul>
    </section>
  );
}

const NODE_ICON = {
  person: IconUser,
  group: IconUsers,
  place: IconMapPin,
  vehicle: IconCar,
  phone: IconDeviceMobile,
  event: IconFlame,
} as const;

/** ความเชื่อมโยงของกลุ่มที่ — entity graph radiating from the focal event. */
export function NetworkPanel({ network }: { network: InvestigationDashboard["network"] }) {
  const byId = new Map(network.nodes.map((n) => [n.id, n]));

  return (
    <section className="panel flex flex-col">
      <PanelHead title="ความเชื่อมโยงของกลุ่มที่" action={<GhostButton>ดูทั้งหมด</GhostButton>} />

      <div className="relative flex-1 p-2">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          {network.edges.map((e) => {
            const a = byId.get(e.from);
            const b = byId.get(e.to);
            if (!a || !b) return null;
            return (
              <line
                key={`${e.from}-${e.to}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="rgba(90,150,210,0.45)"
                strokeWidth="0.35"
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </svg>

        {/* Edge weights sit in a normal-flow layer so they stay unskewed. */}
        <div className="pointer-events-none absolute inset-0">
          {network.edges.map((e) => {
            const a = byId.get(e.from);
            const b = byId.get(e.to);
            if (!a || !b) return null;
            return (
              <span
                key={`${e.from}-w`}
                className="num absolute -translate-x-1/2 -translate-y-1/2 rounded bg-[#0a1220] px-1 text-[9.5px] text-ink-dim"
                style={{ left: `${(a.x + b.x) / 2}%`, top: `${(a.y + b.y) / 2}%` }}
              >
                {e.weight}
              </span>
            );
          })}

          {network.nodes.map((n) => {
            const Icon = NODE_ICON[n.icon];
            const focal = n.id === "event";
            const size = focal ? 34 : 26;
            return (
              <div
                key={n.id}
                className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1"
                style={{ left: `${n.x}%`, top: `${n.y}%` }}
              >
                <span
                  className="flex items-center justify-center rounded-full"
                  style={{
                    width: size,
                    height: size,
                    background: `${n.accent}22`,
                    border: `1.5px solid ${n.accent}`,
                    boxShadow: focal ? `0 0 16px ${n.accent}99` : `0 0 8px ${n.accent}44`,
                  }}
                >
                  <Icon size={focal ? 17 : 13} stroke={1.8} color={n.accent} />
                </span>
                <span className="text-center text-[9.5px] leading-tight whitespace-nowrap text-ink-dim">
                  {n.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/** แหล่งข้อมูลและความน่าเชื่อถือ */
export function SourceReliabilityPanel({ sources }: { sources: InvestigationDashboard["sources"] }) {
  return (
    <section className="panel flex flex-col">
      <PanelHead title="แหล่งข้อมูลและความน่าเชื่อถือ" action={<GhostButton>อัปเดตล่าสุด</GhostButton>} />

      <div className="min-h-0 flex-1 overflow-y-auto">
      <table className="w-full">
        <thead>
          <tr className="text-[10.5px] text-ink-muted">
            <th className="px-3.5 py-1.5 text-left font-normal">แหล่งข้อมูล</th>
            <th className="py-1.5 text-left font-normal">ประเภท</th>
            <th className="px-3.5 py-1.5 text-right font-normal">ความน่าเชื่อถือ</th>
          </tr>
        </thead>
        <tbody>
          {sources.map((s) => (
            <tr key={s.id} className="border-t border-[rgba(37,66,102,0.3)]">
              <td className="px-3.5 py-[7px] text-[11.5px] whitespace-nowrap text-ink">{s.name}</td>
              <td className="py-[7px] text-[11px] whitespace-nowrap text-ink-muted">{s.category}</td>
              <td className="px-3.5 py-[7px]">
                <div className="flex items-center justify-end gap-2">
                  <div className="w-[72px]">
                    <ScoreBar value={s.score} />
                  </div>
                  <span className="num w-8 text-right text-[11px] text-ink-dim">{s.score}%</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </section>
  );
}

/** รายการเหตุการณ์ล่าสุด */
export function RecentEventsPanel({
  rows,
  total,
}: {
  rows: InvestigationDashboard["recentEvents"];
  total: number;
}) {
  const fmt = new Intl.DateTimeFormat("th-TH", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    calendar: "buddhist",
  });

  return (
    <section className="panel flex flex-col">
      <PanelHead title="รายการเหตุการณ์ล่าสุด" />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <table className="w-full border-separate border-spacing-0">
          <thead className="sticky top-0 bg-[#0b1524]">
            <tr className="text-[10.5px] text-ink-muted">
              <th className="px-3.5 py-1.5 text-left font-normal">วันที่</th>
              <th className="py-1.5 text-left font-normal">ประเภท</th>
              <th className="py-1.5 text-left font-normal">ตำบล/อำเภอ</th>
              <th className="py-1.5 text-left font-normal">จังหวัด</th>
              <th className="py-1.5 text-left font-normal">ความรุนแรง</th>
              <th className="px-3.5 py-1.5 text-left font-normal">แหล่งข้อมูลหลัก</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                className="border-t border-[rgba(37,66,102,0.3)] hover:bg-[rgba(56,189,248,0.05)]"
              >
                <td className="num px-3.5 py-[7px] text-[11px] whitespace-nowrap text-ink-dim">
                  {fmt.format(r.at)}
                </td>
                <td className="py-[7px] text-[11.5px] whitespace-nowrap text-ink">{r.type}</td>
                <td className="py-[7px] text-[11.5px] whitespace-nowrap text-ink-dim">{r.district}</td>
                <td className="py-[7px] text-[11.5px] whitespace-nowrap text-ink-dim">{r.province}</td>
                <td className="py-[7px] whitespace-nowrap">
                  <SeverityPill level={r.severity} label={r.severityLabel} />
                </td>
                <td className="px-3.5 py-[7px] text-[11px] whitespace-nowrap text-ink-dim">
                  {r.source}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <footer className="border-t border-[rgba(37,66,102,0.45)] px-3.5 py-2 text-right">
        <button type="button" className="inline-flex items-center gap-1 text-[11.5px] text-azure hover:underline">
          ดูทั้งหมด {total.toLocaleString("en-US")} รายการ
          <IconChevronRight size={13} stroke={2} />
        </button>
      </footer>
    </section>
  );
}

export function SeverityPill({ level, label }: { level: number; label: string }) {
  // level 0 means the source reported nothing implying severity. Show that as
  // an explicit unknown rather than as the lowest rung, which would read as
  // "this was minor" — a claim the data does not support.
  if (level < 1 || level > 5) {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-[11px] text-ink-muted"
        title="แหล่งข้อมูลไม่ได้ระบุระดับความรุนแรง"
      >
        <span className="flex h-4 w-4 items-center justify-center rounded-full border border-dashed border-ink-muted text-[9px]">
          –
        </span>
        {label}
      </span>
    );
  }

  const color = ["", "#22c55e", "#84cc16", "#f59e0b", "#f97316", "#ef4444"][level];
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px]" style={{ color }}>
      <span
        className="num flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-semibold"
        style={{ background: `${color}26`, border: `1px solid ${color}` }}
      >
        {level}
      </span>
      {label}
    </span>
  );
}
