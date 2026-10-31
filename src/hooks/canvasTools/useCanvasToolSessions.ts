import type { MutableRefObject } from "react";
import type {
  CanvasDocumentIO,
  CanvasDocumentState,
  CanvasToolState,
} from "../../components/canvas/types";
import type {
  CanvasToolSessionOverlayPreview,
  CanvasToolSessionRefs,
} from "./canvasToolSessionTypes";
import { useCanvasBrushToolSessions } from "./useCanvasBrushToolSessions";
import { useCanvasPointToolActions } from "./useCanvasPointToolActions";
import { useCanvasPreviewToolSessions } from "./useCanvasPreviewToolSessions";
import { useCanvasRegionToolSessions } from "./useCanvasRegionToolSessions";

interface UseCanvasToolSessionsParams {
  documentState: CanvasDocumentState;
  toolState: CanvasToolState;
  documentIO: CanvasDocumentIO;
  refs: CanvasToolSessionRefs;
  overlayPreview: CanvasToolSessionOverlayPreview;
  isDrawingRef: MutableRefObject<boolean>;
  zoom: number;
}

export function useCanvasToolSessions({
  documentState,
  toolState,
  documentIO,
  refs,
  overlayPreview,
  isDrawingRef,
  zoom,
}: UseCanvasToolSessionsParams) {
  const pointToolActions = useCanvasPointToolActions({
    documentState,
    toolState,
    documentIO,
    compositeRef: refs.compositeRef,
  });

  const regionToolSessions = useCanvasRegionToolSessions({
    documentState,
    toolState,
    documentIO,
    compositeRef: refs.compositeRef,
    overlayPreview,
    zoom,
  });

  const previewToolSessions = useCanvasPreviewToolSessions({
    documentState,
    toolState,
    documentIO,
    refs,
    isDrawingRef,
    clearPreview: overlayPreview.clearPreview,
  });

  const brushToolSessions = useCanvasBrushToolSessions({
    documentState,
    toolState,
    documentIO,
    rendererRef: refs.rendererRef,
    isDrawingRef,
  });

  return {
    ...pointToolActions,
    ...regionToolSessions,
    ...previewToolSessions,
    ...brushToolSessions,
  };
}
