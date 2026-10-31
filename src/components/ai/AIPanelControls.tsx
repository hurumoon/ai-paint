import { useRef } from "react";
import { canCropSelectionForAI } from "../../core/aiImagePayload";
import { AIMode, GuideShape, Selection, WorkStage } from "../../types";
import { Button, IconButton } from "../../ui/primitives";
import {
  IconCamera,
  IconCompare,
  IconImage,
  IconSparkles,
  IconTrash,
  IconZoom,
} from "../../ui/Icons";
import { ReferenceImage } from "./types";

const MODES: { value: AIMode; label: string }[] = [
  { value: "general", label: "総合" },
  { value: "pose", label: "ポーズ" },
  { value: "composition", label: "構図" },
  { value: "anatomy", label: "解剖学" },
  { value: "color", label: "配色" },
  { value: "lines", label: "線整理" },
  { value: "palette", label: "パレット" },
];

const STAGES: { value: WorkStage; label: string }[] = [
  { value: "rough", label: "ラフ" },
  { value: "lineart", label: "線画" },
  { value: "baseColor", label: "ベース塗り" },
  { value: "shadow", label: "影入れ" },
  { value: "highlight", label: "光入れ" },
  { value: "final", label: "仕上げ" },
];

export function AIModeStageControls({
  mode,
  setMode,
  stage,
  setStage,
}: {
  mode: AIMode;
  setMode: (mode: AIMode) => void;
  stage: WorkStage;
  setStage: (stage: WorkStage) => void;
}) {
  return (
    <>
      <div>
        <div className="ai-field-label">モード</div>
        <div className="ai-modes">
          {MODES.map((item) => (
            <button
              key={item.value}
              className={`ai-mode ${mode === item.value ? "active" : ""}`}
              onClick={() => setMode(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="ai-field-label">作業段階</div>
        <select
          className="select"
          value={stage}
          onChange={(e) => setStage(e.target.value as WorkStage)}
        >
          {STAGES.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}

export function AIReferenceImages({
  references,
  canAddReference,
  onAddReference,
  onRemoveReference,
}: {
  references: ReferenceImage[];
  canAddReference: boolean;
  onAddReference: (file: File) => void;
  onRemoveReference: (id: string) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  return (
    <div>
      <div className="ai-reference-head">
        <span>リファレンス画像（最大3枚）</span>
        <IconButton
          title="画像を追加"
          onClick={() => fileInputRef.current?.click()}
          disabled={!canAddReference}
        >
          <IconImage />
        </IconButton>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onAddReference(file);
          e.target.value = "";
        }}
      />
      {references.length > 0 && (
        <div className="reference-strip">
          {references.map((reference) => (
            <div key={reference.id} className="reference-item">
              <img
                src={reference.previewUrl}
                alt={reference.name}
                title={reference.name}
              />
              <button
                className="ref-remove"
                onClick={() => onRemoveReference(reference.id)}
                title="削除"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AIAnalysisActions({
  selection,
  zoomTarget,
  setZoomTarget,
  onAnalyze,
  onLocalPalette,
  onCompare,
  hasPrevious,
  anyChatLoading,
  isLoading,
  isLoadingInAnotherTab,
  hasApiKey,
}: {
  selection: Selection;
  zoomTarget: boolean;
  setZoomTarget: (zoomTarget: boolean) => void;
  onAnalyze: () => void;
  onLocalPalette: () => void;
  onCompare: () => void;
  hasPrevious: boolean;
  anyChatLoading: boolean;
  isLoading: boolean;
  isLoadingInAnotherTab: boolean;
  hasApiKey: boolean;
}) {
  const canAnalyzeSelection = canCropSelectionForAI(selection);
  const analyzeLabel = isLoading
    ? isLoadingInAnotherTab
      ? "別タブで解析中..."
      : "解析中..."
    : "AI に見てもらう";
  return (
    <>
      {canAnalyzeSelection && (
        <label className="ai-inline-check">
          <input
            type="checkbox"
            checked={zoomTarget}
            onChange={(e) => setZoomTarget(e.target.checked)}
          />
          <IconZoom width={14} height={14} /> 選択範囲だけを解析
        </label>
      )}

      <div className="btn-row">
        <Button
          variant="primary"
          onClick={onAnalyze}
          disabled={anyChatLoading || isLoading || !hasApiKey}
          style={{ flex: 1 }}
        >
          <IconSparkles width={14} height={14} />
          {analyzeLabel}
        </Button>
        <IconButton title="ローカルでパレット抽出" onClick={onLocalPalette}>
          <IconCamera />
        </IconButton>
        <IconButton
          title="前回との比較レビュー"
          onClick={onCompare}
          disabled={anyChatLoading || !hasPrevious || isLoading || !hasApiKey}
        >
          <IconCompare />
        </IconButton>
      </div>
    </>
  );
}

export function AIGuideControls({
  guides,
  showGuides,
  setShowGuides,
  onClearGuides,
  onHighlightGuide,
}: {
  guides: GuideShape[];
  showGuides: boolean;
  setShowGuides: (showGuides: boolean) => void;
  onClearGuides: () => void;
  onHighlightGuide: (guide: GuideShape | null) => void;
}) {
  return (
    <>
      <label className="ai-inline-check">
        <input
          type="checkbox"
          checked={showGuides}
          onChange={(e) => setShowGuides(e.target.checked)}
        />
        補助線を表示
      </label>

      {guides.length > 0 && (
        <div className="ai-guide-list">
          <div className="ai-guide-list-title">指摘箇所（クリックでハイライト）</div>
          {guides.map((guide, index) => (
            <button
              key={index}
              className="btn ghost ai-guide-button"
              onMouseEnter={() => onHighlightGuide(guide)}
              onMouseLeave={() => onHighlightGuide(null)}
              onClick={() => onHighlightGuide(guide)}
            >
              <span
                className="ai-guide-color"
                style={{ background: guide.color }}
              />
              {guide.label || `${guide.type}`}
            </button>
          ))}
          <Button variant="ghost" onClick={onClearGuides}>
            <IconTrash width={12} height={12} /> 補助線をクリア
          </Button>
        </div>
      )}
    </>
  );
}

export function AIPaletteResult({
  palette,
  onUsePaletteColor,
}: {
  palette: string[];
  onUsePaletteColor: (hex: string) => void;
}) {
  if (palette.length === 0) return null;
  return (
    <div>
      <div className="ai-field-label">提案パレット（クリックで色を設定）</div>
      <div className="palette-display">
        {palette.map((color, index) => (
          <button
            key={index}
            className="swatch-chip"
            style={{ background: color }}
            data-color={color}
            onClick={() => onUsePaletteColor(color)}
            title={color}
          />
        ))}
      </div>
    </div>
  );
}

export function AIResultMessages({
  error,
  advice,
}: {
  error: string;
  advice: string;
}) {
  return (
    <>
      {error && <div className="ai-error">{error}</div>}
      {advice && <div className="ai-advice">{advice}</div>}
    </>
  );
}
