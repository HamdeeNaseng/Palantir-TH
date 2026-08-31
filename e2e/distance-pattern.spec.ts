import { expect, test, type Page } from "@playwright/test";

/**
 * The 32-direction distance pattern on `/investigate`.
 *
 * The spokes are WebGL and leave nothing in the DOM, so as in
 * `facility-overlay.spec.ts` the assertions go through the pieces that are
 * rendered from the same state the layers are: the toggle, and the reading
 * card that only mounts once a pattern has actually arrived.
 *
 * Clicking a dot pins the case's label and draws its 32 directions; it no
 * longer opens `/cases/<id>`, which used to make the map's primary gesture a
 * one-way exit. The last test in this file walks that interaction on the real
 * canvas; the ones before it pin the payload behind the drawing, because a
 * wrong number there would look perfectly plausible on a map.
 */

const READY = "ชั้นข้อมูล";
const TOGGLE = /รูปแบบระยะทาง 32 ทิศ/;

test("API คืนรูปแบบ 32 ทิศของเคสที่มีข้อมูล และคืน null อย่างสุภาพเมื่อไม่มี", async ({
  request,
}) => {
  const missing = await request.get("/api/distance-pattern?eventId=__no_such_case__");
  // Absence is a normal answer: the batch is optional and may not cover a case.
  expect(missing.ok()).toBeTruthy();
  expect((await missing.json()).pattern).toBeNull();

  const noId = await request.get("/api/distance-pattern");
  expect(noId.status()).toBe(400);
});

test("/investigate — ชั้นรูปแบบระยะทางเปิดไว้ตั้งแต่ต้น และปิดได้", async ({ page }) => {
  await page.goto("/investigate");
  await expect(page.getByText(READY).first()).toBeVisible({ timeout: 45_000 });
  await page.getByRole("button", { name: READY }).click();

  const toggle = page.getByRole("checkbox", { name: TOGGLE });
  // On by default: the click is what asks for the pattern, so a click that
  // drew nothing until a toggle had been found would just look broken.
  await expect(toggle).toBeChecked();
  await expect(page.getByText(/คลิกจุดเหตุการณ์เพื่อปักหมุด/)).toBeVisible();

  // Turning it off keeps the pin and drops only the spokes, and the row says so.
  await toggle.uncheck();
  await expect(toggle).not.toBeChecked();
  await expect(page.getByText(/ยังปักหมุดแสดงป้ายเคสได้/)).toBeVisible();
});

/**
 * What the click renders, asserted on the payload.
 *
 * Separate from the interaction test at the foot of this file on purpose: that
 * one proves the four steps are wired together, this one proves the numbers
 * they show are right. A bearing binned into the wrong sector or a neighbour
 * kept from outside the search radius draws a map that looks entirely
 * plausible, so it has to be checked against the document rather than the
 * picture.
 */
