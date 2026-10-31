import { afterEach, describe, expect, it, vi } from "vitest";
import {
  countChangedPixels,
  estimateRectDrawingAmount,
} from "../../src/core/drawingActivity";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function imageData(width: number, height: number, values: number[]): ImageData {
  return {
    width,
    height,
    data: Uint8ClampedArray.from(values),
    colorSpace: "srgb",
  } as ImageData;
}

describe("drawing activity", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("clips estimated rectangles to the document bounds", () => {
    expect(estimateRectDrawingAmount({ x: -2, y: 1, w: 5, h: 4 }, 4, 4)).toBe(9);
    expect(estimateRectDrawingAmount({ x: 10, y: 10, w: 2, h: 2 }, 4, 4)).toBe(0);
  });

  it("counts changed pixels and handles different image sizes conservatively", () => {
    const before = imageData(2, 1, [0, 0, 0, 0, 10, 20, 30, 255]);
    const after = imageData(2, 1, [0, 0, 0, 0, 10, 20, 31, 255]);

    expect(countChangedPixels(before, after)).toBe(1);
    expect(countChangedPixels(before, imageData(1, 1, [0, 0, 0, 0]))).toBe(2);
  });

  it("aggregates persisted activity by local day and notifies subscribers", async () => {
    vi.resetModules();
    vi.stubGlobal("localStorage", new MemoryStorage());
    const activity = await import("../../src/core/drawingActivity");
    const listener = vi.fn();
    const unsubscribe = activity.subscribeDrawingActivity(listener);
    const at = new Date(2026, 0, 2, 12, 0, 0).getTime();

    activity.recordDrawingActivity(1.4, at);
    activity.recordDrawingActivity(2.6, at + 1000);
    activity.recordDrawingActivity(Number.NaN, at + 2000);
    unsubscribe();

    expect(activity.loadDrawingActivityDays()).toEqual([
      {
        date: "2026-01-02",
        amount: 4,
        operations: 2,
        updatedAt: at + 1000,
      },
    ]);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
