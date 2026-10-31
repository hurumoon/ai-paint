import { expect, test } from "@playwright/test";
import { createCanvas } from "./canvas-helpers";

test("API changes real pixels and AI Draw is a normal right-panel section without a duplicate canvas or idle lock", async ({ page }) => {
  await page.goto("/");
  await createCanvas(page, { width: 128, height: 96, dpi: 144 });
  const result = await page.evaluate(async () => {
    const api = window.aiPaint!;
    const sample = async () => {
      const response = await api.execute("document.get_image", {});
      if (!response.ok) throw new Error(response.error.message);
      const image = new Image(); image.src = (response.value as { dataUrl: string }).dataUrl; await image.decode();
      const c = document.createElement("canvas"); c.width = 128; c.height = 96;
      const ctx = c.getContext("2d")!; ctx.drawImage(image, 0, 0);
      return Array.from(ctx.getImageData(35, 35, 1, 1).data);
    };
    const before = await sample();
    const draw = await api.execute("drawing.path", { commands: [{ op: "move", x: 20, y: 20 }, { op: "line", x: 70, y: 20 }, { op: "line", x: 70, y: 70 }, { op: "line", x: 20, y: 70 }, { op: "close" }], fill: true, stroke: false, fillColor: "#ef3344", strokeColor: "#000000", strokeWidth: 1 });
    const after = await sample();
    await api.execute("history.undo", {}); const undone = await sample();
    await api.execute("history.redo", {}); const redone = await sample();
    const invalid = await api.execute("tool.update", { color: "invalid", brushSize: -5 });
    const updated = await api.execute("tool.update", { color: "#11aabb", brushSize: 14 });
    const crop = await api.execute("document.get_image", { x: 10, y: 10, width: 40, height: 20, maxEdge: 20 });
    return { before, after, undone, redone, draw, invalid, updated, crop: crop.ok ? { width: (crop.value as {width: number}).width, height: (crop.value as {height: number}).height } : crop, count: api.list().length };
  });
  expect(result.draw.ok).toBe(true);
  expect(result.after).toEqual([239, 51, 68, 255]);
  expect(result.undone).toEqual(result.before);
  expect(result.redone).toEqual(result.after);
  expect(result.invalid.ok).toBe(false);
  expect(result.updated).toMatchObject({ ok: true, value: { color: "#11aabb", brushSize: 14 } });
  expect(result.crop).toEqual({ width: 20, height: 10 });
  expect(result.count).toBeGreaterThan(60);
  const panel = page.getByRole("region", { name: "AIドロー（β版）", exact: true });
  await expect(panel).toBeVisible();
  await expect(page.locator(".statusbar").getByRole("button", { name: /作業 Agent|AIドロー/ })).toHaveCount(0);
  await expect(page.locator(".right-panel [role=tablist]")).toHaveCount(0);
  await expect(page.locator(".app.shows-agent")).toHaveCount(0);
  await expect(panel.locator("canvas")).toHaveCount(0);
  await panel.locator("summary").filter({ hasText: "上限設定" }).click();
  await expect(panel.getByLabel("反復回数上限")).toHaveValue("120");
  await expect(panel.getByLabel("入力トークン上限")).toBeVisible();
  await expect(panel.getByRole("button", { name: "描画を開始" })).toBeDisabled();
  await expect(page.locator(".app")).not.toHaveAttribute("inert");
  await expect(page.locator(".toolbar")).not.toHaveAttribute("inert");
  for (const width of [1280, 1024]) {
    await page.setViewportSize({ width, height: 768 });
    const bounds = await page.locator(".right-panel").boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect(bounds!.x).toBeGreaterThan(width / 2);
    const canvasArea = await page.locator(".canvas-area").boundingBox();
    expect(canvasArea!.x + canvasArea!.width).toBeLessThanOrEqual(bounds!.x + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `test-results/drawing-agent-panel-${width}.png` });
  }
  const layout = await page.evaluate(() => window.aiPaint!.execute("settings.update", { layout: { flipped: true, leftSections: ["grid"], rightSections: ["layers"] } }));
  expect(layout.ok).toBe(true);
  const flippedBounds = await page.locator(".right-panel").boundingBox();
  expect(flippedBounds!.x).toBeLessThan(512);
});

