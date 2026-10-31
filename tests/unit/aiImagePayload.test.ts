import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canCompareAIImagePayloads,
  canCropSelectionForAI,
  imageFileToBase64ForAI,
  type AIImagePayload,
} from "../../src/core/aiImagePayload";

function payload(overrides: Partial<AIImagePayload> = {}): AIImagePayload {
  return {
    base64: "image",
    width: 640,
    height: 480,
    scale: 1,
    ...overrides,
  };
}

describe("aiImagePayload", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("allows comparison when sent dimensions and scale match", () => {
    expect(
      canCompareAIImagePayloads(
        payload({ base64: "before" }),
        payload({ base64: "after" })
      )
    ).toBe(true);
  });

  it("rejects comparison when width, height, or scale changed", () => {
    expect(canCompareAIImagePayloads(payload(), payload({ width: 641 }))).toBe(false);
    expect(canCompareAIImagePayloads(payload(), payload({ height: 481 }))).toBe(false);
    expect(canCompareAIImagePayloads(payload(), payload({ scale: 0.5 }))).toBe(false);
  });

  it("allows AI crops for rectangular, polygon, and mask selections with usable bounds", () => {
    expect(canCropSelectionForAI({ kind: "none" })).toBe(false);
    expect(canCropSelectionForAI({ kind: "rect", x: 0, y: 0, w: 5, h: 5 })).toBe(true);
    expect(
      canCropSelectionForAI({
        kind: "polygon",
        points: [
          { x: 0, y: 0 },
          { x: 8, y: 0 },
          { x: 0, y: 8 },
        ],
        x: 0,
        y: 0,
        w: 8,
        h: 8,
      })
    ).toBe(true);
    expect(
      canCropSelectionForAI({
        kind: "mask",
        data: new Uint8ClampedArray(64),
        maskWidth: 4,
        maskHeight: 4,
        x: 0,
        y: 0,
        w: 8,
        h: 8,
      })
    ).toBe(true);
    expect(canCropSelectionForAI({ kind: "rect", x: 0, y: 0, w: 4, h: 8 })).toBe(false);
  });

  it("closes decoded file bitmaps when rejecting oversized reference images", async () => {
    const close = vi.fn();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 4096, height: 4097, close }) as unknown as ImageBitmap)
    );

    await expect(imageFileToBase64ForAI(new Blob(), undefined, 4096 * 4096))
      .rejects.toThrow("リファレンス画像の解像度が大きすぎます");
    expect(close).toHaveBeenCalledTimes(1);
  });
});
