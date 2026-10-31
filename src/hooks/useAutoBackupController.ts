import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import {
  AutoBackupRunner,
  type AutoBackupRunnerEvent,
  type BackupEntry,
  type BackupEntryMetadata,
  deleteAllBackups as deleteAllStoredBackups,
  deleteBackup as deleteStoredBackup,
  deleteBackups as deleteStoredBackups,
  listBackups,
  normalizeAutoBackupIntervalSec,
  restoreBackup,
} from "../core/autoBackup";
import {
  canStartAutoBackup,
  checkBackupActionGate,
  type BackupActionGateDecision,
  type BackupChangeAction,
} from "../core/backupActionGate";
import { safeGetStorageItem, safeSetStorageItem } from "../core/safeStorage";
import { pushToast } from "../ui/primitives";
import {
  tabHasUnsavedChanges,
  type Tab,
  type TabStore,
} from "./useTabs";

const BACKUP_INTERVAL_STORAGE = "ai-paint-backup-interval";
const BACKUP_ENABLED_STORAGE = "ai-paint-backup-enabled";

interface BackupVersionToken {
  historyVersion: number;
  documentVersion: number;
}

interface BackupError {
  tabId: string;
  message: string;
}

export type ActiveTabBackupState =
  | "clean"
  | "pending"
  | "paused"
  | "saving"
  | "protected"
  | "error";

export interface ActiveTabBackupStatus {
  state: ActiveTabBackupState;
  lastBackupAt: number | null;
  size: number | null;
  message: string | null;
}

interface UseAutoBackupControllerOptions {
  tabStore: TabStore;
  activeTab: Tab | null;
  savingRef: MutableRefObject<boolean>;
  paintBusyRef: MutableRefObject<boolean>;
  aiLoading: boolean;
  chatLoading: boolean;
  anyDialogOpen: boolean;
  isFileLoading: () => boolean;
  stashAndAddTab: (w?: number, h?: number, dpi?: number) => Tab;
  runnerRef: MutableRefObject<AutoBackupRunner | null>;
}

function tabLabel(tab: Tab): string {
  return tab.fileName ?? `名称未設定${tab.untitledIndex}`;
}

function tabNeedsBackup(tab: Tab, entries: BackupEntry[]): boolean {
  const historyVersion = tab.history.getSnapshot();
  const documentVersion = tab.doc.getSnapshot();
  if (
    historyVersion !== tab.lastBackupVersion ||
    documentVersion !== tab.lastBackupDocumentVersion
  ) {
    return true;
  }
  if (!tabHasUnsavedChanges(tab)) return false;
  return !entries.some(
    (entry) =>
      entry.documentId === tab.id &&
      entry.historyVersion === historyVersion &&
      entry.documentVersion === documentVersion
  );
}

