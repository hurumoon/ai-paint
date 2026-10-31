import { expect, test, type Page } from "@playwright/test";
import type { LargePsdLayerSpec } from "./large-psd-fixture";
import {
  clickDocumentPoint,
  countDarkCompositePixels,
  createCanvas,
  dragDocumentPoints,
  saveAipaintDownload,
  sampleCompositePixel,
} from "./canvas-helpers";

test.describe.configure({ timeout: 45_000 });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });
});

test("opens layered PSD-like input, brushes, undoes, saves, and reloads the project", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const fileInput = projectFileInput(page);
  const psd = await makeLayeredPsdBuffer(page);

  await fileInput.setInputFiles({
    name: "lifeline-source.psd",
    mimeType: "image/vnd.adobe.photoshop",
    buffer: psd,
  });

  await expect(page.locator("canvas.input-canvas")).toHaveAttribute("width", "96");
  await expect(page.locator("canvas.input-canvas")).toHaveAttribute("height", "64");
  await expect(page.locator(".layer-row")).toHaveCount(3);
  await expectCompositePixelNear(page, { x: 14, y: 12 }, [220, 40, 30, 255]);
  await expectCompositePixelNear(page, { x: 52, y: 18 }, [30, 170, 70, 255]);
  const topRegion = { x: 34, y: 24, width: 28, height: 20 };
  await expectCompositePixelNear(page, { x: 48, y: 32 }, [30, 80, 220, 255]);
  await expect
    .poll(() => countPixelsDifferentFrom(page, topRegion, [30, 80, 220, 255]))
    .toBeLessThan(5);

  await page.locator(".layer-row").filter({ hasText: "top mark" }).click();
  await expect(page.locator(".layer-row.active")).toContainText("top mark");
  await page.keyboard.press("b");
  await page.keyboard.press("]");
  await page.keyboard.press("]");
  await page.keyboard.press("]");
  const beforeBrush = await readCompositePixels(page);
  await dragDocumentPoints(page, { x: 40, y: 32 }, { x: 56, y: 32 });
  await expect
    .poll(async () => countCompositePixelDiff(page, beforeBrush))
    .toBeGreaterThan(20);

  await page.keyboard.press("Control+Z");
  await expect
    .poll(async () => countCompositePixelDiff(page, beforeBrush))
    .toBeLessThan(5);

  const savedPath = await saveAipaintDownload(
    page,
    testInfo,
    "layered-psd-after-undo"
  );
  await fileInput.setInputFiles(savedPath);

  await expect(page.locator("canvas.input-canvas")).toHaveAttribute("width", "96");
  await expect(page.locator("canvas.input-canvas")).toHaveAttribute("height", "64");
  await expect(page.locator(".layer-row")).toHaveCount(3);
  await expectCompositePixelNear(page, { x: 14, y: 12 }, [220, 40, 30, 255]);
  await expectCompositePixelNear(page, { x: 52, y: 18 }, [30, 170, 70, 255]);
  await expect
    .poll(async () => countCompositePixelDiff(page, beforeBrush))
    .toBeLessThan(5);
});

test("moves a rectangular selection, undoes, saves, and reloads the restored pixels", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await createCanvas(page, { width: 120, height: 80, dpi: 144 });

  await page.keyboard.press("m");
  await dragDocumentPoints(page, { x: 10, y: 20 }, { x: 40, y: 50 });

  await page.keyboard.press("g");
  await clickDocumentPoint(page, { x: 25, y: 35 });

  const originalRegion = { x: 10, y: 20, width: 30, height: 30 };
  const movedRegion = { x: 60, y: 20, width: 30, height: 30 };
  await expect
    .poll(() => countDarkCompositePixels(page, originalRegion))
    .toBeGreaterThan(700);
  await expect
    .poll(() => countDarkCompositePixels(page, movedRegion))
    .toBeLessThan(5);

  await page.keyboard.press("v");
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

  const savedPath = await saveAipaintDownload(page, testInfo, "selection-restored");
  await projectFileInput(page).setInputFiles(savedPath);
  await expect
    .poll(() => countDarkCompositePixels(page, originalRegion))
    .toBeGreaterThan(700);
  await expect
    .poll(() => countDarkCompositePixels(page, movedRegion))
    .toBeLessThan(5);
});

