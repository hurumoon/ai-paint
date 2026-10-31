import { useCallback } from "react";
import { PaintDocument } from "../../core/PaintDocument";
import { flattenDocumentToBlob } from "../../core/paintDocumentExport";
import { pushToast } from "../../ui/primitives";
import { paletteWorker } from "../../workers/paintWorkerClient";

interface UseAIPaletteExtractionOptions {
  doc: PaintDocument | null;
  setPalette: (value: string[]) => void;
}

export type AIPaletteExtractionResult =
  | { ok: true; value: string[] }
  | { ok: false; error: string };

export function useAIPaletteExtraction({
  doc,
  setPalette,
}: UseAIPaletteExtractionOptions): () => Promise<AIPaletteExtractionResult> {
  return useCallback(async () => {
    if (!doc) return { ok: false, error: "キャンバスがありません" };
    try {
      const blob = await flattenDocumentToBlob(doc);
      const bitmap = await createImageBitmap(blob);
      try {
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(bitmap, 0, 0);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const palette = await paletteWorker(data, 5);
        setPalette(palette);
        pushToast("パレットを抽出しました", "success");
        return { ok: true, value: palette };
      } finally {
        bitmap.close();
      }
    } catch (e) {
      const error = `パレット抽出失敗: ${e instanceof Error ? e.message : String(e)}`;
      pushToast(error, "error");
      return { ok: false, error };
    }
  }, [doc, setPalette]);
}
