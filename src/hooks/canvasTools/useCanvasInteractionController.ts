import type { MutableRefObject, PointerEvent, RefObject } from "react";
import type { CanvasRenderer } from "../../core/CanvasRenderer";
import type {
  CanvasDocumentIO,
  CanvasDocumentState,
  CanvasOverlayState,
  CanvasToolState,
  CanvasViewState,
} from "../../components/canvas/types";
import { useCanvasInputRouter } from "../useCanvasInputRouter";
import { useCanvasOverlayPreviewController } from "./useCanvasOverlayPreviewController";
import { useCanvasPointerPosition } from "./useCanvasPointerPosition";
import { useCanvasToolSessions } from "./useCanvasToolSessions";
import { useTextLayerDrawingGuard } from "./useTextLayerDrawingGuard";

interface CanvasInteractionRefs {
  compositeRef: RefObject<HTMLCanvasElement>;
  overlayRef: RefObject<HTMLCanvasElement>;
  inputRef: RefObject<HTMLCanvasElement>;
  previewRef: RefObject<HTMLCanvasElement>;
  rendererRef: MutableRefObject<CanvasRenderer | null>;
}

interface CanvasViewportHandlers {
  shouldStartPan: (event: PointerEvent<Element>) => boolean;
  handleViewportPointerDown: (event: PointerEvent<Element>) => void;
  handleViewportPointerUp: (event: PointerEvent<Element>) => void;
  isPanning: () => boolean;
}

interface UseCanvasInteractionControllerParams {
  documentState: CanvasDocumentState;
  toolState: CanvasToolState;
  viewState: CanvasViewState;
  overlayState: CanvasOverlayState;
  documentIO: CanvasDocumentIO;
  refs: CanvasInteractionRefs;
  viewport: CanvasViewportHandlers;
}

export function useCanvasInteractionController({
  documentState,
  toolState,
  viewState,
  overlayState,
  documentIO,
  refs,
  viewport,
}: UseCanvasInteractionControllerParams) {
  // ストローク状態。親が渡した paintBusyRef を共有して、保存処理など外部からも
  // 「いま描画中か」を同期的に観測できるようにする。
  const isDrawingRef = documentIO.paintBusyRef;
  const { doc } = documentState;

  const overlayPreview = useCanvasOverlayPreviewController({
    overlayRef: refs.overlayRef,
    previewRef: refs.previewRef,
    rendererRef: refs.rendererRef,
    width: doc.width,
    height: doc.height,
    overlayState,
    grid: viewState.grid,
    selection: toolState.selection,
    isDrawingRef,
    tool: toolState.tool,
    brushSize: toolState.brushSize,
  });

  const { getPos } = useCanvasPointerPosition({
    inputRef: refs.inputRef,
    docWidth: doc.width,
    docHeight: doc.height,
    zoom: viewState.zoom,
    rotation: viewState.rotation,
    canvasFlipped: viewState.canvasFlipped,
  });

  const toolSessions = useCanvasToolSessions({
    documentState,
    toolState,
    documentIO,
    refs: {
      compositeRef: refs.compositeRef,
      previewRef: refs.previewRef,
      rendererRef: refs.rendererRef,
    },
    overlayPreview,
    isDrawingRef,
    zoom: viewState.zoom,
  });

  const guardTextLayerDrawing = useTextLayerDrawingGuard(doc);

  return useCanvasInputRouter({
    tool: toolState.tool,
    moveMode: toolState.moveMode,
    isDrawingRef,
    cursorPosRef: overlayPreview.cursorPosRef,
    getPos,
    shouldStartPan: viewport.shouldStartPan,
    handleViewportPointerDown: viewport.handleViewportPointerDown,
    handleViewportPointerUp: viewport.handleViewportPointerUp,
    isPanning: viewport.isPanning,
    isAIProcessingBusy: documentIO.isAIProcessingBusy,
    requestOverlayRedraw: overlayPreview.requestOverlayRedraw,
    guardTextLayerDrawing,
    ...toolSessions,
    clearPreview: overlayPreview.clearPreview,
  });
}
