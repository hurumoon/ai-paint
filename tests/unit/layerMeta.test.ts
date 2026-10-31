import { describe, expect, it } from "vitest";
import { isBgInvariantPatch } from "../../src/core/layerMeta";

describe("layerMeta", () => {
  it("treats active-layer display-only patches as bg-invariant", () => {
    expect(
      isBgInvariantPatch({
        opacity: 0.5,
        visible: false,
        locked: true,
        transparentPixelLock: true,
      })
    ).toBe(true);
  });

  it("treats structural and text patches as bg-affecting", () => {
    expect(isBgInvariantPatch({ parentId: "group-1" })).toBe(false);
    expect(isBgInvariantPatch({ clippingMask: true })).toBe(false);
    expect(isBgInvariantPatch({ text: { text: "x" } as never })).toBe(false);
  });
});
