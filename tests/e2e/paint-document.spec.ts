import { expect, test } from "@playwright/test";
import type { LargePsdLayerSpec } from "./large-psd-fixture";

const LARGE_PSD_WIDTH = 12_000;
const LARGE_PSD_HEIGHT = 9_000;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });
});

test("PaintDocument materializes deferred layer pixels at their document offset", async ({ page }) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
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

    const doc = new PaintDocument(10, 8, 1);
    const layerCanvas = makeFilledCanvas(3, 2, "rgba(200, 10, 20, 1)");
    doc.replaceLayersFromCanvas(
      [
        {
          meta: {
            id: "deferred",
            name: "deferred",
            visible: true,
            opacity: 1,
            blendMode: "normal",
            locked: false,
            kind: "raster",
          },
          canvas: layerCanvas.canvas,
          ctx: layerCanvas.ctx,
          deferred: { offsetX: 4, offsetY: 3, bboxWidth: 3, bboxHeight: 2 },
        },
      ],
      "deferred"
    );

    const layer = doc.layers[0];
    doc.materializeLayer(layer);
    const sample = layer.store.getImageData(0, 0, doc.width, doc.height);

    return {
      deferred: layer.deferred ?? null,
      bounds: layer.store.getAlphaBounds(),
      before: pixel(sample, 3, 3),
      topLeft: pixel(sample, 4, 3),
      bottomRight: pixel(sample, 6, 4),
      after: pixel(sample, 7, 4),
    };
  });

  expect(result.deferred).toBeNull();
  expect(result.bounds).toEqual({ x: 4, y: 3, w: 3, h: 2 });
  expect(result.before).toEqual([0, 0, 0, 0]);
  expect(result.topLeft).toEqual([200, 10, 20, 255]);
  expect(result.bottomRight).toEqual([200, 10, 20, 255]);
  expect(result.after).toEqual([0, 0, 0, 0]);
});

test("PaintDocument mergeDown keeps deferred layer union pixels in document space", async ({ page }) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
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

    const doc = new PaintDocument(12, 8, 1);
    const lower = makeFilledCanvas(3, 3, "rgba(20, 40, 220, 1)");
    const upper = makeFilledCanvas(3, 3, "rgba(220, 30, 10, 1)");
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
          deferred: { offsetX: 4, offsetY: 2, bboxWidth: 3, bboxHeight: 3 },
        },
        {
          meta: {
            id: "upper",
            name: "upper",
            visible: true,
            opacity: 1,
            blendMode: "normal",
            locked: false,
            kind: "raster",
          },
          canvas: upper.canvas,
          ctx: upper.ctx,
          deferred: { offsetX: 6, offsetY: 3, bboxWidth: 3, bboxHeight: 3 },
        },
      ],
      "upper"
    );

    doc.mergeDown("upper");
    const merged = doc.layers[0];
    const deferred = merged.deferred ? { ...merged.deferred } : null;
    const local = merged.store.getImageData(0, 0, 5, 4);
    const localSamples = {
      lowerOnly: pixel(local, 0, 0),
      overlap: pixel(local, 2, 1),
      upperOnly: pixel(local, 4, 3),
      empty: pixel(local, 1, 3),
    };

    doc.materializeLayer(merged);
    const full = merged.store.getImageData(0, 0, doc.width, doc.height);

    return {
      layerCount: doc.layers.length,
      activeLayerId: doc.activeLayerId,
      deferred,
      localSamples,
      bounds: merged.store.getAlphaBounds(),
      docSamples: {
        outside: pixel(full, 3, 2),
        lowerOnly: pixel(full, 4, 2),
        overlap: pixel(full, 6, 3),
        upperOnly: pixel(full, 8, 5),
      },
    };
  });

  expect(result.layerCount).toBe(1);
  expect(result.activeLayerId).toBe("lower");
  expect(result.deferred).toEqual({ offsetX: 4, offsetY: 2, bboxWidth: 5, bboxHeight: 4 });
  expect(result.localSamples.lowerOnly).toEqual([20, 40, 220, 255]);
  expect(result.localSamples.overlap).toEqual([220, 30, 10, 255]);
  expect(result.localSamples.upperOnly).toEqual([220, 30, 10, 255]);
  expect(result.localSamples.empty).toEqual([0, 0, 0, 0]);
  expect(result.bounds).toEqual({ x: 4, y: 2, w: 5, h: 4 });
  expect(result.docSamples.outside).toEqual([0, 0, 0, 0]);
  expect(result.docSamples.lowerOnly).toEqual([20, 40, 220, 255]);
  expect(result.docSamples.overlap).toEqual([220, 30, 10, 255]);
  expect(result.docSamples.upperOnly).toEqual([220, 30, 10, 255]);
});

