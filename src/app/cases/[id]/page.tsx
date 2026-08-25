import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  IconArrowLeft,
  IconChevronRight,
  IconExternalLink,
  IconMapPin,
} from "@tabler/icons-react";
import TopNav from "@/components/layout/TopNav";
import CaseLocationMap from "@/components/cases/CaseLocationMap";
import MediaThumb from "@/components/cases/MediaThumb";
import { EVENT_COLOR, VERIFICATION_COLOR } from "@/lib/palette";
import {
  EVENT_TYPE_LABEL,
  GEO_PRECISION_LABEL,
  SEVERITY_LABEL,
  VERIFICATION_LABEL,
} from "@/lib/labels";
import { GEO_PRECISION_RADIUS_M } from "@/lib/types";
import { formatByPrecision, formatThaiDateLong, formatThaiDateTime } from "@/lib/datetime";
import { getCaseDetail, type CaseDetail } from "@/server/cases";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const detail = await getCaseDetail(decodeURIComponent((await params).id));
  if (!detail) return { title: "ไม่พบเคส — Palantir TH" };
  return {
    title: `${detail.event.event.title} — Palantir TH`,
    description: `เคส ${detail.event._id} · อ.${detail.event.location.district} จ.${detail.event.location.province}`,
  };
}

/** Case detail is reachable from more than one list — where "back" means one of. */
const LIST_ORIGINS: { prefix: string; label: string; nav: string }[] = [
  { prefix: "/report", label: "รายงานจากประชาชน", nav: "/report" },
  { prefix: "/cases", label: "ทะเบียนเคส", nav: "/cases" },
];

/**
 * `ref` is the exact list URL the analyst arrived from (e.g. `/report?prov=
 * yala`), so returning to it is a direct link rather than a rebuild. It is
 * validated as a same-origin relative path before use — this value comes from
 * the address bar, so an open redirect (`ref=//evil.example`) must not survive
 * the round trip.
 */
function resolveOrigin(ref: string | undefined) {
  const fallback = LIST_ORIGINS[1];
  if (!ref || !ref.startsWith("/") || ref.startsWith("//")) return fallback;
  return LIST_ORIGINS.find((o) => ref === o.prefix || ref.startsWith(`${o.prefix}?`)) ?? fallback;
}

/** Canonical fields a source may simply not carry, named in Thai. */
const UNREPORTED_LABEL: Record<string, string> = {
  severity: "ระดับความรุนแรง",
  casualties: "จำนวนผู้เสียชีวิต/บาดเจ็บ",
  "casualties.killed": "จำนวนผู้เสียชีวิต",
  "casualties.injured": "จำนวนผู้บาดเจ็บ",
  actors: "ผู้ก่อเหตุ",
  targets: "เป้าหมาย",
  coordinates: "พิกัดจากที่เกิดเหตุจริง",
  subdistrict: "ตำบล",
  place: "จุดสังเกต/สถานที่",
  summary: "รายละเอียดเหตุการณ์",
  media: "หลักฐาน/ไฟล์แนบ",
};

/** `raw_records.processing.status`, in the language the rest of the page uses. */
const PROCESSING_LABEL: Record<string, string> = {
  pending: "ยังไม่ได้แปลงเป็น event candidate",
  normalized: "แปลงเป็น event candidate แล้ว",
};

const TRUST_CLASS_LABEL: Record<string, string> = {
  government: "หน่วยงานรัฐ",
  international: "องค์กรระหว่างประเทศ",
  external_dataset: "ชุดข้อมูลภายนอก",
  local_media: "สื่อท้องถิ่น",
  national_media: "สื่อกระแสหลัก",
  citizen_report: "แหล่งข่าวไม่ทางการ",
  manual_entry: "บันทึกด้วยตนเอง",
};

