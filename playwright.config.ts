import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests, which exist for one thing the other checks cannot reach:
 * the browser APIs. `tsc` proves the pin code compiles and the unit-level
 * geometry can be exercised in Node, but neither can answer whether a
 * permission prompt, a `navigator.geolocation` fix, a WebGL canvas and a
 * dragged marker actually combine into a usable report on a phone.
 *
 * The two projects are not the same suite at two sizes. `desktop` runs
 * everything. `mobile` runs only the citizen intake, because that is the only
 * surface this app claims works on a phone — the analyst pages are declared
 * desktop-only in their own layouts (`min-w-[900px]` and up), and asserting a
 * dense dashboard at 393 px would be testing a promise nobody made.
 */
const CITIZEN_SPECS = /report-.*\.spec\.ts/;

const PORT = Number(process.env.E2E_PORT) || 3100;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
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
    { name: "mobile", use: { ...devices["Pixel 5"] }, testMatch: CITIZEN_SPECS },
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
