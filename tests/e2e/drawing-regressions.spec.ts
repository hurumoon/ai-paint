import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });
});

test("draws thick brush strokes across TileStore tile boundaries", async ({ page }) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const { TileStore } = await import("/src/core/TileStore.ts");
    const { beginStroke, continueStroke } = await import("/src/core/brushEngine.ts");
    const { brushStrokeBounds } = await import("/src/core/brushDynamics.ts");

    const store = new TileStore(300, 40);
    const settings = {
      kind: "round",
      size: 18,
      opacity: 1,
      color: "#d4142a",
      pressureSize: 0,
      pressureOpacity: 0,
    } as const;
    const start = { x: 252, y: 20, pressure: 0.5 };
    const end = { x: 260, y: 20, pressure: 0.5 };
    const hint = brushStrokeBounds(start, end, settings);

    store.withCtx((ctx) => {
      beginStroke(ctx, start, settings);
      continueStroke(ctx, start, end, settings);
    }, hint);

    const sample = store.getImageData(250, 15, 12, 11).data;
    function pixelAt(x: number, y: number): number[] {
      const index = ((y - 15) * 12 + (x - 250)) * 4;
      return Array.from(sample.slice(index, index + 4));
    }
    const centerLeft = pixelAt(255, 20);
    const centerRight = pixelAt(256, 20);
    let leftTilePainted = 0;
    let rightTilePainted = 0;
    for (let y = 0; y < 11; y += 1) {
      for (let x = 0; x < 12; x += 1) {
        const alpha = sample[(y * 12 + x) * 4 + 3];
        if (alpha === 0) continue;
        if (250 + x < 256) {
          leftTilePainted += 1;
        } else {
          rightTilePainted += 1;
        }
      }
    }

    return {
      bounds: store.getAlphaBounds(),
      centerLeft,
      centerRight,
      hint,
      leftTilePainted,
      rightTilePainted,
    };
  });

  expect(result.centerLeft).toEqual([212, 20, 42, 255]);
  expect(result.centerRight).toEqual([212, 20, 42, 255]);
  expect(result.hint).toEqual({ x: 230, y: -2, w: 52, h: 44 });
  expect(result.leftTilePainted).toBeGreaterThan(45);
  expect(result.rightTilePainted).toBeGreaterThan(45);
  expect(result.bounds).toEqual({ x: 243, y: 11, w: 26, h: 18 });
});

test("commits line-width shape strokes across tile boundaries", async ({ page }) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const { PaintDocument } = await import("/src/core/PaintDocument.ts");
    const { History } = await import("/src/core/History.ts");
    const { Timelapse } = await import("/src/core/Timelapse.ts");
    const { commitShape } = await import("/src/core/toolHandlers.ts");

    const doc = new PaintDocument(300, 40, 1);
    const history = new History();
    const timelapse = new Timelapse();
    const layer = doc.getActiveLayer();
    if (!layer) throw new Error("active layer was not available");

    await commitShape(
      doc,
      history,
      timelapse,
      {
        kind: "line",
        x1: 252,
        y1: 20,
        x2: 260,
        y2: 20,
        color: "#000000",
        strokeColor: "#0c58ff",
        strokeWidth: 12,
        fill: false,
        stroke: true,
      },
      { kind: "none" }
    );

    const sample = layer.store.getImageData(254, 12, 5, 17).data;
    function alphaAt(x: number, y: number): number {
      return sample[((y - 12) * 5 + (x - 254)) * 4 + 3];
    }
    function pixelAt(x: number, y: number): number[] {
      const index = ((y - 12) * 5 + (x - 254)) * 4;
      return Array.from(sample.slice(index, index + 4));
    }

    let topHalf = 0;
    let bottomHalf = 0;
    for (let y = 12; y < 29; y += 1) {
      for (let x = 254; x < 259; x += 1) {
        const alpha = alphaAt(x, y);
        if (alpha === 0) continue;
        if (y < 20) topHalf += 1;
        if (y > 20) bottomHalf += 1;
      }
    }

    return {
      bounds: layer.store.getAlphaBounds(),
      centerLeft: pixelAt(255, 20),
      centerRight: pixelAt(256, 20),
      topEdgeAlpha: alphaAt(256, 14),
      bottomEdgeAlpha: alphaAt(256, 25),
      outsideAlpha: alphaAt(256, 27),
      topHalf,
      bottomHalf,
    };
  });

  expect(result.centerLeft).toEqual([12, 88, 255, 255]);
  expect(result.centerRight).toEqual([12, 88, 255, 255]);
  expect(result.topEdgeAlpha).toBeGreaterThan(0);
  expect(result.bottomEdgeAlpha).toBeGreaterThan(0);
  expect(result.outsideAlpha).toBe(0);
  expect(result.topHalf).toBeGreaterThan(20);
  expect(result.bottomHalf).toBeGreaterThan(20);
  expect(result.bounds?.x).toBeLessThanOrEqual(252);
  expect(result.bounds?.x + result.bounds?.w).toBeGreaterThanOrEqual(260);
});

