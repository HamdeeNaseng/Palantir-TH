import { expect, test, type Page } from "@playwright/test";

/**
 * The prediction panel at phone width.
 *
 * Named to match `MOBILE_SPECS` in `playwright.config.ts` (`/…|responsive/`),
 * which is what puts it in the `mobile` project and keeps it out of `desktop` —
 * every assertion here is about the 393 px layout.
 *
 * The panel shares the bottom sheet with the ranked-areas list and has to clear
 * MapLibre's attribution, which wraps to two lines at this width. Both of those
 * squeeze it from opposite ends, and the thing that gets squeezed out first is
 * the caveat at the bottom — so that is what is asserted.
 */

async function openPredictionPanel(page: Page): Promise<boolean> {
  await page.goto("/map");
  await expect(page.getByText("ความหนาแน่นรายพื้นที่")).toBeAttached({ timeout: 60_000 });

  // The layer list is a client-side toggle; a click before hydration is a
  // no-op, so retry until the list is actually open.
  const opener = page.getByRole("button", { name: /ตัวเลือกแผนที่/ });
  const checkbox = page
    .locator('label:has-text("ช่องทางคาดการณ์") input[type="checkbox"]')
    .first();
  await expect(async () => {
    if (!(await checkbox.isVisible())) await opener.click({ timeout: 5_000 });
    expect(await checkbox.isVisible()).toBe(true);
  }).toPass({ timeout: 60_000 });

  const bundle = page.waitForResponse((r) => r.url().includes("/api/flow/prediction"), {
    timeout: 60_000,
  });
  await checkbox.click();
  const payload = await (await bundle).json();
  if (payload.unavailable) return false;

  await page.getByText("คาดการณ์พื้นที่ถัดไป").click();
  await expect(page.getByText("แม่นยำ 3 อันดับแรก")).toBeVisible();
  return true;
}

test("แผงคาดการณ์เปิดได้บนมือถือโดยหน้าไม่ล้นด้านข้าง", async ({ page }) => {
  test.skip(!(await openPredictionPanel(page)), "no model run to read");

  await expect(page.getByText(/ไม่ใช่เส้นทางเดินทางของบุคคล/)).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test("คำเตือนท้ายแผงไม่ถูกแถบ attribution บัง", async ({ page }) => {
  test.skip(!(await openPredictionPanel(page)), "no model run to read");

  // Close the layer list so it is not the thing covering the caveat.
  await page.getByRole("button", { name: /ตัวเลือกแผนที่/ }).click();
  await expect(page.getByText("ความหนาแน่นรายพื้นที่")).toBeHidden();

  const caveat = await page.getByText(/ความละเอียดระดับอำเภอ/).boundingBox();
  expect(caveat).not.toBeNull();

  const viewport = page.viewportSize();
  expect(caveat!.y + caveat!.height).toBeLessThanOrEqual(viewport!.height);

  const attribution = await page.locator(".maplibregl-ctrl-attrib").first().boundingBox();
  if (attribution) {
    expect(caveat!.y + caveat!.height).toBeLessThanOrEqual(attribution.y + 1);
  }
});
