import { useCallback, useMemo } from "react";
import type { AppPanelsAIState } from "../../components/panels/types";
import { pushToast } from "../../ui/primitives";
import type { AIController } from "../useAIController";
import type { AppCanvasViewState } from "../useCanvasViewState";
import type { ToolState } from "../useToolState";

interface UseAIPanelModelParams {
  ai: AIController;
  anyChatLoading: boolean;
  selection: AppCanvasViewState["selection"];
  setHighlightGuide: AppCanvasViewState["setHighlightGuide"];
  setColor: ToolState["setColor"];
}

export function useAIPanelModel({
  ai,
  anyChatLoading,
  selection,
  setHighlightGuide,
  setColor,
}: UseAIPanelModelParams): AppPanelsAIState {
  const {
    hasApiKey,
    aiPrompt,
    setAIPrompt,
    aiMode,
    setAIMode,
    stage,
    setStage,
    references,
    canAddReference,
    handleAddReference,
    handleRemoveReference,
    zoomTarget,
    setZoomTarget,
    handleAnalyze,
    handleLocalPalette,
    handleCompare,
    hasPreviousSnapshot,
    isLoading,
    isLoadingInAnotherTab,
    advice,
    error,
    guides,
    showGuides,
    setShowGuides,
    setGuides,
    palette,
  } = ai;

  const handleUsePaletteColor = useCallback((nextColor: string) => {
    setColor(nextColor);
    pushToast(`色を設定: ${nextColor}`, "success");
  }, [setColor]);

  const handleClearGuides = useCallback(() => {
    setGuides([]);
  }, [setGuides]);

  return useMemo<AppPanelsAIState>(
    () => ({
      auth: {
        hasApiKey,
      },
      input: {
        aiPrompt,
        setAIPrompt,
        aiMode,
        setAIMode,
        stage,
        setStage,
        references,
        canAddReference,
        onAddReference: handleAddReference,
        onRemoveReference: handleRemoveReference,
      },
      target: {
        selection,
        zoomTarget,
        setZoomTarget,
      },
      actions: {
        onAnalyze: handleAnalyze,
        onLocalPalette: handleLocalPalette,
        onCompare: handleCompare,
        hasPreviousSnapshot,
        anyChatLoading,
      },
      output: {
        isLoading,
        isLoadingInAnotherTab,
        advice,
        error,
        guides,
        showGuides,
        setShowGuides,
        onClearGuides: handleClearGuides,
        onHighlightGuide: setHighlightGuide,
        palette,
        onUsePaletteColor: handleUsePaletteColor,
      },
    }),
    [
      anyChatLoading,
      advice,
      aiMode,
      aiPrompt,
      canAddReference,
      error,
      guides,
      handleAddReference,
      handleAnalyze,
      handleClearGuides,
      handleCompare,
      handleLocalPalette,
      handleRemoveReference,
      handleUsePaletteColor,
      hasApiKey,
      hasPreviousSnapshot,
      isLoading,
      isLoadingInAnotherTab,
      palette,
      references,
      selection,
      setAIMode,
      setAIPrompt,
      setHighlightGuide,
      setShowGuides,
      setStage,
      setZoomTarget,
      showGuides,
      stage,
      zoomTarget,
    ]
  );
}
