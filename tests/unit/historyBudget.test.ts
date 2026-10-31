import { describe, expect, it } from "vitest";
import { History } from "../../src/core/History";
import { TabStore } from "../../src/hooks/useTabs";

function recordOpacityChange(
  tab: ReturnType<TabStore["addBlankTab"]>,
  opacity: number
): void {
  const layer = tab.doc.getActiveLayer();
  if (!layer) throw new Error("active layer was not available");
  tab.history.recordMetaChange(tab.doc, [layer.meta.id], "opacity", () => {
    tab.doc.setOpacity(layer.meta.id, opacity);
  });
}

function recordLayerAddition(
  tab: ReturnType<TabStore["addBlankTab"]>,
  name: string
): string {
  tab.history.beginStructureOperation(tab.doc);
  const layer = tab.doc.addLayer(name);
  tab.history.commitStructureOperation(tab.doc, `レイヤー追加: ${name}`);
  return layer.meta.id;
}

describe("History memory budget", () => {
  it("does not advance the dirty snapshot version when only the budget changes", () => {
    const history = new History();
    const before = history.getSnapshot();

    history.setMemoryBudget(128 * 1024 * 1024);

    expect(history.getSnapshot()).toBe(before);
  });

  it("shares one memory budget across every tab", () => {
    const store = new TabStore(600);
    const first = store.addBlankTab(1, 1);
    recordOpacityChange(first, 0.9);
    const second = store.addBlankTab(1, 1);
    recordOpacityChange(second, 0.8);
    const third = store.addBlankTab(1, 1);
    recordOpacityChange(third, 0.7);

    expect(first.history.canUndo()).toBe(false);
    expect(second.history.canUndo()).toBe(true);
    expect(third.history.canUndo()).toBe(true);
  });

  it("applies a reduced budget to the combined history immediately", () => {
    const store = new TabStore(1024);
    const first = store.addBlankTab(1, 1);
    recordOpacityChange(first, 0.9);
    const second = store.addBlankTab(1, 1);
    recordOpacityChange(second, 0.8);
    const third = store.addBlankTab(1, 1);
    recordOpacityChange(third, 0.7);

    store.setHistoryBudget(500);

    expect(first.history.canUndo()).toBe(false);
    expect(second.history.canUndo()).toBe(false);
    expect(third.history.canUndo()).toBe(true);
  });

  it("evicts the oldest redo entry even when it belongs to another tab", () => {
    const store = new TabStore(1024);
    const redoTab = store.addBlankTab(1, 1);
    recordOpacityChange(redoTab, 0.9);
    redoTab.history.undo(redoTab.doc);
    expect(redoTab.history.canRedo()).toBe(true);

    const editingTab = store.addBlankTab(1, 1);
    recordOpacityChange(editingTab, 0.8);
    recordOpacityChange(editingTab, 0.7);

    store.setHistoryBudget(600);

    expect(redoTab.history.canRedo()).toBe(false);
    expect(editingTab.history.canUndo()).toBe(true);
    editingTab.history.undo(editingTab.doc);
    expect(editingTab.history.canUndo()).toBe(true);
  });

  it("re-accounts a large stashed TileStore and evicts an older entry from another tab", () => {
    const store = new TabStore(64 * 1024);
    const olderTab = store.addBlankTab(1, 1);
    recordOpacityChange(olderTab, 0.9);

    const structureTab = store.addBlankTab(8, 8);
    const addedLayerId = recordLayerAddition(structureTab, "大きなレイヤー");
    const addedLayer = structureTab.doc.getLayer(addedLayerId);
    if (!addedLayer) throw new Error("added layer was not available");
    addedLayer.store.getApproxByteSize = () => 10 * 1024 * 1024;

    structureTab.history.undo(structureTab.doc);

    expect(structureTab.doc.getLayer(addedLayerId)).toBeUndefined();
    expect(structureTab.history.canRedo()).toBe(true);
    expect(olderTab.history.canUndo()).toBe(false);

    structureTab.history.redo(structureTab.doc);
    expect(structureTab.doc.getLayer(addedLayerId)?.store).toBe(addedLayer.store);
  });

  it("unregisters a closed tab so later budget changes do not evict its history", () => {
    const store = new TabStore(2048);
    const closedTab = store.addBlankTab(1, 1);
    recordOpacityChange(closedTab, 0.9);
    recordOpacityChange(closedTab, 0.8);
    const remainingTab = store.addBlankTab(1, 1);
    recordOpacityChange(remainingTab, 0.7);

    store.closeTab(closedTab.id);
    store.setHistoryBudget(300);

    expect(remainingTab.history.canUndo()).toBe(true);
    expect(closedTab.history.canUndo()).toBe(true);
    closedTab.history.undo(closedTab.doc);
    expect(closedTab.history.canUndo()).toBe(true);
  });

  it("refreshes the active tab canUndo and canRedo state after eviction", () => {
    const store = new TabStore(1024);
    const activeTab = store.addBlankTab(1, 1);
    recordOpacityChange(activeTab, 0.9);
    activeTab.history.undo(activeTab.doc);
    const newerTab = store.addBlankTab(1, 1);
    recordOpacityChange(newerTab, 0.8);
    recordOpacityChange(newerTab, 0.7);
    store.setActiveTab(activeTab.id);

    let storeUpdates = 0;
    const unsubscribe = store.subscribe(() => {
      storeUpdates += 1;
    });
    store.setHistoryBudget(600);
    unsubscribe();

    const visibleTab = store.getActiveTab();
    expect(storeUpdates).toBe(1);
    expect(visibleTab?.history.canUndo()).toBe(false);
    expect(visibleTab?.history.canRedo()).toBe(false);
  });
});
