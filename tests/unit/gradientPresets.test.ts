import { describe, expect, it } from "vitest";
import { buildPresetStops } from "../../src/core/gradientPresets";

describe("gradientPresets", () => {
  it("returns no worker stops for normal two-color gradients", () => {
    expect(buildPresetStops("two-color", 1, 0)).toBeUndefined();
  });

  it("builds rainbow stops with alpha interpolated by position", () => {
    const stops = buildPresetStops("rainbow", 1, 0);

    expect(stops).toHaveLength(7);
    expect(stops?.[0]).toEqual({ pos: 0, rgba: [255, 0, 0, 255] });
    expect(stops?.[3].rgba[3]).toBe(128);
    expect(stops?.[6]).toEqual({ pos: 1, rgba: [153, 0, 204, 0] });
  });
});
