import { describe, expect, it } from "vitest";
import { magicWandMask } from "../../src/core/toolHandlers";

function makeImageData(
  width: number,
  height: number,
  pixels: Array<[number, number, number, number]>
): ImageData {
  return {
    width,
    height,
    data: new Uint8ClampedArray(pixels.flat()),
    colorSpace: "srgb",
  } as ImageData;
}

function alphaAt(mask: Uint8ClampedArray, width: number, x: number, y: number): number {
  return mask[(y * width + x) * 4 + 3];
}

describe("magicWandMask", () => {
  it("separates transparent black from opaque black in contiguous selections", () => {
    const image = makeImageData(2, 1, [
      [0, 0, 0, 0],
      [0, 0, 0, 255],
    ]);

    const transparentResult = magicWandMask(image, 0, 0, 0, true);
    expect(transparentResult).not.toBeNull();
    expect(alphaAt(transparentResult!.data, image.width, 0, 0)).toBe(255);
    expect(alphaAt(transparentResult!.data, image.width, 1, 0)).toBe(0);
    expect(transparentResult).toMatchObject({ x: 0, y: 0, w: 1, h: 1 });

    const opaqueResult = magicWandMask(image, 1, 0, 0, true);
    expect(opaqueResult).not.toBeNull();
    expect(alphaAt(opaqueResult!.data, image.width, 0, 0)).toBe(0);
    expect(alphaAt(opaqueResult!.data, image.width, 1, 0)).toBe(255);
    expect(opaqueResult).toMatchObject({ x: 1, y: 0, w: 1, h: 1 });
  });

  it("uses alpha tolerance when selecting matching colors across the whole image", () => {
    const image = makeImageData(3, 1, [
      [20, 30, 40, 100],
      [20, 30, 40, 108],
      [20, 30, 40, 120],
    ]);

    const result = magicWandMask(image, 0, 0, 8, false);
    expect(result).not.toBeNull();
    expect(alphaAt(result!.data, image.width, 0, 0)).toBe(255);
    expect(alphaAt(result!.data, image.width, 1, 0)).toBe(255);
    expect(alphaAt(result!.data, image.width, 2, 0)).toBe(0);
    expect(result).toMatchObject({ x: 0, y: 0, w: 2, h: 1 });
  });
});
