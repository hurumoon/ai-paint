import { describe, expect, it } from "vitest";
import { applyCurve, normalizeCurve } from "../../src/core/pressureCurve";

describe("pressureCurve", () => {
  it("interpolates between sorted control points", () => {
    expect(
      applyCurve(
        {
          points: [
            { x: 0, y: 0 },
            { x: 0.5, y: 1 },
            { x: 1, y: 0 },
          ],
        },
        0.25
      )
    ).toBe(0.5);
  });

  it("normalizes points into the 0..1 range and fills endpoints", () => {
    expect(
      normalizeCurve({
        points: [
          { x: 1.2, y: -1 },
          { x: 0.5, y: 2 },
        ],
      })
    ).toEqual({
      points: [
        { x: 0, y: 1 },
        { x: 0.5, y: 1 },
        { x: 1, y: 0 },
      ],
    });
  });
});
