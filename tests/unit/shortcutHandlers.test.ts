import { describe, expect, it, vi } from "vitest";
import { createEditShortcutHandlers } from "../../src/hooks/shortcuts/editShortcutHandlers";
import { createTabShortcutHandlers } from "../../src/hooks/shortcuts/tabShortcutHandlers";
import { createViewShortcutHandlers } from "../../src/hooks/shortcuts/viewShortcutHandlers";
import type { GridConfig } from "../../src/components/GridSettings";

function createStateSetter<T>(initial: T) {
  let value = initial;
  const setter = vi.fn((next: T | ((prev: T) => T)) => {
    value =
      typeof next === "function"
        ? (next as (prev: T) => T)(value)
        : next;
  });

  return {
    setter,
    get value() {
      return value;
    },
  };
}

describe("shortcut handler factories", () => {
  it("keeps edit handlers as no-ops when no document is active", () => {
    const setColorAdjustOpen = vi.fn();
    const setSelection = vi.fn();
    const handlers = createEditShortcutHandlers({
      doc: null,
      history: null,
      setShowColorAdjustDialog: setColorAdjustOpen,
      setSelection,
    });

    handlers["edit.colorAdjust"]();
    handlers["edit.selectAll"]();

    expect(setColorAdjustOpen).not.toHaveBeenCalled();
    expect(setSelection).not.toHaveBeenCalled();
  });

  it("resets and clamps view state through view handlers", () => {
    const grid = createStateSetter<GridConfig>({
      show: false,
      size: 16,
      color: "#000000",
      opacity: 0.4,
    });
    const zoom = createStateSetter(7);
    const pan = createStateSetter({ x: 12, y: -4 });
    const rotation = createStateSetter(45);
    const flipped = createStateSetter(true);
    const handlers = createViewShortcutHandlers({
      setGrid: grid.setter,
      setZoom: zoom.setter,
      setPan: pan.setter,
      setRotation: rotation.setter,
      setCanvasFlipped: flipped.setter,
      rotateViewClockwise: vi.fn(),
      rotateViewCounterClockwise: vi.fn(),
      toggleHorizontalFlip: vi.fn(),
    });

    handlers["view.grid"]();
    handlers["view.zoomIn"]();
    handlers["view.reset"]();

    expect(grid.value.show).toBe(true);
    expect(zoom.value).toBe(1);
    expect(pan.value).toEqual({ x: 0, y: 0 });
    expect(rotation.value).toBe(0);
    expect(flipped.value).toBe(false);
  });

  it("closes only the active tab", () => {
    const handleCloseTab = vi.fn();
    createTabShortcutHandlers({
      activeTabId: null,
      handleCloseTab,
    })["tab.close"]();
    createTabShortcutHandlers({
      activeTabId: "tab-1",
      handleCloseTab,
    })["tab.close"]();

    expect(handleCloseTab).toHaveBeenCalledTimes(1);
    expect(handleCloseTab).toHaveBeenCalledWith("tab-1");
  });
});
