import type { LayerMeta, TextLayerData } from "../../types";
import { MAX_AIPAINT_DPI, MAX_AIPAINT_TEXT_LENGTH } from "../nativeFormatParts/constants";
import { MAX_RASTER_IMAGE_DIMENSION } from "../rasterImageLimits";
import { requireState, throwIfAborted, withStructureHistory } from "./helpers";
import type { PaintApi } from "./PaintApi";
import { blendModes, colorSchema, emptyObjectSchema, enumSchema, objectSchema } from "./schemas";
import { PaintApiFault } from "./types";

const layerIdSchema = { type: "string", minLength: 1, maxLength: 200 };

export function registerLayerAndCanvasTools(api: PaintApi): void {
  registerLayerTools(api);
  registerHistoryTools(api);
  registerCanvasTools(api);
}

function registerLayerTools(api: PaintApi): void {
  api.register({
    name: "layer.add",
    description: "アクティブ位置の上へラスターレイヤーを追加します。",
    parameters: objectSchema({ name: { type: "string", minLength: 1, maxLength: 500 } }),
    mutates: true,
  }, async (args, { app }) => {
    const { doc, history } = requireState(app);
    const layer = await withStructureHistory(doc, history, "API レイヤー追加", () => {
      const added = doc.addLayer(args.name as string | undefined);
      doc.setActiveLayer(added.meta.id);
      return added;
    });
    return { layerId: layer.meta.id };
  });

  api.register({
    name: "layer.add_group",
    description: "アクティブ位置へグループを追加します。",
    parameters: objectSchema({ name: { type: "string", minLength: 1, maxLength: 500 } }),
    mutates: true,
  }, async (args, { app }) => {
    const { doc, history } = requireState(app);
    const layer = await withStructureHistory(doc, history, "API グループ追加", () => doc.addGroup(args.name as string | undefined));
    return { layerId: layer.meta.id };
  });

  api.register({
    name: "layer.add_text",
    description: "編集可能なテキストレイヤーを追加し、既存ラスタライズ処理で描画します。",
    parameters: textParameters(false),
    mutates: true,
  }, async (args, { app }) => {
    const { doc, history } = requireState(app);
    const text = parseTextData(args);
    const layer = await withStructureHistory(doc, history, "API テキスト追加", () => doc.addTextLayer(text, args.name as string | undefined));
    return { layerId: layer.meta.id };
  });

  api.register({
    name: "layer.duplicate",
    description: "ラスターレイヤーまたはテキストレイヤーを画素・メタデータごと複製します。",
    parameters: objectSchema({ layerId: layerIdSchema, name: { type: "string", minLength: 1, maxLength: 500 } }, ["layerId"]),
    mutates: true,
  }, async (args, { app }) => {
    const { doc, history } = requireState(app); const sourceId = args.layerId as string;
    const source = doc.getLayer(sourceId);
    if (!source) throw new PaintApiFault("INVALID_ARGUMENT", "複製元レイヤーが見つかりません");
    if (source.meta.kind === "group") throw new PaintApiFault("INVALID_ARGUMENT", "グループ複製は未対応です。子レイヤーを個別に複製してください");
    const copy = await withStructureHistory(doc, history, "API レイヤー複製", () => {
      doc.setActiveLayer(sourceId);
      const name = (args.name as string | undefined) ?? `${source.meta.name} のコピー`;
      const added = source.meta.kind === "text" && source.meta.text
        ? doc.addTextLayer({ ...source.meta.text }, name)
        : doc.addLayer(name);
      if (source.meta.kind !== "text") {
        const offsetX = source.deferred?.offsetX ?? 0;
        const offsetY = source.deferred?.offsetY ?? 0;
        const w = source.deferred?.bboxWidth ?? doc.width;
        const h = source.deferred?.bboxHeight ?? doc.height;
        added.store.withCtx((ctx) => source.store.drawTo(ctx, offsetX, offsetY), {
          x: offsetX, y: offsetY, w, h,
        });
      }
      doc.updateLayerMeta(added.meta.id, {
        visible: source.meta.visible,
        opacity: source.meta.opacity,
        blendMode: source.meta.blendMode,
        locked: source.meta.locked,
        transparentPixelLock: source.meta.transparentPixelLock,
        clippingMask: source.meta.clippingMask,
        parentId: source.meta.parentId,
      });
      doc.setActiveLayer(added.meta.id);
      return added;
    });
    return { layerId: copy.meta.id, sourceLayerId: sourceId };
  });

  api.register({
    name: "layer.update_text",
    description: "既存テキストレイヤーを編集し、同じテキスト描画処理で再描画します。",
    parameters: textParameters(true),
    mutates: true,
  }, async (args, { app }) => {
    const { doc, history } = requireState(app);
    const id = args.layerId as string;
    const layer = doc.getLayer(id);
    if (!layer || layer.meta.kind !== "text" || !layer.meta.text) throw new PaintApiFault("INVALID_ARGUMENT", "テキストレイヤーが見つかりません");
    if (layer.meta.locked) throw new PaintApiFault("LOCKED", "テキストレイヤーはロックされています");
    const patch = pickTextPatch(args);
    await withStructureHistory(doc, history, "API テキスト編集", () => doc.updateTextLayer(id, patch), { pixelLayerIds: [id] });
    return { layerId: id };
  });

  api.register({
    name: "layer.remove",
    description: "レイヤーまたはグループとその子孫を削除します。最後の描画レイヤーは削除できません。",
    parameters: objectSchema({ layerId: layerIdSchema }, ["layerId"]),
    mutates: true,
  }, async (args, { app }) => {
    const { doc, history } = requireState(app); const id = args.layerId as string;
    if (!doc.getLayer(id)) throw new PaintApiFault("INVALID_ARGUMENT", "レイヤーが見つかりません");
    await withStructureHistory(doc, history, "API レイヤー削除", () => doc.removeLayer(id));
    return { removedLayerId: id, activeLayerId: doc.activeLayerId };
  });

  api.register({
    name: "layer.merge_down",
    description: "見た目を安全に保持できる場合だけ下の同階層レイヤーと結合します。",
    parameters: objectSchema({ layerId: layerIdSchema }, ["layerId"]),
    mutates: true,
  }, async (args, { app }) => {
    const { doc, history } = requireState(app); const id = args.layerId as string;
    const index = doc.layers.findIndex((layer) => layer.meta.id === id);
    if (index <= 0) throw new PaintApiFault("INVALID_ARGUMENT", "結合対象がありません");
    const lowerId = doc.layers[index - 1].meta.id;
    await withStructureHistory(doc, history, "API 下のレイヤーと結合", () => doc.mergeDown(id), { pixelLayerIds: [lowerId] });
    return { layerId: doc.activeLayerId };
  });

  api.register({
    name: "layer.reorder",
    description: "レイヤーを指定グループと兄弟位置へ移動します。",
    parameters: objectSchema({
      layerId: layerIdSchema,
      parentId: { anyOf: [layerIdSchema, { type: "null" }] },
      beforeId: layerIdSchema,
    }, ["layerId"]),
    mutates: true,
  }, (args, { app }) => {
    const { doc, history } = requireState(app); const id = args.layerId as string;
    const layer = doc.getLayer(id); if (!layer) throw new PaintApiFault("INVALID_ARGUMENT", "レイヤーが見つかりません");
    const parentId = args.parentId as string | null | undefined;
    const beforeId = args.beforeId as string | undefined;
    if (parentId && doc.getLayer(parentId)?.meta.kind !== "group") throw new PaintApiFault("INVALID_ARGUMENT", "移動先グループが見つかりません");
    const beforeOrder = doc.layers.map((entry) => entry.meta.id).join("\0"); const beforeParent = layer.meta.parentId;
    history.beginStructureOperation(doc);
    try {
      doc.reorderLayer(id, parentId, beforeId);
      if (beforeOrder === doc.layers.map((entry) => entry.meta.id).join("\0") && beforeParent === layer.meta.parentId) {
        history.cancelOperation(); throw new PaintApiFault("INVALID_ARGUMENT", "指定位置へ移動できません");
      }
      history.commitStructureOperation(doc, "API レイヤー並び替え");
      return { layerId: id, parentId: layer.meta.parentId ?? null };
    } catch (error) { history.cancelOperation(); throw error; }
  });

  api.register({
    name: "layer.set_active",
    description: "アクティブレイヤーを変更します。",
    parameters: objectSchema({ layerId: layerIdSchema }, ["layerId"]),
    mutates: true,
  }, (args, { app }) => {
    const { doc } = requireState(app); const id = args.layerId as string;
    if (!doc.getLayer(id)) throw new PaintApiFault("INVALID_ARGUMENT", "レイヤーが見つかりません");
    doc.setActiveLayer(id); return { layerId: id };
  });

  api.register({
    name: "layer.update_meta",
    description: "レイヤー名、表示、透明度、合成、各ロック、クリッピング、グループ開閉を履歴付きで変更します。",
    parameters: objectSchema({
      layerId: layerIdSchema, name: { type: "string", minLength: 1, maxLength: 500 },
      visible: { type: "boolean" }, opacity: { type: "number", minimum: 0, maximum: 1 },
      blendMode: enumSchema(blendModes), locked: { type: "boolean" },
      transparentPixelLock: { type: "boolean" }, clippingMask: { type: "boolean" },
      collapsed: { type: "boolean" },
    }, ["layerId"]),
    mutates: true,
  }, (args, { app }) => {
    const { doc, history } = requireState(app); const id = args.layerId as string;
    const layer = doc.getLayer(id); if (!layer) throw new PaintApiFault("INVALID_ARGUMENT", "レイヤーが見つかりません");
    const patch: Partial<LayerMeta> = {};
    for (const key of ["name", "visible", "opacity", "blendMode", "locked", "transparentPixelLock", "clippingMask", "collapsed"] as const) {
      if (args[key] !== undefined) (patch as Record<string, unknown>)[key] = args[key];
    }
    if (Object.keys(patch).length === 0) throw new PaintApiFault("INVALID_ARGUMENT", "変更項目がありません");
    if (layer.meta.kind === "group" && (patch.transparentPixelLock !== undefined || patch.clippingMask !== undefined)) {
      throw new PaintApiFault("INVALID_ARGUMENT", "グループには透明ピクセルロックやクリッピングを設定できません");
    }
    history.recordMetaChange(doc, [id], "API レイヤー設定", () => doc.updateLayerMeta(id, patch));
    return { layerId: id, meta: { ...doc.getLayer(id)!.meta } };
  });
}

