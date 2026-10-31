import { expect, test } from "@playwright/test";
import { createCanvas } from "./canvas-helpers";

declare global {
  interface Window {
    __resolvePendingChat__?: () => void;
    __resolvePendingAnalysis__?: () => void;
  }
}

test("allows opening B while A sends chat, then blocks every destructive action from B", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("ai-paint-layout", JSON.stringify({
      flipped: false,
      leftSections: [],
      rightSections: ["text", "view", "grid", "layers", "chat", "ai", "aiDraw"],
      hidden: ["activity", "timelapse"],
      topBarLeftItems: ["about", "canvasSettings", "canvasExtend", "newCanvas", "openImage", "openDirectImage", "undo", "redo"],
      topBarRightItems: ["rotateCounterClockwise", "rotateClockwise", "horizontalFlip", "subview", "drawingGuide", "colorAdjust", "layoutSettings", "save", "export", "backup", "theme"],
      topBarHiddenItems: ["reference", "shortcutSettings"],
    }));
    Object.assign(window, {
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => undefined },
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
        transformCallback: () => 1,
        unregisterCallback: () => undefined,
        invoke: async (command: string) => {
          if (command === "has_claude_api_key") return true;
          if (command === "chat_with_claude") {
            return new Promise((resolve) => {
              window.__resolvePendingChat__ = () => resolve({
                text: JSON.stringify({ advice: "Aへの返信", guides: [], palette: [] }),
              });
            });
          }
          return null;
        },
      },
    });
  });
  await page.goto("/");
  await createCanvas(page, { width: 80, height: 60, dpi: 144 });

  const chat = page.locator(".chat-panel");
  await chat.locator("textarea").fill("Aから質問");
  await chat.getByRole("button", { name: "送信", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Boolean(window.__resolvePendingChat__))).toBe(true);

  await expect(page.getByRole("button", { name: "AI に見てもらう" })).toBeDisabled();

  await page.getByTestId("topbar-newCanvas").click();
  await expect(page.getByTestId("new-canvas-dialog")).toBeHidden();
  await expect(page.locator(".toast", { hasText: "チャット送信完了までお待ちください" })).toBeVisible();

  // The chat request already holds the mocked Tauri invoke promise. Switch the
  // unrelated save path to its browser fallback so this regression can reuse
  // the resulting .aipaint file as B without a native save-dialog mock.
  await page.evaluate(() => { delete (window as Record<string, unknown>).__TAURI_INTERNALS__; });
  const [saved] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTitle("保存 (Ctrl+S)").click(),
  ]);
  const savedPath = testInfo.outputPath("chat-pending.aipaint");
  await saved.saveAs(savedPath);
  await page.getByTestId("project-file-input").setInputFiles(savedPath);
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(page.getByRole("tab").last()).toHaveAttribute("aria-selected", "true");

  await page.getByTestId("topbar-newCanvas").click();
  await expect(page.getByTestId("new-canvas-dialog")).toBeHidden();

  await expect(page.getByRole("tab").last().getByTitle("タブを閉じる")).toBeDisabled();
  await expect(page.getByRole("tab")).toHaveCount(2);

  await page.getByTestId("topbar-backup").click();
  const backupPanel = page.getByTestId("backup-panel");
  await expect(backupPanel).toBeVisible();
  await backupPanel.getByTestId("backup-save-now").click();
  await expect(page.locator(".toast", { hasText: "バックアップを開始できません" })).toBeVisible();
  await expect(backupPanel.getByTestId("backup-storage-summary")).toContainText("0件");
  await backupPanel.getByRole("button", { name: "×" }).click();

  await expect(page.getByRole("button", { name: "AI に見てもらう" })).toBeDisabled();

  await expect(page.getByRole("tab").first().getByTitle("タブを閉じる")).toBeDisabled();
  await expect(page.getByRole("tab")).toHaveCount(2);

  await page.evaluate(() => window.__resolvePendingChat__?.());
  await page.getByRole("tab").first().click();
  await expect(chat.getByText("Aへの返信", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "AI に見てもらう" })).toBeEnabled();
});

