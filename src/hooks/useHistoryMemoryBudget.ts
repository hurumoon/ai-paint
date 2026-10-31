import { useEffect, useState } from "react";
import { safeGetStorageItem, safeSetStorageItem } from "../core/safeStorage";
import { TabStore } from "./useTabs";
import {
  DEFAULT_HISTORY_MEMORY_BUDGET,
  normalizeHistoryMemoryBudget,
} from "../core/historyMemory";

const HISTORY_MEMORY_STORAGE = "ai-paint-history-memory";

export function useHistoryMemoryBudget() {
  return useState<number>(() => {
    const value = safeGetStorageItem(HISTORY_MEMORY_STORAGE);
    return normalizeHistoryMemoryBudget(
      value ?? DEFAULT_HISTORY_MEMORY_BUDGET
    );
  });
}

export function useSyncHistoryMemoryBudget(
  historyMemoryBudget: number,
  tabStore: TabStore
): void {
  useEffect(() => {
    safeSetStorageItem(HISTORY_MEMORY_STORAGE, String(historyMemoryBudget));
    tabStore.setHistoryBudget(historyMemoryBudget);
  }, [historyMemoryBudget, tabStore]);
}
