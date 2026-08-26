// Server-only by module graph, the same way `mongodb.ts` is: this is imported
// solely by the `"use server"` action in `report-intake.ts`, so the secret key
// below never reaches a client bundle. (The repo does not depend on the
// `server-only` package; it keeps the separation structural instead.)
import { RECAPTCHA_ACTION } from "@/lib/recaptcha";

const SITEVERIFY_URL = "https://www.google.com/recaptcha/api/siteverify";

/** Google's own guidance: 0.5 is the default line between human and bot. */
const DEFAULT_MIN_SCORE = 0.5;

const TIMEOUT_MS = 5000;

const SECRET = process.env.RECAPTCHA_SECRET_KEY || "";

const MIN_SCORE = Number(process.env.RECAPTCHA_MIN_SCORE) || DEFAULT_MIN_SCORE;

export interface RecaptchaResult {
  /** Whether the submission may proceed. */
  ok: boolean;
  /** 0.0 (bot) to 1.0 (human), when Google returned one. */
  score?: number;
  /** Why, for the log and for the stored record. */
  reason: "disabled" | "unavailable" | "passed" | "missing-token" | "rejected" | "low-score";
}

interface SiteverifyResponse {
  success?: boolean;
  score?: number;
  action?: string;
  "error-codes"?: string[];
}

/**
 * Verifies a reCAPTCHA v3 token against Google, server-side.
 *
 * Two failure modes are treated very differently on purpose:
 *
 *   - **Not configured.** With no `RECAPTCHA_SECRET_KEY` the check is skipped
 *     entirely, so a fresh clone, CI, and the Playwright suite behave exactly
 *     as they did before this existed. The honeypot still runs either way.
 *   - **Google unreachable.** A timeout or a garbled response means we learned
 *     nothing about the sender, and refusing every report during someone
 *     else's outage would cost more than the bot traffic it prevents. It fails
 *     open with a warning, so the gap shows up in the logs.
 *
 * Only a token that is present and judged bad — invalid, wrong action, or
 * below the score line — blocks a submission.
 */
export async function verifyRecaptcha(token: string): Promise<RecaptchaResult> {
  if (SECRET === "") return { ok: true, reason: "disabled" };

  // Configured, so an absent token is a submission that never ran the widget.
  if (token === "") return { ok: false, reason: "missing-token" };

  let data: SiteverifyResponse;
  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret: SECRET, response: token }),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`siteverify returned ${res.status}`);
    data = (await res.json()) as SiteverifyResponse;
  } catch (err) {
    console.warn("[recaptcha] verification unavailable, allowing submission", err);
    return { ok: true, reason: "unavailable" };
  }

  if (data.success !== true) {
    console.warn("[recaptcha] token rejected", data["error-codes"]);
    return { ok: false, reason: "rejected" };
  }

  // A token minted for another action — or another page — is not a token for
  // this form.
  if (data.action !== undefined && data.action !== RECAPTCHA_ACTION) {
    console.warn("[recaptcha] unexpected action", data.action);
    return { ok: false, reason: "rejected" };
  }

  const score = typeof data.score === "number" ? data.score : undefined;
  if (score !== undefined && score < MIN_SCORE) {
    return { ok: false, score, reason: "low-score" };
  }

  return { ok: true, score, reason: "passed" };
}
