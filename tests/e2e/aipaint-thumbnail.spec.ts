import { expect, test } from "@playwright/test";
import { unzipSync } from "fflate";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto("/");
});

test(".aipaint thumbnail composites directly at its reduced size", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { PaintDocument } = await import("/src/core/PaintDocument.ts");
    const { createThumbnailPng } = await import("/src/core/nativeFormatParts/thumbnail.ts");
    const { sharedCanvasPool } = await import("/src/core/canvasPool.ts");

    const width = 4100;
    const height = 2051;
    const doc = new PaintDocument(width, height, 1);
    const makeCanvas = (w: number, h: number, color: string) => {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("2d context was not available");
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, w, h);
      return { canvas, ctx };
    };
    const base = makeCanvas(700, 600, "rgba(20, 60, 220, 1)");
    const clip = makeCanvas(900, 800, "rgba(220, 30, 20, 1)");
    const subtract = makeCanvas(300, 200, "rgba(30, 100, 40, 1)");
    doc.replaceLayersFromCanvas(
      [
        {
          meta: { id: "group", name: "group", visible: true, opacity: 1, blendMode: "normal", locked: false, kind: "group" },
          canvas: null, ctx: null,
        },
        {
          meta: { id: "base", name: "base", visible: true, opacity: 1, blendMode: "normal", locked: false, kind: "raster", parentId: "group" },
          canvas: base.canvas, ctx: base.ctx,
          deferred: { offsetX: 900, offsetY: 500, bboxWidth: 700, bboxHeight: 600 },
        },
        {
          meta: { id: "clip", name: "clip", visible: true, opacity: 1, blendMode: "normal", locked: false, kind: "raster", parentId: "group", clippingMask: true },
          canvas: clip.canvas, ctx: clip.ctx,
          deferred: { offsetX: 800, offsetY: 400, bboxWidth: 900, bboxHeight: 800 },
        },
        {
          meta: { id: "subtract", name: "subtract", visible: true, opacity: 1, blendMode: "subtract", locked: false, kind: "raster" },
          canvas: subtract.canvas, ctx: subtract.ctx,
          deferred: { offsetX: 3000, offsetY: 1200, bboxWidth: 300, bboxHeight: 200 },
        },
      ],
      "subtract"
    );

    // TileStore を実際にタイル運用へ移し、縮小倍率が非整数でも境界が欠けないことを確認する。
    const active = doc.getLayer("base");
    if (!active) throw new Error("base layer was not available");
    active.store.withCtx((ctx) => {
      ctx.fillStyle = "rgba(20, 60, 220, 1)";
      ctx.fillRect(255, 0, 2, 600);
    }, { x: 255, y: 0, w: 2, h: 600 });

    const before = doc.layers.map((layer) => ({
      deferred: layer.deferred ? { ...layer.deferred } : null,
      width: layer.store.width,
      height: layer.store.height,
    }));
    const allocations: { width: number; height: number }[] = [];
    const widthDescriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "width")!;
    const heightDescriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "height")!;
    const NativeOffscreenCanvas = window.OffscreenCanvas;
    const originalCreateImageBitmap = window.createImageBitmap;
    const originalAcquire = sharedCanvasPool.acquire.bind(sharedCanvasPool);
    let bitmapCalls = 0;
    for (const [key, descriptor] of [["width", widthDescriptor], ["height", heightDescriptor]] as const) {
      Object.defineProperty(HTMLCanvasElement.prototype, key, {
        ...descriptor,
        set(this: HTMLCanvasElement, value: number) {
          descriptor.set!.call(this, value);
          allocations.push({ width: this.width, height: this.height });
        },
      });
    }
    window.OffscreenCanvas = new Proxy(NativeOffscreenCanvas, {
      construct(target, args: [number, number]) {
        allocations.push({ width: args[0], height: args[1] });
        return new target(...args);
      },
    });
    window.createImageBitmap = (() => {
      bitmapCalls += 1;
      throw new Error("thumbnail generation must not decode a flattened bitmap");
    }) as typeof createImageBitmap;
    sharedCanvasPool.clear();
    sharedCanvasPool.acquire = ((w: number, h: number) => {
      allocations.push({ width: w, height: h });
      return originalAcquire(w, h);
    }) as typeof sharedCanvasPool.acquire;

    let png: Uint8Array;
    try {
      png = await createThumbnailPng(doc);
    } finally {
      sharedCanvasPool.acquire = originalAcquire as typeof sharedCanvasPool.acquire;
      sharedCanvasPool.clear();
      window.createImageBitmap = originalCreateImageBitmap;
      window.OffscreenCanvas = NativeOffscreenCanvas;
      Object.defineProperty(HTMLCanvasElement.prototype, "width", widthDescriptor);
      Object.defineProperty(HTMLCanvasElement.prototype, "height", heightDescriptor);
    }

    const bitmap = await createImageBitmap(new Blob([png], { type: "image/png" }));
    const output = document.createElement("canvas");
    output.width = bitmap.width;
    output.height = bitmap.height;
    const outputCtx = output.getContext("2d");
    if (!outputCtx) throw new Error("2d context was not available");
    outputCtx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const pixel = (x: number, y: number) => Array.from(outputCtx.getImageData(x, y, 1, 1).data);
    const after = doc.layers.map((layer) => ({
      deferred: layer.deferred ? { ...layer.deferred } : null,
      width: layer.store.width,
      height: layer.store.height,
    }));
    return {
      size: { width: output.width, height: output.height },
      allocations,
      bitmapCalls,
      clipped: pixel(600, 400),
      outsideClip: pixel(430, 250),
      customBlend: pixel(1520, 620),
      tileBoundary: [575, 576, 577, 578, 579, 580].map(x => pixel(x, 400)),
      before,
      after,
    };
  });

  expect(result.size).toEqual({ width: 2048, height: 1024 });
  expect(result.bitmapCalls).toBe(0);
  expect(result.allocations.every(({ width, height }) => width <= 2048 && height <= 1024)).toBe(true);
  expect(result.clipped).toEqual([220, 30, 20, 255]);
  expect(result.outsideClip).toEqual([255, 255, 255, 255]);
  expect(result.customBlend).toEqual([225, 155, 215, 255]);
  expect(result.tileBoundary).toEqual(Array.from({ length: 6 }, () => [220, 30, 20, 255]));
  expect(result.after).toEqual(result.before);
});

