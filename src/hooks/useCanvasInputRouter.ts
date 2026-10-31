import { useCallback, useEffect, useRef } from "react";
import type { MutableRefObject, PointerEvent } from "react";
import type { StrokePoint } from "../core/brushEngine";
import { pushToast } from "../ui/primitives";
import { toolShowsBrushHover } from "./useCanvasOverlayRenderer";
import { MoveMode, Tool } from "../types";

const AI_BUSY_CANVAS_EDIT_BLOCKED_MESSAGE = "AI処理完了までお待ちください";

export function canvasEditStartBlockedReason(
  isAIProcessingBusy?: () => boolean
): string | null {
  return isAIProcessingBusy?.() ? AI_BUSY_CANVAS_EDIT_BLOCKED_MESSAGE : null;
}

interface UseCanvasInputRouterParams {
  tool: Tool;
  moveMode: MoveMode;
  isDrawingRef: MutableRefObject<boolean>;
  cursorPosRef: MutableRefObject<{ x: number; y: number } | null>;
  getPos: (event: PointerEvent<HTMLCanvasElement>) => StrokePoint;
  shouldStartPan: (event: PointerEvent<Element>) => boolean;
  handleViewportPointerDown: (event: PointerEvent<Element>) => void;
  handleViewportPointerUp: (event: PointerEvent<Element>) => void;
  isPanning: () => boolean;
  isAIProcessingBusy?: () => boolean;
  requestOverlayRedraw: () => void;
  guardTextLayerDrawing: (tool: Tool) => boolean;
  handleUtilityToolAt: (pos: StrokePoint, tool: Tool) => boolean;
  startSelectionSession: (pos: StrokePoint, detail: number) => boolean;
  updateSelectionSession: (pos: StrokePoint) => boolean;
  finishSelectionSession: () => void;
  cancelSelectionSession: () => void;
  fillBucketAt: (pos: StrokePoint) => Promise<unknown>;
  applyBlurAtSelection: () => Promise<unknown>;
  startMoveLayerSession: (pos: StrokePoint, moveMode: MoveMode) => boolean;
  updateMoveLayerSession: (pos: StrokePoint) => boolean;
  finishMoveLayerSession: () => Promise<unknown>;
  cancelMoveLayerSession: () => void;
  startGradientShapeSession: (pos: StrokePoint) => boolean;
  updateGradientShapeSession: (pos: StrokePoint) => boolean;
  finishGradientShapeSession: () => Promise<unknown>;
  cancelGradientShapeSession: () => void;
  startBrushStroke: (pos: StrokePoint, tool: "brush" | "eraser") => void;
  continueBrushStroke: (pos: StrokePoint) => void;
  finishBrushStroke: (pos: StrokePoint | null) => Promise<unknown>;
  cancelBrushStroke: () => void;
  clearPreview: () => void;
}

