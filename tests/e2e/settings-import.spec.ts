import { expect, test, type Page } from "@playwright/test";

const SETTINGS_KEYS = [
  "ai-paint-shortcuts", "ai-paint-layout", "ai-paint-grid",
  "ai-paint-enhanced-ai-enabled", "ai-paint-ai-guide-display-mode",
  "ai-paint-challenge-items", "ai-paint-color-history-config",
  "ai-paint-history-memory", "ai-paint-backup-enabled", "ai-paint-backup-interval",
];

interface ImportTestWindow extends Window {
  __TAURI_INTERNALS__?: { invoke: (command: string, args?: { settings?: unknown }) => Promise<unknown> };
  __finishModelSave?: (succeed: boolean) => void;
}

async function savedSettings(page: Page) {
  return page.evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), SETTINGS_KEYS);
}

test("model save failure leaves every setting unchanged, and retry commits after saving", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("ai-paint-history-memory", String(8 * 1024 ** 3));
  });
  await page.goto("/");
  await page.locator(".empty-canvas-actions").getByRole("button", { name: "新規キャンバス" }).click();
  await page.getByTestId("new-canvas-create").click();
  await page.getByRole("button", { name: "設定", exact: true }).click();
  const dialog = page.locator(".canvas-settings-dialog");
  const nav = dialog.locator(".canvas-settings-nav");
  // 保存済みの上限と異なる下書きも、失敗時に維持する。
  await nav.getByRole("button", { name: /^履歴/ }).click();
  await dialog.locator("select").selectOption(String(1024 ** 3));
  await nav.getByRole("button", { name: /^設定JSON/ }).click();
  const before = await savedSettings(page);
  const archive = await page.evaluate(async () => {
    const { createAppSettingsArchive, normalizeAppSettingsSnapshot } = await import("/src/core/appSettingsArchive.ts");
    const snapshot = normalizeAppSettingsSnapshot({
      shortcuts: { "tool.brush": "X" },
      layout: { flipped: true },
      grid: { show: true, spacing: 32 },
      ai: { enhancedAIEnabled: true, aiGuideDisplayMode: "pins" },
      claudeModelSettings: { chat: { model: "import-test-model", maxTokens: 500 } },
      challengeItems: [{ id: "import-test", category: "drawing", prompt: "インポート確認", enabled: true }],
      colorHistoryConfig: { enabled: false, display: "list", maxCount: 8 },
      historyMemoryBudget: 256 * 1024 ** 2,
      backup: { enabled: false, intervalSec: 120 },
    });
    return createAppSettingsArchive(snapshot);
  });
  await page.evaluate(() => {
    const target = window as ImportTestWindow;
    target.__TAURI_INTERNALS__ = {
      invoke: (command, args) => {
        if (command !== "set_claude_model_settings") return Promise.resolve(null);
        return new Promise((resolve, reject) => {
          target.__finishModelSave = succeed => {
            delete target.__finishModelSave;
            if (succeed) resolve(args?.settings);
            else reject(new Error("モデル設定の保存テスト失敗"));
          };
        });
      },
    };
  });
  const upload = () => dialog.locator('input[type="file"]').setInputFiles({
    name: "settings.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(archive)),
  });
  for (const succeed of [false, true]) {
    await upload();
    await expect(dialog.getByRole("button", { name: "インポート中…" })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "適用", exact: true })).toBeDisabled();
    await expect.poll(() => page.evaluate(() => Boolean((window as ImportTestWindow).__finishModelSave))).toBe(true);
    expect(await savedSettings(page)).toEqual(before);
    await page.evaluate(value => (window as ImportTestWindow).__finishModelSave?.(value), succeed);
    await expect(page.getByText(succeed
      ? "設定 JSON をインポートしました"
      : "設定 JSON のインポートに失敗しました: モデル設定の保存テスト失敗", { exact: true })).toBeVisible();
    await nav.getByRole("button", { name: /^履歴/ }).click();
    await expect(dialog.locator("select")).toHaveValue(String(succeed ? 256 * 1024 ** 2 : 1024 ** 3));
    if (!succeed) {
      expect(await savedSettings(page)).toEqual(before);
      await nav.getByRole("button", { name: /^設定JSON/ }).click();
    }
  }
  const s = archive.settings;
  await expect.poll(() => savedSettings(page)).toEqual({
    "ai-paint-shortcuts": JSON.stringify(s.shortcuts),
    "ai-paint-layout": JSON.stringify(s.layout),
    "ai-paint-grid": JSON.stringify(s.grid),
    "ai-paint-enhanced-ai-enabled": "1",
    "ai-paint-ai-guide-display-mode": "pins",
    "ai-paint-challenge-items": JSON.stringify(s.challengeItems),
    "ai-paint-color-history-config": JSON.stringify(s.colorHistoryConfig),
    "ai-paint-history-memory": before["ai-paint-history-memory"],
    "ai-paint-backup-enabled": "0",
    "ai-paint-backup-interval": "120",
  });
  await page.evaluate(() => { delete (window as ImportTestWindow).__TAURI_INTERNALS__; });
});
