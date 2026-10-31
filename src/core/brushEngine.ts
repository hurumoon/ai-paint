import { BrushKind } from "../types";
import { stampSpacing } from "./brushDynamics";
import { paintStamp } from "./brushStamps";
import type { AnyCtx } from "./brushStampPrimitives";
import type { PressureCurve } from "./pressureCurve";

// スタンプベースのブラシエンジン。
// 一定間隔ごとに「スタンプ」を打ち、隣り合うスタンプを補間で繋ぐことで滑らかな線を作る。
// CanvasRenderingContext2D の stroke よりも、種ごとの硬さ/フチを細かく制御できる。

export interface StrokePoint {
  x: number;
  y: number;
  pressure: number; // 0..1, 筆圧ない時は 0.5 固定
}

// カスタムブラシ実行時の追加情報
export interface CustomBrushRuntime {
  bitmap: ImageBitmap;
  spacingRatio: number;
  tint: boolean;
}

export interface BrushSettings {
  kind: BrushKind | "eraser-round" | "eraser-hard" | "eraser-soft" | "custom";
  size: number;
  opacity: number;
  color: string; // 消しゴム時は無視
  // 筆圧感度 (0..1)。0 で筆圧無効（常に最大）、1 で筆圧そのまま反映
  pressureSize?: number;
  pressureOpacity?: number;
  // 筆圧カーブ（適用順は: pressure → curve → size/opacity の感度）
  pressureCurve?: PressureCurve;
  antiAliasStrength?: number;
  // カスタムブラシ実行時のみ設定
  custom?: CustomBrushRuntime;
}

// ===== 手振れ補正（スタビライザ） =====
// pull-string方式: 実カーソルとペン先の間にバネを置き、追従に遅延を与える。
// strength: 0 (無効) ~ 0.95 (極端な遅延)
export class StrokeStabilizer {
  private strength: number;
  private penTip: StrokePoint | null = null;
  constructor(strength: number) {
    this.strength = Math.max(0, Math.min(0.95, strength));
  }
  setStrength(s: number): void {
    this.strength = Math.max(0, Math.min(0.95, s));
  }
  reset(): void {
    this.penTip = null;
  }
  // 実カーソル位置を入れて、補正済みペン先位置を返す。stable===nullなら描画しない
  feed(p: StrokePoint): StrokePoint {
    if (this.strength <= 0.001) {
      this.penTip = p;
      return p;
    }
    if (!this.penTip) {
      this.penTip = { ...p };
      return this.penTip;
    }
    const lerp = 1 - this.strength;
    this.penTip = {
      x: this.penTip.x + (p.x - this.penTip.x) * lerp,
      y: this.penTip.y + (p.y - this.penTip.y) * lerp,
      pressure: this.penTip.pressure + (p.pressure - this.penTip.pressure) * lerp,
    };
    return this.penTip;
  }
  // ストローク終了時、ペン先を実カーソルまで滑らせるため、複数ステップで詰める
  flush(target: StrokePoint, steps = 6): StrokePoint[] {
    if (!this.penTip || this.strength <= 0.001) return [target];
    const out: StrokePoint[] = [];
    const lerp = 1 - this.strength;
    for (let i = 0; i < steps; i += 1) {
      this.penTip = {
        x: this.penTip.x + (target.x - this.penTip.x) * lerp,
        y: this.penTip.y + (target.y - this.penTip.y) * lerp,
        pressure:
          this.penTip.pressure +
          (target.pressure - this.penTip.pressure) * lerp,
      };
      out.push({ ...this.penTip });
    }
    return out;
  }
}

// ===== 公開 API =====

// ストローク開始時に1回呼ぶ。点も打つ。
export function beginStroke(ctx: AnyCtx, p: StrokePoint, s: BrushSettings): void {
  paintStamp(ctx, p, s);
}

// ストローク中、毎フレーム前回と今回の間を補間しつつスタンプを打つ。
export function continueStroke(
  ctx: AnyCtx,
  prev: StrokePoint,
  next: StrokePoint,
  s: BrushSettings
): void {
  const spacing = stampSpacing(s);
  const dx = next.x - prev.x;
  const dy = next.y - prev.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 0.0001) return;
  const steps = Math.max(1, Math.ceil(dist / spacing));
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    paintStamp(
      ctx,
      {
        x: prev.x + dx * t,
        y: prev.y + dy * t,
        pressure: prev.pressure + (next.pressure - prev.pressure) * t,
      },
      s
    );
  }
}