test("AI Draw follows normal layout placement and keeps its hidden state after reload", async ({ page }) => {
  await page.goto("/");
  const moved = await page.evaluate(() => window.aiPaint!.execute("settings.update", {
    layout: {
      flipped: false,
      leftSections: ["aiDraw"],
      rightSections: ["text", "view", "grid", "layers", "chat"],
      hidden: ["activity", "timelapse", "ai"],
    },
  }));
  expect(moved.ok).toBe(true);
  const panel = page.getByRole("region", { name: "AIドロー（β版）", exact: true });
  await expect(page.locator(".left-panel").getByRole("region", { name: "AIドロー（β版）", exact: true })).toBeVisible();
  await expect(page.locator(".right-panel").getByText("グリッド", { exact: true })).toBeVisible();
  await panel.getByLabel("描きたい絵").fill("配置しても残る下書き");

  const hidden = await page.evaluate(() => window.aiPaint!.execute("settings.update", {
    layout: {
      flipped: false,
      leftSections: [],
      rightSections: ["text", "view", "grid", "layers", "chat"],
      hidden: ["activity", "timelapse", "ai", "aiDraw"],
    },
  }));
  expect(hidden.ok).toBe(true);
  await expect(panel).toHaveCount(0);
  const restored = await page.evaluate(() => window.aiPaint!.execute("settings.update", {
    layout: {
      flipped: false,
      leftSections: ["aiDraw"],
      rightSections: ["text", "view", "grid", "layers", "chat"],
      hidden: ["activity", "timelapse", "ai"],
    },
  }));
  expect(restored.ok).toBe(true);
  await expect(page.getByRole("region", { name: "AIドロー（β版）", exact: true }).getByLabel("描きたい絵")).toHaveValue("配置しても残る下書き");
  await page.evaluate(() => window.aiPaint!.execute("settings.update", {
    layout: {
      flipped: false,
      leftSections: [],
      rightSections: ["text", "view", "grid", "layers", "chat"],
      hidden: ["activity", "timelapse", "ai", "aiDraw"],
    },
  }));
  await page.reload();
  await expect(page.getByRole("region", { name: "AIドロー（β版）", exact: true })).toHaveCount(0);
  await expect(page.locator(".right-panel").getByText("グリッド", { exact: true })).toBeVisible();
});

test("reference APIs share visible images with the app and supply model reference images", async ({ page }) => {
  await page.goto("/");
  await createCanvas(page, { width: 128, height: 96, dpi: 144 });
  const result = await page.evaluate(async () => {
    const api = window.aiPaint!;
    const image = await api.execute("document.get_image");
    if (!image.ok) throw new Error(image.error.message);
    const dataUrl = (image.value as { dataUrl: string }).dataUrl;
    const reference = await api.execute("reference.update", { dataUrl, zoom: 1.5, offset: { x: 3, y: 4 } });
    await api.execute("view.update", { showReference: true });
    const read = await api.execute("reference.get");
    const add = await api.execute("ai.add_reference", { dataUrl, name: "目標.png" });
    if (!add.ok) throw new Error(add.error.message);
    const modelImage = await api.execute("ai.get_reference", { id: (add.value as { id: string }).id });
    return { reference, read, modelImage };
  });
  expect(result.reference.ok).toBe(true);
  expect(result.read).toMatchObject({ ok: true, value: { zoom: 1.5, offset: { x: 3, y: 4 }, dataUrl: expect.stringMatching(/^data:image\/png;base64,/) } });
  expect(result.modelImage).toMatchObject({ ok: true, value: { name: "目標.png", dataUrl: expect.stringMatching(/^data:image\/png;base64,/) } });
  await expect(page.locator(".reference-view img")).toBeVisible();
  await expect(page.locator(".reference-view img")).toHaveCSS("transform", "matrix(1.5, 0, 0, 1.5, 3, 4)");
  await page.evaluate(async () => { await window.aiPaint!.execute("reference.update", { dataUrl: null }); });
  await expect(page.locator(".reference-view img")).toHaveCount(0);
});

