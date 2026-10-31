import { describe, expect, it, vi } from "vitest";
import { blockShortcutEventWhileFileLoading } from "../../src/core/shortcutLoadingLock";

describe("shortcutLoadingLock", () => {
  it("blocks keyboard shortcuts while a file is loading", () => {
    const event = {
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    };

    expect(blockShortcutEventWhileFileLoading(event, true)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopImmediatePropagation).toHaveBeenCalledOnce();
  });

  it("leaves keyboard events alone when no file is loading", () => {
    const event = {
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    };

    expect(blockShortcutEventWhileFileLoading(event, false)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
  });
});
