import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
});

test("paint API path respects selection and round-trips through undo/redo", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { PaintDocument } = await import("/src/core/PaintDocument.ts");
    const { History } = await import("/src/core/History.ts");
    const { Timelapse } = await import("/src/core/Timelapse.ts");
    const { createPaintApi } = await import("/src/core/paintApi/index.ts");
    const doc = new PaintDocument(64, 64, 1);
    const history = new History();
    const timelapse = new Timelapse();
    let selection = { kind: "none" } as import("/src/types.ts").Selection;
    const api = createPaintApi({
      getDocument: () => doc,
      getHistory: () => history,
      getTimelapse: () => timelapse,
      getSelection: () => selection,
      setSelection: (next) => { selection = next; },
    });
    await api.execute("selection.set", { kind: "rect", x: 16, y: 16, width: 24, height: 24 });
    const painted = await api.execute("drawing.path", {
      commands: [
        { op: "move", x: 4, y: 4 },
        { op: "line", x: 60, y: 4 },
        { op: "bezier", cp1x: 60, cp1y: 24, cp2x: 60, cp2y: 44, x: 60, y: 60 },
        { op: "line", x: 4, y: 60 },
        { op: "close" },
      ],
      fillColor: "#ff0000",
      strokeColor: "#000000",
      strokeWidth: 2,
      fill: true,
      stroke: false,
    });
    const layer = doc.getActiveLayer()!;
    const alpha = (x: number, y: number) => layer.store.getImageData(x, y, 1, 1).data[3];
    const afterPaint = { inside: alpha(20, 20), outside: alpha(8, 8) };
    const undo = await api.execute("history.undo", {});
    const afterUndo = alpha(20, 20);
    const redo = await api.execute("history.redo", {});
    const afterRedo = alpha(20, 20);
    return { painted, undo, redo, afterPaint, afterUndo, afterRedo };
  });

  expect(result.painted).toMatchObject({ ok: true, value: { changed: true } });
  expect(result.afterPaint.inside).toBeGreaterThan(0);
  expect(result.afterPaint.outside).toBe(0);
  expect(result.undo).toMatchObject({ ok: true, value: { changed: true } });
  expect(result.afterUndo).toBe(0);
  expect(result.redo).toMatchObject({ ok: true, value: { changed: true } });
  expect(result.afterRedo).toBeGreaterThan(0);
});

test("paint API batches independent brush strokes into one undoable operation", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { PaintDocument } = await import("/src/core/PaintDocument.ts");
    const { History } = await import("/src/core/History.ts");
    const { Timelapse } = await import("/src/core/Timelapse.ts");
    const { createPaintApi } = await import("/src/core/paintApi/index.ts");
    const doc = new PaintDocument(96, 48, 1);
    const history = new History();
    const timelapse = new Timelapse();
    let selection = { kind: "none" } as import("/src/types.ts").Selection;
    const api = createPaintApi({
      getDocument: () => doc, getHistory: () => history, getTimelapse: () => timelapse,
      getSelection: () => selection, setSelection: next => { selection = next; },
    });
    const settings = { kind: "pen", size: 6, opacity: 1, color: "#e83355", pressureSize: 0, pressureOpacity: 0, stabilizer: 0 };
    const batch = await api.execute("drawing.stroke_batch", {
      label: "離れた筆致",
      strokes: [
        { points: [{ x: 8, y: 20 }, { x: 24, y: 20 }], settings },
        { points: [{ x: 72, y: 20 }, { x: 88, y: 20 }], settings },
      ],
    });
    const layer = doc.getActiveLayer()!;
    const alpha = (x: number) => layer.store.getImageData(x, 20, 1, 1).data[3];
    const afterPaint = [alpha(16), alpha(48), alpha(80)];
    const undo = await api.execute("history.undo", {});
    const afterUndo = [alpha(16), alpha(80)];
    const redo = await api.execute("history.redo", {});
    const afterRedo = [alpha(16), alpha(48), alpha(80)];
    return { batch, afterPaint, undo, afterUndo, redo, afterRedo, canUndo: history.canUndo() };
  });

  expect(result.batch).toMatchObject({ ok: true, value: { changed: true, strokeCount: 2 } });
  expect(result.afterPaint[0]).toBeGreaterThan(0);
  expect(result.afterPaint[1]).toBe(0);
  expect(result.afterPaint[2]).toBeGreaterThan(0);
  expect(result.undo).toMatchObject({ ok: true, value: { changed: true } });
  expect(result.afterUndo).toEqual([0, 0]);
  expect(result.redo).toMatchObject({ ok: true, value: { changed: true } });
  expect(result.afterRedo).toEqual(result.afterPaint);
  expect(result.canUndo).toBe(true);
});