test("real drawing loop round-trips native file, resumes the stage, and preserves preview pixels", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { PaintDocument } = await import("/src/core/PaintDocument.ts");
    const { History } = await import("/src/core/History.ts");
    const { Timelapse } = await import("/src/core/Timelapse.ts");
    const { createPaintApi } = await import("/src/core/paintApi/index.ts");
    const { DrawingAgent } = await import("/src/core/agent/runner.ts");
    const { setDrawingAgentSession, getDrawingAgentSession } = await import("/src/core/agent/session.ts");
    const { saveAiPaint, loadAiPaint } = await import("/src/core/nativeFormat.ts");
    const doc = new PaintDocument(96, 96, 1);
    const history = new History(); const timelapse = new Timelapse();
    const api = createPaintApi({ getDocument: () => doc, getHistory: () => history, getTimelapse: () => timelapse, getSelection: () => ({ kind: "none" }), setSelection: () => undefined });
    let calls = 0;
    const requests: { hasImage: boolean; results: number }[] = [];
    const agent = new DrawingAgent({ paintApi: api, bindingId: "original", onSessionChange: session => setDrawingAgentSession(doc, session), requestModel: async request => {
      requests.push({ hasImage: !!request.imageDataUrl, results: request.toolResults?.length ?? 0 });
      calls++;
      if (calls === 1) return { text: "輪郭を描画", inputTokens: 20, outputTokens: 10, continuation: "test-response", calls: [{ id: "draw", name: "app_call_tool", arguments: { name: "drawing.stroke", arguments: { points: [{ x: 20, y: 40, pressure: 1 }, { x: 70, y: 40, pressure: 1 }], settings: { kind: "round", size: 12, opacity: 1, color: "#25aabc" } } } }] };
      agent.pause();
      return { text: "停止した応答", calls: [], inputTokens: 0, outputTokens: 0 };
    } });
    await agent.start({ prompt: "青い線を描く", provider: "openai", model: "fixture", stages: [{ id: "line", title: "線画", goal: "青い線", completionCriteria: ["青い線がある"] }] });
    const saved = await saveAiPaint(doc);
    const restored = new PaintDocument(1, 1, 1); await loadAiPaint(saved, restored);
    const session = getDrawingAgentSession(restored)!;
    const restoredHistory = new History(); const restoredTime = new Timelapse();
    const restoredApi = createPaintApi({ getDocument: () => restored, getHistory: () => restoredHistory, getTimelapse: () => restoredTime, getSelection: () => ({ kind: "none" }), setSelection: () => undefined });
    const resumeAgent = new DrawingAgent({ paintApi: restoredApi, bindingId: "restored-tab", session: { ...session, bindingId: "restored-tab" }, onSessionChange: s => setDrawingAgentSession(restored, s), requestModel: async () => ({ text: "線を確認", inputTokens: 20, outputTokens: 10, continuation: "test-resume", calls: [{ id: "finish", name: "agent_complete_stage", arguments: { summary: "青い線を確認", criteriaEvidence: ["青い線が中央にある"] } }] }) });
    await resumeAgent.resume();
    const secondFile = await saveAiPaint(restored); const finalDoc = new PaintDocument(1, 1, 1); await loadAiPaint(secondFile, finalDoc);
    const finalSession = getDrawingAgentSession(finalDoc)!;
    finalDoc.materializeAllLayers();
    const pixel = Array.from(finalDoc.getActiveLayer()!.store.getImageData(45, 40, 1, 1).data);
    return { requests, status: session.status, finalStatus: finalSession.status, pixel, frames: finalSession.recording.frames.map(f => ({ reasons: f.reasons, dataUrl: f.dataUrl })), operations: finalSession.recording.operations.map(o => o.toolName), binding: finalSession.bindingId };
  });
  expect(result.requests.length).toBe(2);
  expect(result.requests.every(r => r.hasImage)).toBe(true);
  expect(result.requests[1].results).toBe(1);
  expect(result.status).toBe("paused");
  expect(result.finalStatus).toBe("completed");
  expect(result.binding).toBe("restored-tab");
  [37, 170, 188, 255].forEach((channel, index) => expect(Math.abs(result.pixel[index] - channel)).toBeLessThanOrEqual(1));
  expect(result.operations).toContain("drawing.stroke");
  expect(result.frames.some(f => f.reasons.includes("initial"))).toBe(true);
  expect(result.frames.some(f => f.reasons.includes("final"))).toBe(true);
  expect(new Set(result.frames.map(f => f.dataUrl)).size).toBeGreaterThan(1);
});

