import { useEffect, useRef, useState, type ReactNode } from "react";
import { PaintDocument } from "../core/PaintDocument";
import { Button, pushToast } from "../ui/primitives";
import { History } from "../core/History";
import type { ColorHistoryConfig } from "../core/colorHistory";
import {
  parseAppSettingsArchive,
  stringifyAppSettingsArchive,
} from "../core/appSettingsArchive";
import type { LayoutConfig } from "../core/panelLayout";
import {
  getClaudeModelSettings,
  setClaudeModelSettings,
} from "../core/aiModelSettings";
import { saveShortcuts } from "../core/shortcuts";
import { isTauri, saveBlobToUserPath } from "../utils/saveFile";
import { AISettingsSection } from "./canvasSettings/AISettingsSection";
import { CanvasResolutionSection } from "./canvasSettings/CanvasResolutionSection";
import { ColorHistorySettingsSection } from "./canvasSettings/ColorHistorySettingsSection";
import { ChallengeListDialog } from "./canvasSettings/ChallengeListDialog";
import { HistoryMemorySection } from "./canvasSettings/HistoryMemorySection";
import type { GridConfig } from "./GridSettings";
import type { AIGuideDisplayMode, ChallengeItem, ShortcutMap } from "../types";

const CANVAS_SETTINGS_PANES = [
  { id: "ai", label: "AI", description: "解析とモデル" },
  { id: "canvas", label: "キャンバス", description: "解像度とDPI" },
  { id: "history", label: "履歴", description: "元に戻すメモリ" },
  { id: "color", label: "カラー履歴", description: "表示と保存数" },
  { id: "settingsFile", label: "設定JSON", description: "JSON" },
] as const;

type CanvasSettingsPaneId = (typeof CANVAS_SETTINGS_PANES)[number]["id"];

interface Props {
  open: boolean;
  onClose: () => void;
  doc: PaintDocument;
  history: History;
  historyMemoryBudget: number;
  onChangeHistoryMemoryBudget: (bytes: number) => void;
  enhancedAIEnabled: boolean;
  setEnhancedAIEnabled: (enabled: boolean) => void;
  aiGuideDisplayMode: AIGuideDisplayMode;
  setAIGuideDisplayMode: (mode: AIGuideDisplayMode) => void;
  hasApiKey: boolean;
  setApiKey: (key: string) => void;
  clearApiKey: () => void;
  challengeItems: ChallengeItem[];
  onChangeChallengeItems: (items: ChallengeItem[]) => void;
  colorHistoryConfig: ColorHistoryConfig;
  onChangeColorHistoryConfig: (c: ColorHistoryConfig) => void;
  onClearColorHistory: () => void;
  shortcuts: ShortcutMap;
  setShortcuts: (shortcuts: ShortcutMap) => void;
  layout: LayoutConfig;
  setLayout: (layout: LayoutConfig) => void;
  grid: GridConfig;
  setGrid: (grid: GridConfig) => void;
  backupIntervalSec: number;
  setBackupIntervalSec: (value: number) => void;
  backupEnabled: boolean;
  setBackupEnabled: (value: boolean) => void;
}

