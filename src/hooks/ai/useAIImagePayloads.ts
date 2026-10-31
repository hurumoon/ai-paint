import { useMemo } from "react";
import type { AIImagePayload } from "../../core/aiImagePayload";
import { Tab } from "../useTabs";

export interface PreviousSnapshotRef {
  current: AIImagePayload | null;
}

export function useAIImagePayloads(activeTab: Tab | null): PreviousSnapshotRef {
  return useMemo(
    () => ({
      get current(): AIImagePayload | null {
        return activeTab?.previousSnapshot ?? null;
      },
      set current(value: AIImagePayload | null) {
        if (activeTab) activeTab.previousSnapshot = value;
      },
    }),
    [activeTab]
  );
}
