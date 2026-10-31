import { Fragment, type RefObject } from "react";
import { OPEN_FILE_ACCEPT } from "../core/fileFormats";
import { type TopBarItemId } from "../core/panelLayout";
import { type Theme } from "../types";
import { IconButton } from "../ui/primitives";
import {
  IconBookOpen,
  IconCanvas,
  IconCanvasExpand,
  IconClock,
  IconDownload,
  IconFlipHorizontal,
  IconImage,
  IconInfo,
  IconKeyboard,
  IconLayout,
  IconMoon,
  IconNew,
  IconRedo,
  IconRotate,
  IconRotateCCW,
  IconSave,
  IconSettings,
  IconSliders,
  IconSun,
  IconUndo,
  IconUpload,
} from "../ui/Icons";

const MIN_ROTATION_STEP = 1;
const MAX_ROTATION_STEP = 359;
const DEFAULT_ROTATION_STEP = 90;

function normalizeRotationStep(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_ROTATION_STEP;
  return Math.min(MAX_ROTATION_STEP, Math.max(MIN_ROTATION_STEP, Math.round(value)));
}

interface AppMenuBarProps {
  theme: Theme;
  hasActiveTab: boolean;
  currentFileName: string | null;
  currentFilePath: string | null;
  fileInputRef: RefObject<HTMLInputElement>;
  directImageInputRef: RefObject<HTMLInputElement>;
  canUndo: boolean;
  canRedo: boolean;
  rotation: number;
  rotationStep: number;
  canvasFlipped: boolean;
  showSubview: boolean;
  showReference: boolean;
  showDrawingGuide: boolean;
  topBarLeftItems: TopBarItemId[];
  topBarRightItems: TopBarItemId[];
  onShowAboutDialog: () => void;
  onShowCanvasSettings: () => void;
  onShowCanvasExtendDialog: () => void;
  onOpenNewCanvasDialog: () => void;
  onOpenImage: () => void;
  onOpenDirectImage: () => void;
  onImageFile: (file: File) => void;
  onDirectImageFile: (file: File) => void;
  onUndo: () => void;
  onRedo: () => void;
  onChangeRotationStep: (step: number) => void;
  onRotateViewCounterClockwise: () => void;
  onRotateViewClockwise: () => void;
  onToggleHorizontalFlip: () => void;
  onToggleSubview: () => void;
  onToggleReference: () => void;
  onToggleDrawingGuide: () => void;
  onShowColorAdjustDialog: () => void;
  onShowLayoutSettings: () => void;
  onShowShortcutSettings: () => void;
  onSave: () => void;
  onExport: () => void;
  onShowBackupPanel: () => void;
  onToggleTheme: () => void;
}

