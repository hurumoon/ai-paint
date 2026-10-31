import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });
});

test("CanvasRenderer partial dirty redraw matches a full redraw", async ({ page }) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const { CanvasRenderer } = await import("/src/core/CanvasRenderer.ts");
    const { PaintDocument } = await import("/src/core/PaintDocument.ts");

    function pixel(data: ImageData, x: number, y: number): number[] {
      const i = (y * data.width + x) * 4;
      return Array.from(data.data.slice(i, i + 4));
    }

    async function waitFrame(): Promise<void> {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }

    const doc = new PaintDocument(4, 4, 1);
    const layer = doc.getActiveLayer();
    if (!layer) throw new Error("active layer was not available");
    layer.store.withCtx((ctx) => {
      ctx.fillStyle = "rgba(200, 20, 30, 1)";
      ctx.fillRect(1, 1, 1, 1);
    }, { x: 1, y: 1, w: 1, h: 1 });

    const canvas = document.createElement("canvas");
    const renderer = new CanvasRenderer(canvas, doc);
    renderer.invalidate();
    await waitFrame();

    layer.store.withCtx((ctx) => {
      ctx.fillStyle = "rgba(20, 180, 40, 1)";
      ctx.fillRect(2, 1, 1, 1);
    }, { x: 2, y: 1, w: 1, h: 1 });
    renderer.invalidate({ x: 2, y: 1, w: 1, h: 1 });
    await waitFrame();

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d context was not available");
    const partial = ctx.getImageData(0, 0, 4, 4);

    renderer.invalidate();
    await waitFrame();
    const full = ctx.getImageData(0, 0, 4, 4);
    renderer.dispose();

    return {
      partial: Array.from(partial.data),
      full: Array.from(full.data),
      red: pixel(full, 1, 1),
      green: pixel(full, 2, 1),
    };
  });

  expect(result.partial).toEqual(result.full);
  expect(result.red).toEqual([200, 20, 30, 255]);
  expect(result.green).toEqual([20, 180, 40, 255]);
});

test("CanvasRenderer preserves clipping mask fallback output", async ({ page }) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const { CanvasRenderer } = await import("/src/core/CanvasRenderer.ts");
    const { PaintDocument } = await import("/src/core/PaintDocument.ts");

    function makeCanvas(width: number, height: number) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("2d context was not available");
      return { canvas, ctx };
    }

    function pixel(data: ImageData, x: number, y: number): number[] {
      const i = (y * data.width + x) * 4;
      return Array.from(data.data.slice(i, i + 4));
    }

    async function waitFrame(): Promise<void> {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }

    const doc = new PaintDocument(4, 4, 1);
    const base = makeCanvas(4, 4);
    base.ctx.fillStyle = "rgba(20, 60, 220, 1)";
    base.ctx.fillRect(1, 1, 1, 1);
    const clip = makeCanvas(4, 4);
    clip.ctx.fillStyle = "rgba(220, 30, 20, 1)";
    clip.ctx.fillRect(0, 0, 4, 4);

    doc.replaceLayersFromCanvas(
      [
        {
          meta: {
            id: "base",
            name: "base",
            visible: true,
            opacity: 1,
            blendMode: "normal",
            locked: false,
            kind: "raster",
          },
          canvas: base.canvas,
          ctx: base.ctx,
        },
        {
          meta: {
            id: "clip",
            name: "clip",
            visible: true,
            opacity: 1,
            blendMode: "normal",
            locked: false,
            kind: "raster",
            clippingMask: true,
          },
          canvas: clip.canvas,
          ctx: clip.ctx,
        },
      ],
      "clip"
    );

    const canvas = document.createElement("canvas");
    const renderer = new CanvasRenderer(canvas, doc);
    renderer.invalidate({ x: 0, y: 0, w: 4, h: 4 });
    await waitFrame();
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d context was not available");
    const data = ctx.getImageData(0, 0, 4, 4);
    renderer.dispose();

    return {
      clipped: pixel(data, 1, 1),
      outside: pixel(data, 0, 0),
    };
  });

  expect(result.clipped).toEqual([220, 30, 20, 255]);
  expect(result.outside).not.toEqual([220, 30, 20, 255]);
});

