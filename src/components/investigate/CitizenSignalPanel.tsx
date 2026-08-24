import {
  IconChartHistogram,
  IconFileSearch,
  IconShieldCheck,
  IconTopologyStar3,
  IconTrendingUp,
} from "@tabler/icons-react";
import AnomalyLine from "@/components/charts/AnomalyLine";
import StackedBars from "@/components/charts/StackedBars";
import type { CitizenSignal } from "@/server/investigate";

/**
 * The emphasised panel from the mockup: volume of citizen / unofficial-source
 * reporting, its anomalies, and how much of it ever converts into verified fact.
 */
const signed = (n: number) => `${n >= 0 ? "+" : ""}${n}`;

export default function CitizenSignalPanel({ citizen }: { citizen: CitizenSignal }) {
  const tiles = [
    {
      label: "รายงานทั้งหมด",
      value: citizen.totalReports.toLocaleString("en-US"),
      delta: `${signed(citizen.changePct)}% จาก 30 วันที่แล้ว`,
      up: citizen.changePct >= 0,
      icon: IconFileSearch,
    },
    {
      label: "อัตราการเปลี่ยนแปลง",
      value: `${signed(citizen.changePct)}%`,
      delta: citizen.changePct >= 0 ? "แนวโน้มเพิ่มขึ้น" : "แนวโน้มลดลง",
      up: citizen.changePct >= 0,
      icon: IconTrendingUp,
    },
    {
      label: "คลัสเตอร์น่าสงสัย",
      value: String(citizen.suspiciousClusters),
      delta: `${signed(citizen.clusterDelta)} จาก 30 วันที่แล้ว`,
      up: citizen.clusterDelta >= 0,
      icon: IconTopologyStar3,
    },
    {
      label: "อัตราแปลงเป็นข้อเท็จจริง",
      value: `${citizen.factConversionPct}%`,
      delta: `${signed(citizen.factConversionDelta)}% จาก 30 วันที่แล้ว`,
      up: citizen.factConversionDelta >= 0,
      icon: IconShieldCheck,
    },
  ];

  return (
    <section className="panel panel-focus flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center justify-between border-b border-[rgba(56,189,248,0.28)] px-3 py-1.5">
        <h3 className="panel-title flex items-center gap-2">
          <IconChartHistogram size={15} stroke={1.8} className="text-azure" />
          แนวโน้มรายงานจากประชาชนและแหล่งข่าวไม่ทางการ
        </h3>
        <span className="text-[10.5px] text-ink-muted">(30 วันล่าสุด)</span>
      </header>

      {/* Zeros here would read as "we measured nothing happening", when in fact
          no source feeds this stream yet. Say which one it is. */}
      {citizen.totalReports === 0 && (
        <p className="shrink-0 border-b border-[rgba(56,189,248,0.18)] bg-[rgba(56,189,248,0.06)] px-3 py-1.5 text-[10.5px] leading-snug text-ink-muted">
          ยังไม่มี connector ป้อนข้อมูลเข้าคอลเลกชัน{" "}
          <code className="font-mono text-ink-dim">citizen_reports</code> — ตัวเลขด้านล่างจึงเป็นศูนย์
          เพราะไม่มีข้อมูล ไม่ใช่เพราะไม่มีรายงาน
        </p>
      )}

      <div className="grid h-[70px] shrink-0 grid-cols-4 gap-1.5 p-1.5">
        {tiles.map((t) => (
          <div
            key={t.label}
            className="flex min-w-0 items-start justify-between overflow-hidden rounded border border-[rgba(37,66,102,0.55)] bg-[rgba(10,20,36,0.6)] px-2.5 py-1.5"
          >
            <div className="min-w-0">
              <p className="truncate text-[11.5px] text-ink-dim">{t.label}</p>
              <p className="num text-[19px] leading-none font-semibold text-ink">{t.value}</p>
              <p className={`mt-1 text-[10px] leading-tight ${t.up ? "text-mint" : "text-flame"}`}>{t.delta}</p>
            </div>
            <t.icon size={16} stroke={1.7} className="mt-0.5 shrink-0 text-azure/70" />
          </div>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[1fr_auto] gap-1.5 px-1.5 pb-1.5">
        <div className="min-h-0 overflow-hidden rounded border border-[rgba(37,66,102,0.55)] bg-[rgba(10,20,36,0.6)] p-1.5">
          <div className="mb-1 flex items-baseline justify-between">
            <h4 className="text-[11.5px] font-medium text-ink">แนวโน้มรายวัน (30 วัน)</h4>
            <span className="text-[10px] text-ink-muted">จำนวนรายงาน</span>
          </div>
          <AnomalyLine
            daily={citizen.daily}
            average={citizen.rollingAvg}
            anomalyIndex={citizen.anomalyIndex}
            labels={citizen.dayLabels}
            height={94}
          />
          <div className="mt-1 flex items-center gap-4 text-[10px] text-ink-muted">
            <span className="flex items-center gap-1.5">
              <span className="h-px w-4 bg-azure" />
              จำนวนรายงาน
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-px w-4 border-t border-dashed border-ink-dim" />
              ค่าเฉลี่ย 30 วัน
            </span>
          </div>
        </div>

        <div className="w-[318px] overflow-hidden rounded border border-[rgba(37,66,102,0.55)] bg-[rgba(10,20,36,0.6)] p-1.5">
          <h4 className="mb-1 text-[11.5px] font-medium text-ink">
            แหล่งข่าวไม่ทางการ แยกตามประเภทแหล่งที่มา
          </h4>
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <StackedBars channels={citizen.channels} />
            </div>
            <div className="shrink-0 text-right">
              <p className="num text-[19px] leading-none font-semibold text-ink">
                {citizen.totalReports.toLocaleString("en-US")}
              </p>
              <p className="text-[10px] text-ink-muted">รายงานรวม</p>
            </div>
          </div>
          <ul className="mt-1.5 space-y-[3px]">
            {citizen.channels.map((c) => (
              <li key={c.key} className="flex items-center gap-2 text-[10.5px]">
                <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: c.color }} />
                <span className="flex-1 truncate text-ink-dim">{c.label}</span>
                <span className="num text-ink">{c.pct}%</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="grid h-[66px] shrink-0 grid-cols-[1fr_auto] gap-1.5 px-1.5 pb-1.5">
        <div className="overflow-hidden rounded border border-[rgba(37,66,102,0.55)] bg-[rgba(10,20,36,0.6)] p-1.5">
          <h4 className="mb-1 text-[11.5px] font-medium text-ink">
            ประเด็นที่ได้รับความสนใจสูงสุด (Top Signals)
          </h4>
          <div className="flex flex-wrap gap-1">
            {citizen.topSignals.map((s) => (
              <span
                key={s}
                className="chip border-[rgba(56,189,248,0.45)] bg-[rgba(56,189,248,0.1)] text-azure"
              >
                {s}
              </span>
            ))}
          </div>
        </div>

        <div className="w-[318px] overflow-hidden rounded border border-[rgba(37,66,102,0.55)] bg-[rgba(10,20,36,0.6)] p-1.5">
          <h4 className="mb-1 text-[11.5px] font-medium text-ink">
            พื้นที่ที่รายงานเพิ่มขึ้นผิดปกติ (Hotspots)
          </h4>
          {citizen.hotspots.length === 0 ? (
            <p className="text-[10.5px] leading-snug text-ink-muted">
              ไม่พบพื้นที่ที่สูงกว่าแนวโน้มรวมอย่างมีนัยสำคัญ
            </p>
          ) : (
            <ol className="space-y-0.5">
              {citizen.hotspots.map((h) => (
                <li key={h.rank} className="flex items-center gap-2 text-[11px]">
                  <span className="num text-ink-muted">{h.rank}.</span>
                  <span className="flex-1 truncate text-ink-dim">{h.label}</span>
                  <span
                    className="num font-medium text-danger"
                    title="สูงกว่าค่าที่คาดไว้หลังปรับตามแนวโน้มรวมทั้งพื้นที่แล้ว (p < 0.05)"
                  >
                    +{h.delta}%
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </section>
  );
}
