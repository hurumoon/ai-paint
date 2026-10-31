import { useEffect, useMemo, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { GridConfig } from "../components/GridSettings";
import type { History } from "../core/History";
import type { PaintDocument } from "../core/PaintDocument";
import { dispatchShortcut, eventToKeyString } from "../core/shortcuts";
import type { Selection, ShortcutMap } from "../types";
import { createEditShortcutHandlers } from "./shortcuts/editShortcutHandlers";
import { createFileShortcutHandlers } from "./shortcuts/fileShortcutHandlers";
import { createLayerShortcutHandlers } from "./shortcuts/layerShortcutHandlers";
import { createSystemShortcutHandlers } from "./shortcuts/systemShortcutHandlers";
import { createTabShortcutHandlers } from "./shortcuts/tabShortcutHandlers";
import { createToolShortcutHandlers } from "./shortcuts/toolShortcutHandlers";
import type { ShortcutToolState } from "./shortcuts/types";
import { createViewShortcutHandlers } from "./shortcuts/viewShortcutHandlers";

interface UseAppShortcutsOptions {
  disabled?: boolean;
  shortcuts: ShortcutMap;
  activeTabId: string | null;
  doc: PaintDocument | null;
  history: History | null;
  toolState: ShortcutToolState;
  savingRef: MutableRefObject<boolean>;
  paintBusyRef: MutableRefObject<boolean>;
  showColorAdjustDialog: boolean;
  setShowColorAdjustDialog: Dispatch<SetStateAction<boolean>>;
  setSelection: Dispatch<SetStateAction<Selection>>;
  setGrid: Dispatch<SetStateAction<GridConfig>>;
  setZoom: Dispatch<SetStateAction<number>>;
  setPan: Dispatch<SetStateAction<{ x: number; y: number }>>;
  setRotation: Dispatch<SetStateAction<number>>;
  setCanvasFlipped: Dispatch<SetStateAction<boolean>>;
  handleSave: () => Promise<void>;
  handleSaveAs: () => Promise<void>;
  handleOpenImage: () => Promise<void>;
  handleOpenNewCanvasDialog: () => void;
  handleCloseTab: (id: string) => Promise<void>;
  rotateViewClockwise: () => void;
  rotateViewCounterClockwise: () => void;
  toggleHorizontalFlip: () => void;
}

const PAINT_BUSY_BLOCKED_ACTIONS = new Set([
  "file.new",
  "file.save",
  "file.saveAs",
  "file.open",
  "edit.undo",
  "edit.redo",
  "edit.redo2",
  "edit.colorAdjust",
  "edit.selectAll",
  "selection.clear",
  "layer.new",
  "tab.close",
]);

function findShortcutActionId(e: KeyboardEvent, shortcuts: ShortcutMap): string | null {
  const key = eventToKeyString(e);
  for (const [actionId, combo] of Object.entries(shortcuts)) {
    if (combo && combo.toLowerCase() === key) return actionId;
  }
  return null;
}

export function useAppShortcuts({
  disabled = false,
  shortcuts,
  activeTabId,
  doc,
  history,
  toolState,
  savingRef,
  paintBusyRef,
  showColorAdjustDialog,
  setShowColorAdjustDialog,
  setSelection,
  setGrid,
  setZoom,
  setPan,
  setRotation,
  setCanvasFlipped,
  handleSave,
  handleSaveAs,
  handleOpenImage,
  handleOpenNewCanvasDialog,
  handleCloseTab,
  rotateViewClockwise,
  rotateViewCounterClockwise,
  toggleHorizontalFlip,
}: UseAppShortcutsOptions): void {
  const handlers = useMemo(
    () => ({
      ...createToolShortcutHandlers({ toolState }),
      ...createFileShortcutHandlers({
        handleSave,
        handleSaveAs,
        handleOpenImage,
        handleOpenNewCanvasDialog,
      }),
      ...createEditShortcutHandlers({
        doc,
        history,
        setShowColorAdjustDialog,
        setSelection,
      }),
      ...createLayerShortcutHandlers({ doc, history }),
      ...createViewShortcutHandlers({
        setGrid,
        setZoom,
        setPan,
        setRotation,
        setCanvasFlipped,
        rotateViewClockwise,
        rotateViewCounterClockwise,
        toggleHorizontalFlip,
      }),
      ...createTabShortcutHandlers({ activeTabId, handleCloseTab }),
      ...createSystemShortcutHandlers(),
    }),
    [
      activeTabId,
      doc,
      handleCloseTab,
      handleOpenImage,
      handleOpenNewCanvasDialog,
      handleSave,
      handleSaveAs,
      history,
      rotateViewClockwise,
      rotateViewCounterClockwise,
      setCanvasFlipped,
      setGrid,
      setPan,
      setRotation,
      setSelection,
      setShowColorAdjustDialog,
      setZoom,
      toggleHorizontalFlip,
      toolState,
    ]
  );

  useEffect(() => {
    if (disabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector(".app[inert]")) return;
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (savingRef.current) {
        e.preventDefault();
        return;
      }
      const actionId = findShortcutActionId(e, shortcuts);
      if (paintBusyRef.current && actionId && PAINT_BUSY_BLOCKED_ACTIONS.has(actionId)) {
        e.preventDefault();
        return;
      }
      if (showColorAdjustDialog) {
        return;
      }
      if (dispatchShortcut(e, shortcuts, handlers)) {
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    disabled,
    handlers,
    paintBusyRef,
    savingRef,
    shortcuts,
    showColorAdjustDialog,
  ]);
}
