import type { BrushCategory, BrushKind } from "../types";

export const BRUSH_CATEGORIES: { value: BrushCategory; label: string }[] = [
  { value: "pen", label: "ペン系" },
  { value: "paint", label: "筆系" },
  { value: "spray", label: "スプレー系" },
  { value: "other", label: "その他系" },
];

export const BRUSH_CATEGORY_OPTIONS: Record<
  BrushCategory,
  { value: BrushKind; label: string }[]
> = {
  pen: [
    { value: "pen", label: "ペン" },
    { value: "fountainPen", label: "万年筆" },
    { value: "gPen", label: "Gペン" },
    { value: "maruPen", label: "丸ペン" },
    { value: "pencil", label: "鉛筆" },
    { value: "marker", label: "マーカー" },
    { value: "highlighter", label: "蛍光ペン" },
  ],
  paint: [
    { value: "round", label: "丸" },
    { value: "calligraphy", label: "カリグラ" },
    { value: "watercolor", label: "水彩" },
    { value: "oil", label: "油彩" },
    { value: "charcoal", label: "木炭" },
    { value: "chalk", label: "チョーク" },
    { value: "crayon", label: "クレヨン" },
    { value: "pastel", label: "パステル" },
  ],
  spray: [
    { value: "airbrush", label: "エア" },
    { value: "spray", label: "スプレー" },
    { value: "scatter", label: "散布" },
  ],
  other: [
    { value: "dotted", label: "点線" },
    { value: "neon", label: "ネオン" },
    { value: "sparkle", label: "キラキラ" },
    { value: "custom", label: "カスタム" },
  ],
};

export function isBrushKindInCategory(
  category: BrushCategory,
  kind: BrushKind
): boolean {
  return BRUSH_CATEGORY_OPTIONS[category].some((option) => option.value === kind);
}
