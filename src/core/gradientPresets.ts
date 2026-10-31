// グラデーションのプリセット定義。worker（マルチストップ補間）と
// Canvas プレビュー（CanvasGradient.addColorStop）の双方から参照する。

import { GradientPreset } from "../types";
import { GradientStop } from "../workers/paintWorkerClient";

// 7色相のレインボー。両端をループさせず素直に赤→紫で並べる。
const RAINBOW_HEX: { pos: number; color: string }[] = [
  { pos: 0.0, color: "#ff0000" },
  { pos: 1 / 6, color: "#ff8800" },
  { pos: 2 / 6, color: "#ffee00" },
  { pos: 3 / 6, color: "#00cc44" },
  { pos: 4 / 6, color: "#0088ff" },
  { pos: 5 / 6, color: "#3322cc" },
  { pos: 1.0, color: "#9900cc" },
];

function hexToTuple(hex: string, alpha: number): [number, number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
    Math.round(alpha * 255),
  ];
}

// worker に渡す用。fromAlpha→toAlpha を pos に沿って線形にフェードさせる。
export function buildPresetStops(
  preset: GradientPreset,
  fromAlpha: number,
  toAlpha: number
): GradientStop[] | undefined {
  if (preset !== "rainbow") return undefined;
  return RAINBOW_HEX.map(({ pos, color }) => {
    const a = fromAlpha + (toAlpha - fromAlpha) * pos;
    return { pos, rgba: hexToTuple(color, a) };
  });
}

// プレビュー（CanvasGradient）用。toTransparent 指定時は終端を透明にフェード。
export function applyPresetToCanvasGradient(
  grad: CanvasGradient,
  preset: GradientPreset,
  fromColor: string,
  toColor: string,
  toTransparent: boolean
): void {
  if (preset === "rainbow") {
    for (const { pos, color } of RAINBOW_HEX) {
      if (toTransparent) {
        // 終端に向かって不透明度を下げるため、rgba 文字列にして渡す
        const [r, g, b] = hexToTuple(color, 1);
        const a = 1 - pos; // pos=0 で 1.0, pos=1 で 0
        grad.addColorStop(pos, `rgba(${r},${g},${b},${a})`);
      } else {
        grad.addColorStop(pos, color);
      }
    }
    return;
  }
  grad.addColorStop(0, fromColor);
  grad.addColorStop(1, toTransparent ? "rgba(0,0,0,0)" : toColor);
}
