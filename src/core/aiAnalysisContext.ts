import { GuideShape } from "../types";
import { htmlCanvasToBlob } from "./canvasEncoding";
import { flattenDocumentToBlob } from "./paintDocumentExport";
import { PaintDocument } from "./PaintDocument";

const QUADRANT_MAX_EDGE = 640;
const FOCUS_MAX_EDGE = 768;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type QuadrantId = "leftTop" | "rightTop" | "leftBottom" | "rightBottom";

export interface AnalysisImage {
  base64: string;
  label: string;
}

export interface QuadrantAnalysisImage extends AnalysisImage {
  id: QuadrantId;
  rect: Rect;
  sentWidth: number;
  sentHeight: number;
}

export interface QuadrantAnalysisContext {
  images: QuadrantAnalysisImage[];
  text: string;
}

export interface AnalysisContext {
  images: AnalysisImage[];
  text: string;
}

interface CanvasSnapshot {
  canvas: HTMLCanvasElement;
  bitmap: ImageBitmap;
}

const QUADRANTS: { label: string; x: number; y: number }[] = [
  { label: "左上", x: 0, y: 0 },
  { label: "右上", x: 0.5, y: 0 },
  { label: "左下", x: 0, y: 0.5 },
  { label: "右下", x: 0.5, y: 0.5 },
];

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function hex2(n: number): string {
  return clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0");
}

function rgbaToHex(r: number, g: number, b: number): string {
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}

async function createSnapshot(doc: PaintDocument): Promise<CanvasSnapshot> {
  const blob = await flattenDocumentToBlob(doc, "image/png", 0.92, "white");
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  return { canvas, bitmap };
}

function releaseSnapshot(snapshot: CanvasSnapshot): void {
  snapshot.bitmap.close();
}

async function encodeCrop(
  source: HTMLCanvasElement,
  rect: Rect,
  maxEdge: number
): Promise<{ base64: string; width: number; height: number }> {
  const cropW = Math.max(1, Math.round(rect.w));
  const cropH = Math.max(1, Math.round(rect.h));
  const longEdge = Math.max(cropW, cropH);
  const scale = longEdge > maxEdge ? maxEdge / longEdge : 1;
  const outW = Math.max(1, Math.round(cropW * scale));
  const outH = Math.max(1, Math.round(cropH * scale));
  const out = document.createElement("canvas");
  out.width = outW;
  out.height = outH;
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, rect.x, rect.y, cropW, cropH, 0, 0, outW, outH);
  const blob = await htmlCanvasToBlob(out, "image/png");
  return {
    base64: await blobToBase64(blob),
    width: outW,
    height: outH,
  };
}

function blobToBase64(blob: Blob): Promise<string> {
  const reader = new FileReader();
  return new Promise((resolve) => {
    reader.onload = () => {
      const dataUrl = reader.result as string;
      resolve(dataUrl.replace(/^data:[^;]+;base64,/, ""));
    };
    reader.readAsDataURL(blob);
  });
}

function sampleColor(
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
  radius: number
): string {
  const sx = clamp(Math.round(x), 0, canvas.width - 1);
  const sy = clamp(Math.round(y), 0, canvas.height - 1);
  const r = Math.max(0, Math.floor(radius));
  const x0 = clamp(sx - r, 0, canvas.width - 1);
  const y0 = clamp(sy - r, 0, canvas.height - 1);
  const x1 = clamp(sx + r, 0, canvas.width - 1);
  const y1 = clamp(sy + r, 0, canvas.height - 1);
  const ctx = canvas.getContext("2d")!;
  const data = ctx.getImageData(x0, y0, x1 - x0 + 1, y1 - y0 + 1).data;
  let rr = 0;
  let gg = 0;
  let bb = 0;
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    rr += data[i];
    gg += data[i + 1];
    bb += data[i + 2];
    count += 1;
  }
  return rgbaToHex(rr / count, gg / count, bb / count);
}

