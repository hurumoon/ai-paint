import { compositeLayers } from "../composite";
import {
  identitySelectionTransform,
  transformedRectBounds,
  transformSelectionGeometry,
  type SelectionTransform,
} from "../selectionTransform";
import { magicWandMask, selectionBBox, selectionMaskCanvas } from "../toolHandlers";
import type { Selection } from "../../types";
import { requireActiveDrawable, requireState, selectionSummary, throwIfAborted } from "./helpers";
import type { PaintApi } from "./PaintApi";
import { emptyObjectSchema, enumSchema, objectSchema, pointSchema } from "./schemas";
import { PaintApiFault } from "./types";

export function registerSelectionTools(api: PaintApi): void {
  api.register({
    name: "selection.get",
    description: "現在の選択範囲を返します。マスクの巨大な画素配列は返しません。",
    parameters: emptyObjectSchema,
    mutates: false,
  }, (_args, { app }) => selectionSummary(requireState(app).selection));

  api.register({
    name: "selection.get_mask",
    description: "現在の選択範囲を切り出した PNG マスクとして返します。アルファが選択強度です。",
    parameters: emptyObjectSchema,
    mutates: false,
  }, (_args, { app }) => {
    const { doc, selection } = requireState(app);
    if (selection.kind === "none") throw new PaintApiFault("INVALID_ARGUMENT", "選択範囲がありません");
    const bbox = selectionBBox(selection, doc.width, doc.height);
    const mask = selectionMaskCanvas(selection, doc.width, doc.height);
    if (!mask || bbox.w <= 0 || bbox.h <= 0) throw new PaintApiFault("INVALID_ARGUMENT", "選択マスクが空です");
    const out = document.createElement("canvas"); out.width = bbox.w; out.height = bbox.h;
    const ctx = out.getContext("2d"); if (!ctx) throw new Error("Canvas 2D context を作成できません");
    ctx.drawImage(mask, bbox.x, bbox.y, bbox.w, bbox.h, 0, 0, bbox.w, bbox.h);
    return { dataUrl: out.toDataURL("image/png"), mimeType: "image/png", width: bbox.w, height: bbox.h, region: { x: bbox.x, y: bbox.y, width: bbox.w, height: bbox.h } };
  });

  api.register({
    name: "selection.set_mask",
    description: "PNG のアルファを選択強度としてマスク選択を設定します。",
    parameters: objectSchema({
      dataUrl: { type: "string", pattern: "^data:image/png;base64,", maxLength: 33554432 },
      x: { type: "integer", minimum: 0 }, y: { type: "integer", minimum: 0 },
    }, ["dataUrl", "x", "y"]),
    mutates: true,
  }, async (args, { app, signal }) => {
    const { doc } = requireState(app); throwIfAborted(signal);
    const image = await loadImage(args.dataUrl as string);
    const x = args.x as number; const y = args.y as number;
    if (image.naturalWidth < 1 || image.naturalHeight < 1 || x + image.naturalWidth > doc.width || y + image.naturalHeight > doc.height) {
      throw new PaintApiFault("INVALID_ARGUMENT", "選択マスクがキャンバス外です");
    }
    const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("Canvas 2D context を作成できません");
    ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const bounds = alphaBounds(pixels);
    if (!bounds) throw new PaintApiFault("INVALID_ARGUMENT", "選択マスクに不透明画素がありません");
    const cropped = ctx.getImageData(bounds.x, bounds.y, bounds.w, bounds.h);
    const selection: Selection = { kind: "mask", data: cropped.data, maskWidth: cropped.width, maskHeight: cropped.height, x: x + bounds.x, y: y + bounds.y, w: bounds.w, h: bounds.h };
    throwIfAborted(signal); app.setSelection(selection);
    return selectionSummary(selection);
  });

  api.register({
    name: "selection.set",
    description: "選択を解除するか、矩形または多角形の選択範囲を設定します。",
    parameters: { anyOf: [
      objectSchema({ kind: { type: "string", enum: ["none"] } }, ["kind"]),
      objectSchema({ kind: { type: "string", enum: ["rect"] }, x: { type: "number" }, y: { type: "number" }, width: { type: "number", minimum: 0.01 }, height: { type: "number", minimum: 0.01 } }, ["kind", "x", "y", "width", "height"]),
      objectSchema({ kind: { type: "string", enum: ["polygon"] }, points: { type: "array", minItems: 3, maxItems: 10000, items: pointSchema } }, ["kind", "points"]),
    ] },
    mutates: true,
  }, (args, { app }) => {
    const { doc } = requireState(app);
    let selection: Selection;
    if (args.kind === "none") selection = { kind: "none" };
    else if (args.kind === "rect") {
      const x = args.x as number; const y = args.y as number;
      const w = args.width as number; const h = args.height as number;
      if (x < 0 || y < 0 || x + w > doc.width || y + h > doc.height) {
        throw new PaintApiFault("INVALID_ARGUMENT", "選択範囲がキャンバス外です");
      }
      selection = { kind: "rect", x, y, w, h };
    } else {
      const points = args.points as Array<{x:number;y:number}>;
      if (points.some((point) => point.x < 0 || point.y < 0 || point.x > doc.width || point.y > doc.height)) {
        throw new PaintApiFault("INVALID_ARGUMENT", "選択点がキャンバス外です");
      }
      const xs = points.map((point) => point.x); const ys = points.map((point) => point.y);
      const x = Math.min(...xs); const y = Math.min(...ys);
      selection = { kind: "polygon", points, x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
    }
    app.setSelection(selection);
    return selectionSummary(selection);
  });

  api.register({
    name: "selection.magic",
    description: "アクティブレイヤーまたは合成画像の色からマジックワンド選択を作ります。",
    parameters: objectSchema({
      x: { type: "integer", minimum: 0 }, y: { type: "integer", minimum: 0 },
      tolerance: { type: "number", minimum: 0, maximum: 442 },
      contiguous: { type: "boolean" }, source: enumSchema(["active", "composite"]),
    }, ["x", "y", "tolerance", "contiguous"]),
    mutates: true,
  }, (args, { app }) => {
    const { doc } = requireState(app);
    const x = args.x as number; const y = args.y as number;
    if (x >= doc.width || y >= doc.height) throw new PaintApiFault("INVALID_ARGUMENT", "選択開始点がキャンバス外です");
    let image: ImageData;
    if (args.source === "composite") {
      const canvas = document.createElement("canvas"); canvas.width = doc.width; canvas.height = doc.height;
      const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("Canvas 2D context を作成できません");
      compositeLayers(ctx, doc, doc.layers, undefined);
      image = ctx.getImageData(0, 0, doc.width, doc.height);
    } else {
      const layer = requireActiveDrawable(doc); doc.materializeLayer(layer);
      image = layer.store.getImageData(0, 0, doc.width, doc.height);
    }
    const mask = magicWandMask(image, x, y, args.tolerance as number, args.contiguous as boolean);
    const selection: Selection = mask ? { kind: "mask", ...mask } : { kind: "none" };
    app.setSelection(selection);
    return selectionSummary(selection);
  });

  api.register({
    name: "selection.transform",
    description: "選択中のアクティブレイヤー画素を移動、拡縮、回転します。",
    parameters: objectSchema({
      translateX: { type: "number" }, translateY: { type: "number" },
      scaleX: { type: "number", minimum: -20, maximum: 20 },
      scaleY: { type: "number", minimum: -20, maximum: 20 },
      rotationDegrees: { type: "number", minimum: -36000, maximum: 36000 },
      interpolation: enumSchema(["smooth", "pixelated"]),
    }),
    mutates: true,
  }, async (args, { app, signal }) => {
    const { doc, history, timelapse, selection } = requireState(app);
    if (selection.kind === "none") throw new PaintApiFault("INVALID_ARGUMENT", "変形する選択範囲がありません");
    const layer = requireActiveDrawable(doc);
    if (layer.meta.transparentPixelLock) throw new PaintApiFault("LOCKED", "透明ピクセルロック中は選択画素を変形できません");
    const box = selectionBBox(selection, doc.width, doc.height);
    const transform: SelectionTransform = {
      ...identitySelectionTransform(box),
      translateX: (args.translateX as number | undefined) ?? 0,
      translateY: (args.translateY as number | undefined) ?? 0,
      scaleX: (args.scaleX as number | undefined) ?? 1,
      scaleY: (args.scaleY as number | undefined) ?? 1,
      rotation: (((args.rotationDegrees as number | undefined) ?? 0) * Math.PI) / 180,
    };
    if (Math.abs(transform.scaleX) < 0.01 || Math.abs(transform.scaleY) < 0.01) {
      throw new PaintApiFault("INVALID_ARGUMENT", "scale は0にできません");
    }
    history.beginOperation(doc, [layer.meta.id]);
    try {
      const source = document.createElement("canvas"); source.width = doc.width; source.height = doc.height;
      const sourceCtx = source.getContext("2d"); if (!sourceCtx) throw new Error("Canvas 2D context を作成できません");
      layer.store.drawTo(sourceCtx, 0, 0);
      const mask = selectionMaskCanvas(selection, doc.width, doc.height);
      if (!mask) throw new PaintApiFault("INVALID_ARGUMENT", "選択マスクが空です");
      const selected = document.createElement("canvas"); selected.width = doc.width; selected.height = doc.height;
      const selectedCtx = selected.getContext("2d")!; selectedCtx.drawImage(source, 0, 0);
      selectedCtx.globalCompositeOperation = "destination-in"; selectedCtx.drawImage(mask, 0, 0);
      const output = document.createElement("canvas"); output.width = doc.width; output.height = doc.height;
      const outputCtx = output.getContext("2d")!; outputCtx.drawImage(source, 0, 0);
      outputCtx.globalCompositeOperation = "destination-out"; outputCtx.drawImage(mask, 0, 0);
      outputCtx.globalCompositeOperation = "source-over";
      outputCtx.imageSmoothingEnabled = args.interpolation !== "pixelated";
      applyTransform(outputCtx, transform, () => outputCtx.drawImage(selected, 0, 0));
      throwIfAborted(signal);
      layer.store.putImageData(outputCtx.getImageData(0, 0, doc.width, doc.height), 0, 0);
      const nextSelection = transformSelectionMask(selection, mask, transform, doc.width, doc.height);
      app.setSelection(nextSelection);
      doc.invalidateActive(); history.commitOperation(doc, "API 選択範囲変形", [layer.meta.id]);
      await timelapse.captureIfEnabled(doc);
      return { changed: true, layerId: layer.meta.id, selection: selectionSummary(nextSelection) };
    } catch (error) { history.cancelOperation(); throw error; }
  });
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new PaintApiFault("INVALID_ARGUMENT", "PNG 選択マスクを読み込めません"));
    image.src = source;
  });
}