test("paint API keeps sparse huge stroke batches bounded and undoable", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { PaintDocument } = await import("/src/core/PaintDocument.ts");
    const { History } = await import("/src/core/History.ts");
    const { Timelapse } = await import("/src/core/Timelapse.ts");
    const { createPaintApi } = await import("/src/core/paintApi/index.ts");
    const { loadDrawingActivityDays } = await import("/src/core/drawingActivity.ts");
    const doc = new PaintDocument(8192, 8192, 1);
    const history = new History();
    const timelapse = new Timelapse();
    let selection = { kind: "none" } as import("/src/types.ts").Selection;
    const api = createPaintApi({
      getDocument: () => doc, getHistory: () => history, getTimelapse: () => timelapse,
      getSelection: () => selection, setSelection: next => { selection = next; },
    });
    const layer = doc.getActiveLayer()!;
    const storeReadAreas: number[] = [];
    const originalStoreGetImageData = layer.store.getImageData.bind(layer.store);
    layer.store.getImageData = (x, y, width, height) => {
      storeReadAreas.push(width * height);
      return originalStoreGetImageData(x, y, width, height);
    };
    const canvasReadAreas: number[] = [];
    const canvasPrototype = CanvasRenderingContext2D.prototype as unknown as {
      getImageData: (this: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) => ImageData;
    };
    const originalCanvasGetImageData = canvasPrototype.getImageData;
    canvasPrototype.getImageData = function (x, y, width, height) {
      canvasReadAreas.push(width * height);
      return originalCanvasGetImageData.call(this, x, y, width, height);
    };
    const settings = { kind: "pen", size: 6, opacity: 1, color: "#e83355", pressureSize: 0, pressureOpacity: 0, stabilizer: 0 };
    let batch: unknown;
    try {
      batch = await api.execute("drawing.stroke_batch", {
        label: "巨大スパース筆致",
        strokes: [
          { points: [{ x: 10, y: 12 }, { x: 30, y: 12 }], settings },
          { points: [{ x: 8160, y: 8176 }, { x: 8180, y: 8176 }], settings },
        ],
      });
    } finally {
      canvasPrototype.getImageData = originalCanvasGetImageData;
      layer.store.getImageData = originalStoreGetImageData;
    }
    const alpha = (x: number, y: number) => layer.store.getImageData(x, y, 1, 1).data[3];
    const painted = [alpha(20, 12), alpha(8170, 8176)];
    const undo = await api.execute("history.undo", {});
    const undone = [alpha(20, 12), alpha(8170, 8176)];
    const canUndoAfterUndo = history.canUndo();
    const redo = await api.execute("history.redo", {});
    const redone = [alpha(20, 12), alpha(8170, 8176)];
    return {
      batch, painted, middle: alpha(4096, 4096), undo, undone, canUndoAfterUndo, redo, redone,
      storeReadCount: storeReadAreas.length,
      maxStoreReadArea: Math.max(...storeReadAreas),
      maxCanvasReadArea: Math.max(...canvasReadAreas),
      activity: loadDrawingActivityDays(),
    };
  });

  expect(result.batch).toMatchObject({
    ok: true,
    value: { changed: true, strokeCount: 2, bounds: { x: 0, y: 2, w: 8190, h: 8184 } },
  });
  expect(result.painted[0]).toBeGreaterThan(0);
  expect(result.painted[1]).toBeGreaterThan(0);
  expect(result.middle).toBe(0);
  expect(result.storeReadCount).toBe(4);
  expect(result.maxStoreReadArea).toBeLessThanOrEqual(256 * 256);
  expect(result.maxCanvasReadArea).toBeLessThanOrEqual(256 * 256);
  expect(result.activity).toHaveLength(1);
  expect(result.activity[0]).toMatchObject({ amount: 40 * 20 * 2, operations: 1 });
  expect(result.undo).toMatchObject({ ok: true, value: { changed: true } });
  expect(result.undone).toEqual([0, 0]);
  expect(result.canUndoAfterUndo).toBe(false);
  expect(result.redo).toMatchObject({ ok: true, value: { changed: true } });
  expect(result.redone).toEqual(result.painted);
});