test("blocks closing any tab while a background tab sends chat, but closes it once idle", async ({ page }) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const React = (await import("/node_modules/.vite/deps/react.js")).default;
    const { createRoot } = (await import("/node_modules/.vite/deps/react-dom_client.js")).default;
    const { flushSync } = (await import("/node_modules/.vite/deps/react-dom.js")).default;
    const { useTabActions } = await import("/src/hooks/useTabActions.ts");
    const { TabStore } = await import("/src/hooks/useTabs.ts");

    const tabStore = new TabStore(64 * 1024 * 1024);
    const sendingTab = tabStore.addBlankTab();
    const visibleTab = tabStore.addBlankTab();
    tabStore.patchTabUiState(sendingTab.id, { chatLoading: true });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let actions: ReturnType<typeof useTabActions>;
    let chatLoading = true;

    function Harness() {
      actions = useTabActions({
        tabStore,
        savingRef: { current: false },
        paintBusyRef: { current: false },
        anyDialogOpen: false,
        // App passes the aggregate state: B is displayed and idle, but A is sending.
        chatLoading,
        aiLoading: false,
        stashAndAddTab: () => tabStore.addBlankTab(),
        isAutoBackupBusy: () => false,
      });
      return null;
    }

    flushSync(() => root.render(React.createElement(Harness)));
    try {
      await actions.handleCloseTab(visibleTab.id);
      const blocked = tabStore.tabs.map((tab) => tab.id);
      tabStore.patchTabUiState(sendingTab.id, { chatLoading: false });
      chatLoading = false;
      flushSync(() => root.render(React.createElement(Harness)));
      await actions.handleCloseTab(visibleTab.id);
      return {
        activeTabId: tabStore.activeTabId,
        blocked,
        remaining: tabStore.tabs.map((tab) => tab.id),
        sendingTabId: sendingTab.id,
        visibleTabId: visibleTab.id,
      };
    } finally {
      flushSync(() => root.unmount());
      host.remove();
    }
  });

  expect(result.activeTabId).toBe(result.sendingTabId);
  expect(result.blocked).toEqual([result.sendingTabId, result.visibleTabId]);
  expect(result.remaining).toEqual([result.sendingTabId]);
});

test("rejects a controller-level AI request while chat is loading", async ({ page }) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const React = (await import("/node_modules/.vite/deps/react.js")).default;
    const { createRoot } = (await import("/node_modules/.vite/deps/react-dom_client.js")).default;
    const { flushSync } = (await import("/node_modules/.vite/deps/react-dom.js")).default;
    const { useAIController } = await import("/src/hooks/useAIController.ts");
    const { TabStore } = await import("/src/hooks/useTabs.ts");

    const tabStore = new TabStore(64 * 1024 * 1024);
    const activeTab = tabStore.addBlankTab(32, 24, 96);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let actions: ReturnType<typeof useAIController>;

    function Harness() {
      actions = useAIController({
        isChatLoading: () => true,
        activeTab,
        tabStore,
        doc: activeTab.doc,
        selection: { kind: "none" },
        enhancedAIEnabled: false,
      });
      return null;
    }

    flushSync(() => root.render(React.createElement(Harness)));
    try {
      await actions.handleAnalyze();
      return { loading: actions.isLoading, advice: actions.advice };
    } finally {
      flushSync(() => root.unmount());
      host.remove();
    }
  });

  expect(result).toEqual({ loading: false, advice: "" });
  await expect(page.locator(".toast", { hasText: "チャット送信完了までお待ちください" })).toBeVisible();
});