test("panel sends references, replays on the main canvas, and reloads recording and references", async ({ page }) => {
  await page.goto("/");
  await createCanvas(page, { width: 160, height: 120, dpi: 96 });
  // モデル接続だけを置き換え、実際のUI・API・描画・保存処理を通す。
  await page.evaluate(() => {
    let callCount = 0;
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {
      invoke: async (command: string, args: { request?: { referenceImages?: unknown[]; reasoningEffort?: string } }) => {
        if (command === "has_gpt_api_key") return true;
        if (command === "native_take_startup_open_files") return [];
        if (command !== "request_model") return null;
        callCount++;
        Reflect.set(window, "agentRequestSummary", { referenceCount: args.request?.referenceImages?.length ?? 0, effort: args.request?.reasoningEffort, ...Reflect.get(window, "agentRequestSummary") });
        await new Promise(resolve => setTimeout(resolve, 60));
        const y = 15 + Math.floor((callCount - 1) / 2) * 14;
        return { text: callCount % 2 ? "線を描きます" : "現在の工程の結果を確認しました", inputTokens: 10, outputTokens: 10, continuation: `fixture-${callCount}`, calls: callCount % 2
          ? [{ id: `stroke-${callCount}`, name: "app_call_tool", arguments: { name: "drawing.stroke", arguments: { points: [{ x: 30, y, pressure: 1 }, { x: 130, y, pressure: 1 }], settings: { kind: "round", size: 10, opacity: 1, color: "#25aabc" } } } }]
          : [{ id: `complete-${callCount}`, name: "agent_complete_stage", arguments: { summary: "画像で確認", criteriaEvidence: ["形が中央にある", "線が意図どおり表示されている"] } }] };
      },
    } });
  });
  const dialog = page.getByRole("region", { name: "AIドロー（β版）", exact: true });
  await dialog.getByLabel("描画方法").selectOption("reference");
  await dialog.getByLabel("描画方法").selectOption("model");
  const referenceBase64 = await page.evaluate(() => {
    const c = document.createElement("canvas"); c.width = 32; c.height = 24;
    const ctx = c.getContext("2d")!; ctx.fillStyle = "#25aabc"; ctx.fillRect(0, 0, 32, 24);
    return c.toDataURL("image/png").split(",")[1];
  });
  await dialog.getByLabel("お手本画像").setInputFiles({ name: "goal.png", mimeType: "image/png", buffer: Buffer.from(referenceBase64, "base64") });
  await expect(dialog.getByAltText("お手本: goal.png")).toBeVisible();
  await dialog.getByLabel("描きたい絵").fill("中央に青緑の横線を描く");
  await expect(dialog.getByRole("button", { name: "描画を開始" })).toBeEnabled();
  await dialog.getByRole("button", { name: "描画を開始" }).click();
  await expect(dialog.getByLabel("制作状況")).toContainText("完成");
  expect(await page.evaluate(() => Reflect.get(window, "agentRequestSummary"))).toEqual({ referenceCount: 1, effort: "high" });
  const imageBefore = await page.evaluate(() => window.aiPaint!.execute("document.get_image"));
  await expect(dialog.getByRole("button", { name: "再生", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "再生", exact: true }).click();
  await expect(page.locator(".canvas-stage .agent-canvas-replay")).toBeVisible();
  await expect(page.locator(".toolbar")).toHaveAttribute("inert", "");
  expect(await page.evaluate(() => window.aiPaint!.execute("document.get_image"))).toEqual(imageBefore);
  await dialog.getByRole("button", { name: "現在の絵に戻る" }).click();
  await expect(page.locator(".agent-canvas-replay")).toHaveCount(0);
  await expect(page.locator(".toolbar")).not.toHaveAttribute("inert");
  await expect(page.locator(".tab-bar")).not.toHaveAttribute("inert");
  await expect(dialog.getByRole("button", { name: "再生", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "再生", exact: true }).click();
  await dialog.getByRole("button", { name: "現在の絵に戻る" }).click();
  const exported = await page.evaluate(async () => {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    const result = await window.aiPaint!.execute("file.export", { format: "aipaint" });
    if (!result.ok) throw new Error(result.error.message);
    return (result.value as {dataUrl: string}).dataUrl;
  });
  const loaded = await page.evaluate(dataUrl => window.aiPaint!.execute("file.open", { dataUrl, name: "agent-roundtrip.aipaint" }), exported);
  expect(loaded.ok).toBe(true);
  await expect(page.locator("canvas.input-canvas")).toHaveAttribute("width", "160");
  await expect(dialog.getByLabel("制作状況")).toContainText("完成");
  await expect(dialog.getByLabel("描きたい絵")).toHaveValue("中央に青緑の横線を描く");
  await expect(dialog.getByRole("button", { name: "再生", exact: true })).toBeEnabled();
  await expect(dialog.getByAltText("お手本: goal.png")).toBeVisible();
  await dialog.locator(".agent-panel-body").evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: "test-results/drawing-agent-restored.png" });
});

