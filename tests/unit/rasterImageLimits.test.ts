import { describe, expect, it } from "vitest";
import {
  MAX_RASTER_IMAGE_DIMENSION,
  assertRasterImageDimensions,
} from "../../src/core/rasterImageLimits";

describe("raster image limits", () => {
  it("allows normal images up to 16384px on each edge", () => {
    expect(() =>
      assertRasterImageDimensions({
        width: MAX_RASTER_IMAGE_DIMENSION,
        height: MAX_RASTER_IMAGE_DIMENSION,
      })
    ).not.toThrow();
  });

  it("rejects normal images over 16384px on either edge", () => {
    expect(() =>
      assertRasterImageDimensions({
        width: MAX_RASTER_IMAGE_DIMENSION + 1,
        height: 100,
      })
    ).toThrow("画像のサイズが大きすぎます");

    expect(() =>
      assertRasterImageDimensions({
        width: 100,
        height: MAX_RASTER_IMAGE_DIMENSION + 1,
      })
    ).toThrow("画像のサイズが大きすぎます");
  });
});