test("compositeLayers scopes full redraw intermediates to sparse group bounds", async ({
  page,
}) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const { PaintDocument } = await import("/src/core/PaintDocument.ts");
    const { compositeLayers } = await import("/src/core/composite.ts");
    const { sharedCanvasPool } = await import("/src/core/canvasPool.ts");

    function makeFilledCanvas(width: number, height: number, fillStyle: string) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("2d context was not available");
      ctx.fillStyle = fillStyle;
      ctx.fillRect(0, 0, width, height);
      return { canvas, ctx };
    }

    function pixelAt(ctx: CanvasRenderingContext2D, x: number, y: number): number[] {
      return Array.from(ctx.getImageData(x, y, 1, 1).data);
    }

    const doc = new PaintDocument(2048, 2048, 1);
    const base = makeFilledCanvas(24, 20, "rgba(20, 60, 220, 1)");
    const clip = makeFilledCanvas(64, 64, "rgba(220, 30, 20, 1)");

    doc.replaceLayersFromCanvas(
      [
        {
          meta: {
            id: "group",
            name: "group",
            visible: true,
            opacity: 1,
            blendMode: "normal",
            locked: false,
            kind: "group",
          },
          canvas: null,
          ctx: null,
        },
        {
          meta: {
            id: "base",
            name: "base",
            visible: true,
            opacity: 1,
            blendMode: "normal",
            locked: false,
            kind: "raster",
            parentId: "group",
          },
          canvas: base.canvas,
          ctx: base.ctx,
          deferred: { offsetX: 100, offsetY: 200, bboxWidth: 24, bboxHeight: 20 },
        },
        {
          meta: {
            id: "clip",
            name: "clip",
            visible: true,
            opacity: 1,
            blendMode: "normal",
            locked: false,
            kind: "raster",
            parentId: "group",
            clippingMask: true,
          },
          canvas: clip.canvas,
          ctx: clip.ctx,
          deferred: { offsetX: 80, offsetY: 190, bboxWidth: 64, bboxHeight: 64 },
        },
      ],
      "clip"
    );

    const acquisitions: { width: number; height: number }[] = [];
    const originalAcquire = sharedCanvasPool.acquire.bind(sharedCanvasPool);
    sharedCanvasPool.clear();
    sharedCanvasPool.acquire = ((width: number, height: number) => {
      acquisitions.push({ width, height });
      return originalAcquire(width, height);
    }) as typeof sharedCanvasPool.acquire;

    const canvas = document.createElement("canvas");
    canvas.width = doc.width;
    canvas.height = doc.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d context was not available");

    try {
      compositeLayers(ctx, doc, doc.layers, undefined);
    } finally {
      sharedCanvasPool.acquire = originalAcquire as typeof sharedCanvasPool.acquire;
      sharedCanvasPool.clear();
    }

    return {
      acquisitions,
      clipped: pixelAt(ctx, 100, 200),
      outside: pixelAt(ctx, 80, 190),
    };
  });

  expect(result.acquisitions).not.toContainEqual({ width: 2048, height: 2048 });
  expect(result.acquisitions.length).toBeGreaterThan(0);
  expect(result.acquisitions.every((size) => size.width <= 24 && size.height <= 20)).toBe(true);
  expect(result.clipped).toEqual([220, 30, 20, 255]);
  expect(result.outside).toEqual([0, 0, 0, 0]);
});

test("compositeLayers renders extended blend modes", async ({ page }) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const { PaintDocument } = await import("/src/core/PaintDocument.ts");
    const { compositeLayers } = await import("/src/core/composite.ts");
    const { compositeBlendPixel } = await import("/src/core/blendModes.ts");

    const modes = [
      "subtract",
      "soft-light",
      "difference",
      "color",
      "luminosity",
    ] as const;

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

    function pixel(ctx: CanvasRenderingContext2D): number[] {
      return Array.from(ctx.getImageData(0, 0, 1, 1).data);
    }

    const backdrop = [100, 150, 200, 255] as const;
    const source = [200, 60, 40, 255] as const;
    return modes.map((mode) => {
      const lower = makePixelCanvas(backdrop);
      const upper = makePixelCanvas(source);
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
            canvas: lower.canvas,
            ctx: lower.ctx,
          },
          {
            meta: {
              id: "upper",
              name: "upper",
              visible: true,
              opacity: 1,
              blendMode: mode,
              locked: false,
              kind: "raster",
            },
            canvas: upper.canvas,
            ctx: upper.ctx,
          },
        ],
        "upper"
      );

      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("2d context was not available");
      compositeLayers(ctx, doc, doc.layers, undefined);
      return {
        mode,
        actual: pixel(ctx),
        expected: compositeBlendPixel(mode, backdrop, source, 1),
      };
    });
  });

  for (const entry of result) {
    for (let i = 0; i < 4; i += 1) {
      expect(entry.actual[i], `${entry.mode}[${i}]`).toBeGreaterThanOrEqual(
        entry.expected[i] - 2
      );
      expect(entry.actual[i], `${entry.mode}[${i}]`).toBeLessThanOrEqual(
        entry.expected[i] + 2
      );
    }
  }
});

