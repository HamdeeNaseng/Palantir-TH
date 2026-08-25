import type { EventType } from "./types";
import { EVENT_TYPE_LABEL } from "./labels";

/**
 * Shared shape for the citizen-report intake at `/report`.
 *
 * Kept apart from `report-intake.ts` (the server action) so the client form
 * can import limits and labels without pulling in `node:crypto` or MongoDB —
 * the same client/server split `labels.ts` already draws for the rest of the
 * app.
 */

/** Ordered for a citizen filling the form, not alphabetically or by code. */
export const REPORT_EVENT_TYPES: { value: EventType; label: string }[] = (
  [
    "shooting", "explosion", "arson", "abduction", "raid",
    "narcotics", "crime", "gang", "unrest", "other",
  ] as const
).map((value) => ({ value, label: EVENT_TYPE_LABEL[value] }));

export const REPORT_LIMITS = {
  title: 140,
  description: 2000,
  place: 160,
  subdistrict: 120,
  mediaUrls: 3,
  mediaUrlLength: 500,
  /** Casualty counts above this are almost certainly a typo, not a report. */
  casualtyMax: 999,
} as const;

/** Earliest date the form accepts — a round floor, not the dataset's actual start. */
export const REPORT_MIN_DATE = "2000-01-01";

/** Classic honeypot bait: a field a real citizen has no reason to fill in. */
export const HONEYPOT_FIELD = "organization";

export type ReportFieldName =
  | "eventType"
  | "title"
  | "description"
  | "occurredDate"
  | "occurredTime"
  | "provinceCode"
  | "districtCode"
  | "subdistrict"
  | "place"
  | "killed"
  | "injured"
  | "mediaUrls";

export interface ReportFormState {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Partial<Record<ReportFieldName, string>>;
  /** Set on success — the case the submission was recorded as. */
  caseId?: string;
}

export const REPORT_FORM_IDLE: ReportFormState = { status: "idle" };

/** One province's selectable districts, sent to the client as plain data. */
export interface DistrictOption {
  code: string;
  name: string;
}
