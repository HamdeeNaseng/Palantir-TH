import type { Metadata } from "next";
import { IconDatabaseOff } from "@tabler/icons-react";
import TopNav from "@/components/layout/TopNav";
import SourceKpiRow from "@/components/sources/SourceKpiRow";
import SourceRegisterTable from "@/components/sources/SourceRegisterTable";
import IngestionRunsPanel from "@/components/sources/IngestionRunsPanel";
import TrustMixPanel from "@/components/sources/TrustMixPanel";
import { getSourceDashboard } from "@/server/sources";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "แหล่งข้อมูล — Palantir TH",
  description:
    "ทะเบียนแหล่งข้อมูล (source_registry) สัดส่วนที่แต่ละแหล่งป้อนเข้าระบบ ชั้นความน่าเชื่อถือ และสถานะรอบดึงข้อมูล (ingestion_runs)",
};

/**
 * The source register.
 *
 * Server-rendered end to end: the whole page is one rollup out of MongoDB
 * with no filter state to keep, so there is nothing here a client bundle
 * would do better. Every drill-down is a link into `/cases?src=…`, which
 * keeps the register a directory rather than a second console.
 */
export default async function SourcesPage() {
  const data = await getSourceDashboard();
  const isLocalDev = process.env.NODE_ENV === "development" && !process.env.VERCEL;

  return (
    // Same shell as the other consoles: a fixed viewport-height analyst layout
    // at `lg` with each panel scrolling in its own cell, and an ordinary
    // scrolling column below that.
    <div className="flex min-h-dvh flex-col lg:h-screen lg:min-w-[1180px] lg:overflow-hidden">
      <TopNav active="/sources" />

      <main className="flex min-w-0 flex-1 flex-col gap-2 bg-abyss p-2 lg:overflow-hidden">
        {data.live ? (
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 lg:grid-rows-[82px_minmax(0,1fr)]">
            <SourceKpiRow data={data} />

            <div className="grid min-h-0 grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1fr)_clamp(300px,26vw,380px)]">
              <section className="panel flex min-h-0 flex-col">
                <header className="flex shrink-0 flex-col gap-2 border-b border-[rgba(37,66,102,0.45)] px-3.5 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <h1 className="panel-title whitespace-nowrap">ทะเบียนแหล่งข้อมูล</h1>
                    <p className="num text-[10.5px] text-ink-muted">
                      {data.totals.sources.toLocaleString("en-US")} แห่ง ·
                      เรียงตามจำนวนเหตุการณ์ที่ป้อนเข้าระบบ
                    </p>
                  </div>
                  <p className="shrink-0 text-[10.5px] text-ink-muted">
                    คลิกชื่อแหล่งเพื่อดูเคสที่มาจากแหล่งนั้น
                  </p>
                </header>

                <div className="min-h-0 flex-1 overflow-auto">
                  <SourceRegisterTable rows={data.rows} nowMs={data.builtAtMs} />
                </div>
              </section>

              {/* The right rail is the pipeline's health: what it is made of,
                  then what it did most recently. Both are read after the
                  table, so neither takes the wider column. */}
              <div className="grid min-h-0 grid-cols-1 gap-2 lg:grid-rows-[minmax(0,auto)_minmax(0,1fr)]">
                <TrustMixPanel mix={data.trustMix} />
                <IngestionRunsPanel runs={data.recentRuns} nowMs={data.builtAtMs} />
              </div>
            </div>
          </div>
        ) : (
          <EmptyState isLocalDev={isLocalDev} />
        )}
      </main>
    </div>
  );
}

/**
 * Unlike `/cases` there is no "filter matched nothing" case to tell apart
 * here: the register has no filters, so an empty page means the collection is
 * empty or unreachable — and the `console.error` in `getSourceDashboard` is
 * what says which of the two it was.
 */
function EmptyState({ isLocalDev }: { isLocalDev: boolean }) {
  return (
    <section className="panel flex flex-1 flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <IconDatabaseOff size={26} stroke={1.5} className="text-amber" />
      <p className="text-[13px] text-ink">ยังไม่มีข้อมูลใน MongoDB</p>
      <p className="max-w-md text-[11.5px] leading-relaxed text-ink-muted">
        หน้านี้อ่านจากคอลเลกชัน <code className="font-mono">source_registry</code> และ{" "}
        <code className="font-mono">ingestion_runs</code> โดยตรง และจะไม่แสดงข้อมูลตัวอย่างแทน
        {isLocalDev ? (
          <>
            {" "}
            ให้รัน <code className="font-mono text-ink-dim">docker compose up -d</code> แล้ว{" "}
            <code className="font-mono text-ink-dim">npm run db:seed</code>
          </>
        ) : (
          " — ตรวจสอบ MONGODB_URI ของ deployment นี้และดูสาเหตุที่บันทึกไว้ใน log ของเซิร์ฟเวอร์"
        )}
      </p>
    </section>
  );
}