test("PaintDocument extendCanvas translates kept pixels and drops cropped pixels", async ({ page }) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const { PaintDocument } = await import("/src/core/PaintDocument.ts");

    function pixel(data: ImageData, x: number, y: number): number[] {
      const i = (y * data.width + x) * 4;
      return Array.from(data.data.slice(i, i + 4));
    }

    const doc = new PaintDocument(6, 6, 1);
    const layer = doc.getActiveLayer();
    if (!layer) throw new Error("active layer was not available");

    layer.store.withCtx((ctx) => {
      ctx.fillStyle = "rgba(30, 180, 40, 1)";
      ctx.fillRect(1, 1, 1, 1);
      ctx.fillStyle = "rgba(230, 20, 160, 1)";
      ctx.fillRect(4, 4, 1, 1);
    }, { x: 1, y: 1, w: 4, h: 4 });

    doc.extendCanvas(1, -2, 0, 2);
    const sample = layer.store.getImageData(0, 0, doc.width, doc.height);

    return {
      size: { width: doc.width, height: doc.height },
      bounds: layer.store.getAlphaBounds(),
      beforeNewPosition: pixel(sample, 1, 1),
      movedPixel: pixel(sample, 3, 2),
      croppedEdge: pixel(sample, 5, 5),
    };
  });

  expect(result.size).toEqual({ width: 6, height: 7 });
  expect(result.bounds).toEqual({ x: 3, y: 2, w: 1, h: 1 });
  expect(result.beforeNewPosition).toEqual([0, 0, 0, 0]);
  expect(result.movedPixel).toEqual([30, 180, 40, 255]);
  expect(result.croppedEdge).toEqual([0, 0, 0, 0]);
});

test("PaintDocument resize keeps regular and deferred pixels in document space", async ({ page }) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
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

    const doc = new PaintDocument(10, 10, 1);
    const regular = makeCanvas(10, 10);
    regular.ctx.fillStyle = "rgba(30, 180, 40, 1)";
    regular.ctx.fillRect(2, 2, 3, 3);

    const deferred = makeCanvas(3, 3);
    deferred.ctx.fillStyle = "rgba(220, 40, 30, 1)";
    deferred.ctx.fillRect(0, 0, 3, 3);

    doc.replaceLayersFromCanvas(
      [
        {
          meta: {
            id: "regular",
            name: "regular",
            visible: true,
            opacity: 1,
            blendMode: "normal",
            locked: false,
            kind: "raster",
          },
          canvas: regular.canvas,
          ctx: regular.ctx,
        },
        {
          meta: {
            id: "deferred",
            name: "deferred",
            visible: true,
            opacity: 1,
            blendMode: "normal",
            locked: false,
            kind: "raster",
          },
          canvas: deferred.canvas,
          ctx: deferred.ctx,
          deferred: { offsetX: 4, offsetY: 2, bboxWidth: 3, bboxHeight: 3 },
        },
      ],
      "deferred"
    );

    doc.resize(20, 20);
    const regularLayer = doc.getLayer("regular");
    const deferredLayer = doc.getLayer("deferred");
    if (!regularLayer || !deferredLayer) throw new Error("layers were not available");

    const regularSample = regularLayer.store.getImageData(0, 0, doc.width, doc.height);
    const deferredSample = deferredLayer.store.getImageData(0, 0, doc.width, doc.height);
    return {
      size: { width: doc.width, height: doc.height },
      regularDeferred: regularLayer.deferred ?? null,
      deferredDeferred: deferredLayer.deferred ?? null,
      regularPixel: pixel(regularSample, 5, 5),
      deferredPixel: pixel(deferredSample, 9, 5),
      oldDeferredOrigin: pixel(deferredSample, 4, 2),
    };
  });

  expect(result.size).toEqual({ width: 20, height: 20 });
  expect(result.regularDeferred).toBeNull();
  expect(result.deferredDeferred).toBeNull();
  expect(result.regularPixel[0]).toBeGreaterThanOrEqual(28);
  expect(result.regularPixel[0]).toBeLessThanOrEqual(32);
  expect(result.regularPixel[1]).toBeGreaterThanOrEqual(178);
  expect(result.regularPixel[1]).toBeLessThanOrEqual(190);
  expect(result.regularPixel[2]).toBeGreaterThanOrEqual(38);
  expect(result.regularPixel[2]).toBeLessThanOrEqual(43);
  expect(result.regularPixel[3]).toBe(255);
  expect(result.deferredPixel[0]).toBeGreaterThanOrEqual(218);
  expect(result.deferredPixel[0]).toBeLessThanOrEqual(222);
  expect(result.deferredPixel[1]).toBeGreaterThanOrEqual(38);
  expect(result.deferredPixel[1]).toBeLessThanOrEqual(42);
  expect(result.deferredPixel[2]).toBeGreaterThanOrEqual(28);
  expect(result.deferredPixel[2]).toBeLessThanOrEqual(32);
  expect(result.deferredPixel[3]).toBe(255);
  expect(result.oldDeferredOrigin).toEqual([0, 0, 0, 0]);
});

