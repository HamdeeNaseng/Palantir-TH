import { redirect } from "next/navigation";
import { parseCaseFilters, serializeCaseFilters } from "@/lib/case-filters";

/**
 * `/case` is an alias for the register at `/cases`.
 *
 * The nav tab, and every link in the app, points at the plural form; this
 * exists so the singular someone types by hand lands in the same place instead
 * of a 404. Filters are carried across so an aliased link keeps working.
 */
export default async function CaseAliasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const qs = serializeCaseFilters(parseCaseFilters(await searchParams));
  redirect(qs ? `/cases?${qs}` : "/cases");
}
