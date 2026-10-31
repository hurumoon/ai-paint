import type { Dispatch, SetStateAction } from "react";
import type { GridConfig } from "../../components/GridSettings";
import type { History } from "../../core/History";
import type { PaintDocument } from "../../core/PaintDocument";
import type { Selection } from "../../types";
import type { ToolState } from "../useToolState";

export type ShortcutHandlers = Record<string, () => void>;

export type ShortcutToolState = Pick<
  ToolState,
  | "setTool"
  | "toolRef"
  | "setEraserSize"
  | "brushCategoryRef"
  | "setBrushCategorySettings"
  | "colorRef"
  | "setColor"
  | "secondaryColorRef"
  | "setSecondaryColor"
>;

export interface FileShortcutOptions {
  handleSave: () => Promise<void>;
  handleSaveAs: () => Promise<void>;
  handleOpenImage: () => Promise<void>;
  handleOpenNewCanvasDialog: () => void;
}

export interface EditShortcutOptions {
  doc: PaintDocument | null;
  history: History | null;
  setShowColorAdjustDialog: Dispatch<SetStateAction<boolean>>;
  setSelection: Dispatch<SetStateAction<Selection>>;
}

export interface LayerShortcutOptions {
  doc: PaintDocument | null;
  history: History | null;
}

export interface ToolShortcutOptions {
  toolState: ShortcutToolState;
}

export interface ViewShortcutOptions {
  setGrid: Dispatch<SetStateAction<GridConfig>>;
  setZoom: Dispatch<SetStateAction<number>>;
  setPan: Dispatch<SetStateAction<{ x: number; y: number }>>;
  setRotation: Dispatch<SetStateAction<number>>;
  setCanvasFlipped: Dispatch<SetStateAction<boolean>>;
  rotateViewClockwise: () => void;
  rotateViewCounterClockwise: () => void;
  toggleHorizontalFlip: () => void;
}

export interface TabShortcutOptions {
  activeTabId: string | null;
  handleCloseTab: (id: string) => Promise<void>;
}