test("PaintDocument resize rasterizes text layers without replacing scaled pixels", async ({ page }) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const { PaintDocument } = await import("/src/core/PaintDocument.ts");

    const canvas = document.createElement("canvas");
    canvas.width = 10;
    canvas.height = 10;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d context was not available");
    ctx.fillStyle = "rgba(40, 120, 220, 1)";
    ctx.fillRect(6, 6, 2, 2);

    const doc = new PaintDocument(10, 10, 1);
    doc.replaceLayersFromCanvas(
      [
        {
          meta: {
            id: "text",
            name: "text",
            visible: true,
            opacity: 1,
            blendMode: "normal",
            locked: false,
            kind: "text",
            text: {
              text: "X",
              fontFamily: "sans-serif",
              fontSize: 2,
              color: "#000000",
              bold: false,
              italic: false,
              align: "left",
              x: 0,
              y: 0,
              lineHeight: 1.2,
            },
          },
          canvas,
          ctx,
        },
      ],
      "text"
    );

    doc.resize(20, 20);
    const layer = doc.getLayer("text");
    if (!layer) throw new Error("text layer was not available");
    const sample = layer.store.getImageData(13, 13, 1, 1);

    return {
      kind: layer.meta.kind,
      text: layer.meta.text ?? null,
      pixel: Array.from(sample.data),
    };
  });

  expect(result.kind).toBe("raster");
  expect(result.text).toBeNull();
  expect(result.pixel[0]).toBeLessThan(60);
  expect(result.pixel[1]).toBeGreaterThan(100);
  expect(result.pixel[1]).toBeLessThan(140);
  expect(result.pixel[2]).toBeGreaterThan(200);
  expect(result.pixel[3]).toBe(255);
});

