import { describe, expect, it } from "vitest";
import {
  computeSelectionTransform,
  identitySelectionTransform,
  transformSelectionGeometry,
  transformedRectBounds,
  transformPoint,
  translateSelection,
} from "../../src/core/selectionTransform";
import type { Selection } from "../../src/types";

describe("selectionTransform", () => {
  it("computes move transforms from drag delta", () => {
    const box = { x: 10, y: 20, w: 30, h: 40 };
    const transform = computeSelectionTransform(
      "move",
      box,
      { x: 12, y: 24 },
      { x: 22, y: 14 }
    );

    expect(transform.translateX).toBe(10);
    expect(transform.translateY).toBe(-10);
    expect(transformPoint({ x: 10, y: 20 }, transform)).toEqual({
      x: 20,
      y: 10,
    });
  });

  it("scales uniformly around the selection center", () => {
    const box = { x: 0, y: 0, w: 20, h: 20 };
    const transform = computeSelectionTransform(
      "scale",
      box,
      { x: 20, y: 10 },
      { x: 30, y: 10 }
    );

    expect(transform.scaleX).toBeCloseTo(2);
    expect(transform.scaleY).toBeCloseTo(2);
    expect(transformedRectBounds(box, transform)).toEqual({
      x: -10,
      y: -10,
      w: 40,
      h: 40,
    });
  });

  it("rotates around the selection center", () => {
    const box = { x: 0, y: 0, w: 20, h: 20 };
    const transform = computeSelectionTransform(
      "rotate",
      box,
      { x: 20, y: 10 },
      { x: 10, y: 20 }
    );

    expect(transform.rotation).toBeCloseTo(Math.PI / 2);
    expect(transformPoint({ x: 20, y: 10 }, transform)).toEqual({
      x: 10,
      y: 20,
    });
  });

  it("translates polygon selections without changing their shape", () => {
    const selection: Selection = {
      kind: "polygon",
      points: [
        { x: 1, y: 2 },
        { x: 5, y: 2 },
        { x: 3, y: 6 },
      ],
      x: 1,
      y: 2,
      w: 4,
      h: 4,
    };

    expect(translateSelection(selection, 10, -1)).toEqual({
      kind: "polygon",
      points: [
        { x: 11, y: 1 },
        { x: 15, y: 1 },
        { x: 13, y: 5 },
      ],
      x: 11,
      y: 1,
      w: 4,
      h: 4,
    });
  });

  it("updates rectangular selection bounds after scale and rotation", () => {
    const selection: Selection = { kind: "rect", x: 10, y: 20, w: 12, h: 8 };

    const scaled = transformSelectionGeometry(selection, {
      ...identitySelectionTransform(selection),
      scaleX: 2,
      scaleY: 2,
    });
    expect(scaled).toEqual({ kind: "rect", x: 4, y: 16, w: 24, h: 16 });

    const rotated = transformSelectionGeometry(selection, {
      ...identitySelectionTransform(selection),
      rotation: Math.PI / 2,
    });
    expect(rotated).toMatchObject({ kind: "rect" });
    expect(rotated.x).toBeCloseTo(12);
    expect(rotated.y).toBeCloseTo(18);
    expect(rotated.w).toBeCloseTo(8);
    expect(rotated.h).toBeCloseTo(12);
  });

  it("updates polygon points and mask bounds through selection transforms", () => {
    const transform = {
      ...identitySelectionTransform({ x: 0, y: 0, w: 10, h: 10 }),
      scaleX: 2,
      scaleY: 1,
      rotation: Math.PI / 2,
    };
    const polygon: Selection = {
      kind: "polygon",
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 0, y: 10 },
      ],
      x: 0,
      y: 0,
      w: 10,
      h: 10,
    };

    const transformedPolygon = transformSelectionGeometry(polygon, transform);
    expect(transformedPolygon.kind).toBe("polygon");
    if (transformedPolygon.kind === "polygon") {
      expect(transformedPolygon.points[0].x).toBeCloseTo(10);
      expect(transformedPolygon.points[0].y).toBeCloseTo(-5);
      expect(transformedPolygon.points[1].x).toBeCloseTo(10);
      expect(transformedPolygon.points[1].y).toBeCloseTo(15);
      expect(transformedPolygon.points[2].x).toBeCloseTo(0);
      expect(transformedPolygon.points[2].y).toBeCloseTo(-5);
    }
    expect(transformedPolygon.x).toBeCloseTo(0);
    expect(transformedPolygon.y).toBeCloseTo(-5);
    expect(transformedPolygon.w).toBeCloseTo(10);
    expect(transformedPolygon.h).toBeCloseTo(20);

    const mask: Selection = {
      kind: "mask",
      data: new Uint8ClampedArray(2 * 2 * 4),
      maskWidth: 2,
      maskHeight: 2,
      x: 4,
      y: 6,
      w: 2,
      h: 2,
    };
    const transformedMask = transformSelectionGeometry(mask, {
      ...identitySelectionTransform(mask),
      scaleX: 3,
      scaleY: 2,
    });
    expect(transformedMask).toMatchObject({
      kind: "mask",
      x: 2,
      y: 5,
      w: 6,
      h: 4,
      maskWidth: 2,
      maskHeight: 2,
    });
  });
});
