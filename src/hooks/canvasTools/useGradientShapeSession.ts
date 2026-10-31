import { useCallback, useRef } from "react";
import type { MutableRefObject, RefObject } from "react";
import type { CanvasRenderer } from "../../core/CanvasRenderer";
import type { History } from "../../core/History";
import type { PaintDocument } from "../../core/PaintDocument";
import type { Timelapse } from "../../core/Timelapse";
import { applyPresetToCanvasGradient } from "../../core/gradientPresets";
import {
  applyGradient,
  commitShape,
  drawShape,
  ShapeParams,
} from "../../core/toolHandlers";
import { pushToast } from "../../ui/primitives";
import type {
  GradientKind,
  GradientPreset,
  Selection,
  ShapeKind,
  Tool,
} from "../../types";

interface Point {
  x: number;
  y: number;
}

interface UseGradientShapeSessionParams {
  doc: PaintDocument;
  history: History;
  timelapse: Timelapse;
  selection: Selection;
  tool: Tool;
  color: string;
  secondaryColor: string;
  gradientKind: GradientKind;
  gradientToTransparent: boolean;
  gradientPreset: GradientPreset;
  shapeKind: ShapeKind;
  shapeFill: boolean;
  shapeStroke: boolean;
  shapeStrokeWidth: number;
  previewRef: RefObject<HTMLCanvasElement | null>;
  rendererRef: MutableRefObject<CanvasRenderer | null>;
  clearPreview: () => void;
  isAutoBackupBusy?: () => boolean;
}

export function useGradientShapeSession({
  doc,
  history,
  timelapse,
  selection,
  tool,
  color,
  secondaryColor,
  gradientKind,
  gradientToTransparent,
  gradientPreset,
  shapeKind,
  shapeFill,
  shapeStroke,
  shapeStrokeWidth,
  previewRef,
  rendererRef,
  clearPreview,
  isAutoBackupBusy,
}: UseGradientShapeSessionParams) {
  const dragStartRef = useRef<Point | null>(null);
  const dragLastRef = useRef<Point | null>(null);

  const startGradientShapeSession = useCallback(
    (pos: Point): boolean => {
      if (tool !== "gradient" && tool !== "shape") return false;
      if (isAutoBackupBusy?.()) {
        pushToast("自動バックアップ中です。少し待ってから再操作してください", "info");
        return true;
      }
      dragStartRef.current = pos;
      dragLastRef.current = pos;
      return true;
    },
    [isAutoBackupBusy, tool]
  );

  const updateGradientShapeSession = useCallback(
    (pos: Point): boolean => {
      const start = dragStartRef.current;
      if (!start) return false;

      if (tool === "gradient") {
        dragLastRef.current = pos;
        drawGradientPreview(
          previewRef.current,
          doc.width,
          doc.height,
          gradientKind,
          start,
          pos,
          color,
          gradientToTransparent ? color : secondaryColor,
          gradientToTransparent,
          gradientPreset
        );
        rendererRef.current?.invalidate();
        return true;
      }

      if (tool === "shape") {
        dragLastRef.current = pos;
        drawShapePreview(previewRef.current, doc.width, doc.height, {
          kind: shapeKind,
          x1: start.x,
          y1: start.y,
          x2: pos.x,
          y2: pos.y,
          color,
          strokeColor: secondaryColor,
          strokeWidth: shapeStrokeWidth,
          fill: shapeFill,
          stroke: shapeStroke,
        });
        rendererRef.current?.invalidate();
        return true;
      }

      return false;
    },
    [
      color,
      doc.height,
      doc.width,
      gradientKind,
      gradientPreset,
      gradientToTransparent,
      previewRef,
      rendererRef,
      secondaryColor,
      shapeFill,
      shapeKind,
      shapeStroke,
      shapeStrokeWidth,
      tool,
    ]
  );

  const finishGradientShapeSession = useCallback(async (): Promise<boolean> => {
    const from = dragStartRef.current;
    const to = dragLastRef.current;
    if (!from || !to) return false;

    if (tool === "gradient") {
      try {
        await applyGradient(
          doc,
          history,
          timelapse,
          gradientKind,
          { x: from.x, y: from.y, color, alpha: 1 },
          {
            x: to.x,
            y: to.y,
            color: gradientToTransparent ? color : secondaryColor,
            alpha: gradientToTransparent ? 0 : 1,
          },
          selection,
          gradientPreset
        );
      } catch (err) {
        pushToast(`グラデーション失敗: ${err}`, "error");
      }
      clearPreview();
      dragStartRef.current = null;
      dragLastRef.current = null;
      return true;
    }

    if (tool === "shape") {
      await commitShape(
        doc,
        history,
        timelapse,
        {
          kind: shapeKind,
          x1: from.x,
          y1: from.y,
          x2: to.x,
          y2: to.y,
          color,
          strokeColor: secondaryColor,
          strokeWidth: shapeStrokeWidth,
          fill: shapeFill,
          stroke: shapeStroke,
        },
        selection
      );
      clearPreview();
      dragStartRef.current = null;
      dragLastRef.current = null;
      return true;
    }

    return false;
  }, [
    clearPreview,
    color,
    doc,
    gradientKind,
    gradientPreset,
    gradientToTransparent,
    history,
    secondaryColor,
    selection,
    shapeFill,
    shapeKind,
    shapeStroke,
    shapeStrokeWidth,
    timelapse,
    tool,
  ]);

  const cancelGradientShapeSession = useCallback((): void => {
    dragStartRef.current = null;
    dragLastRef.current = null;
    clearPreview();
  }, [clearPreview]);

  return {
    startGradientShapeSession,
    updateGradientShapeSession,
    finishGradientShapeSession,
    cancelGradientShapeSession,
  };
}

function drawGradientPreview(
  preview: HTMLCanvasElement | null,
  width: number,
  height: number,
  kind: GradientKind,
  from: Point,
  to: Point,
  fromColor: string,
  toColor: string,
  toTransparent: boolean,
  preset: GradientPreset
): void {
  if (!preview) return;
  const ctx = preview.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);
  let grad: CanvasGradient;
  if (kind === "linear") {
    grad = ctx.createLinearGradient(from.x, from.y, to.x, to.y);
  } else {
    const r = Math.hypot(to.x - from.x, to.y - from.y);
    grad = ctx.createRadialGradient(from.x, from.y, 0, from.x, from.y, r);
  }
  applyPresetToCanvasGradient(grad, preset, fromColor, toColor, toTransparent);
  ctx.save();
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.restore();
}

function drawShapePreview(
  preview: HTMLCanvasElement | null,
  width: number,
  height: number,
  params: ShapeParams
): void {
  if (!preview) return;
  const ctx = preview.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);
  ctx.globalAlpha = 0.85;
  drawShape(ctx, params);
}