test("PaintDocument mergeDown applies opacity and blend mode with deferred upper pixels", async ({ page }) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
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

    const doc = new PaintDocument(6, 4, 1);
    const lower = makeFilledCanvas(6, 4, "rgba(100, 150, 200, 1)");
    const upper = makeFilledCanvas(2, 2, "rgba(200, 200, 200, 1)");
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
            opacity: 0.5,
            blendMode: "multiply",
            locked: false,
            kind: "raster",
          },
          canvas: upper.canvas,
          ctx: upper.ctx,
          deferred: { offsetX: 2, offsetY: 1, bboxWidth: 2, bboxHeight: 2 },
        },
      ],
      "upper"
    );

    doc.mergeDown("upper");
    const merged = doc.layers[0];
    const sample = merged.store.getImageData(0, 0, doc.width, doc.height);
    return {
      layerCount: doc.layers.length,
      activeLayerId: doc.activeLayerId,
      mergedKind: merged.meta.kind,
      blended: pixel(sample, 2, 1),
      untouched: pixel(sample, 0, 0),
    };
  });

  expect(result.layerCount).toBe(1);
  expect(result.activeLayerId).toBe("lower");
  expect(result.mergedKind).toBe("raster");
  expect(result.untouched).toEqual([100, 150, 200, 255]);
  expect(result.blended[0]).toBeGreaterThanOrEqual(87);
  expect(result.blended[0]).toBeLessThanOrEqual(91);
  expect(result.blended[1]).toBeGreaterThanOrEqual(132);
  expect(result.blended[1]).toBeLessThanOrEqual(136);
  expect(result.blended[2]).toBeGreaterThanOrEqual(176);
  expect(result.blended[2]).toBeLessThanOrEqual(180);
  expect(result.blended[3]).toBe(255);
});

test("PaintDocument mergeDown applies subtract blend mode", async ({ page }) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
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

    const doc = new PaintDocument(4, 3, 1);
    const lower = makeFilledCanvas(4, 3, "rgba(100, 150, 200, 1)");
    const upper = makeFilledCanvas(2, 1, "rgba(200, 60, 40, 1)");
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
            blendMode: "subtract",
            locked: false,
            kind: "raster",
          },
          canvas: upper.canvas,
          ctx: upper.ctx,
          deferred: { offsetX: 1, offsetY: 1, bboxWidth: 2, bboxHeight: 1 },
        },
      ],
      "upper"
    );

    doc.mergeDown("upper");
    const merged = doc.layers[0];
    const sample = merged.store.getImageData(0, 0, doc.width, doc.height);
    return {
      layerCount: doc.layers.length,
      blended: pixel(sample, 1, 1),
      untouched: pixel(sample, 0, 0),
    };
  });

  expect(result.layerCount).toBe(1);
  expect(result.untouched).toEqual([100, 150, 200, 255]);
  expect(result.blended).toEqual([0, 90, 160, 255]);
});

test("PaintDocument bgVersion only changes when renderer background cache is invalidated", async ({ page }) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const { PaintDocument } = await import("/src/core/PaintDocument.ts");

    const doc = new PaintDocument(4, 4, 2);
    const activeId = doc.activeLayerId;
    const inactiveId = doc.layers.find((layer) => layer.meta.id !== activeId)?.meta.id;
    if (!inactiveId) throw new Error("inactive layer was not available");

    const initial = doc.getBgVersion();
    doc.setOpacity(activeId, 0.5);
    const afterActiveOpacity = doc.getBgVersion();
    doc.invalidateActive();
    const afterInvalidateActive = doc.getBgVersion();
    doc.setOpacity(inactiveId, 0.5);
    const afterInactiveOpacity = doc.getBgVersion();
    doc.invalidate();
    const afterInvalidate = doc.getBgVersion();

    return {
      initial,
      afterActiveOpacity,
      afterInvalidateActive,
      afterInactiveOpacity,
      afterInvalidate,
    };
  });

  expect(result.afterActiveOpacity).toBe(result.initial);
  expect(result.afterInvalidateActive).toBe(result.initial);
  expect(result.afterInactiveOpacity).toBe(result.initial + 1);
  expect(result.afterInvalidate).toBe(result.initial + 2);
});

test("paintDocumentExport preserves transparent or white background intent", async ({ page }) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const { PaintDocument } = await import("/src/core/PaintDocument.ts");
    const { flattenDocumentToBlob } = await import("/src/core/paintDocumentExport.ts");

    async function blobPixel(blob: Blob): Promise<number[]> {
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("2d context was not available");
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      return Array.from(ctx.getImageData(0, 0, 1, 1).data);
    }

    const doc = new PaintDocument(2, 2, 1);
    const transparent = await blobPixel(
      await flattenDocumentToBlob(doc, "image/png", 0.92, "transparent")
    );
    const white = await blobPixel(
      await flattenDocumentToBlob(doc, "image/png", 0.92, "white")
    );

    return { transparent, white };
  });

  expect(result.transparent).toEqual([0, 0, 0, 0]);
  expect(result.white).toEqual([255, 255, 255, 255]);
});

