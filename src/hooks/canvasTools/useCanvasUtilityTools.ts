import { useCallback } from "react";
import type { RefObject } from "react";
import type { History } from "../../core/History";
import type { PaintDocument } from "../../core/PaintDocument";
import { pushToast } from "../../ui/primitives";
import type { TextLayerData, Tool } from "../../types";

interface Point {
  x: number;
  y: number;
}

interface UseCanvasUtilityToolsParams {
  doc: PaintDocument;
  history: History;
  compositeRef: RefObject<HTMLCanvasElement | null>;
  eyedropperSampleAllLayers: boolean;
  defaultTextStyle: TextLayerData;
  onPickColor: (hex: string) => void;
  onTextLayerCreated: (layerId: string) => void;
  isAutoBackupBusy?: () => boolean;
}

export function useCanvasUtilityTools({
  doc,
  history,
  compositeRef,
  eyedropperSampleAllLayers,
  defaultTextStyle,
  onPickColor,
  onTextLayerCreated,
  isAutoBackupBusy,
}: UseCanvasUtilityToolsParams) {
  const handleUtilityToolAt = useCallback(
    (pos: Point, tool: Tool): boolean => {
      if (tool === "layerPick") {
        const ix = Math.floor(pos.x);
        const iy = Math.floor(pos.y);
        if (ix < 0 || iy < 0 || ix >= doc.width || iy >= doc.height) {
          return true;
        }

        for (let i = doc.layers.length - 1; i >= 0; i -= 1) {
          const layer = doc.layers[i];
          if (layer.meta.kind === "group") continue;
          if (!isAncestorVisible(doc, layer.meta.id)) continue;
          doc.materializeLayer(layer);
          const px = layer.store.getImageData(ix, iy, 1, 1).data;
          if (px[3] > 0) {
            if (layer.meta.id !== doc.activeLayerId) {
              doc.setActiveLayer(layer.meta.id);
            }
            return true;
          }
        }
        pushToast("ここにはピクセルがありません", "info");
        return true;
      }

      if (tool === "eyedropper") {
        const ix = Math.floor(pos.x);
        const iy = Math.floor(pos.y);
        let data: Uint8ClampedArray | null = null;
        if (eyedropperSampleAllLayers) {
          const ctx = compositeRef.current?.getContext("2d");
          if (!ctx) return true;
          data = ctx.getImageData(ix, iy, 1, 1).data;
        } else {
          const active = doc.getActiveLayer();
          if (active) {
            doc.materializeLayer(active);
            const px = active.store.getImageData(ix, iy, 1, 1).data;
            if (px[3] > 0) data = px;
          }
        }
        if (data) {
          const hex =
            "#" +
            [data[0], data[1], data[2]]
              .map((v) => v.toString(16).padStart(2, "0"))
              .join("");
          onPickColor(hex);
        }
        return true;
      }

      if (tool === "text") {
        if (isAutoBackupBusy?.()) {
          pushToast("自動バックアップ中です。少し待ってから再操作してください", "info");
          return true;
        }
        const text: TextLayerData = {
          ...defaultTextStyle,
          x: pos.x,
          y: pos.y,
          text: defaultTextStyle.text || "テキスト",
        };
        history.beginStructureOperation(doc);
        const layer = doc.addTextLayer(text, "テキスト");
        history.commitStructureOperation(doc, "テキストレイヤー追加");
        onTextLayerCreated(layer.meta.id);
        return true;
      }

      return false;
    },
    [
      compositeRef,
      defaultTextStyle,
      doc,
      eyedropperSampleAllLayers,
      history,
      isAutoBackupBusy,
      onPickColor,
      onTextLayerCreated,
    ]
  );

  return { handleUtilityToolAt };
}

function isAncestorVisible(doc: PaintDocument, layerId: string): boolean {
  let current = doc.getLayer(layerId);
  while (current) {
    if (!current.meta.visible) return false;
    const parentId = current.meta.parentId;
    if (!parentId) return true;
    current = doc.getLayer(parentId);
  }
  return true;
}
