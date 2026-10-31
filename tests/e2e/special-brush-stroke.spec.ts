import { expect, test, type Page } from "@playwright/test";

type ProbeMode = "polygon" | "wide-polygon" | "mask" | "full-mask" | "fractional-mask" | "lock" | "mask-lock";

async function probeStroke(page: Page, options: {
  mode: ProbeMode;
  eraser?: boolean;
  large?: boolean;
  cancel?: boolean;
  flush?: boolean;
  outside?: boolean;
}) {
  return page.evaluate(async ({ mode, eraser = false, large = false, cancel = false, flush = false, outside = false }) => {
    const { PaintDocument } = await import("/src/core/PaintDocument.ts");
    const { History } = await import("/src/core/History.ts");
    const { Timelapse } = await import("/src/core/Timelapse.ts");
    const { useBrushStrokeSession } = await import("/src/hooks/canvasTools/useBrushStrokeSession.ts");
    const { selectionMaskCanvas } = await import("/src/core/toolHandlers.ts");
    const { createElement } = (await import("/node_modules/.vite/deps/react.js")).default;
    const { createRoot } = (await import("/node_modules/.vite/deps/react-dom_client.js")).default;
    const { flushSync } = (await import("/node_modules/.vite/deps/react-dom.js")).default;
    type Selection = import("../../src/types").Selection;
    type Session = ReturnType<typeof useBrushStrokeSession>;
    const width = large ? 12_000 : 600;
    const height = large ? 9_000 : 80;
    const doc = new PaintDocument(width, height, 1);
    const history = new History();
    const layer = doc.getActiveLayer()!;
    layer.meta.transparentPixelLock = mode === "lock" || mode === "mask-lock";
    // 2つのタイル境界を跨ぎ、透明・半透明・不透明の元ピクセルを含める。
    const seed = new ImageData(600, 80);
    for (let y = 0; y < seed.height; y += 1) {
      for (let x = 0; x < seed.width; x += 1) {
        const i = (y * seed.width + x) * 4;
        seed.data.set([30, 100, 180, x % 30 < 10 ? 0 : x % 30 < 20 ? 128 : 255], i);
      }
    }
    layer.store.putImageData(seed, 0, 0);
    let selection: Selection = { kind: "none" };
    if (mode === "polygon") {
      selection = {
        kind: "polygon", x: 230, y: 10, w: 320, h: 50,
        points: [{ x: 230.25, y: 10.5 }, { x: 549.5, y: 18.25 }, { x: 510.5, y: 59.5 }, { x: 246.25, y: 52.5 }],
      };
    } else if (mode === "mask" || mode === "full-mask" || mode === "fractional-mask" || mode === "mask-lock") {
      const full = mode === "full-mask";
      const maskWidth = full ? width : 320;
      const maskHeight = full ? height : 50;
      const data = new Uint8ClampedArray(maskWidth * maskHeight * 4);
      for (let y = 10; y < 60; y += 1) {
        for (let x = 230; x < 550; x += 1) {
          const i = ((full ? y : y - 10) * maskWidth + (full ? x : x - 230)) * 4;
          data.set([255, 255, 255, [0, 96, 128, 255][Math.floor(x / 7) % 4]], i);
        }
      }
      selection = { kind: "mask", data, maskWidth, maskHeight, x: mode === "fractional-mask" ? 230.25 : 230, y: mode === "fractional-mask" ? 10.5 : 10, w: 320, h: 50 };
    }
    if (mode === "wide-polygon") {
      selection = {
        kind: "polygon", x: 220, y: 10, w: width - 230, h: height - 20,
        points: [{ x: 220.25, y: 10.5 }, { x: width - 10, y: 18.25 },
          { x: width - 15, y: height - 10 }, { x: 230.25, y: height - 20 }],
      };
    }
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let session: Session | undefined;
    function Harness() {
      session = useBrushStrokeSession({
        doc, history, timelapse: new Timelapse(), selection, stabilizer: flush ? 0.75 : 0,
        isDrawingRef: { current: false }, rendererRef: { current: null },
        brushSettingsFor: () => ({ kind: eraser ? "eraser-round" : "round", size: 18, opacity: 0.55, color: "#ed351a", pressureSize: 0, pressureOpacity: 0 }),
      });
      return null;
    }
    flushSync(() => root.render(createElement(Harness)));
    if (!session) throw new Error("Stroke harness did not mount");
    const stroke = session;
    const before = layer.store.getImageData(0, 0, 600, 80);
    const canvasSizes: { width: number; height: number }[] = [];
    const widthDescriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "width")!;
    const heightDescriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "height")!;
    const NativeOffscreenCanvas = window.OffscreenCanvas;
    let measuring = true;
    for (const [key, descriptor] of [["width", widthDescriptor], ["height", heightDescriptor]] as const) {
      Object.defineProperty(HTMLCanvasElement.prototype, key, {
        ...descriptor,
        set(this: HTMLCanvasElement, value: number) {
          descriptor.set!.call(this, value);
          if (measuring) canvasSizes.push({ width: this.width, height: this.height });
        },
      });
    }
    window.OffscreenCanvas = new Proxy(NativeOffscreenCanvas, {
      construct(target, args: [number, number]) {
        if (measuring) canvasSizes.push({ width: args[0], height: args[1] });
        return new target(...args);
      },
    });
    const pixelsEqual = (a: ImageData, b: ImageData) => a.data.every((v, i) => v === b.data[i]);
    try {
      stroke.startBrushStroke({ x: outside ? -100 : 236, y: 35, pressure: 0.5 }, eraser ? "eraser" : "brush");
      const allocationsAtStart = canvasSizes.length;
      const alphaErrors: number[] = [];
      function checkLockedAlpha() {
        if (!layer.meta.transparentPixelLock) return;
        const wasMeasuring = measuring;
        measuring = false;
        const current = layer.store.getImageData(0, 0, 600, 80);
        let errors = 0;
        for (let i = 3; i < current.data.length; i += 4) if (current.data[i] !== before.data[i]) errors += 1;
        alphaErrors.push(errors);
        measuring = wasMeasuring;
      }
      checkLockedAlpha();
      for (const x of outside ? [-90] : flush ? [249] : large ? [249, 263] : [270, 500, 540]) {
        stroke.continueBrushStroke({ x, y: 35, pressure: 0.5 });
        checkLockedAlpha();
      }
      let reference: ImageData | undefined;
      if (!large && !cancel && !flush && !outside && selection.kind !== "none") {
        // 旧コードの全画面Canvas合成を参照結果として残す。
        // 参照計算のCanvasは実フックの確保サイズ計測に含めない。
        measuring = false;
        const makeCanvas = () => {
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          return canvas;
        };
        const beforeCanvas = makeCanvas();
        beforeCanvas.getContext("2d")!.putImageData(before, 0, 0);
        const after = makeCanvas();
        const actx = after.getContext("2d")!;
        layer.store.drawTo(actx, 0, 0, history.getPendingRegion()!);
        const mask = selectionMaskCanvas(selection, width, height)!;
        actx.globalCompositeOperation = "destination-in";
        actx.drawImage(mask, 0, 0);
        const expected = makeCanvas();
        const ctx = expected.getContext("2d")!;
        ctx.drawImage(beforeCanvas, 0, 0);
        if (eraser) {
          const erased = makeCanvas();
          const ectx = erased.getContext("2d")!;
          ectx.drawImage(beforeCanvas, 0, 0);
          ectx.globalCompositeOperation = "destination-out";
          ectx.drawImage(after, 0, 0);
          ectx.globalCompositeOperation = "destination-in";
          ectx.drawImage(mask, 0, 0);
          ctx.globalCompositeOperation = "destination-out";
          ctx.drawImage(erased, 0, 0);
        } else ctx.drawImage(after, 0, 0);
        // このストロークは文書内の3タイル全てに触れる。旧withCtxのhintは
        // タイル選別なので、pendingの矩形外も含めて全タイルの合成結果を比較する。
        reference = ctx.getImageData(0, 0, width, height);
        measuring = true;
      }
      if (cancel) stroke.cancelBrushStroke();
      else await stroke.finishBrushStroke(flush ? { x: 590, y: 35, pressure: 0.5 } : null);
      measuring = false;
      const after = layer.store.getImageData(0, 0, 600, 80);
      if (mode === "lock") checkLockedAlpha();
      const committed = history.canUndo();
      history.undo(doc);
      const undoMatches = pixelsEqual(layer.store.getImageData(0, 0, 600, 80), before);
      history.redo(doc);
      const redoMatches = pixelsEqual(layer.store.getImageData(0, 0, 600, 80), after);
      const samples: unknown[] = [];
      let maxReferenceError = 0;
      let referenceErrorPixels = 0;
      if (reference) {
        for (let i = 0; i < after.data.length; i += 4) {
          const error = Math.max(...[0, 1, 2, 3].map(c => Math.abs(after.data[i + c] - reference!.data[i + c])));
          maxReferenceError = Math.max(maxReferenceError, error);
          if (error > 0) { referenceErrorPixels += 1; if (samples.length < 12) samples.push({x:(i/4)%600,y:Math.floor(i/4/600), actual:Array.from(after.data.slice(i,i+4)), expected:Array.from(reference.data.slice(i,i+4))}); }
        }
      }
      return {
        canvasSizes, allocationsAtStart, alphaErrors, committed, undoMatches, redoMatches,
        samples, maxReferenceError, referenceErrorPixels, unchanged: pixelsEqual(before, after),
      };
    } finally {
      Object.defineProperty(HTMLCanvasElement.prototype, "width", widthDescriptor);
      Object.defineProperty(HTMLCanvasElement.prototype, "height", heightDescriptor);
      window.OffscreenCanvas = NativeOffscreenCanvas;
      flushSync(() => root.unmount());
      host.remove();
    }
  }, options);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto("/");
});