function summarizeLayers(doc: PaintDocument): string {
  const byId = new Map(doc.layers.map((layer) => [layer.meta.id, layer]));
  const depthOf = (id: string): number => {
    let depth = 0;
    let parentId = byId.get(id)?.meta.parentId;
    const visited = new Set<string>();
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      depth += 1;
      parentId = byId.get(parentId)?.meta.parentId;
    }
    return depth;
  };

  const lines = [...doc.layers]
    .reverse()
    .map((layer, index) => {
      const meta = layer.meta;
      const kind = meta.kind ?? "raster";
      const flags = [
        meta.id === doc.activeLayerId ? "active" : "",
        meta.visible ? "" : "hidden",
        meta.locked ? "locked" : "",
        meta.transparentPixelLock ? "transparent locked" : "",
        meta.clippingMask ? "clip" : "",
        layer.deferred ? "deferred" : "",
      ].filter(Boolean);
      const detail = [
        kind,
        `opacity ${Math.round(meta.opacity * 100)}%`,
        meta.blendMode !== "normal" ? meta.blendMode : "",
        flags.length > 0 ? flags.join(",") : "",
      ].filter(Boolean);
      return `${index + 1}. ${"  ".repeat(depthOf(meta.id))}${meta.name} (${detail.join("; ")})`;
    });

  return [
    `キャンバス: ${doc.width}x${doc.height}px`,
    "レイヤー構成（上から下）:",
    ...lines,
  ].join("\n");
}

function rectText(rect: Rect): string {
  return `x=${Math.round(rect.x)}, y=${Math.round(rect.y)}, w=${Math.round(rect.w)}, h=${Math.round(rect.h)}`;
}

function clampRect(rect: Rect, doc: PaintDocument): Rect | null {
  const x0 = clamp(Math.floor(rect.x), 0, doc.width - 1);
  const y0 = clamp(Math.floor(rect.y), 0, doc.height - 1);
  const x1 = clamp(Math.ceil(rect.x + rect.w), x0 + 1, doc.width);
  const y1 = clamp(Math.ceil(rect.y + rect.h), y0 + 1, doc.height);
  const w = x1 - x0;
  const h = y1 - y0;
  return w > 0 && h > 0 ? { x: x0, y: y0, w, h } : null;
}

function expandRect(rect: Rect, doc: PaintDocument): Rect | null {
  const minSize = Math.min(Math.max(Math.max(doc.width, doc.height) * 0.18, 96), 384);
  const pad = Math.max(Math.max(doc.width, doc.height) * 0.04, 24);
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const w = Math.max(rect.w + pad * 2, minSize);
  const h = Math.max(rect.h + pad * 2, minSize);
  return clampRect({ x: cx - w / 2, y: cy - h / 2, w, h }, doc);
}

function guideToRect(guide: GuideShape, doc: PaintDocument): Rect | null {
  if (guide.type === "rect") {
    return expandRect(guide, doc);
  }
  if (guide.type === "circle") {
    return expandRect(
      {
        x: guide.cx - guide.r,
        y: guide.cy - guide.r,
        w: guide.r * 2,
        h: guide.r * 2,
      },
      doc
    );
  }
  return expandRect(
    {
      x: Math.min(guide.x1, guide.x2),
      y: Math.min(guide.y1, guide.y2),
      w: Math.abs(guide.x2 - guide.x1),
      h: Math.abs(guide.y2 - guide.y1),
    },
    doc
  );
}

function dedupeRects(rects: Rect[]): Rect[] {
  const out: Rect[] = [];
  for (const rect of rects) {
    const duplicate = out.some((prev) => {
      const dx = Math.abs(prev.x + prev.w / 2 - (rect.x + rect.w / 2));
      const dy = Math.abs(prev.y + prev.h / 2 - (rect.y + rect.h / 2));
      return dx < Math.min(prev.w, rect.w) * 0.25 && dy < Math.min(prev.h, rect.h) * 0.25;
    });
    if (!duplicate) out.push(rect);
  }
  return out;
}

