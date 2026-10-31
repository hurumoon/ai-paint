import { compositeLayers } from "./composite";
import { htmlCanvasToBlob } from "./canvasEncoding";
import type { PaintDocument } from "./PaintDocument";
import type { Rect } from "./tileStoreGeometry";
import type { Selection } from "../types";

export const DEFAULT_AI_IMAGE_MAX_EDGE = 1024;

// AI 送信用画像のメタ情報。
export interface AIImagePayload {
  base64: string;
  width: number;
  height: number;
  scale: number;
}

export interface AISelectionImagePayload extends AIImagePayload {
  sourceRect: Rect;
}

type CroppableSelection = Exclude<Selection, { kind: "none" }>;

export function canCompareAIImagePayloads(
  previous: AIImagePayload,
  current: AIImagePayload
): boolean {
  return (
    previous.width === current.width &&
    previous.height === current.height &&
    previous.scale === current.scale
  );
}

export function canCropSelectionForAI(
  selection: Selection
): selection is CroppableSelection {
  return (
    selection.kind !== "none" &&
    Number.isFinite(selection.w) &&
    Number.isFinite(selection.h) &&
    selection.w > 4 &&
    selection.h > 4
  );
}

export async function flattenDocumentToBase64ForAI(
  doc: PaintDocument,
  maxEdge: number = DEFAULT_AI_IMAGE_MAX_EDGE
): Promise<AIImagePayload> {
  return await renderToScaledBase64(
    doc.width,
    doc.height,
    (ctx) => {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, doc.width, doc.height);
      compositeLayers(ctx, doc, doc.layers, undefined);
    },
    maxEdge
  );
}

export async function cropSelectionToBase64ForAI(
  doc: PaintDocument,
  selection: Selection,
  maxEdge: number = DEFAULT_AI_IMAGE_MAX_EDGE
): Promise<AISelectionImagePayload> {
  if (!canCropSelectionForAI(selection)) {
    throw new Error("AI解析に使える選択範囲がありません");
  }
  const sourceRect = selectionSourceRect(doc, selection);
  if (!sourceRect) {
    throw new Error("AI解析に使える選択範囲がありません");
  }
  const mask =
    selection.kind === "rect" ? null : createLocalSelectionMask(doc, selection, sourceRect);
  const payload = await renderToScaledBase64(
    sourceRect.w,
    sourceRect.h,
    (ctx) => {
      const content = document.createElement("canvas");
      content.width = sourceRect.w;
      content.height = sourceRect.h;
      const cctx = content.getContext("2d")!;
      cctx.save();
      cctx.translate(-sourceRect.x, -sourceRect.y);
      cctx.fillStyle = "#ffffff";
      cctx.fillRect(sourceRect.x, sourceRect.y, sourceRect.w, sourceRect.h);
      compositeLayers(cctx, doc, doc.layers, undefined, sourceRect);
      cctx.restore();

      if (mask) {
        cctx.save();
        cctx.globalCompositeOperation = "destination-in";
        cctx.drawImage(mask, 0, 0);
        cctx.restore();
      }

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, sourceRect.w, sourceRect.h);
      ctx.drawImage(content, 0, 0);
    },
    maxEdge
  );
  return { ...payload, sourceRect };
}

export async function cropDocumentToBase64(
  doc: PaintDocument,
  x: number,
  y: number,
  w: number,
  h: number
): Promise<string> {
  const full = document.createElement("canvas");
  full.width = doc.width;
  full.height = doc.height;
  const fctx = full.getContext("2d")!;
  fctx.fillStyle = "#ffffff";
  fctx.fillRect(0, 0, doc.width, doc.height);
  compositeLayers(fctx, doc, doc.layers, undefined);

  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d")!;
  ctx.drawImage(full, x, y, w, h, 0, 0, w, h);
  const blob = await htmlCanvasToBlob(out, "image/png");
  return blobToBase64(blob);
}

export async function cropDocumentToBase64ForAI(
  doc: PaintDocument,
  x: number,
  y: number,
  w: number,
  h: number,
  maxEdge: number = DEFAULT_AI_IMAGE_MAX_EDGE
): Promise<AIImagePayload> {
  return await renderToScaledBase64(
    w,
    h,
    (ctx) => {
      ctx.save();
      ctx.translate(-x, -y);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x, y, w, h);
      compositeLayers(ctx, doc, doc.layers, undefined, { x, y, w, h });
      ctx.restore();
    },
    maxEdge
  );
}

