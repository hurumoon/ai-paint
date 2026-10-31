export type ColorAdjustMode = "bc" | "hsl" | "levels" | "curves" | "quick";

export interface CurvePoint {
  x: number;
  y: number;
}

export const CURVE_DEFAULT: CurvePoint[] = [
  { x: 0, y: 0 },
  { x: 255, y: 255 },
];

export const COLOR_ADJUST_TABS: { value: ColorAdjustMode; label: string }[] = [
  { value: "bc", label: "明度/コントラスト" },
  { value: "hsl", label: "色相/彩度/明度" },
  { value: "levels", label: "レベル" },
  { value: "curves", label: "トーンカーブ" },
  { value: "quick", label: "簡易フィルタ" },
];
