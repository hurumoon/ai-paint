import type { BrushSettings, StrokePoint } from "./brushEngine";
import { clamp01 } from "./brushDynamics";

export type AnyCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function stampAntialiasedDisk(
  ctx: AnyCtx,
  p: StrokePoint,
  radius: number,
  s: BrushSettings
): void {
  const r = Math.max(0.2, radius);
  const strength = clamp01(s.antiAliasStrength ?? 0.5);

  if (strength <= 0.001) {
    ctx.save();
    ctx.globalAlpha = s.opacity;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = s.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  const edge = Math.min(r, strength * 2);
  const inner = Math.max(0, r - edge);
  const grad = ctx.createRadialGradient(p.x, p.y, inner, p.x, p.y, r);
  grad.addColorStop(0, s.color);
  grad.addColorStop(1, transparentColor(s.color));

  ctx.save();
  ctx.globalAlpha = s.opacity;
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function transparentColor(color: string): string {
  const shortHex = color.match(/^#([0-9a-fA-F]{3})$/);
  if (shortHex) {
    const r = parseInt(shortHex[1][0] + shortHex[1][0], 16);
    const g = parseInt(shortHex[1][1] + shortHex[1][1], 16);
    const b = parseInt(shortHex[1][2] + shortHex[1][2], 16);
    return `rgba(${r}, ${g}, ${b}, 0)`;
  }

  const hex = color.match(/^#([0-9a-fA-F]{6})$/);
  if (hex) {
    const n = parseInt(hex[1], 16);
    const r = (n >> 16) & 0xff;
    const g = (n >> 8) & 0xff;
    const b = n & 0xff;
    return `rgba(${r}, ${g}, ${b}, 0)`;
  }

  const rgb = color.match(
    /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*[0-9.]+)?\s*\)$/
  );
  if (rgb) {
    return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, 0)`;
  }

  return "rgba(0, 0, 0, 0)";
}

export function drawFourPointStar(
  ctx: AnyCtx,
  cx: number,
  cy: number,
  size: number
): void {
  const inner = size * 0.22;
  ctx.beginPath();
  ctx.moveTo(cx, cy - size);
  ctx.lineTo(cx + inner, cy - inner);
  ctx.lineTo(cx + size, cy);
  ctx.lineTo(cx + inner, cy + inner);
  ctx.lineTo(cx, cy + size);
  ctx.lineTo(cx - inner, cy + inner);
  ctx.lineTo(cx - size, cy);
  ctx.lineTo(cx - inner, cy - inner);
  ctx.closePath();
  ctx.fill();
}

// #rrggbb を白方向に amount (0..1) だけ寄せる。色形式が想定外なら元の文字列を返す。
export function lightenHex(color: string, amount: number): string {
  const m = color.match(/^#([0-9a-fA-F]{6})$/);
  if (!m) return color;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  const lr = Math.round(r + (255 - r) * amount);
  const lg = Math.round(g + (255 - g) * amount);
  const lb = Math.round(b + (255 - b) * amount);
  return `rgb(${lr}, ${lg}, ${lb})`;
}
