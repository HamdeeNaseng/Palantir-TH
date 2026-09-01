import { expect, test, type Page } from "@playwright/test";

/**
 * `/cases` and `/report` apply each filter change as it is made — the same
 * promise `/investigate` and `/events` make in `events-live-filter.spec.ts`.
 *
 * The register keeps that promise differently, and that is what these tests
 * are really about. The consoles filter a dataset the browser already holds,
 * so a change is free; the register's rows, counts and facets all come from a
 * MongoDB aggregation, so a change is a round trip. Live filtering is only an
 * improvement there if two things hold, and neither is visible to `tsc`:
 *
 *   1. A tick with no button press reaches the table, and lands in the URL so
 *      the narrowed view stays shareable.
 *   2. A run of ticks is one act of filtering — one query, one history entry —
 *      rather than one of each per checkbox.
 */

/**
 * Sequential within this file, parallel with every other file.
 *
 * Each test here asks `next dev` for a fresh 10,000-document aggregation, and
 * three of those at once behind a first-hit route compile takes longer than
 * any assertion timeout worth writing. Serialising them makes the suite both
 * faster and honest: what is being measured is the filtering, not how many
 * copies of the register the dev server can build at once.
 */
test.describe.configure({ timeout: 180_000, mode: "default" });

const SIDEBAR = 'aside[aria-label="ตัวกรองเคส"]';
const ROW = `${SIDEBAR} label.filter-row`;

/** Must match `DEBOUNCE_MS` in `src/lib/use-live-case-filters.ts`. */
const DEBOUNCE_MS = 400;

const sidebar = (page: Page) => page.locator(SIDEBAR).first();

/**
 * "N จาก M รายการ" — the matched total above the table.
 *
 * Scoped to `main`, because the sidebar's own `p.num` ("บันทึกครอบคลุม
 * 2002-11-22 ถึง 2026-08-29") comes first in the document and reads back as a
 * sixteen-digit number that never changes.
 */
async function matched(page: Page): Promise<number> {
  const text = (await page.getByRole("main").locator("p.num").first().textContent()) ?? "";
  return Number((text.split("จาก")[0] ?? "").replace(/[^\d]/g, ""));
}

/**
 * Wait until React has claimed the sidebar.
 *
 * Not pedantry. The checkboxes are in the server-rendered HTML from the first
 * byte, so a click can land before hydration: the browser toggles the box
 * natively, no handler runs, and React resets it when it takes over. The tick
 * is simply gone — and it fails as "the filter did not apply", which points at
 * the feature rather than at the harness that clicked too early. A React fiber
 * key on the input is the direct signal that a handler is attached.
 */
async function waitForHydration(page: Page) {
  await page.waitForFunction(
    (sel) => {
      const input = document.querySelector(`${sel} input`);
      return !!input && Object.keys(input).some((k) => k.startsWith("__reactFiber$"));
    },
    SIDEBAR,
    { timeout: 60_000 },
  );
}

/** The register is server-rendered; nothing is worth ticking until it has rows. */
async function waitForRows(page: Page): Promise<number> {
  await expect.poll(() => matched(page), { timeout: 60_000 }).toBeGreaterThan(0);
  await waitForHydration(page);
  return matched(page);
}

async function tickProvince(page: Page, name: string) {
  await sidebar(page)
    .locator("label.filter-row")
    .filter({ hasText: name })
    .first()
    .locator("input")
    .click();
}

/**
 * Tick several provinces in one run, and report the widest gap between them.
 *
 * Driven from inside the page rather than through Playwright clicks, because
 * the burst window is wall-clock: actionability checks against a `next dev`
 * serving three workers at once routinely put more than a second between two
 * clicks, and a second between two ticks genuinely *is* two acts of filtering.
 * The test would be measuring the machine's load rather than the coalescing.
 *
 * Each tick waits for React to have *committed* the previous one rather than
 * sleeping a fixed amount. A checkbox computes its next value from the filters
 * it was rendered with, so clicking again before React has re-rendered would
 * overwrite the previous tick instead of adding to it — the same
 * discrete-event assumption `useFilterDraft` documents upstream, which no hand
 * can violate but a loop can.
 *
 * The commit is read off `__reactProps$`, not off `input.checked`. A click
 * flips a checkbox natively before any handler runs, so the DOM says "ticked"
 * whether or not React ever heard about it; the props React last committed for
 * that node are the only honest answer.
 *
 * The click goes to the row, never to the input inside it. Every filter row is
 * a `<label>` wrapping its checkbox, and a scripted click on the input is
 * forwarded back to it by the label's own activation behaviour — two toggles,
 * net nothing, and a tick that vanishes without a trace. A real pointer (and
 * therefore `tickProvince` below) does not have this problem.
 *
 * The gap is returned rather than asserted on: a dev-mode re-render can take
 * longer than the debounce, and the caller decides what that means.
 */
