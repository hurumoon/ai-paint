import { useCallback } from "react";
import type { PointerEvent, RefObject } from "react";
import type { StrokePoint } from "../../core/brushEngine";
import { canvasPointerToDocumentPoint } from "../../core/canvasPointer";

interface UseCanvasPointerPositionParams {
  inputRef: RefObject<HTMLCanvasElement | null>;
  docWidth: number;
  docHeight: number;
  zoom: number;
  rotation: number;
  canvasFlipped: boolean;
}

export function useCanvasPointerPosition({
  inputRef,
  docWidth,
  docHeight,
  zoom,
  rotation,
  canvasFlipped,
}: UseCanvasPointerPositionParams) {
  const getPos = useCallback(
    (event: PointerEvent<HTMLCanvasElement>): StrokePoint => {
      const canvas = inputRef.current ?? event.currentTarget;
      const rect = canvas.getBoundingClientRect();
      const point = canvasPointerToDocumentPoint({
        clientX: event.clientX,
        clientY: event.clientY,
        rectLeft: rect.left,
        rectTop: rect.top,
        rectWidth: rect.width,
        rectHeight: rect.height,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        docWidth,
        docHeight,
        zoom,
        rotation,
        flipped: canvasFlipped,
      });

      let pressure: number;
      if (event.pointerType === "pen") {
        // ペン: 触れた瞬間 0 になる端末があるので、その時だけ 0.5 にフォールバック
        pressure = event.pressure > 0 ? event.pressure : 0.5;
      } else if (event.pointerType === "touch") {
        pressure = event.pressure > 0 ? event.pressure : 0.5;
      } else {
        // マウス: 筆圧は使わない（固定値）
        pressure = 0.5;
      }

      return {
        x: point.x,
        y: point.y,
        pressure,
      };
    },
    [canvasFlipped, docHeight, docWidth, inputRef, rotation, zoom]
  );

  return { getPos };
}
