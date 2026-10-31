import type { RefObject } from "react";
import { AppMenuBar } from "./AppMenuBar";
import { AppToolOptionsPanel } from "./AppToolOptionsPanel";
import { TabBar } from "./TabBar";
import { Toolbar } from "./Toolbar";
import type { ToolOptionsProps } from "./ToolOptions";
import type { TopBarItemId } from "../core/panelLayout";
import type { Tab } from "../hooks/useTabs";
import type { BrushCategory, Theme, Tool } from "../types";

export interface AppChromeMenuModel {
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

export interface AppChromeTabsModel {
  tabs: Tab[];
  activeTabId: string | null;
  tabIsDirty: (tab: Tab) => boolean;
  tabsLocked: boolean;
  tabActionsLocked: boolean;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void | Promise<void>;
  onAddBlankTab: () => void;
  onReorderTab: (fromIndex: number, toIndex: number) => void;
}

export interface AppChromeToolbarModel {
  tool: Tool;
  brushCategory: BrushCategory;
  onToolClick: (tool: Tool) => void;
  onBrushCategoryClick: (category: BrushCategory) => void;
}

export interface AppChromeToolOptionsModel {
  toolOptionsOpen: boolean;
  toolOptionsTitle: string;
  toolOptionsProps: ToolOptionsProps;
  onCloseToolOptions: () => void;
}

export interface AppChromeModel {
  menu: AppChromeMenuModel;
  tabs: AppChromeTabsModel;
  toolbar: AppChromeToolbarModel;
  toolOptions: AppChromeToolOptionsModel;
}

type AppChromeProps = AppChromeModel;

export function AppChrome({
  menu,
  tabs,
  toolbar,
  toolOptions,
}: AppChromeProps) {
  return (
    <>
      <AppMenuBar
        {...menu}
      />

      <TabBar
        tabs={tabs.tabs}
        activeTabId={tabs.activeTabId}
        isDirty={tabs.tabIsDirty}
        disabled={tabs.tabsLocked}
        actionsDisabled={tabs.tabActionsLocked}
        onSelect={tabs.onSelectTab}
        onClose={tabs.onCloseTab}
        onAddBlank={tabs.onAddBlankTab}
        onReorder={tabs.onReorderTab}
      />

      <Toolbar
        tool={toolbar.tool}
        brushCategory={toolbar.brushCategory}
        onToolClick={toolbar.onToolClick}
        onBrushCategoryClick={toolbar.onBrushCategoryClick}
      />

      {toolOptions.toolOptionsOpen && (
        <AppToolOptionsPanel
          title={toolOptions.toolOptionsTitle}
          toolOptionsProps={toolOptions.toolOptionsProps}
          onClose={toolOptions.onCloseToolOptions}
        />
      )}
    </>
  );
}
