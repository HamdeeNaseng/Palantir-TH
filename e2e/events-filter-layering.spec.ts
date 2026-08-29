import { expect, test, type Page, type Locator } from "@playwright/test";

/**
 * `/events` has one data path and every panel is downstream of it:
 *
 *   MongoDB snapshot (+ the browser's IndexedDB copy)
 *     -> buildEventsWorkspace(snapshot, filters)      <- the only filter
 *       -> events-replay derivations off the playhead
 *         -> map, trend, recent-played, phenomena, Inspect Summary
 *
 * Nothing in the type system enforces that. A panel handed `snapshot.events`
 * instead of `data.events`, or a count read from the snapshot rather than the
 * matched set, type-checks perfectly and renders a dashboard whose six panels
 * quietly disagree about which events are being discussed — which is the one
 * failure an analyst has no way to notice from the screen.
 *
 * So this asserts the layering from the outside, per panel: apply a filter no
 * panel can honour by accident, then hold each one to it.
 *
 * The map's hotspot rings are WebGL and cannot be read from the DOM. They are
 * covered transitively and deliberately: `phenomenaSummary` takes the exact
 * `districtClusters` array the rings are drawn from (it is passed the list
 * rather than recomputing it — see `events-replay.ts`), so a สรุปปรากฏการณ์
 * that names only in-filter districts is a hotspot layer that does too.
 */

/** Same budget, for the same reason, as `local-filtering.spec.ts`. */
test.describe.configure({ timeout: 120_000 });

/**
 * Kept by the filter under test. Every panel must show this and nothing else.
 * `/events` offers exactly the four DDPM provinces — its province facet is
 * built from `PROVINCES`, with no "อื่น ๆ" row for `/investigate`'s catch-all.
 */
const KEPT = "นราธิวาส";
const DROPPED = ["ปัตตานี", "ยะลา", "สงขลา"];

/** The sidebar's own status line, which only appears once filtering is local. */
async function waitForLocalDataset(page: Page) {
  await expect(page.getByText("กรองจากข้อมูลในเครื่อง")).toBeVisible({ timeout: 60_000 });
}

function sidebar(page: Page) {
  return page.locator('aside[aria-label="ตัวกรองเหตุการณ์"]').first();
}

async function untickProvince(page: Page, name: string) {
  await sidebar(page)
    .locator("label.filter-row")
    .filter({ hasText: name })
    .first()
    .locator("input")
    .click();
}

/** A `<section class="panel">` identified by its own heading. */
function panel(page: Page, heading: string): Locator {
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: heading, exact: true }) });
}

/** First integer in a string, ignoring the thousands separators the UI prints. */
function firstNumber(text: string | null): number {
  const match = (text ?? "").replace(/,/g, "").match(/\d+/);
  expect(match, `expected a number in ${JSON.stringify(text)}`).not.toBeNull();
  return Number(match![0]);
}

/** "เหตุการณ์ทั้งหมด" — `totalMatched`, straight off the filtered set. */
async function kpiTotal(page: Page): Promise<number> {
  const card = page.locator("article").filter({ hasText: "เหตุการณ์ที่ตรงกับตัวกรอง" }).first();
  return firstNumber(await card.locator("p.num").first().textContent());
}

/** The map's own footer count — the features actually handed to MapLibre. */
async function mapFeatureCount(page: Page): Promise<number> {
  const footer = page.locator("p").filter({ hasText: "ขอบเขตการปกครอง" }).first();
  return firstNumber(await footer.locator("span.num").last().textContent());
}

/** The trend chart's accessible name carries the total it plots. */
async function trendPlotted(page: Page): Promise<number> {
  const label = await panel(page, "แนวโน้มตามไทม์ไลน์")
    .getByRole("img")
    .getAttribute("aria-label");
  return firstNumber((label ?? "").replace(/^\D*/, ""));
}

/**
 * The count the sidebar advertises beside a province.
 *
 * Facet counts follow the n-1 rule — a facet is counted with its own dimension
 * left out of the filter — so with `KEPT` the only province still ticked, this
 * is exactly what `totalMatched` must settle on. That makes it both an
 * independent expected value and the signal that the dashboard has finished
 * catching up: the sidebar applies each untick as it is made, so a naive read
 * straight after the last click can land mid-flight, with one panel already on
 * the final selection and another still on the one before it.
 */
