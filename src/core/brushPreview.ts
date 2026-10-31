import type { BrushKind, EraserKind } from "../types";
import { beginStroke, continueStroke, type BrushSettings, type StrokePoint } from "./brushEngine";
import type { PressureCurve } from "./pressureCurve";

interface BrushPreviewBaseOptions {
  width: number;
  height: number;
  color: string;
  size: number;
  opacity: number;
  pressureSize: number;
  pressureOpacity: number;
  pressureCurve: PressureCurve;
  antiAliasStrength: number;
}

export type BrushPreviewOptions =
  | (BrushPreviewBaseOptions & {
      tool?: "brush";
      kind: BrushKind;
    })
  | (BrushPreviewBaseOptions & {
      tool: "eraser";
      kind: EraserKind;
    });

export function drawBrushPreview(
  ctx: CanvasRenderingContext2D,
  options: BrushPreviewOptions
): void {
  const { width, height } = options;
  ctx.clearRect(0, 0, width, height);

  if (options.tool === "eraser") {
    drawEraserPreview(ctx, options);
    return;
  }

  if (options.kind === "custom") {
    drawCustomBrushPlaceholder(ctx, width, height, options.color);
    return;
  }

  const settings: BrushSettings = {
    kind: options.kind,
    size: previewBrushSize(options.kind, options.size),
    opacity: options.opacity,
    color: options.color,
    pressureSize: options.pressureSize,
    pressureOpacity: options.pressureOpacity,
    pressureCurve: options.pressureCurve,
    antiAliasStrength: options.antiAliasStrength,
  };
  const points = previewStrokePoints(width, height);

  beginStroke(ctx, points[0], settings);
  for (let i = 1; i < points.length; i += 1) {
    continueStroke(ctx, points[i - 1], points[i], settings);
  }
}

function drawEraserPreview(
  ctx: CanvasRenderingContext2D,
  options: BrushPreviewBaseOptions & { tool: "eraser"; kind: EraserKind }
): void {
  drawEraserPreviewBase(ctx, options.width, options.height, options.color);
  const settings: BrushSettings = {
    kind: eraserPreviewKind(options.kind),
    size: previewEraserSize(options.kind, options.size),
    opacity: options.opacity,
    color: "#000000",
    pressureSize: options.pressureSize,
    pressureOpacity: options.pressureOpacity,
    pressureCurve: options.pressureCurve,
    antiAliasStrength: options.antiAliasStrength,
  };
  const points = previewStrokePoints(options.width, options.height);

  beginStroke(ctx, points[0], settings);
  for (let i = 1; i < points.length; i += 1) {
    continueStroke(ctx, points[i - 1], points[i], settings);
  }
}

function drawEraserPreviewBase(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  color: string
): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.78;
  ctx.fillRect(0, 0, width, height);
  ctx.globalAlpha = 0.24;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, height * 0.52, width, height * 0.48);
  ctx.restore();
}

function eraserPreviewKind(kind: EraserKind): BrushSettings["kind"] {
  switch (kind) {
    case "round":
      return "eraser-round";
    case "hard":
      return "eraser-hard";
    case "soft":
      return "eraser-soft";
  }
}

function previewEraserSize(kind: EraserKind, size: number): number {
  const base = Math.min(24, Math.max(12, size));
  if (kind === "soft") return Math.min(28, Math.max(18, size * 0.9));
  return base;
}

function previewBrushSize(kind: BrushKind, size: number): number {
  const base = Math.min(22, Math.max(10, size));
  switch (kind) {
    case "airbrush":
    case "spray":
    case "scatter":
    case "sparkle":
      return Math.min(24, Math.max(16, size * 0.7));
    case "fountainPen":
    case "maruPen":
      return Math.min(20, Math.max(14, size * 1.5));
    case "highlighter":
      return Math.min(22, Math.max(16, size));
    default:
      return base;
  }
}

function previewStrokePoints(width: number, height: number): StrokePoint[] {
  const top = height * 0.34;
  const bottom = height * 0.7;
  return [
    { x: width * 0.1, y: bottom, pressure: 0.18 },
    { x: width * 0.28, y: top, pressure: 0.36 },
    { x: width * 0.52, y: bottom * 0.96, pressure: 0.82 },
    { x: width * 0.76, y: top * 0.92, pressure: 1 },
    { x: width * 0.91, y: height * 0.56, pressure: 0.62 },
  ];
}

function drawCustomBrushPlaceholder(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  color: string
): void {
  const cx = width * 0.5;
  const cy = height * 0.5;
  const r = Math.min(width, height) * 0.22;
  ctx.save();
  ctx.globalAlpha = 0.65;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 0.42;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx - r * 0.75, cy + r * 0.2, r * 0.45, 0, Math.PI * 2);
  ctx.arc(cx + r * 0.8, cy - r * 0.3, r * 0.34, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
