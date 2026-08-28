import Link from "next/link";
import { IconX } from "@tabler/icons-react";
import { PROVINCE_BY_CODE } from "@/lib/geo";
import { EVENT_TYPE_LABEL, VERIFICATION_LABEL } from "@/lib/labels";
import {
  DEFAULT_CASE_FILTERS,
  casesHref,
  hasActiveCaseFilters,
  type CaseFilters,
} from "@/lib/case-filters";
import type { CaseFacets } from "@/server/cases";

/**
 * The filters currently narrowing the register, each removable on its own.
 *
 * Plain links, so this works before hydration and stays in step with the URL
 * without holding any state of its own. The sidebar can only be reset wholesale;
 * this is how one wrong tick gets undone.
 */

function Chip({ label, href }: { label: string; href: string }) {
  return (
    <Link
      href={href}
      scroll={false}
      className="chip min-h-9 max-w-full px-3 text-[12px] text-ink-dim hover:border-azure hover:text-ink sm:min-h-0 sm:px-2 sm:text-[11px] border-[rgba(56,100,150,0.6)] bg-[rgba(56,189,248,0.08)]"
    >
      <span className="min-w-0 truncate">{label}</span>
      <IconX size={13} stroke={2.2} className="shrink-0 opacity-70" />
    </Link>
  );
}

export default function ActiveCaseFilters({
  filters: f,
  facets,
  basePath = "/cases",
  hideSourceFilter = false,
}: {
  filters: CaseFilters;
  facets: CaseFacets;
  basePath?: string;
  hideSourceFilter?: boolean;
}) {
  // The source is a fixed scope on a page like `/report`, not a filter the
  // chip row can remove — so an always-true `sourceId` there must not count
  // toward "is anything narrowing this view".
  const activeIgnoringSource = hasActiveCaseFilters(
    hideSourceFilter ? { ...f, sourceId: DEFAULT_CASE_FILTERS.sourceId } : f,
  );
  if (!activeIgnoringSource) return null;

  const chips: { key: string; label: string; href: string }[] = [];
  const drop = <K extends keyof CaseFilters>(key: K, value: CaseFilters[K]) =>
    casesHref(f, { [key]: value } as Partial<CaseFilters>, basePath);

  if (f.q) chips.push({ key: "q", label: `ค้นหา: ${f.q}`, href: drop("q", "") });

  if (f.from || f.to) {
    chips.push({
      key: "date",
      label: `วันที่: ${f.from || "เริ่มต้น"} → ${f.to || "ล่าสุด"}`,
      href: casesHref(f, { from: "", to: "" }, basePath),
    });
  }

  for (const code of f.provinces) {
    chips.push({
      key: `prov-${code}`,
      label: `จ.${PROVINCE_BY_CODE.get(code)?.name ?? "อื่น ๆ"}`,
      href: casesHref(
        f,
        {
          provinces: f.provinces.filter((c) => c !== code),
          // Districts are scoped to a province, so removing the province has
          // to release the districts chosen inside it or the result set
          // stays empty.
          districts: [],
        },
        basePath,
      ),
    });
  }

  for (const name of f.districts) {
    chips.push({
      key: `dist-${name}`,
      label: `อ.${name}`,
      href: drop("districts", f.districts.filter((d) => d !== name)),
    });
  }

  for (const type of f.eventTypes) {
    chips.push({
      key: `type-${type}`,
      label: EVENT_TYPE_LABEL[type] ?? type,
      href: drop("eventTypes", f.eventTypes.filter((t) => t !== type)),
    });
  }

  for (const v of f.verification) {
    chips.push({
      key: `ver-${v}`,
      label: VERIFICATION_LABEL[v] ?? v,
      href: drop("verification", f.verification.filter((x) => x !== v)),
    });
  }

  for (const place of f.placeTypes) {
    chips.push({
      key: `place-${place}`,
      label: place,
      href: drop("placeTypes", f.placeTypes.filter((p) => p !== place)),
    });
  }

  if (!hideSourceFilter && f.sourceId !== "all") {
    const label = facets.sources.find((s) => s.id === f.sourceId)?.label ?? f.sourceId;
    chips.push({ key: "src", label: `แหล่ง: ${label}`, href: drop("sourceId", "all") });
  }

  if (f.hasMedia) {
    chips.push({ key: "media", label: "มีหลักฐานแนบ", href: drop("hasMedia", false) });
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-t border-[rgba(37,66,102,0.35)] px-3.5 py-2">
      <span className="text-[10.5px] text-ink-muted">ตัวกรองที่ใช้อยู่</span>
      {chips.map((c) => (
        <Chip key={c.key} label={c.label} href={c.href} />
      ))}
      <Link
        href={basePath}
        scroll={false}
        className="ml-1 text-[10.5px] text-azure hover:underline"
      >
        ล้างทั้งหมด
      </Link>
    </div>
  );
}
