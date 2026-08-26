/**
 * Shared reCAPTCHA v3 constants.
 *
 * Client-safe on purpose: this module holds the site key (which is public by
 * design — it ships in the page that renders the widget) and nothing else.
 * The secret key is read only by `src/server/recaptcha-verify.ts`, and zod is
 * kept out of here for the same reason `report-form.ts` keeps it out — this is
 * imported by a client component.
 */

/** Hidden form field the v3 token travels in. */
export const RECAPTCHA_FIELD = "recaptchaToken";

/**
 * The v3 "action" label. Google returns it back on verification, so checking
 * it stops a token minted on some other page (or some other site sharing the
 * key) from being replayed against the report form.
 */
export const RECAPTCHA_ACTION = "citizen_report";

/**
 * `process.env.NEXT_PUBLIC_*` is written out in full, exactly as in
 * `basemap.ts`: Next.js inlines these at build time by literal match, so
 * reading one through a variable would silently resolve to undefined in the
 * browser.
 */
export const RECAPTCHA_SITE_KEY = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY || "";

/** Nothing is requested from Google until a site key exists. */
export const RECAPTCHA_ENABLED = RECAPTCHA_SITE_KEY !== "";
