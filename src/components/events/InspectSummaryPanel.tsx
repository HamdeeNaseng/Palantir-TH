import Link from "next/link";
import { IconChevronRight, IconExternalLink } from "@tabler/icons-react";
import { EVENT_TYPE_LABEL, SEVERITY_LABEL, VERIFICATION_LABEL } from "@/lib/labels";
import { EVENT_COLOR, VERIFICATION_COLOR } from "@/lib/palette";
import { formatThaiDate } from "@/lib/datetime";
import type { EventFeature } from "@/server/shared-events";

/**
 * "Inspect Summary" — detail for whichever event is hovered/selected on the
 * map, falling back to the most-recently-played one. The mockup's entities
 * grid (people/groups/vehicles/phones) is replaced with fields that actually
 * exist on a real event: corroborating sources, attached media, and
 * actor/target counts when the source reported any — `event_candidates` has
 * no people/vehicle/phone entity extraction at all.
 */
function Fact({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="border-b border-[rgba(37,66,102,0.25)] py-1.5 last:border-0">
      <dt className="text-[10px] text-ink-muted">{label}</dt>
      <dd className={value === null ? "text-[11.5px] text-ink-muted italic" : "text-[12px] text-ink"}>
        {value ?? "แหล่งข้อมูลไม่ได้รายงาน"}
      </dd>
    </div>
  );
}

function CountTile({ label, count, noneLabel }: { label: string; count: number; noneLabel: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 rounded border border-[rgba(37,66,102,0.55)] bg-[rgba(12,22,38,0.7)] py-1.5">
      <span className="num text-[13px] font-semibold text-ink">{count > 0 ? count : "–"}</span>
      <span className="text-center text-[8.5px] leading-tight text-ink-muted" title={count === 0 ? noneLabel : label}>
        {label}
      </span>
    </div>
  );
}

export default function InspectSummaryPanel({ feature }: { feature: EventFeature | null }) {
  if (!feature) {
    return (
      <aside className="panel flex h-full min-h-0 w-full items-center justify-center bg-[#070e1b] text-[12px] text-ink-muted">
        ยังไม่มีเหตุการณ์ในช่วงที่เล่น
      </aside>
    );
  }

  const p = feature.properties;
  const typeColor = EVENT_COLOR[p.type] ?? EVENT_COLOR.other;
  const verificationColor = VERIFICATION_COLOR[p.verification];

  return (
    <aside className="panel flex h-full min-h-0 w-full flex-col overflow-y-auto bg-[#070e1b]">
      <header className="flex items-center justify-between border-b border-[rgba(37,66,102,0.55)] px-3.5 py-2.5">
        <h2 className="text-[13px] font-semibold text-ink">Inspect Summary</h2>
        <Link
          href={`/cases/${encodeURIComponent(p.id)}`}
          target="_blank"
          className="flex items-center gap-1 text-[10.5px] text-azure hover:underline"
        >
          เปิดรายละเอียด
          <IconExternalLink size={11} stroke={1.8} />
        </Link>
      </header>

      <div className="border-b border-[rgba(37,66,102,0.45)] px-3.5 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="line-clamp-2 text-[12.5px] leading-snug font-semibold text-ink">{p.title}</h3>
            <p className="num mt-0.5 truncate text-[10.5px] text-ink-muted">{p.id}</p>
          </div>
          <span
            className="chip shrink-0"
            style={{ color: verificationColor, borderColor: `${verificationColor}66`, background: `${verificationColor}1f` }}
          >
            {VERIFICATION_LABEL[p.verification]}
          </span>
        </div>

        <dl className="mt-2">
          <Fact label="วันที่เกิดเหตุ" value={formatThaiDate(new Date(p.ts))} />
          <Fact label="สถานที่" value={`อ.${p.district} จ.${p.province}`} />
          <Fact
            label="ประเภทเหตุ"
            value={EVENT_TYPE_LABEL[p.type] ?? p.type}
          />
          <Fact
            label="ระดับความรุนแรง"
            value={p.severity_known ? `${p.severity}/5 — ${SEVERITY_LABEL[p.severity]}` : null}
          />
          <Fact label="ความเชื่อมั่น" value={`${p.confidence}%`} />
          <Fact label="ผู้เสียชีวิต" value={p.killed_known ? `${p.killed} ราย` : null} />
          <Fact label="ผู้บาดเจ็บ" value={p.injured_known ? `${p.injured} ราย` : null} />
        </dl>
        <p
          className="mt-1 flex items-center gap-1.5 text-[10.5px]"
          style={{ color: typeColor }}
        >
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: typeColor }} />
          {EVENT_TYPE_LABEL[p.type] ?? p.type}
        </p>
      </div>

      <div className="border-b border-[rgba(37,66,102,0.45)] px-3.5 py-3">
        <h4 className="mb-2 text-[12px] font-semibold text-ink">ข้อมูลที่เกี่ยวข้อง</h4>
        <div className="grid grid-cols-4 gap-1">
          <CountTile label="แหล่งข้อมูลยืนยัน" count={p.sources_count} noneLabel="ไม่มีแหล่งข้อมูลยืนยัน" />
          <CountTile label="หลักฐานแนบ" count={p.media_count} noneLabel="ไม่มีหลักฐานแนบ" />
          <CountTile label="ผู้ก่อเหตุที่ระบุ" count={p.actors_count} noneLabel="ไม่มีข้อมูลผู้ก่อเหตุ" />
          <CountTile label="เป้าหมายที่ระบุ" count={p.targets_count} noneLabel="ไม่มีข้อมูลเป้าหมาย" />
        </div>
      </div>

      <div className="px-3.5 py-3">
        <p className="text-[11px] leading-relaxed text-ink-muted italic">
          แหล่งข้อมูลไม่ได้ให้รายละเอียดเพิ่มเติมนอกเหนือจากหัวข้อด้านบน
        </p>
        <Link
          href={`/cases/${encodeURIComponent(p.id)}`}
          target="_blank"
          className="mt-2 flex items-center gap-1 text-[11px] text-azure hover:underline"
        >
          ดูข้อมูลดิบและที่มาทั้งหมด
          <IconChevronRight size={12} stroke={2} />
        </Link>
      </div>
    </aside>
  );
}
