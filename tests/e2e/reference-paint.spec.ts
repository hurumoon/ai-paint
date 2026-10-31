import { expect, test } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
});

test("reference reconstruction improves the image and its saved brush program reproduces the canvas", async ({ page }) => {
  await page.goto("/experiments/reference-paint.html");
  await expect(page.locator("#status")).toHaveText("完成見本を選択してください");
  const fixture = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#f4f8fc"; ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = "#22bbcc"; ctx.fillRect(8, 8, 24, 48);
    ctx.fillStyle = "#242a37"; ctx.beginPath(); ctx.arc(42, 32, 13, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fc6487"; ctx.fillRect(14, 16, 2, 30);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.locator("#file").setInputFiles({ name: "reference.png", mimeType: "image/png", buffer: Buffer.from(fixture, "base64") });
  await page.getByRole("button", { name: "再描画を試す", exact: true }).click();
  await expect(page.locator("#status")).toContainText("完了:", { timeout: 20_000 });
  const initial = await page.evaluate(() => {
    const data = window.referencePaintExperiment!.evidence()!;
    return { metrics: data.metrics, stages: data.plan.stages.map(s => ({ error: s.meanAbsoluteError, count: s.strokes.length })), final: data.final, project: data.projectDataUrl };
  });
  expect(initial.metrics.meanAbsoluteError).toBeLessThan(8);
  expect(initial.metrics.meanAbsoluteError).toBeLessThan(initial.stages[0].error * 0.3);
  expect(Math.abs(initial.metrics.meanAbsoluteError - initial.metrics.workerError)).toBeLessThan(1);
  expect(initial.stages).toHaveLength(6);
  expect(initial.metrics.strokes).toBeGreaterThan(100);

  await page.locator("#stages button").first().click();
  await expect(page.locator("#replay")).toBeVisible();
  await expect(page.locator("#status")).toContainText("輪郭の下描き");
  expect(await page.locator("#replay-image").getAttribute("src")).not.toBe(initial.final);
  await page.getByRole("button", { name: "キャンバスに戻る", exact: true }).click();
  await expect(page.locator("#replay")).toBeHidden();

  // The program contains coordinates/settings only; replay it after a JSON round-trip on a fresh app tab.
  const replayed = await page.evaluate(async () => {
    const data = window.referencePaintExperiment!.evidence()!;
    const plan = JSON.parse(JSON.stringify(data.plan)) as typeof data.plan;
    const { referenceStrokeBatches } = await import("/src/core/referencePainting/plan.ts");
    const api = (document.getElementById("paint-app") as HTMLIFrameElement).contentWindow!.aiPaint!;
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const result = await api.execute(name, args);
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    };
    await call("tabs.create", { width: plan.width, height: plan.height });
    await call("drawing.fill", { x: 0, y: 0, color: plan.background, tolerance: 0 });
    for (const stage of plan.stages) {
      await call("layer.add", { name: stage.label });
      for (const strokes of referenceStrokeBatches(stage.strokes)) {
        await call("drawing.stroke_batch", { strokes });
      }
    }
    const image = await call("document.get_image", { maxEdge: Math.max(plan.width, plan.height) }) as { dataUrl: string };
    await call("file.open", { dataUrl: data.projectDataUrl, name: "painted.aipaint" });
    const reopened = await call("file.export", { format: "png" }) as { dataUrl: string };
    const pixels = async (url: string) => {
      const bitmap = await createImageBitmap(await (await fetch(url)).blob());
      const canvas = document.createElement("canvas"); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d")!; ctx.drawImage(bitmap, 0, 0); bitmap.close();
      return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    };
    const expectedPixels = await pixels(data.final); const actualPixels = await pixels(reopened.dataUrl);
    if (expectedPixels.length !== actualPixels.length || expectedPixels.some((value, i) => value !== actualPixels[i])) throw new Error("Native project export differs from the displayed painting");
    // Export must still refer to the completed experiment, even after selecting another blank tab.
    await call("tabs.create", { width: 16, height: 16 });
    return image.dataUrl;
  });
  expect(replayed).toBe(initial.final);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "検証結果を保存", exact: true }).click();
  const download = await downloadPromise;
  const zipped = unzipSync(new Uint8Array(await readFile((await download.path())!)));
  expect(Object.keys(zipped)).toEqual(expect.arrayContaining(["reference.png", "painted.png", "painted.aipaint", "strokes.json", "metrics.json", "replay.html", "stages/outline.png", "stages/correction.png"]));
  expect(zipped["painted.aipaint"]).toEqual(new Uint8Array(Buffer.from(initial.project.split(",")[1], "base64")));
  expect(strFromU8(zipped["replay.html"])).toContain("再描画の実行記録");
  expect(strFromU8(zipped["strokes.json"])).not.toContain("data:image");
});

