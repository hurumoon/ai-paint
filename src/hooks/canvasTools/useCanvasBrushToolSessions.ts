import type { MutableRefObject } from "react";
import type {
  CanvasDocumentIO,
  CanvasDocumentState,
  CanvasToolState,
} from "../../components/canvas/types";
import type { CanvasRenderer } from "../../core/CanvasRenderer";
import { useBrushStrokeSession } from "./useBrushStrokeSession";
import { useCanvasBrushSettings } from "./useCanvasBrushSettings";

interface UseCanvasBrushToolSessionsParams {
  documentState: Pick<CanvasDocumentState, "doc" | "history" | "timelapse">;
  toolState: Pick<
    CanvasToolState,
    | "brushKind"
    | "eraserKind"
    | "brushSize"
    | "brushOpacity"
    | "stabilizer"
    | "pressureSize"
    | "pressureOpacity"
    | "antiAliasStrength"
    | "pressureCurve"
    | "customBrushId"
    | "selection"
    | "color"
  >;
  documentIO: Pick<CanvasDocumentIO, "isAutoBackupBusy">;
  rendererRef: MutableRefObject<CanvasRenderer | null>;
  isDrawingRef: MutableRefObject<boolean>;
}

export function useCanvasBrushToolSessions({
  documentState: { doc, history, timelapse },
  toolState: {
    brushKind,
    eraserKind,
    brushSize,
    brushOpacity,
    stabilizer,
    pressureSize,
    pressureOpacity,
    antiAliasStrength,
    pressureCurve,
    customBrushId,
    selection,
    color,
  },
  documentIO: { isAutoBackupBusy },
  rendererRef,
  isDrawingRef,
}: UseCanvasBrushToolSessionsParams) {
  const brushSettingsFor = useCanvasBrushSettings({
    brushKind,
    eraserKind,
    brushSize,
    brushOpacity,
    color,
    pressureSize,
    pressureOpacity,
    pressureCurve,
    antiAliasStrength,
    customBrushId,
  });

  return useBrushStrokeSession({
    doc,
    history,
    timelapse,
    selection,
    stabilizer,
    isDrawingRef,
    rendererRef,
    brushSettingsFor,
    isAutoBackupBusy,
  });
}
