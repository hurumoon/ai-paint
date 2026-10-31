import { expect, test, type Page } from "@playwright/test";
import {
  sampleCompositePixel,
  saveAipaintDownload,
} from "./canvas-helpers";
import type { BlendMode } from "../../src/types";

const RED_PNG_2X2 = [
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 2,
  0, 0, 0, 2, 8, 6, 0, 0, 0, 114, 182, 13, 36, 0, 0, 0, 18, 73, 68, 65, 84,
  120, 1, 98, 250, 207, 192, 240, 31, 132, 153, 24, 160, 0, 0, 0, 0, 255,
  255, 42, 50, 166, 142, 0, 0, 0, 6, 73, 68, 65, 84, 3, 0, 54, 18, 4, 1, 111,
  235, 78, 159, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
];

const BLUE_PNG_2X2 = [
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 2,
  0, 0, 0, 2, 8, 6, 0, 0, 0, 114, 182, 13, 36, 0, 0, 0, 19, 73, 68, 65, 84,
  120, 1, 98, 98, 96, 248, 255, 31, 132, 129, 12, 6, 48, 0, 0, 0, 0, 255,
  255, 174, 90, 255, 126, 0, 0, 0, 6, 73, 68, 65, 84, 3, 0, 50, 22, 4, 1, 231,
  128, 113, 20, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
];

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });
});

test("chains layer reorder, blend mode, merge, and undo through the UI", async ({
  page,
}) => {
  await page.goto("/");
  const fileInput = page.getByTestId("project-file-input");

  await fileInput.setInputFiles({
    name: "red.png",
    mimeType: "image/png",
    buffer: Buffer.from(RED_PNG_2X2),
  });
  await expect(page.locator("canvas.input-canvas")).toHaveAttribute("width", "2");
  await expect(page.locator("canvas.input-canvas")).toHaveAttribute("height", "2");
  await expect.poll(() => sampleCompositePixel(page, { x: 1, y: 1 })).toEqual([
    255,
    0,
    0,
    255,
  ]);

  await fileInput.setInputFiles({
    name: "blue.png",
    mimeType: "image/png",
    buffer: Buffer.from(BLUE_PNG_2X2),
  });
  await expect(layerRows(page)).toHaveCount(3);
  await expect.poll(() => sampleCompositePixel(page, { x: 1, y: 1 })).toEqual([
    0,
    0,
    255,
    255,
  ]);

  await page.getByTestId("layer-blend-mode-select").selectOption("multiply");
  await expect.poll(() => sampleCompositePixel(page, { x: 1, y: 1 })).toEqual([
    0,
    0,
    0,
    255,
  ]);

  await activeLayerRow(page).hover();
  await activeLayerRow(page).getByTestId("layer-move-down").click();
  await expect.poll(() => sampleCompositePixel(page, { x: 1, y: 1 })).toEqual([
    255,
    0,
    0,
    255,
  ]);

  await selectLayerByName(page, "blue.png");
  await activeLayerRow(page).hover();
  await activeLayerRow(page).getByTestId("layer-move-up").click();
  await expect.poll(() => sampleCompositePixel(page, { x: 1, y: 1 })).toEqual([
    0,
    0,
    0,
    255,
  ]);

  await page.getByTestId("layer-merge-down").click();
  await expect(layerRows(page)).toHaveCount(2);
  await expect.poll(() => sampleCompositePixel(page, { x: 1, y: 1 })).toEqual([
    0,
    0,
    0,
    255,
  ]);

  await page.getByTestId("topbar-undo").click();
  await expect(layerRows(page)).toHaveCount(3);
  await expect.poll(() => sampleCompositePixel(page, { x: 1, y: 1 })).toEqual([
    0,
    0,
    0,
    255,
  ]);
});

test("subtract blend mode composites visibly through layer UI", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("project-file-input").setInputFiles({
    name: "subtract-source.aipaint",
    mimeType: "application/x-aipaint",
    buffer: await makeBlendProjectBuffer(page, "normal"),
  });

  await expect(layerRows(page)).toHaveCount(2);
  await selectLayerByName(page, "upper");
  await expect(page.getByTestId("layer-blend-mode-select")).toHaveValue("normal");
  await page.getByTestId("layer-blend-mode-select").selectOption("subtract");

  await expectCompositePixelNear(page, [120, 0, 40, 255]);
});

