import { expect, test, type Page } from "@playwright/test";

/**
 * The promise `/api/snapshot` exists to keep: applying a filter is answered
 * from the dataset in the browser, not from MongoDB.
 *
 * This is the one claim no other check can reach. `tsc` proves the builders
 * type-check and the same functions run on both sides, but only a real browser
 * can show that ticking a filter box issues no request, that the dataset
 * survives in IndexedDB, and that Back still walks filter history now that the
 * URL is driven by the History API instead of the router.
 */

/**
 * Double the suite's 60 s budget, for the reason that budget exists at all
 * (see `playwright.config.ts`): these race a dev server. Every test here takes
 * a cold context — no IndexedDB — so it waits for the route to compile, the
 * whole dataset to arrive, and ~10k events to be built into a view model in
 * the browser, with eight workers doing the same thing at once. That is slow
 * rather than flaky, and pretending otherwise just makes the suite fail by
 * luck.
 */
test.describe.configure({ timeout: 120_000 });

/** The sidebar's own status line, which only appears once filtering is local. */
async function waitForLocalDataset(page: Page) {
  await expect(page.getByText("กรองจากข้อมูลในเครื่อง")).toBeVisible({ timeout: 60_000 });
}

/**
 * The imagery credit MapLibre adds once the satellite source has loaded.
 *
 * It lands inside `main` on its own schedule, so a whole-page text baseline
 * taken before it appears can never equal one taken after — a test that then
 * fails on tile latency rather than on anything it set out to check. Waiting
 * for it puts the map's asynchronous half on both sides of the comparison.
 */
async function waitForMapAttribution(page: Page) {
  await expect(page.getByText(/Esri|MapTiler/).first()).toBeVisible({ timeout: 30_000 });
}

function sidebar(page: Page) {
  return page
    .locator('aside[aria-label="ตัวกรอง"], aside[aria-label="ตัวกรองเหตุการณ์"]')
    .first();
}

async function untickProvince(page: Page, name: string) {
  await sidebar(page)
    .locator("label.filter-row")
    .filter({ hasText: name })
    .first()
    .locator("input")
    .click();
}

/**
 * Both analyst consoles apply each change as it is made, with no button
 * between — see `useFilterDraft`. Asserted rather than assumed below: a
 * sidebar that quietly went back to batching would still pass every other
 * check in this file.
 */
async function expectNoApplyButton(page: Page) {
  await expect(
    page.getByRole("button", { name: "ใช้ตัวกรอง" }),
    "a live sidebar must not also offer a button that claims to apply",
  ).toHaveCount(0);
}

for (const path of ["/investigate", "/events"]) {
  test(`${path} filters from the browser's own copy, with no request`, async ({ page }) => {
    await page.goto(path);
    await waitForLocalDataset(page);

    // What must not happen is a *data* fetch or a navigation. Next's own
    // `<Link>` prefetching can fire an `_rsc` request for a case page whose
    // link just scrolled into view, which is unrelated to filtering and not
    // something this test should forbid — asserting "zero requests" would make
    // it hostage to the prefetcher's timing.
    const fetches: string[] = [];
    page.on("request", (r) => {
      const url = r.url();
      const isPrefetch = url.includes("_rsc=");
      const isData = url.includes("/api/") || r.resourceType() === "document";
      if (isData && !isPrefetch) fetches.push(`${r.resourceType()} ${url}`);
    });

    await waitForMapAttribution(page);
    const before = await page.locator("main").innerText();
    await untickProvince(page, "ปัตตานี");
    await expectNoApplyButton(page);

    // The dashboard has to actually change — a filter that quietly does
    // nothing would also issue no requests.
    await expect
      .poll(() => page.locator("main").innerText(), { timeout: 30_000 })
      .not.toBe(before);

    expect(fetches, "applying a filter must not fetch data or navigate").toEqual([]);
    expect(page.url()).toContain("prov=");
  });
}

test("the dataset is cached in IndexedDB and reused on the next visit", async ({ page }) => {
  // This one loads `/events` twice — the file-level budget above is why that
  // fits.
  await page.goto("/events");
  await waitForLocalDataset(page);

  const cached = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("palantir-th", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return new Promise<{ version: string; events: number } | null>((resolve, reject) => {
      const request = db.transaction("snapshot", "readonly").objectStore("snapshot").get("current");
      request.onsuccess = () =>
        resolve(
          request.result ? { version: request.result.version, events: request.result.events.length } : null,
        );
      request.onerror = () => reject(request.error);
    });
  });

  expect(cached).not.toBeNull();
  expect(cached!.events).toBeGreaterThan(0);

  // Second visit: the snapshot request that does go out must be conditional,
  // which is what makes the five-minute refresh cost nothing when idle.
  const conditional: boolean[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/snapshot")) conditional.push(Boolean(r.headers()["if-none-match"]));
  });
  await page.goto("/events");
  await waitForLocalDataset(page);

  expect(conditional.length, "the page should still check for newer data").toBeGreaterThan(0);
  expect(conditional.every(Boolean), "every refresh must send If-None-Match").toBe(true);
});