test("blocks topbar and Ctrl+N while an AI analysis is pending", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("ai-paint-layout", JSON.stringify({
      flipped: false,
      leftSections: [],
      rightSections: ["text", "view", "grid", "layers", "chat", "ai", "aiDraw"],
      hidden: ["activity", "timelapse"],
      topBarLeftItems: ["about", "canvasSettings", "canvasExtend", "newCanvas", "openImage", "openDirectImage", "undo", "redo"],
      topBarRightItems: ["rotateCounterClockwise", "rotateClockwise", "horizontalFlip", "subview", "drawingGuide", "colorAdjust", "layoutSettings", "save", "export", "backup", "theme"],
      topBarHiddenItems: ["reference", "shortcutSettings"],
    }));
    Object.assign(window, {
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => undefined },
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
        transformCallback: () => 1,
        unregisterCallback: () => undefined,
        invoke: async (command: string) => {
          if (command === "has_claude_api_key") return true;
          if (command === "analyze_canvas_v2") {
            return new Promise((resolve) => {
              window.__resolvePendingAnalysis__ = () => resolve({
                text: JSON.stringify({ advice: "解析完了", guides: [], palette: [] }),
              });
            });
          }
          return null;
        },
      },
    });
  });
  await page.goto("/");
  await createCanvas(page, { width: 80, height: 60, dpi: 144 });

  const analyze = page.getByRole("button", { name: "AI に見てもらう" });
  await expect(analyze).toBeEnabled();
  await analyze.click();
  await expect.poll(() => page.evaluate(() => Boolean(window.__resolvePendingAnalysis__))).toBe(true);

  await page.getByTestId("topbar-newCanvas").click();
  await page.keyboard.press("Control+n");
  await expect(page.getByTestId("new-canvas-dialog")).toBeHidden();

  await page.evaluate(() => window.__resolvePendingAnalysis__?.());
  await expect(analyze).toBeEnabled();
});

test("blocks new canvas dialog and confirmation during chat or AI analysis, then creates a canvas once idle", async ({ page }) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const React = (await import("/node_modules/.vite/deps/react.js")).default;
    const { createRoot } = (await import("/node_modules/.vite/deps/react-dom_client.js")).default;
    const { flushSync } = (await import("/node_modules/.vite/deps/react-dom.js")).default;
    const { useNewCanvasActions } = await import("/src/hooks/useNewCanvasActions.ts");
    const { TabStore } = await import("/src/hooks/useTabs.ts");

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let actions: ReturnType<typeof useNewCanvasActions>;
    let chatLoading = true;
    let aiLoading = false;
    let dialogOpenCount = 0;
    const created: Array<[number | undefined, number | undefined, number | undefined]> = [];
    const tabStore = new TabStore(64 * 1024 * 1024);

    function Harness() {
      actions = useNewCanvasActions({
        savingRef: { current: false },
        paintBusyRef: { current: false },
        chatLoading,
        aiLoading,
        isAutoBackupBusy: () => false,
        openNewCanvasDialog: () => { dialogOpenCount += 1; },
        stashAndAddTab: (width, height, dpi) => {
          created.push([width, height, dpi]);
          return tabStore.addBlankTab(width, height, dpi);
        },
      });
      return null;
    }

    flushSync(() => root.render(React.createElement(Harness)));
    try {
      actions.handleOpenNewCanvasDialog();
      actions.handleNewCanvasConfirm(800, 600, 144);
      const whileSending = { dialogOpenCount, created: created.slice() };
      chatLoading = false;
      flushSync(() => root.render(React.createElement(Harness)));
      aiLoading = true;
      flushSync(() => root.render(React.createElement(Harness)));
      actions.handleOpenNewCanvasDialog();
      actions.handleNewCanvasConfirm(800, 600, 144);
      const whileAnalyzing = { dialogOpenCount, created: created.slice() };
      aiLoading = false;
      flushSync(() => root.render(React.createElement(Harness)));
      actions.handleOpenNewCanvasDialog();
      actions.handleNewCanvasConfirm(800, 600, 144);
      return { whileSending, whileAnalyzing, afterIdle: { dialogOpenCount, created } };
    } finally {
      flushSync(() => root.unmount());
      host.remove();
    }
  });

  expect(result.whileSending).toEqual({ dialogOpenCount: 0, created: [] });
  expect(result.whileAnalyzing).toEqual({ dialogOpenCount: 0, created: [] });
  expect(result.afterIdle).toEqual({
    dialogOpenCount: 1,
    created: [[800, 600, 144]],
  });
});