test("PSD export and import round-trip raster pixels in the browser bundle", async ({ page }) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const { PaintDocument } = await import("/src/core/PaintDocument.ts");
    const { loadPsd, savePsd } = await import("/src/core/psdFormat.ts");
    const { readPsdLayerBounds } = await import("/tests/e2e/large-psd-fixture.ts");

    function pixel(data: ImageData, x: number, y: number): number[] {
      const i = (y * data.width + x) * 4;
      return Array.from(data.data.slice(i, i + 4));
    }

    const source = new PaintDocument(8, 6, 1);
    source.setDpi(144);
    const sourceLayer = source.getActiveLayer();
    if (!sourceLayer) throw new Error("active source layer was not available");
    source.setBlendMode(sourceLayer.meta.id, "subtract");
    sourceLayer.store.withCtx((ctx) => {
      ctx.fillStyle = "rgba(210, 40, 30, 1)";
      ctx.fillRect(2, 1, 3, 2);
    }, { x: 2, y: 1, w: 3, h: 2 });
    const emptyLayer = source.addLayer("empty layer");
    source.addGroup("empty folder");

    const blob = await savePsd(source);
    const savedLayerBounds = await readPsdLayerBounds(blob, sourceLayer.meta.name);
    const savedEmptyLayerBounds = await readPsdLayerBounds(blob, emptyLayer.meta.name);

    const loaded = new PaintDocument(1, 1, 1);
    await loadPsd(blob, loaded);
    const loadedLayer = loaded.getActiveLayer();
    if (!loadedLayer) throw new Error("active loaded layer was not available");
    loaded.materializeLayer(loadedLayer);

    const sample = loadedLayer.store.getImageData(0, 0, loaded.width, loaded.height);
    return {
      blobType: blob.type,
      blobSize: blob.size,
      size: { width: loaded.width, height: loaded.height },
      dpi: loaded.dpi,
      savedLayerBounds,
      savedEmptyLayerBounds,
      blendMode: loadedLayer.meta.blendMode,
      emptyFolderKind: loaded.layers.find(
        (layer) => layer.meta.name === "empty folder"
      )?.meta.kind,
      bounds: loadedLayer.store.getAlphaBounds(),
      painted: pixel(sample, 2, 1),
      empty: pixel(sample, 0, 0),
    };
  });

  expect(result.blobType).toBe("image/vnd.adobe.photoshop");
  expect(result.blobSize).toBeGreaterThan(0);
  expect(result.size).toEqual({ width: 8, height: 6 });
  expect(result.dpi).toBe(144);
  expect(result.savedLayerBounds).toEqual({ left: 2, top: 1, right: 5, bottom: 3 });
  expect(result.savedEmptyLayerBounds).toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
  expect(result.blendMode).toBe("subtract");
  expect(result.emptyFolderKind).toBe("group");
  expect(result.bounds).toEqual({ x: 2, y: 1, w: 3, h: 2 });
  expect(result.painted).toEqual([210, 40, 30, 255]);
  expect(result.empty).toEqual([0, 0, 0, 0]);
});

test("PSD import selects a top visible drawable layer instead of a hidden bottom layer", async ({
  page,
}) => {
  const specs: LargePsdLayerSpec[] = [
    {
      name: "hidden paper",
      left: 0,
      top: 0,
      width: 8,
      height: 8,
      color: [255, 255, 255, 255],
      hidden: true,
    },
    {
      name: "visible paint",
      left: 2,
      top: 1,
      width: 3,
      height: 2,
      color: [20, 130, 220, 255],
    },
  ];
  await page.goto("/");

  const result = await page.evaluate(async ({ specs }) => {
    const { makeLargeSparsePsdBlob } = await import("/tests/e2e/large-psd-fixture.ts");
    const { PaintDocument } = await import("/src/core/PaintDocument.ts");
    const { loadPsd } = await import("/src/core/psdFormat.ts");

    const doc = new PaintDocument(1, 1, 1);
    await loadPsd(makeLargeSparsePsdBlob(12, 10, specs), doc);
    const active = doc.getActiveLayer();
    if (!active) throw new Error("active layer was not available");
    return {
      activeName: active.meta.name,
      activeVisible: active.meta.visible,
      activeDeferred: active.deferred ?? null,
    };
  }, { specs });

  expect(result.activeName).toBe("visible paint");
  expect(result.activeVisible).toBe(true);
  expect(result.activeDeferred).toEqual({ offsetX: 2, offsetY: 1, bboxWidth: 3, bboxHeight: 2 });
});