test("applies blur, gradient, and transparent pixel lock through selections", async ({ page }) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const { PaintDocument } = await import("/src/core/PaintDocument.ts");
    const { History } = await import("/src/core/History.ts");
    const { Timelapse } = await import("/src/core/Timelapse.ts");
    const { applyBlur, applyGradient } = await import("/src/core/toolHandlers.ts");

    const blurDoc = new PaintDocument(6, 1, 1);
    const blurLayer = blurDoc.getActiveLayer();
    if (!blurLayer) throw new Error("blur layer was not available");
    const blurPixels = new ImageData(6, 1);
    blurPixels.data.set([0, 0, 0, 0], 0);
    blurPixels.data.set([0, 0, 0, 255], 4);
    blurPixels.data.set([0, 0, 0, 0], 8);
    blurPixels.data.set([0, 0, 0, 255], 12);
    blurPixels.data.set([0, 0, 0, 0], 16);
    blurPixels.data.set([0, 0, 0, 0], 20);
    blurLayer.store.putImageData(blurPixels, 0, 0);

    const blurMask = new Uint8ClampedArray(3 * 1 * 4);
    blurMask[1 * 4 + 3] = 255;
    await applyBlur(
      blurDoc,
      new History(),
      new Timelapse(),
      1,
      {
        kind: "mask",
        data: blurMask,
        maskWidth: 3,
        maskHeight: 1,
        x: 1,
        y: 0,
        w: 3,
        h: 1,
      }
    );
    const blurred = Array.from(blurLayer.store.getImageData(0, 0, 5, 1).data);

    const gradientDoc = new PaintDocument(4, 1, 1);
    const gradientLayer = gradientDoc.getActiveLayer();
    if (!gradientLayer) throw new Error("gradient layer was not available");
    const gradientPixels = new ImageData(4, 1);
    gradientPixels.data.set([1, 2, 3, 0], 0);
    gradientPixels.data.set([20, 40, 60, 80], 4);
    gradientPixels.data.set([80, 100, 120, 255], 8);
    gradientPixels.data.set([7, 8, 9, 0], 12);
    gradientLayer.store.putImageData(gradientPixels, 0, 0);
    gradientLayer.meta.transparentPixelLock = true;

    await applyGradient(
      gradientDoc,
      new History(),
      new Timelapse(),
      "linear",
      { x: 1, y: 0, color: "#ff0000", alpha: 1 },
      { x: 2, y: 0, color: "#0000ff", alpha: 1 },
      { kind: "rect", x: 1, y: 0, w: 2, h: 1 }
    );
    const gradient = Array.from(gradientLayer.store.getImageData(0, 0, 4, 1).data);

    return { blurred, gradient };
  });

  expect(result.blurred.slice(4, 8)).toEqual([0, 0, 0, 255]);
  expect(result.blurred[8 + 3]).toBeGreaterThan(0);
  expect(result.blurred.slice(12, 16)).toEqual([0, 0, 0, 255]);
  expect(result.blurred.slice(0, 4)).toEqual([0, 0, 0, 0]);
  expect(result.blurred.slice(16, 20)).toEqual([0, 0, 0, 0]);

  expect(result.gradient[3]).toBe(0);
  expect(result.gradient[4]).toBeGreaterThan(200);
  expect(result.gradient[5]).toBeLessThan(20);
  expect(result.gradient[6]).toBeLessThan(40);
  expect(result.gradient[7]).toBe(80);
  expect(result.gradient[8]).toBeLessThan(40);
  expect(result.gradient[9]).toBeLessThan(20);
  expect(result.gradient[10]).toBeGreaterThan(200);
  expect(result.gradient[11]).toBe(255);
  expect(result.gradient[15]).toBe(0);
});