export function AppMenuBar({
  theme,
  hasActiveTab,
  currentFileName,
  currentFilePath,
  fileInputRef,
  directImageInputRef,
  canUndo,
  canRedo,
  rotation,
  rotationStep,
  canvasFlipped,
  showSubview,
  showReference,
  showDrawingGuide,
  topBarLeftItems,
  topBarRightItems,
  onShowAboutDialog,
  onShowCanvasSettings,
  onShowCanvasExtendDialog,
  onOpenNewCanvasDialog,
  onOpenImage,
  onOpenDirectImage,
  onImageFile,
  onDirectImageFile,
  onUndo,
  onRedo,
  onChangeRotationStep,
  onRotateViewCounterClockwise,
  onRotateViewClockwise,
  onToggleHorizontalFlip,
  onToggleSubview,
  onToggleReference,
  onToggleDrawingGuide,
  onShowColorAdjustDialog,
  onShowLayoutSettings,
  onShowShortcutSettings,
  onSave,
  onExport,
  onShowBackupPanel,
  onToggleTheme,
}: AppMenuBarProps) {
  const orderedTopBarItems = [...topBarLeftItems, ...topBarRightItems];
  const firstRotationItem =
    orderedTopBarItems.find(
      (id) => id === "rotateCounterClockwise" || id === "rotateClockwise"
    ) ?? null;

  const renderRotationStepInput = () => (
    <input
      className="rotation-step-input"
      type="number"
      min={MIN_ROTATION_STEP}
      max={MAX_ROTATION_STEP}
      step={1}
      value={rotationStep}
      aria-label="回転量"
      title="回転量"
      disabled={!hasActiveTab}
      onChange={(e) => {
        onChangeRotationStep(normalizeRotationStep(e.currentTarget.valueAsNumber));
      }}
    />
  );

  const renderTopBarItem = (id: TopBarItemId) => {
    const rotationStepInput =
      id === firstRotationItem ? renderRotationStepInput() : null;

    switch (id) {
      case "about":
        return (
          <IconButton title="このアプリについて" onClick={onShowAboutDialog}>
            <IconInfo />
          </IconButton>
        );
      case "canvasSettings":
        return (
          <IconButton
            title="設定"
            disabled={!hasActiveTab}
            onClick={onShowCanvasSettings}
          >
            <IconSettings />
          </IconButton>
        );
      case "canvasExtend":
        return (
          <IconButton
            title="キャンバス拡張"
            disabled={!hasActiveTab}
            onClick={onShowCanvasExtendDialog}
          >
            <IconCanvasExpand />
          </IconButton>
        );
      case "newCanvas":
        return (
          <IconButton
            title="新規キャンバス (Ctrl+N)"
            data-testid="topbar-newCanvas"
            onClick={onOpenNewCanvasDialog}
          >
            <IconNew />
          </IconButton>
        );
      case "openImage":
        return (
          <IconButton title="画像/.aipaint を読み込み" onClick={onOpenImage}>
            <IconUpload />
          </IconButton>
        );
      case "openDirectImage":
        return (
          <IconButton title="画像を読み込み（直接編集）" onClick={onOpenDirectImage}>
            <IconImage />
          </IconButton>
        );
      case "undo":
        return (
          <IconButton
            title="アンドゥ"
            data-testid="topbar-undo"
            disabled={!canUndo}
            onClick={onUndo}
          >
            <IconUndo />
          </IconButton>
        );
      case "redo":
        return (
          <IconButton title="リドゥ" disabled={!canRedo} onClick={onRedo}>
            <IconRedo />
          </IconButton>
        );
      case "rotateCounterClockwise":
        return (
          <>
            {rotationStepInput}
            <IconButton
              title={`左回転 ${rotationStep}° (現在 ${rotation}°)`}
              disabled={!hasActiveTab}
              onClick={onRotateViewCounterClockwise}
            >
              <IconRotateCCW />
            </IconButton>
          </>
        );
      case "rotateClockwise":
        return (
          <>
            {rotationStepInput}
            <IconButton
              title={`右回転 ${rotationStep}° (現在 ${rotation}°)`}
              disabled={!hasActiveTab}
              onClick={onRotateViewClockwise}
            >
              <IconRotate />
            </IconButton>
          </>
        );
      case "horizontalFlip":
        return (
          <IconButton
            title={
              canvasFlipped
                ? "左右反転表示を解除 (Shift+H)"
                : "左右反転表示 (Shift+H)"
            }
            active={canvasFlipped}
            disabled={!hasActiveTab}
            onClick={onToggleHorizontalFlip}
          >
            <IconFlipHorizontal />
          </IconButton>
        );
      case "subview":
        return (
          <IconButton
            title={showSubview ? "サブビューを隠す" : "サブビューを表示"}
            active={showSubview}
            disabled={!hasActiveTab}
            onClick={onToggleSubview}
          >
            <IconCanvas />
          </IconButton>
        );
      case "reference":
        return (
          <IconButton
            title={showReference ? "リファレンス画像を隠す" : "リファレンス画像を表示"}
            active={showReference}
            onClick={onToggleReference}
          >
            <IconImage />
          </IconButton>
        );
      case "drawingGuide":
        return (
          <IconButton
            title={showDrawingGuide ? "描き方参照を隠す" : "描き方参照を表示"}
            active={showDrawingGuide}
            onClick={onToggleDrawingGuide}
          >
            <IconBookOpen />
          </IconButton>
        );
      case "colorAdjust":
        return (
          <IconButton
            title="色調補正 (Ctrl+U)"
            disabled={!hasActiveTab}
            onClick={onShowColorAdjustDialog}
          >
            <IconSliders />
          </IconButton>
        );
      case "layoutSettings":
        return (
          <IconButton title="ウィンドウ配置設定" onClick={onShowLayoutSettings}>
            <IconLayout />
          </IconButton>
        );
      case "shortcutSettings":
        return (
          <IconButton title="ショートカット設定" onClick={onShowShortcutSettings}>
            <IconKeyboard />
          </IconButton>
        );
      case "save":
        return (
          <IconButton
            title={
              currentFilePath
                ? `上書き保存: ${currentFileName ?? ""} (Ctrl+S)`
                : "保存 (Ctrl+S)"
            }
            disabled={!hasActiveTab}
            onClick={onSave}
          >
            <IconSave />
          </IconButton>
        );
      case "export":
        return (
          <IconButton
            title="エクスポート"
            data-testid="topbar-export"
            disabled={!hasActiveTab}
            onClick={onExport}
          >
            <IconDownload />
          </IconButton>
        );
      case "backup":
        return (
          <IconButton
            title="自動バックアップ"
            data-testid="topbar-backup"
            disabled={!hasActiveTab}
            onClick={onShowBackupPanel}
          >
            <IconClock />
          </IconButton>
        );
      case "theme":
        return (
          <IconButton
            title={theme === "dark" ? "ライトモードに切替" : "ダークモードに切替"}
            onClick={onToggleTheme}
          >
            {theme === "dark" ? <IconSun /> : <IconMoon />}
          </IconButton>
        );
    }
  };

  return (
    <div className="menubar">
      {topBarLeftItems.map((id) => (
        <Fragment key={id}>{renderTopBarItem(id)}</Fragment>
      ))}
      <input
        ref={fileInputRef}
        type="file"
        data-testid="project-file-input"
        accept={OPEN_FILE_ACCEPT}
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onImageFile(f);
          e.target.value = "";
        }}
      />
      <input
        ref={directImageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onDirectImageFile(f);
          e.target.value = "";
        }}
      />

      <div className="spacer" />

      {topBarRightItems.map((id) => (
        <Fragment key={id}>{renderTopBarItem(id)}</Fragment>
      ))}
    </div>
  );
}
