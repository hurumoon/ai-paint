import { afterEach, describe, expect, it, vi } from "vitest";
import { PaintDocument } from "../../src/core/PaintDocument";
import { MAX_RASTER_IMAGE_DIMENSION } from "../../src/core/rasterImageLimits";

describe("PaintDocument image limits", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects oversized images loaded as layers and closes the decoded bitmap", async () => {
    const close = vi.fn();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({
        width: MAX_RASTER_IMAGE_DIMENSION + 1,
        height: 100,
        close,
      }) as unknown as ImageBitmap)
    );

    const doc = new PaintDocument(100, 100, 1);

    await expect(doc.loadImageAsLayer(new Blob(), "large.png")).rejects.toThrow(
      "画像のサイズが大きすぎます"
    );
    expect(doc.layers).toHaveLength(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