test("waiting shows elapsed time, can pause, and reports the exact limit with an editable resume budget", async ({ page }) => {
  await page.goto("/");
  await createCanvas(page, { width: 160, height: 120, dpi: 96 });
  await page.evaluate(() => window.aiPaint!.execute("selection.set", { kind: "rect", x: 10, y: 10, width: 60, height: 60 }));
  await page.evaluate(() => {
    let calls = 0;
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {
      invoke: async (command: string) => {
        if (command === "has_gpt_api_key") return true;
        if (command === "native_take_startup_open_files") return [];
        if (command !== "request_model") return null;
        calls++;
        if (calls === 1) await new Promise<void>(resolve => Reflect.set(window, "releaseAgentModel", resolve));
        return { text: "モデルから応答", inputTokens: 10, outputTokens: 10, continuation: `wait-${calls}`, calls: [] };
      },
    } });
  });
  const panel = page.getByRole("region", { name: "AIドロー（β版）", exact: true });
  await panel.getByLabel("描画方法").selectOption("reference");
  await panel.getByLabel("描画方法").selectOption("model");
  await panel.getByLabel("描きたい絵").fill("青い線を描く");
  await panel.locator("summary").filter({ hasText: "上限設定" }).click();
  await panel.getByLabel("入力トークン上限").fill("5");
  await panel.getByRole("button", { name: "描画を開始" }).click();
  await expect(panel.getByLabel("制作状況")).toContainText("モデルの応答待ち");
  await expect(panel.locator(".agent-clock")).toContainText(/0:0[1-9]/);
  await expect(page.locator(".toolbar")).toHaveAttribute("inert", "");
  await expect(page.locator(".tab-bar")).toHaveAttribute("inert", "");
  await expect(panel).not.toHaveAttribute("inert");
  await expect(page.getByRole("button", { name: "解除", exact: true })).toBeDisabled();
  await expect(page.locator(".app")).not.toHaveAttribute("inert");
  const initialTransform = await page.locator(".canvas-stage").getAttribute("style");
  await page.locator(".canvas-area").hover();
  await page.mouse.wheel(0, -100);
  await expect(page.locator(".canvas-stage")).not.toHaveAttribute("style", initialTransform!);
  await page.screenshot({ path: "test-results/drawing-agent-waiting.png" });
  await panel.getByRole("button", { name: "一時停止", exact: true }).click();
  await expect(panel.getByLabel("制作状況")).toContainText("一時停止");
  await expect(page.locator(".toolbar")).not.toHaveAttribute("inert");
  await expect(page.locator(".tab-bar")).not.toHaveAttribute("inert");
  await expect(page.getByRole("button", { name: "解除", exact: true })).toBeEnabled();
  await page.evaluate(() => Reflect.get(window, "releaseAgentModel")());
  await expect(panel.getByRole("button", { name: "続きから再開" })).toBeEnabled();
  await panel.getByRole("button", { name: "続きから再開" }).click();
  await expect(panel.getByLabel("制作状況")).toContainText("上限に達して停止");
  await expect(panel.getByRole("status")).toContainText("入力トークン");
  await panel.getByLabel("入力トークン上限").fill("100");
  await panel.getByLabel("反復回数上限").fill("3");
  await panel.getByRole("button", { name: "続きから再開" }).click();
  await expect(panel.getByRole("status")).toContainText("反復回数");
  await expect(panel.getByLabel("入力トークン上限")).toHaveValue("100");
  await expect(page.locator(".toolbar")).not.toHaveAttribute("inert");
});

