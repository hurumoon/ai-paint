import { useCallback, useRef } from "react";
import type { PaintDocument } from "../core/PaintDocument";
import type { Selection } from "../types";
import { useAIController } from "./useAIController";
import { useChatController } from "./useChatController";
import type { Tab, TabStore } from "./useTabs";

interface UseAppAIChatControllersOptions {
  activeTab: Tab | null;
  activeTabId: string | null;
  tabStore: TabStore;
  doc: PaintDocument | null;
  selection: Selection;
  enhancedAIEnabled: boolean;
}

export function useAppAIChatControllers({
  activeTab,
  activeTabId,
  tabStore,
  doc,
  selection,
  enhancedAIEnabled,
}: UseAppAIChatControllersOptions) {
  const chatLoadingRef = useRef(false);
  const isChatLoading = useCallback(() => chatLoadingRef.current, []);
  const ai = useAIController({
    isChatLoading,
    activeTab,
    tabStore,
    doc,
    selection,
    enhancedAIEnabled,
  });
  const chat = useChatController({
    activeTabId,
    tabStore,
    hasApiKey: ai.hasApiKey,
    doc,
    setGuides: ai.setGuides,
    setShowGuides: ai.setShowGuides,
    setPalette: ai.setPalette,
  });

  chatLoadingRef.current = chat.anyChatLoading;

  return { ai, chat };
}

export type AppAIChatControllers = ReturnType<typeof useAppAIChatControllers>;
