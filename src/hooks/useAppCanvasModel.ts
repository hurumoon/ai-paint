import {
  useCallback,
  useMemo,
  type MutableRefObject,
} from "react";
import type {
  AppCanvasDocumentState,
  AppCanvasModel,
} from "../components/AppCanvasArea";
import type {
  CanvasDocumentIO,
  CanvasOverlayState,
  CanvasViewState,
} from "../components/canvas/types";
import type { GridConfig } from "../components/GridSettings";
import type { AutoBackupRunner } from "../core/autoBackup";
import { pushToast } from "../ui/primitives";
import type {
  AIGuideDisplayMode,
  CanvasExtendPreview,
  GuideShape,
  ShortcutMap,
  TextLayerData,
} from "../types";

interface UseAppCanvasModelParams {
  doc: AppCanvasDocumentState["doc"];
  history: AppCanvasDocumentState["history"];
  timelapse: AppCanvasDocumentState["timelapse"];
  version: AppCanvasDocumentState["version"];
  zoom: CanvasViewState["zoom"];
  setZoom: CanvasViewState["setZoom"];
  pan: CanvasViewState["pan"];
  setPan: CanvasViewState["setPan"];
  rotation: CanvasViewState["rotation"];
  canvasFlipped: CanvasViewState["canvasFlipped"];
  grid: GridConfig;
  shortcuts: ShortcutMap;
  isFileLoading: CanvasViewState["isFileLoading"];
  guides: GuideShape[];
  showGuides: boolean;
  aiGuideDisplayMode: AIGuideDisplayMode;
  highlightGuide: GuideShape | null;
  canvasExtendPreview: CanvasExtendPreview | null;
  defaultTextStyle: TextLayerData;
  color: string;
  setColor: (color: string) => void;
  onTextLayerCreated: CanvasDocumentIO["onTextLayerCreated"];
  paintBusyRef: CanvasDocumentIO["paintBusyRef"];
  aiBusy: boolean;
  autoBackupRunnerRef: MutableRefObject<AutoBackupRunner | null>;
}

export function useAppCanvasModel({
  doc,
  history,
  timelapse,
  version,
  zoom,
  setZoom,
  pan,
  setPan,
  rotation,
  canvasFlipped,
  grid,
  shortcuts,
  isFileLoading,
  guides,
  showGuides,
  aiGuideDisplayMode,
  highlightGuide,
  canvasExtendPreview,
  defaultTextStyle,
  color,
  setColor,
  onTextLayerCreated,
  paintBusyRef,
  aiBusy,
  autoBackupRunnerRef,
}: UseAppCanvasModelParams): AppCanvasModel {
  const onPickColor = useCallback((nextColor: string) => {
    setColor(nextColor);
    pushToast(`色をピック: ${nextColor}`, "success");
  }, [setColor]);

  const canvasDefaultTextStyle = useMemo<TextLayerData>(
    () => ({ ...defaultTextStyle, color }),
    [color, defaultTextStyle]
  );

  const isAutoBackupBusy = useCallback(
    () => autoBackupRunnerRef.current?.isOperationBusy() ?? false,
    [autoBackupRunnerRef]
  );
  const isAIProcessingBusy = useCallback(() => aiBusy, [aiBusy]);

  const canvasDocument = useMemo<AppCanvasDocumentState>(
    () => ({ doc, history, timelapse, version }),
    [doc, history, timelapse, version]
  );

  const canvasViewState = useMemo<CanvasViewState>(
    () => ({
      zoom,
      setZoom,
      pan,
      setPan,
      rotation,
      canvasFlipped,
      grid,
      shortcuts,
      isFileLoading,
    }),
    [canvasFlipped, grid, isFileLoading, pan, rotation, setPan, setZoom, shortcuts, zoom]
  );

  const canvasOverlayState = useMemo<CanvasOverlayState>(
    () => ({
      guides,
      showGuides,
      aiGuideDisplayMode,
      highlightGuide,
      canvasExtendPreview,
    }),
    [aiGuideDisplayMode, canvasExtendPreview, guides, highlightGuide, showGuides]
  );

  const canvasDocumentIO = useMemo<CanvasDocumentIO>(
    () => ({
      onPickColor,
      defaultTextStyle: canvasDefaultTextStyle,
      onTextLayerCreated,
      paintBusyRef,
      isAIProcessingBusy,
      isAutoBackupBusy,
    }),
    [
      canvasDefaultTextStyle,
      isAIProcessingBusy,
      isAutoBackupBusy,
      onPickColor,
      onTextLayerCreated,
      paintBusyRef,
    ]
  );

  return useMemo<AppCanvasModel>(
    () => ({
      canvasDocument,
      canvasViewState,
      canvasOverlayState,
      canvasDocumentIO,
    }),
    [canvasDocument, canvasDocumentIO, canvasOverlayState, canvasViewState]
  );
}
