import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { IconArrowLeft, IconExternalLink, IconMapPin } from "@tabler/icons-react";
import TopNav from "@/components/layout/TopNav";
import FacilityDetail from "@/components/network/FacilityDetail";
import FacilityEditPanel from "@/components/network/FacilityEditPanel";
import {
  EMERGENCY_LINE,
  FACILITY_COLOR,
  FACILITY_ICON,
  FACILITY_LABEL,
  FACILITY_STATUS_COLOR,
  FACILITY_STATUS_LABEL,
  facilityName,
  scheduledOpen,
  thaiDate,
  yearsOfService,
} from "@/lib/facilities";
import { getFacility } from "@/server/facilities";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const facility = await getFacility(decodeURIComponent((await params).id));
  if (!facility) return { title: "ไม่พบสถานที่ — Palantir TH" };
  return {
    title: `${facilityName(facility)} — Palantir TH`,
    description: `${FACILITY_LABEL[facility.kind]} · อ.${facility.district} จ.${facility.province}`,
  };
}

/**
 * One facility, in full.
 *
 * The rail on `/network` is for working the list — glance, call, mark. This
 * page is for the record itself: everything the sources say, the position on
 * its own map, the whole coordination history, and the form that corrects any
 * of it. Same data, same overlay (`getFacility` is `getNetwork` narrowed), so
 * the two views can never disagree about what a facility is.
 *
 * The map lives inside `FacilityEditPanel` rather than beside it. One map, not
 * two: the same canvas that shows where the facility is, is the one an analyst
 * drags to correct it, so the position being looked at and the position being
 * edited can never be two different things on screen.
 */