export function useAutoBackupController({
  tabStore,
  activeTab,
  savingRef,
  paintBusyRef,
  aiLoading,
  chatLoading,
  anyDialogOpen,
  isFileLoading,
  stashAndAddTab,
  runnerRef,
}: UseAutoBackupControllerOptions) {
  const [backupIntervalSec, setBackupIntervalSec] = useState(() => {
    const value = safeGetStorageItem(BACKUP_INTERVAL_STORAGE);
    return normalizeAutoBackupIntervalSec(value);
  });
  const [backupEnabled, setBackupEnabled] = useState(() => {
    return safeGetStorageItem(BACKUP_ENABLED_STORAGE) !== "0";
  });
  const [entries, setEntries] = useState<BackupEntry[]>([]);
  const [savingTabId, setSavingTabId] = useState<string | null>(null);
  const [backupError, setBackupError] = useState<BackupError | null>(null);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const lastErrorToastAtRef = useRef(0);
  const runtimeBusyRef = useRef({ aiLoading, chatLoading, anyDialogOpen });
  runtimeBusyRef.current = { aiLoading, chatLoading, anyDialogOpen };

  const refreshBackupState = useCallback(async (): Promise<BackupEntry[]> => {
    const nextEntries = await listBackups();
    setEntries(nextEntries);
    return nextEntries;
  }, []);

  const handleRunnerEvent = useCallback(
    (event: AutoBackupRunnerEvent) => {
      if (event.type === "saving") {
        setSavingTabId(event.targetId);
        return;
      }
      setSavingTabId(null);
      if (event.type === "saved") {
        setBackupError((current) =>
          current?.tabId === event.targetId ? null : current
        );
        void refreshBackupState();
        return;
      }

      console.warn("auto backup failed:", event.failure.detail);
      setBackupError({
        tabId: event.targetId,
        message: event.failure.message,
      });
      const now = Date.now();
      if (
        event.source === "auto" &&
        now - lastErrorToastAtRef.current >= 60_000
      ) {
        lastErrorToastAtRef.current = now;
        pushToast(event.failure.message, "error");
      }
    },
    [refreshBackupState]
  );

  const runner = useMemo(
    () =>
      new AutoBackupRunner(
        () => {
          const tab = tabStore.getActiveTab();
          if (!tab) return null;
          return {
            id: tab.id,
            doc: tab.doc,
            isDirty: () => tabNeedsBackup(tab, entriesRef.current),
            beforeSave: (): BackupVersionToken => ({
              historyVersion: tab.history.getSnapshot(),
              documentVersion: tab.doc.getSnapshot(),
            }),
            metadata: (token): BackupEntryMetadata => {
              const version = token as BackupVersionToken;
              return {
                documentId: tab.id,
                fileName: tabLabel(tab),
                historyVersion: version.historyVersion,
                documentVersion: version.documentVersion,
              };
            },
            onSaved: (_entry: BackupEntry, token: unknown) => {
              const version = token as BackupVersionToken;
              tab.lastBackupVersion = version.historyVersion;
              tab.lastBackupDocumentVersion = version.documentVersion;
            },
          };
        },
        () =>
          canStartAutoBackup({
            saving: savingRef.current,
            fileLoading: isFileLoading(),
            painting: paintBusyRef.current,
            aiLoading: runtimeBusyRef.current.aiLoading,
            chatLoading: runtimeBusyRef.current.chatLoading,
          }),
        undefined,
        handleRunnerEvent
      ),
    [handleRunnerEvent, isFileLoading, paintBusyRef, savingRef, tabStore]
  );
  runnerRef.current = runner;

  const backupEnabledRef = useRef(backupEnabled);
  const blockedRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  backupEnabledRef.current = backupEnabled;

  const runPendingWithRetry = useCallback(
    async function runPendingWithRetry(): Promise<void> {
      // ダイアログ内の操作を優先し、表示中は自動保存を開始しない。
      // 手動保存はバックアップパネル自体がダイアログなので、この判定の対象外。
      if (runtimeBusyRef.current.anyDialogOpen) return;
      const result = await runner.runPending();
      const currentTab = tabStore.getActiveTab();
      if (
        result.blocked &&
        backupEnabledRef.current &&
        currentTab !== null &&
        tabNeedsBackup(currentTab, entriesRef.current) &&
        blockedRetryTimerRef.current === null
      ) {
        blockedRetryTimerRef.current = setTimeout(() => {
          blockedRetryTimerRef.current = null;
          void runPendingWithRetry();
        }, 500);
      }
    },
    [runner, tabStore]
  );

  useEffect(() => {
    safeSetStorageItem(BACKUP_INTERVAL_STORAGE, String(backupIntervalSec));
  }, [backupIntervalSec]);

  useEffect(() => {
    safeSetStorageItem(BACKUP_ENABLED_STORAGE, backupEnabled ? "1" : "0");
    if (!backupEnabled && blockedRetryTimerRef.current) {
      clearTimeout(blockedRetryTimerRef.current);
      blockedRetryTimerRef.current = null;
    }
  }, [backupEnabled]);

  useEffect(() => {
    void refreshBackupState();
  }, [refreshBackupState]);

  useEffect(() => {
    if (!backupEnabled) return;
    const timer = setInterval(() => {
      void runPendingWithRetry();
    }, backupIntervalSec * 1000);
    return () => clearInterval(timer);
  }, [backupEnabled, backupIntervalSec, runPendingWithRetry]);

  useEffect(() => {
    if (!backupEnabled || activeTab === null || anyDialogOpen) return;
    void runPendingWithRetry();
  }, [activeTab, anyDialogOpen, backupEnabled, runPendingWithRetry]);

  useEffect(
    () => () => {
      if (blockedRetryTimerRef.current) {
        clearTimeout(blockedRetryTimerRef.current);
      }
    },
    []
  );

  const latestActiveEntry =
    activeTab === null
      ? null
      : (entries.find((entry) => entry.documentId === activeTab.id) ?? null);

  let activeStatus: ActiveTabBackupStatus | null = null;
  if (activeTab !== null) {
    const needsBackup = tabNeedsBackup(activeTab, entries);
    if (savingTabId === activeTab.id) {
      activeStatus = {
        state: "saving",
        lastBackupAt: latestActiveEntry?.createdAt ?? null,
        size: latestActiveEntry?.size ?? null,
        message: "アクティブタブのバックアップを保存中です",
      };
    } else if (backupError?.tabId === activeTab.id) {
      activeStatus = {
        state: "error",
        lastBackupAt: latestActiveEntry?.createdAt ?? null,
        size: latestActiveEntry?.size ?? null,
        message: backupError.message,
      };
    } else if (needsBackup) {
      activeStatus = {
        state: backupEnabled ? "pending" : "paused",
        lastBackupAt: latestActiveEntry?.createdAt ?? null,
        size: latestActiveEntry?.size ?? null,
        message: backupEnabled
          ? "アクティブタブはバックアップ待機中です"
          : "自動バックアップが停止中です",
      };
    } else if (latestActiveEntry) {
      activeStatus = {
        state: "protected",
        lastBackupAt: latestActiveEntry.createdAt,
        size: latestActiveEntry.size,
        message: null,
      };
    } else {
      activeStatus = {
        state: "clean",
        lastBackupAt: null,
        size: null,
        message: null,
      };
    }
  }

  const saveNow = useCallback(async (): Promise<BackupEntry> => {
    const entry = await runner.saveNow();
    await refreshBackupState();
    return entry;
  }, [refreshBackupState, runner]);

  const isOperationBusy = useCallback(
    () => runner.isOperationBusy(),
    [runner]
  );

  const getBackupActionGate = useCallback(
    (action: BackupChangeAction): BackupActionGateDecision =>
      checkBackupActionGate(action, {
        hasActiveTab: tabStore.getActiveTab() !== null,
        saving: savingRef.current,
        fileLoading: isFileLoading(),
        painting: paintBusyRef.current,
        aiLoading: runtimeBusyRef.current.aiLoading,
        chatLoading: runtimeBusyRef.current.chatLoading,
        operationBusy: runner.isOperationBusy(),
      }),
    [isFileLoading, paintBusyRef, runner, savingRef, tabStore]
  );

  const requireBackupAction = useCallback(
    (action: BackupChangeAction): void => {
      const decision = getBackupActionGate(action);
      if (!decision.allowed) throw new Error(decision.message);
    },
    [getBackupActionGate]
  );

  const restoreIntoActiveTab = useCallback(
    async (entry: BackupEntry): Promise<void> => {
      requireBackupAction("restore-current");
      await runner.runMutation(async () => {
        const tab = tabStore.getActiveTab();
        if (!tab) throw new Error("復元先のタブがありません");
        await restoreBackup(entry, tab.doc);
        tab.history.clear();
        tab.lastBackupVersion = tab.history.getSnapshot();
        tab.lastBackupDocumentVersion = tab.doc.getSnapshot();
      });
      setBackupError(null);
    },
    [requireBackupAction, runner, tabStore]
  );

  const openBackupInNewTab = useCallback(
    async (entry: BackupEntry): Promise<Tab> => {
      requireBackupAction("restore-new-tab");
      const tab = await runner.runMutation(async () => {
        const nextTab = stashAndAddTab(entry.width, entry.height);
        try {
          await restoreBackup(entry, nextTab.doc);
          nextTab.history.clear();
          tabStore.updateTab(nextTab.id, {
            fileName: entry.fileName
              ? `${entry.fileName}（復元）`
              : "バックアップ復元",
            filePath: null,
          });
          return nextTab;
        } catch (error) {
          tabStore.closeTab(nextTab.id);
          throw error;
        }
      });
      if (backupEnabledRef.current) void runPendingWithRetry();
      return tab;
    },
    [
      requireBackupAction,
      runPendingWithRetry,
      runner,
      stashAndAddTab,
      tabStore,
    ]
  );

  const deleteBackupEntry = useCallback(
    async (id: string): Promise<BackupEntry[]> => {
      requireBackupAction("delete");
      return runner.runMutation(async () => {
        await deleteStoredBackup(id);
        return refreshBackupState();
      });
    },
    [refreshBackupState, requireBackupAction, runner]
  );

  const deleteBackupEntries = useCallback(
    async (ids: string[]): Promise<BackupEntry[]> => {
      requireBackupAction("delete");
      const uniqueIds = [...new Set(ids)];
      return runner.runMutation(async () => {
        await deleteStoredBackups(uniqueIds);
        return refreshBackupState();
      });
    },
    [refreshBackupState, requireBackupAction, runner]
  );

  const deleteAllBackupEntries = useCallback(
    async (): Promise<BackupEntry[]> => {
      requireBackupAction("delete");
      return runner.runMutation(async () => {
        await deleteAllStoredBackups();
        return refreshBackupState();
      });
    },
    [refreshBackupState, requireBackupAction, runner]
  );

  return {
    backupIntervalSec,
    setBackupIntervalSec,
    backupEnabled,
    setBackupEnabled,
    autoBackupRunnerRef: runnerRef,
    isOperationBusy,
    getBackupActionGate,
    activeTab,
    activeStatus,
    entries,
    saveNow,
    refreshBackupState,
    restoreIntoActiveTab,
    openBackupInNewTab,
    deleteBackupEntry,
    deleteBackupEntries,
    deleteAllBackupEntries,
  };
}

export type AutoBackupController = ReturnType<typeof useAutoBackupController>;
