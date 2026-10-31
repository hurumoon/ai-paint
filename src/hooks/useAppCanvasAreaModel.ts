import { useCallback, useMemo } from "react";
import type { AppCanvasAreaProps } from "../components/AppCanvasArea";
import type {
  CanvasExtendPreview,
  ChallengeItem,
  ShortcutMap,
  TextLayerData,
} from "../types";
import type { AppActionControllers } from "./useAppActionControllers";
import type { ActiveTabDocumentState } from "./useActiveTabDocument";
import type { AIController } from "./useAIController";
import { useAppCanvasModel } from "./useAppCanvasModel";
import type { AppDialogsController } from "./useAppDialogs";
import type { AppCanvasViewState } from "./useCanvasViewState";
import type { EnhancedAISettings } from "./useEnhancedAISettings";
import type { CanvasToolProps, ToolState } from "./useToolState";

interface UseAppCanvasAreaModelParams {
  agentBusy?: boolean;
  hasActiveTab: boolean;
  activeDocument: ActiveTabDocumentState;
  canvasToolProps: CanvasToolProps;
  viewState: AppCanvasViewState;
  shortcuts: ShortcutMap;
  dialogs: AppDialogsController;
  aiSettings: EnhancedAISettings;
  challengeItems: ChallengeItem[];
  defaultTextStyle: TextLayerData;
  canvasExtendPreview: CanvasExtendPreview | null;
  ai: AIController;
  actions: AppActionControllers;
  toolState: ToolState;
}

export function useAppCanvasAreaModel({
  agentBusy = false,
  hasActiveTab,
  activeDocument,
  canvasToolProps,
  viewState,
  shortcuts,
  dialogs,
  aiSettings,
  challengeItems,
  defaultTextStyle,
  canvasExtendPreview,
  ai,
  actions,
  toolState,
}: UseAppCanvasAreaModelParams): AppCanvasAreaProps {
  const { doc, history, timelapse, version } = activeDocument;
  const {
    zoom,
    setZoom,
    pan,
    setPan,
    rotation,
    canvasFlipped,
    showSubview,
    setShowSubview,
    showReference,
    setShowReference,
    grid,
    highlightGuide,
  } = viewState;
  const { showDrawingGuide, setShowDrawingGuide } = dialogs;
  const { enhancedAIEnabled, aiGuideDisplayMode } = aiSettings;
  const {
    guides,
    showGuides,
    hasApiKey,
    isChallengeScoring,
    handleScoreChallenge,
  } = ai;
  const { fileActions, newCanvasActions, textLayerActions, autoBackup } = actions;
  const { handleOpenImage, paintBusyRef, isFileLoading } = fileActions;
  const { handleOpenNewCanvasDialog } = newCanvasActions;
  const { handleTextLayerCreated } = textLayerActions;
  const { color, setColor } = toolState;

  const handleCloseDrawingGuide = useCallback(() => {
    setShowDrawingGuide(false);
  }, [setShowDrawingGuide]);
  const handleCloseSubview = useCallback(() => {
    setShowSubview(false);
  }, [setShowSubview]);
  const handleCloseReference = useCallback(() => {
    setShowReference(false);
  }, [setShowReference]);

  const canvasModel = useAppCanvasModel({
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
    onTextLayerCreated: handleTextLayerCreated,
    paintBusyRef,
    aiBusy: ai.isLoading || ai.isChallengeScoring || agentBusy,
    autoBackupRunnerRef: autoBackup.autoBackupRunnerRef,
  });

  return useMemo<AppCanvasAreaProps>(
    () => ({
      ...canvasModel,
      hasActiveTab,
      canvasToolProps,
      showDrawingGuide,
      onCloseDrawingGuide: handleCloseDrawingGuide,
      showSubview,
      onCloseSubview: handleCloseSubview,
      showReference,
      onCloseReference: handleCloseReference,
      enhancedAIEnabled,
      canScoreChallenge: Boolean(hasApiKey && doc),
      isChallengeScoring,
      onScoreChallenge: handleScoreChallenge,
      challengeItems,
      onOpenNewCanvasDialog: handleOpenNewCanvasDialog,
      onOpenImage: handleOpenImage,
    }),
    [
      canvasModel,
      canvasToolProps,
      challengeItems,
      doc,
      enhancedAIEnabled,
      handleCloseDrawingGuide,
      handleCloseReference,
      handleCloseSubview,
      handleOpenImage,
      handleOpenNewCanvasDialog,
      handleScoreChallenge,
      hasActiveTab,
      hasApiKey,
      isChallengeScoring,
      showDrawingGuide,
      showReference,
      showSubview,
    ]
  );
}