test("รูปแบบระยะทางของเคสจริงมีโครงสร้างที่ชั้นแผนที่วาดได้", async ({ request }) => {
  const list = await request.get("/api/map/events");
  test.skip(!list.ok(), "no event payload to pick a case from");

  const features = (await list.json()).features ?? [];
  test.skip(features.length === 0, "no events in this corpus");

  // Walk until a case the batch has covered turns up: the batch is optional
  // and need not cover the first event the map happens to return.
  let pattern: Record<string, unknown> | null = null;
  for (const f of features.slice(0, 40)) {
    const res = await request.get(
      `/api/distance-pattern?eventId=${encodeURIComponent(f.properties.id)}`,
    );
    expect(res.ok()).toBeTruthy();
    pattern = (await res.json()).pattern;
    if (pattern) break;
  }
  test.skip(pattern === null, "distance-pattern batch has not been run for this corpus");

  const p = pattern as {
    eventId: string; anchorId: string; radiusM: number;
    summary: { coverage: number; emptySectors: number };
    sectors: {
      sector: number; abbr: string; nameTh: string; bearingDeg: number;
      straightM: number; neighbour: { kind: string; lng: number; lat: number };
    }[];
  };

  expect(typeof p.eventId).toBe("string");
  expect(typeof p.anchorId).toBe("string");
  expect(p.radiusM).toBeGreaterThan(0);

  // 32 rhumbs is the whole premise; more than that means the sector binning
  // has drifted and every bearing drawn would be wrong.
  expect(p.sectors.length).toBeLessThanOrEqual(32);
  expect(p.summary.coverage).toBe(p.sectors.length);
  expect(p.summary.coverage + p.summary.emptySectors).toBe(32);

  const seen = new Set<number>();
  for (const s of p.sectors) {
    // One neighbour per direction — the defining property of the output.
    expect(seen.has(s.sector)).toBe(false);
    seen.add(s.sector);

    expect(s.sector).toBeGreaterThanOrEqual(0);
    expect(s.sector).toBeLessThan(32);
    expect(s.bearingDeg).toBeCloseTo(s.sector * 11.25, 6);
    // Both names travel with the sector so the map never carries the table.
    expect(s.abbr.length).toBeGreaterThan(0);
    expect(s.nameTh.length).toBeGreaterThan(0);

    // Inside the radius it was searched with, or it should not have been kept.
    expect(s.straightM).toBeGreaterThan(0);
    expect(s.straightM).toBeLessThanOrEqual(p.radiusM);

    // The line takes its colour from this, so it must always be present.
    expect(typeof s.neighbour.kind).toBe("string");
    expect(s.neighbour.kind.length).toBeGreaterThan(0);
    expect(typeof s.neighbour.lng).toBe("number");
    expect(typeof s.neighbour.lat).toBe("number");
  }
});

test("/investigate — ปิดชั้นแล้วการ์ดรูปแบบไม่แสดง", async ({ page }) => {
  await page.goto("/investigate");
  await expect(page.getByText(READY).first()).toBeVisible({ timeout: 45_000 });
  await page.getByRole("button", { name: READY }).click();
  await page.getByRole("checkbox", { name: TOGGLE }).uncheck();

  // Nothing is pinned and the layer is off, so the rail carries no pattern
  // card — the event key it normally shows is still there.
  await expect(page.getByText(/จาก 32 ทิศ/)).toHaveCount(0);
  await expect(page.getByText("ขอบเขตความคลาดเคลื่อน")).toBeVisible();
});

/**
 * The click flow and the rail, in one pass.
 *
 * Deliberately a single test. Written as two, each ran its own pixel sweep for
 * a dot and they cost 2.6 and 1.4 minutes; run in parallel they saturated the
 * shared dev server and timed out five `local-filtering` tests that are
 * nothing to do with the map. One sweep, its coordinate reused, is seconds.
 *
 * The steps, which are separate pieces of state and only reveal their wiring
 * in order:
 *
 *   1. click a hotspot   -> label, guideline, AND the right-hand rail
 *   2. close the label   -> guideline SURVIVES
 *   3. click empty map   -> all three cleared
 *   4. click another dot -> replaced, never two labels
 *
 * Step 2 is what earns the canvas test: the label and the spokes come from
 * separate state, and wiring the popup's close button to clear both — which it
 * did originally — is invisible in review and obvious here.
 *
 * **Zoom with the map's own + button, never `mouse.wheel`.** An earlier version
 * swept after a wheel zoom and failed under parallel workers about half the
 * time. The cause was not the sweep: a wheel delta is scaled by the browser, so
 * the camera landed somewhere different every run. `nudgeZoom(0.6)` per click
 * is exact, and a fixed camera puts the dots in the same pixels every time.
 */