test("loads a large sparse PSD without materializing document-sized layer stores", async ({
  page,
}) => {
  const specs: LargePsdLayerSpec[] = [
    {
      name: "bottom mark",
      left: 10_900,
      top: 8_100,
      width: 5,
      height: 4,
      color: [210, 40, 30, 255],
    },
    {
      name: "top mark",
      left: 720,
      top: 640,
      width: 3,
      height: 6,
      color: [20, 130, 220, 255],
    },
  ];
  await page.goto("/");

  const result = await page.evaluate(
    async ({ specs, width, height }) => {
      const { makeLargeSparsePsdBlob } = await import("/tests/e2e/large-psd-fixture.ts");
      const { PaintDocument } = await import("/src/core/PaintDocument.ts");
      const { loadPsd } = await import("/src/core/psdFormat.ts");

      const doc = new PaintDocument(1, 1, 1);
      const blob = makeLargeSparsePsdBlob(width, height, specs);
      const startedAt = performance.now();
      await loadPsd(blob, doc);
      const loadMs = performance.now() - startedAt;

      return {
        loadMs,
        blobSize: blob.size,
        size: { width: doc.width, height: doc.height },
        layers: doc.layers.map((layer) => {
          const internals = layer.store as unknown as {
            tiles?: Map<unknown, unknown>;
            flatBacking?: unknown;
          };
          return {
            name: layer.meta.name,
            deferred: layer.deferred ?? null,
            storeSize: {
              width: layer.store.width,
              height: layer.store.height,
            },
            tileCount: internals.tiles?.size ?? null,
            hasFlatBacking: !!internals.flatBacking,
          };
        }),
        expected: specs.map((spec) => ({
          name: spec.name,
          deferred: {
            offsetX: spec.left,
            offsetY: spec.top,
            bboxWidth: spec.width,
            bboxHeight: spec.height,
          },
          storeSize: {
            width: spec.width,
            height: spec.height,
          },
        })),
      };
    },
    { specs, width: LARGE_PSD_WIDTH, height: LARGE_PSD_HEIGHT }
  );

  console.log(
    `large sparse PSD load: ${result.loadMs.toFixed(1)}ms (${result.blobSize} bytes)`
  );
  expect(result.size).toEqual({ width: LARGE_PSD_WIDTH, height: LARGE_PSD_HEIGHT });
  expect(result.layers).toHaveLength(specs.length);
  expect(result.layers).toEqual(
    result.expected.map((expected) =>
      expect.objectContaining({
        name: expected.name,
        deferred: expected.deferred,
        storeSize: expected.storeSize,
        tileCount: 0,
        hasFlatBacking: true,
      })
    )
  );
});