test("creates text, edits it, saves, and reloads the editable text layer", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await createCanvas(page, { width: 180, height: 110, dpi: 144 });

  await page.keyboard.press("t");
  await clickDocumentPoint(page, { x: 24, y: 56 });

  const editor = textEditor(page);
  await expect(page.locator(".layer-row")).toHaveCount(2);
  await expect(editor).toBeVisible();
  await editor.locator("textarea").fill("E2E lifeline");
  await editor.locator("select.select").selectOption("monospace");
  await editor.locator("input[type='checkbox']").first().check();

  const textRegion = { x: 18, y: 10, width: 150, height: 70 };
  await expect
    .poll(() => countDarkCompositePixels(page, textRegion))
    .toBeGreaterThan(40);

  const savedPath = await saveAipaintDownload(page, testInfo, "editable-text");
  await projectFileInput(page).setInputFiles(savedPath);

  const reloadedEditor = textEditor(page);
  await expect(page.locator(".layer-row")).toHaveCount(2);
  await expect(reloadedEditor).toBeVisible();
  await expect(reloadedEditor.locator("textarea")).toHaveValue("E2E lifeline");
  await expect(reloadedEditor.locator("select.select")).toHaveValue("monospace");
  await expect(reloadedEditor.locator("input[type='checkbox']").first()).toBeChecked();
  await expect
    .poll(() => countDarkCompositePixels(page, textRegion))
    .toBeGreaterThan(40);
});

function projectFileInput(page: Page) {
  return page.getByTestId("project-file-input");
}

function textEditor(page: Page) {
  return page.locator(".section").filter({
    has: page.locator('textarea[placeholder="文字を入力…"]'),
  });
}

async function readCompositePixels(page: Page): Promise<number[]> {
  return page.locator("canvas.composite-canvas").evaluate((canvas) => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return [];
    return Array.from(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
  });
}

async function countCompositePixelDiff(
  page: Page,
  before: number[],
  tolerance = 8
): Promise<number> {
  const after = await readCompositePixels(page);
  expect(after.length).toBe(before.length);
  let count = 0;
  for (let i = 0; i < before.length; i += 4) {
    if (
      Math.abs(after[i] - before[i]) > tolerance ||
      Math.abs(after[i + 1] - before[i + 1]) > tolerance ||
      Math.abs(after[i + 2] - before[i + 2]) > tolerance ||
      Math.abs(after[i + 3] - before[i + 3]) > tolerance
    ) {
      count += 1;
    }
  }
  return count;
}

async function makeLayeredPsdBuffer(page: Page): Promise<Buffer> {
  const specs: LargePsdLayerSpec[] = [
    {
      name: "paper mark",
      left: 8,
      top: 8,
      width: 20,
      height: 18,
      color: [220, 40, 30, 255],
    },
    {
      name: "middle mark",
      left: 46,
      top: 12,
      width: 22,
      height: 16,
      color: [30, 170, 70, 255],
    },
    {
      name: "top mark",
      left: 34,
      top: 24,
      width: 28,
      height: 20,
      color: [30, 80, 220, 255],
    },
  ];

  const bytes = await page.evaluate(async ({ specs }) => {
    const { makeLargeSparsePsdBlob } = await import(
      "/tests/e2e/large-psd-fixture.ts"
    );
    const blob = makeLargeSparsePsdBlob(96, 64, specs);
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  }, { specs });

  return Buffer.from(bytes);
}

async function expectCompositePixelNear(
  page: Page,
  point: { x: number; y: number },
  expected: [number, number, number, number],
  tolerance = 2
): Promise<void> {
  await expect
    .poll(async () => {
      const actual = await sampleCompositePixel(page, point);
      return actual.every(
        (value, index) => Math.abs(value - expected[index]) <= tolerance
      );
    })
    .toBe(true);
}

async function countPixelsDifferentFrom(
  page: Page,
  region: { x: number; y: number; width: number; height: number },
  expected: [number, number, number, number],
  tolerance = 8
): Promise<number> {
  return page.locator("canvas.composite-canvas").evaluate(
    (canvas, { region, expected, tolerance }) => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return 0;
      const data = ctx.getImageData(
        region.x,
        region.y,
        region.width,
        region.height
      ).data;
      let count = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (
          Math.abs(data[i] - expected[0]) > tolerance ||
          Math.abs(data[i + 1] - expected[1]) > tolerance ||
          Math.abs(data[i + 2] - expected[2]) > tolerance ||
          Math.abs(data[i + 3] - expected[3]) > tolerance
        ) {
          count += 1;
        }
      }
      return count;
    },
    { region, expected, tolerance }
  );
}
