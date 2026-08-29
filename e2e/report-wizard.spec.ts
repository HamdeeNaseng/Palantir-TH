import { expect, test, type Page } from "@playwright/test";

/**
 * The one-question-per-screen intake at `/report`.
 *
 * These cover what the wizard promises a citizen: it will not let them past a
 * question they have not answered, it shows them the whole report before
 * anything is sent, and — the regression this file exists for — it does not
 * file the report until they press the button that says so.
 *
 * No MongoDB is required: every test stops short of "ส่งรายงาน", the same
 * bargain `report-pin.spec.ts` makes.
 */

/** The card is a label around a visually-hidden radio; the click goes on the card. */
async function chooseType(page: Page, name: string) {
  await page.getByRole("radio", { name, exact: true }).locator("xpath=..").click();
}

async function openForm(page: Page) {
  await page.goto("/report");
  await page.getByRole("button", { name: /แจ้งเหตุการณ์ใหม่/ }).click();
  await expect(page.getByRole("heading", { name: "เกิดเรื่องอะไรขึ้น" })).toBeVisible();
}

test("ไม่ตอบก็ไปต่อไม่ได้ และบอกด้วยว่าต้องทำอะไร", async ({ page }) => {
  await openForm(page);

  await page.getByRole("button", { name: /ถัดไป/ }).click();
  await expect(page.getByText(/เลือกสักข้อก่อน/)).toBeVisible();
  // Still on the same question — a failed step must not advance.
  await expect(page.getByRole("heading", { name: "เกิดเรื่องอะไรขึ้น" })).toBeVisible();

  await chooseType(page, "อัคคีภัย");
  await page.getByRole("button", { name: /ถัดไป/ }).click();

  await page.getByRole("button", { name: /ถัดไป/ }).click();
  await expect(page.getByText(/บอกสั้น ๆ ว่าเกิดอะไรขึ้น/)).toBeVisible();
});

test("สรุปให้อ่านก่อนส่ง และแก้กลับไปที่คำถามเดิมได้", async ({ page }) => {
  await openForm(page);

  await chooseType(page, "อัคคีภัย");
  await page.getByRole("button", { name: /ถัดไป/ }).click();

  await page.getByLabel(/เกิดอะไรขึ้น/).fill("ไฟไหม้กองหญ้าข้างถนน");
  await page.getByRole("button", { name: /ถัดไป/ }).click();

  await expect(page.getByRole("button", { name: /ใช้ตำแหน่งปัจจุบัน/ })).toBeEnabled({
    timeout: 30_000,
  });
  await page.selectOption('select[name="provinceCode"]', "yala");
  await page.selectOption('select[name="districtCode"]', { index: 1 });
  await page.getByRole("button", { name: /ถัดไป/ }).click();

  // The two chips answer the hardest control on the form for most reporters.
  await page.getByRole("button", { name: "วันนี้" }).click();
  await page.getByRole("button", { name: /ถัดไป/ }).click();
  await page.getByRole("button", { name: /ข้ามไปหน้าสรุป/ }).click();

  await expect(page.getByRole("heading", { name: "ตรวจทานก่อนส่ง" })).toBeVisible();
  await expect(page.getByText("ไฟไหม้กองหญ้าข้างถนน")).toBeVisible();
  // Scoped to the summary list: the same word is on the (hidden) card in step 1.
  await expect(page.locator("dl").getByText("อัคคีภัย", { exact: true })).toBeVisible();

  // แก้ไข goes back to the question that owns the answer, not to the top.
  await page.getByRole("button", { name: /แก้ไข/ }).first().click();
  await expect(page.getByRole("heading", { name: "เกิดเรื่องอะไรขึ้น" })).toBeVisible();
  // And what was already answered is still answered — steps are hidden, never
  // rebuilt, so nothing typed is lost by stepping back.
  await expect(page.getByRole("radio", { name: "อัคคีภัย", exact: true })).toBeChecked();
});

test("ปุ่มไปหน้าสรุปไม่ใช่ปุ่มส่ง", async ({ page }) => {
  await openForm(page);

  await chooseType(page, "อัคคีภัย");
  await page.getByRole("button", { name: /ถัดไป/ }).click();
  await page.getByLabel(/เกิดอะไรขึ้น/).fill("ทดสอบว่ายังไม่ส่ง");
  await page.getByRole("button", { name: /ถัดไป/ }).click();
  await expect(page.getByRole("button", { name: /ใช้ตำแหน่งปัจจุบัน/ })).toBeEnabled({
    timeout: 30_000,
  });
  await page.selectOption('select[name="provinceCode"]', "yala");
  await page.selectOption('select[name="districtCode"]', { index: 1 });
  await page.getByRole("button", { name: /ถัดไป/ }).click();
  await page.getByRole("button", { name: "วันนี้" }).click();
  await page.getByRole("button", { name: /ถัดไป/ }).click();

  /*
   * The step before the review is the regression.
   *
   * React reuses one DOM node for "ถัดไป" and "ส่งรายงาน" unless they carry
   * different keys, and the swap happens during the very click that leaves the
   * last question — so the browser ran that click's default action against a
   * button that had already become a submit button, and the report filed
   * itself with the review screen never seen. Reaching the review with a
   * submit button that is idle is the whole assertion.
   */
  await page.getByRole("button", { name: /ข้ามไปหน้าสรุป/ }).click();
  await expect(page.getByRole("heading", { name: "ตรวจทานก่อนส่ง" })).toBeVisible();
  await expect(page.getByRole("button", { name: /ส่งรายงาน/ })).toBeEnabled();
  await expect(page.getByText(/รายงานนี้ถูกบันทึกไว้แล้ว/)).toHaveCount(0);
});
