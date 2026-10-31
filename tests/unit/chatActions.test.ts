import { describe, expect, it, vi } from "vitest";
import {
  handleChatActionPayload,
  type ChatActionHandlers,
} from "../../src/core/chatActions";
import type { GuideShape } from "../../src/types";

function createHandlers(): ChatActionHandlers {
  return {
    setDraft: vi.fn(),
    setAttachCanvas: vi.fn(),
    onSend: vi.fn(),
    onClear: vi.fn(),
    onApplyGuides: vi.fn(),
    onClearGuides: vi.fn(),
    onApplyPalette: vi.fn(),
  };
}

describe("chat action dispatch", () => {
  it("routes clearGuides to the guide clearing handler only", () => {
    const handlers = createHandlers();

    handleChatActionPayload({ type: "clearGuides" }, handlers);

    expect(handlers.onClearGuides).toHaveBeenCalledOnce();
    expect(handlers.onApplyGuides).not.toHaveBeenCalled();
    expect(handlers.onClear).not.toHaveBeenCalled();
  });

  it("passes detached chat guide and palette payloads through unchanged", () => {
    const handlers = createHandlers();
    const guides: GuideShape[] = [
      { type: "rect", x: 1, y: 2, w: 3, h: 4, color: "#ff0000" },
    ];
    const palette = ["#112233", "#445566"];

    handleChatActionPayload({ type: "applyGuides", guides }, handlers);
    handleChatActionPayload({ type: "applyPalette", palette }, handlers);

    expect(handlers.onApplyGuides).toHaveBeenCalledWith(guides);
    expect(handlers.onApplyPalette).toHaveBeenCalledWith(palette);
  });

  it("ignores malformed optional payloads", () => {
    const handlers = createHandlers();

    handleChatActionPayload({ type: "draft", draft: undefined }, handlers);
    handleChatActionPayload({ type: "attachCanvas" }, handlers);
    handleChatActionPayload({ type: "applyGuides" }, handlers);
    handleChatActionPayload({ type: "applyPalette" }, handlers);

    expect(handlers.setDraft).not.toHaveBeenCalled();
    expect(handlers.setAttachCanvas).not.toHaveBeenCalled();
    expect(handlers.onApplyGuides).not.toHaveBeenCalled();
    expect(handlers.onApplyPalette).not.toHaveBeenCalled();
  });
});