test("public Agent API updates panel references and prompt without losing them on UI resume", async ({ page }) => {
  await page.goto("/");
  await createCanvas(page, { width: 160, height: 120, dpi: 96 });
  const reference = await page.evaluate(() => {
    const c = document.createElement("canvas"); c.width = 16; c.height = 16;
    const ctx = c.getContext("2d")!; ctx.fillStyle = "#123456"; ctx.fillRect(0, 0, 16, 16);
    const dataUrl = c.toDataURL("image/png");
    Reflect.set(window, "agentKeyAvailable", true);
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {
      invoke: async (command: string, args: { request?: unknown }) => {
        if (command === "has_gpt_api_key") return Reflect.get(window, "agentKeyAvailable");
        if (command === "native_take_startup_open_files") return [];
        if (command !== "request_model") return null;
        Reflect.set(window, "latestAgentRequest", args.request);
        return new Promise(() => {});
      },
    } });
    return { id: "api-reference", name: "APIのお手本.png", dataUrl, width: 16, height: 16, byteLength: atob(dataUrl.split(",")[1]).length };
  });
  const panel = page.getByRole("region", { name: "AIドロー（β版）", exact: true });
  await panel.getByLabel("描画方法").selectOption("reference");
  await panel.getByLabel("描画方法").selectOption("model");
  const started = await page.evaluate(reference => window.aiPaint!.execute("agent.start", {
    provider: "openai", model: "gpt-6-astra", prompt: "APIから指定した制作指示", references: [reference],
  }), reference);
  expect(started.ok).toBe(true);
  await expect(panel.getByAltText("お手本: APIのお手本.png")).toBeVisible();
  await expect(panel.getByLabel("描きたい絵")).toHaveValue("APIから指定した制作指示");
  await page.evaluate(() => window.aiPaint!.execute("agent.pause"));
  await expect(panel.getByRole("button", { name: "続きから再開" })).toBeEnabled();
  const resumed = await page.evaluate(reference => window.aiPaint!.execute("agent.resume", { references: [{ ...reference, id: "new-reference", name: "更新したお手本.png" }] }), reference);
  expect(resumed.ok).toBe(true);
  await expect(panel.getByAltText("お手本: 更新したお手本.png")).toBeVisible();
  await expect(panel.getByAltText("お手本: APIのお手本.png")).toHaveCount(0);
  await page.evaluate(() => window.aiPaint!.execute("agent.pause"));
  await panel.getByRole("button", { name: "続きから再開" }).click();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "latestAgentRequest")?.referenceImages?.[0]?.name)).toBe("更新したお手本.png");
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "latestAgentRequest")?.instructions)).toContain("APIから指定した制作指示");
  await page.evaluate(() => window.aiPaint!.execute("agent.pause"));
  await expect(page.locator(".tab-bar")).not.toHaveAttribute("inert");
  await page.evaluate(() => Reflect.set(window, "agentKeyAvailable", false));
  const hidden = await page.evaluate(() => window.aiPaint!.execute("settings.update", {
    layout: {
      flipped: false,
      leftSections: [],
      rightSections: ["text", "view", "grid", "layers", "chat"],
      hidden: ["activity", "timelapse", "ai", "aiDraw"],
    },
  }));
  expect(hidden.ok).toBe(true);
  await expect(panel).toHaveCount(0);
  const shown = await page.evaluate(() => window.aiPaint!.execute("settings.update", {
    layout: {
      flipped: false,
      leftSections: [],
      rightSections: ["text", "view", "grid", "layers", "chat", "aiDraw"],
      hidden: ["activity", "timelapse", "ai"],
    },
  }));
  expect(shown.ok).toBe(true);
  await expect(panel.getByRole("button", { name: "続きから再開" })).toBeDisabled();
});
