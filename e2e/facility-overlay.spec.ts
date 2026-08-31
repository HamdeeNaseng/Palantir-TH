import { expect, test, type Page } from "@playwright/test";

/**
 * The response network as an overlay on the three consoles.
 *
 * `/network` owns the marks and `network.spec.ts` guards them there; this file
 * only asks the three questions that are new about carrying them elsewhere:
 * the data arrives without anyone asking for it, the toggle starts on, and the
 * key that makes nine glyphs readable comes and goes with the layer.
 *
 * The pins themselves are WebGL, so there is nothing in the DOM to assert
 * against. The legend is the honest proxy — it is rendered from the same
 * `showFacilities` the layers are, so the two cannot disagree.
 */

const PAGES = [
  { path: "/investigate", ready: "ชั้นข้อมูล" },
  { path: "/events", ready: "ชั้นข้อมูล" },
  { path: "/map", ready: "หน่วยพื้นที่" },
] as const;

/** Opens the layer list, which is a dropdown on two pages and a card on `/map`. */
async function openLayers(page: Page, path: string) {
  if (path === "/map") {
    // At desktop width the card is already open (`lg:block`).
    await expect(page.getByText("ชั้นข้อมูล")).toBeVisible();
    return;
  }
  await page.getByRole("button", { name: "ชั้นข้อมูล" }).click();
}

test("ชั้นข้อมูลหน่วยงานตอบกลับครบทุกฟิลด์ที่หมุดต้องใช้", async ({ request }) => {
  const res = await request.get("/api/facilities");
  expect(res.ok()).toBeTruthy();

  const body = await res.json();
  expect(Array.isArray(body.facilities)).toBe(true);
  expect(body.facilities.length).toBeGreaterThan(0);

  for (const f of body.facilities.slice(0, 20)) {
    expect(typeof f.id).toBe("string");
    expect(typeof f.kind).toBe("string");
    expect(typeof f.lng).toBe("number");
    expect(typeof f.lat).toBe("number");
    expect(["open", "closed", "unknown"]).toContain(f.status);
  }
});

for (const { path, ready } of PAGES) {
  test(`${path} — ดึงหน่วยงานเองตั้งแต่โหลด และเปิดชั้นข้อมูลไว้`, async ({ page }) => {
    // The overlay request queues behind the page's own payload, which on `/map`
    // is a whole-corpus area count compiled on first hit — with the rest of the
    // suite competing for the same dev server that is minutes, not seconds.
    test.slow();
    const fetched = page.waitForResponse("**/api/facilities", { timeout: 120_000 });
    await page.goto(path);
    await expect(page.getByText(ready).first()).toBeVisible({ timeout: 45_000 });

    // Nobody clicked anything: the layer is on by default, so the request is
    // the page's own doing.
    expect((await fetched).ok()).toBeTruthy();

    await openLayers(page, path);
    await expect(page.getByRole("checkbox", { name: /หน่วยงาน\/เครือข่าย/ })).toBeChecked();
  });

  test(`${path} — คำอธิบายสัญลักษณ์หน่วยงานตามการเปิดปิดชั้นข้อมูล`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByText(ready).first()).toBeVisible({ timeout: 45_000 });
    await openLayers(page, path);

    const toggle = page.getByRole("checkbox", { name: /หน่วยงาน\/เครือข่าย/ });
    const key = page.getByText("วงรอบ = สถานะ");

    // On the two consoles the key is folded into the existing legend rail, so
    // it has to be opened before it can be read.
    if (path !== "/map") {
      await page.getByRole("button", { name: "เครือข่ายตอบสนอง" }).click();
    }
    await expect(key).toBeVisible();

    await toggle.uncheck();
    await expect(key).toHaveCount(0);

    await toggle.check();
    if (path !== "/map") {
      await page.getByRole("button", { name: "เครือข่ายตอบสนอง" }).click();
    }
    await expect(key).toBeVisible();
  });
}

test("/investigate — คำอธิบายเหตุการณ์เดิมยังอยู่ครบหลังเพิ่มกลุ่มหน่วยงาน", async ({ page }) => {
  await page.goto("/investigate");
  await expect(page.getByText("ขอบเขตความคลาดเคลื่อน")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText("หมู่บ้าน (OSM)")).toBeVisible();
  await expect(page.getByRole("button", { name: "เครือข่ายตอบสนอง" })).toBeVisible();
});
