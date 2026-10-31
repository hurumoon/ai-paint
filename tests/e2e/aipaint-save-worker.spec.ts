import { expect, test } from "@playwright/test";

test("measures frame gaps during a real dense 8K PNG and archive save", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { PaintDocument } = await import("/src/core/PaintDocument.ts");
    const { saveAiPaint } = await import("/src/core/nativeFormat.ts");
    const { loadAiPaintArchiveWorker } = await import("/src/workers/aiPaintLoadClient.ts");
    const size = 8192;
    const block = 256;
    const doc = new PaintDocument(size, size, 1);
    const store = doc.layers[0].store;
    const colorAt = (x: number, y: number) => [
      (Math.floor(x / block) * 17) & 255,
      (Math.floor(y / block) * 29) & 255,
      123, 255,
    ];
    // 全域に実タイルを作る。準備時の全サイズ staging と保存前の alpha bounds キャッシュを避ける。
    for (let y = 0; y < size; y += block) {
      for (let x = 0; x < size; x += block) {
        const [r, g, b] = colorAt(x, y);
        store.withCtx(ctx => {
          ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
          ctx.fillRect(x, y, block, block);
        }, { x, y, w: block, h: block });
      }
    }
    const nextFrame = () => new Promise<number>(resolve => {
      requestAnimationFrame(() => resolve(performance.now()));
    });
    let previous = await nextFrame();
    const baselineGaps: number[] = [];
    for (let i = 0; i < 12; i++) {
      const now = await nextFrame();
      baselineGaps.push(now - previous);
      previous = now;
    }
    const gaps: number[] = [];
    let raf = 0;
    const tick = () => {
      const now = performance.now();
      gaps.push(now - previous);
      previous = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    let saved: Blob;
    let elapsedMs = 0;
    let framesDuringSave = 0;
    const started = performance.now();
    try {
      saved = await saveAiPaint(doc);
      elapsedMs = performance.now() - started;
      framesDuringSave = gaps.length;
      // 完了直前の同期停止も次のフレームで拾う。ここより後のPNG検証は計測に含めない。
      await nextFrame();
    } finally {
      cancelAnimationFrame(raf);
      store.clearRect(0, 0, size, size);
    }
    const { manifest, entries } = await loadAiPaintArchiveWorker(saved);
    const png = entries["layers/layer-000001.png"];
    const bitmap = await createImageBitmap(new Blob([png], { type: "image/png" }));
    let pngSize: number[];
    let pixelsIntact: boolean;
    try {
      pngSize = [bitmap.width, bitmap.height];
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext("2d")!;
      pixelsIntact = [[0, 0], [4096, 4096], [8191, 8191]].every(([x, y]) => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.drawImage(bitmap, x, y, 1, 1, 0, 0, 1, 1);
        return Array.from(ctx.getImageData(0, 0, 1, 1).data)
          .every((value, i) => value === colorAt(x, y)[i]);
      });
    } finally {
      bitmap.close();
    }
    return {
      width: manifest.width, height: manifest.height, layerCount: manifest.layers.length,
      pngSize, pixelsIntact, archiveBytes: saved.size, type: saved.type,
      elapsedMs, framesDuringSave, measuredFrames: gaps.length,
      baselineMaxGapMs: Math.max(...baselineGaps), maxFrameGapMs: Math.max(...gaps),
      gapsOver100Ms: gaps.filter(gap => gap >= 100).length,
      gapsOver300Ms: gaps.filter(gap => gap >= 300).length,
      offscreenCanvasAvailable: typeof OffscreenCanvas !== "undefined"
        && typeof OffscreenCanvas.prototype.convertToBlob === "function",
      userAgent: navigator.userAgent,
    };
  });
  console.log("aipaint dense 8K save responsiveness", result);
  await testInfo.attach("dense-8k-save-responsiveness", {
    body: JSON.stringify(result, null, 2), contentType: "application/json",
  });
  // 初回の実測用。環境依存の時間を合否にせず、100/300ms超過を判断材料として残す。
  testInfo.annotations.push({
    type: "save-frame-gap",
    description: `max=${result.maxFrameGapMs.toFixed(1)}ms; >=100ms: ${result.gapsOver100Ms}; >=300ms: ${result.gapsOver300Ms}`,
  });
  expect(result.measuredFrames).toBeGreaterThan(0);
  expect(result.maxFrameGapMs).toBeGreaterThan(0);
  expect(result.width).toBe(8192);
  expect(result.height).toBe(8192);
  expect(result.layerCount).toBe(1);
  expect(result.pngSize).toEqual([8192, 8192]);
  expect(result.pixelsIntact).toBe(true);
  expect(result.archiveBytes).toBeGreaterThan(0);
  expect(result.type).toBe("application/x-aipaint");
});

