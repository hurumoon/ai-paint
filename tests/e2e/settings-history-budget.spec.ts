import { expect, test, type Page } from "@playwright/test";
import type { Tab } from "../../src/hooks/useTabs";

const EIGHT_GIB = 8 * 1024 * 1024 * 1024;
const TWO_HUNDRED_FIFTY_SIX_MIB = 256 * 1024 * 1024;

test.beforeEach(async ({ page }) => {
  await page.addInitScript((initialBudget) => {
    window.localStorage.clear();
    window.localStorage.setItem("ai-paint-history-memory", String(initialBudget));
  }, EIGHT_GIB);
});

test("history memory budget remains a draft until settings are applied", async ({ page }) => {
  await page.goto("/");
  await captureNextCreatedTab(page);
  await createCanvas(page);
  await createLargeUndoEntries(page);

  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("ai-paint-history-memory")))
    .toBe(String(EIGHT_GIB));
  expect(await historyMemoryUsed(page)).toBeGreaterThan(TWO_HUNDRED_FIFTY_SIX_MIB);
  expect(await historyEntryCount(page)).toBe(2);

  const dialog = page.locator(".canvas-settings-dialog");
  await openHistorySettings(page, dialog);
  await selectBudget(dialog, TWO_HUNDRED_FIFTY_SIX_MIB);
  await dialog.getByRole("button", { name: "キャンセル" }).click();
  await expect(dialog).toBeHidden();
  await expectBudgetAndHistoryUnchanged(page);
  await expectUndoAndRedoToRemainAvailable(page);

  await openHistorySettings(page, dialog);
  await expect(dialog.locator("select")).toHaveValue(String(EIGHT_GIB));
  await dialog.getByRole("button", { name: "キャンセル" }).click();

  await openHistorySettings(page, dialog);
  await selectBudget(dialog, TWO_HUNDRED_FIFTY_SIX_MIB);
  await dialog.getByRole("button", { name: "×" }).click();
  await expect(dialog).toBeHidden();
  await expectBudgetAndHistoryUnchanged(page);

  await openHistorySettings(page, dialog);
  await dialog.locator(".canvas-settings-nav").getByRole("button", { name: /^設定JSON/ }).click();
  await dialog.locator('input[type="file"]').setInputFiles({
    name: "history-budget.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({
      format: "ai-paint-settings",
      version: 1,
      settings: { historyMemoryBudget: TWO_HUNDRED_FIFTY_SIX_MIB },
    })),
  });
  await expect(page.getByText("設定 JSON をインポートしました")).toBeVisible();
  await dialog.locator(".canvas-settings-nav").getByRole("button", { name: /^履歴/ }).click();
  await expect(dialog.locator("select")).toHaveValue(String(TWO_HUNDRED_FIFTY_SIX_MIB));
  await dialog.getByRole("button", { name: "キャンセル" }).click();
  await expect(dialog).toBeHidden();
  await expectBudgetAndHistoryUnchanged(page);

  await openHistorySettings(page, dialog);
  await selectBudget(dialog, TWO_HUNDRED_FIFTY_SIX_MIB);
  await page.locator(".popover-backdrop").click({ position: { x: 5, y: 5 } });
  await expect(dialog).toBeHidden();
  await expectBudgetAndHistoryUnchanged(page);

  await openHistorySettings(page, dialog);
  await selectBudget(dialog, TWO_HUNDRED_FIFTY_SIX_MIB);
  await dialog.locator(".canvas-settings-nav").getByRole("button", { name: /^カラー履歴/ }).click();
  await dialog.locator(".canvas-settings-nav").getByRole("button", { name: /^履歴/ }).click();
  await expect(dialog.locator("select")).toHaveValue(String(TWO_HUNDRED_FIFTY_SIX_MIB));
  await dialog.getByRole("button", { name: "適用" }).click();
  await expect(dialog).toBeHidden();

  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("ai-paint-history-memory")))
    .toBe(String(TWO_HUNDRED_FIFTY_SIX_MIB));
  expect(await historyMemoryUsed(page)).toBeLessThanOrEqual(TWO_HUNDRED_FIFTY_SIX_MIB);
  expect(await historyEntryCount(page)).toBe(1);
});

