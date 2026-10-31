import { describe, expect, it } from "vitest";
import { normalizeRotationDegrees } from "../../src/hooks/useCanvasViewCommands";

describe("normalizeRotationDegrees", () => {
  it("rounds and wraps rotations into a positive 0-359 range", () => {
    expect(normalizeRotationDegrees(0)).toBe(0);
    expect(normalizeRotationDegrees(359.4)).toBe(359);
    expect(normalizeRotationDegrees(359.6)).toBe(0);
    expect(normalizeRotationDegrees(450)).toBe(90);
    expect(normalizeRotationDegrees(-90)).toBe(270);
    expect(normalizeRotationDegrees(-721)).toBe(359);
  });
});
