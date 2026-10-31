import { expect, test } from "@playwright/test";
import { createCanvas, sampleCompositePixel } from "./canvas-helpers";

async function makeReference(page: Parameters<typeof createCanvas>[0], width = 48, height = 36) {
  return page.evaluate(({ width: referenceWidth, height: referenceHeight }) => {
    const canvas = document.createElement("canvas");
    canvas.width = referenceWidth;
    canvas.height = referenceHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#dceaf6";
    ctx.fillRect(0, 0, referenceWidth, referenceHeight);
    ctx.fillStyle = "#25aabc";
    ctx.fillRect(5, 4, Math.floor(referenceWidth / 3), referenceHeight - 8);
    ctx.fillStyle = "#242a37";
    ctx.beginPath();
    ctx.arc(Math.floor(referenceWidth * 0.73), Math.floor(referenceHeight / 2), Math.min(referenceWidth, referenceHeight) / 5, 0, Math.PI * 2);
    ctx.fill();
    const dataUrl = canvas.toDataURL("image/png");
    return { dataUrl, bytes: atob(dataUrl.split(",")[1]).length };
  }, { width, height });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
});

test("drawing agent repaints an uploaded reference locally, records it, and restores it from aipaint", async ({ page }) => {
  test.setTimeout(45_000);
  // デスクトップ版と同じ通信制限でも、見本のローカル解析・描画が動くこと。
  await page.route("**/", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), "content-security-policy": "connect-src ipc: http://ipc.localhost" } });
  });
  await page.goto("/");
  await createCanvas(page, { width: 128, height: 96, dpi: 96 });
  const original = await page.evaluate(async () => {
    const api = window.aiPaint!;
    const state = await api.execute("document.get_state");
    if (!state.ok) throw new Error(state.error.message);
    const layer = (state.value as { layers: { id: string }[] }).layers[0];
    const painted = await api.execute("drawing.path", {
      commands: [{ op: "move", x: 2, y: 2 }, { op: "line", x: 10, y: 2 }, { op: "line", x: 10, y: 10 }, { op: "line", x: 2, y: 10 }, { op: "close" }],
      fill: true, stroke: false, fillColor: "#121212", strokeColor: "#121212", strokeWidth: 1,
    });
    if (!painted.ok) throw new Error(painted.error.message);
    return layer.id;
  });
  const reference = await makeReference(page);
  const detailReference = await makeReference(page, 32, 24);

  // 画像本体と一致しない寸法を API から渡しても、作業を始めない。
  const invalid = await page.evaluate(async ({ dataUrl, bytes }) => window.aiPaint!.execute("agent.start_reference", {
    reference: { id: "invalid-reference", name: "invalid.png", dataUrl, width: 49, height: 36, byteLength: bytes },
  }), reference);
  expect(invalid.ok).toBe(false);

  const panel = page.getByRole("region", { name: "AIドロー（β版）", exact: true });
  await panel.getByLabel("描画方法").selectOption("reference");
  await panel.getByLabel("お手本画像").setInputFiles([
    { name: "reference.png", mimeType: "image/png", buffer: Buffer.from(reference.dataUrl.split(",")[1], "base64") },
    { name: "detail-reference.png", mimeType: "image/png", buffer: Buffer.from(detailReference.dataUrl.split(",")[1], "base64") },
  ]);
  await expect(panel.getByAltText("お手本: reference.png")).toBeVisible();
  await expect(panel.getByAltText("お手本: detail-reference.png")).toBeVisible();
  await panel.getByLabel("再描画するお手本").selectOption({ label: "detail-reference.png" });
  await expect(panel.getByRole("button", { name: "再描画を開始", exact: true })).toBeEnabled();
  await panel.getByRole("button", { name: "再描画を開始", exact: true }).click();

  await expect.poll(async () => {
    const result = await page.evaluate(() => window.aiPaint!.execute("agent.get_state"));
    if (!result.ok) throw new Error(result.error.message);
    const state = result.value as { mode?: string; referenceProgress?: { phase: string; completedStrokes: number; totalStrokes: number }; status: string };
    return state.mode === "reference" && state.referenceProgress && state.referenceProgress.totalStrokes > 0
      ? { phase: state.referenceProgress.phase, completed: state.referenceProgress.completedStrokes, total: state.referenceProgress.totalStrokes, status: state.status }
      : null;
  }).not.toBeNull();
  await expect(panel.getByText(/\d+\s*\/\s*\d+\s*筆/)).toBeVisible();
  await expect.poll(async () => {
    const result = await page.evaluate(() => window.aiPaint!.execute("agent.get_state"));
    if (!result.ok) throw new Error(result.error.message);
    const state = result.value as { mode?: string; referenceProgress?: { completedStrokes: number; totalStrokes: number }; status: string };
    return state.mode === "reference" && state.status === "completed" && state.referenceProgress?.completedStrokes === state.referenceProgress?.totalStrokes;
  }, { timeout: 30_000 }).toBe(true);
  await expect(panel.getByLabel("制作状況")).toContainText("完成");

  const finished = await page.evaluate(async originalLayerId => {
    const api = window.aiPaint!;
    const [documentState, recording] = await Promise.all([api.execute("document.get_state"), api.execute("agent.get_recording")]);
    if (!documentState.ok || !recording.ok) throw new Error(!documentState.ok ? documentState.error.message : recording.error.message);
    const state = documentState.value as { width: number; height: number; layers: { id: string; name: string }[] };
    const saved = recording.value as { frames: unknown[]; operations: unknown[] };
    const exported = await api.execute("file.export", { format: "aipaint" });
    if (!exported.ok) throw new Error(exported.error.message);
    return {
      layers: state.layers,
      originalLayerId,
      frames: saved.frames.length,
      operations: saved.operations.length,
      exported: (exported.value as { dataUrl: string }).dataUrl,
    };
  }, original);
  expect(finished.layers[0].id).toBe(finished.originalLayerId);
  expect(finished.layers.length).toBeGreaterThan(1);
  expect(finished.layers.some(layer => layer.name === "見本再描画: detail-reference.png")).toBe(true);
  expect(finished.frames).toBeGreaterThanOrEqual(2);
  expect(finished.operations).toBeGreaterThan(0);
  await expect(panel.getByAltText("お手本: reference.png")).toBeVisible();
  await expect(panel.getByAltText("お手本: detail-reference.png")).toBeVisible();
  // 既存の絵は、新規に積まれた白地・工程レイヤーの下で保持される。
  expect(await sampleCompositePixel(page, { x: 4, y: 4 })).toEqual([18, 18, 18, 255]);

  await expect(panel.getByRole("button", { name: "再生", exact: true })).toBeEnabled();
  await expect(panel.getByRole("button", { name: "絵と制作過程を保存", exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "再生", exact: true }).click();
  await expect(page.locator(".canvas-stage .agent-canvas-replay")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "AIドロー（β版）" })).toHaveCount(0);
  await expect(panel.locator("canvas")).toHaveCount(0);
  await panel.getByRole("button", { name: "現在の絵に戻る", exact: true }).click();

  const restored = await page.evaluate(async dataUrl => {
    const api = window.aiPaint!;
    const opened = await api.execute("file.open", { dataUrl, name: "reference-roundtrip.aipaint" });
    if (!opened.ok) throw new Error(opened.error.message);
    const [state, recording] = await Promise.all([api.execute("agent.get_state"), api.execute("agent.get_recording")]);
    if (!state.ok || !recording.ok) throw new Error(!state.ok ? state.error.message : recording.error.message);
    return { state: state.value, recording: recording.value };
  }, finished.exported);
  expect(restored.state).toMatchObject({ mode: "reference", status: "completed" });
  expect((restored.recording as { frames: unknown[] }).frames).toHaveLength(finished.frames);
  await expect(panel.getByAltText("お手本: reference.png")).toBeVisible();
  await expect(panel.getByAltText("お手本: detail-reference.png")).toBeVisible();
  await expect(panel.getByLabel("再描画するお手本").locator("option").first()).toHaveText("detail-reference.png");
});