async function captureNextCreatedTab(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const { TabStore } = await import("/src/hooks/useTabs.ts");
    const originalAddBlankTab = TabStore.prototype.addBlankTab;
    TabStore.prototype.addBlankTab = function (...args) {
      const tab = originalAddBlankTab.apply(this, args);
      (window as Window & { __historyBudgetTest?: { tab: Tab } }).__historyBudgetTest = { tab };
      return tab;
    };
  });
}

async function createCanvas(page: Page): Promise<void> {
  await page.locator(".empty-canvas-actions").getByRole("button", { name: "新規キャンバス" }).click();
  await page.getByTestId("new-canvas-create").click();
  await expect.poll(() => page.evaluate(() => Boolean((window as Window & {
    __historyBudgetTest?: unknown;
  }).__historyBudgetTest))).toBe(true);
}

async function createLargeUndoEntries(page: Page): Promise<void> {
  await page.evaluate(() => {
    const testWindow = window as Window & {
      __historyBudgetTest?: {
        tab: Tab;
      };
    };
    const tab = testWindow.__historyBudgetTest?.tab;
    if (!tab) throw new Error("test tab was not captured");

    const layers = [tab.doc.addLayer("large history 1"), tab.doc.addLayer("large history 2")];
    for (const layer of layers) {
      // 巨大な canvas を確保せず、履歴の実際の予算経路だけを再現する。
      layer.store.getApproxByteSize = () => 160 * 1024 * 1024;
      tab.history.beginStructureOperation(tab.doc);
      tab.doc.removeLayer(layer.meta.id);
      tab.history.commitStructureOperation(tab.doc, `remove ${layer.meta.id}`);
    }
  });
}

async function openHistorySettings(page: Page, dialog: ReturnType<Page["locator"]>): Promise<void> {
  await page.getByRole("button", { name: "設定", exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.locator(".canvas-settings-nav").getByRole("button", { name: /^履歴/ }).click();
}

async function selectBudget(dialog: ReturnType<Page["locator"]>, budget: number): Promise<void> {
  await dialog.locator("select").selectOption(String(budget));
}

async function historyMemoryUsed(page: Page): Promise<number> {
  return page.evaluate(() => {
    const tab = (window as Window & {
      __historyBudgetTest?: { tab: { history: { getMemoryUsedForBudget: () => number } } };
    }).__historyBudgetTest?.tab;
    if (!tab) throw new Error("test tab was not captured");
    return tab.history.getMemoryUsedForBudget();
  });
}

async function historyEntryCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const tab = (window as Window & {
      __historyBudgetTest?: { tab: Tab };
    }).__historyBudgetTest?.tab;
    if (!tab) throw new Error("test tab was not captured");
    return tab.history.getEntryCountForBudget();
  });
}

async function expectBudgetAndHistoryUnchanged(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("ai-paint-history-memory")))
    .toBe(String(EIGHT_GIB));
  expect(await historyMemoryUsed(page)).toBeGreaterThan(TWO_HUNDRED_FIFTY_SIX_MIB);
  expect(await historyEntryCount(page)).toBe(2);
}

async function expectUndoAndRedoToRemainAvailable(page: Page): Promise<void> {
  const result = await page.evaluate(() => {
    const tab = (window as Window & {
      __historyBudgetTest?: { tab: Tab };
    }).__historyBudgetTest?.tab;
    if (!tab) throw new Error("test tab was not captured");
    const layerCount = tab.doc.layers.length;
    tab.history.undo(tab.doc);
    tab.history.undo(tab.doc);
    const afterUndo = tab.history.canUndo();
    const restoredLayers = tab.doc.layers.length - layerCount;
    tab.history.redo(tab.doc);
    tab.history.redo(tab.doc);
    return { afterUndo, restoredLayers, afterRedoLayers: tab.doc.layers.length - layerCount, canRedo: tab.history.canRedo() };
  });
  expect(result).toEqual({ afterUndo: false, restoredLayers: 2, afterRedoLayers: 0, canRedo: false });
}
