import type { MutableRefObject } from "react";
import type {
  CanvasDocumentIO,
  CanvasDocumentState,
  CanvasToolState,
} from "../../components/canvas/types";
import type { CanvasToolSessionRefs } from "./canvasToolSessionTypes";
import { useGradientShapeSession } from "./useGradientShapeSession";
import { useMoveLayerSession } from "./useMoveLayerSession";

interface UseCanvasPreviewToolSessionsParams {
  documentState: Pick<CanvasDocumentState, "doc" | "history" | "timelapse">;
  toolState: Pick<
    CanvasToolState,
    | "tool"
    | "color"
    | "secondaryColor"
    | "gradientKind"
    | "gradientToTransparent"
    | "gradientPreset"
    | "shapeKind"
    | "shapeFill"
    | "shapeStroke"
    | "shapeStrokeWidth"
    | "selection"
    | "setSelection"
  >;
  documentIO: Pick<CanvasDocumentIO, "isAutoBackupBusy">;
  refs: Pick<CanvasToolSessionRefs, "previewRef" | "rendererRef">;
  isDrawingRef: MutableRefObject<boolean>;
  clearPreview: () => void;
}

export function useCanvasPreviewToolSessions({
  documentState: { doc, history, timelapse },
  toolState: {
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
    selection,
    setSelection,
  },
  documentIO: { isAutoBackupBusy },
  refs: {
    previewRef,
    rendererRef,
  },
  isDrawingRef,
  clearPreview,
}: UseCanvasPreviewToolSessionsParams) {
  const moveLayerSession = useMoveLayerSession({
    doc,
    history,
    timelapse,
    selection,
    setSelection,
    previewRef,
    rendererRef,
    isDrawingRef,
    clearPreview,
    isAutoBackupBusy,
  });

  const gradientShapeSession = useGradientShapeSession({
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
  });

  return {
    ...moveLayerSession,
    ...gradientShapeSession,
  };
}
