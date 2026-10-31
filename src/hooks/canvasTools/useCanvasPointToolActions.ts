import type { RefObject } from "react";
import type {
  CanvasDocumentIO,
  CanvasDocumentState,
  CanvasToolState,
} from "../../components/canvas/types";
import { useCanvasUtilityTools } from "./useCanvasUtilityTools";

interface UseCanvasPointToolActionsParams {
  documentState: Pick<CanvasDocumentState, "doc" | "history">;
  toolState: Pick<CanvasToolState, "eyedropperSampleAllLayers">;
  documentIO: Pick<
    CanvasDocumentIO,
    "onPickColor" | "defaultTextStyle" | "onTextLayerCreated" | "isAutoBackupBusy"
  >;
  compositeRef: RefObject<HTMLCanvasElement | null>;
}

export function useCanvasPointToolActions({
  documentState: { doc, history },
  toolState: { eyedropperSampleAllLayers },
  documentIO: {
    onPickColor,
    defaultTextStyle,
    onTextLayerCreated,
    isAutoBackupBusy,
  },
  compositeRef,
}: UseCanvasPointToolActionsParams) {
  return useCanvasUtilityTools({
    doc,
    history,
    compositeRef,
    eyedropperSampleAllLayers,
    defaultTextStyle,
    onPickColor,
    onTextLayerCreated,
    isAutoBackupBusy,
  });
}