test("streams large entries through the save worker while the UI keeps rendering", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { createAiPaintArchiveWriter } = await import("/src/workers/aiPaintSaveClient.ts");
    const { loadAiPaintArchiveWorker } = await import("/src/workers/aiPaintLoadClient.ts");
    const paths = ["layers/layer-000001.png", "layers/layer-000002.png"];
    const entrySize = 32 * 1024 * 1024;
    const manifest = {
      magic: "aipaint-v2", version: 2, width: 4096, height: 4096, dpi: 96,
      activeLayerId: "layer-0",
      layers: paths.map((file, i) => ({
        id: `layer-${i}`, name: `large-${i}`, visible: true, opacity: 1,
        blendMode: "normal", locked: false, kind: "raster", file,
        bounds: { x: 0, y: 0, width: 4096, height: 4096 },
      })),
    };
    // ZIP境界の負荷試験。実PNGのデコード・描画はformat-roundtripで検証する。
    const input = paths.map((_, index) => {
      const bytes = new Uint8Array(entrySize);
      for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + index * 17) & 255;
      return bytes;
    });
    const originalBlob = window.Blob;
    const originalArrayBuffer = Blob.prototype.arrayBuffer;
    // 完成ZIP用Blobやその全量読み出しがUI側へ戻っていないことも確認する。
    window.Blob = class extends originalBlob {
      constructor() { throw new Error("UI thread must not assemble the archive"); }
    };
    originalBlob.prototype.arrayBuffer = () => { throw new Error("UI thread must not read archive bytes"); };
    let frames = 0;
    let raf = 0;
    const tick = () => { frames++; raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    const writer = createAiPaintArchiveWriter();
    let saved: Blob;
    const started = performance.now();
    let elapsedMs = 0;
    try {
      for (let i = 0; i < input.length; i++) await writer.add(paths[i], input[i]);
      await writer.add("manifest.json", new TextEncoder().encode(JSON.stringify(manifest)));
      saved = await writer.finish();
      elapsedMs = performance.now() - started;
    } finally {
      writer.dispose();
      cancelAnimationFrame(raf);
      window.Blob = originalBlob;
      originalBlob.prototype.arrayBuffer = originalArrayBuffer;
    }
    const { entries } = await loadAiPaintArchiveWorker(saved);
    const intact = paths.every((path, index) => {
      const bytes = entries[path];
      if (bytes.byteLength !== entrySize) return false;
      for (let i = 0; i < bytes.length; i++) if (bytes[i] !== ((i * 31 + index * 17) & 255)) return false;
      return true;
    });
    return {
      frames, elapsedMs, intact, size: saved.size, type: saved.type,
      detached: input.every(bytes => bytes.byteLength === 0),
    };
  });
  expect(result.frames).toBeGreaterThan(0);
  expect(result.detached).toBe(true);
  expect(result.intact).toBe(true);
  expect(result.size).toBeGreaterThan(64 * 1024 * 1024);
  expect(result.size).toBeLessThan(64 * 1024 * 1024 + 4096);
  expect(result.type).toBe("application/x-aipaint");
  console.log("aipaint save worker responsiveness", result);
});
