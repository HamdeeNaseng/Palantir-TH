import type { Metadata } from "next";
import TopNav from "@/components/layout/TopNav";
import MapWorkspace from "@/components/map/MapWorkspace";
import { parseFilters, serializeFilters } from "@/lib/filters";
import { getMapOverview } from "@/server/map-overview";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "แผนที่ภาพรวม — Palantir TH",
  description:
    "ความหนาแน่นของเหตุการณ์รายจังหวัด อำเภอ และตำบล บนแผนที่เต็มจอ พร้อมภาพถ่ายดาวเทียมและจุดเหตุการณ์",
};

/**
 * `/map` — the four provinces as one picture.
 *
 * Shares the URL filter grammar with `/investigate` and `/events` (`parseFilters`),
 * so a filtered view can be carried between them by the query string alone. It
 * deliberately has no filter sidebar of its own: this page is for the shape of
 * the whole area, and 212 px of controls in front of it would be arguing with
 * the one thing it exists to show.
 */
export default async function MapPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = parseFilters(await searchParams);
  const data = await getMapOverview(filters);

  return (
    // The one page that stays viewport-height everywhere: a map is the thing
    // being read, so it takes the whole screen on a phone too. What changes
    // below `lg` is the furniture on top of it — see `MapWorkspace`.
    <div className="flex h-dvh flex-col overflow-hidden lg:min-w-[900px]">
      <TopNav active="/map" />

      {!data.live && (
        <p className="pointer-events-none fixed top-[calc(var(--nav-h)_+_8px)] left-1/2 z-50 max-w-[92vw] -translate-x-1/2 rounded border border-amber/40 bg-[#211808]/95 px-3 py-1.5 text-[11px] text-amber shadow-lg">
          {/* Local-development instruction only — see the note in
              InvestigateWorkspace. `live` is false for any failed read, so
              naming the connection on a hosted deployment misdirects. */}
          {process.env.NODE_ENV === "development" && !process.env.VERCEL ? (
            <>
              ยังเชื่อมต่อ MongoDB ไม่ได้ — ให้รัน{" "}
              <code className="font-mono">docker compose up -d</code> แล้ว{" "}
              <code className="font-mono">npm run db:seed</code>
            </>
          ) : (
            <>ยังอ่านข้อมูลไม่ได้ในขณะนี้</>
          )}
        </p>
      )}

      <MapWorkspace data={data} eventsQuery={serializeFilters(filters)} />
    </div>
  );
}
