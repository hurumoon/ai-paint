import { describe, expect, it } from "vitest";
import { canvasEditStartBlockedReason } from "../../src/hooks/useCanvasInputRouter";

describe("canvas input locks", () => {
  it("blocks canvas edit starts while AI processing is busy", () => {
    expect(canvasEditStartBlockedReason(() => true)).toBe("AI処理完了までお待ちください");
  });

  it("allows canvas edit starts when AI processing is idle or not wired", () => {
    expect(canvasEditStartBlockedReason(() => false)).toBeNull();
    expect(canvasEditStartBlockedReason()).toBeNull();
  });
});
