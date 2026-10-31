import type { RefObject } from "react";
import type {
  CanvasDocumentIO,
  CanvasDocumentState,
  CanvasToolState,
} from "../../components/canvas/types";
import { useBlurSession } from "./useBlurSession";
import { useBucketFillSession } from "./useBucketFillSession";
import type { CanvasToolSessionOverlayPreview } from "./canvasToolSessionTypes";
import { useSelectionSession } from "./useSelectionSession";

interface UseCanvasRegionToolSessionsParams {
  documentState: Pick<CanvasDocumentState, "doc" | "history" | "timelapse">;
  toolState: Pick<
    CanvasToolState,
    | "tool"
    | "color"
    | "blurRadius"
    | "bucketTolerance"
    | "bucketGapClose"
    | "bucketExpand"
    | "selectKind"
    | "magicTolerance"
    | "magicContiguous"
    | "magicSampleAllLayers"
    | "selection"
    | "setSelection"
  >;
  documentIO: Pick<CanvasDocumentIO, "isAutoBackupBusy">;
  compositeRef: RefObject<HTMLCanvasElement | null>;
  overlayPreview: Pick<
    CanvasToolSessionOverlayPreview,
    "polygonPointsRef" | "polygonHoverRef" | "requestOverlayRedraw"
  >;
  zoom: number;
}

export function useCanvasRegionToolSessions({
  documentState: { doc, history, timelapse },
  toolState: {
    tool,
    color,
    blurRadius,
    bucketTolerance,
    bucketGapClose,
    bucketExpand,
    selectKind,
    magicTolerance,
    magicContiguous,
    magicSampleAllLayers,
    selection,
    setSelection,
  },
  documentIO: { isAutoBackupBusy },
  compositeRef,
  overlayPreview: {
    polygonPointsRef,
    polygonHoverRef,
    requestOverlayRedraw,
  },
  zoom,
}: UseCanvasRegionToolSessionsParams) {
  const selectionSessions = useSelectionSession({
    doc,
    tool,
    selectKind,
    setSelection,
    zoom,
    magicTolerance,
    magicContiguous,
    magicSampleAllLayers,
    compositeRef,
    polygonPointsRef,
    polygonHoverRef,
    requestOverlayRedraw,
  });

  const bucketSession = useBucketFillSession({
    doc,
    history,
    timelapse,
    selection,
    color,
    bucketTolerance,
    bucketGapClose,
    bucketExpand,
    compositeRef,
    isAutoBackupBusy,
  });

  const blurSession = useBlurSession({
    doc,
    history,
    timelapse,
    selection,
    blurRadius,
    isAutoBackupBusy,
  });

  return {
    ...selectionSessions,
    ...bucketSession,
    ...blurSession,
  };
}
