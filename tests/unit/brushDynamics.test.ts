import { describe, expect, it } from "vitest";
import type { BrushSettings, StrokePoint } from "../../src/core/brushEngine";
import {
  brushStrokeBounds,
  clamp01,
  effectiveOpacity,
  shapedPressure,
  stampSize,
  stampSpacing,
} from "../../src/core/brushDynamics";

function settings(overrides: Partial<BrushSettings> = {}): BrushSettings {
  return {
    kind: "round",
    size: 20,
    opacity: 0.8,
    color: "#000000",
    ...overrides,
  };
}

function point(pressure: number): StrokePoint {
  return { x: 0, y: 0, pressure };
}

describe("brush dynamics", () => {
  it("keeps brush spacing by brush kind", () => {
    expect(stampSpacing(settings({ kind: "round" }))).toBeCloseTo(3.6);
    expect(stampSpacing(settings({ kind: "airbrush" }))).toBe(1);
    expect(stampSpacing(settings({ kind: "dotted" }))).toBe(28);
    expect(stampSpacing(settings({ kind: "custom" }))).toBe(4);
    expect(stampSpacing(settings({ kind: "eraser-hard" }))).toBeCloseTo(4.4);
  });

  it("applies pressure sensitivity to size and opacity", () => {
    const pressurePoint = point(0.5);
    const pressureSettings = settings({
      pressureSize: 1,
      pressureOpacity: 1,
    });

    expect(shapedPressure(pressurePoint, pressureSettings)).toBe(0.5);
    expect(stampSize(pressurePoint, pressureSettings)).toBe(10);
    expect(effectiveOpacity(pressurePoint, pressureSettings)).toBe(0.4);
  });

  it("clamps pressure inputs and output floors", () => {
    const pressureSettings = settings({
      size: 8,
      opacity: 0.5,
      pressureSize: 1,
      pressureOpacity: 1,
    });

    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(stampSize(point(-1), pressureSettings)).toBe(0.5);
    expect(effectiveOpacity(point(2), pressureSettings)).toBe(0.5);
  });

  it("keeps brush dirty bounds in brush core", () => {
    expect(
      brushStrokeBounds(
        { x: 10, y: 20, pressure: 0.5 },
        { x: 30, y: 10, pressure: 0.5 },
        settings({ size: 20 })
      )
    ).toEqual({ x: -14, y: -14, w: 68, h: 58 });
  });

  it("expands dirty bounds enough for thick strokes that cross tile boundaries", () => {
    expect(
      brushStrokeBounds(
        { x: 252, y: 20, pressure: 0.5 },
        { x: 260, y: 20, pressure: 0.5 },
        settings({ size: 18 })
      )
    ).toEqual({ x: 230, y: -2, w: 52, h: 44 });
  });
});
