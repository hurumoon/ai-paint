import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type BackupEntry,
  MAX_BACKUPS,
  MAX_BACKUP_TOTAL_BYTES,
  formatBackupSaveError,
  selectOlderBackupIdsPerDocument,
} from "../core/autoBackup";
import type {
  ActiveTabBackupStatus,
  AutoBackupController,
} from "../hooks/useAutoBackupController";
import type { Tab } from "../hooks/useTabs";
import { Button, pushToast, Slider } from "../ui/primitives";

type BackupFilter = "current" | "all";

interface Props {
  open: boolean;
  onClose: () => void;
  controller: AutoBackupController;
}

function tabLabel(tab: Tab): string {
  return tab.fileName ?? `名称未設定${tab.untitledIndex}`;
}

function statusLabel(status: ActiveTabBackupStatus): string {
  switch (status.state) {
    case "saving":
      return "保存中…";
    case "pending":
      return "バックアップ待機中";
    case "paused":
      return "自動バックアップ停止中";
    case "protected":
      return status.lastBackupAt
        ? `バックアップ済み ${new Date(status.lastBackupAt).toLocaleTimeString()}`
        : "バックアップ済み";
    case "error":
      return "バックアップ失敗";
    case "clean":
      return "変更なし";
  }
}

export function BackupPanel({ open, onClose, controller }: Props) {
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<BackupFilter>("current");
  const entries = controller.entries;
  const activeTab = controller.activeTab;
  const refreshBackupState = controller.refreshBackupState;

  const refresh = useCallback(async () => {
    try {
      await refreshBackupState();
    } catch (error) {
      pushToast(`バックアップ一覧取得失敗: ${error}`, "error");
    }
  }, [refreshBackupState]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  const totalBytes = useMemo(
    () => entries.reduce((sum, entry) => sum + entry.size, 0),
    [entries]
  );
  const usageRatio =
    MAX_BACKUP_TOTAL_BYTES > 0 ? totalBytes / MAX_BACKUP_TOTAL_BYTES : 0;
  const usagePercent = Math.min(999, Math.round(usageRatio * 100));
  const usageWarning = usageRatio >= 0.85;

  const visibleEntries = useMemo(() => {
    if (filter === "current") {
      return activeTab
        ? entries.filter((entry) => entry.documentId === activeTab.id)
        : [];
    }
    return entries;
  }, [activeTab, entries, filter]);

  const groupedEntries = useMemo(() => {
    const groups = new Map<string, { label: string; entries: BackupEntry[] }>();
    for (const entry of visibleEntries) {
      const key = entry.documentId ?? "legacy";
      const current = groups.get(key);
      if (current) {
        current.entries.push(entry);
      } else {
        groups.set(key, {
          label: entry.fileName ?? "旧形式のバックアップ",
          entries: [entry],
        });
      }
    }
    return [...groups.entries()];
  }, [visibleEntries]);
  const deleteOlderLabel =
    filter === "all"
      ? "文書ごとの古いバックアップを削除"
      : "このタブの古いバックアップを削除";
  const olderBackupIds = useMemo(
    () => selectOlderBackupIdsPerDocument(visibleEntries),
    [visibleEntries]
  );

  if (!open) return null;

  const manualSave = async () => {
    if (!activeTab) return;
    setBusy(true);
    try {
      await controller.saveNow();
      pushToast("バックアップを作成しました", "success");
    } catch (error) {
      pushToast(formatBackupSaveError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const restore = async (entry: BackupEntry) => {
    const restoresCurrent = Boolean(
      activeTab && entry.documentId && entry.documentId === activeTab.id
    );
    if (
      restoresCurrent &&
      !confirm(
        `${new Date(entry.createdAt).toLocaleString()} の状態に復元します。現在の編集内容は破棄されます。続行しますか？`
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      if (restoresCurrent) {
        await controller.restoreIntoActiveTab(entry);
        pushToast("バックアップから復元しました", "success");
        onClose();
      } else {
        await controller.openBackupInNewTab(entry);
        pushToast("バックアップを新しいタブで開きました", "success");
        onClose();
      }
    } catch (error) {
      pushToast(`復元失敗: ${error}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (entry: BackupEntry) => {
    if (!confirm("このバックアップを削除しますか？")) return;
    setBusy(true);
    try {
      await controller.deleteBackupEntry(entry.id);
    } catch (error) {
      pushToast(`削除失敗: ${error}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const removeOlder = async () => {
    if (olderBackupIds.length === 0) return;
    const confirmation =
      filter === "all"
        ? "文書ごとに最新バックアップを1件ずつ残し、古いバックアップを削除しますか？文書を判別できない旧形式のバックアップは残します。"
        : "現在のタブの最新バックアップを1件残し、古いバックアップを削除しますか？";
    if (!confirm(confirmation)) return;
    setBusy(true);
    try {
      await controller.deleteBackupEntries(olderBackupIds);
      pushToast(
        filter === "all"
          ? "文書ごとの古いバックアップを削除しました"
          : "現在のタブの古いバックアップを削除しました",
        "success"
      );
    } catch (error) {
      pushToast(`削除失敗: ${error}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const removeAll = async () => {
    if (entries.length === 0) return;
    if (!confirm("すべてのバックアップを削除しますか？")) return;
    setBusy(true);
    try {
      await controller.deleteAllBackupEntries();
      pushToast("バックアップをすべて削除しました", "success");
    } catch (error) {
      pushToast(`削除失敗: ${error}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const activeStatus = controller.activeStatus;
  const deleteGate = controller.getBackupActionGate("delete");

  return (
    <>
      <div
        className="popover-backdrop"
        style={{ background: "rgba(0,0,0,0.4)" }}
        onClick={onClose}
      />
      <div
        className="popover"
        data-testid="backup-panel"
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          minWidth: 440,
          maxWidth: 560,
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderBottom: "1px solid var(--border)",
            paddingBottom: 8,
          }}
        >
          <strong style={{ fontSize: 13 }}>自動バックアップ</strong>
          <button className="btn ghost" onClick={onClose}>×</button>
        </div>

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            color: "var(--text-dim)",
          }}
        >
          <input
            type="checkbox"
            checked={controller.backupEnabled}
            onChange={(event) => controller.setBackupEnabled(event.target.checked)}
          />
          自動バックアップを有効にする
        </label>

        {activeTab && activeStatus && (
          <div
            data-testid="backup-current-tab-status"
            style={{
              border: "1px solid var(--border)",
              borderRadius: 4,
              padding: "7px 8px",
              display: "flex",
              justifyContent: "space-between",
              gap: 8,
              alignItems: "center",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis" }}>
                {tabLabel(activeTab)}
              </div>
              <div
                style={{
                  fontSize: 10,
                  color:
                    activeStatus.state === "error"
                      ? "#f0b35a"
                      : "var(--text-faint)",
                }}
              >
                {statusLabel(activeStatus)}
              </div>
            </div>
            <Button
              data-testid="backup-save-now"
              onClick={manualSave}
              disabled={busy || activeStatus.state === "saving"}
            >
              今すぐ保存
            </Button>
          </div>
        )}

        <Slider
          label="間隔"
          value={controller.backupIntervalSec}
          min={30}
          max={1800}
          step={30}
          onChange={controller.setBackupIntervalSec}
          format={(value) =>
            value < 60 ? `${value}秒` : `${Math.round(value / 60)}分`
          }
        />
        <div style={{ fontSize: 10, color: "var(--text-faint)" }}>
          変更のあるアクティブタブだけを保存します。非アクティブタブは自動保存しません
          （最大{MAX_BACKUPS}件 / 合計{formatBytes(MAX_BACKUP_TOTAL_BYTES)}）。
        </div>

        <div
          data-testid="backup-storage-summary"
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 8,
            alignItems: "center",
            fontSize: 11,
            color: usageWarning ? "#f0b35a" : "var(--text-dim)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            padding: "6px 8px",
          }}
        >
          <span>
            使用量 {formatBytes(totalBytes)} / {formatBytes(MAX_BACKUP_TOTAL_BYTES)}
          </span>
          <span>{entries.length}件・{usagePercent}%</span>
        </div>

        {usageWarning && (
          <div style={{ fontSize: 11, color: "#f0b35a" }}>
            容量が少なくなっています。古いバックアップを整理してください。
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <label style={{ fontSize: 11, color: "var(--text-dim)" }} htmlFor="backup-filter">
            表示
          </label>
          <select
            id="backup-filter"
            data-testid="backup-filter"
            value={filter}
            onChange={(event) => setFilter(event.target.value as BackupFilter)}
          >
            <option value="current">現在のタブ</option>
            <option value="all">すべて</option>
          </select>
          <span style={{ flex: 1 }} />
          <Button data-testid="backup-refresh" onClick={refresh} disabled={busy} className="ghost">
            更新
          </Button>
          <Button
            data-testid="backup-delete-older"
            onClick={removeOlder}
            disabled={busy || !deleteGate.allowed || olderBackupIds.length === 0}
            title={deleteGate.allowed ? undefined : deleteGate.message}
            className="ghost"
          >
            {deleteOlderLabel}
          </Button>
          <Button
            data-testid="backup-delete-all"
            onClick={removeAll}
            disabled={busy || !deleteGate.allowed || entries.length === 0}
            title={deleteGate.allowed ? undefined : deleteGate.message}
            variant="danger"
          >
            すべて削除
          </Button>
        </div>

        <div
          style={{
            borderTop: "1px solid var(--border)",
            paddingTop: 6,
            overflow: "auto",
            flex: 1,
          }}
        >
          {groupedEntries.length === 0 ? (
            <EmptyState>バックアップはまだありません</EmptyState>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {groupedEntries.map(([documentId, group]) => (
                <div key={documentId} data-testid="backup-document-group">
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--text-dim)",
                      marginBottom: 4,
                    }}
                  >
                    {group.label}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {group.entries.map((entry) => {
                      const restoresCurrent = Boolean(
                        activeTab &&
                        entry.documentId &&
                        entry.documentId === activeTab.id
                      );
                      const restoreGate = controller.getBackupActionGate(
                        restoresCurrent ? "restore-current" : "restore-new-tab"
                      );
                      return (
                        <div
                          key={entry.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: 6,
                            background: "var(--bg-elev)",
                            borderRadius: 4,
                            fontSize: 11,
                          }}
                        >
                          <div style={{ flex: 1 }}>
                            <div>{new Date(entry.createdAt).toLocaleString()}</div>
                            <div style={{ color: "var(--text-faint)", fontSize: 10 }}>
                              {entry.width}×{entry.height} · {formatBytes(entry.size)}
                            </div>
                          </div>
                          <button
                            className="btn"
                            style={{ fontSize: 11, padding: "2px 8px" }}
                            onClick={() => restore(entry)}
                            disabled={busy || !restoreGate.allowed}
                            title={restoreGate.allowed ? undefined : restoreGate.message}
                          >
                            {restoresCurrent ? "復元" : "新しいタブで開く"}
                          </button>
                          <button
                            className="btn ghost"
                            style={{ fontSize: 11, padding: "2px 8px", color: "#f66" }}
                            onClick={() => remove(entry)}
                            disabled={busy || !deleteGate.allowed}
                            title={deleteGate.allowed ? undefined : deleteGate.message}
                          >
                            削除
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function EmptyState({ children }: { children: string }) {
  return (
    <div style={{ fontSize: 11, color: "var(--text-faint)" }}>
      {children}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