test("reference worker can be cancelled without mutating its input and restarted deterministically", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { createReferencePaintPlan } = await import("/src/core/referencePainting/client.ts");
    const image = new ImageData(48, 48); image.data.fill(255);
    for (let i = 0; i < image.data.length; i += 4) { image.data[i] = 50; image.data[i + 1] = 120; }
    const original = image.data.slice();
    const controller = new AbortController();
    let progressCalls = 0;
    let cancelled = false;
    try {
      await createReferencePaintPlan(image, { signal: controller.signal, onProgress: () => { progressCalls++; controller.abort(); } });
    } catch (error) { cancelled = error instanceof DOMException && error.name === "AbortError"; }
    const first = await createReferencePaintPlan(image);
    const second = await createReferencePaintPlan(image);
    return { cancelled, progressCalls, unchanged: original.every((value, i) => image.data[i] === value), deterministic: JSON.stringify(first) === JSON.stringify(second) };
  });
  expect(result).toEqual({ cancelled: true, progressCalls: 1, unchanged: true, deterministic: true });
});

test("adaptive local reference planning keeps a detailed original-size image within the stroke budget", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  // This route uses the local worker directly; it has no model/client API path.
  await page.goto("/");
  await expect(page.locator(".empty-canvas-title")).toBeVisible();
  const result = await page.evaluate(async () => {
    const width = 512; const height = 384;
    const makeDetailedReference = (w: number, h: number) => {
      const image = new ImageData(w, h);
      for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
        const i = (y * w + x) * 4;
        const broad = x < w / 3 ? [36, 166, 187] : x < w * 2 / 3 ? [244, 194, 77] : [47, 53, 72];
        // A deterministic one-pixel texture makes the fine and correction passes exceed 60k
        // strokes at this size, while retaining large color regions to check after replay.
        const noise = ((Math.imul(x + 17, 1103515245) ^ Math.imul(y + 31, 12345)) & 7) * 7;
        image.data[i] = broad[0] + noise; image.data[i + 1] = broad[1] - noise;
        image.data[i + 2] = broad[2] + (noise >> 1); image.data[i + 3] = 255;
      }
      return image;
    };
    const { beginStroke, continueStroke } = await import("/src/core/brushEngine.ts");
    type PaintStroke = { points: Parameters<typeof beginStroke>[1][]; settings: Parameters<typeof beginStroke>[2] };
    const paint = (ctx: CanvasRenderingContext2D, stroke: PaintStroke) => {
      // Use the same brush engine as the worker and public drawing API, rather than a mock surface.
      beginStroke(ctx, stroke.points[0], stroke.settings);
      for (let i = 1; i < stroke.points.length; i += 1) continueStroke(ctx, stroke.points[i - 1], stroke.points[i], stroke.settings);
    };
    const source = makeDetailedReference(width, height);
    const original = source.data.slice();
    const sourceCanvas = document.createElement("canvas"); sourceCanvas.width = width; sourceCanvas.height = height;
    sourceCanvas.getContext("2d")!.putImageData(source, 0, 0);
    const { buildReferencePaintPlan, meanAbsoluteError } = await import("/src/core/referencePainting/plan.ts");
    const rawCanvas = document.createElement("canvas"); rawCanvas.width = width; rawCanvas.height = height;
    const rawContext = rawCanvas.getContext("2d", { willReadFrequently: true })!;
    rawContext.fillStyle = "#fff"; rawContext.fillRect(0, 0, width, height);
    let rawError = "";
    try {
      buildReferencePaintPlan(width, height, source.data, {
        draw: stroke => paint(rawContext, stroke),
        read: () => rawContext.getImageData(0, 0, width, height).data,
      });
    } catch (error) { rawError = error instanceof Error ? `${error.name}: ${error.message}` : String(error); }

    const { createReferencePaintPlan } = await import("/src/core/referencePainting/client.ts");
    const progress: string[] = [];
    const plan = await createReferencePaintPlan(source, { onProgress: value => progress.push(value.label) });
    const replayCanvas = document.createElement("canvas"); replayCanvas.width = width; replayCanvas.height = height;
    const replayContext = replayCanvas.getContext("2d", { willReadFrequently: true })!;
    replayContext.fillStyle = plan.background; replayContext.fillRect(0, 0, width, height);
    for (const stage of plan.stages) for (const stroke of stage.strokes) paint(replayContext, stroke);
    const replay = replayContext.getImageData(0, 0, width, height).data;
    const actualError = meanAbsoluteError(source.data, replay);

    const abortController = new AbortController();
    let retrySeen = false; let aborted = false;
    try {
      await createReferencePaintPlan(source, {
        signal: abortController.signal,
        onProgress: value => {
          if (value.label.includes("細かさを自動調整")) { retrySeen = true; abortController.abort(); }
        },
      });
    } catch (error) { aborted = error instanceof DOMException && error.name === "AbortError"; }
    const smaller = makeDetailedReference(64, 48);
    const smallerOriginal = smaller.data.slice();
    const restartA = await createReferencePaintPlan(smaller);
    const restartB = await createReferencePaintPlan(smaller);
    return {
      rawError,
      progress,
      width: plan.width,
      height: plan.height,
      planningSize: plan.planningSize,
      stages: plan.stages.map(stage => ({ strokes: stage.strokes.length, error: stage.meanAbsoluteError })),
      strokes: plan.stages.reduce((total, stage) => total + stage.strokes.length, 0),
      actualError,
      workerError: plan.stages.at(-1)?.meanAbsoluteError,
      broadPixels: [[80, 192], [256, 192], [430, 192]].map(([x, y]) => Array.from(replay.slice((y * width + x) * 4, (y * width + x) * 4 + 3))),
      unchanged: original.every((value, i) => source.data[i] === value),
      retrySeen,
      aborted,
      smallerUnchanged: smallerOriginal.every((value, i) => smaller.data[i] === value),
      restartDeterministic: JSON.stringify(restartA) === JSON.stringify(restartB),
      sourcePng: sourceCanvas.toDataURL("image/png"),
      replayPng: replayCanvas.toDataURL("image/png"),
    };
  });
  for (const [name, dataUrl] of [["adaptive-reference-source.png", result.sourcePng], ["adaptive-reference-replay.png", result.replayPng]]) {
    const imagePath = testInfo.outputPath(name);
    await writeFile(imagePath, Buffer.from(dataUrl.split(",")[1], "base64"));
    await testInfo.attach(name, { path: imagePath, contentType: "image/png" });
  }
  await testInfo.attach("adaptive-reference-metrics.json", {
    body: Buffer.from(JSON.stringify({ ...result, sourcePng: undefined, replayPng: undefined }, null, 2)),
    contentType: "application/json",
  });
  expect(result.rawError).toMatch(/^ReferencePaintBudgetError:/);
  expect(result.progress.some(label => label.includes("細かさを自動調整"))).toBe(true);
  expect(result).toMatchObject({ width: 512, height: 384, retrySeen: true, aborted: true, unchanged: true, smallerUnchanged: true, restartDeterministic: true });
  expect(result.planningSize).toBeDefined();
  expect(result.planningSize).toMatchObject({ width: expect.any(Number), height: expect.any(Number) });
  expect(result.planningSize!.width).toBeLessThan(512);
  expect(result.planningSize!.height).toBeLessThan(384);
  expect(result.stages).toHaveLength(6);
  expect(result.strokes).toBeLessThanOrEqual(60_000);
  expect(Math.abs(result.actualError - result.workerError!)).toBeLessThan(1);
  expect(result.actualError).toBeLessThan(35);
  expect(result.broadPixels[0][2]).toBeGreaterThan(result.broadPixels[0][0]);
  expect(result.broadPixels[1][1]).toBeGreaterThan(result.broadPixels[1][2]);
  expect(result.broadPixels[2][2]).toBeGreaterThan(result.broadPixels[2][0]);
});

