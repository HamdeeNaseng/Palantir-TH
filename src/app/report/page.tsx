import Link from "next/link";
import type { Metadata } from "next";
import { IconMessageOff, IconSearchOff } from "@tabler/icons-react";
import TopNav from "@/components/layout/TopNav";
import CaseFilterSidebar from "@/components/cases/CaseFilterSidebar";
import CaseSearchBar from "@/components/cases/CaseSearchBar";
import ActiveCaseFilters from "@/components/cases/ActiveCaseFilters";
import CaseTable from "@/components/cases/CaseTable";
import CasePagination from "@/components/cases/CasePagination";
import ReportIntakeSection from "@/components/report/ReportIntakeSection";
import ReportMapPanel from "@/components/report/ReportMapPanel";
import { hasActiveCaseFilters, parseCaseFilters, serializeCaseFilters } from "@/lib/case-filters";
import { districtsOfProvince } from "@/lib/geography";
import { PROVINCES } from "@/lib/geo";
import { listCitizenReports, listCitizenReportPoints } from "@/server/reports";
import type { DistrictOption } from "@/lib/report-form";
import type { ProvinceCode } from "@/lib/types";

export const dynamic = "force-dynamic";

const BASE_PATH = "/report";

export const metadata: Metadata = {
  title: "รายงานจากประชาชน — Palantir TH",
  description: "แจ้งเหตุการณ์และดูรายงานที่ประชาชนส่งเข้ามา ค้นหาและกรองตามพื้นที่และช่วงเวลา",
};

export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = parseCaseFilters(await searchParams);
  // One round trip, two readings of the same filter set: the table pages
  // through 50 rows, the map has to carry every match or it misreports the
  // distribution. Run together so the map is not a second waterfall.
  const [data, mapPoints] = await Promise.all([
    listCitizenReports(filters),
    listCitizenReportPoints(filters),
  ]);

  const districtsByProvince = Object.fromEntries(
    PROVINCES.map((p) => [
      p.code,
      districtsOfProvince(p.ddpmCode).map((d): DistrictOption => ({ code: d.code, name: d.nameTh })),
    ]),
  ) as Record<ProvinceCode, DistrictOption[]>;

  const listQuery = serializeCaseFilters(filters);
  const listPath = listQuery ? `${BASE_PATH}?${listQuery}` : BASE_PATH;
  const backRef = `?ref=${encodeURIComponent(listPath)}`;

  return (
    // Phone-first below `lg`, because this is the one page a citizen is
    // expected to reach from a phone: the fixed-height analyst shell (which
    // pins the table and scrolls only its inner panel) becomes an ordinary
    // scrolling document, and the 1180px floor that the dense desktop layout
    // needs only applies once there is room for it.
    <div className="flex min-h-screen flex-col lg:h-screen lg:min-w-[1180px] lg:overflow-hidden">
      <TopNav active={BASE_PATH} />

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <CaseFilterSidebar
          initial={filters}
          facets={data.facets}
          span={null}
          basePath={BASE_PATH}
          hideSourceFilter
        />

        <main className="flex min-w-0 flex-1 flex-col gap-2 bg-abyss p-2 lg:overflow-hidden">
          <ReportIntakeSection districtsByProvince={districtsByProvince} />

          <ReportMapPanel
            points={mapPoints.points}
            plotted={mapPoints.plotted}
            unplaced={mapPoints.unplaced}
            truncated={mapPoints.truncated}
            live={mapPoints.live}
            filtered={hasActiveCaseFilters(filters)}
            backRef={backRef}
          />

          <section className="panel shrink-0 overflow-visible">
            <div className="flex flex-col gap-2 px-3.5 py-2.5 sm:flex-row sm:items-center sm:gap-3">
              <div className="min-w-0">
                <h1 className="panel-title whitespace-nowrap">รายงานจากประชาชน</h1>
                <p className="num text-[10.5px] whitespace-nowrap text-ink-muted">
                  {data.total.toLocaleString("en-US")} จาก{" "}
                  {data.grandTotal.toLocaleString("en-US")} รายงาน
                </p>
              </div>
              <CaseSearchBar filters={filters} basePath={BASE_PATH} />
            </div>
            <ActiveCaseFilters
              filters={filters}
              facets={data.facets}
              basePath={BASE_PATH}
              hideSourceFilter
            />
          </section>

          <section className="panel flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-auto">
              {data.rows.length > 0 ? (
                <CaseTable
                  rows={data.rows}
                  filters={filters}
                  basePath={BASE_PATH}
                  href={(row) => `/cases/${encodeURIComponent(row.id)}${backRef}`}
                />
              ) : (
                <EmptyState live={data.live} citizenGrandTotal={data.grandTotal} />
              )}
            </div>

            {data.rows.length > 0 && (
              <CasePagination
                filters={filters}
                page={data.page}
                pageCount={data.pageCount}
                total={data.total}
                pageSize={data.pageSize}
                basePath={BASE_PATH}
              />
            )}
          </section>
        </main>
      </div>
    </div>
  );
}

/**
 * Three nothings, told apart: the database is unreachable, nobody has ever
 * reported anything, or the current filters just happen to match nothing.
 * Collapsing any pair of these would misreport what's actually going on.
 */
function EmptyState({ live, citizenGrandTotal }: { live: boolean; citizenGrandTotal: number }) {
  if (!live) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <IconMessageOff size={26} stroke={1.5} className="text-amber" />
        <p className="text-[13px] text-ink">ยังไม่มีข้อมูลใน MongoDB</p>
        <p className="max-w-md text-[11.5px] leading-relaxed text-ink-muted">
          ให้รัน <code className="font-mono text-ink-dim">docker compose up -d</code> แล้ว{" "}
          <code className="font-mono text-ink-dim">npm run db:seed</code>
        </p>
      </div>
    );
  }

  if (citizenGrandTotal === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <IconMessageOff size={26} stroke={1.5} className="text-ink-muted" />
        <p className="text-[13px] text-ink">ยังไม่มีรายงานจากประชาชนในระบบ</p>
        <p className="max-w-md text-[11.5px] leading-relaxed text-ink-muted">
          กดที่ &ldquo;แจ้งเหตุการณ์ใหม่&rdquo; ด้านบนเพื่อเป็นรายงานแรก
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <IconSearchOff size={26} stroke={1.5} className="text-ink-muted" />
      <p className="text-[13px] text-ink">ไม่พบรายงานที่ตรงกับตัวกรอง</p>
      <Link href={BASE_PATH} scroll={false} className="text-[11.5px] text-azure hover:underline">
        ล้างตัวกรองทั้งหมด
      </Link>
    </div>
  );
}
