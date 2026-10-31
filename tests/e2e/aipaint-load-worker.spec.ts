import { expect, test } from "@playwright/test";
import { randomFillSync } from "node:crypto";
import { strToU8, zipSync } from "fflate";

test("extracts a large archive off the UI thread with intact entry bytes", async ({ page }) => {
  test.setTimeout(60_000);
  const bytes = randomFillSync(new Uint8Array(32 * 1024 * 1024));
  const manifest = {
    magic: "aipaint-v2", version: 2, width: 4096, height: 4096, dpi: 96,
    activeLayerId: "layer-1",
    layers: [{
      id: "layer-1", name: "large", visible: true, opacity: 1,
      blendMode: "normal", locked: false, kind: "raster",
      file: "layers/layer-000001.png",
      bounds: { x: 0, y: 0, width: 4096, height: 4096 },
    }],
  };
  // このテストはZIP展開境界を検証する。PNGデコードはroundtripテストで検証する。
  const zipped = zipSync({
    "manifest.json": strToU8(JSON.stringify(manifest)),
    "layers/layer-000001.png": bytes,
    "unreferenced.bin": new Uint8Array([9, 8, 7]),
  }, { level: 1 });
  await page.route("**/large-test.aipaint", route => route.fulfill({
    body: Buffer.from(zipped), contentType: "application/x-aipaint",
  }));
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { loadAiPaintArchiveWorker } = await import("/src/workers/aiPaintLoadClient.ts");
    const blob = await (await fetch("/large-test.aipaint")).blob();
    const original = Blob.prototype.arrayBuffer;
    Blob.prototype.arrayBuffer = () => { throw new Error("UI thread must not read archive bytes"); };
    let frames = 0;
    let raf = 0;
    const tick = () => { frames++; raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    const started = performance.now();
    try {
      const { entries, manifest } = await loadAiPaintArchiveWorker(blob);
      const elapsedMs = performance.now() - started;
      const data = entries["layers/layer-000001.png"];
      return {
        frames, elapsedMs, version: manifest.version, paths: Object.keys(entries),
        size: data.byteLength, first: Array.from(data.slice(0, 32)),
        last: Array.from(data.slice(-32)),
      };
    } finally {
      cancelAnimationFrame(raf);
      Blob.prototype.arrayBuffer = original;
    }
  });
  expect(result.frames).toBeGreaterThan(0);
  expect(result.version).toBe(2);
  expect(result.paths).toEqual(["layers/layer-000001.png"]);
  expect(result.size).toBe(bytes.byteLength);
  expect(result.first).toEqual(Array.from(bytes.slice(0, 32)));
  expect(result.last).toEqual(Array.from(bytes.slice(-32)));
  console.log("aipaint worker responsiveness", { frames: result.frames, elapsedMs: result.elapsedMs });
});

test("rejects corrupt archives without changing the document and can load again", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { PaintDocument } = await import("/src/core/PaintDocument.ts");
    const { loadAiPaint, saveAiPaint } = await import("/src/core/nativeFormat.ts");
    const doc = new PaintDocument(16, 12, 1);
    const layerId = doc.activeLayerId;
    let message = "";
    try { await loadAiPaint(new Blob(["broken zip"]), doc); }
    catch (error) { message = (error as Error).message; }
    const unchanged = doc.width === 16 && doc.height === 12 && doc.activeLayerId === layerId;
    const saved = await saveAiPaint(doc);
    await loadAiPaint(saved, doc);
    return { message, unchanged, width: doc.width, height: doc.height };
  });
  expect(result.message).toContain("破損");
  expect(result.unchanged).toBe(true);
  expect(result.width).toBe(16);
  expect(result.height).toBe(12);
});

test("loads V1 pixels and clears a previous AI session", async ({ page }) => {
  await page.goto("/");
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, 1, 1);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  const zipped = zipSync({
    "manifest.json": strToU8(JSON.stringify({
      magic: "aipaint-v1", version: 1, width: 1, height: 1, dpi: 96,
      activeLayerId: "legacy",
      layers: [{ id: "legacy", name: "旧形式", visible: true, opacity: 1,
        blendMode: "normal", locked: false, kind: "raster", file: "layer-001.png" }],
    })),
    "layers/layer-001.png": Buffer.from(png, "base64"),
  });
  await page.route("**/legacy-test.aipaint", route => route.fulfill({ body: Buffer.from(zipped) }));
  const result = await page.evaluate(async () => {
    const { PaintDocument } = await import("/src/core/PaintDocument.ts");
    const { loadAiPaint } = await import("/src/core/nativeFormat.ts");
    const { createDrawingAgentSession, setDrawingAgentSession, getDrawingAgentSession } = await import("/src/core/agent/session.ts");
    const doc = new PaintDocument(4, 4, 1);
    setDrawingAgentSession(doc, createDrawingAgentSession({ id: "old", bindingId: "tab", prompt: "test", provider: "openai", model: "test", now: 1 }));
    await loadAiPaint(await (await fetch("/legacy-test.aipaint")).blob(), doc);
    return { width: doc.width, height: doc.height, name: doc.layers[0].meta.name,
      pixel: Array.from(doc.layers[0].store.getImageData(0, 0, 1, 1).data),
      sessionCleared: getDrawingAgentSession(doc) === undefined };
  });
  expect(result).toEqual({ width: 1, height: 1, name: "旧形式", pixel: [255, 0, 0, 255], sessionCleared: true });
});

test("restores V2 AI recording through the real worker", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { PaintDocument } = await import("/src/core/PaintDocument.ts");
    const { loadAiPaint, saveAiPaint } = await import("/src/core/nativeFormat.ts");
    const { createDrawingAgentSession, setDrawingAgentSession, getDrawingAgentSession } = await import("/src/core/agent/session.ts");
    const doc = new PaintDocument(8, 8, 1);
    const session = createDrawingAgentSession({ id: "recording", bindingId: "tab", prompt: "青空", provider: "openai", model: "test", now: 1 });
    session.status = "running";
    setDrawingAgentSession(doc, session);
    const saved = await saveAiPaint(doc);
    const loaded = new PaintDocument(1, 1, 1);
    await loadAiPaint(saved, loaded);
    const restored = getDrawingAgentSession(loaded);
    return { id: restored?.id, prompt: restored?.prompt, status: restored?.status };
  });
  expect(result).toEqual({ id: "recording", prompt: "青空", status: "paused" });
});
