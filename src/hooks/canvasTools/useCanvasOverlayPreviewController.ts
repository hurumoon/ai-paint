import { useCallback, useRef } from "react";
import type { MutableRefObject, RefObject } from "react";
import type { CanvasRenderer } from "../../core/CanvasRenderer";
import type {
  CanvasOverlayState,
  CanvasViewState,
} from "../../components/canvas/types";
import type { Selection, Tool } from "../../types";
import { useCanvasOverlayRenderer } from "../useCanvasOverlayRenderer";

interface Point {
  x: number;
  y: number;
}

interface UseCanvasOverlayPreviewControllerParams {
  overlayRef: RefObject<HTMLCanvasElement | null>;
  previewRef: RefObject<HTMLCanvasElement | null>;
  rendererRef: MutableRefObject<CanvasRenderer | null>;
  width: number;
  height: number;
  overlayState: CanvasOverlayState;
  grid: CanvasViewState["grid"];
  selection: Selection;
  isDrawingRef: MutableRefObject<boolean>;
  tool: Tool;
  brushSize: number;
}

export interface CanvasOverlayPreviewController {
  cursorPosRef: MutableRefObject<Point | null>;
  polygonPointsRef: MutableRefObject<Point[]>;
  polygonHoverRef: MutableRefObject<Point | null>;
  requestOverlayRedraw: () => void;
  clearPreview: () => void;
}

export function useCanvasOverlayPreviewController({
  overlayRef,
  previewRef,
  rendererRef,
  width,
  height,
  overlayState: {
    guides,
    showGuides,
    aiGuideDisplayMode,
    highlightGuide,
  },
  grid,
  selection,
  isDrawingRef,
  tool,
  brushSize,
}: UseCanvasOverlayPreviewControllerParams): CanvasOverlayPreviewController {
  // ブラシ/消しゴム/ぼかしのホバープレビュー (キャンバス座標)。
  // ストローク中は描画を抑制するため null にする。ref で持ち、overlay 再描画ループから読む。
  const cursorPosRef = useRef<Point | null>(null);
  const polygonPointsRef = useRef<Point[]>([]);
  const polygonHoverRef = useRef<Point | null>(null);

  const requestOverlayRedraw = useCanvasOverlayRenderer({
    overlayRef,
    width,
    height,
    guides,
    showGuides,
    aiGuideDisplayMode,
    highlightGuide,
    selection,
    grid,
    polygonPointsRef,
    polygonHoverRef,
    cursorPosRef,
    isDrawingRef,
    tool,
    brushSize,
  });

  const clearPreview = useCallback(() => {
    const c = previewRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    rendererRef.current?.invalidate();
  }, [previewRef, rendererRef]);

  return {
    cursorPosRef,
    polygonPointsRef,
    polygonHoverRef,
    requestOverlayRedraw,
    clearPreview,
  };
}
