import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { History } from "../core/History";
import type { PaintDocument, PixelLayer } from "../core/PaintDocument";
import { unionSnapshotRect } from "../core/historySnapshots";
import { measureTextLayerBBox } from "../core/textLayerRaster";
import type { TextLayerData } from "../types";

interface UseTextLayerActionsOptions {
  doc: PaintDocument | null;
  history: History | null;
  setDefaultTextStyle: Dispatch<SetStateAction<TextLayerData>>;
}

export function useTextLayerActions({
  doc,
  history,
  setDefaultTextStyle,
}: UseTextLayerActionsOptions) {
  const activeLayer = doc?.getActiveLayer() ?? null;
  const editingTextLayer: PixelLayer | null =
    activeLayer?.meta.kind === "text" && activeLayer.meta.text ? activeLayer : null;

  const handleTextChange = useCallback(
    (patch: Partial<TextLayerData>) => {
      if (!editingTextLayer || !doc || !history) return;
      const layer = doc.getLayer(editingTextLayer.meta.id);
      const text = layer?.meta.text;
      if (!layer || layer.meta.locked || layer.meta.kind !== "text" || !text) return;
      if (!Object.entries(patch).some(([key, value]) => text[key as keyof TextLayerData] !== value)) return;
      doc.materializeLayer(layer);
      const beforeBounds = layer.store.getAlphaBounds();
      const afterBounds = measureTextLayerBBox(doc.width, doc.height, { ...text, ...patch });
      // 文字メタと画素を一緒に戻しつつ、大きなキャンバスでも文字の範囲だけ保存する。
      const pixelRegion = beforeBounds && afterBounds
        ? unionSnapshotRect(beforeBounds, afterBounds)
        : beforeBounds ?? afterBounds ?? { x: 0, y: 0, w: 0, h: 0 };
      history.beginStructureOperation(doc, { pixelLayerIds: [layer.meta.id], pixelRegion });
      try {
        doc.updateTextLayer(layer.meta.id, patch);
        history.commitStructureOperation(doc, "テキスト編集");
      } catch (error) {
        history.cancelOperation();
        throw error;
      }
      setDefaultTextStyle((prev) => ({ ...prev, ...patch }));
    },
    [doc, editingTextLayer, history, setDefaultTextStyle]
  );

  const handleTextDelete = useCallback(() => {
    if (!editingTextLayer || !doc || !history) return;
    history.beginStructureOperation(doc);
    const changed = doc.removeLayer(editingTextLayer.meta.id);
    if (changed) {
      history.commitStructureOperation(doc, "テキストレイヤー削除");
    } else {
      history.cancelOperation();
    }
  }, [doc, editingTextLayer, history]);

  const handleTextLayerCreated = useCallback((_id: string) => {
    // 新規テキストレイヤー作成時にツールを移動に戻す（誤クリック防止）
    // ここではToolは保ったまま、テキスト編集UIが右パネルに出る。
  }, []);

  return {
    editingTextLayer,
    handleTextChange,
    handleTextDelete,
    handleTextLayerCreated,
  };
}

export type TextLayerActions = ReturnType<typeof useTextLayerActions>;