export default async function FacilityPage({ params }: Props) {
  const facility = await getFacility(decodeURIComponent((await params).id));
  if (!facility) notFound();

  const Icon = FACILITY_ICON[facility.kind];
  const color = FACILITY_COLOR[facility.kind];
  const line = EMERGENCY_LINE[facility.kind];
  const onSchedule = scheduledOpen(facility.openingHours, Date.now());
  const years = yearsOfService(facility, Date.now());

  return (
    <div className="flex min-h-dvh flex-col lg:h-screen lg:overflow-hidden">
      <TopNav active="/network" />

      <main className="min-h-0 flex-1 bg-abyss p-2 lg:overflow-auto">
        <div className="mx-auto flex max-w-[1180px] flex-col gap-2">
          <nav className="flex items-center gap-1.5 px-1 text-[11.5px] text-ink-muted">
            <Link
              href="/network"
              className="inline-flex items-center gap-1.5 text-azure hover:underline"
            >
              <IconArrowLeft size={14} stroke={1.9} />
              เครือข่ายตอบสนอง
            </Link>
            <span aria-hidden>·</span>
            <span className="truncate">{facilityName(facility)}</span>
          </nav>

          <section className="panel px-4 py-3.5">
            <div className="flex flex-wrap items-start gap-3">
              <span
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
                style={{ background: `${color}22`, color }}
              >
                <Icon size={22} strokeWidth={1.7} />
              </span>
              <div className="min-w-0 flex-1">
                <h1 className="text-[17px] leading-snug font-semibold text-ink">
                  {facilityName(facility)}
                </h1>
                <p className="mt-0.5 text-[12.5px] text-ink-dim">
                  {FACILITY_LABEL[facility.kind]}
                  {facility.nameEn ? ` · ${facility.nameEn}` : ""}
                  {facility.operator ? ` · ${facility.operator}` : ""}
                </p>
                <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-ink-muted">
                  <span className="inline-flex items-center gap-1.5">
                    <IconMapPin size={13} stroke={1.8} />
                    {facility.subdistrict ? `ต.${facility.subdistrict} · ` : ""}อ.
                    {facility.district} จ.{facility.province}
                  </span>
                  <span className="num">
                    {facility.lat.toFixed(5)}, {facility.lng.toFixed(5)}
                  </span>
                </p>
              </div>
              <span
                className="chip shrink-0"
                style={{
                  color: FACILITY_STATUS_COLOR[facility.status],
                  borderColor: `${FACILITY_STATUS_COLOR[facility.status]}66`,
                  background: `${FACILITY_STATUS_COLOR[facility.status]}1a`,
                }}
              >
                {FACILITY_STATUS_LABEL[facility.status]}
              </span>
            </div>
          </section>

          <div className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1fr)_clamp(320px,30vw,380px)]">
            <div className="flex flex-col gap-2">
              <FacilityEditPanel facility={facility} />

              <dl className="panel grid grid-cols-1 divide-y divide-[rgba(37,66,102,0.45)] sm:grid-cols-2 sm:divide-y-0">
                <Row label="สายด่วนตามประเภท">
                  <a href={`tel:${line.number}`} className="num text-azure hover:underline">
                    {line.number}
                  </a>
                  <span className="ml-1.5 text-[11px] text-ink-muted">{line.label}</span>
                </Row>
                <Row label="เบอร์ตรงของหน่วย">
                  {facility.phone ? (
                    <a
                      href={`tel:${facility.phone.replace(/[^+0-9]/g, "")}`}
                      className="num text-azure hover:underline"
                    >
                      {facility.phone}
                    </a>
                  ) : (
                    <span className="text-ink-muted">ไม่มีข้อมูล</span>
                  )}
                </Row>
                <Row label="เวลาทำการที่ประกาศ">
                  {facility.openingHours ? (
                    <>
                      <span className="text-ink">{facility.openingHours}</span>
                      <span className="ml-1.5 text-[11px] text-ink-muted">
                        {onSchedule === null
                          ? "(อ่านตารางไม่ได้)"
                          : onSchedule
                            ? "(ตอนนี้อยู่ในเวลาทำการ)"
                            : "(ตอนนี้นอกเวลาทำการ)"}
                      </span>
                    </>
                  ) : (
                    <span className="text-ink-muted">ไม่ระบุ</span>
                  )}
                </Row>
                <Row label="วันที่เริ่มทำการ/ก่อตั้ง">
                  {facility.openedOn ? (
                    <>
                      <span className="text-ink">{thaiDate(facility.openedOn)}</span>
                      {years !== null && (
                        <span className="ml-1.5 text-[11px] text-ink-muted">
                          (<span className="num">{years}</span> ปี
                          {facility.closedOn ? "จนถึงวันยกเลิก" : "จนถึงปัจจุบัน"})
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-ink-muted">ไม่ทราบ</span>
                  )}
                </Row>
                <Row label="วันที่สิ้นสุดทำการ/ยกเลิก">
                  {facility.closedOn ? (
                    <span className="text-amber">{thaiDate(facility.closedOn)}</span>
                  ) : (
                    <span className="text-ink-muted">ยังไม่ได้บันทึกว่ายกเลิก</span>
                  )}
                </Row>
                <Row label="ที่มาของข้อมูล">
                  {facility.source === "osm" ? (
                    <a
                      href={osmUrl(facility.id)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-azure hover:underline"
                    >
                      OpenStreetMap
                      <IconExternalLink size={12} stroke={1.9} />
                    </a>
                  ) : (
                    <span className="text-ink">เพิ่มโดยเจ้าหน้าที่</span>
                  )}
                  {facility.editedAtMs && (
                    <span className="ml-1.5 text-[11px] text-amber">
                      · แก้ไขแล้ว{facility.editedBy ? ` โดย ${facility.editedBy}` : ""}
                    </span>
                  )}
                </Row>
              </dl>
            </div>

            {/* The same status control and coordination log the list rail uses
                — one component, so the two places can never drift. */}
            <FacilityDetail facility={facility} />
          </div>
        </div>
      </main>
    </div>
  );
}

/** `osm_node_123` back to the object it came from, for anyone checking the source. */
function osmUrl(id: string): string {
  const match = /^osm_(node|way|relation)_(\d+)$/.exec(id);
  return match
    ? `https://www.openstreetmap.org/${match[1]}/${match[2]}`
    : "https://www.openstreetmap.org/copyright";
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-2.5">
      <dt className="text-[10.5px] text-ink-muted">{label}</dt>
      <dd className="mt-0.5 text-[12.5px] text-ink-dim">{children}</dd>
    </div>
  );
}