test("paint API applies a feathered mask and transparent lock once after an overlapping batch", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { PaintDocument } = await import("/src/core/PaintDocument.ts");
    const { History } = await import("/src/core/History.ts");
    const { Timelapse } = await import("/src/core/Timelapse.ts");
    const { createPaintApi } = await import("/src/core/paintApi/index.ts");
    const doc = new PaintDocument(64, 64, 1);
    const history = new History();
    const timelapse = new Timelapse();
    const layer = doc.getActiveLayer()!;
    layer.store.putImageData(new ImageData(new Uint8ClampedArray([255, 0, 0, 255]), 1, 1), 32, 32);
    layer.meta.transparentPixelLock = true;
    let selection: import("/src/types.ts").Selection = {
      kind: "mask",
      data: new Uint8ClampedArray([0, 0, 0, 128, 0, 0, 0, 128]),
      maskWidth: 2,
      maskHeight: 1,
      x: 32,
      y: 32,
      w: 2,
      h: 1,
    };
    const api = createPaintApi({
      getDocument: () => doc, getHistory: () => history, getTimelapse: () => timelapse,
      getSelection: () => selection, setSelection: next => { selection = next; },
    });
    const settings = { kind: "pen", size: 8, opacity: 1, pressureSize: 0, pressureOpacity: 0, stabilizer: 0 };
    const batch = await api.execute("drawing.stroke_batch", {
      strokes: [
        { points: [{ x: 32, y: 32 }], settings: { ...settings, color: "#0000ff" } },
        { points: [{ x: 32, y: 32 }], settings: { ...settings, color: "#00ff00" } },
      ],
    });
    return { batch, pixels: Array.from(layer.store.getImageData(32, 32, 2, 1).data) };
  });

  expect(result.batch).toMatchObject({ ok: true, value: { changed: true, strokeCount: 2 } });
  expect(result.pixels).toEqual([127, 128, 0, 255, 0, 0, 0, 0]);
});

test("paint API batch leaves the store untouched when a later staging stroke fails", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { PaintDocument } = await import("/src/core/PaintDocument.ts");
    const { History } = await import("/src/core/History.ts");
    const { Timelapse } = await import("/src/core/Timelapse.ts");
    const { createPaintApi } = await import("/src/core/paintApi/index.ts");
    const doc = new PaintDocument(64, 64, 1);
    const history = new History();
    const timelapse = new Timelapse();
    let selection = { kind: "none" } as import("/src/types.ts").Selection;
    const api = createPaintApi({
      getDocument: () => doc, getHistory: () => history, getTimelapse: () => timelapse,
      getSelection: () => selection, setSelection: next => { selection = next; },
    });
    const canvasPrototype = CanvasRenderingContext2D.prototype as unknown as {
      getImageData: (this: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) => ImageData;
    };
    const originalCanvasGetImageData = canvasPrototype.getImageData;
    let stagedStrokeReads = 0;
    canvasPrototype.getImageData = function (x, y, width, height) {
      if (this.canvas.width < 64 && this.canvas.height < 64 && ++stagedStrokeReads === 2) {
        throw new Error("2本目のステージング失敗");
      }
      return originalCanvasGetImageData.call(this, x, y, width, height);
    };
    const settings = { kind: "pen", size: 8, opacity: 1, color: "#e83355", pressureSize: 0, pressureOpacity: 0, stabilizer: 0 };
    let batch: unknown;
    try {
      batch = await api.execute("drawing.stroke_batch", {
        strokes: [
          { points: [{ x: 12, y: 20 }], settings },
          { points: [{ x: 48, y: 20 }], settings },
        ],
      });
    } finally {
      canvasPrototype.getImageData = originalCanvasGetImageData;
    }
    const layer = doc.getActiveLayer()!;
    return {
      batch,
      stagedStrokeReads,
      alphas: [
        layer.store.getImageData(12, 20, 1, 1).data[3],
        layer.store.getImageData(48, 20, 1, 1).data[3],
      ],
      canUndo: history.canUndo(),
    };
  });

  expect(result.stagedStrokeReads).toBe(2);
  expect(result.batch).toMatchObject({ ok: false });
  expect(result.alphas).toEqual([0, 0]);
  expect(result.canUndo).toBe(false);
});

