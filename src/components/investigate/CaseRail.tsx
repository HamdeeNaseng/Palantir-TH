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
import Link from "next/link";
import { RiskMeter } from "@/components/charts/Gauges";
import {
  CASE_STATUS_COLOR,
  CASE_STATUS_LABEL,
  EVENT_TYPE_LABEL,
  GEO_PRECISION_LABEL,
  SEVERITY_COLOR,
  SEVERITY_LABEL,
  VERIFICATION_LABEL,
  riskBand,
} from "@/lib/labels";
import { VERIFICATION_COLOR } from "@/lib/palette";
import type { SnapshotCase } from "@/lib/snapshot";
import type { SeverityLevel } from "@/lib/types";
import type { EventFeature } from "@/server/shared-events";

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

const FMT_DATE = new Intl.DateTimeFormat("th-TH", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  calendar: "buddhist",
});

/**
 * The event the analyst just clicked on the map.
 *
 * Deliberately *not* squeezed into `SnapshotCase` first. That shape carries a
 * risk score, an entity census and an update log, none of which an event
 * candidate has — filling them with zeroes would put a "0/100 ความเสี่ยง"
 * gauge and an empty timeline in the rail and make the map look like it had
 * answered a question nobody asked. This renders what the record actually
 * holds, and every uncertain field says so rather than defaulting: an
 * unreported death toll reads ไม่ระบุ, not 0.
 */
