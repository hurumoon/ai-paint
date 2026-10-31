import { describe, expect, it } from "vitest";
import { compositeBlendPixel } from "../../src/core/blendModes";

describe("compositeBlendPixel", () => {
  it("applies subtract as backdrop minus source", () => {
    expect(
      compositeBlendPixel("subtract", [100, 150, 200, 255], [200, 60, 40, 255], 1)
    ).toEqual([0, 90, 160, 255]);
  });

  it("keeps source color over a transparent backdrop", () => {
    expect(
      compositeBlendPixel("subtract", [0, 0, 0, 0], [200, 60, 40, 255], 1)
    ).toEqual([200, 60, 40, 255]);
  });

  it("applies non-separable color and luminosity modes", () => {
    expect(
      compositeBlendPixel("color", [100, 150, 200, 255], [200, 60, 40, 255], 1)
    ).toEqual([241, 101, 81, 255]);
    expect(
      compositeBlendPixel("luminosity", [100, 150, 200, 255], [200, 60, 40, 255], 1)
    ).toEqual([59, 109, 159, 255]);
  });
});
