import { redirect } from "next/navigation";

/** Singular alias for one case — see `src/app/case/page.tsx`. */
export default async function CaseDetailAliasPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/cases/${encodeURIComponent(decodeURIComponent(id))}`);
}