test("captures the optional local reference through the real canvas and export flow", async ({ page }) => {
  test.skip(process.env.AI_PAINT_REFERENCE_CAPTURE !== "1", "Requires the local, untracked reference screenshot described in docs/reference-paint-experiment.md");
  test.setTimeout(90_000);
  await page.goto("/experiments/reference-paint.html?sample=miku&auto=1");
  await expect(page.locator("#status")).toContainText("完了:", { timeout: 60_000 });
  const metrics = await page.evaluate(() => window.referencePaintExperiment!.evidence()!.metrics);
  expect(metrics.meanAbsoluteError).toBeLessThan(6);
  expect(Math.abs(metrics.meanAbsoluteError - metrics.workerError)).toBeLessThan(1);
  expect(metrics.batches).toBeLessThan(64);
  const directory = path.resolve("ui-snapshots/reference-paint/result");
  await mkdir(directory, { recursive: true });
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#bundle").click();
  const download = await downloadPromise;
  const archive = new Uint8Array(await readFile((await download.path())!));
  await writeFile(path.join(directory, "result.zip"), archive);
  const entries = unzipSync(archive);
  for (const name of ["reference.png", "painted.png", "painted.aipaint", "strokes.json", "metrics.json", "replay.html"]) {
    expect(entries[name]?.length).toBeGreaterThan(0);
    await writeFile(path.join(directory, name), entries[name]);
  }
  await mkdir(path.join(directory, "stages"), { recursive: true });
  for (const stage of ["outline", "large", "color", "detail", "fine", "correction"]) {
    await writeFile(path.join(directory, "stages", `${stage}.png`), entries[`stages/${stage}.png`]);
  }
});
