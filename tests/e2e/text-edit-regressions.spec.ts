import { expect, test } from "@playwright/test";
import { clickDocumentPoint, createCanvas, saveAipaintDownload } from "./canvas-helpers";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
});

test("text edits restore both editable content and pixels through undo, redo and save", async ({ page }, testInfo) => {
  await page.goto("/");
  await createCanvas(page, { width: 320, height: 160, dpi: 144 });
  await page.locator('button[title="テキスト"]').click();
  await clickDocumentPoint(page, { x: 20, y: 30 });
  const editor = page.locator('textarea[placeholder="文字を入力…"]');
  await editor.fill("Undo keeps this text");
  await page.locator('button[title="移動"]').click();
  const readPixels = () => page.locator("canvas.composite-canvas").evaluate((canvas) =>
    Array.from(canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data));
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const editedPixels = await readPixels();

  await page.keyboard.press("Control+z");
  await expect(page.locator(".layer-row")).toHaveCount(2);
  await expect(editor).toHaveValue("テキスト");
  await expect.poll(readPixels).not.toEqual(editedPixels);
  await page.keyboard.press("Control+y");
  await expect(editor).toHaveValue("Undo keeps this text");
  await expect.poll(readPixels).toEqual(editedPixels);

  const savedPath = await saveAipaintDownload(page, testInfo, "text-after-redo");
  await page.getByTestId("project-file-input").setInputFiles(savedPath);
  await expect(editor).toHaveValue("Undo keeps this text");
  await expect.poll(readPixels).toEqual(editedPixels);
});

test("text history stays bounded on a large canvas and restores old and new text bounds", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { PaintDocument } = await import("/src/core/PaintDocument.ts");
    const { History } = await import("/src/core/History.ts");
    const { useTextLayerActions } = await import("/src/hooks/useTextLayerActions.ts");
    const { TextPanelSection } = await import("/src/components/panels/TextPanelSection.tsx");
    const { createElement } = (await import("/node_modules/.vite/deps/react.js")).default;
    const { createRoot } = (await import("/node_modules/.vite/deps/react-dom_client.js")).default;
    const { flushSync } = (await import("/node_modules/.vite/deps/react-dom.js")).default;
    const doc = new PaintDocument(12000, 9000, 1);
    const history = new History();
    const layer = doc.addTextLayer({ text: "Before", fontFamily: "sans-serif", fontSize: 30,
      color: "#d04020", bold: false, italic: false, align: "left", x: 240, y: 20, lineHeight: 1.2 });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let actions: ReturnType<typeof useTextLayerActions>;
    let defaultStyleUpdates = 0;
    function Harness() {
      actions = useTextLayerActions({ doc, history, setDefaultTextStyle: () => { defaultStyleUpdates++; } });
      return createElement(TextPanelSection, { documentState: {
        doc, history, timelapse: null, editingTextLayer: actions.editingTextLayer,
        onTextChange: actions.handleTextChange, onTextDelete: actions.handleTextDelete,
      } });
    }
    flushSync(() => root.render(createElement(Harness)));
    const unsubscribe = doc.subscribe(() => root.render(createElement(Harness)));
    const snapshot = () => ({
      text: { ...doc.getLayer(layer.meta.id)!.meta.text },
      pixels: Array.from(doc.getLayer(layer.meta.id)!.store.getImageData(200, 0, 600, 160).data),
    });
    try {
      const before = snapshot();
      const pendingChange = actions.handleTextChange;
      flushSync(() => doc.updateLayerMeta(layer.meta.id, { locked: true }));
      const lockedEditorHidden = host.querySelector("textarea") === null;
      flushSync(() => pendingChange({ text: "Blocked", x: 600, color: "#000000" }));
      const locked = { snapshot: snapshot(), canUndo: history.canUndo(), defaultStyleUpdates };
      flushSync(() => doc.updateLayerMeta(layer.meta.id, { locked: false }));
      const unlockedEditorVisible = host.querySelector("textarea") !== null;
      flushSync(() => actions.handleTextChange({ text: "After, wider", x: 510, y: 75 }));
      const after = snapshot();
      const bytes = history.getMemoryUsedForBudget();
      flushSync(() => history.undo(doc));
      const undo = snapshot();
      flushSync(() => history.redo(doc));
      const redo = snapshot();
      flushSync(() => actions.handleTextChange({ text: "" }));
      const emptyAlpha = doc.getLayer(layer.meta.id)!.store.getAlphaBounds();
      flushSync(() => history.undo(doc));
      const undoEmpty = snapshot();
      return { before, after, undo, redo, undoEmpty, emptyAlpha, bytes, locked,
        lockedEditorHidden, unlockedEditorVisible };
    } finally {
      unsubscribe();
      flushSync(() => root.unmount());
      host.remove();
    }
  });
  expect(result.after).not.toEqual(result.before);
  expect(result.locked).toEqual({ snapshot: result.before, canUndo: false, defaultStyleUpdates: 0 });
  expect(result.lockedEditorHidden).toBe(true);
  expect(result.unlockedEditorVisible).toBe(true);
  expect(result.undo).toEqual(result.before);
  expect(result.redo).toEqual(result.after);
  expect(result.emptyAlpha).toBeNull();
  expect(result.undoEmpty).toEqual(result.after);
  expect(result.bytes).toBeGreaterThan(0);
  expect(result.bytes).toBeLessThan(1024 * 1024);
});

