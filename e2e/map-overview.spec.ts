import { expect, test, type Page } from "@playwright/test";

/**
 * `/map` — the area-density overview.
 *
 * Assertions are about structure and behaviour, never about counts: the
 * numbers come from whatever is in MongoDB on the machine running this, and a
 * test that hard-codes "3,668" fails for the wrong reason the moment someone
 * re-seeds. Where a check genuinely needs data, it asks first.
 */

async function openMap(page: Page) {
  await page.goto("/map");
  await expect(page.getByText("หน่วยพื้นที่")).toBeVisible({ timeout: 30_000 });
}

/** True when MongoDB is unreachable, so the page has nothing to rank. */
async function isOffline(page: Page): Promise<boolean> {
  return (await page.getByText(/ยังเชื่อมต่อ MongoDB ไม่ได้/).count()) > 0;
}

test("หน่วยพื้นที่สลับได้ครบสามระดับ และหัวตารางเปลี่ยนตาม", async ({ page }) => {
  await openMap(page);

  // Opens on the whole-area view: จังหวัด is the only level whose areas are
  // legible at four-province zoom.
  await expect(page.getByText("จังหวัดที่มีเหตุการณ์มากที่สุด")).toBeVisible();

  await page.getByRole("button", { name: "อำเภอ", exact: true }).click();
  await expect(page.getByText("อำเภอที่มีเหตุการณ์มากที่สุด")).toBeVisible();

  // ตำบล pulls a ~780 KB source that no other level needs, so this also
  // exercises the lazy mount.
  await page.getByRole("button", { name: "ตำบล", exact: true }).click();
  await expect(page.getByText("ตำบลที่มีเหตุการณ์มากที่สุด")).toBeVisible({ timeout: 30_000 });
});

test("ระดับพื้นที่ที่ไม่มีข้อมูลจะไม่ถูกระบายสี — ระบุไว้ในคำอธิบายสเกล", async ({ page }) => {
  await openMap(page);
  await expect(page.getByText("พื้นที่ที่ไม่มีเหตุการณ์จะไม่ถูกระบายสี")).toBeVisible();
});

test("กดพื้นที่ในอันดับแล้วซูมเข้าไปหาพื้นที่นั้น", async ({ page }) => {
  await openMap(page);
  test.skip(await isOffline(page), "ไม่มีฐานข้อมูล จึงไม่มีอันดับให้กด");

  // Enabled, not merely visible: the rows are server-rendered and readable
  // before the map instance exists, and only the map can act on a click.
  const firstArea = page.locator("ul button").first();
  await expect(firstArea).toBeEnabled({ timeout: 30_000 });
  const name = (await firstArea.locator("span").first().innerText()).trim();

  await firstArea.click();

  // Framing one จังหวัด necessarily zooms past the อำเภอ break, so the level
  // selector on อัตโนมัติ follows it down — which is the behaviour the page is
  // built around, not a side effect.
  await expect(page.getByText("อำเภอที่มีเหตุการณ์มากที่สุด")).toBeVisible({ timeout: 20_000 });
  expect(name.length).toBeGreaterThan(0);
});

test("จุดเหตุการณ์ปิดอยู่ตั้งแต่แรก และเปิดได้", async ({ page }) => {
  await openMap(page);

  // Off by default: at this zoom the dots are a smear, and the choropleth is
  // the thing that answers the question.
  const dots = page.getByRole("checkbox", { name: /จุดเหตุการณ์/ });
  await expect(dots).not.toBeChecked();
  await dots.check();
  await expect(dots).toBeChecked();
});

test("ไม่ยิงไทล์ดาวเทียมจนกว่าจะเปิด", async ({ page }) => {
  const tiles: string[] = [];
  await page.route("**://*.arcgisonline.com/**", (route) => {
    tiles.push(route.request().url());
    return route.abort();
  });
  await page.route("**://api.maptiler.com/**", (route) => {
    tiles.push(route.request().url());
    return route.abort();
  });

  await openMap(page);
  await page.waitForTimeout(1500);
  expect(tiles).toHaveLength(0);

  await page.getByRole("checkbox", { name: /ภาพถ่ายดาวเทียม/ }).check();
  await expect.poll(() => tiles.length, { timeout: 15_000 }).toBeGreaterThan(0);
});
