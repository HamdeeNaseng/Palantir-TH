"use client";

import { useCallback, useEffect, useRef } from "react";
import { RECAPTCHA_ACTION, RECAPTCHA_ENABLED, RECAPTCHA_SITE_KEY } from "@/lib/recaptcha";

interface Grecaptcha {
  ready: (cb: () => void) => void;
  execute: (siteKey: string, opts: { action: string }) => Promise<string>;
}

declare global {
  interface Window {
    grecaptcha?: Grecaptcha;
  }
}

const SCRIPT_ID = "recaptcha-v3";

/** A token is minted per submit; nobody should wait longer than this for one. */
const EXECUTE_TIMEOUT_MS = 5000;

/**
 * Loads reCAPTCHA v3 and mints a token at submit time.
 *
 * The script is injected from an effect rather than the page head, so the
 * request to google.com happens only once someone opens the intake form —
 * `ReportIntakeSection` mounts `ReportForm` lazily, and a citizen who never
 * files a report never calls Google. That is the same bargain the satellite
 * basemap makes: no third-party request until the feature is actually used.
 *
 * A v3 token expires after about two minutes, which is why nothing is fetched
 * on mount and `executeRecaptcha` is called from the submit handler instead.
 *
 * It never throws and never rejects. A blocked script, an ad blocker, or a
 * slow network resolves to `""`, and the server decides what an absent token
 * means — the failure mode belongs there, where it cannot be edited away by
 * the sender.
 */
export function useRecaptcha(): () => Promise<string> {
  const loaded = useRef(false);

  useEffect(() => {
    if (!RECAPTCHA_ENABLED || loaded.current) return;
    loaded.current = true;
    if (document.getElementById(SCRIPT_ID)) return;

    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(RECAPTCHA_SITE_KEY)}`;
    script.async = true;
    document.head.appendChild(script);
    // Left in place deliberately: the form remounts on "ส่งรายงานอีกฉบับ", and
    // re-downloading grecaptcha on every remount would be pure waste.
  }, []);

  return useCallback(async () => {
    if (!RECAPTCHA_ENABLED) return "";
    try {
      return await Promise.race([
        new Promise<string>((resolve) => {
          const grecaptcha = window.grecaptcha;
          if (!grecaptcha) {
            resolve("");
            return;
          }
          grecaptcha.ready(() => {
            grecaptcha
              .execute(RECAPTCHA_SITE_KEY, { action: RECAPTCHA_ACTION })
              .then(resolve)
              .catch(() => resolve(""));
          });
        }),
        new Promise<string>((resolve) => setTimeout(() => resolve(""), EXECUTE_TIMEOUT_MS)),
      ]);
    } catch {
      return "";
    }
  }, []);
}
