import { describe, expect, it } from "vitest";
import { tabHasUnsavedChanges, TabStore } from "../../src/hooks/useTabs";

describe("tab dirty tracking", () => {
  it("detects metadata changes that do not advance history", () => {
    const store = new TabStore(1024);
    const tab = store.addBlankTab();
    const layer = tab.doc.getActiveLayer();
    if (!layer) throw new Error("active layer was not available");

    tab.doc.setOpacity(layer.meta.id, 0.5);

    expect(tab.history.getSnapshot()).toBe(tab.lastSavedVersion);
    expect(tab.doc.getSnapshot()).not.toBe(tab.lastSavedDocumentVersion);
    expect(tabHasUnsavedChanges(tab)).toBe(true);
  });
});
