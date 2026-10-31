import type { BrushSettings, StrokePoint } from "./brushEngine";
import { applyCurve, LINEAR_CURVE } from "./pressureCurve";

export interface BrushStrokeBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function stampSpacing(s: BrushSettings): number {
  switch (s.kind) {
    case "airbrush":
    case "spray":
      return Math.max(0.5, s.size * 0.05);
    case "calligraphy":
      return Math.max(1, s.size * 0.15);
    case "marker":
      return Math.max(0.5, s.size * 0.1);
    case "pencil":
    case "charcoal":
      return Math.max(0.5, s.size * 0.12);
    case "watercolor":
      return Math.max(0.5, s.size * 0.08);
    case "pen":
      return Math.max(0.3, s.size * 0.08);
    case "crayon":
      return Math.max(0.5, s.size * 0.15);
    case "dotted":
      return Math.max(s.size, s.size * 1.4);
    case "custom":
      return Math.max(0.5, s.size * (s.custom?.spacingRatio ?? 0.2));
    case "oil":
      return Math.max(0.5, s.size * 0.1);
    case "pastel":
      return Math.max(0.5, s.size * 0.13);
    case "fountainPen":
      return Math.max(0.3, s.size * 0.06);
    case "chalk":
      return Math.max(0.5, s.size * 0.14);
    case "scatter":
      return Math.max(2, s.size * 0.9);
    case "gPen":
      return Math.max(0.3, s.size * 0.06);
    case "maruPen":
      return Math.max(0.3, s.size * 0.05);
    case "highlighter":
      return Math.max(0.5, s.size * 0.12);
    case "neon":
      return Math.max(0.5, s.size * 0.08);
    case "sparkle":
      return Math.max(2, s.size * 0.6);
    case "round":
    case "eraser-round":
    case "eraser-soft":
      return Math.max(0.5, s.size * 0.18);
    case "eraser-hard":
      return Math.max(0.5, s.size * 0.22);
  }
}

export function shapedPressure(p: StrokePoint, s: BrushSettings): number {
  const curve = s.pressureCurve ?? LINEAR_CURVE;
  return applyCurve(curve, clamp01(p.pressure));
}

export function stampSize(p: StrokePoint, s: BrushSettings): number {
  // pressureSize で筆圧感度を制御。0 で常に最大サイズ、1 で筆圧そのまま
  const sens = clamp01(s.pressureSize ?? 0);
  // 感度0 → factor=1 固定、感度1 → factor=shaped pressure (0..1)
  const shaped = shapedPressure(p, s);
  const factor = 1 - sens + sens * shaped;
  return Math.max(0.5, s.size * Math.max(0.05, factor));
}

export function effectiveOpacity(p: StrokePoint, s: BrushSettings): number {
  const sens = clamp01(s.pressureOpacity ?? 0);
  const shaped = shapedPressure(p, s);
  const factor = 1 - sens + sens * shaped;
  return Math.max(0, Math.min(1, s.opacity * factor));
}

export function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

export function brushStrokeBounds(
  p1: StrokePoint,
  p2: StrokePoint,
  s: BrushSettings
): BrushStrokeBounds {
  const margin = brushDirtyMargin(s);
  const x1 = Math.min(p1.x, p2.x) - margin;
  const y1 = Math.min(p1.y, p2.y) - margin;
  const x2 = Math.max(p1.x, p2.x) + margin;
  const y2 = Math.max(p1.y, p2.y) + margin;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

// stamp 粒子と glow の最大広がりを Canvas hook へ漏らさないための安全側マージン。
// scatter/charcoal など size/2 を超える stamp も履歴と再合成範囲に必ず含める。
function brushDirtyMargin(s: BrushSettings): number {
  return s.size + 4;
}
