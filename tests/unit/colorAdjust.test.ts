import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyAdjustment,
  buildCurveLUT,
  buildLevelsLUT,
  blendWithMask,
  luminanceHistogram,
} from "../../src/core/colorAdjust";

class TestImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;

  constructor(data: Uint8ClampedArray, width: number, height: number) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
}

function imageData(pixels: number[], width = 2, height = 1): ImageData {
  return new ImageData(new Uint8ClampedArray(pixels), width, height);
}

function pixels(data: ImageData): number[] {
  return Array.from(data.data);
}

describe("color adjustment pixel transforms", () => {
  beforeEach(() => {
    vi.stubGlobal("ImageData", TestImageData);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("applies quick filters without mutating transparent pixels or the source", () => {
    const source = imageData([10, 20, 30, 255, 200, 210, 220, 0]);
    const inverted = applyAdjustment(source, { kind: "invert" });

    expect(pixels(inverted)).toEqual([245, 235, 225, 255, 200, 210, 220, 0]);
    expect(pixels(source)).toEqual([10, 20, 30, 255, 200, 210, 220, 0]);
  });

  it("uses LUT adjustments and builds histograms from visible pixels only", () => {
    const source = imageData([10, 20, 30, 255, 200, 210, 220, 0]);
    const lutR = buildCurveLUT([
      { x: 0, y: 255 },
      { x: 255, y: 0 },
    ]);
    const lutG = buildLevelsLUT(0, 1, 255, 10, 20);
    const lutB = buildLevelsLUT(0, 1, 255, 30, 40);

    const adjusted = applyAdjustment(source, {
      kind: "curves",
      lutR,
      lutG,
      lutB,
    });
    const histogram = luminanceHistogram(source);

    expect(pixels(adjusted)).toEqual([245, 11, 31, 255, 200, 210, 220, 0]);
    expect(histogram.reduce((sum, count) => sum + count, 0)).toBe(1);
  });

  it("blends transformed pixels back through a partial selection mask", () => {
    const original = imageData([0, 0, 0, 255, 100, 100, 100, 255]);
    const transformed = imageData([200, 0, 0, 255, 200, 200, 200, 255]);

    const result = blendWithMask(
      original,
      transformed,
      new Uint8Array([0, 128])
    );

    expect(pixels(result)).toEqual([0, 0, 0, 255, 150, 150, 150, 255]);
  });
});
