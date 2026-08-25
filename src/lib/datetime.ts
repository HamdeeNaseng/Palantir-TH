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