test("subtract blend falls back on transformed canvas contexts", async ({ page }) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const { drawCanvasWithBlendMode } = await import("/src/core/composite.ts");
    const { compositeBlendPixel } = await import("/src/core/blendModes.ts");

    function makePixelCanvas(rgba: readonly [number, number, number, number]) {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("2d context was not available");
      const data = ctx.createImageData(1, 1);
      data.data.set(rgba);
      ctx.putImageData(data, 0, 0);
      return canvas;
    }

    function pixel(ctx: CanvasRenderingContext2D, x: number, y: number): number[] {
      return Array.from(ctx.getImageData(x, y, 1, 1).data);
    }

    const backdrop = [100, 150, 200, 255] as const;
    const source = [200, 60, 40, 255] as const;
    const canvas = document.createElement("canvas");
    canvas.width = 5;
    canvas.height = 5;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d context was not available");
    const bg = ctx.createImageData(5, 5);
    for (let i = 0; i < bg.data.length; i += 4) {
      bg.data.set(backdrop, i);
    }
    ctx.putImageData(bg, 0, 0);

    // 90 度回転 + 2 倍 scale。doc-space composite 以外の将来経路でも
    // subtract だけが transform 前提で落ちないことを固定する。
    ctx.setTransform(0, 2, -2, 0, 4, 0);
    drawCanvasWithBlendMode(ctx, makePixelCanvas(source), 1, 1, "subtract", 1);

    return {
      affected: pixel(ctx, 1, 2),
      outside: pixel(ctx, 4, 4),
      expected: compositeBlendPixel("subtract", backdrop, source, 1),
      backdrop,
    };
  });

  expect(result.affected).toEqual(result.expected);
  expect(result.outside).toEqual(result.backdrop);
});

test("CanvasRenderer preserves non-normal blend fallback output above active layer", async ({ page }) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const { CanvasRenderer } = await import("/src/core/CanvasRenderer.ts");
    const { PaintDocument } = await import("/src/core/PaintDocument.ts");

    function makeFilledCanvas(width: number, height: number, fillStyle: string) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("2d context was not available");
      ctx.fillStyle = fillStyle;
      ctx.fillRect(0, 0, width, height);
      return { canvas, ctx };
    }

    function pixel(data: ImageData, x: number, y: number): number[] {
      const i = (y * data.width + x) * 4;
      return Array.from(data.data.slice(i, i + 4));
    }

    async function waitFrame(): Promise<void> {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }

    const doc = new PaintDocument(3, 3, 1);
    const active = makeFilledCanvas(3, 3, "rgba(100, 100, 100, 1)");
    const multiply = makeFilledCanvas(3, 3, "rgba(200, 200, 200, 1)");
    doc.replaceLayersFromCanvas(
      [
        {
          meta: {
            id: "active",
            name: "active",
            visible: true,
            opacity: 1,
            blendMode: "normal",
            locked: false,
            kind: "raster",
          },
          canvas: active.canvas,
          ctx: active.ctx,
        },
        {
          meta: {
            id: "multiply",
            name: "multiply",
            visible: true,
            opacity: 1,
            blendMode: "multiply",
            locked: false,
            kind: "raster",
          },
          canvas: multiply.canvas,
          ctx: multiply.ctx,
        },
      ],
      "active"
    );

    const canvas = document.createElement("canvas");
    const renderer = new CanvasRenderer(canvas, doc);
    renderer.invalidate({ x: 1, y: 1, w: 1, h: 1 });
    await waitFrame();
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d context was not available");
    const data = ctx.getImageData(0, 0, 3, 3);
    renderer.dispose();
    return pixel(data, 1, 1);
  });

  expect(result[0]).toBeGreaterThanOrEqual(77);
  expect(result[0]).toBeLessThanOrEqual(79);
  expect(result[1]).toBeGreaterThanOrEqual(77);
  expect(result[1]).toBeLessThanOrEqual(79);
  expect(result[2]).toBeGreaterThanOrEqual(77);
  expect(result[2]).toBeLessThanOrEqual(79);
  expect(result[3]).toBe(255);
});