for (const mode of ["polygon", "mask", "full-mask", "fractional-mask", "mask-lock"] as const) {
  for (const eraser of [false, true]) {
    test(`${mode} ${eraser ? "eraser" : "brush"} keeps legacy pixels across tiles and undo/redo`, async ({ page }) => {
      const result = await probeStroke(page, { mode, eraser });
      expect(result.maxReferenceError, JSON.stringify(result.samples)).toBe(0);
      expect(result.referenceErrorPixels).toBe(0);
      expect(result.unchanged).toBe(false);
      expect(result.committed).toBe(true);
      expect(result.undoMatches).toBe(true);
      expect(result.redoMatches).toBe(true);
      expect(result.alphaErrors.every(count => count === 0)).toBe(true);
    });
  }
}

for (const eraser of [false, true]) {
  test(`transparent lock preserves all original alpha during ${eraser ? "erasing" : "painting"} and at finish`, async ({ page }) => {
    const result = await probeStroke(page, { mode: "lock", eraser });
    expect(result.alphaErrors).toEqual([0, 0, 0, 0, 0]);
    expect(result.undoMatches).toBe(true);
    expect(result.redoMatches).toBe(true);
    expect(result.committed).toBe(true);
  });
}

for (const mode of ["polygon", "mask", "lock"] as const) {
  test(`${mode} small stroke on a 12000x9000 document allocates only bounded canvases`, async ({ page }) => {
    const result = await probeStroke(page, { mode, large: true });
    // width/heightの代入途中には既定値300x150が観測される。
    expect(result.canvasSizes.every(size => size.width <= 512 && size.height <= 512)).toBe(true);
    expect(result.undoMatches).toBe(true);
    expect(result.redoMatches).toBe(true);
  });

  test(`${mode} cancellation restores every newly reached tile without a history entry`, async ({ page }) => {
    const result = await probeStroke(page, { mode, cancel: true });
    expect(result.unchanged).toBe(true);
    expect(result.committed).toBe(false);
    expect(result.undoMatches).toBe(true);
  });
}

for (const mode of ["polygon", "mask", "lock"] as const) {
  test(`${mode} flush captures newly reached tiles and remains undoable`, async ({ page }) => {
    const result = await probeStroke(page, { mode, flush: true });
    expect(result.unchanged).toBe(false);
    expect(result.committed).toBe(true);
    expect(result.undoMatches).toBe(true);
    expect(result.redoMatches).toBe(true);
    expect(result.alphaErrors.every(count => count === 0)).toBe(true);
  });
  test(`${mode} wholly outside stroke never falls back to a document canvas`, async ({ page }) => {
    const result = await probeStroke(page, { mode, large: true, outside: true });
    expect(result.unchanged).toBe(true);
    expect(result.committed).toBe(false);
    expect(result.canvasSizes).toEqual([]);
  });
}

test("document-wide polygon uses bounded mask rasterization", async ({ page }) => {
  const result = await probeStroke(page, { mode: "wide-polygon", large: true });
  expect(result.canvasSizes.every(size => size.width <= 1024 && size.height <= 1024)).toBe(true);
  expect(result.unchanged).toBe(false);
  expect(result.undoMatches).toBe(true);
  expect(result.redoMatches).toBe(true);
});
