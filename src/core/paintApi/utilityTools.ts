import { compositeLayers } from "../composite";
import { requireState } from "./helpers";
import type { PaintApi } from "./PaintApi";
import { enumSchema, objectSchema } from "./schemas";
import { PaintApiFault } from "./types";

export function registerUtilityTools(api: PaintApi): void {
  api.register({
    name: "document.sample_color",
    description: "指定座標の色をアクティブレイヤーまたは合成結果から取得します。",
    parameters: objectSchema({
      x: { type: "integer", minimum: 0 }, y: { type: "integer", minimum: 0 },
      source: enumSchema(["active", "composite"]),
    }, ["x", "y"]),
    mutates: false,
  }, (args, { app }) => {
    const { doc } = requireState(app); const x = args.x as number; const y = args.y as number;
    if (x >= doc.width || y >= doc.height) throw new PaintApiFault("INVALID_ARGUMENT", "採色位置がキャンバス外です");
    let data: Uint8ClampedArray;
    if (args.source === "composite") {
      const canvas = document.createElement("canvas"); canvas.width = 1; canvas.height = 1;
      const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("Canvas 2D context を作成できません");
      ctx.translate(-x, -y);
      compositeLayers(ctx, doc, doc.layers, undefined, { x, y, w: 1, h: 1 });
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      data = ctx.getImageData(0, 0, 1, 1).data;
    } else {
      const layer = doc.getActiveLayer();
      if (!layer || layer.meta.kind === "group") throw new PaintApiFault("INVALID_ARGUMENT", "採色できるアクティブレイヤーがありません");
      doc.materializeLayer(layer); data = layer.store.getImageData(x, y, 1, 1).data;
    }
    const [r, g, b, a] = data;
    return { r, g, b, a, hex: `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`, alpha: a / 255 };
  });

  api.register({
    name: "layer.pick",
    description: "指定座標で最前面の表示中・不透明画素を持つレイヤーを選択します。",
    parameters: objectSchema({ x: { type: "integer", minimum: 0 }, y: { type: "integer", minimum: 0 } }, ["x", "y"]),
    mutates: true,
  }, (args, { app }) => {
    const { doc } = requireState(app); const x = args.x as number; const y = args.y as number;
    if (x >= doc.width || y >= doc.height) throw new PaintApiFault("INVALID_ARGUMENT", "レイヤー選択位置がキャンバス外です");
    for (let index = doc.layers.length - 1; index >= 0; index -= 1) {
      const layer = doc.layers[index];
      if (layer.meta.kind === "group" || !isAncestorVisible(doc, layer.meta.id)) continue;
      doc.materializeLayer(layer);
      if (layer.store.getImageData(x, y, 1, 1).data[3] > 0) {
        const changed = layer.meta.id !== doc.activeLayerId;
        if (changed) doc.setActiveLayer(layer.meta.id);
        return { changed, layerId: layer.meta.id, name: layer.meta.name };
      }
    }
    throw new PaintApiFault("INVALID_ARGUMENT", "指定位置に描画済みレイヤーがありません");
  });
}

function isAncestorVisible(doc: import("../PaintDocument").PaintDocument, layerId: string): boolean {
  let current = doc.getLayer(layerId);
  while (current) {
    if (!current.meta.visible || current.meta.opacity <= 0) return false;
    current = current.meta.parentId ? doc.getLayer(current.meta.parentId) : undefined;
  }
  return true;
}