test("/investigate — ป้าย เส้น 32 ทิศ และแถบขวา ทำงานตามลำดับที่ตั้งใจ", async ({ page }) => {
  test.slow();
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/investigate");
  await expect(page.getByText(READY).first()).toBeVisible({ timeout: 45_000 });

  const idle = page.getByText("ไม่มีเคสที่กำลังติดตาม");
  await expect(idle).toBeVisible();

  // Facility pins are larger than the dots and still navigate on click, so a
  // blind sweep would hit one and spend the rest of the test on `/network`.
  await page.getByRole("button", { name: READY }).click();
  await page.getByRole("checkbox", { name: /หน่วยงาน\/เครือข่าย/ }).uncheck();
  await page.getByRole("button", { name: READY }).click();
  await page.waitForTimeout(1200);

  // Three steps, not six. Zooming further lands on ground that is mostly
  // empty of events, and a sweep there finds nothing however fine it is —
  // which is exactly what happened when the map panel grew taller and
  // `fitBounds` produced a different starting camera. Staying wide keeps
  // thousands of dots in frame, so the sweep hits one within a few probes.
  const zoomIn = page.getByRole("button", { name: "ขยาย" });
  for (let i = 0; i < 3; i++) {
    await zoomIn.click();
    await page.waitForTimeout(350);
  }
  await page.waitForTimeout(3000);

  const canvas = page.locator(".maplibregl-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("map canvas has no box");

  const label = page.locator(".maplibregl-popup-close-button");
  const guideline = page.getByText(/จาก 32 ทิศ/);
  const railHeading = page.getByRole("heading", { name: "เหตุการณ์ที่เลือก" });

  // The step has to be finer than a dot is wide, and wide-zoom dots are only
  // a few pixels. Density pays for it: over the four provinces almost every
  // probe is near a dot, so the loop exits early even though the grid is fine.
  // The sweep still runs once and its coordinate is reused below — three
  // sweeps in one file starved the other workers sharing this server.
  const spots: [number, number][] = [];
  for (let gx = 0.2; gx <= 0.8; gx += 0.012) {
    for (let gy = 0.2; gy <= 0.8; gy += 0.025) spots.push([gx, gy]);
  }
  const clickSpot = async (i: number) => {
    await page.mouse.click(box.x + box.width * spots[i][0], box.y + box.height * spots[i][1]);
    return label
      .first()
      .waitFor({ state: "visible", timeout: 110 })
      .then(() => true)
      .catch(() => false);
  };

  let first = -1;
  for (let i = 0; i < spots.length && first < 0; i++) if (await clickSpot(i)) first = i;
  expect(first, "no event dot found").toBeGreaterThanOrEqual(0);

  // 1 — one click, three things, and no navigation.
  await expect(page).toHaveURL(/\/investigate/);
  await expect(label.first()).toBeVisible();
  await expect(guideline).toBeVisible({ timeout: 20_000 });
  await expect(railHeading).toBeVisible();
  await expect(idle).toHaveCount(0);
  // The rail states positional error rather than letting a centroid read exact.
  await expect(page.getByText("ความละเอียดพิกัด").last()).toBeVisible();

  // 2 — closing the label leaves the guideline drawn.
  await label.first().click();
  await expect(label).toHaveCount(0);
  await expect(guideline).toBeVisible();

  // 3 — the map itself is the clear-everything gesture. Which pixels are bare
  // canvas depends on the camera, and the legend and scrubber cover whole
  // corners, so try candidates until one lands.
  let cleared = false;
  for (const [gx, gy] of [[0.5, 0.06], [0.35, 0.06], [0.65, 0.06], [0.06, 0.6], [0.5, 0.93]]) {
    await page.mouse.click(box.x + box.width * gx, box.y + box.height * gy);
    cleared = await idle.waitFor({ state: "visible", timeout: 700 }).then(() => true).catch(() => false);
    if (cleared) break;
  }
  expect(cleared, "no empty-canvas pixel found").toBeTruthy();
  await expect(guideline).toHaveCount(0);
  await expect(label).toHaveCount(0);

  // 4 — pin again and then hit a further dot: the second must replace the
  // first, never stack beside it. Resuming from the known-good index rather
  // than restarting keeps this cheap; the exact pixel is not reused, because
  // whether one specific dot is still under it depends on the replay filter.
  let again = -1;
  for (let i = first; i < spots.length && again < 0; i++) if (await clickSpot(i)) again = i;
  expect(again, "could not pin a second time").toBeGreaterThanOrEqual(0);
  await expect(label).toHaveCount(1);

  let second = -1;
  for (let i = again + 1; i < spots.length && second < 0; i++) if (await clickSpot(i)) second = i;
  // Only meaningful if a further dot exists; either way one label at most.
  await expect(label).toHaveCount(1);
  expect(second === -1 || second > again).toBeTruthy();
});