test("paint API validates every batch stroke before drawing", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { PaintDocument } = await import("/src/core/PaintDocument.ts");
    const { History } = await import("/src/core/History.ts");
    const { Timelapse } = await import("/src/core/Timelapse.ts");
    const { createPaintApi } = await import("/src/core/paintApi/index.ts");
    const doc = new PaintDocument(64, 64, 1);
    const history = new History();
    const timelapse = new Timelapse();
    let selection = { kind: "none" } as import("/src/types.ts").Selection;
    const api = createPaintApi({
      getDocument: () => doc, getHistory: () => history, getTimelapse: () => timelapse,
      getSelection: () => selection, setSelection: next => { selection = next; },
    });
    const settings = { kind: "pen", size: 6, opacity: 1, color: "#3355aa" };
    const invalidCustom = await api.execute("drawing.stroke_batch", {
      strokes: [
        { points: [{ x: 8, y: 8 }, { x: 20, y: 8 }], settings },
        { points: [{ x: 40, y: 40 }], settings: { kind: "custom", size: 6, opacity: 1, color: "#3355aa", customBrushId: "missing" } },
      ],
    });
    const afterInvalidCustom = doc.getActiveLayer()!.store.getImageData(8, 8, 1, 1).data[3];
    const points = (count: number) => Array.from({ length: count }, () => ({ x: 32, y: 32 }));
    const overLimit = await api.execute("drawing.stroke_batch", {
      strokes: [
        { points: points(10000), settings },
        { points: points(10000), settings },
        { points: points(10000), settings },
        { points: points(2769), settings },
      ],
    });
    const afterOverLimit = doc.getActiveLayer()!.store.getImageData(32, 32, 1, 1).data[3];
    return { invalidCustom, afterInvalidCustom, overLimit, afterOverLimit, canUndo: history.canUndo() };
  });

  expect(result.invalidCustom).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
  expect(result.afterInvalidCustom).toBe(0);
  expect(result.overLimit).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
  expect(result.afterOverLimit).toBe(0);
  expect(result.canUndo).toBe(false);
});