async function provinceFacetCount(page: Page, name: string): Promise<number> {
  const row = sidebar(page).locator("label.filter-row").filter({ hasText: name }).first();
  return firstNumber(await row.locator("span.num").last().textContent());
}

/** "N-M จาก T เหตุการณ์" in the recent-played footer — T is what was played. */
async function recentPlayedTotal(page: Page): Promise<number> {
  const footer = panel(page, "ลำดับเหตุการณ์ล่าสุดที่เล่น").locator("footer span.num").first();
  const text = (await footer.textContent()) ?? "";
  const match = text.replace(/,/g, "").match(/จาก\s*(\d+)/);
  expect(match, `expected "จาก N" in ${JSON.stringify(text)}`).not.toBeNull();
  return Number(match![1]);
}

test("/events — every panel renders the filtered set and only the filtered set", async ({
  page,
}) => {
  await page.goto("/events");
  await waitForLocalDataset(page);

  const unfilteredMap = await mapFeatureCount(page);
  const unfilteredTotal = await kpiTotal(page);
  expect(unfilteredMap, "the fixture-free dataset must actually have events").toBeGreaterThan(0);

  // No apply button on `/events` — the sidebar is live, so unticking is the
  // whole interaction. See `events-live-filter.spec.ts` for that claim on its
  // own; here it is only how the filter under test gets applied.
  for (const name of DROPPED) await untickProvince(page, name);

  // Settle on the final selection before reading anything. The filter also has
  // to have bitten at all for the rest to mean anything: one that changed no
  // counts would satisfy every assertion below vacuously.
  const expected = await provinceFacetCount(page, KEPT);
  expect(expected, `${KEPT} alone must still have events to show`).toBeGreaterThan(0);
  expect(expected).toBeLessThan(unfilteredTotal);
  await expect.poll(() => kpiTotal(page), { timeout: 30_000 }).toBe(expected);

  const total = await kpiTotal(page);
  await expect.poll(() => mapFeatureCount(page), { timeout: 30_000 }).toBeLessThan(unfilteredMap);

  // --- the trend, against the same matched set ---------------------------
  // Every matched event falls in exactly one histogram bucket, so the chart's
  // own total is `totalMatched` computed by a different route. Equality is
  // what says the two panels are reading one filtered set rather than two.
  expect(await trendPlotted(page), "แนวโน้มตามไทม์ไลน์ must plot the matched set").toBe(total);

  // --- the map -----------------------------------------------------------
  // Not `total`: an event whose source published no coordinate stays in the
  // statistics and gets no marker, by design. It must never be the larger of
  // the two, which is what a map fed something other than `data.events` would
  // produce.
  const mapped = await mapFeatureCount(page);
  expect(mapped).toBeGreaterThan(0);
  expect(mapped).toBeLessThanOrEqual(total);

  // --- ลำดับเหตุการณ์ล่าสุดที่เล่น ------------------------------------------
  // The playhead resets to the end of the new span, so everything mapped has
  // been played. A table built from anything but the same features would not
  // land on the map's own count.
  expect(await recentPlayedTotal(page), "the played table and the map must agree").toBe(mapped);

  const provinceCells = panel(page, "ลำดับเหตุการณ์ล่าสุดที่เล่น").locator("tbody tr td:nth-child(2)");
  const provinces = await provinceCells.allInnerTexts();
  expect(provinces.length).toBeGreaterThan(0);
  for (const name of provinces) expect(name.trim()).toBe(KEPT);

  // --- สรุปปรากฏการณ์ (and, transitively, the map's hotspot rings) ---------
  // An empty list is a legitimate answer — no district need clear Poisson
  // significance — so this constrains what is there rather than demanding
  // something be.
  const insights = await panel(page, "สรุปปรากฏการณ์").locator("li").allInnerTexts();
  for (const line of insights) expect(line).toContain(`จ.${KEPT}`);

  // --- Inspect Summary ---------------------------------------------------
  const inspect = page.locator("aside").filter({ hasText: "Inspect Summary" }).first();
  await expect(inspect.getByText(`จ.${KEPT}`)).toBeVisible();
});
