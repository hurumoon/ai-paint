import type { FileShortcutOptions, ShortcutHandlers } from "./types";

export function createFileShortcutHandlers({
  handleSave,
  handleSaveAs,
  handleOpenImage,
  handleOpenNewCanvasDialog,
}: FileShortcutOptions): ShortcutHandlers {
  return {
    "file.new": () => handleOpenNewCanvasDialog(),
    "file.save": () => {
      void handleSave();
    },
    "file.saveAs": () => {
      void handleSaveAs();
    },
    "file.open": () => {
      void handleOpenImage();
    },
  };
}
