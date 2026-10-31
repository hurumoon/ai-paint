import { expect, type Page, type TestInfo } from "@playwright/test";

export interface CanvasSize {
  width: number;
  height: number;
  dpi: number;
}

export interface CanvasRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasPoint {
  x: number;
  y: number;
}

export async function createCanvas(
  page: Page,
  { width, height, dpi }: CanvasSize = { width: 320, height: 240, dpi: 144 }
): Promise<void> {
  await expect(page.locator(".empty-canvas-title")).toBeVisible();
  await page.getByTestId("topbar-newCanvas").click();

  const dialog = page.getByTestId("new-canvas-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("new-canvas-width").fill(String(width));
  await dialog.getByTestId("new-canvas-height").fill(String(height));
  await dialog.getByTestId("new-canvas-dpi").fill(String(dpi));
  await dialog.getByTestId("new-canvas-create").click();

  const inputCanvas = page.locator("canvas.input-canvas");
  await expect(inputCanvas).toBeVisible();
  await expect(inputCanvas).toHaveAttribute("width", String(width));
  await expect(inputCanvas).toHaveAttribute("height", String(height));
}

export async function drawHorizontalStroke(page: Page): Promise<CanvasRegion> {
  const inputCanvas = page.locator("canvas.input-canvas");
  const box = await inputCanvas.boundingBox();
  expect(box).not.toBeNull();
  if (!box) {
    throw new Error("input canvas bounding box was not available");
  }

  await page.mouse.move(box.x + box.width / 2 - 24, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 24, box.y + box.height / 2, {
    steps: 8,
  });
  await page.mouse.up();

  const width = Number(await inputCanvas.getAttribute("width"));
  const height = Number(await inputCanvas.getAttribute("height"));
  return {
    x: Math.floor(width / 2 - 32),
    y: Math.floor(height / 2 - 16),
    width: 64,
    height: 32,
  };
}

export async function clickDocumentPoint(
  page: Page,
  point: CanvasPoint
): Promise<void> {
  const screen = await documentPointToScreen(page, point);
  await page.mouse.click(screen.x, screen.y);
}

export async function dragDocumentPoints(
  page: Page,
  from: CanvasPoint,
  to: CanvasPoint,
  steps = 8
): Promise<void> {
  const start = await documentPointToScreen(page, from);
  const end = await documentPointToScreen(page, to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps });
  await page.mouse.up();
}

export async function fillCanvasWithBucket(page: Page): Promise<CanvasRegion> {
  await page.keyboard.press("g");

  const inputCanvas = page.locator("canvas.input-canvas");
  const box = await inputCanvas.boundingBox();
  expect(box).not.toBeNull();
  if (!box) {
    throw new Error("input canvas bounding box was not available");
  }

  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  const width = Number(await inputCanvas.getAttribute("width"));
  const height = Number(await inputCanvas.getAttribute("height"));
  return { x: 0, y: 0, width, height };
}

export async function countDarkCompositePixels(
  page: Page,
  region: CanvasRegion
): Promise<number> {
  return page.locator("canvas.composite-canvas").evaluate((canvas, sampleRegion) => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return 0;
    const data = ctx.getImageData(
      sampleRegion.x,
      sampleRegion.y,
      sampleRegion.width,
      sampleRegion.height
    ).data;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      if (a > 0 && r < 96 && g < 96 && b < 96) {
        count += 1;
      }
    }
    return count;
  }, region);
}

export async function sampleCompositePixel(
  page: Page,
  point: CanvasPoint
): Promise<[number, number, number, number]> {
  return page.locator("canvas.composite-canvas").evaluate((canvas, samplePoint) => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return [0, 0, 0, 0];
    const data = ctx.getImageData(samplePoint.x, samplePoint.y, 1, 1).data;
    return [data[0], data[1], data[2], data[3]];
  }, point) as Promise<[number, number, number, number]>;
}

export async function saveAipaintDownload(
  page: Page,
  testInfo: TestInfo,
  fileStem: string
): Promise<string> {
  await page.getByTestId("topbar-export").click();
  const dialog = page.getByTestId("export-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("export-format-aipaint").check();

  const saveButton = dialog.getByTestId("export-save");
  await expect(saveButton).toBeEnabled();
  const downloadPromise = page.waitForEvent("download");
  await saveButton.click();
  const download = await downloadPromise;

  const savedPath = testInfo.outputPath(`${fileStem}.aipaint`);
  await download.saveAs(savedPath);
  await expect(dialog).toBeHidden();
  return savedPath;
}

async function documentPointToScreen(
  page: Page,
  point: CanvasPoint
): Promise<CanvasPoint> {
  const inputCanvas = page.locator("canvas.input-canvas");
  await expect(inputCanvas).toBeVisible();
  const box = await inputCanvas.boundingBox();
  expect(box).not.toBeNull();
  if (!box) {
    throw new Error("input canvas bounding box was not available");
  }
  const width = Number(await inputCanvas.getAttribute("width"));
  const height = Number(await inputCanvas.getAttribute("height"));
  return {
    x: box.x + (point.x / width) * box.width,
    y: box.y + (point.y / height) * box.height,
  };
}
