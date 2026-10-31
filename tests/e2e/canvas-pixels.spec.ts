import { expect, test } from "@playwright/test";
import {
  countDarkCompositePixels,
  createCanvas,
  drawHorizontalStroke,
  fillCanvasWithBucket,
} from "./canvas-helpers";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });
});

test("renders bucket fill pixels to the composite canvas", async ({ page }) => {
  await page.goto("/");
  await createCanvas(page, { width: 80, height: 60, dpi: 144 });

  const sampleRegion = await fillCanvasWithBucket(page);

  await expect
    .poll(() => countDarkCompositePixels(page, sampleRegion))
    .toBeGreaterThan(4_000);
});

test("restores composite canvas pixels through undo and redo", async ({ page }) => {
  await page.goto("/");
  await createCanvas(page, { width: 80, height: 60, dpi: 144 });

  const sampleRegion = await fillCanvasWithBucket(page);
  await expect
    .poll(() => countDarkCompositePixels(page, sampleRegion))
    .toBeGreaterThan(4_000);

  await page.keyboard.press("Control+Z");
  await expect
    .poll(() => countDarkCompositePixels(page, sampleRegion))
    .toBeLessThan(5);

  await page.keyboard.press("Control+Shift+Z");
  await expect
    .poll(() => countDarkCompositePixels(page, sampleRegion))
    .toBeGreaterThan(4_000);
});

test("eraser shortcut clears filled pixels and undo restores them", async ({ page }) => {
  await page.goto("/");
  await createCanvas(page, { width: 80, height: 60, dpi: 144 });

  const fullCanvas = await fillCanvasWithBucket(page);
  await expect
    .poll(() => countDarkCompositePixels(page, fullCanvas))
    .toBeGreaterThan(4_000);

  await page.keyboard.press("e");
  await drawHorizontalStroke(page);
  await expect
    .poll(() => countDarkCompositePixels(page, fullCanvas))
    .toBeLessThan(4_600);

  await page.keyboard.press("Control+Z");
  await expect
    .poll(() => countDarkCompositePixels(page, fullCanvas))
    .toBeGreaterThan(4_000);
});

test("new layer shortcut and visibility undo update composite pixels", async ({
  page,
}) => {
  await page.goto("/");
  await createCanvas(page, { width: 80, height: 60, dpi: 144 });

  await page.keyboard.press("Control+Shift+N");
  await expect(page.locator(".layer-row")).toHaveCount(2);

  const fullCanvas = await fillCanvasWithBucket(page);
  await expect
    .poll(() => countDarkCompositePixels(page, fullCanvas))
    .toBeGreaterThan(4_000);

  await page.locator(".layer-row.active .visibility").click();
  await expect
    .poll(() => countDarkCompositePixels(page, fullCanvas))
    .toBeLessThan(5);

  await page.keyboard.press("Control+Z");
  await expect
    .poll(() => countDarkCompositePixels(page, fullCanvas))
    .toBeGreaterThan(4_000);
});

test("horizontal flip is a view transform and does not mutate composite pixels", async ({
  page,
}) => {
  await page.goto("/");
  await createCanvas(page, { width: 80, height: 60, dpi: 144 });

  await fillCanvasWithBucket(page);
  await expect
    .poll(() =>
      countDarkCompositePixels(page, { x: 0, y: 0, width: 80, height: 60 })
    )
    .toBeGreaterThan(4_000);

  const before = await page.locator("canvas.composite-canvas").evaluate((canvas) => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return [];
    return Array.from(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
  });

  await page.locator('button[title="左右反転表示 (Shift+H)"]').click();
  await expect
    .poll(() =>
      page
        .locator(".canvas-stage")
        .evaluate((stage) => getComputedStyle(stage).transform)
    )
    .toContain("matrix(-1");

  const after = await page.locator("canvas.composite-canvas").evaluate((canvas) => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return [];
    return Array.from(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
  });
  expect(after).toEqual(before);
});