function registerHistoryTools(api: PaintApi): void {
  api.register({ name: "history.undo", description: "1操作戻します。", parameters: emptyObjectSchema, mutates: true }, (_args, { app }) => {
    const { doc, history } = requireState(app); if (!history.canUndo()) return { changed: false };
    history.undo(doc); return { changed: true, canUndo: history.canUndo(), canRedo: history.canRedo() };
  });
  api.register({ name: "history.redo", description: "1操作進めます。", parameters: emptyObjectSchema, mutates: true }, (_args, { app }) => {
    const { doc, history } = requireState(app); if (!history.canRedo()) return { changed: false };
    history.redo(doc); return { changed: true, canUndo: history.canUndo(), canRedo: history.canRedo() };
  });
}

function registerCanvasTools(api: PaintApi): void {
  api.register({
    name: "canvas.resize",
    description: "キャンバスと全レイヤーをリサイズ。既存UIと同様に履歴を消去し、テキストはラスタライズします。",
    parameters: objectSchema({ width: { type: "integer", minimum: 1, maximum: MAX_RASTER_IMAGE_DIMENSION }, height: { type: "integer", minimum: 1, maximum: MAX_RASTER_IMAGE_DIMENSION } }, ["width", "height"]),
    mutates: true,
  }, (args, { app, signal }) => {
    const { doc, history } = requireState(app); throwIfAborted(signal);
    const width = args.width as number; const height = args.height as number;
    if (width === doc.width && height === doc.height) return { changed: false };
    doc.resize(width, height); history.clear(); app.setSelection({ kind: "none" });
    return { changed: true, width: doc.width, height: doc.height, historyRecorded: false };
  });
  api.register({
    name: "canvas.extend",
    description: "上下左右へキャンバスを拡張または縮小。既存UIと同様に履歴を消去します。",
    parameters: objectSchema({ top: { type: "integer" }, right: { type: "integer" }, bottom: { type: "integer" }, left: { type: "integer" } }, ["top", "right", "bottom", "left"]),
    mutates: true,
  }, (args, { app, signal }) => {
    const { doc, history } = requireState(app); throwIfAborted(signal);
    const values = [args.top, args.right, args.bottom, args.left] as number[];
    const width = doc.width + values[1] + values[3]; const height = doc.height + values[0] + values[2];
    if (width < 1 || height < 1 || width > MAX_RASTER_IMAGE_DIMENSION || height > MAX_RASTER_IMAGE_DIMENSION) throw new PaintApiFault("INVALID_ARGUMENT", "拡張後のキャンバスサイズが範囲外です");
    if (values.every((value) => value === 0)) return { changed: false };
    doc.extendCanvas(values[0], values[1], values[2], values[3]); history.clear(); app.setSelection({ kind: "none" });
    return { changed: true, width: doc.width, height: doc.height, historyRecorded: false };
  });
  api.register({
    name: "canvas.set_dpi",
    description: "キャンバスの DPI メタデータを変更します。画素数は変えません。",
    parameters: objectSchema({ dpi: { type: "integer", minimum: 1, maximum: MAX_AIPAINT_DPI } }, ["dpi"]),
    mutates: true,
  }, (args, { app }) => {
    const { doc } = requireState(app); const dpi = args.dpi as number;
    if (dpi === doc.dpi) return { changed: false, dpi };
    doc.setDpi(dpi); return { changed: true, dpi: doc.dpi, historyRecorded: false };
  });
}