test("clips a layer, toggles transparent pixel lock, and preserves both after save", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const fileInput = page.getByTestId("project-file-input");
  await fileInput.setInputFiles({
    name: "layer-properties.aipaint",
    mimeType: "application/x-aipaint",
    buffer: await makeLayerPropertiesProjectBuffer(page),
  });

  await selectLayerByName(page, "upper");
  await expect.poll(() => sampleCompositePixel(page, { x: 1, y: 0 })).toEqual([
    0,
    0,
    255,
    255,
  ]);

  await page.getByTitle("下のレイヤーにクリップ").click();
  await expect(activeLayerRow(page).locator(".clip-indicator")).toBeVisible();
  await expect.poll(() => sampleCompositePixel(page, { x: 0, y: 0 })).toEqual([
    0,
    0,
    255,
    255,
  ]);
  await expect.poll(() => sampleCompositePixel(page, { x: 1, y: 0 })).toEqual([
    208,
    208,
    208,
    255,
  ]);

  await page.keyboard.press("Control+Z");
  await expect(activeLayerRow(page).locator(".clip-indicator")).toHaveCount(0);
  await expect.poll(() => sampleCompositePixel(page, { x: 1, y: 0 })).toEqual([
    0,
    0,
    255,
    255,
  ]);

  await page.keyboard.press("Control+Y");
  await expect(activeLayerRow(page).locator(".clip-indicator")).toBeVisible();

  await page.getByTitle("透明ピクセルをロック").click();
  await expect(
    activeLayerRow(page).locator(".transparent-lock-indicator")
  ).toBeVisible();
  await page.keyboard.press("Control+Z");
  await expect(
    activeLayerRow(page).locator(".transparent-lock-indicator")
  ).toHaveCount(0);
  await page.keyboard.press("Control+Y");
  await expect(
    activeLayerRow(page).locator(".transparent-lock-indicator")
  ).toBeVisible();

  const savedPath = await saveAipaintDownload(
    page,
    testInfo,
    "layer-properties"
  );
  await fileInput.setInputFiles(savedPath);
  await selectLayerByName(page, "upper");

  await expect(activeLayerRow(page).locator(".clip-indicator")).toBeVisible();
  await expect(
    activeLayerRow(page).locator(".transparent-lock-indicator")
  ).toBeVisible();
  await expect.poll(() => sampleCompositePixel(page, { x: 1, y: 0 })).toEqual([
    208,
    208,
    208,
    255,
  ]);
});

test("applies opacity and restores visibility through undo and redo", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const fileInput = page.getByTestId("project-file-input");
  await fileInput.setInputFiles({
    name: "layer-opacity.aipaint",
    mimeType: "application/x-aipaint",
    buffer: await makeLayerPropertiesProjectBuffer(page),
  });

  await selectLayerByName(page, "upper");
  const opacitySlider = page
    .locator(".slider")
    .filter({ hasText: "不透明" })
    .locator('input[type="range"]');
  await setRangeValue(opacitySlider, 50);
  await expect(opacitySlider).toHaveValue("50");
  await expectCompositePixelNear(page, [127, 0, 128, 255]);

  await activeLayerRow(page).locator(".visibility").click();
  await expect(activeLayerRow(page).locator(".visibility")).toHaveClass(
    /hidden/
  );
  await expectCompositePixelNear(page, [255, 0, 0, 255]);

  await page.keyboard.press("Control+Z");
  await expect(activeLayerRow(page).locator(".visibility")).not.toHaveClass(
    /hidden/
  );
  await expectCompositePixelNear(page, [127, 0, 128, 255]);

  await page.keyboard.press("Control+Y");
  await expect(activeLayerRow(page).locator(".visibility")).toHaveClass(
    /hidden/
  );

  await page.keyboard.press("Control+Z");
  const savedPath = await saveAipaintDownload(page, testInfo, "layer-opacity");
  await fileInput.setInputFiles(savedPath);
  await selectLayerByName(page, "upper");

  await expect(
    page
      .locator(".slider")
      .filter({ hasText: "不透明" })
      .locator('input[type="range"]')
  ).toHaveValue("50");
  await expectCompositePixelNear(page, [127, 0, 128, 255]);
});

test("native blend modes stay opaque and survive project save reload", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const fileInput = page.getByTestId("project-file-input");
  const modes: BlendMode[] = ["color", "luminosity", "soft-light"];

  for (const mode of modes) {
    await fileInput.setInputFiles({
      name: `${mode}-source.aipaint`,
      mimeType: "application/x-aipaint",
      buffer: await makeBlendProjectBuffer(page, mode),
    });
    await expect(layerRows(page)).toHaveCount(2);
    await selectLayerByName(page, "upper");
    await expect(page.getByTestId("layer-blend-mode-select")).toHaveValue(mode);
    await expectCompositePixelOpaque(page);

    const savedPath = await saveAipaintDownload(page, testInfo, `blend-${mode}`);
    await fileInput.setInputFiles(savedPath);
    await selectLayerByName(page, "upper");
    await expect(page.getByTestId("layer-blend-mode-select")).toHaveValue(mode);
    await expectCompositePixelOpaque(page);
  }
});

function layerRows(page: Page) {
  return page.getByTestId("layer-row");
}

