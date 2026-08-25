import { COLLECTIONS, getDb } from "@/lib/mongodb";
import type { CaseFilters } from "@/lib/case-filters";
import { listCases, type CaseListResult } from "./cases";
import type { EventCandidateDoc } from "@/lib/types";

/** The one source id every citizen-report submission is tagged with. */
export const CITIZEN_SOURCE_ID = "src_citizen";

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

  try {
    const db = await getDb();
    const citizenTotal = await db
      .collection<EventCandidateDoc>(COLLECTIONS.eventCandidates)
      .countDocuments({ corroborating_sources: CITIZEN_SOURCE_ID });
    return { ...result, grandTotal: citizenTotal };
  } catch {
    return result;
  }
}
