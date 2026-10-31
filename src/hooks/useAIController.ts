import { useCallback, useState } from "react";
import { PaintDocument } from "../core/PaintDocument";
import {
  AIMode,
  GuideShape,
  Selection,
  WorkStage,
} from "../types";
import { useAIAnalysisController } from "./ai/useAIAnalysisController";
import { useAIChallengeScoring } from "./ai/useAIChallengeScoring";
import { useAIComparisonController } from "./ai/useAIComparisonController";
import { useAIImagePayloads } from "./ai/useAIImagePayloads";
import { useAIPaletteExtraction } from "./ai/useAIPaletteExtraction";
import { useAIApiKeyState } from "./ai/useAIApiKeyState";
import { useAIReferences } from "./ai/useAIReferences";
import { useAITabUiStatePatch } from "./ai/useAITabUiStatePatch";
import { pushToast } from "../ui/primitives";
import { Tab, TabStore } from "./useTabs";

interface UseAIControllerOptions {
  isChatLoading: () => boolean;
  activeTab: Tab | null;
  tabStore: TabStore;
  doc: PaintDocument | null;
  selection: Selection;
  enhancedAIEnabled: boolean;
}

export function useAIController({
  isChatLoading,
  activeTab,
  tabStore,
  doc,
  selection,
  enhancedAIEnabled,
}: UseAIControllerOptions) {
  const [aiPrompt, setAIPrompt] = useState("");
  const [aiMode, setAIMode] = useState<AIMode>("general");
  const [stage, setStage] = useState<WorkStage>("rough");
  const [zoomTarget, setZoomTarget] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingTabId, setLoadingTabId] = useState<string | null>(null);
  const [isChallengeScoring, setIsChallengeScoring] = useState(false);
  const [advice, setAdvice] = useState("");
  const [error, setError] = useState("");
  const [guides, setGuides] = useState<GuideShape[]>([]);
  const [showGuides, setShowGuides] = useState(true);
  const [palette, setPalette] = useState<string[]>([]);

  const previousSnapshotRef = useAIImagePayloads(activeTab);
  const activeTabId = activeTab?.id ?? null;

  const { hasApiKey, setApiKey, clearApiKey } = useAIApiKeyState({
    setError,
  });
  const {
    references,
    canAddReference,
    handleAddReference,
    handleRemoveReference,
  } = useAIReferences({ setError });
  const applyTabUiStatePatch = useAITabUiStatePatch({
    tabStore,
    setAdvice,
    setError,
    setGuides,
    setShowGuides,
    setPalette,
  });

  const handleAnalyze = useAIAnalysisController({
    activeTabId,
    doc,
    selection,
    hasApiKey,
    aiMode,
    aiPrompt,
    stage,
    references,
    zoomTarget,
    enhancedAIEnabled,
    previousSnapshotRef,
    setIsLoading,
    setLoadingTabId,
    applyTabUiStatePatch,
  });

  const handleLocalPalette = useAIPaletteExtraction({
    doc,
    setPalette,
  });

  const handleCompare = useAIComparisonController({
    activeTabId,
    doc,
    hasApiKey,
    previousSnapshotRef,
    setIsLoading,
    setLoadingTabId,
    applyTabUiStatePatch,
  });

  const handleScoreChallenge = useAIChallengeScoring({
    activeTabId,
    doc,
    hasApiKey,
    setIsChallengeScoring,
    applyTabUiStatePatch,
  });

  const guardedAnalyze = useCallback(async () => {
    if (isChatLoading()) {
      pushToast("チャット送信完了までお待ちください");
      return;
    }
    await handleAnalyze();
  }, [isChatLoading, handleAnalyze]);
  const guardedCompare = useCallback(async () => {
    if (isChatLoading()) {
      pushToast("チャット送信完了までお待ちください");
      return;
    }
    await handleCompare();
  }, [isChatLoading, handleCompare]);
  const guardedScoreChallenge = useCallback<typeof handleScoreChallenge>(async (input) => {
    if (isChatLoading()) throw new Error("チャット送信完了までお待ちください");
    return handleScoreChallenge(input);
  }, [isChatLoading, handleScoreChallenge]);

  return {
    hasApiKey,
    setApiKey,
    clearApiKey,
    aiPrompt,
    setAIPrompt,
    aiMode,
    setAIMode,
    stage,
    setStage,
    references,
    canAddReference,
    zoomTarget,
    setZoomTarget,
    isLoading,
    isLoadingInAnotherTab: isLoading && loadingTabId !== null && loadingTabId !== activeTabId,
    isChallengeScoring,
    advice,
    setAdvice,
    error,
    setError,
    guides,
    setGuides,
    showGuides,
    setShowGuides,
    palette,
    setPalette,
    hasPreviousSnapshot: !!previousSnapshotRef.current,
    handleAddReference,
    handleRemoveReference,
    handleAnalyze: guardedAnalyze,
    handleLocalPalette,
    handleCompare: guardedCompare,
    handleScoreChallenge: guardedScoreChallenge,
  };
}

export type AIController = ReturnType<typeof useAIController>;
