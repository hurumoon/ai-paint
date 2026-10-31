import { describe, expect, it } from "vitest";
import { canvasPointerToDocumentPoint } from "../../src/core/canvasPointer";

function clientPointForLocalPoint({
  localX,
  localY,
  canvasWidth,
  canvasHeight,
  rectWidth,
  rectHeight,
  zoom,
  rotation,
  flipped = false,
}: {
  localX: number;
  localY: number;
  canvasWidth: number;
  canvasHeight: number;
  rectWidth: number;
  rectHeight: number;
  zoom: number;
  rotation: number;
  flipped?: boolean;
}) {
  const centeredX = (flipped ? canvasWidth - localX : localX) - canvasWidth / 2;
  const centeredY = localY - canvasHeight / 2;
  const rad = (rotation * Math.PI) / 180;
  const rx = centeredX * Math.cos(rad) - centeredY * Math.sin(rad);
  const ry = centeredX * Math.sin(rad) + centeredY * Math.cos(rad);
  return {
    clientX: 100 + rectWidth / 2 + rx * zoom,
    clientY: 200 + rectHeight / 2 + ry * zoom,
  };
}

describe("canvasPointerToDocumentPoint", () => {
  it("uses the unrotated canvas size for a non-square 90 degree rotation", () => {
    const canvasWidth = 320;
    const canvasHeight = 240;
    const localX = 280;
    const localY = 60;
    const point = clientPointForLocalPoint({
      localX,
      localY,
      canvasWidth,
      canvasHeight,
      rectWidth: canvasHeight,
      rectHeight: canvasWidth,
      zoom: 1,
      rotation: 90,
    });

    const result = canvasPointerToDocumentPoint({
      ...point,
      rectLeft: 100,
      rectTop: 200,
      rectWidth: canvasHeight,
      rectHeight: canvasWidth,
      canvasWidth,
      canvasHeight,
      docWidth: canvasWidth,
      docHeight: canvasHeight,
      zoom: 1,
      rotation: 90,
      flipped: false,
    });

    expect(result.x).toBeCloseTo(localX, 6);
    expect(result.y).toBeCloseTo(localY, 6);
  });

  it("unflips x after reversing rotation", () => {
    const canvasWidth = 320;
    const canvasHeight = 240;
    const localX = 40;
    const localY = 90;
    const point = clientPointForLocalPoint({
      localX,
      localY,
      canvasWidth,
      canvasHeight,
      rectWidth: canvasHeight * 1.5,
      rectHeight: canvasWidth * 1.5,
      zoom: 1.5,
      rotation: 90,
      flipped: true,
    });

    const result = canvasPointerToDocumentPoint({
      ...point,
      rectLeft: 100,
      rectTop: 200,
      rectWidth: canvasHeight * 1.5,
      rectHeight: canvasWidth * 1.5,
      canvasWidth,
      canvasHeight,
      docWidth: canvasWidth,
      docHeight: canvasHeight,
      zoom: 1.5,
      rotation: 90,
      flipped: true,
    });

    expect(result.x).toBeCloseTo(localX, 6);
    expect(result.y).toBeCloseTo(localY, 6);
  });
});