function alphaBounds(image: ImageData): { x: number; y: number; w: number; h: number } | null {
  let minX = image.width; let minY = image.height; let maxX = -1; let maxY = -1;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (image.data[(y * image.width + x) * 4 + 3] === 0) continue;
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
  }
  return maxX < minX ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function applyTransform(ctx: CanvasRenderingContext2D, transform: SelectionTransform, draw: () => void): void {
  ctx.save();
  ctx.translate(transform.centerX + transform.translateX, transform.centerY + transform.translateY);
  ctx.rotate(transform.rotation); ctx.scale(transform.scaleX, transform.scaleY);
  ctx.translate(-transform.centerX, -transform.centerY); draw(); ctx.restore();
}

function transformSelectionMask(selection: Selection, mask: HTMLCanvasElement, transform: SelectionTransform, width: number, height: number): Selection {
  if (selection.kind !== "mask") return transformSelectionGeometry(selection, transform);
  const transformed = document.createElement("canvas"); transformed.width = width; transformed.height = height;
  const ctx = transformed.getContext("2d")!; applyTransform(ctx, transform, () => ctx.drawImage(mask, 0, 0));
  const raw = transformedRectBounds(selectionBBox(selection, width, height), transform);
  const x = Math.max(0, Math.floor(raw.x)); const y = Math.max(0, Math.floor(raw.y));
  const x2 = Math.min(width, Math.ceil(raw.x + raw.w)); const y2 = Math.min(height, Math.ceil(raw.y + raw.h));
  if (x2 <= x || y2 <= y) return { kind: "none" };
  const image = ctx.getImageData(x, y, x2 - x, y2 - y);
  return { kind: "mask", data: image.data, maskWidth: image.width, maskHeight: image.height, x, y, w: image.width, h: image.height };
}