export async function buildQuadrantAnalysisContext(
  doc: PaintDocument
): Promise<QuadrantAnalysisContext> {
  const snapshot = await createSnapshot(doc);
  try {
    const specs: { id: QuadrantId; x: number; y: number }[] = [
      { id: "leftTop", x: 0, y: 0 },
      { id: "rightTop", x: 0.5, y: 0 },
      { id: "leftBottom", x: 0, y: 0.5 },
      { id: "rightBottom", x: 0.5, y: 0.5 },
    ];
    const images: QuadrantAnalysisImage[] = [];
    const lines = [
      "4分割画像です。気になる箇所を1つだけ選ぶために使います。",
      summarizeLayers(doc),
      "",
      "quadrants:",
    ];

    for (const spec of specs) {
      const rect = {
        x: Math.round(doc.width * spec.x),
        y: Math.round(doc.height * spec.y),
        w: Math.round(doc.width / 2),
        h: Math.round(doc.height / 2),
      };
      const encoded = await encodeCrop(snapshot.canvas, rect, QUADRANT_MAX_EDGE);
      const centerX = rect.x + rect.w / 2;
      const centerY = rect.y + rect.h / 2;
      const centerColor = sampleColor(snapshot.canvas, centerX, centerY, 2);
      const label = `${spec.id} quadrant (${rectText(rect)}, sent ${encoded.width}x${encoded.height}, center ${Math.round(centerX)},${Math.round(centerY)} color ${centerColor})`;
      images.push({
        id: spec.id,
        base64: encoded.base64,
        label,
        rect,
        sentWidth: encoded.width,
        sentHeight: encoded.height,
      });
      lines.push(`- ${label}`);
    }

    return { images, text: lines.join("\n") };
  } finally {
    releaseSnapshot(snapshot);
  }
}

export async function buildInitialAnalysisContext(
  doc: PaintDocument
): Promise<AnalysisContext> {
  const snapshot = await createSnapshot(doc);
  try {
    const images: AnalysisImage[] = [];
    const lines = [
      "AI強化モード用の補助情報:",
      summarizeLayers(doc),
      "",
      "4分割確認用の部分画像:",
    ];

    for (const q of QUADRANTS) {
      const rect = {
        x: Math.round(doc.width * q.x),
        y: Math.round(doc.height * q.y),
        w: Math.round(doc.width / 2),
        h: Math.round(doc.height / 2),
      };
      const encoded = await encodeCrop(snapshot.canvas, rect, QUADRANT_MAX_EDGE);
      const centerX = rect.x + rect.w / 2;
      const centerY = rect.y + rect.h / 2;
      const centerColor = sampleColor(snapshot.canvas, centerX, centerY, 2);
      const label = `${q.label} quadrant (${rectText(rect)}, sent ${encoded.width}x${encoded.height}, center ${Math.round(centerX)},${Math.round(centerY)} color ${centerColor})`;
      images.push({ base64: encoded.base64, label });
      lines.push(`- ${label}`);
    }

    lines.push(
      "",
      "必要なら4分割画像も見比べ、特に気になる箇所はguidesで示してください。左上など局所に違和感がある場合は、その領域を優先して具体的に評価してください。"
    );
    return { images, text: lines.join("\n") };
  } finally {
    releaseSnapshot(snapshot);
  }
}

export async function buildFocusAnalysisContext(
  doc: PaintDocument,
  guides: GuideShape[],
  maxCount: number = 2
): Promise<AnalysisContext | null> {
  const rects = dedupeRects(
    guides
      .map((guide) => guideToRect(guide, doc))
      .filter((rect): rect is Rect => rect !== null)
  ).slice(0, maxCount);
  if (rects.length === 0) return null;

  const snapshot = await createSnapshot(doc);
  try {
    const images: AnalysisImage[] = [];
    const lines = [
      "追加精査情報:",
      "最初の解析でAIが気にした箇所を拡大し、周辺色をサンプルしました。",
    ];

    for (let i = 0; i < rects.length; i += 1) {
      const rect = rects[i];
      const encoded = await encodeCrop(snapshot.canvas, rect, FOCUS_MAX_EDGE);
      const cx = rect.x + rect.w / 2;
      const cy = rect.y + rect.h / 2;
      const samples = [
        { label: "center", x: cx, y: cy },
        { label: "left-top", x: rect.x + rect.w * 0.25, y: rect.y + rect.h * 0.25 },
        { label: "right-bottom", x: rect.x + rect.w * 0.75, y: rect.y + rect.h * 0.75 },
      ]
        .map((p) => {
          const color = sampleColor(snapshot.canvas, p.x, p.y, 2);
          return `${p.label} ${Math.round(p.x)},${Math.round(p.y)}=${color}`;
        })
        .join(", ");
      const label = `focus ${i + 1} (${rectText(rect)}, sent ${encoded.width}x${encoded.height}, colors: ${samples})`;
      images.push({ base64: encoded.base64, label });
      lines.push(`- ${label}`);
    }

    lines.push(
      "この追加画像とカラーコードを根拠に、最初の見立てを修正または具体化してください。返すguidesはメイン画像全体の0.0〜1.0正規化座標にしてください。"
    );
    return { images, text: lines.join("\n") };
  } finally {
    releaseSnapshot(snapshot);
  }
}