test("reference reconstruction can be stopped through the API without changing the existing layer", async ({ page }) => {
  await page.goto("/");
  await createCanvas(page, { width: 128, height: 96, dpi: 96 });
  const originalLayerId = await page.evaluate(async () => {
    const api = window.aiPaint!;
    const state = await api.execute("document.get_state");
    if (!state.ok) throw new Error(state.error.message);
    const original = (state.value as { layers: { id: string }[] }).layers[0].id;
    const result = await api.execute("drawing.path", {
      commands: [{ op: "move", x: 2, y: 2 }, { op: "line", x: 10, y: 2 }, { op: "line", x: 10, y: 10 }, { op: "line", x: 2, y: 10 }, { op: "close" }],
      fill: true, stroke: false, fillColor: "#121212", strokeColor: "#121212", strokeWidth: 1,
    });
    if (!result.ok) throw new Error(result.error.message);
    return original;
  });
  const reference = await makeReference(page, 256, 192);
  const started = await page.evaluate(async ({ dataUrl, bytes }) => {
    const api = window.aiPaint!;
    return api.execute("agent.start_reference", {
      reference: { id: "cancel-reference", name: "cancel.png", dataUrl, width: 256, height: 192, byteLength: bytes },
    });
  }, reference);
  expect(started.ok).toBe(true);
  await expect.poll(async () => {
    const result = await page.evaluate(() => window.aiPaint!.execute("agent.get_state"));
    if (!result.ok) throw new Error(result.error.message);
    const state = result.value as { referenceProgress?: { phase: string; completedStrokes: number } };
    return state.referenceProgress?.phase === "drawing" && state.referenceProgress.completedStrokes > 0;
  }).toBe(true);
  const stopped = await page.evaluate(async () => {
    const api = window.aiPaint!;
    const stop = await api.execute("agent.stop");
    const [state, documentState] = await Promise.all([api.execute("agent.get_state"), api.execute("document.get_state")]);
    return { stop, state, documentState };
  });
  expect(stopped.stop.ok).toBe(true);
  expect(stopped.state).toMatchObject({ ok: true, value: { mode: "reference", status: "stopped" } });
  expect(stopped.documentState).toMatchObject({ ok: true, value: { selection: { kind: "none" } } });
  const hidden = await page.evaluate(async id => {
    const api = window.aiPaint!;
    const state = await api.execute("document.get_state");
    if (!state.ok) throw new Error(state.error.message);
    const group = (state.value as { layers: { id: string; kind: string }[] }).layers.find(layer => layer.kind === "group" && layer.id !== id);
    if (!group) throw new Error("再描画の工程フォルダがありません");
    return api.execute("layer.update_meta", { layerId: group.id, visible: false });
  }, originalLayerId);
  expect(hidden.ok).toBe(true);
  expect(await sampleCompositePixel(page, { x: 4, y: 4 })).toEqual([18, 18, 18, 255]);
});
