import type { ShortcutHandlers, ViewShortcutOptions } from "./types";

export function createViewShortcutHandlers({
  setGrid,
  setZoom,
  setPan,
  setRotation,
  setCanvasFlipped,
  rotateViewClockwise,
  rotateViewCounterClockwise,
  toggleHorizontalFlip,
}: ViewShortcutOptions): ShortcutHandlers {
  return {
    "view.grid": () => setGrid((g) => ({ ...g, show: !g.show })),
    "view.reset": () => {
      setZoom(1);
      setPan({ x: 0, y: 0 });
      setRotation(0);
      setCanvasFlipped(false);
    },
    "view.zoomIn": () => setZoom((z) => Math.min(8, z * 1.25)),
    "view.zoomOut": () => setZoom((z) => Math.max(0.1, z / 1.25)),
    "view.rotateCW": rotateViewClockwise,
    "view.rotateCCW": rotateViewCounterClockwise,
    "view.flipHorizontal": toggleHorizontalFlip,
  };
}