test("Back walks filter history without going to the server", async ({ page }) => {
  await page.goto("/investigate");
  await waitForLocalDataset(page);

  await waitForMapAttribution(page);
  const unfiltered = await page.locator("main").innerText();
  await untickProvince(page, "ปัตตานี");
  await expect.poll(() => page.locator("main").innerText(), { timeout: 30_000 }).not.toBe(unfiltered);

  await page.goBack();
  await expect.poll(() => page.locator("main").innerText(), { timeout: 30_000 }).toBe(unfiltered);
});

/**
 * The แหล่งข้อมูล select used to be seven hard-coded ids copied from
 * `lib/fixtures.ts`. Real ingestion replaced the registry with different ids
 * and nothing updated the list, so every option filtered the dashboard to
 * zero — the control looked fine and could not filter anything.
 *
 * Asserting the count rather than merely "the number changed" is the point: an
 * option that matches nothing would still change the number.
 */
test("every source option filters to exactly the count it advertises", async ({ page }) => {
  await page.goto("/investigate");
  await waitForLocalDataset(page);

  const select = sidebar(page).locator("select");
  const options = await select
    .locator("option")
    .evaluateAll((els) =>
      els
        .map((el) => ({
          value: (el as HTMLOptionElement).value,
          n: Number(/\(([\d,]+)\)/.exec(el.textContent ?? "")?.[1]?.replace(/,/g, "") ?? "-1"),
        }))
        .filter((o) => o.value !== "all"),
    );

  expect(options.length, "the registry should offer at least one source").toBeGreaterThan(0);
  // At least one source has to actually carry events, or the control is
  // decorative again — just derived from the right place this time.
  expect(options.some((o) => o.n > 0)).toBe(true);

  const busiest = options.reduce((a, b) => (b.n > a.n ? b : a));
  await select.selectOption(busiest.value);

  await expect
    .poll(
      async () =>
        /เหตุการณ์ทั้งหมด\s*([\d,]+)/
          .exec(await page.locator("main").innerText())?.[1]
          ?.replace(/,/g, ""),
      { timeout: 30_000 },
    )
    .toBe(String(busiest.n));
});

/**
 * A snapshot built while MongoDB was unreachable is `live: false` with no
 * events. That used to be cached like any other and then preferred over the
 * server's own render, so a browser that caught one during a brief outage
 * showed zero events and answered every filter from an empty dataset —
 * indefinitely, while the sidebar reported that it was filtering locally.
 *
 * The cache now refuses to store one, discards one it already holds, and the
 * pages only adopt a held snapshot that is live and genuinely newer than the
 * one the server rendered from.
 */
test("an outage snapshot in the cache cannot displace real data", async ({ page }) => {
  const plantOutage = () =>
    page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("palantir-th", 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise<void>((resolve, reject) => {
        const request = db
          .transaction("snapshot", "readwrite")
          .objectStore("snapshot")
          // A future `builtAtMs` on purpose: "newer" must not be enough to win.
          .put(
            {
              schema: 1,
              version: "outage",
              builtAtMs: Date.now() + 86_400_000,
              live: false,
              events: [],
              sources: [],
              citizenReports: [],
              cases: [],
              districtsByProvince: {},
            },
            "current",
          );
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    });

  const total = async () =>
    /เหตุการณ์ทั้งหมด\s*([\d,]+)/.exec(await page.locator("main").innerText())?.[1] ?? "";

  await page.goto("/investigate");
  await waitForLocalDataset(page);
  const real = await total();
  expect(real, "the fixture database should have events to lose").not.toBe("0");

  await plantOutage();
  await page.goto("/investigate");

  // The server's own render must survive the poisoned cache.
  await expect.poll(total, { timeout: 30_000 }).toBe(real);

  // And the bad row must be gone rather than waiting to bite the next visit.
  await waitForLocalDataset(page);
  const cachedLive = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("palantir-th", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return new Promise<boolean | null>((resolve, reject) => {
      const request = db.transaction("snapshot", "readonly").objectStore("snapshot").get("current");
      request.onsuccess = () => resolve(request.result ? request.result.live : null);
      request.onerror = () => reject(request.error);
    });
  });
  expect(cachedLive, "a non-live snapshot must never remain cached").not.toBe(false);

  // Filtering still narrows the data rather than answering from nothing.
  await untickProvince(page, "ปัตตานี");
  await expect.poll(total, { timeout: 30_000 }).not.toBe(real);
  expect(await total()).not.toBe("0");
});
