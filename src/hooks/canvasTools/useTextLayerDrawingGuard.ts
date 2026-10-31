import { useCallback } from "react";
import type { PaintDocument } from "../../core/PaintDocument";
import { pushToast } from "../../ui/primitives";
import type { Tool } from "../../types";

const DRAWING_TOOLS: Tool[] = ["brush", "eraser", "bucket", "blur", "gradient", "shape"];

export function useTextLayerDrawingGuard(doc: PaintDocument) {
  return useCallback(
    (toolNow: Tool): boolean => {
      if (!DRAWING_TOOLS.includes(toolNow)) return false;
      const active = doc.getActiveLayer();
      if (active && active.meta.kind === "text") {
        pushToast(
          "テキストレイヤーには直接描画できません。新規レイヤーを作成してください。",
          "info"
        );
        return true;
      }
      return false;
    },
    [doc]
  );
}