export default async function CaseDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const detail = await getCaseDetail(decodeURIComponent(id));
  if (!detail) notFound();

  const ref = Array.isArray(sp.ref) ? sp.ref[0] : sp.ref;
  const back = resolveOrigin(ref);
  // The exact URL to return to, only once it is confirmed to belong to the
  // origin `back` resolved to — never the raw, unvalidated `ref` itself. This
  // is also what's handed to the nearby-events panel, so a bad `ref` value
  // never propagates onward even as inert baggage.
  const safeRef = ref && (ref === back.prefix || ref.startsWith(`${back.prefix}?`)) ? ref : undefined;
  const e = detail.event;
  const typeColor = EVENT_COLOR[e.event.type] ?? EVENT_COLOR.other;
  const verificationColor = VERIFICATION_COLOR[e.verification];
  const [lng, lat] = e.location.geo.coordinates;
  const precision = e.location.geo_precision ?? "unknown";
  const precisionM = GEO_PRECISION_RADIUS_M[precision];

  return (
    <div className="flex h-screen min-w-[1180px] flex-col overflow-hidden">
      <TopNav active={back.nav} />

      <main className="min-h-0 flex-1 overflow-auto bg-abyss p-2">
        {/* ---------------------------------------------------------- header */}
        <header className="panel mb-2 px-4 py-3">
          <nav className="mb-2 flex items-center gap-1 text-[11px] text-ink-muted">
            <Link
              href={safeRef ?? back.prefix}
              className="inline-flex items-center gap-1 text-azure hover:underline"
            >
              <IconArrowLeft size={12} stroke={2} />
              {back.label}
            </Link>
            <IconChevronRight size={11} stroke={2} />
            <span className="font-mono">{e._id}</span>
          </nav>

          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-[17px] leading-snug font-semibold text-ink">{e.event.title}</h1>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-ink-dim">
                <IconMapPin size={12} stroke={1.8} className="text-ink-muted" />
                {e.location.subdistrict && <span>ต.{e.location.subdistrict}</span>}
                <span>อ.{e.location.district}</span>
                <span>จ.{e.location.province}</span>
                <span className="text-ink-muted">·</span>
                <span>{formatThaiDateLong(e.time.start)}</span>
              </p>
            </div>

            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
              <span
                className="chip"
                style={{
                  color: verificationColor,
                  borderColor: `${verificationColor}66`,
                  background: `${verificationColor}1f`,
                }}
              >
                {VERIFICATION_LABEL[e.verification]}
              </span>
              <span
                className="chip"
                style={{ color: typeColor, borderColor: `${typeColor}66`, background: `${typeColor}1f` }}
              >
                {EVENT_TYPE_LABEL[e.event.type]}
              </span>
              <span className="chip num border-[rgba(56,100,150,0.6)] text-ink-dim">
                ความเชื่อมั่น {e.confidence}%
              </span>
            </div>
          </div>
        </header>

        {/* ----------------------------------------------------------- body */}
        <div className="grid grid-cols-[minmax(0,1fr)_clamp(300px,26vw,360px)] gap-2">
          <div className="flex min-w-0 flex-col gap-2">
            <Panel title="ข้อเท็จจริงที่แหล่งข้อมูลรายงาน">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-0 px-4 py-1">
                <Fact label="เวลาเกิดเหตุ" value={formatByPrecision(e.time.start, e.time.precision)}>
                  {e.time.precision === "day" &&
                    "แหล่งข้อมูลระบุเป็นระดับวัน ไม่ได้ระบุเวลาในวันนั้น"}
                </Fact>
                <Fact
                  label="ประเภทตามระบบ"
                  value={EVENT_TYPE_LABEL[e.event.type]}
                  accent={typeColor}
                />
                <Fact label="ประเภทตามคำของแหล่งข้อมูล" value={e.event.rawType} />
                <Fact label="ประเภทสถานที่" value={e.location.place} />
                <Fact
                  label="ระดับความรุนแรง"
                  value={e.severity === null ? null : `${e.severity}/5 — ${SEVERITY_LABEL[e.severity]}`}
                />
                <Fact
                  label="ผู้เสียชีวิต"
                  value={e.casualties.killed === null ? null : `${e.casualties.killed} ราย`}
                />
                <Fact
                  label="ผู้บาดเจ็บ"
                  value={e.casualties.injured === null ? null : `${e.casualties.injured} ราย`}
                />
                <Fact
                  label="ผู้ก่อเหตุ"
                  value={e.actors.length ? e.actors.join(", ") : null}
                />
                <Fact
                  label="เป้าหมาย"
                  value={e.targets.length ? e.targets.join(", ") : null}
                />
                <Fact label="รายละเอียด" value={e.event.summary ?? null} />
              </dl>
            </Panel>

            <Panel
              title="ตำแหน่งที่เกิดเหตุ"
              action={
                <span className="text-[10.5px] text-ink-muted">
                  ความละเอียด: {GEO_PRECISION_LABEL[precision]} · คลาดเคลื่อนราว{" "}
                  <span className="num">{(precisionM / 1000).toLocaleString("en-US")}</span> กม.
                </span>
              }
            >
              <div className="h-[300px] w-full">
                <CaseLocationMap lng={lng} lat={lat} precisionM={precisionM} color={typeColor} />
              </div>
              <p className="border-t border-[rgba(37,66,102,0.45)] px-4 py-2 text-[10.5px] leading-relaxed text-ink-muted">
                พิกัด <span className="num text-ink-dim">{lat.toFixed(6)}, {lng.toFixed(6)}</span> —{" "}
                {precision === "gps"
                  ? "เป็นพิกัดที่แหล่งข้อมูลรายงานมาโดยตรง"
                  : `ไม่ใช่พิกัดจุดเกิดเหตุจริง แต่เป็นจุดอ้างอิงระดับ${GEO_PRECISION_LABEL[precision]} วงกลมบนแผนที่คือขอบเขตความคลาดเคลื่อนที่ควรอ่านค่านี้`}
              </p>
            </Panel>

            {e.media.length > 0 && (
              <Panel title={`หลักฐานที่แนบมากับรายงาน (${e.media.length})`}>
                <div className="grid grid-cols-4 gap-2 p-3">
                  {e.media.map((m) => (
                    <MediaThumb key={`${m.field}-${m.url}`} item={m} />
                  ))}
                </div>
              </Panel>
            )}

            {Object.keys(e.attributes).length > 0 && (
              <Panel
                title="ข้อมูลเพิ่มเติมจากแหล่งข้อมูล"
                action={
                  <span className="text-[10.5px] text-ink-muted">
                    ฟิลด์ที่ schema กลางไม่มีที่เก็บ แต่เก็บไว้ตามคำของแหล่งข้อมูล
                  </span>
                }
              >
                <KeyValueTable
                  rows={Object.entries(e.attributes).map(([key, value]) => ({
                    key,
                    value: value === null ? "" : String(value),
                  }))}
                />
              </Panel>
            )}

            <RawRecordPanel raw={detail.raw} />
          </div>

          {/* ------------------------------------------------------- sidebar */}
          <div className="flex flex-col gap-2">
            <ProvenancePanel detail={detail} />
            <UnreportedPanel unreported={e.unreported} />
            <NearbyPanel detail={detail} listRef={safeRef} />
          </div>
        </div>
      </main>
    </div>
  );
}

