import { expect, test } from "@playwright/test";

/**
 * `/network` — the response network list and map.
 *
 * Asserts what only a browser can answer: that the fetched layer reaches the
 * page, that filtering narrows the list, that selecting a facility offers the
 * emergency line for its kind, and that its own page opens with the record
 * loaded into an editable form. Deliberately read-only: the status, edit and
 * coordination writes need MongoDB, and this suite runs without one.
 */

test("รายการมาจากชั้นข้อมูลจริง และกรองตามประเภทได้", async ({ page }) => {
  await page.goto("/network");
  await expect(page.getByRole("heading", { name: "เครือข่ายตอบสนอง" })).toBeVisible();

  const rows = page.locator("tbody tr");
  const all = await rows.count();
  expect(all).toBeGreaterThan(50);

  // The kind filter carries its own count; the list must agree with it.
  const hospitalRow = page.locator("label.filter-row").filter({ hasText: "โรงพยาบาล" });
  const hospitalCount = Number((await hospitalRow.locator("span.num").innerText()).replace(/,/g, ""));
  await hospitalRow.locator("input[type=checkbox]").check();
  await expect.poll(() => rows.count()).toBe(hospitalCount);
  expect(hospitalCount).toBeLessThan(all);
});

test("เลือกสถานที่แล้วได้เบอร์ฉุกเฉินตามประเภท", async ({ page }) => {
  await page.goto("/network");
  await expect(page.getByRole("heading", { name: "เครือข่ายตอบสนอง" })).toBeVisible();

  // สถานีตำรวจ → 191, the routing answer for that kind of incident.
  await page.locator("label.filter-row").filter({ hasText: "สถานีตำรวจ" }).locator("input").check();
  await page.locator("tbody tr").first().click();

  await expect(page.getByRole("link", { name: /191/ }).first()).toBeVisible();
  await expect(page.getByText("ติดต่อประสานงาน")).toBeVisible();
  await expect(page.getByRole("button", { name: "เปิดทำการ" })).toBeVisible();
});

test("เปิดหน้าเฉพาะของสถานที่ พร้อมฟอร์มแก้ไขที่กรอกค่าปัจจุบันไว้", async ({ page }) => {
  await page.goto("/network");
  await page.locator("label.filter-row").filter({ hasText: "สถานีดับเพลิง" }).locator("input").check();

  const firstName = await page.locator("tbody tr").first().locator("td").first().innerText();
  await page.locator("tbody tr").first().click();
  await page.getByRole("link", { name: /เปิดหน้าข้อมูลเต็ม/ }).click();

  await page.waitForURL(/\/network\/.+/);
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toBeVisible();

  // The page opened is the row that was clicked, not whatever was first.
  expect(firstName).toContain((await heading.innerText()).trim());

  // The form starts at what the record says — an edit is a correction to a
  // value, never a blank slate.
  await expect(page.getByLabel("ชื่อสถานที่")).toHaveValue((await heading.innerText()).trim());
  await expect(page.getByRole("button", { name: /บันทึกการแก้ไข/ })).toBeEnabled();
  await expect(page.getByRole("link", { name: /199/ }).first()).toBeVisible();

  // Back to the list it came from.
  await page.getByRole("link", { name: /เครือข่ายตอบสนอง/ }).click();
  await page.waitForURL(/\/network$/);
});

test("id ที่ไม่มีอยู่จริงตอบ 404", async ({ page }) => {
  const res = await page.goto("/network/osm_node_0");
  expect(res?.status()).toBe(404);
});

test("ย้อนเวลาได้ และบอกตรง ๆ ว่ามีกี่แห่งที่ไม่ทราบช่วงเวลา", async ({ page }) => {
  await page.goto("/network");
  const rows = page.locator("tbody tr");
  const all = await rows.count();

  /*
   * Cleared before every attempt, and retried.
   *
   * The list is server-rendered, so a `fill` can land before hydration: the
   * DOM value is set, no React handler exists yet, and — the part that makes
   * a plain retry useless — React initialises its value tracker from that
   * same DOM value when it hydrates. Filling the identical string again is
   * then a no-op that fires no `change` at all. Clearing first is what gives
   * the next fill something to differ from.
   */
  const asOfInput = page.getByLabel("ดูเครือข่าย ณ วันที่");
  await expect(async () => {
    await asOfInput.fill("");
    await asOfInput.fill("2010-01-01");
    await expect(page.getByText(/กำลังดูเครือข่าย ณ/)).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });

  /*
   * Nothing in the fetched layer carries a founding date — OpenStreetMap has
   * none for these four provinces — so every record is "ไม่ทราบช่วงเวลา" and
   * the list must be unchanged. A historical view that silently dropped the
   * undated ones would show an empty map for 2010 and read as a finding.
   */
  await expect.poll(() => rows.count()).toBe(all);

  // Narrowing to what is actually evidenced is the honest way to see that.
  await page.getByText("เฉพาะที่มีวันที่บันทึกไว้").click();
  await expect(page.getByText("ไม่พบสถานที่ที่ตรงกับตัวกรอง")).toBeVisible();
});

test("ลากหมุดบนแผนที่เพื่อแก้พิกัด และย้อนกลับได้", async ({ page }) => {
  await page.goto("/network");
  await page.locator("label.filter-row").filter({ hasText: "สถานีดับเพลิง" }).locator("input").check();
  await page.locator("tbody tr").first().click();
  await page.getByRole("link", { name: /เปิดหน้าข้อมูลเต็ม/ }).click();
  await page.waitForURL(/\/network\/.+/);

  const lng = page.getByLabel(/ลองจิจูด/);
  const lat = page.getByLabel(/ละติจูด/);
  const before = { lng: await lng.inputValue(), lat: await lat.inputValue() };

  // Read-only until asked: no marker exists to drag.
  await expect(page.getByRole("button", { name: "Map marker" })).toHaveCount(0);

  const toggle = page.getByRole("button", { name: /แก้ตำแหน่งด้วยการลากหมุด/ });
  await expect(toggle).toBeVisible({ timeout: 60_000 });
  await toggle.click();

  const marker = page.getByRole("button", { name: "Map marker" });
  await expect(marker).toBeVisible({ timeout: 60_000 });
  const box = await marker.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;

  await marker.hover();
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 10 });
  await page.mouse.up();

  // The typed fields and the pin are one value, not two that can disagree.
  await expect.poll(() => lng.inputValue()).not.toBe(before.lng);
  await expect(page.getByText(/ย้ายแล้ว/)).toBeVisible();

  // Nothing is written until the save button; undo puts it back exactly.
  await page.getByRole("button", { name: /คืนตำแหน่งเดิม/ }).click();
  await expect(lng).toHaveValue(before.lng);
  await expect(lat).toHaveValue(before.lat);
});
