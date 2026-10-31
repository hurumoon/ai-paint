import type { EditShortcutOptions, ShortcutHandlers } from "./types";

export function createEditShortcutHandlers({
  doc,
  history,
  setShowColorAdjustDialog,
  setSelection,
}: EditShortcutOptions): ShortcutHandlers {
  return {
    "edit.undo": () => {
      if (history && doc) history.undo(doc);
    },
    "edit.redo": () => {
      if (history && doc) history.redo(doc);
    },
    "edit.redo2": () => {
      if (history && doc) history.redo(doc);
    },
    "edit.colorAdjust": () => {
      if (doc) setShowColorAdjustDialog(true);
    },
    "edit.selectAll": () => {
      if (!doc) return;
      setSelection({ kind: "rect", x: 0, y: 0, w: doc.width, h: doc.height });
    },
    "selection.clear": () => setSelection({ kind: "none" }),
  };
}
