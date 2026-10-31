import { describe, expect, it } from "vitest";
import { StrokeStabilizer, type StrokePoint } from "../../src/core/brushEngine";

function point(x: number, y: number, pressure: number): StrokePoint {
  return { x, y, pressure };
}

describe("StrokeStabilizer", () => {
  it("returns raw points when the strength is effectively disabled", () => {
    const stabilizer = new StrokeStabilizer(0);

    expect(stabilizer.feed(point(10, 20, 0.25))).toEqual(point(10, 20, 0.25));
    expect(stabilizer.feed(point(30, 40, 0.75))).toEqual(point(30, 40, 0.75));
    expect(stabilizer.flush(point(50, 60, 1))).toEqual([point(50, 60, 1)]);
  });

  it("smooths points and flushes toward the target with clamped strength", () => {
    const stabilizer = new StrokeStabilizer(0.5);

    expect(stabilizer.feed(point(0, 0, 0.2))).toEqual(point(0, 0, 0.2));
    expect(stabilizer.feed(point(10, 20, 0.8))).toEqual(point(5, 10, 0.5));

    const flushed = stabilizer.flush(point(13, 18, 0.9), 2);
    expect(flushed).toEqual([
      point(9, 14, 0.7),
      point(11, 16, 0.8),
    ]);
  });

  it("resets the stored pen tip", () => {
    const stabilizer = new StrokeStabilizer(0.75);

    stabilizer.feed(point(0, 0, 0.1));
    stabilizer.feed(point(8, 8, 0.9));
    stabilizer.reset();

    expect(stabilizer.feed(point(4, 6, 0.3))).toEqual(point(4, 6, 0.3));
  });
});
