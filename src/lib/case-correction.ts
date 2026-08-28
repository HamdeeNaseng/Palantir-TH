import { CORRECTABLE_FIELDS } from "./types";
import type {
  CaseCorrectionChanges,
  CaseCorrectionDoc,
  EventCandidateDoc,
} from "./types";

/**
 * Resolving analyst corrections over a source's claim.
 *
 * Pure and dependency-free so the same rules run on both sides: the server
 * writes and reads corrections, and the edit form needs to show the analyst
 * exactly what the page will look like once saved. Two copies of "newest wins"
 * would be two chances to disagree.
 */

/** What one field looks like after corrections — and where each value came from. */
export interface FieldResolution<T> {
  value: T;
  /** The source's own value, kept so the UI can show what was overridden. */
  reported: T;
  corrected: boolean;
  /** When the winning correction was made. */
  at: Date | null;
  by: string | null;
  note: string | null;
}

export interface EffectiveEvent {
  /** The candidate with corrections applied — safe to render as "current". */
  event: EventCandidateDoc;
  /** Per-field provenance, for the "แหล่งข่าวว่า X · แก้เป็น Y" annotations. */
  resolution: Partial<Record<keyof CaseCorrectionChanges, FieldResolution<unknown>>>;
  /** Newest first — the audit trail. */
  history: CaseCorrectionDoc[];
}

/**
 * Applies a correction stack to one candidate.
 *
 * Newest correction wins **per field**, not per document: two analysts fixing
 * different fields must not overwrite each other, and an older correction to a
 * field nobody has touched since is still the current answer.
 *
 * The input document is never mutated — callers hold the source's claim and
 * the corrected view side by side, and mutating in place would collapse them.
 */
export function effectiveEvent(
  event: EventCandidateDoc,
  corrections: CaseCorrectionDoc[],
): EffectiveEvent {
  // Oldest first, so a later write simply overwrites an earlier one.
  const ordered = [...corrections].sort(
    (a, b) => a.corrected_at.getTime() - b.corrected_at.getTime(),
  );

  const winner = new Map<keyof CaseCorrectionChanges, CaseCorrectionDoc>();
  for (const correction of ordered) {
    for (const field of CORRECTABLE_FIELDS) {
      if (correction.changes[field] !== undefined) winner.set(field, correction);
    }
  }

  const next: EventCandidateDoc = {
    ...event,
    location: { ...event.location },
    event: { ...event.event },
    casualties: { ...event.casualties },
  };
  const resolution: EffectiveEvent["resolution"] = {};

  const record = <T>(field: keyof CaseCorrectionChanges, reported: T, value: T): void => {
    const from = winner.get(field);
    resolution[field] = {
      value,
      reported,
      corrected: from !== undefined,
      at: from?.corrected_at ?? null,
      by: from?.corrected_by ?? null,
      note: from?.note ?? null,
    };
  };

  const geo = winner.get("geo")?.changes.geo;
  if (geo) {
    next.location.geo = { type: "Point", coordinates: geo.coordinates };
    next.location.geo_precision = geo.precision;
  }
  record("geo", event.location.geo?.coordinates ?? null, next.location.geo?.coordinates ?? null);

  const type = winner.get("event_type")?.changes.event_type;
  if (type !== undefined) next.event.type = type;
  record("event_type", event.event.type, next.event.type);

  const severity = winner.get("severity")?.changes.severity;
  if (severity !== undefined) next.severity = severity;
  record("severity", event.severity, next.severity);

  const verification = winner.get("verification")?.changes.verification;
  if (verification !== undefined) next.verification = verification;
  record("verification", event.verification, next.verification);

  const killed = winner.get("killed")?.changes.killed;
  if (killed !== undefined) next.casualties.killed = killed;
  record("killed", event.casualties.killed, next.casualties.killed);

  const injured = winner.get("injured")?.changes.injured;
  if (injured !== undefined) next.casualties.injured = injured;
  record("injured", event.casualties.injured, next.casualties.injured);

  const summary = winner.get("summary")?.changes.summary;
  if (summary !== undefined) next.event.summary = summary ?? undefined;
  record("summary", event.event.summary ?? null, next.event.summary ?? null);

  return {
    event: next,
    resolution,
    history: [...ordered].reverse(),
  };
}

/**
 * Drops changes that match what the source already says.
 *
 * A correction asserting the same value the source reported is noise in the
 * audit trail — it reads as a disagreement where there is none. Comparing
 * before the write keeps the history to actual disagreements, and lets the
 * form submit its whole state without the caller diffing it first.
 */
export function pruneUnchanged(
  event: EventCandidateDoc,
  changes: CaseCorrectionChanges,
): CaseCorrectionChanges {
  const out: CaseCorrectionChanges = {};

  if (changes.geo) {
    const current = event.location.geo?.coordinates;
    const moved =
      !current ||
      current[0] !== changes.geo.coordinates[0] ||
      current[1] !== changes.geo.coordinates[1] ||
      event.location.geo_precision !== changes.geo.precision;
    if (moved) out.geo = changes.geo;
  }
  if (changes.event_type !== undefined && changes.event_type !== event.event.type) {
    out.event_type = changes.event_type;
  }
  if (changes.severity !== undefined && changes.severity !== event.severity) {
    out.severity = changes.severity;
  }
  if (changes.verification !== undefined && changes.verification !== event.verification) {
    out.verification = changes.verification;
  }
  if (changes.killed !== undefined && changes.killed !== event.casualties.killed) {
    out.killed = changes.killed;
  }
  if (changes.injured !== undefined && changes.injured !== event.casualties.injured) {
    out.injured = changes.injured;
  }
  if (changes.summary !== undefined && changes.summary !== (event.event.summary ?? null)) {
    out.summary = changes.summary;
  }

  return out;
}

export function hasChanges(changes: CaseCorrectionChanges): boolean {
  return CORRECTABLE_FIELDS.some((f) => changes[f] !== undefined);
}
