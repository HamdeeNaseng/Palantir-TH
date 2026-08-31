/**
 * Date formatting for the case register.
 *
 * Every formatter pins `timeZone: "Asia/Bangkok"`. The ingested timestamps
 * encode Thai calendar dates — ศอ.บต.'s `22/11/2545` is stored as
 * `2002-11-22T00:00:00Z` — so formatting in the server's own zone would render
 * the record a day early anywhere west of UTC, silently moving events between
 * days in a dataset whose whole value is when things happened.
 */

const TZ = "Asia/Bangkok";

const DATE = new Intl.DateTimeFormat("th-TH", {
  timeZone: TZ,
  day: "numeric",
  month: "short",
  year: "numeric",
  calendar: "buddhist",
});

const DATE_TIME = new Intl.DateTimeFormat("th-TH", {
  timeZone: TZ,
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  calendar: "buddhist",
});

const DATE_LONG = new Intl.DateTimeFormat("th-TH", {
  timeZone: TZ,
  dateStyle: "full",
  calendar: "buddhist",
});

export const formatThaiDate = (at: Date) => DATE.format(at);
export const formatThaiDateTime = (at: Date) => DATE_TIME.format(at);
export const formatThaiDateLong = (at: Date) => DATE_LONG.format(at);

/**
 * Show a clock only when the source actually recorded one. Day-precision
 * records carry a midnight that is an artefact of parsing, not an observation;
 * printing "00:00 น." would present it as a time the source never gave.
 */
export function formatByPrecision(at: Date, precision: "minute" | "hour" | "day"): string {
  return precision === "day" ? DATE.format(at) : DATE_TIME.format(at);
}

/** `YYYY-MM-DD` in Bangkok time — the form `<input type="date">` expects. */
export const toInputDate = (at: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(at);

const INPUT_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** `YYYY-MM-DDTHH:mm` in Bangkok time — what `<input type="datetime-local">` expects. */
export const toInputDateTime = (at: Date) => `${toInputDate(at)}T${INPUT_TIME.format(at)}`;

/** Inverse of `toInputDateTime` — reads a `datetime-local` value as Bangkok-local. */
export function fromInputDateTime(value: string): Date {
  return new Date(`${value}:00${BANGKOK_OFFSET}`);
}

/** Thailand has no DST, so a fixed offset is exact rather than an approximation. */
const BANGKOK_OFFSET = "+07:00";

/**
 * Milliseconds from a field the schema types as `Date`, whatever actually landed.
 *
 * Every such field is declared `Date` in `src/lib/types.ts` and is one for the
 * overwhelming majority of documents — but the collections are written by
 * several ingestion paths, and a connector that stores an ISO **string**
 * instead produces a value that satisfies TypeScript (the type is a
 * compile-time claim about data the compiler never sees) and then throws
 * `time.start.getTime is not a function` at runtime.
 *
 * That is not a one-row problem. `toSnapshot` sorts before it maps, so a
 * single bad document took the whole snapshot down and with it `/investigate`,
 * `/events` and `/map` — three pages returning 500 because one field in ten
 * thousand was the wrong type.
 *
 * So the server coerces rather than trusts. Unparseable values return `null`
 * for the caller to place; `0` would be worse than nothing, dating the record
 * to 1970 and sorting it to the head of the register as the oldest incident
 * on file.
 *
 * `scripts/probe-date-types.mts` lists the documents this is covering for.
 * Repairing them at the source is still the fix; this only stops one bad row
 * from being an outage in the meantime.
 */
export function msOrNull(value: unknown): number | null {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  if (typeof value === "string" || typeof value === "number") {
    const ms = new Date(value).getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  return null;
}

/**
 * The same, where a number is required.
 *
 * Callers pass the current build time rather than 0: an event whose timestamp
 * cannot be read is of unknown age, and placing it near the present keeps it
 * in view without stretching every timeline axis back fifty years.
 */
export function msOr(value: unknown, fallbackMs: number): number {
  return msOrNull(value) ?? fallbackMs;
}