async function tickProvincesInBurst(page: Page, names: string[]): Promise<number> {
  return page.evaluate(
    async ({ rowSel, wanted }) => {
      /** What React last committed for this input, as opposed to what the browser did to it. */
      const committedChecked = (input: Element): boolean => {
        const key = Object.keys(input).find((k) => k.startsWith("__reactProps$"));
        return Boolean(key && (input as unknown as Record<string, { checked?: boolean }>)[key]?.checked);
      };
      let widestGap = 0;

      for (const name of wanted) {
        const row = [...document.querySelectorAll(rowSel)].find((r) =>
          (r.textContent ?? "").includes(name),
        );
        const input = row?.querySelector("input");
        if (!row || !input) throw new Error(`no filter row for ${name}`);
        (row as HTMLElement).click();

        const startedAt = performance.now();
        // Generous, and fatal when it runs out: giving up here and clicking the
        // next box would silently overwrite this tick with a stale render, and
        // the test would then report the *product* as having lost a filter.
        while (!committedChecked(input) && performance.now() - startedAt < 30_000) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        if (!committedChecked(input)) {
          throw new Error(`React never committed the tick on ${name} — the page is wedged, not slow`);
        }
        widestGap = Math.max(widestGap, performance.now() - startedAt);
      }
      return widestGap;
    },
    { rowSel: ROW, wanted: names },
  );
}

test("a filter change narrows the register with no button press", async ({ page }) => {
  await page.goto("/cases");

  await expect(
    page.getByRole("button", { name: "ใช้ตัวกรอง" }),
    "a live sidebar must not also offer a button that claims to apply",
  ).toHaveCount(0);

  const before = await waitForRows(page);

  await tickProvince(page, "ปัตตานี");

  await expect(page).toHaveURL(/[?&]prov=/, { timeout: 60_000 });
  await expect.poll(() => matched(page), { timeout: 90_000 }).toBeLessThan(before);
});

test("a burst of ticks is one query and one press of Back", async ({ page }) => {
  await page.goto("/cases");
  await waitForRows(page);

  const gap = await tickProvincesInBurst(page, ["ปัตตานี", "ยะลา"]);

  // Asserted on the URL rather than on the table. That the rows follow a live
  // change is the previous test's job; this one is about how many navigations
  // and history entries two ticks produce, and pulling a second 10k-document
  // aggregation into it only makes it a slow way to re-test the first thing.
  //
  // Both ticks reach the URL either way; only the *coalescing* depends on them
  // having landed inside one debounce window, so that is what is skipped —
  // rather than silently weakened — when the machine is too slow to qualify.
  await expect(page).toHaveURL(/[?&]prov=pattani%2Cyala/, { timeout: 60_000 });

  test.skip(
    gap > DEBOUNCE_MS,
    `ticks landed ${Math.round(gap)}ms apart, wider than the ${DEBOUNCE_MS}ms debounce — ` +
      "on this machine that is legitimately two acts of filtering, not one",
  );

  // One act of filtering, one entry: a single Back is the whole register again.
  await page.goBack();
  await expect(page).not.toHaveURL(/[?&]prov=/);
});

test("/report offers the whole vocabulary, not just what has been reported", async ({ page }) => {
  await page.goto("/report");
  await waitForHydration(page);
  const aside = sidebar(page);

  // The register is small and starts empty, so facet-derived options left this
  // sidebar with a date range and nothing else — no province, no type, no
  // status, on a page whose form can file all three. `/investigate` states its
  // vocabulary rather than discovering it, and so does this now: an option
  // nobody has used reads 0 instead of vanishing.
  for (const section of ["จังหวัด", "ประเภทเหตุ", "สถานะการยืนยัน"]) {
    await expect(aside.getByRole("heading", { name: section })).toBeVisible();
  }
  for (const province of ["ปัตตานี", "ยะลา", "นราธิวาส", "สงขลา"]) {
    await expect(aside.locator("label.filter-row").filter({ hasText: province })).toHaveCount(1);
  }
  // All seventeen EVENT_TYPES, the same set the intake form offers.
  await expect(aside.locator("button.chip")).toHaveCount(17);
  for (const status of ["ยืนยันแล้ว", "อยู่ระหว่างตรวจสอบ", "ยังไม่สามารถยืนยันได้"]) {
    await expect(aside.locator("label.filter-row").filter({ hasText: status })).toHaveCount(1);
  }

  // And they filter: a province that nothing matches is still a filter, and
  // has to reach the URL like any other.
  await aside.locator("label.filter-row").filter({ hasText: "ยะลา" }).first().locator("input").click();
  await expect(page).toHaveURL(/[?&]prov=yala/, { timeout: 60_000 });
});

test("the same live sidebar filters /report", async ({ page }) => {
  await page.goto("/report");
  await waitForHydration(page);

  await expect(page.getByRole("button", { name: "ใช้ตัวกรอง" })).toHaveCount(0);

  // The citizen register can legitimately be empty, so what is asserted here
  // is the mechanism — the tick reaches the URL by itself — not a row count
  // that depends on someone having filed a report.
  const media = sidebar(page).getByRole("checkbox", { name: /เฉพาะที่มีหลักฐานแนบ/ });
  await sidebar(page).getByText(/เฉพาะที่มีหลักฐานแนบ/).click();
  await expect(media).toBeChecked();
  await expect(page).toHaveURL(/[?&]media=1/, { timeout: 60_000 });
});