test("paint API preserves transparent-pixel lock and returns scaled crop metadata", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { PaintDocument } = await import("/src/core/PaintDocument.ts");
    const { History } = await import("/src/core/History.ts");
    const { Timelapse } = await import("/src/core/Timelapse.ts");
    const { createPaintApi } = await import("/src/core/paintApi/index.ts");
    const doc = new PaintDocument(80, 40, 1);
    const history = new History();
    const timelapse = new Timelapse();
    let selection = { kind: "none" } as import("/src/types.ts").Selection;
    const api = createPaintApi({
      getDocument: () => doc,
      getHistory: () => history,
      getTimelapse: () => timelapse,
      getSelection: () => selection,
      setSelection: (next) => { selection = next; },
    });
    await api.execute("layer.update_meta", { layerId: doc.activeLayerId, transparentPixelLock: true });
    await api.execute("drawing.stroke", {
      points: [{ x: 10, y: 10, pressure: 1 }, { x: 30, y: 10, pressure: 1 }],
      settings: { kind: "pen", size: 8, opacity: 1, color: "#0000ff" },
    });
    const lockedAlpha = doc.getActiveLayer()!.store.getImageData(20, 10, 1, 1).data[3];
    await api.execute("layer.update_meta", { layerId: doc.activeLayerId, transparentPixelLock: false });
    await api.execute("drawing.stroke", {
      points: [{ x: 10, y: 10, pressure: 1 }, { x: 30, y: 10, pressure: 1 }],
      settings: { kind: "pen", size: 8, opacity: 1, color: "#0000ff" },
    });
    const unlockedAlpha = doc.getActiveLayer()!.store.getImageData(20, 10, 1, 1).data[3];
    const image = await api.execute("document.get_image", { x: 0, y: 0, width: 40, height: 20, maxEdge: 10 });
    return { lockedAlpha, unlockedAlpha, image };
  });

  expect(result.lockedAlpha).toBe(0);
  expect(result.unlockedAlpha).toBeGreaterThan(0);
  expect(result.image).toMatchObject({
    ok: true,
    value: {
      mimeType: "image/png",
      width: 10,
      height: 5,
      region: { x: 0, y: 0, width: 40, height: 20 },
    },
  });
  if (result.image.ok) {
    expect(result.image.value.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(result.image.value.byteLength).toBeGreaterThan(0);
  }
});

test("paint API bridges worker effects and structure history", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { PaintDocument } = await import("/src/core/PaintDocument.ts");
    const { History } = await import("/src/core/History.ts");
    const { Timelapse } = await import("/src/core/Timelapse.ts");
    const { createPaintApi } = await import("/src/core/paintApi/index.ts");
    const doc = new PaintDocument(32, 32, 1);
    const history = new History();
    const timelapse = new Timelapse();
    let selection = { kind: "none" } as import("/src/types.ts").Selection;
    const api = createPaintApi({
      getDocument: () => doc, getHistory: () => history, getTimelapse: () => timelapse,
      getSelection: () => selection, setSelection: (next) => { selection = next; },
    });
    const fill = await api.execute("drawing.fill", { x: 0, y: 0, color: "#ff0000", tolerance: 0 });
    await api.execute("selection.set", { kind: "rect", x: 0, y: 0, width: 16, height: 32 });
    const adjust = await api.execute("drawing.color_adjust", { adjustment: { kind: "invert" } });
    const pixels = doc.getActiveLayer()!.store.getImageData(8, 8, 16, 1).data;
    const inside = Array.from(pixels.slice(0, 4));
    const outside = Array.from(pixels.slice(pixels.length - 4));
    const group = await api.execute("layer.add_group", { name: "仕上げ" });
    const groupId = group.ok ? (group.value as { layerId: string }).layerId : "";
    const hasGroup = !!doc.getLayer(groupId);
    await api.execute("history.undo", {});
    const groupAfterUndo = !!doc.getLayer(groupId);
    return { fill, adjust, group, inside, outside, hasGroup, groupAfterUndo };
  });

  expect(result.fill).toMatchObject({ ok: true, value: { changed: true } });
  expect(result.adjust).toMatchObject({ ok: true, value: { changed: true } });
  expect(result.inside).toEqual([0, 255, 255, 255]);
  expect(result.outside).toEqual([255, 0, 0, 255]);
  expect(result.group).toMatchObject({ ok: true });
  expect(result.hasGroup).toBe(true);
  expect(result.groupAfterUndo).toBe(false);
});

