import type { TextLayerData } from "../types";
import type { PixelLayer } from "./PaintDocument";

type AnyMeasureCtx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

let measurementCtx: AnyMeasureCtx | null = null;

function getMeasurementCtx(): AnyMeasureCtx {
  if (measurementCtx) return measurementCtx;
  if (typeof OffscreenCanvas !== "undefined") {
    measurementCtx = new OffscreenCanvas(1, 1).getContext("2d") as AnyMeasureCtx;
  } else {
    measurementCtx = document.createElement("canvas").getContext("2d") as AnyMeasureCtx;
  }
  return measurementCtx;
}

export function measureTextLayerBBox(
  docWidth: number,
  docHeight: number,
  text: TextLayerData
): { x: number; y: number; w: number; h: number } | null {
  if (!text.text) return null;
  const ctx = getMeasurementCtx();
  const weight = text.bold ? "700" : "400";
  const style = text.italic ? "italic" : "normal";
  ctx.font = `${style} ${weight} ${text.fontSize}px ${text.fontFamily}`;

  const lines = text.text.split(/\r?\n/);
  const lineH = text.fontSize * text.lineHeight;
  const vSpan = Math.max(lineH, text.fontSize * 1.5);
  const hMargin = Math.max(4, text.fontSize * 0.25);
  const topMargin = Math.max(4, text.fontSize * 0.3);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let i = 0; i < lines.length; i += 1) {
    let lineW = ctx.measureText(lines[i]).width;
    if (text.maxWidth !== undefined && text.maxWidth > 0 && lineW > text.maxWidth) {
      lineW = text.maxWidth;
    }
    let lineX: number;
    if (text.align === "left") lineX = text.x;
    else if (text.align === "center") lineX = text.x - lineW / 2;
    else lineX = text.x - lineW;
    const lineY = text.y + i * lineH;
    minX = Math.min(minX, lineX - hMargin);
    maxX = Math.max(maxX, lineX + lineW + hMargin);
    minY = Math.min(minY, lineY - topMargin);
    maxY = Math.max(maxY, lineY + vSpan);
  }
  if (!Number.isFinite(minX)) return null;
  const x0 = Math.max(0, Math.floor(minX));
  const y0 = Math.max(0, Math.floor(minY));
  const x1 = Math.min(docWidth, Math.ceil(maxX));
  const y1 = Math.min(docHeight, Math.ceil(maxY));
  if (x0 >= x1 || y0 >= y1) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function renderTextToLayer(
  layer: PixelLayer,
  docWidth: number,
  docHeight: number,
  text: TextLayerData
): void {
  layer.store.clearRect(0, 0, docWidth, docHeight);
  const hint = measureTextLayerBBox(docWidth, docHeight, text);
  if (!hint) return;
  layer.store.withCtx((rawCtx) => {
    const ctx = rawCtx as CanvasRenderingContext2D;
    const weight = text.bold ? "700" : "400";
    const style = text.italic ? "italic" : "normal";
    ctx.font = `${style} ${weight} ${text.fontSize}px ${text.fontFamily}`;
    ctx.fillStyle = text.color;
    ctx.textBaseline = "top";
    ctx.textAlign = text.align;

    const lines = text.text.split(/\r?\n/);
    const lineH = text.fontSize * text.lineHeight;
    for (let i = 0; i < lines.length; i += 1) {
      ctx.fillText(lines[i], text.x, text.y + i * lineH, text.maxWidth);
    }
  }, hint);
}