export function CanvasSettings({
  open,
  onClose,
  doc,
  history,
  historyMemoryBudget,
  onChangeHistoryMemoryBudget,
  enhancedAIEnabled,
  setEnhancedAIEnabled,
  aiGuideDisplayMode,
  setAIGuideDisplayMode,
  hasApiKey,
  setApiKey,
  clearApiKey,
  challengeItems,
  onChangeChallengeItems,
  colorHistoryConfig,
  onChangeColorHistoryConfig,
  onClearColorHistory,
  shortcuts,
  setShortcuts,
  layout,
  setLayout,
  grid,
  setGrid,
  backupIntervalSec,
  setBackupIntervalSec,
  backupEnabled,
  setBackupEnabled,
}: Props) {
  const [width, setWidth] = useState(doc.width);
  const [height, setHeight] = useState(doc.height);
  const [dpi, setDpi] = useState(doc.dpi);
  const [draftHistoryMemoryBudget, setDraftHistoryMemoryBudget] = useState(historyMemoryBudget);
  const [showChallengeList, setShowChallengeList] = useState(false);
  const [activePane, setActivePane] = useState<CanvasSettingsPaneId>("ai");
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const importingRef = useRef(false);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (open) setDraftHistoryMemoryBudget(historyMemoryBudget);
  }, [open, historyMemoryBudget]);

  useEffect(() => {
    if (!open) return;
    setWidth(doc.width);
    setHeight(doc.height);
    setDpi(doc.dpi);
    setShowChallengeList(false);
    setActivePane("ai");
  }, [open, doc]);

  if (!open) return null;

  const apply = () => {
    const w = Math.max(1, Math.min(8192, Math.round(width)));
    const h = Math.max(1, Math.min(8192, Math.round(height)));
    if (w !== doc.width || h !== doc.height) {
      if (
        !confirm(
          `解像度を ${w}×${h} に変更します。全レイヤーがリサンプリングされ、テキストレイヤーがある場合はラスタライズされて編集できなくなります。Undo履歴は消去され、この操作は元に戻せません。続行しますか？`
        )
      ) {
        return;
      }
      doc.resize(w, h);
      history.clear();
      pushToast(`解像度を ${w}×${h} に変更しました`, "success");
    }
    if (dpi !== doc.dpi) {
      doc.setDpi(dpi);
      pushToast(`DPI を ${dpi} に設定しました`, "success");
    }
    // 上限の縮小は履歴を破棄するため、キャンセル可能な編集中には適用しない。
    onChangeHistoryMemoryBudget(draftHistoryMemoryBudget);
    onClose();
  };

  const exportSettings = async () => {
    try {
      const claudeModelSettings = isTauri()
        ? await getClaudeModelSettings()
        : undefined;
      const json = stringifyAppSettingsArchive({
        shortcuts,
        layout,
        grid,
        ai: {
          enhancedAIEnabled,
          aiGuideDisplayMode,
        },
        claudeModelSettings,
        challengeItems,
        colorHistoryConfig,
        historyMemoryBudget: draftHistoryMemoryBudget,
        backup: {
          enabled: backupEnabled,
          intervalSec: backupIntervalSec,
        },
      });
      const result = await saveBlobToUserPath(
        new Blob([json], { type: "application/json" }),
        "ai-paint-settings.json",
        { name: "JSON", extensions: ["json"] }
      );
      if (!result.cancelled) {
        pushToast("設定 JSON をエクスポートしました", "success");
      }
    } catch (e) {
      pushToast(`設定 JSON のエクスポートに失敗しました: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  };

  const importSettingsFile = async (file: File) => {
    if (importingRef.current) return;
    importingRef.current = true;
    setImporting(true);
    try {
      const imported = parseAppSettingsArchive(await file.text());
      // 失敗し得る非同期保存を先に完了し、待機中は画面側の設定を変更しない。
      if (imported.claudeModelSettings && isTauri()) {
        await setClaudeModelSettings(imported.claudeModelSettings);
      }
      setShortcuts(imported.shortcuts);
      saveShortcuts(imported.shortcuts);
      setLayout(imported.layout);
      setGrid(imported.grid);
      setEnhancedAIEnabled(imported.ai.enhancedAIEnabled);
      setAIGuideDisplayMode(imported.ai.aiGuideDisplayMode);
      onChangeChallengeItems(imported.challengeItems);
      onChangeColorHistoryConfig(imported.colorHistoryConfig);
      setDraftHistoryMemoryBudget(imported.historyMemoryBudget);
      setBackupEnabled(imported.backup.enabled);
      setBackupIntervalSec(imported.backup.intervalSec);
      pushToast("設定 JSON をインポートしました", "success");
    } catch (e) {
      pushToast(`設定 JSON のインポートに失敗しました: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      importingRef.current = false;
      setImporting(false);
    }
  };

  const renderPane = (): ReactNode => {
    switch (activePane) {
      case "ai":
        return (
          <>
            <div className="canvas-settings-pane-head">
              <strong>AI</strong>
              <span>AI解析、表示方法、モデル設定を調整します。</span>
            </div>
            <AISettingsSection
              open={open}
              enhancedAIEnabled={enhancedAIEnabled}
              setEnhancedAIEnabled={setEnhancedAIEnabled}
              aiGuideDisplayMode={aiGuideDisplayMode}
              setAIGuideDisplayMode={setAIGuideDisplayMode}
              hasApiKey={hasApiKey}
              setApiKey={setApiKey}
              clearApiKey={clearApiKey}
              onOpenChallengeList={() => setShowChallengeList(true)}
            />
          </>
        );
      case "canvas":
        return (
          <>
            <div className="canvas-settings-pane-head">
              <strong>キャンバス</strong>
              <span>現在のドキュメントの解像度とDPIを変更します。</span>
            </div>
            <CanvasResolutionSection
              width={width}
              height={height}
              dpi={dpi}
              setWidth={setWidth}
              setHeight={setHeight}
              setDpi={setDpi}
            />
          </>
        );
      case "history":
        return (
          <>
            <div className="canvas-settings-pane-head">
              <strong>履歴</strong>
              <span>元に戻す履歴に使うメモリ上限を設定します。</span>
            </div>
            <HistoryMemorySection
              historyMemoryBudget={draftHistoryMemoryBudget}
              onChangeHistoryMemoryBudget={setDraftHistoryMemoryBudget}
            />
          </>
        );
      case "color":
        return (
          <>
            <div className="canvas-settings-pane-head">
              <strong>カラー履歴</strong>
              <span>ツールオプションに表示する色履歴を設定します。</span>
            </div>
            <ColorHistorySettingsSection
              colorHistoryConfig={colorHistoryConfig}
              onChangeColorHistoryConfig={onChangeColorHistoryConfig}
              onClearColorHistory={onClearColorHistory}
            />
          </>
        );
      case "settingsFile":
        return (
          <>
            <div className="canvas-settings-pane-head">
              <strong>設定JSON</strong>
              <span>ショートカット、配置、表示設定などを JSON ファイルで移行します。</span>
            </div>
            <div className="section">
              <div className="section-title">
                <span>設定 JSON</span>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Button disabled={importing} onClick={exportSettings}>エクスポート</Button>
                <Button disabled={importing} onClick={() => importInputRef.current?.click()}>
                  {importing ? "インポート中…" : "インポート"}
                </Button>
              </div>
              <input
                ref={importInputRef}
                type="file"
                disabled={importing}
                accept=".json,application/json"
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.currentTarget.files?.[0];
                  e.currentTarget.value = "";
                  if (file) void importSettingsFile(file);
                }}
              />
            </div>
          </>
        );
    }
  };

  return (
    <>
      <div
        className="popover-backdrop"
        style={{ background: "rgba(0,0,0,0.4)" }}
        onClick={() => { if (!importingRef.current) onClose(); }}
      />
      <div
        className="popover canvas-settings-dialog"
      >
        <div className="canvas-settings-head">
          <strong>設定</strong>
          <button className="btn ghost" disabled={importing} onClick={onClose}>×</button>
        </div>

        <div className="canvas-settings-body">
          <nav className="canvas-settings-nav" aria-label="設定カテゴリ">
            {CANVAS_SETTINGS_PANES.map((pane) => (
              <button
                key={pane.id}
                disabled={importing}
                className={pane.id === activePane ? "active" : ""}
                onClick={() => setActivePane(pane.id)}
                aria-current={pane.id === activePane ? "page" : undefined}
              >
                <strong>{pane.label}</strong>
                <span>{pane.description}</span>
              </button>
            ))}
          </nav>
          <section className="canvas-settings-pane">{renderPane()}</section>
        </div>

        <div className="canvas-settings-actions">
          <Button disabled={importing} onClick={onClose}>キャンセル</Button>
          <Button disabled={importing} variant="primary" onClick={apply}>適用</Button>
        </div>
      </div>
      <ChallengeListDialog
        open={showChallengeList}
        items={challengeItems}
        onChange={onChangeChallengeItems}
        onClose={() => setShowChallengeList(false)}
      />
    </>
  );
}
