import {
  IconAlertTriangle,
  IconCar,
  IconChevronRight,
  IconClipboardList,
  IconDeviceMobile,
  IconMapPin,
  IconUser,
  IconUsers,
} from "@tabler/icons-react";
import { RiskMeter } from "@/components/charts/Gauges";
import type { CaseDoc } from "@/lib/types";

const UPDATE_TAG = {
  urgent: { label: "หารีบยูเร่งด่วน", color: "#ef4444" },
  connected: { label: "เชื่อมโยง", color: "#22c55e" },
  new: { label: "เพิ่มเข้า", color: "#f59e0b" },
} as const;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-[5px]">
      <span className="w-[74px] shrink-0 text-[11px] text-ink-muted">{label}</span>
      <span className="min-w-0 flex-1 text-[11.5px] text-ink">{children}</span>
    </div>
  );
}

/** Right-hand rail: the case the analyst is currently working. */
export default function CaseRail({ activeCase }: { activeCase: CaseDoc | null }) {
  const fmtDate = new Intl.DateTimeFormat("th-TH", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    calendar: "buddhist",
  });

  if (!activeCase) {
    return (
      <aside className="panel flex h-full min-h-0 w-full items-center justify-center bg-[#070e1b] text-[12px] text-ink-muted">
        ไม่มีเคสที่กำลังติดตาม
      </aside>
    );
  }

  const entities = [
    { icon: IconUser, label: "บุคคล", n: activeCase.entities.people },
    { icon: IconUsers, label: "กลุ่ม", n: activeCase.entities.groups },
    { icon: IconCar, label: "ยานพาหนะ", n: activeCase.entities.vehicles },
    { icon: IconDeviceMobile, label: "โทรศัพท์", n: activeCase.entities.phones },
    { icon: IconMapPin, label: "สถานที่", n: activeCase.entities.places },
    { icon: IconClipboardList, label: "หลักฐาน", n: activeCase.entities.evidence },
  ];

  return (
    <aside className="panel flex h-full min-h-0 w-full flex-col overflow-y-auto bg-[#070e1b]">
      <header className="flex items-center justify-between border-b border-[rgba(37,66,102,0.55)] px-3.5 py-2.5">
        <h2 className="text-[13px] font-semibold text-ink">เคสที่กำลังติดตาม</h2>
        <button
          type="button"
          className="rounded border border-[rgba(56,100,150,0.5)] px-1.5 py-0.5 text-[10.5px] text-ink-muted hover:text-ink"
        >
          ดูทั้งหมด
        </button>
      </header>

      <div className="border-b border-[rgba(37,66,102,0.45)] px-3.5 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-[13px] leading-snug font-semibold text-ink">{activeCase.title}</h3>
            <p className="num mt-0.5 text-[11.5px] text-ink-dim">{activeCase.code}</p>
          </div>
          <span className="chip shrink-0 border-amber/60 bg-amber/15 text-amber">กำลังสืบสวน</span>
        </div>

        <div className="mt-2.5">
          <Row label="วันที่เกิดเหตุ">{fmtDate.format(activeCase.occurred_at)} น.</Row>
          <Row label="สถานที่">{activeCase.location}</Row>
          <Row label="ประเภทเหตุ">{activeCase.event_type}</Row>
          <Row label="ระดับความรุนแรง">
            <span className="flex items-center gap-1.5">
              <span className="text-danger">วิกฤต</span>
              {Array.from({ length: 5 }, (_, i) => (
                <span
                  key={i}
                  className="h-2 w-2 rounded-full"
                  style={{
                    background: i < activeCase.severity ? "#ef4444" : "rgba(56,100,150,0.4)",
                    boxShadow: i < activeCase.severity ? "0 0 5px #ef4444" : undefined,
                  }}
                />
              ))}
            </span>
          </Row>
          <div className="flex items-center gap-3 pt-1">
            <span className="w-[74px] shrink-0 text-[11px] text-ink-muted">ความเสี่ยงปัจจุบัน</span>
            <RiskMeter value={activeCase.risk_score} width={80} />
            <span className="num text-[15px] font-semibold text-ink">
              {activeCase.risk_score}
              <span className="text-[11px] text-ink-muted"> / 100</span>
            </span>
            <span className="text-[11px] font-medium text-danger">สูงมาก</span>
          </div>
        </div>
      </div>

      <div className="border-b border-[rgba(37,66,102,0.45)] px-3.5 py-3">
        <h4 className="mb-1.5 text-[12px] font-semibold text-ink">สรุปเหตุการณ์</h4>
        <p className="text-[11.5px] leading-relaxed text-ink-dim">{activeCase.summary}</p>
        <button
          type="button"
          className="mt-1.5 ml-auto flex items-center gap-1 text-[11px] text-azure hover:underline"
        >
          ดูเพิ่มเติม
          <IconChevronRight size={12} stroke={2} />
        </button>
      </div>

      <div className="border-b border-[rgba(37,66,102,0.45)] px-3.5 py-3">
        <h4 className="mb-2 text-[12px] font-semibold text-ink">แผนที่ที่เกี่ยวข้อง</h4>
        <div className="grid grid-cols-6 gap-1">
          {entities.map((e) => (
            <div
              key={e.label}
              className="flex flex-col items-center gap-0.5 rounded border border-[rgba(37,66,102,0.55)] bg-[rgba(12,22,38,0.7)] py-1.5"
              title={e.label}
            >
              <e.icon size={13} stroke={1.7} className="text-ink-dim" />
              <span className="num text-[11px] font-semibold text-ink">{e.n}</span>
            </div>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-6 gap-1 text-center">
          {entities.map((e) => (
            <span key={e.label} className="truncate text-[8.5px] text-ink-muted">
              {e.label}
            </span>
          ))}
        </div>
      </div>

      <div className="px-3.5 py-3">
        <h4 className="mb-2 text-[12px] font-semibold text-ink">เหตุการณ์ล่าสุด</h4>
        <ul className="space-y-2">
          {activeCase.updates.map((u, i) => {
            const tag = UPDATE_TAG[u.tag];
            return (
              <li key={i} className="flex items-start gap-2">
                <IconAlertTriangle size={12} stroke={1.8} className="mt-0.5 shrink-0" color={tag.color} />
                <div className="min-w-0 flex-1">
                  <p className="num text-[10.5px] text-ink-muted">{fmtDate.format(u.at)}</p>
                  <p className="text-[11.5px] leading-snug text-ink-dim">{u.text}</p>
                </div>
                <span
                  className="chip shrink-0"
                  style={{ color: tag.color, borderColor: `${tag.color}88`, background: `${tag.color}1f` }}
                >
                  {tag.label}
                </span>
              </li>
            );
          })}
        </ul>
        <button
          type="button"
          className="mt-2 ml-auto flex items-center gap-1 text-[11px] text-azure hover:underline"
        >
          ดูทั้งหมด
          <IconChevronRight size={12} stroke={2} />
        </button>
      </div>
    </aside>
  );
}