test("small thumbnails retain the existing flattened pixels and save embeds thumbnail.png", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { PaintDocument } = await import("/src/core/PaintDocument.ts");
    const { createThumbnailPng } = await import("/src/core/nativeFormatParts/thumbnail.ts");
    const { flattenDocumentToBlob } = await import("/src/core/paintDocumentExport.ts");
    const { saveAiPaint } = await import("/src/core/nativeFormat.ts");
    const doc = new PaintDocument(16, 12, 1);
    const layer = doc.getActiveLayer();
    if (!layer) throw new Error("active layer was not available");
    layer.store.withCtx((ctx) => {
      ctx.fillStyle = "rgba(40, 120, 220, 1)";
      ctx.fillRect(2, 3, 9, 5);
    }, { x: 2, y: 3, w: 9, h: 5 });
    const [thumbnail, flattened, archive] = await Promise.all([
      createThumbnailPng(doc),
      flattenDocumentToBlob(doc),
      saveAiPaint(doc),
    ]);
    const decode = async (blob: Blob) => {
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("2d context was not available");
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      return { width: canvas.width, height: canvas.height, pixels: Array.from(ctx.getImageData(0, 0, canvas.width, canvas.height).data) };
    };
    return {
      thumbnail: await decode(new Blob([thumbnail], { type: "image/png" })),
      flattened: await decode(flattened),
      archive: Array.from(new Uint8Array(await archive.arrayBuffer())),
    };
  });

  expect(result.thumbnail.width).toBe(16);
  expect(result.thumbnail.height).toBe(12);
  expect(result.thumbnail.pixels).toEqual(result.flattened.pixels);
  expect(unzipSync(new Uint8Array(result.archive))["thumbnail.png"]).toBeDefined();
});
