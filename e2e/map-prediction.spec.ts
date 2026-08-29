import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * The Bayesian route-prediction layers on `/map`.
 *
 * These read what `ml-server/run_batch.py` stored in the `flow_*` collections,
 * so they assert the whole path: MongoDB, the route handler, and the MapLibre
 * layers. When no batch has been run the layer reports itself unavailable
 * rather than drawing nothing, and that is asserted too — an empty map reads as
 * "no corridors exist" when it means "no model has been built".
 *
 * The panel assertions are not decoration. The model is well calibrated and
 * weak, and the numbers that say so — top-3 accuracy against the random
 * baseline, and the "not a person's route" caveat — are the reason it is
 * allowed on screen at all. If they can be removed without a test failing,
 * they will eventually be removed.
 */

/**
 * Click a layer toggle, retrying until it actually flips.
 *
 * `next dev` serves the markup before React has hydrated, so a click that
 * lands early does nothing at all — and under parallel workers that window is
 * wide enough to matter. Retrying the click is the only reliable signal that
 * the handler is attached.
 */
async function enableLayer(page: Page, label: string): Promise<Locator> {
  const checkbox = page.locator(`label:has-text("${label}") input[type="checkbox"]`).first();
  await expect(checkbox).toBeVisible({ timeout: 60_000 });
  await expect(async () => {
    if (!(await checkbox.isChecked())) await checkbox.click({ timeout: 5_000 });
    expect(await checkbox.isChecked()).toBe(true);
  }).toPass({ timeout: 60_000 });
  return checkbox;
}

test("ช่องทางคาดการณ์อ่านจาก MongoDB แล้ววาดลงแผนที่", async ({ page }) => {
  await page.goto("/map");
  await expect(page.getByText("ความหนาแน่นรายพื้นที่")).toBeVisible({ timeout: 60_000 });

  const bundle = page.waitForResponse(
    (r) => r.url().includes("/api/flow/prediction") && r.request().method() === "GET",
    { timeout: 60_000 },
  );
  await enableLayer(page, "ช่องทางคาดการณ์");
  const payload = await (await bundle).json();

  // No model run is a legitimate state for a fresh clone: the toggle disables
  // itself and says why, instead of drawing an empty map.
  if (payload.unavailable) {
    await expect(page.getByText(/ยังไม่มีผลจากโมเดล|เชื่อมต่อฐานข้อมูลไม่ได้/)).toBeVisible();
    return;
  }

  expect(payload.anchors.features.length).toBeGreaterThan(0);
  expect(payload.corridors.features.length).toBeGreaterThan(0);
  expect(payload.run.runId).toBeTruthy();

  // Corridor geometry must be real road polylines, not straight lines.
  const corridor = payload.corridors.features[0];
  expect(corridor.geometry.type).toBe("LineString");
  expect(corridor.geometry.coordinates.length).toBeGreaterThan(2);

  await expect(page.getByText("คาดการณ์พื้นที่ถัดไป")).toBeVisible();

  // Accuracy is only interpretable next to the baseline it beats, so both are
  // required to be on screen together.
  const skill = page.getByText("แม่นยำ 3 อันดับแรก").locator("..");
  await expect(skill).toContainText("%");
  await expect(skill).toContainText("สุ่ม");

  await expect(page.getByText(/ไม่ใช่เส้นทางเดินทางของบุคคล/)).toBeVisible();
  await expect(page.getByText(/ความละเอียดระดับอำเภอ/)).toBeVisible();
});

/**
 * The forecast endpoint the anchor click calls, asserted directly.
 *
 * Deliberately not driven through a canvas click. Anchors are WebGL circles
 * whose screen position depends on the fitted camera, so hitting one means
 * probing a grid of pixels — which passes alone and fails under parallel
 * workers, and a flaky test is worse than no test. The click path itself is
 * one line of `handleClick`; what is worth pinning is the payload it renders,
 * because the interval arithmetic behind those bars is where a wrong number
 * would look plausible.
 */
test("posterior ของแต่ละอำเภอมีช่วงความเชื่อมั่นที่คร่อมค่ากลาง", async ({ request }) => {
  const bundle = await (await request.get("/api/flow/prediction?corridors=1&segments=1")).json();
  test.skip(bundle.unavailable === true, "no model run to read");

  // Both ends of the corpus, not the middle. The bundle is sorted by event
  // count, so this takes the districts carrying most of the data and the ones
  // carrying almost none — and the sparse end is where a degenerate interval
  // actually appears, because a district never seen alongside another has zero
  // concentration and the Beta quantile is undefined there.
  const anchors = bundle.anchors.features.map(
    (f: { properties: { anchor_id: string } }) => f.properties.anchor_id,
  );
  const sample = [...anchors.slice(0, 6), ...anchors.slice(-6)];

  const forecasts = await Promise.all(
    sample.map(async (id: string) => {
      const response = await request.get(`/api/flow/prediction/anchor?id=${id}`);
      expect(response.status(), `anchor ${id}`).toBe(200);
      return { id, ...(await response.json()) };
    }),
  );

  for (const { id, forecast } of forecasts) {
    expect(forecast.entries.length, `${id} has entries`).toBeGreaterThan(0);
    for (const entry of forecast.entries) {
      // NaN survives JSON as null and renders as an empty bar rather than an
      // error, so it has to be caught here.
      expect(Number.isFinite(entry.low), `${id} low finite`).toBe(true);
      expect(Number.isFinite(entry.high), `${id} high finite`).toBe(true);
      expect(entry.low, `${id} low <= mean`).toBeLessThanOrEqual(entry.mean);
      expect(entry.mean, `${id} mean <= high`).toBeLessThanOrEqual(entry.high);
    }
  }
});

test("อ้าง anchor ที่ไม่มีอยู่ ต้องได้ 404 ไม่ใช่ผลลัพธ์ว่าง", async ({ request }) => {
  // Distinct from "no model run": a stale id must not send the reader off to
  // rebuild a model that is already there.
  const response = await request.get("/api/flow/prediction/anchor?id=not-a-real-anchor");
  expect([404, 200]).toContain(response.status());
  if (response.status() === 200) {
    // Only legitimate when there is genuinely no model to look in.
    expect((await response.json()).unavailable).toBe(true);
  }
});