function textParameters(includeLayerId: boolean): import("./types").JsonSchema {
  const properties = {
    ...(includeLayerId ? { layerId: layerIdSchema } : {}),
    name: { type: "string", minLength: 1, maxLength: 500 },
    text: { type: "string", maxLength: MAX_AIPAINT_TEXT_LENGTH }, fontFamily: { type: "string", minLength: 1, maxLength: 500 },
    fontSize: { type: "number", minimum: 1, maximum: 10000 }, color: colorSchema,
    bold: { type: "boolean" }, italic: { type: "boolean" }, align: enumSchema(["left", "center", "right"]),
    x: { type: "number" }, y: { type: "number" }, maxWidth: { type: "number", minimum: 1 }, lineHeight: { type: "number", minimum: 0.1, maximum: 20 },
  };
  const required = includeLayerId ? ["layerId"] : ["text", "fontFamily", "fontSize", "color", "bold", "italic", "align", "x", "y", "lineHeight"];
  return objectSchema(properties, required);
}
function parseTextData(args: Record<string, unknown>): TextLayerData {
  return { text: args.text as string, fontFamily: args.fontFamily as string, fontSize: args.fontSize as number, color: args.color as string, bold: args.bold as boolean, italic: args.italic as boolean, align: args.align as TextLayerData["align"], x: args.x as number, y: args.y as number, lineHeight: args.lineHeight as number, ...(args.maxWidth === undefined ? {} : { maxWidth: args.maxWidth as number }) };
}
function pickTextPatch(args: Record<string, unknown>): Partial<TextLayerData> {
  const patch: Partial<TextLayerData> = {};
  for (const key of ["text", "fontFamily", "fontSize", "color", "bold", "italic", "align", "x", "y", "maxWidth", "lineHeight"] as const) {
    if (args[key] !== undefined) (patch as Record<string, unknown>)[key] = args[key];
  }
  if (Object.keys(patch).length === 0) throw new PaintApiFault("INVALID_ARGUMENT", "テキストの変更項目がありません");
  return patch;
}
