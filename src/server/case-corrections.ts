"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { COLLECTIONS, getDb } from "@/lib/mongodb";
import { hasChanges, pruneUnchanged } from "@/lib/case-correction";
import { EVENT_TYPES } from "@/lib/types";
import type { CaseCorrectionDoc, EventCandidateDoc } from "@/lib/types";

/**
 * Writing an analyst correction for one case.
 *
 * Append-only by construction: this only ever inserts. There is no update and
 * no delete, so a mistaken correction is fixed by writing another one and the
 * record of the mistake survives — which is the property that makes an
 * unauthenticated write survivable at all.
 *
 * NOTE ON ACCESS: this action is deliberately ungated. Anyone who can reach
 * `/cases/[id]` can write here. That is a decision taken with the append-only
 * design as its mitigation, not an oversight — but it does mean the
 * `corrected_by` field is a claim about authorship and must never be rendered
 * as though it were verified.
 */

const GEO_PRECISIONS = [
  "gps",
  "address",
  "village",
  "subdistrict",
  "district",
  "province",
  "unknown",
] as const;

/** Free-text caps. Long text is truncated rather than rejected — see report-schema.ts. */
const NOTE_MAX = 500;
const BY_MAX = 80;
const SUMMARY_MAX = 2000;

const changesSchema = z.object({
  geo: z
    .object({
      // Bounds are the four provinces plus slack, matching the map's own
      // BOUNDS — a pin outside them is a bug or an abuse, not a correction.
      coordinates: z.tuple([z.number().min(99).max(103), z.number().min(5).max(9)]),
      precision: z.enum(GEO_PRECISIONS),
    })
    .optional(),
  event_type: z.enum(EVENT_TYPES).optional(),
  severity: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).nullable().optional(),
  verification: z.enum(["verified", "under_review", "unverifiable"]).optional(),
  killed: z.number().int().min(0).max(10_000).nullable().optional(),
  injured: z.number().int().min(0).max(10_000).nullable().optional(),
  summary: z.string().max(SUMMARY_MAX).nullable().optional(),
});

const inputSchema = z.object({
  eventId: z.string().min(1).max(200),
  correctedBy: z.string().max(BY_MAX).nullable(),
  note: z.string().max(NOTE_MAX).nullable(),
  changes: changesSchema,
});

export type SaveCorrectionResult =
  | { ok: true; correctionId: string; changedFields: number }
  | { ok: false; error: string };

export async function saveCaseCorrection(input: unknown): Promise<SaveCorrectionResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "ข้อมูลที่ส่งมาไม่ถูกต้อง" };
  }
  const { eventId, correctedBy, note, changes } = parsed.data;

  let db: Awaited<ReturnType<typeof getDb>>;
  try {
    db = await getDb();
  } catch {
    return { ok: false, error: "เชื่อมต่อฐานข้อมูลไม่ได้" };
  }

  // The correction is defined *against* the source's claim, so the claim has
  // to exist and has to be read before anything is written — otherwise a
  // correction could assert a change to a field nothing reported.
  const event = await db
    .collection<EventCandidateDoc>(COLLECTIONS.eventCandidates)
    .findOne({ _id: eventId });
  if (!event) return { ok: false, error: "ไม่พบเคสนี้" };

  const pruned = pruneUnchanged(event, changes as never);
  if (!hasChanges(pruned)) {
    return { ok: false, error: "ไม่มีการเปลี่ยนแปลงจากค่าที่แหล่งข้อมูลรายงาน" };
  }

  const doc: CaseCorrectionDoc = {
    _id: `correction-${randomUUID()}`,
    event_id: eventId,
    corrected_at: new Date(),
    corrected_by: emptyToNull(correctedBy),
    note: emptyToNull(note),
    changes: pruned,
  };

  await db.collection<CaseCorrectionDoc>(COLLECTIONS.caseCorrections).insertOne(doc);

  // The detail page is force-dynamic, but the register and map read the same
  // records — drop their cached renders so a correction is visible everywhere
  // it changes an answer, not only on the page it was made from.
  revalidatePath(`/cases/${encodeURIComponent(eventId)}`);
  revalidatePath("/cases");

  return {
    ok: true,
    correctionId: doc._id,
    changedFields: Object.keys(pruned).length,
  };
}

function emptyToNull(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}
