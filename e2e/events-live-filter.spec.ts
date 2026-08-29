import { expect, test, type Page } from "@playwright/test";

/**
 * `/events` applies each filter change as it is made.
 *
 * That is only affordable because the dataset is already in the browser (see
 * `local-filtering.spec.ts`): a filter change costs one pass over the cached
 * snapshot, not a MongoDB read, so there is no round trip worth making the
 * analyst batch their changes to avoid.
 *
 * Two things have to hold for that to be an improvement rather than a
 * regression, and neither is visible to the type checker:
 *
 *   1. A change with no button press actually reaches the dashboard.
 *   2. It does not shred the Back button. `pushState` per interaction would
 *      bury the page the analyst arrived from under a dozen near-identical
 *      filter states, so entries are coalesced per burst of activity.
 */

test.describe.configure({ timeout: 120_000 });

async function waitForLocalDataset(page: Page) {
  await expect(page.getByText("กรองจากข้อมูลในเครื่อง")).toBeVisible({ timeout: 60_000 });
}

async function untickProvince(page: Page, name: string) {
  await page
    .locator('aside[aria-label="ตัวกรองเหตุการณ์"]')
    .first()
    .locator("label.filter-row")
    .filter({ hasText: name })
    .first()
    .locator("input")
    .click();
}

/** "เหตุการณ์ทั้งหมด" — `totalMatched`. */
async function kpiTotal(page: Page): Promise<number> {
  const card = page.locator("article").filter({ hasText: "เหตุการณ์ที่ตรงกับตัวกรอง" }).first();
  const text = (await card.locator("p.num").first().textContent()) ?? "";
  return Number(text.replace(/[^\d]/g, ""));
}

test("a filter change reaches the dashboard with no button press", async ({ page }) => {
  await page.goto("/events");
  await waitForLocalDataset(page);

  await expect(
    page.getByRole("button", { name: "ใช้ตัวกรอง" }),
    "a live sidebar must not also offer a button that claims to apply",
  ).toHaveCount(0);

  const before = await kpiTotal(page);
  expect(before).toBeGreaterThan(0);

  await untickProvince(page, "ปัตตานี");

  await expect.poll(() => kpiTotal(page), { timeout: 20_000 }).toBeLessThan(before);
  // Still shareable: the selection is in the URL, not only in React state.
  expect(page.url()).toContain("prov=");
});

test("one live change is one press of Back", async ({ page }) => {
  await page.goto("/events");
  await waitForLocalDataset(page);

  const unfilteredUrl = page.url();
  const unfilteredTotal = await kpiTotal(page);

  await untickProvince(page, "ปัตตานี");
  await expect.poll(() => kpiTotal(page), { timeout: 20_000 }).toBeLessThan(unfilteredTotal);

  // Deliberately longer than the burst window, so this is unambiguously a
  // second act of filtering and gets a history entry of its own.
  await page.waitForTimeout(1200);
  const afterFirst = await kpiTotal(page);
  await untickProvince(page, "ยะลา");
  await expect.poll(() => kpiTotal(page), { timeout: 20_000 }).toBeLessThan(afterFirst);

  await page.goBack();
  await expect.poll(() => kpiTotal(page), { timeout: 20_000 }).toBe(afterFirst);

  await page.goBack();
  await expect.poll(() => kpiTotal(page), { timeout: 20_000 }).toBe(unfilteredTotal);
  expect(page.url()).toBe(unfilteredUrl);
});
