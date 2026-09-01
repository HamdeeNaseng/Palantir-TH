import { expect, test, type Page } from "@playwright/test";

/**
 * The console at phone width.
 *
 * These pages were drawn for a 1180 px analyst screen and used to say so in
 * their own markup (`min-w-[1180px]`), which made every one of them a
 * side-scrolling wall on a phone. They now switch to a single stacked column
 * below `lg`, with the filter sidebar moving into an off-canvas drawer.
 *
 * The assertion that matters is the boring one: nothing spills sideways. A
 * layout that "works on mobile" but leaves the document 400 px wider than the
 * viewport is one where every tap lands somewhere the reader cannot see, so
 * this is checked on every console route rather than spot-checked on one.
 */

const ROUTES = [
  { path: "/investigate", name: "สืบสวน" },
  { path: "/events", name: "เหตุการณ์" },
  { path: "/cases", name: "เคส" },
  { path: "/report", name: "รายงาน" },
  { path: "/map", name: "แผนที่" },
];

/**
 * How far the document overflows its viewport horizontally.
 *
 * `documentElement.scrollWidth` and not a per-element sweep: an element may
 * legitimately be wider than the screen as long as it scrolls inside its own
 * container (a wide table, the nav strip). What must never happen is the page
 * itself growing.
 */
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

for (const route of ROUTES) {
  test(`${route.path} does not scroll sideways on a phone`, async ({ page }) => {
    await page.goto(route.path);
    await expect(page.getByRole("link", { name: route.name, exact: true })).toBeVisible();

    // One pixel of slack for sub-pixel rounding on fractional device widths.
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  });
}

test("every destination stays reachable from the nav strip", async ({ page }) => {
  await page.goto("/cases");

  const strip = page.getByRole("navigation", { name: "ส่วนงาน" });
  await expect(strip).toBeVisible();

  // Off-screen to the right is fine — that is what the strip scrolls for — but
  // each tab has to be able to come into view.
  for (const { name } of ROUTES) {
    const tab = strip.getByRole("link", { name, exact: true });
    await tab.scrollIntoViewIfNeeded();
    await expect(tab).toBeInViewport();
  }

  // The page the reader is on is the one that must not need scrolling to find.
  await expect(strip.getByRole("link", { name: "เคส", exact: true })).toBeInViewport();
});

test("filters are reachable through the drawer on /cases", async ({ page }) => {
  await page.goto("/cases");

  const panel = page.getByRole("complementary", { name: "ตัวกรองเคส" });
  // Present in the DOM at every width, but parked off-screen until asked for.
  await expect(panel).not.toBeInViewport();

  await page.getByRole("button", { name: /ตัวกรองเคส/ }).first().click();
  await expect(panel).toBeInViewport();

  // Escape is the other half of "this behaves like a dialog".
  await page.keyboard.press("Escape");
  await expect(panel).not.toBeInViewport();
});

test("a filter ticked in the drawer applies itself, and the drawer closes on ดูผลลัพธ์", async ({
  page,
}) => {
  await page.goto("/cases");

  await page.getByRole("button", { name: /ตัวกรองเคส/ }).first().click();
  const panel = page.getByRole("complementary", { name: "ตัวกรองเคส" });
  await expect(panel).toBeInViewport();

  // Click the visible label rather than whichever checkbox happens to be
  // first. Data-backed facet groups can be empty, in which case the first
  // checkbox is the visually hidden input behind the "has media" switch and
  // a direct `.check()` correctly fails Playwright's hit-target check.
  const mediaOnly = panel.getByRole("checkbox", { name: /เฉพาะที่มีหลักฐานแนบ/ });
  await panel.getByText(/เฉพาะที่มีหลักฐานแนบ/).click();
  await expect(mediaOnly).toBeChecked();

  // No button press in between: the register applies each change as it is
  // made, and the URL is where that becomes shareable. Given a moment for the
  // debounce that keeps a run of ticks down to one query.
  await expect(page).toHaveURL(/[?&](prov|type|ver|place|media)=/, { timeout: 15_000 });

  // The footer button is "look at the results" now, not "apply them".
  await expect(panel.getByRole("button", { name: "ใช้ตัวกรอง" })).toHaveCount(0);
  await panel.getByRole("button", { name: "ดูผลลัพธ์" }).click();
  await expect(panel).not.toBeInViewport();
});