test("paint API duplicates pixels, samples/picks layers, and round-trips selection masks", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { PaintDocument } = await import("/src/core/PaintDocument.ts");
    const { History } = await import("/src/core/History.ts");
    const { Timelapse } = await import("/src/core/Timelapse.ts");
    const { createPaintApi } = await import("/src/core/paintApi/index.ts");
    const doc = new PaintDocument(48, 48, 1);
    const history = new History(); const timelapse = new Timelapse();
    let selection = { kind: "none" } as import("/src/types.ts").Selection;
    const api = createPaintApi({
      getDocument: () => doc, getHistory: () => history, getTimelapse: () => timelapse,
      getSelection: () => selection, setSelection: (next) => { selection = next; },
    });
    await api.execute("drawing.stroke", {
      points: [{ x: 12, y: 12, pressure: 1 }, { x: 24, y: 12, pressure: 1 }],
      settings: { kind: "pen", size: 8, opacity: 1, color: "#123456" },
    });
    const sourceId = doc.activeLayerId;
    const duplicate = await api.execute("layer.duplicate", { layerId: sourceId });
    const duplicateId = duplicate.ok ? (duplicate.value as { layerId: string }).layerId : "";
    await api.execute("layer.set_active", { layerId: sourceId });
    const picked = await api.execute("layer.pick", { x: 18, y: 12 });
    const sampled = await api.execute("document.sample_color", { x: 18, y: 12, source: "composite" });
    await api.execute("selection.set", { kind: "rect", x: 8, y: 8, width: 16, height: 12 });
    const exported = await api.execute("selection.get_mask", {});
    const dataUrl = exported.ok ? (exported.value as { dataUrl: string }).dataUrl : "";
    await api.execute("selection.set", { kind: "none" });
    const imported = await api.execute("selection.set_mask", { dataUrl, x: 4, y: 5 });
    return { duplicate, duplicateId, picked, sampled, exported, imported };
  });

  expect(result.duplicate).toMatchObject({ ok: true });
  expect(result.picked).toMatchObject({ ok: true, value: { layerId: result.duplicateId } });
  expect(result.sampled).toMatchObject({ ok: true, value: { hex: "#123456", a: 255 } });
  expect(result.exported).toMatchObject({ ok: true, value: { width: 16, height: 12 } });
  expect(result.imported).toMatchObject({
    ok: true,
    value: { kind: "mask", x: 4, y: 5, w: 16, h: 12, maskWidth: 16, maskHeight: 12 },
  });
});

test("canvas dimension changes clear incompatible undo and selection state", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { PaintDocument } = await import("/src/core/PaintDocument.ts");
    const { History } = await import("/src/core/History.ts");
    const { Timelapse } = await import("/src/core/Timelapse.ts");
    const { createPaintApi } = await import("/src/core/paintApi/index.ts");
    const doc = new PaintDocument(32, 32, 1);
    const history = new History(); const timelapse = new Timelapse();
    let selection = { kind: "none" } as import("/src/types.ts").Selection;
    const api = createPaintApi({
      getDocument: () => doc, getHistory: () => history, getTimelapse: () => timelapse,
      getSelection: () => selection, setSelection: next => { selection = next; },
    });
    const states = [];
    for (const [name, args] of [
      ["canvas.resize", { width: 48, height: 40 }],
      ["canvas.extend", { top: 4, right: 2, bottom: 0, left: 2 }],
    ] as const) {
      await api.execute("drawing.fill", { x: 0, y: 0, color: name === "canvas.resize" ? "#cc2222" : "#2222cc", tolerance: 0 });
      const couldUndo = history.canUndo();
      await api.execute("selection.set", { kind: "rect", x: 0, y: 0, width: 8, height: 8 });
      const changed = await api.execute(name, args);
      const undo = await api.execute("history.undo", {});
      states.push({ couldUndo, changed, canUndo: history.canUndo(), selection, undo, width: doc.width, height: doc.height });
    }
    return states;
  });
  expect(result.map(s => [s.width, s.height])).toEqual([[48, 40], [52, 44]]);
  for (const state of result) {
    expect(state.couldUndo).toBe(true);
    expect(state.changed).toMatchObject({ ok: true, value: { changed: true } });
    expect(state.canUndo).toBe(false);
    expect(state.selection).toEqual({ kind: "none" });
    expect(state.undo).toMatchObject({ ok: true, value: { changed: false } });
  }
});
