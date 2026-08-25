import Link from "next/link";
import type { Metadata } from "next";
import { IconDatabaseOff, IconSearchOff } from "@tabler/icons-react";
import TopNav from "@/components/layout/TopNav";
import CaseFilterSidebar from "@/components/cases/CaseFilterSidebar";
import CaseSearchBar from "@/components/cases/CaseSearchBar";
import ActiveCaseFilters from "@/components/cases/ActiveCaseFilters";
import CaseTable from "@/components/cases/CaseTable";
import CasePagination from "@/components/cases/CasePagination";
import { parseCaseFilters, serializeCaseFilters } from "@/lib/case-filters";
import { listCases } from "@/server/cases";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ทะเบียนเคส — Palantir TH",
  description: "ตารางเหตุการณ์ที่ถูกบันทึกไว้ ค้นหาและกรองตามพื้นที่ ช่วงเวลา และแหล่งข้อมูล",
};

export default async function CasesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = parseCaseFilters(await searchParams);
  const data = await listCases(filters);

  // Carried into the detail view so "กลับไปตารางเคส" returns to this exact page
  // of this exact filtered result, rather than dumping the analyst at row 1.
  const listQuery = serializeCaseFilters(filters);
  const listPath = listQuery ? "/cases?" + listQuery : "/cases";
  const backRef = `?ref=${encodeURIComponent(listPath)}`;

  return (
    <div className="flex h-screen min-w-[1180px] flex-col overflow-hidden">
      <TopNav active="/cases" />

      <div className="flex min-h-0 flex-1">
        <CaseFilterSidebar initial={filters} facets={data.facets} span={data.span} />

        <main className="flex min-w-0 flex-1 flex-col gap-2 overflow-hidden bg-abyss p-2">
          <section className="panel shrink-0 overflow-visible">
            <div className="flex items-center gap-3 px-3.5 py-2.5">
              <div className="min-w-0">
                <h1 className="panel-title whitespace-nowrap">ทะเบียนเคส</h1>
                <p className="num text-[10.5px] whitespace-nowrap text-ink-muted">
                  {data.total.toLocaleString("en-US")} จาก{" "}
                  {data.grandTotal.toLocaleString("en-US")} รายการ
                </p>
              </div>
              <CaseSearchBar filters={filters} />
            </div>
            <ActiveCaseFilters filters={filters} facets={data.facets} />
          </section>

          <section className="panel flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-auto">
              {data.rows.length > 0 ? (
                <CaseTable
                  rows={data.rows}
                  filters={filters}
                  href={(row) => `/cases/${encodeURIComponent(row.id)}${backRef}`}
                />
              ) : (
                <EmptyState live={data.live} />
              )}
            </div>

            {data.rows.length > 0 && (
              <CasePagination
                filters={filters}
                page={data.page}
                pageCount={data.pageCount}
                total={data.total}
                pageSize={data.pageSize}
              />
            )}
          </section>
        </main>
      </div>
    </div>
  );
}

/**
 * Two different nothings, told apart on purpose: a filter that matches no
 * record, and a database with no records in it. Collapsing them would let a
 * broken connection read as "there were no such events".
 */
function EmptyState({ live }: { live: boolean }) {
  if (!live) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <IconDatabaseOff size={26} stroke={1.5} className="text-amber" />
        <p className="text-[13px] text-ink">ยังไม่มีข้อมูลใน MongoDB</p>
        <p className="max-w-md text-[11.5px] leading-relaxed text-ink-muted">
          ทะเบียนเคสอ่านจากคอลเลกชัน <code className="font-mono">event_candidates</code> โดยตรง
          และจะไม่แสดงข้อมูลตัวอย่างแทน ให้รัน{" "}
          <code className="font-mono text-ink-dim">docker compose up -d</code> แล้ว{" "}
          <code className="font-mono text-ink-dim">npm run db:seed</code>
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <IconSearchOff size={26} stroke={1.5} className="text-ink-muted" />
      <p className="text-[13px] text-ink">ไม่พบเคสที่ตรงกับตัวกรอง</p>
      <Link href="/cases" scroll={false} className="text-[11.5px] text-azure hover:underline">
        ล้างตัวกรองทั้งหมด
      </Link>
    </div>
  );
}
