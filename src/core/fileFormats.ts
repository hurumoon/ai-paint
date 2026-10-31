import type { PaintDocument } from "./PaintDocument";
import { saveAiPaint } from "./nativeFormat";
import { flattenDocumentToBlob } from "./paintDocumentExport";
import { blobWithImageDpi } from "../utils/imageDpi";
import type { SaveFileFilter } from "../utils/saveFile";

export type SaveFormat = "aipaint" | "psd" | "png" | "jpeg" | "webp";
export type ImageSaveFormat = Extract<SaveFormat, "png" | "jpeg" | "webp">;

export const OPEN_FILE_EXTENSIONS = [
  "aipaint",
  "psd",
  "png",
  "jpg",
  "jpeg",
  "webp",
] as const;
export const OPEN_FILE_ACCEPT = OPEN_FILE_EXTENSIONS.map((ext) => `.${ext}`).join(",");

export const OPEN_IMAGE_FILTERS: SaveFileFilter[] = [
  {
    name: "AI Paint / 画像",
    extensions: [...OPEN_FILE_EXTENSIONS],
  },
  { name: "すべてのファイル", extensions: ["*"] },
];

export const DIRECT_IMAGE_FILTERS: SaveFileFilter[] = [
  {
    name: "画像 (PNG/JPEG/WebP)",
    extensions: ["png", "jpg", "jpeg", "webp"],
  },
];

export function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(2)} MB`;
}

export function pickImageFormatFromPath(path: string): ImageSaveFormat | null {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "jpeg";
  if (lower.endsWith(".webp")) return "webp";
  return null;
}

export function pickFormatFromPath(path: string): SaveFormat | null {
  const lower = path.toLowerCase();
  if (lower.endsWith(".aipaint")) return "aipaint";
  if (lower.endsWith(".psd")) return "psd";
  return pickImageFormatFromPath(path);
}

export function isSupportedOpenFilePath(path: string): boolean {
  return pickFormatFromPath(path) !== null;
}

export function defaultFilenameForFormat(format: SaveFormat): string {
  const ext = format === "psd" ? "psd" : "aipaint";
  return `ai-paint-${new Date().toISOString().replace(/[:.]/g, "-")}.${ext}`;
}

export function saveFilterForFormat(format: SaveFormat): SaveFileFilter {
  switch (format) {
    case "psd":
      return { name: "PSD (レイヤー保持)", extensions: ["psd"] };
    case "png":
      return { name: "PNG (透過)", extensions: ["png"] };
    case "jpeg":
      return { name: "JPEG", extensions: ["jpg", "jpeg"] };
    case "webp":
      return { name: "WebP", extensions: ["webp"] };
    case "aipaint":
    default:
      return { name: ".aipaint (レイヤー保持)", extensions: ["aipaint"] };
  }
}

export async function buildSaveBlob(
  targetDoc: PaintDocument,
  format: SaveFormat,
): Promise<Blob> {
  switch (format) {
    case "psd":
      return (await import("./psdFormat")).savePsd(targetDoc);
    case "png": {
      const raw = await flattenDocumentToBlob(targetDoc, "image/png", 0.92, "transparent");
      return blobWithImageDpi(raw, "png", targetDoc.dpi);
    }
    case "jpeg": {
      const raw = await flattenDocumentToBlob(targetDoc, "image/jpeg", 0.92, "white");
      return blobWithImageDpi(raw, "jpeg", targetDoc.dpi);
    }
    case "webp": {
      const raw = await flattenDocumentToBlob(targetDoc, "image/webp", 0.92, "transparent");
      return blobWithImageDpi(raw, "webp", targetDoc.dpi);
    }
    case "aipaint":
    default:
      return saveAiPaint(targetDoc);
  }
}