function activeLayerRow(page: Page) {
  return page.locator('[data-testid="layer-row"][data-active="true"]');
}

async function selectLayerByName(page: Page, name: string): Promise<void> {
  await page.locator(`[data-testid="layer-row"][data-layer-name="${name}"]`).click();
}

async function makeBlendProjectBuffer(
  page: Page,
  blendMode: BlendMode
): Promise<Buffer> {
  const bytes = await page.evaluate(
    async ({ blendMode, lower, upper }) => {
      const { PaintDocument } = await import("/src/core/PaintDocument.ts");
      const { saveAiPaint } = await import("/src/core/nativeFormat.ts");

      function makePixelCanvas(rgba: readonly [number, number, number, number]) {
        const canvas = document.createElement("canvas");
        canvas.width = 1;
        canvas.height = 1;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("2d context was not available");
        const data = ctx.createImageData(1, 1);
        data.data.set(rgba);
        ctx.putImageData(data, 0, 0);
        return { canvas, ctx };
      }

      const lowerLayer = makePixelCanvas(lower);
      const upperLayer = makePixelCanvas(upper);
      const doc = new PaintDocument(1, 1, 1);
      doc.replaceLayersFromCanvas(
        [
          {
            meta: {
              id: "lower",
              name: "lower",
              visible: true,
              opacity: 1,
              blendMode: "normal",
              locked: false,
              kind: "raster",
            },
            canvas: lowerLayer.canvas,
            ctx: lowerLayer.ctx,
          },
          {
            meta: {
              id: "upper",
              name: "upper",
              visible: true,
              opacity: 1,
              blendMode,
              locked: false,
              kind: "raster",
            },
            canvas: upperLayer.canvas,
            ctx: upperLayer.ctx,
          },
        ],
        "upper"
      );

      const blob = await saveAiPaint(doc);
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    },
    {
      blendMode,
      lower: [200, 100, 50, 255] as const,
      upper: [80, 120, 10, 255] as const,
    }
  );
  return Buffer.from(bytes);
}

async function makeLayerPropertiesProjectBuffer(page: Page): Promise<Buffer> {
  const bytes = await page.evaluate(async () => {
    const { PaintDocument } = await import("/src/core/PaintDocument.ts");
    const { saveAiPaint } = await import("/src/core/nativeFormat.ts");

    function makePixelCanvas(
      pixels: readonly (readonly [number, number, number, number])[]
    ) {
      const canvas = document.createElement("canvas");
      canvas.width = pixels.length;
      canvas.height = 1;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("2d context was not available");
      const data = ctx.createImageData(pixels.length, 1);
      pixels.forEach((pixel, index) => {
        data.data.set(pixel, index * 4);
      });
      ctx.putImageData(data, 0, 0);
      return { canvas, ctx };
    }

    const lowerLayer = makePixelCanvas([
      [255, 0, 0, 255],
      [0, 0, 0, 0],
    ]);
    const upperLayer = makePixelCanvas([
      [0, 0, 255, 255],
      [0, 0, 255, 255],
    ]);
    const doc = new PaintDocument(2, 1, 1);
    doc.replaceLayersFromCanvas(
      [
        {
          meta: {
            id: "lower",
            name: "lower",
            visible: true,
            opacity: 1,
            blendMode: "normal",
            locked: false,
            kind: "raster",
          },
          canvas: lowerLayer.canvas,
          ctx: lowerLayer.ctx,
        },
        {
          meta: {
            id: "upper",
            name: "upper",
            visible: true,
            opacity: 1,
            blendMode: "normal",
            locked: false,
            transparentPixelLock: false,
            clippingMask: false,
            kind: "raster",
          },
          canvas: upperLayer.canvas,
          ctx: upperLayer.ctx,
        },
      ],
      "upper"
    );

    const blob = await saveAiPaint(doc);
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  return Buffer.from(bytes);
}

async function setRangeValue(
  locator: ReturnType<Page["locator"]>,
  value: number
): Promise<void> {
  await locator.evaluate((input, nextValue) => {
    const range = input as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set;
    setter?.call(range, String(nextValue));
    range.dispatchEvent(new Event("input", { bubbles: true }));
    range.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

async function expectCompositePixelNear(
  page: Page,
  expected: [number, number, number, number],
  tolerance = 2
): Promise<void> {
  await expect
    .poll(async () => {
      const actual = await sampleCompositePixel(page, { x: 0, y: 0 });
      return actual.every(
        (value, index) => Math.abs(value - expected[index]) <= tolerance
      );
    })
    .toBe(true);
}

async function expectCompositePixelOpaque(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      const [r, g, b, a] = await sampleCompositePixel(page, { x: 0, y: 0 });
      return a === 255 && (r > 0 || g > 0 || b > 0);
    })
    .toBe(true);
}