for (const mode of ["quick", "adjust", "selection", "cancel", "neutral", "neutral-reset"] as const) {
  test(`text color correction preserves pixels and editability on ${mode}`, async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (mode) => {
      const { PaintDocument } = await import("/src/core/PaintDocument.ts");
      const { History } = await import("/src/core/History.ts");
      const { useColorAdjustPreview } = await import("/src/components/colorAdjust/useColorAdjustPreview.ts");
      const { createElement } = (await import("/node_modules/.vite/deps/react.js")).default;
      const { createRoot } = (await import("/node_modules/.vite/deps/react-dom_client.js")).default;
      const { flushSync } = (await import("/node_modules/.vite/deps/react-dom.js")).default;
      const doc = new PaintDocument(200, 100, 1);
      const history = new History();
      const layer = doc.addTextLayer({ text: "TEST", fontFamily: "sans-serif", fontSize: 40,
        color: "#ff0000", bold: false, italic: false, align: "left", x: 10, y: 10, lineHeight: 1.2 });
      const snapshot = () => ({ kind: doc.getLayer(layer.meta.id)!.meta.kind,
        text: doc.getLayer(layer.meta.id)!.meta.text,
        pixels: Array.from(doc.getLayer(layer.meta.id)!.store.getImageData(0, 0, 200, 100).data) });
      const original = snapshot();
      const selection = mode === "selection"
        ? { kind: "rect" as const, x: 10, y: 10, w: 25, h: 60 }
        : { kind: "none" as const };
      let buildAdjustment = () => mode === "quick" || mode === "neutral" ? null : { kind: "invert" as const };
      const resetParams = () => {};
      let open = true;
      const onClose = () => { open = false; };
      const host = document.createElement("div");
      document.body.append(host);
      const root = createRoot(host);
      let session: ReturnType<typeof useColorAdjustPreview>;
      function Harness() {
        session = useColorAdjustPreview({ open, onClose, doc, history, selection, buildAdjustment, resetParams });
        return null;
      }
      flushSync(() => root.render(createElement(Harness)));
      try {
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        const previewKind = doc.getLayer(layer.meta.id)!.meta.kind;
        if (mode === "neutral-reset") {
          buildAdjustment = () => null;
          flushSync(() => root.render(createElement(Harness)));
        }
        flushSync(() => {
          if (mode === "quick") session.applyQuickFilter("invert", "階調反転");
          if (mode === "cancel") session.handleCancel();
          else session.handleApply();
        });
        flushSync(() => root.render(createElement(Harness)));
        const committed = snapshot();
        const canUndo = history.canUndo();
        if (canUndo) {
          history.undo(doc);
          const undone = snapshot();
          history.redo(doc);
          const redone = snapshot();
          doc.updateTextLayer(layer.meta.id, { x: 11 });
          return { original, previewKind, committed, canUndo, undone, redone, afterTextEdit: snapshot() };
        }
        return { original, previewKind, committed, canUndo };
      } finally {
        flushSync(() => root.unmount());
        host.remove();
      }
    }, mode);
    expect(result.previewKind).toBe("text");
    if (mode === "cancel" || mode === "neutral" || mode === "neutral-reset") {
      expect(result.committed).toEqual(result.original);
      expect(result.canUndo).toBe(false);
    } else {
      expect(result.committed.kind).toBe("raster");
      expect(result.committed.text).toBeUndefined();
      expect(result.committed.pixels).not.toEqual(result.original.pixels);
      expect(result.undone).toEqual(result.original);
      expect(result.redone).toEqual(result.committed);
      expect(result.afterTextEdit).toEqual(result.committed);
    }
  });
}