// ------------------------------------------------------------------ building blocks

function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="panel">
      <header className="flex items-center justify-between gap-3 border-b border-[rgba(37,66,102,0.45)] px-4 py-2.5">
        <h2 className="panel-title">{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

/**
 * One reported fact.
 *
 * `null` renders as an explicit "แหล่งข้อมูลไม่ได้รายงาน" rather than an empty
 * cell or a zero. An empty cell reads as an oversight and a zero is a claim —
 * neither is what a missing field means.
 */
function Fact({
  label,
  value,
  accent,
  children,
}: {
  label: string;
  value: string | null;
  accent?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="border-b border-[rgba(37,66,102,0.25)] py-2 last:border-0">
      <dt className="text-[10.5px] text-ink-muted">{label}</dt>
      <dd
        className={value === null ? "text-[12px] text-ink-muted italic" : "text-[12.5px] text-ink"}
        style={accent && value !== null ? { color: accent } : undefined}
      >
        {value ?? "แหล่งข้อมูลไม่ได้รายงาน"}
      </dd>
      {children && <p className="mt-0.5 text-[10px] text-ink-muted">{children}</p>}
    </div>
  );
}

function KeyValueTable({ rows }: { rows: { key: string; value: string; note?: string }[] }) {
  return (
    <table className="w-full border-separate border-spacing-0">
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className="border-t border-[rgba(37,66,102,0.3)]">
            <th
              scope="row"
              className="w-[210px] px-4 py-1.5 text-left align-top font-mono text-[11px] font-normal break-all text-ink-muted"
            >
              {r.key}
            </th>
            <td className="px-4 py-1.5 align-top text-[11.5px] break-words text-ink-dim">
              {r.value === "" ? (
                <span className="text-ink-muted italic">ว่าง</span>
              ) : (
                r.value
              )}
              {r.note && <span className="ml-2 text-[10px] text-ink-muted">{r.note}</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * The archived payload, exactly as the source sent it.
 *
 * This is the bottom of the ladder in MVP.md: every field above is a reading of
 * what is shown here, so having it on the same screen is what lets an analyst
 * check the reading rather than take it on trust.
 */
function RawRecordPanel({ raw }: { raw: CaseDetail["raw"] }) {
  if (!raw) {
    return (
      <Panel title="ข้อมูลดิบจากแหล่งข้อมูล">
        <p className="px-4 py-3 text-[11.5px] text-ink-muted">
          ไม่พบ raw record ที่ผูกกับเคสนี้ — เป็นไปได้ว่าข้อมูลถูก seed ไว้คนละรอบกับ
          <code className="mx-1 font-mono">raw_records</code>
        </p>
      </Panel>
    );
  }

  return (
    <Panel
      title="ข้อมูลดิบจากแหล่งข้อมูล"
      action={
        <span className="font-mono text-[10px] text-ink-muted">{raw.id}</span>
      }
    >
      {raw.fields.length > 0 && (
        <KeyValueTable
          rows={raw.fields.map((f) => ({
            key: f.key,
            value: f.value,
            note: f.truncatedFrom
              ? `ตัดแสดง จากทั้งหมด ${f.truncatedFrom.toLocaleString("en-US")} อักขระ`
              : undefined,
          }))}
        />
      )}

      {raw.body && (
        <div className="border-t border-[rgba(37,66,102,0.3)] p-3">
          <p className="mb-1.5 text-[10.5px] text-ink-muted">
            payload เป็นเนื้อหาดิบ ไม่ใช่ JSON object — แสดง{" "}
            <span className="num">{raw.body.preview.length.toLocaleString("en-US")}</span> อักขระแรก
            จากทั้งหมด <span className="num">{raw.body.length.toLocaleString("en-US")}</span>
          </p>
          <pre className="max-h-[220px] overflow-auto rounded border border-[rgba(37,66,102,0.5)] bg-[#060d19] p-2.5 font-mono text-[10.5px] leading-relaxed break-words whitespace-pre-wrap text-ink-dim">
            {raw.body.preview}
          </pre>
        </div>
      )}

      {raw.fields.length === 0 && !raw.body && (
        <p className="px-4 py-3 text-[11.5px] text-ink-muted">raw record นี้ไม่มี payload</p>
      )}
    </Panel>
  );
}

function ProvenancePanel({ detail }: { detail: CaseDetail }) {
  const { source, raw, run, event } = detail;

  return (
    <Panel title="ที่มาของข้อมูล">
      <dl className="px-4 py-1">
        <Fact label="แหล่งข้อมูล" value={source ? `${source.name} (${source.shortName})` : event.source_id} />
        <Fact
          label="ประเภทแหล่งข้อมูล"
          value={source ? (TRUST_CLASS_LABEL[source.trust.class] ?? source.trust.class) : null}
        />
        <Fact
          label="คะแนนความน่าเชื่อถือของแหล่ง"
          value={source ? `${source.trust.score}/100` : null}
        />
        <Fact
          label="แหล่งที่รายงานตรงกัน"
          value={
            detail.corroborating.length
              ? detail.corroborating.map((s) => s.shortName).join(", ")
              : null
          }
        >
          {detail.corroborating.length <= 1 &&
            "มีแหล่งเดียวที่รายงานเหตุนี้ ยังไม่ผ่านการยืนยันข้ามแหล่ง"}
        </Fact>
        <Fact label="ดึงข้อมูลเมื่อ" value={raw ? formatThaiDateTime(raw.retrievedAt) : null} />
        <Fact
          label="สถานะการประมวลผล"
          value={raw ? (PROCESSING_LABEL[raw.processing] ?? raw.processing) : null}
        />
        <Fact label="รอบการดึงข้อมูล" value={run?._id ?? null} />
      </dl>

      {raw && (
        <div className="space-y-1.5 border-t border-[rgba(37,66,102,0.45)] px-4 py-2.5">
          <a
            href={raw.url || raw.externalId}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-[11.5px] text-azure hover:underline"
          >
            เปิดหน้าต้นทาง
            <IconExternalLink size={12} stroke={1.8} />
          </a>
          <p
            className="font-mono text-[9.5px] break-all text-ink-muted"
            title="content hash ของ payload — ใช้ตรวจว่าข้อมูลดิบไม่ถูกแก้ย้อนหลัง"
          >
            {raw.contentHash}
          </p>
        </div>
      )}
    </Panel>
  );
}

/**
 * What this source does not carry.
 *
 * The register's most common failure mode would be reading a blank as a zero:
 * ศอ.บต. Open Data has no casualty or severity columns at all, so 10,037 of the
 * 10,041 records here are silent on both. Naming that silence is the point.
 */
function UnreportedPanel({ unreported }: { unreported: string[] }) {
  if (!unreported.length) return null;

  return (
    <Panel title="ข้อมูลที่แหล่งข้อมูลไม่ได้รายงาน">
      <ul className="px-4 py-2.5">
        {unreported.map((field) => (
          <li key={field} className="flex items-baseline gap-2 py-[3px] text-[11.5px] text-ink-dim">
            <span className="text-ink-muted">–</span>
            {UNREPORTED_LABEL[field] ?? field}
          </li>
        ))}
      </ul>
      <p className="border-t border-[rgba(37,66,102,0.45)] px-4 py-2 text-[10.5px] leading-relaxed text-ink-muted">
        ฟิลด์เหล่านี้ว่างเพราะแหล่งข้อมูลไม่มีข้อมูลให้ ไม่ใช่เพราะค่าเป็นศูนย์
      </p>
    </Panel>
  );
}

function NearbyPanel({ detail, listRef }: { detail: CaseDetail; listRef: string | undefined }) {
  // Carry the list state on, so hopping between related cases does not quietly
  // lose the filtered table the analyst came in from.
  const suffix = listRef ? `?ref=${encodeURIComponent(listRef)}` : "";

  return (
    <Panel
      title="เหตุการณ์ใกล้เคียง"
      action={<span className="text-[10.5px] text-ink-muted">อำเภอเดียวกัน ±30 วัน</span>}
    >
      {detail.nearby.length === 0 ? (
        <p className="px-4 py-3 text-[11.5px] text-ink-muted">
          ไม่มีเหตุการณ์อื่นในอำเภอเดียวกันภายในช่วง 30 วัน
        </p>
      ) : (
        <ul>
          {detail.nearby.map((n) => (
            <li key={n.id} className="border-t border-[rgba(37,66,102,0.3)] first:border-0">
              <Link
                href={`/cases/${encodeURIComponent(n.id)}${suffix}`}
                className="block px-4 py-2 hover:bg-[rgba(56,189,248,0.06)]"
              >
                <span className="block truncate text-[11.5px] text-ink" title={n.title}>
                  {n.title}
                </span>
                <span className="num block text-[10.5px] text-ink-muted">
                  {formatByPrecision(n.at, n.timePrecision)} · {n.verificationLabel}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