test("loads a large sparse PSD with many layers without eager materialization", async ({
  page,
}) => {
  const layerCount = 100;
  const width = 10_000;
  const height = 8_000;
  const specs: LargePsdLayerSpec[] = Array.from({ length: layerCount }, (_, i) => ({
    name: `mark ${i.toString().padStart(3, "0")}`,
    left: (i * 79) % (width - 2),
    top: (i * 53) % (height - 2),
    width: 2,
    height: 2,
    color: [20 + (i % 200), 80, 180, 255],
  }));
  await page.goto("/");

  const result = await page.evaluate(
    async ({ specs, width, height }) => {
      const { makeLargeSparsePsdBlob } = await import("/tests/e2e/large-psd-fixture.ts");
      const { PaintDocument } = await import("/src/core/PaintDocument.ts");
      const { loadPsd } = await import("/src/core/psdFormat.ts");

      const doc = new PaintDocument(1, 1, 1);
      await loadPsd(makeLargeSparsePsdBlob(width, height, specs), doc);

      return {
        size: { width: doc.width, height: doc.height },
        layerCount: doc.layers.length,
        materializedCount: doc.layers.filter((layer) => layer.deferred === undefined).length,
        maxStoreArea: Math.max(
          ...doc.layers.map((layer) => layer.store.width * layer.store.height)
        ),
        deferredOffsets: doc.layers.slice(0, 3).map((layer) => layer.deferred),
      };
    },
    { specs, width, height }
  );

  expect(result.size).toEqual({ width, height });
  expect(result.layerCount).toBe(layerCount);
  expect(result.materializedCount).toBe(0);
  expect(result.maxStoreArea).toBe(4);
  expect(result.deferredOffsets).toEqual(
    specs.slice(0, 3).map((spec) => ({
      offsetX: spec.left,
      offsetY: spec.top,
      bboxWidth: spec.width,
      bboxHeight: spec.height,
    }))
  );
});

test("brush-style history on a 100-layer document snapshots only the active layer tiles", async ({
  page,
}) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const { PaintDocument } = await import("/src/core/PaintDocument.ts");
    const { History } = await import("/src/core/History.ts");

    const NativeOffscreenCanvas = window.OffscreenCanvas;
    const allocations: { width: number; height: number }[] = [];
    const RecordingOffscreenCanvas = new Proxy(NativeOffscreenCanvas, {
      construct(target, args) {
        const [width, height] = args as [number, number];
        allocations.push({ width, height });
        return Reflect.construct(target, args);
      },
    });
    (
      window as Window & { OffscreenCanvas: typeof OffscreenCanvas }
    ).OffscreenCanvas = RecordingOffscreenCanvas;

    try {
      const doc = new PaintDocument(2048, 2048, 100);
      const history = new History();
      const active = doc.getActiveLayer();
      if (!active) throw new Error("active layer was not available");
      const inactive = doc.layers.find((layer) => layer.meta.id !== active.meta.id);
      if (!inactive) throw new Error("inactive layer was not available");

      inactive.store.withCtx((ctx) => {
        ctx.fillStyle = "rgba(200, 20, 40, 1)";
        ctx.fillRect(900, 900, 2, 2);
      }, { x: 900, y: 900, w: 2, h: 2 });

      const rect = { x: 32, y: 48, w: 8, h: 8 };
      history.beginOperation(doc, [active.meta.id], {
        trackRegion: true,
        initialRegion: rect,
      });
      active.store.withCtx((ctx) => {
        ctx.fillStyle = "rgba(20, 160, 220, 1)";
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      }, rect);
      history.commitOperation(doc, "draw on many layers", [active.meta.id]);

      const alphaAt = (layerId: string, x: number, y: number): number => {
        const layer = doc.getLayer(layerId);
        if (!layer) throw new Error("layer was not available");
        return layer.store.getImageData(x, y, 1, 1).data[3];
      };
      const changed = alphaAt(active.meta.id, rect.x, rect.y);
      const inactiveBeforeUndo = alphaAt(inactive.meta.id, 900, 900);
      history.undo(doc);
      const activeAfterUndo = alphaAt(active.meta.id, rect.x, rect.y);
      const inactiveAfterUndo = alphaAt(inactive.meta.id, 900, 900);

      return {
        layerCount: doc.layers.length,
        canRedo: history.canRedo(),
        changed,
        activeAfterUndo,
        inactiveBeforeUndo,
        inactiveAfterUndo,
        documentCloneCount: allocations.filter(
          (a) => a.width === doc.width && a.height === doc.height
        ).length,
        largeAllocationCount: allocations.filter(
          (a) => a.width * a.height > 256 * 256
        ).length,
      };
    } finally {
      (
        window as Window & { OffscreenCanvas: typeof OffscreenCanvas }
      ).OffscreenCanvas = NativeOffscreenCanvas;
    }
  });

  expect(result.layerCount).toBe(100);
  expect(result.changed).toBe(255);
  expect(result.activeAfterUndo).toBe(0);
  expect(result.inactiveBeforeUndo).toBe(255);
  expect(result.inactiveAfterUndo).toBe(255);
  expect(result.canRedo).toBe(true);
  expect(result.documentCloneCount).toBe(0);
  expect(result.largeAllocationCount).toBe(0);
});

