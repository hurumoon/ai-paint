import { sharedCanvasPool } from "../../core/canvasPool";
import { pushToast } from "../../ui/primitives";
import type { ShortcutHandlers } from "./types";

export function createSystemShortcutHandlers(): ShortcutHandlers {
  return {
    "system.clearCanvasPool": () => {
      sharedCanvasPool.clear();
      pushToast("中間Canvasプールを解放しました");
    },
  };
}
