import { describe, expect, it } from "vitest";
import {
  clampSnapshotRect,
  snapshotSize,
  unionSnapshotRect,
} from "../../src/core/historySnapshots";
import type { LayerSnapshot } from "../../src/core/historySnapshots";

describe("historySnapshots", () => {
  it("clamps fractional or out-of-bounds regions to document bounds", () => {
    expect(
      clampSnapshotRect({ x: -2.4, y: 3.2, w: 6.6, h: 20 }, 10, 12)
    ).toEqual({ x: 0, y: 3, w: 5, h: 9 });
  });

  it("keeps clamped regions at least one pixel wide and tall", () => {
    expect(
      clampSnapshotRect({ x: 100, y: 100, w: 0, h: 0 }, 10, 12)
    ).toEqual({ x: 100, y: 100, w: 1, h: 1 });
  });

  it("unions operation regions for incremental history tracking", () => {
    expect(
      unionSnapshotRect(
        { x: 2, y: 5, w: 4, h: 3 },
        { x: -1, y: 7, w: 10, h: 5 }
      )
    ).toEqual({ x: -1, y: 5, w: 10, h: 7 });
  });

  it("reports pixel snapshot memory in bytes", () => {
    const snap = {
      imageData: { width: 13, height: 17 } as ImageData,
      width: 1024,
      height: 1024,
    } as LayerSnapshot;

    expect(snapshotSize(snap)).toBe(13 * 17 * 4);
  });
});
