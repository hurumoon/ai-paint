import { describe, expect, it } from "vitest";
import { DEFAULT_TAB_UI_STATE, TabStore } from "../../src/hooks/useTabs";
import type { ChatMessage, GuideShape } from "../../src/types";

describe("tab UI state", () => {
  it("keeps AI panel results with the tab that produced them", () => {
    const store = new TabStore(1024);
    const source = store.addBlankTab();
    const visible = store.addBlankTab();
    store.setActiveTab(visible.id);
    const guide: GuideShape = { type: "rect", x: 1, y: 2, w: 3, h: 4, color: "#fff" };

    expect(
      store.patchTabUiState(source.id, {
        advice: "look at the silhouette",
        guides: [guide],
        showGuides: true,
        palette: ["#112233"],
      })
    ).toBe(true);

    expect(source.uiState.advice).toBe("look at the silhouette");
    expect(source.uiState.guides).toEqual([guide]);
    expect(source.uiState.showGuides).toBe(true);
    expect(source.uiState.palette).toEqual(["#112233"]);
    expect(visible.uiState).toEqual(DEFAULT_TAB_UI_STATE);
  });

  it("keeps chat replies with the tab that produced them", () => {
    const store = new TabStore(1024);
    const source = store.addBlankTab();
    const visible = store.addBlankTab();
    store.setActiveTab(visible.id);
    const messages: ChatMessage[] = [
      { id: "u1", role: "user", text: "check this", timestamp: 1 },
      { id: "a1", role: "assistant", text: "try a stronger value pattern", timestamp: 2 },
    ];

    expect(
      store.patchTabUiState(source.id, {
        chatMessages: messages,
        chatLoading: false,
        chatError: "",
      })
    ).toBe(true);

    expect(source.uiState.chatMessages).toEqual(messages);
    expect(source.uiState.chatLoading).toBe(false);
    expect(source.uiState.chatError).toBe("");
    expect(visible.uiState).toEqual(DEFAULT_TAB_UI_STATE);
  });

  it("keeps canvas view transforms with the tab", () => {
    const store = new TabStore(1024);
    const source = store.addBlankTab();
    const visible = store.addBlankTab();
    store.setActiveTab(visible.id);

    expect(
      store.patchTabUiState(source.id, {
        zoom: 2,
        pan: { x: 12, y: -8 },
        rotation: 90,
        canvasFlipped: true,
      })
    ).toBe(true);

    expect(source.uiState.zoom).toBe(2);
    expect(source.uiState.pan).toEqual({ x: 12, y: -8 });
    expect(source.uiState.rotation).toBe(90);
    expect(source.uiState.canvasFlipped).toBe(true);
    expect(visible.uiState).toEqual(DEFAULT_TAB_UI_STATE);
  });

  it("keeps detached chat updates independent from history changes on another tab", () => {
    const store = new TabStore(1024);
    const chatSource = store.addBlankTab();
    const editingTab = store.addBlankTab();
    store.setActiveTab(editingTab.id);

    const layer = editingTab.doc.getActiveLayer();
    if (!layer) throw new Error("active layer was not available");
    editingTab.history.recordMetaChange(
      editingTab.doc,
      [layer.meta.id],
      "opacity",
      () => editingTab.doc.setOpacity(layer.meta.id, 0.5)
    );

    const messages: ChatMessage[] = [
      { id: "a1", role: "assistant", text: "history changed elsewhere", timestamp: 2 },
    ];
    expect(
      store.patchTabUiState(chatSource.id, {
        chatMessages: messages,
        chatLoading: false,
      })
    ).toBe(true);

    expect(store.activeTabId).toBe(editingTab.id);
    expect(editingTab.history.canUndo()).toBe(true);
    expect(editingTab.uiState).toEqual(DEFAULT_TAB_UI_STATE);
    expect(chatSource.history.canUndo()).toBe(false);
    expect(chatSource.uiState.chatMessages).toEqual(messages);
  });

  it("ignores UI updates for a closed tab", () => {
    const store = new TabStore(1024);
    const source = store.addBlankTab();
    store.closeTab(source.id);

    expect(store.patchTabUiState(source.id, { advice: "done" })).toBe(false);
  });
});
