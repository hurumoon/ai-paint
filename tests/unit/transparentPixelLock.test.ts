import { describe, expect, it } from "vitest";
import { applyTransparentPixelLock } from "../../src/core/transparentPixelLock";

function imageData(pixels: number[][]): ImageData {
  return {
    width: pixels.length,
    height: 1,
    colorSpace: "srgb",
    data: new Uint8ClampedArray(pixels.flat()),
  } as ImageData;
}

describe("transparentPixelLock", () => {
  it("keeps fully transparent pixels unchanged and preserves existing alpha", () => {
    const before = imageData([
      [0, 0, 0, 0],
      [20, 40, 60, 128],
      [200, 100, 50, 255],
    ]);
    const after = imageData([
      [255, 0, 0, 255],
      [100, 120, 140, 255],
      [0, 0, 0, 0],
    ]);

    applyTransparentPixelLock(before, after);

    expect(Array.from(after.data)).toEqual([
      0, 0, 0, 0,
      100, 120, 140, 128,
      200, 100, 50, 255,
    ]);
  });

  it("rejects mismatched image sizes", () => {
    const before = imageData([[0, 0, 0, 0]]);
    const after = {
      width: 2,
      height: 1,
      colorSpace: "srgb",
      data: new Uint8ClampedArray(8),
    } as ImageData;

    expect(() => applyTransparentPixelLock(before, after)).toThrow(
      "透明ピクセルロックの適用範囲が一致していません"
    );
  });
});
