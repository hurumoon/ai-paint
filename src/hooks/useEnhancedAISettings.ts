import { useEffect, useState } from "react";
import { LayoutConfig } from "../core/panelLayout";
import { safeGetStorageItem, safeSetStorageItem } from "../core/safeStorage";
import { AIGuideDisplayMode } from "../types";

const ENHANCED_AI_STORAGE = "ai-paint-enhanced-ai-enabled";
const AI_GUIDE_DISPLAY_STORAGE = "ai-paint-ai-guide-display-mode";

interface UseEnhancedAISettingsOptions {
  layout: LayoutConfig;
}

export function useEnhancedAISettings({
  layout,
}: UseEnhancedAISettingsOptions) {
  const [enhancedAIEnabled, setEnhancedAIEnabled] = useState(() => {
    return safeGetStorageItem(ENHANCED_AI_STORAGE) === "1";
  });
  const [aiGuideDisplayMode, setAIGuideDisplayMode] =
    useState<AIGuideDisplayMode>(() => {
      return safeGetStorageItem(AI_GUIDE_DISPLAY_STORAGE) === "pins"
        ? "pins"
        : "guides";
    });

  useEffect(() => {
    safeSetStorageItem(ENHANCED_AI_STORAGE, enhancedAIEnabled ? "1" : "0");
  }, [enhancedAIEnabled]);

  useEffect(() => {
    safeSetStorageItem(AI_GUIDE_DISPLAY_STORAGE, aiGuideDisplayMode);
  }, [aiGuideDisplayMode]);

  return {
    enhancedAIEnabled,
    setEnhancedAIEnabled,
    aiGuideDisplayMode,
    setAIGuideDisplayMode,
    visibleLayout: layout,
  };
}

export type EnhancedAISettings = ReturnType<typeof useEnhancedAISettings>;