function SelectedEvent({ feature }: { feature: EventFeature }) {
  const p = feature.properties;
  const [lng, lat] = feature.geometry.coordinates;
  const verifyColor = VERIFICATION_COLOR[p.verification];

  const counts = [
    { label: "แหล่งข้อมูล", n: p.sources_count },
    { label: "สื่อ/ภาพ", n: p.media_count },
    { label: "ผู้เกี่ยวข้อง", n: p.actors_count },
    { label: "เป้าหมาย", n: p.targets_count },
  ];

  return (
    <aside className="panel flex h-full max-h-[70vh] min-h-0 w-full flex-col overflow-y-auto bg-[#070e1b] lg:max-h-none">
      <header className="flex items-center justify-between border-b border-[rgba(37,66,102,0.55)] px-3.5 py-2.5">
        <h2 className="text-[13px] font-semibold text-ink">เหตุการณ์ที่เลือก</h2>
        <Link
          href={`/cases/${encodeURIComponent(p.id)}`}
          prefetch={false}
          className="flex items-center gap-1 rounded border border-[rgba(56,100,150,0.5)] px-1.5 py-0.5 text-[10.5px] text-ink-muted hover:text-ink"
        >
          เปิดหน้าเคส
          <IconChevronRight size={11} stroke={2} />
        </Link>
      </header>

      <div className="border-b border-[rgba(37,66,102,0.45)] px-3.5 py-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 text-[13px] leading-snug font-semibold text-ink">{p.title}</h3>
          <span
            className="chip shrink-0"
            style={{
              color: verifyColor,
              borderColor: `${verifyColor}99`,
              background: `${verifyColor}26`,
            }}
          >
            {VERIFICATION_LABEL[p.verification]}
          </span>
        </div>

        <div className="mt-2.5">
          <Row label="วันที่เกิดเหตุ">{FMT_DATE.format(new Date(p.ts))} น.</Row>
          <Row label="สถานที่">
            อ.{p.district} จ.{p.province}
          </Row>
          <Row label="ประเภทเหตุ">
            <span style={{ color: p.color }}>{EVENT_TYPE_LABEL[p.type]}</span>
          </Row>
          <Row label="ระดับความรุนแรง">
            {p.severity_known ? (
              <span className="flex items-center gap-1.5">
                <span style={{ color: SEVERITY_COLOR[p.severity as SeverityLevel] }}>
                  {SEVERITY_LABEL[p.severity as SeverityLevel]}
                </span>
                {Array.from({ length: 5 }, (_, i) => (
                  <span
                    key={i}
                    className="h-2 w-2 rounded-full"
                    style={{
                      background:
                        i < p.severity
                          ? SEVERITY_COLOR[p.severity as SeverityLevel]
                          : "rgba(56,100,150,0.4)",
                    }}
                  />
                ))}
              </span>
            ) : (
              <span className="text-ink-muted">ไม่ระบุ</span>
            )}
          </Row>
          <Row label="ความเชื่อมั่น">
            <span className="num">{p.confidence}%</span>
          </Row>
          <Row label="ผู้เสียชีวิต">
            {p.killed_known ? (
              <span className="num">{p.killed}</span>
            ) : (
              <span className="text-ink-muted">ไม่ระบุ</span>
            )}
          </Row>
          <Row label="ผู้บาดเจ็บ">
            {p.injured_known ? (
              <span className="num">{p.injured}</span>
            ) : (
              <span className="text-ink-muted">ไม่ระบุ</span>
            )}
          </Row>
        </div>
      </div>

      {/*
        The reason the rail can be trusted at all. At `district` precision the
        coordinate is a centroid with 8 km of error, so the point on the map is
        the อำเภอ rather than the incident — stated here beside the coordinate
        instead of left for the reader to infer from a dot that looks exact.
      */}
      <div className="border-b border-[rgba(37,66,102,0.45)] px-3.5 py-3">
        <h4 className="mb-1.5 text-[12px] font-semibold text-ink">ความละเอียดพิกัด</h4>
        <Row label="ระดับ">{GEO_PRECISION_LABEL[p.precision] ?? p.precision}</Row>
        <Row label="คลาดเคลื่อน">
          <span className="num">±{(p.precision_m / 1000).toFixed(p.precision_m < 1000 ? 2 : 1)} กม.</span>
        </Row>
        <Row label="พิกัด">
          <span className="num text-[10.5px]">
            {lat.toFixed(5)}, {lng.toFixed(5)}
          </span>
        </Row>
      </div>

      <div className="px-3.5 py-3">
        <h4 className="mb-2 text-[12px] font-semibold text-ink">หลักฐานที่แนบมา</h4>
        <div className="grid grid-cols-4 gap-1">
          {counts.map((c) => (
            <div
              key={c.label}
              className="flex flex-col items-center gap-0.5 rounded border border-[rgba(37,66,102,0.55)] bg-[rgba(12,22,38,0.7)] py-1.5"
              title={c.label}
            >
              <span className="num text-[13px] font-semibold text-ink">{c.n}</span>
            </div>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-4 gap-1 text-center">
          {counts.map((c) => (
            <span key={c.label} className="truncate text-[8.5px] text-ink-muted">
              {c.label}
            </span>
          ))}
        </div>
      </div>
    </aside>
  );
}

/**
 * Right-hand rail: whatever the analyst is looking at.
 *
 * A clicked hotspot wins over the tracked case, because the click is the more
 * recent statement of intent — and because on this corpus `cases` is empty, so
 * without it the rail sat on "ไม่มีเคสที่กำลังติดตาม" no matter what the
 * analyst did on the map.
 */
export default function CaseRail({
  activeCase,
  selectedEvent,
}: {
  activeCase: SnapshotCase | null;
  selectedEvent?: EventFeature | null;
}) {
  const fmtDate = FMT_DATE;

  if (selectedEvent) return <SelectedEvent feature={selectedEvent} />;

  if (!activeCase) {
    return (
      <aside className="panel flex h-full min-h-0 w-full flex-col items-center justify-center gap-1 bg-[#070e1b] px-4 text-center">
        <span className="text-[12px] text-ink-muted">ไม่มีเคสที่กำลังติดตาม</span>
        {/* Says what to do about it. The empty state used to be a dead end,
            which read as a broken panel rather than an idle one. */}
        <span className="text-[10.5px] text-ink-muted/70">
          คลิกจุดเหตุการณ์บนแผนที่เพื่อดูรายละเอียด
        </span>
      </aside>
    );
  }

  // Every one of these used to be a literal in the markup — the chip always
  // read "กำลังสืบสวน", the severity always "วิกฤต", the risk always "สูงมาก",
  // whatever the case document actually said.
  const statusColor = CASE_STATUS_COLOR[activeCase.status];
  const risk = riskBand(activeCase.riskScore);

  const entities = [
    { icon: IconUser, label: "บุคคล", n: activeCase.entities.people },
    { icon: IconUsers, label: "กลุ่ม", n: activeCase.entities.groups },
    { icon: IconCar, label: "ยานพาหนะ", n: activeCase.entities.vehicles },
    { icon: IconDeviceMobile, label: "โทรศัพท์", n: activeCase.entities.phones },
    { icon: IconMapPin, label: "สถานที่", n: activeCase.entities.places },
    { icon: IconClipboardList, label: "หลักฐาน", n: activeCase.entities.evidence },
  ];

  return (
    <aside className="panel flex h-full max-h-[70vh] min-h-0 w-full flex-col overflow-y-auto bg-[#070e1b] lg:max-h-none">
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
          <span
            className="chip shrink-0"
            style={{
              color: statusColor,
              borderColor: `${statusColor}99`,
              background: `${statusColor}26`,
            }}
          >
            {CASE_STATUS_LABEL[activeCase.status]}
          </span>
        </div>

        <div className="mt-2.5">
          <Row label="วันที่เกิดเหตุ">{fmtDate.format(new Date(activeCase.occurredAtMs))} น.</Row>
          <Row label="สถานที่">{activeCase.location}</Row>
          <Row label="ประเภทเหตุ">{activeCase.eventType}</Row>
          <Row label="ระดับความรุนแรง">
            <span className="flex items-center gap-1.5">
              <span style={{ color: SEVERITY_COLOR[activeCase.severity] }}>
                {SEVERITY_LABEL[activeCase.severity]}
              </span>
              {Array.from({ length: 5 }, (_, i) => (
                <span
                  key={i}
                  className="h-2 w-2 rounded-full"
                  style={{
                    background:
                      i < activeCase.severity
                        ? SEVERITY_COLOR[activeCase.severity]
                        : "rgba(56,100,150,0.4)",
                    boxShadow:
                      i < activeCase.severity
                        ? `0 0 5px ${SEVERITY_COLOR[activeCase.severity]}`
                        : undefined,
                  }}
                />
              ))}
            </span>
          </Row>
          <div className="flex items-center gap-3 pt-1">
            <span className="w-[74px] shrink-0 text-[11px] text-ink-muted">ความเสี่ยงปัจจุบัน</span>
            <RiskMeter value={activeCase.riskScore} width={80} />
            <span className="num text-[15px] font-semibold text-ink">
              {activeCase.riskScore}
              <span className="text-[11px] text-ink-muted"> / 100</span>
            </span>
            <span className="text-[11px] font-medium" style={{ color: risk.color }}>
              {risk.label}
            </span>
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
                  <p className="num text-[10.5px] text-ink-muted">{fmtDate.format(new Date(u.atMs))}</p>
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
