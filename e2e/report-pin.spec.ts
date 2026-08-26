import { expect, test, type Page } from "@playwright/test";

/**
 * The citizen pin flow at `/report`.
 *
 * These tests assert behaviour that only exists in a real browser: the
 * geolocation permission, the fix that comes back from it, the WebGL map that
 * hit-tests the pin against DDPM polygons, and the marker drag. None of it is
 * reachable from `tsc` or from a Node script.
 *
 * No MongoDB is required. The intake form renders and the pin resolves without
 * a database — only the final submit needs one, which is why these stop short
 * of pressing "ส่งรายงาน".
 */

/** อ.เมืองปัตตานี, comfortably inside the district rather than near an edge. */
const MUEANG_PATTANI = { longitude: 101.2537, latitude: 6.8698 };

/** What the ~110 m grid in `REPORT_PIN` rounds the fix above to. */
const SNAPPED_READOUT = "6.870, 101.254";

/**
 * Opens the intake form and waits for the map to be usable.
 *
 * The GPS button stays disabled until react-map-gl has loaded maplibre and
 * fetched the boundary polygons, because nothing can be hit-tested before
 * then. Waiting for it to enable is therefore both the correct way to
 * synchronise and an assertion that the readiness gate exists at all.
 */
async function openIntakeForm(page: Page) {
  await page.goto("/report");
  await page.getByRole("button", { name: /แจ้งเหตุการณ์ใหม่/ }).click();
  await expect(page.getByRole("button", { name: /ใช้ตำแหน่งปัจจุบัน/ })).toBeEnabled({
    timeout: 30_000,
  });
}

test.describe("ปักหมุดด้วย GPS", () => {
  test.use({ permissions: ["geolocation"], geolocation: MUEANG_PATTANI });

  test("อ่านอำเภอจากหมุด และปัดพิกัดลงตาราง ~110 ม.", async ({ page }) => {
    await openIntakeForm(page);
    await page.getByRole("button", { name: /ใช้ตำแหน่งปัจจุบัน/ }).click();

    // Resolved from the rendered polygons, not from anything the browser sent.
    await expect(page.getByText("อ.เมืองปัตตานี จ.ปัตตานี")).toBeVisible({ timeout: 20_000 });

    // The coordinate the citizen is shown is the one that will be stored: three
    // decimals, never the metre-accurate fix the device handed over.
    await expect(page.getByText(SNAPPED_READOUT)).toBeVisible();
    await expect(page.locator('input[name="pinLat"]')).toHaveValue("6.87");
    await expect(page.locator('input[name="pinLng"]')).toHaveValue("101.254");
    await expect(page.locator('input[name="pinSource"]')).toHaveValue("gps");

    // A pin answers the จังหวัด/อำเภอ question, so the selects stand down and
    // hidden inputs carry the pin's own answer instead.
    await expect(page.locator('select[name="provinceCode"]')).toHaveCount(0);
    await expect(page.locator('input[name="provinceCode"]')).toHaveValue("pattani");
    await expect(page.locator('input[name="districtCode"]')).toHaveValue("9401");
  });

  test("ระบุถึงระดับตำบล และไม่อ้างชื่อหมู่บ้านที่อยู่ไกลเกินไป", async ({ page }) => {
    await openIntakeForm(page);
    await page.getByRole("button", { name: /ใช้ตำแหน่งปัจจุบัน/ }).click();
    await expect(page.getByText("อ.เมืองปัตตานี จ.ปัตตานี")).toBeVisible({ timeout: 20_000 });

    // ตำบล arrives a beat later: its polygons are ~780 KB and are not fetched
    // until a pin exists, so this asserts the second phase actually lands.
    await expect(page.getByText("ต.อาเนาะรู")).toBeVisible({ timeout: 30_000 });

    // The ตำบล the polygons give is the one the form submits — no text box.
    await expect(page.locator('input[name="subdistrict"]')).toHaveCount(0);

    // The nearest mapped หมู่บ้าน to this point is บ้านยูโย, 2.1 km away —
    // past the threshold, so no village is named. OSM has roughly a fifth of
    // the villages in these provinces, and naming the nearest one regardless
    // would put a landmark on the wrong side of a ตำบล.
    await expect(page.getByText(/ใกล้บ้าน/)).toHaveCount(0);
  });

  test("ลากหมุดแล้วค่าความแม่นยำของ GPS ถูกทิ้ง", async ({ page }) => {
    await openIntakeForm(page);
    await page.getByRole("button", { name: /ใช้ตำแหน่งปัจจุบัน/ }).click();
    await expect(page.getByText("อ.เมืองปัตตานี จ.ปัตตานี")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/จาก GPS ±/)).toBeVisible();

    const marker = page.locator(".maplibregl-marker").first();
    const box = await marker.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    // ~130 m at the zoom the GPS fix leaves the map on: far enough to move the
    // pin, well short of leaving อ.เมืองปัตตานี.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2 + 20, { steps: 8 });
    await page.mouse.up();

    // Once a human has placed it, the device's error estimate no longer
    // describes the point, so it is dropped rather than carried forward.
    await expect(page.getByText("ปักเอง")).toBeVisible();
    await expect(page.getByText(/จาก GPS ±/)).toHaveCount(0);
    await expect(page.locator('input[name="pinSource"]')).toHaveValue("manual");
    await expect(page.locator('input[name="pinAccuracy"]')).toHaveCount(0);
  });

  test("ล้างหมุดแล้ว select จังหวัด/อำเภอ กลับมา", async ({ page }) => {
    await openIntakeForm(page);
    await page.getByRole("button", { name: /ใช้ตำแหน่งปัจจุบัน/ }).click();
    await expect(page.getByText("อ.เมืองปัตตานี จ.ปัตตานี")).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: /ล้างหมุด/ }).click();

    await expect(page.locator('select[name="provinceCode"]')).toBeVisible();
    await expect(page.locator('input[name="pinLat"]')).toHaveCount(0);
    await expect(page.getByText(/ถ้าไม่ปักหมุด/)).toBeVisible();
  });
});

test.describe("ไม่ได้รับสิทธิ์ตำแหน่ง", () => {
  test.use({ permissions: [] });

  test("บอกสาเหตุจริง และเสนอทางออกที่ใช้ได้", async ({ page }) => {
    await openIntakeForm(page);
    await page.getByRole("button", { name: /ใช้ตำแหน่งปัจจุบัน/ }).click();

    // The failure has to name the cause and leave a way forward — tapping the
    // map still works without any permission at all.
    await expect(page.getByText(/ไม่ได้รับอนุญาตให้เข้าถึงตำแหน่ง/)).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator('input[name="pinLat"]')).toHaveCount(0);
  });
});

test.describe("ภาพถ่ายดาวเทียม", () => {
  test("ปิดอยู่ตั้งแต่แรก และไม่ยิงไทล์จนกว่าจะเปิด", async ({ page }) => {
    const tileRequests: string[] = [];
    // The whole point of shipping the layer hidden: a page view costs the
    // third-party provider nothing until someone asks for it.
    await page.route("**://*.arcgisonline.com/**", (route) => {
      tileRequests.push(route.request().url());
      return route.abort();
    });
    await page.route("**://api.maptiler.com/**", (route) => {
      tileRequests.push(route.request().url());
      return route.abort();
    });

    await openIntakeForm(page);
    await page.waitForTimeout(1500);
    expect(tileRequests).toHaveLength(0);

    await page.getByRole("button", { name: /^ดาวเทียม$/ }).click();
    await expect.poll(() => tileRequests.length, { timeout: 15_000 }).toBeGreaterThan(0);
  });
});
