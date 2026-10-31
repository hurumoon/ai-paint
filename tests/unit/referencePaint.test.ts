import { describe, expect, it, vi } from "vitest";
import { buildReferencePaintPlan, meanAbsoluteError, opaqueReference, referenceStrokeBatches, validateReferenceSize } from "../../src/core/referencePainting/plan";
import type { ReferenceStroke } from "../../src/core/referencePainting/types";

describe("reference painting input boundaries", () => {
  it("flattens transparent references onto the same white background used for comparison", () => {
    const input = new Uint8ClampedArray([0, 0, 0, 0, 255, 0, 0, 128]);
    expect([...opaqueReference(input)]).toEqual([255, 255, 255, 255, 255, 127, 127, 255]);
    expect(input[3]).toBe(0);
    expect(meanAbsoluteError(new Uint8ClampedArray([0, 0, 0, 255]), new Uint8ClampedArray([255, 255, 255, 255]))).toBe(255);
    expect(() => meanAbsoluteError(new Uint8ClampedArray(3), new Uint8ClampedArray(3))).toThrow();
  });

  it("rejects invalid dimensions before reading or painting a surface", () => {
    const surface = { draw: vi.fn(), read: vi.fn() };
    for (const [w, h, size] of [[0, 2, 0], [769, 1, 3076], [768, 768, 768 * 768 * 4], [4, 4, 63], [1.5, 2, 12]]) {
      expect(() => buildReferencePaintPlan(w, h, new Uint8ClampedArray(size), surface)).toThrow();
    }
    expect(surface.draw).not.toHaveBeenCalled();
    expect(surface.read).not.toHaveBeenCalled();
    expect(() => validateReferenceSize(600, 500, 600 * 500 * 4)).not.toThrow();
  });

  it("keeps drawing order while respecting the API point and stroke budgets", () => {
    const single: ReferenceStroke = { points: [{ x: 1, y: 1, pressure: 1 }], settings: { kind: "round", color: "#000000", size: 1, opacity: 1 } };
    const inputs = Array.from({ length: 1100 }, () => single);
    const batches = referenceStrokeBatches(inputs);
    expect(batches.map(batch => batch.length)).toEqual([1024, 76]);
    const long = { ...single, points: Array.from({ length: 10000 }, () => single.points[0]) };
    const mixed = [long, single, long, long, long, single];
    const pointBatches = referenceStrokeBatches(mixed);
    expect(pointBatches.flat()).toEqual(mixed);
    expect(pointBatches).toHaveLength(2);
    expect(pointBatches.every(batch => batch.reduce((sum, item) => sum + item.points.length, 0) <= 32768)).toBe(true);
  });
});
