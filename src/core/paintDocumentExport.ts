import { htmlCanvasToBlob } from "./canvasEncoding";
import { compositeLayers } from "./composite";
import type { PaintDocument } from "./PaintDocument";

export type FlattenImageFormat = "image/png" | "image/jpeg" | "image/webp";
export type FlattenBackground = "white" | "transparent";

export function flattenDocumentToBlob(
  doc: PaintDocument,
  format: FlattenImageFormat = "image/png",
  quality: number = 0.92,
  background: FlattenBackground = "white"
): Promise<Blob> {
  const out = document.createElement("canvas");
  out.width = doc.width;
  out.height = doc.height;
  const ctx = out.getContext("2d")!;
  const needWhite = background === "white" || format === "image/jpeg";
  if (needWhite) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, doc.width, doc.height);
  }
  compositeLayers(ctx, doc, doc.layers, undefined);
  return htmlCanvasToBlob(out, format, quality);
}
