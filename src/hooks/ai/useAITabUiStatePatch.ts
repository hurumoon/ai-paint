import { useCallback } from "react";
import { GuideShape } from "../../types";
import { TabStore, TabUiStatePatch } from "../useTabs";

interface UseAITabUiStatePatchOptions {
  tabStore: TabStore;
  setAdvice: (advice: string) => void;
  setError: (error: string) => void;
  setGuides: (guides: GuideShape[]) => void;
  setShowGuides: (showGuides: boolean) => void;
  setPalette: (palette: string[]) => void;
}

export function useAITabUiStatePatch({
  tabStore,
  setAdvice,
  setError,
  setGuides,
  setShowGuides,
  setPalette,
}: UseAITabUiStatePatchOptions) {
  return useCallback((
    targetTabId: string | null,
    patch: TabUiStatePatch
  ): boolean => {
    if (!targetTabId) return false;
    if (tabStore.activeTabId !== targetTabId) {
      return tabStore.patchTabUiState(targetTabId, patch);
    }
    if (patch.advice !== undefined) setAdvice(patch.advice);
    if (patch.error !== undefined) setError(patch.error);
    if (patch.guides !== undefined) setGuides(patch.guides);
    if (patch.showGuides !== undefined) setShowGuides(patch.showGuides);
    if (patch.palette !== undefined) setPalette(patch.palette);
    return true;
  }, [
    setAdvice,
    setError,
    setGuides,
    setPalette,
    setShowGuides,
    tabStore,
  ]);
}