test("AI payload service scaling does not allocate a full-size output canvas", async ({
  page,
}) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const { PaintDocument } = await import("/src/core/PaintDocument.ts");
    const { flattenDocumentToBase64ForAI } = await import("/src/core/aiImagePayload.ts");

    const originalCreateElement = document.createElement.bind(document);
    const payloadCanvases: HTMLCanvasElement[] = [];
    document.createElement = ((tagName: string, options?: ElementCreationOptions) => {
      const element = originalCreateElement(tagName, options);
      if (tagName.toLowerCase() === "canvas") {
        payloadCanvases.push(element as HTMLCanvasElement);
      }
      return element;
    }) as typeof document.createElement;

    try {
      const doc = new PaintDocument(1200, 600, 1);
      const payload = await flattenDocumentToBase64ForAI(doc, 300);
      return {
        payload: { width: payload.width, height: payload.height, scale: payload.scale },
        canvases: payloadCanvases.map((canvas) => ({
          width: canvas.width,
          height: canvas.height,
        })),
      };
    } finally {
      document.createElement = originalCreateElement as typeof document.createElement;
    }
  });

  expect(result.payload).toEqual({ width: 300, height: 150, scale: 0.25 });
  expect(result.canvases).toEqual([{ width: 300, height: 150 }]);
});

test("AI payload service composites directly into the scaled crop output", async ({
  page,
}) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const { PaintDocument } = await import("/src/core/PaintDocument.ts");
    const { cropDocumentToBase64ForAI } = await import("/src/core/aiImagePayload.ts");

    function pixel(data: ImageData, x: number, y: number): number[] {
      const i = (y * data.width + x) * 4;
      return Array.from(data.data.slice(i, i + 4));
    }

    const originalCreateElement = document.createElement.bind(document);
    const payloadCanvases: HTMLCanvasElement[] = [];
    document.createElement = ((tagName: string, options?: ElementCreationOptions) => {
      const element = originalCreateElement(tagName, options);
      if (tagName.toLowerCase() === "canvas") {
        payloadCanvases.push(element as HTMLCanvasElement);
      }
      return element;
    }) as typeof document.createElement;

    let payload: Awaited<ReturnType<typeof cropDocumentToBase64ForAI>>;
    let canvases: { width: number; height: number }[];
    try {
      const doc = new PaintDocument(1200, 800, 1);
      const layer = doc.getActiveLayer();
      if (!layer) throw new Error("active layer was not available");
      layer.store.withCtx((ctx) => {
        ctx.fillStyle = "rgba(220, 30, 40, 1)";
        ctx.fillRect(450, 260, 120, 80);
      }, { x: 450, y: 260, w: 120, h: 80 });

      payload = await cropDocumentToBase64ForAI(doc, 400, 240, 400, 200, 100);
      canvases = payloadCanvases.map((canvas) => ({
        width: canvas.width,
        height: canvas.height,
      }));
    } finally {
      document.createElement = originalCreateElement as typeof document.createElement;
    }

    const bytes = Uint8Array.from(atob(payload.base64), (char) => char.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d context was not available");
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);

    return {
      payload: { width: payload.width, height: payload.height, scale: payload.scale },
      canvases,
      redPixel: pixel(data, 25, 10),
      whitePixel: pixel(data, 5, 5),
    };
  });

  expect(result.payload).toEqual({ width: 100, height: 50, scale: 0.25 });
  expect(result.canvases).toEqual([{ width: 100, height: 50 }]);
  expect(result.redPixel[0]).toBeGreaterThanOrEqual(210);
  expect(result.redPixel[1]).toBeLessThanOrEqual(40);
  expect(result.redPixel[2]).toBeLessThanOrEqual(50);
  expect(result.redPixel[3]).toBe(255);
  expect(result.whitePixel).toEqual([255, 255, 255, 255]);
});