export async function imageDataUrlToBase64ForAI(
  dataUrl: string,
  maxEdge: number = DEFAULT_AI_IMAGE_MAX_EDGE
): Promise<AIImagePayload> {
  const img = await loadImage(dataUrl);
  const srcWidth = img.naturalWidth || img.width;
  const srcHeight = img.naturalHeight || img.height;
  if (srcWidth <= 0 || srcHeight <= 0) {
    throw new Error("画像のサイズを取得できませんでした");
  }
  return await renderToScaledBase64(
    srcWidth,
    srcHeight,
    (ctx) => {
      ctx.drawImage(img, 0, 0, srcWidth, srcHeight);
    },
    maxEdge
  );
}

export async function imageFileToBase64ForAI(
  file: Blob,
  maxEdge: number = DEFAULT_AI_IMAGE_MAX_EDGE,
  maxPixels?: number
): Promise<AIImagePayload> {
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width <= 0 || bitmap.height <= 0) {
      throw new Error("画像のサイズを取得できませんでした");
    }
    if (maxPixels !== undefined && bitmap.width * bitmap.height > maxPixels) {
      throw new Error("リファレンス画像の解像度が大きすぎます");
    }
    return await renderToScaledBase64(
      bitmap.width,
      bitmap.height,
      (ctx) => {
        ctx.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height);
      },
      maxEdge
    );
  } finally {
    bitmap.close();
  }
}

async function renderToScaledBase64(
  srcWidth: number,
  srcHeight: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
  maxEdge: number
): Promise<AIImagePayload> {
  const longEdge = Math.max(srcWidth, srcHeight);
  const scale = longEdge > maxEdge ? maxEdge / longEdge : 1;
  const outW = Math.max(1, Math.round(srcWidth * scale));
  const outH = Math.max(1, Math.round(srcHeight * scale));

  const out = document.createElement("canvas");
  out.width = outW;
  out.height = outH;
  const octx = out.getContext("2d")!;
  if (scale !== 1) {
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = "high";
    octx.scale(scale, scale);
  }
  draw(octx);
  const blob = await htmlCanvasToBlob(out, "image/png");
  return { base64: await blobToBase64(blob), width: outW, height: outH, scale };
}

export function blobToBase64(blob: Blob): Promise<string> {
  const reader = new FileReader();
  return new Promise((resolve) => {
    reader.onload = () => {
      const dataUrl = reader.result as string;
      resolve(dataUrl.replace(/^data:[^;]+;base64,/, ""));
    };
    reader.readAsDataURL(blob);
  });
}

function selectionSourceRect(doc: PaintDocument, selection: CroppableSelection): Rect | null {
  const x0 = Math.max(0, Math.floor(selection.x));
  const y0 = Math.max(0, Math.floor(selection.y));
  const x1 = Math.min(doc.width, Math.ceil(selection.x + selection.w));
  const y1 = Math.min(doc.height, Math.ceil(selection.y + selection.h));
  if (x1 - x0 <= 4 || y1 - y0 <= 4) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function createLocalSelectionMask(
  doc: PaintDocument,
  selection: Exclude<Selection, { kind: "none" } | { kind: "rect" }>,
  sourceRect: Rect
): HTMLCanvasElement {
  const mask = document.createElement("canvas");
  mask.width = sourceRect.w;
  mask.height = sourceRect.h;
  const ctx = mask.getContext("2d")!;
  ctx.fillStyle = "#000000";

  if (selection.kind === "polygon") {
    if (selection.points.length < 3) return mask;
    ctx.beginPath();
    ctx.moveTo(selection.points[0].x - sourceRect.x, selection.points[0].y - sourceRect.y);
    for (let i = 1; i < selection.points.length; i += 1) {
      ctx.lineTo(selection.points[i].x - sourceRect.x, selection.points[i].y - sourceRect.y);
    }
    ctx.closePath();
    ctx.fill();
    return mask;
  }

  const img = new ImageData(
    new Uint8ClampedArray(selection.data),
    selection.maskWidth,
    selection.maskHeight
  );
  const tmp = document.createElement("canvas");
  tmp.width = selection.maskWidth;
  tmp.height = selection.maskHeight;
  tmp.getContext("2d")!.putImageData(img, 0, 0);
  const offsetX =
    selection.maskWidth === doc.width ? -sourceRect.x : selection.x - sourceRect.x;
  const offsetY =
    selection.maskHeight === doc.height ? -sourceRect.y : selection.y - sourceRect.y;
  ctx.drawImage(tmp, offsetX, offsetY);
  return mask;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  return new Promise((resolve, reject) => {
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("画像のデコードに失敗しました"));
    img.src = src;
  });
}
