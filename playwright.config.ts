import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests, which exist for one thing the other checks cannot reach:
 * the browser APIs. `tsc` proves the pin code compiles and the unit-level
 * geometry can be exercised in Node, but neither can answer whether a
 * permission prompt, a `navigator.geolocation` fix, a WebGL canvas and a
 * dragged marker actually combine into a usable report on a phone.
 *
 * The two projects are not the same suite at two sizes. `desktop` runs
 * everything. `mobile` runs the citizen intake plus `responsive.spec.ts`: the
 * analyst pages no longer declare themselves desktop-only (the `min-w-[1180px]`
 * floors are now `lg:` and the console stacks into one column below that), so
 * "does not fall apart at 393 px" became a promise worth holding them to.
 */
const MOBILE_SPECS = /(report-.*|responsive)\.spec\.ts/;

const PORT = Number(process.env.E2E_PORT) || 3100;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,

  /**
   * Well above Playwright's 30 s default, because these tests race a dev
   * server, not a build. `next dev` compiles a route the first time it is
   * asked for, and several parallel workers asking at once for pages that pull
   * ~1 MB of boundary polygons and a WebGL canvas will each wait behind the
   * others. At 30 s the suite passed only when a previous run had left
   * `.next-e2e/` warm — which is a suite that passes by luck.
   */
  timeout: 60_000,
  reporter: process.env.CI ? "github" : "list",

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    // The UI is Thai throughout, and several assertions read formatted dates
    // and numbers back out of it.
    locale: "th-TH",
    timezoneId: "Asia/Bangkok",
  },

  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 5"] }, testMatch: MOBILE_SPECS },
  ],

  webServer: {
    command: `npx next dev --port ${PORT}`,
    url: `${BASE_URL}/report`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    // A dist directory of its own: `next dev` opens `.next/trace` for writing,
    // and on Windows a second dev server sharing it dies with EPERM before it
    // serves a request. See the note in next.config.ts.
    env: { NEXT_DIST_DIR: ".next-e2e" },
  },
});