export function useCanvasInputRouter({
  tool,
  moveMode,
  isDrawingRef,
  cursorPosRef,
  getPos,
  shouldStartPan,
  handleViewportPointerDown,
  handleViewportPointerUp,
  isPanning,
  isAIProcessingBusy,
  requestOverlayRedraw,
  guardTextLayerDrawing,
  handleUtilityToolAt,
  startSelectionSession,
  updateSelectionSession,
  finishSelectionSession,
  cancelSelectionSession,
  fillBucketAt,
  applyBlurAtSelection,
  startMoveLayerSession,
  updateMoveLayerSession,
  finishMoveLayerSession,
  cancelMoveLayerSession,
  startGradientShapeSession,
  updateGradientShapeSession,
  finishGradientShapeSession,
  cancelGradientShapeSession,
  startBrushStroke,
  continueBrushStroke,
  finishBrushStroke,
  cancelBrushStroke,
  clearPreview,
}: UseCanvasInputRouterParams) {
  const activePointerIdRef = useRef<number | null>(null);

  const handlePointerDown = useCallback(
    async (event: PointerEvent<HTMLCanvasElement>) => {
      if (activePointerIdRef.current !== null) return;
      if (event.pointerType === "touch" && !event.isPrimary) return;
      // Pan routing stays first so Space+drag, middle drag, and move/canvas mode
      // never fall through to drawing sessions.
      if (shouldStartPan(event)) {
        handleViewportPointerDown(event);
        return;
      }
      const blockedReason = canvasEditStartBlockedReason(isAIProcessingBusy);
      if (blockedReason) {
        pushToast(blockedReason, "info");
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      activePointerIdRef.current = event.pointerId;
      const pos = getPos(event);

      if (guardTextLayerDrawing(tool)) return;
      if (handleUtilityToolAt(pos, tool)) return;
      if (startSelectionSession(pos, event.detail)) return;

      if (tool === "bucket") {
        await fillBucketAt(pos);
        return;
      }
      if (tool === "blur") {
        await applyBlurAtSelection();
        return;
      }
      if (tool === "move" && moveMode !== "canvas") {
        startMoveLayerSession(pos, moveMode);
        return;
      }
      if (startGradientShapeSession(pos)) return;
      if (tool === "brush" || tool === "eraser") {
        startBrushStroke(pos, tool);
      }
    },
    [
      applyBlurAtSelection,
      fillBucketAt,
      getPos,
      guardTextLayerDrawing,
      handleUtilityToolAt,
      handleViewportPointerDown,
      isAIProcessingBusy,
      moveMode,
      shouldStartPan,
      startBrushStroke,
      startGradientShapeSession,
      startMoveLayerSession,
      startSelectionSession,
      tool,
    ]
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLCanvasElement>) => {
      if (isPanning()) return;
      const activePointerId = activePointerIdRef.current;
      if (activePointerId !== null && activePointerId !== event.pointerId) return;
      if (activePointerId === null && event.pointerType === "touch" && !event.isPrimary) return;
      const pos = getPos(event);

      if (toolShowsBrushHover(tool)) {
        cursorPosRef.current = { x: pos.x, y: pos.y };
        requestOverlayRedraw();
      }
      if (activePointerId === null) return;
      if (updateSelectionSession(pos)) return;
      if (updateGradientShapeSession(pos)) return;
      if (updateMoveLayerSession(pos)) return;

      continueBrushStroke(pos);
    },
    [
      continueBrushStroke,
      cursorPosRef,
      getPos,
      isPanning,
      requestOverlayRedraw,
      tool,
      updateGradientShapeSession,
      updateMoveLayerSession,
      updateSelectionSession,
    ]
  );

  const handlePointerUp = useCallback(
    async (event: PointerEvent<HTMLCanvasElement>) => {
      if (isPanning()) {
        handleViewportPointerUp(event);
        return;
      }
      if (activePointerIdRef.current !== event.pointerId) return;
      const target = event.currentTarget;
      const pos = getPos(event);
      try {
        await finishBrushStroke(pos);
        finishSelectionSession();
        await finishGradientShapeSession();
        await finishMoveLayerSession();
      } finally {
        activePointerIdRef.current = null;
        if (target.hasPointerCapture(event.pointerId)) {
          target.releasePointerCapture(event.pointerId);
        }
      }
    },
    [
      finishBrushStroke,
      finishGradientShapeSession,
      finishMoveLayerSession,
      finishSelectionSession,
      getPos,
      handleViewportPointerUp,
      isPanning,
    ]
  );

  const handlePointerLeave = useCallback(() => {
    if (isDrawingRef.current) return;
    if (cursorPosRef.current) {
      cursorPosRef.current = null;
      requestOverlayRedraw();
    }
  }, [cursorPosRef, isDrawingRef, requestOverlayRedraw]);

  const handlePointerCancel = useCallback((event: PointerEvent<HTMLCanvasElement>) => {
    if (activePointerIdRef.current !== event.pointerId) return;
    cancelBrushStroke();
    cancelSelectionSession();
    cancelGradientShapeSession();
    cancelMoveLayerSession();
    clearPreview();
    activePointerIdRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, [
    cancelBrushStroke,
    cancelGradientShapeSession,
    cancelMoveLayerSession,
    cancelSelectionSession,
    clearPreview,
  ]);

  useEffect(() => {
    if (!toolShowsBrushHover(tool) && cursorPosRef.current) {
      cursorPosRef.current = null;
      requestOverlayRedraw();
    }
  }, [cursorPosRef, requestOverlayRedraw, tool]);

  return {
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerLeave,
    handlePointerCancel,
  };
}
