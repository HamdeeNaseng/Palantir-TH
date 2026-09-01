import { COLLECTIONS, getDb } from "@/lib/mongodb";
import type { CaseFilters } from "@/lib/case-filters";
import {
  listCases,
  listCasePoints,
  type CaseFacets,
  type CaseListResult,
  type CasePointsResult,
} from "./cases";
import { PROVINCES } from "@/lib/geo";
import { EVENT_TYPE_LABEL, VERIFICATION_LABEL } from "@/lib/labels";
import { EVENT_COLOR } from "@/lib/palette";
import { EVENT_TYPES } from "@/lib/types";
import type {
  EventCandidateDoc,
  EventType,
  ProvinceCode,
  VerificationStatus,
} from "@/lib/types";

/** The one source id every citizen-report submission is tagged with. */
export const CITIZEN_SOURCE_ID = "src_citizen";

/** Every status a report can be moved through, in the order `/investigate` lists them. */
const VERIFICATIONS: VerificationStatus[] = ["verified", "under_review", "unverifiable"];

/**
 * Complete the facets with the vocabulary a citizen can actually file under.
 *
 * `/cases` builds its filter options out of the data, which is right for a
 * 10,000-row register: an option nobody's record matches is an option worth
 * hiding. On `/report` the same rule collapses the sidebar. The citizen
 * register starts empty and stays small, so the province, type and status
 * sections — each rendered only when its facet is non-empty — simply were not
 * there, and the page offered a date range and an evidence toggle where
 * `/investigate` offers the whole vocabulary. On the production cluster, with
 * no citizen reports filed yet, there was nothing to filter by at all.
 *
 * So the fixed part of the vocabulary is stated rather than discovered: the
 * four provinces the intake form is bounded to, all seventeen `EVENT_TYPES` it
 * can file under, and the three statuses a report moves through. Counts still
 * come from the data — an option nobody has used reads 0 rather than
 * disappearing, which is the honest thing to show a filter that *can* match
 * something tomorrow.
 *
 * Districts, place types and sources stay data-derived. A list of every อำเภอ
 * in the south is not a vocabulary anyone browses, and the source is pinned
 * here anyway.
 */
function withCitizenVocabulary(facets: CaseFacets): CaseFacets {
  const countOf = <T extends { n: number }>(found: T | undefined) => found?.n ?? 0;

  const provinces = [
    ...PROVINCES.map((p) => ({
      code: p.code as ProvinceCode,
      label: p.name,
      n: countOf(facets.provinces.find((f) => f.code === p.code)),
    })),
    // Anything the data carries beyond the four — "อื่น ๆ" on a report whose
    // pin fell outside them — is kept rather than dropped.
    ...facets.provinces.filter((f) => !PROVINCES.some((p) => p.code === f.code)),
  ];

  const eventTypes = EVENT_TYPES.map((value: EventType) => ({
    value,
    label: EVENT_TYPE_LABEL[value] ?? value,
    color: EVENT_COLOR[value] ?? EVENT_COLOR.other,
    n: countOf(facets.eventTypes.find((f) => f.value === value)),
  }));

  const verification = VERIFICATIONS.map((value) => ({
    value,
    label: VERIFICATION_LABEL[value] ?? value,
    n: countOf(facets.verification.find((f) => f.value === value)),
  }));

  return { ...facets, provinces, eventTypes, verification };
}

/**
 * The citizen-report register at `/report` — the same query engine as
 * `/cases`, permanently scoped to submissions from the public form.
 *
 * `listCases` already supports narrowing to one source (that's the "แหล่ง
 * ข้อมูล" filter on `/cases`); this just pins that filter instead of leaving
 * it to the analyst, and fixes up `grandTotal` — `listCases` reports the size
 * of the *whole* register there, which is right for `/cases` but would tell a
 * citizen "0 of 10,041" instead of "0 of however-many-people-have-reported".
 */
export async function listCitizenReports(filters: CaseFilters): Promise<CaseListResult> {
  const scoped: CaseFilters = { ...filters, sourceId: CITIZEN_SOURCE_ID };
  const result = await listCases(scoped);

  const withVocabulary: CaseListResult = {
    ...result,
    facets: withCitizenVocabulary(result.facets),
  };

  try {
    const db = await getDb();
    const citizenTotal = await db
      .collection<EventCandidateDoc>(COLLECTIONS.eventCandidates)
      .countDocuments({ corroborating_sources: CITIZEN_SOURCE_ID });
    return { ...withVocabulary, grandTotal: citizenTotal };
  } catch {
    return withVocabulary;
  }
}

/**
 * The same submissions as `listCitizenReports`, as map marks.
 *
 * Scoped identically, so the map beside the register can never show a mark the
 * table does not account for — the two read one filter set and one source id.
 */
export function listCitizenReportPoints(filters: CaseFilters): Promise<CasePointsResult> {
  return listCasePoints({ ...filters, sourceId: CITIZEN_SOURCE_ID });
}
