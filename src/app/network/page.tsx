import type { Metadata } from "next";
import TopNav from "@/components/layout/TopNav";
import NetworkWorkspace from "@/components/network/NetworkWorkspace";
import { getNetwork } from "@/server/facilities";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "เครือข่ายตอบสนอง — Palantir TH",
  description:
    "ที่ตั้งด่านตรวจ ค่ายทหาร สถานีตำรวจ กู้ภัย ดับเพลิง ศูนย์อพยพ ศูนย์ช่วยเหลือ อนามัย และโรงพยาบาล พร้อมสถานะเปิด-ปิดและการประสานงาน",
};

/**
 * The response network.
 *
 * Server-rendered because the whole list is the page: a few hundred rows with
 * their current status folded in, which is one MongoDB read and one file read
 * rather than anything the browser should be asked to assemble. Filtering
 * afterwards happens client-side — see `NetworkWorkspace`.
 */
export default async function NetworkPage() {
  const data = await getNetwork();

  return (
    <div className="flex min-h-dvh flex-col lg:h-screen lg:min-w-[1180px] lg:overflow-hidden">
      <TopNav active="/network" />
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <NetworkWorkspace data={data} />
      </div>
    </div>
  );
}
