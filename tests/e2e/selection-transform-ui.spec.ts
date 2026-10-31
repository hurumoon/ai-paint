import { expect, test } from "@playwright/test";
import {
  clickDocumentPoint,
  countDarkCompositePixels,
  createCanvas,
  dragDocumentPoints,
} from "./canvas-helpers";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });
});

test("moves selected pixels through the canvas UI and restores them with undo", async ({
  page,
}) => {
  await page.goto("/");
  await createCanvas(page, { width: 120, height: 80, dpi: 144 });

  await page.locator('button[title="範囲指定"]').click();
  await dragDocumentPoints(page, { x: 10, y: 20 }, { x: 40, y: 50 });

  await page.locator('button[title="バケツ"]').click();
  await clickDocumentPoint(page, { x: 25, y: 35 });

  const originalRegion = { x: 10, y: 20, width: 30, height: 30 };
  const movedRegion = { x: 60, y: 20, width: 30, height: 30 };

  await expect
    .poll(() => countDarkCompositePixels(page, originalRegion))
    .toBeGreaterThan(700);
  await expect
    .poll(() => countDarkCompositePixels(page, movedRegion))
    .toBeLessThan(5);

  await page.locator('button[title="移動"]').click();
  await dragDocumentPoints(page, { x: 25, y: 35 }, { x: 75, y: 35 });

  await expect
    .poll(() => countDarkCompositePixels(page, originalRegion))
    .toBeLessThan(10);
  await expect
    .poll(() => countDarkCompositePixels(page, movedRegion))
    .toBeGreaterThan(700);

  await page.keyboard.press("Control+Z");
  await expect
    .poll(() => countDarkCompositePixels(page, originalRegion))
    .toBeGreaterThan(700);
  await expect
    .poll(() => countDarkCompositePixels(page, movedRegion))
    .toBeLessThan(5);
});
