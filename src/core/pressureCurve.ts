// 筆圧カーブ：入力 pressure(0..1) → 出力 pressure(0..1) の写像。
// 4点の制御点 (x,y) を昇順 x で並べ、区間内は線形補間。シンプルだが視覚的に分かりやすい。

export interface PressureCurve {
  points: { x: number; y: number }[]; // x,y は 0..1
}

export const LINEAR_CURVE: PressureCurve = {
  points: [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ],
};

// プリセット
export const PRESET_CURVES: Record<string, PressureCurve> = {
  linear: LINEAR_CURVE,
  // 軽いタッチでも太く（コントラスト弱）
  soft: {
    points: [
      { x: 0, y: 0 },
      { x: 0.3, y: 0.55 },
      { x: 0.7, y: 0.85 },
      { x: 1, y: 1 },
    ],
  },
  // 強く押してから一気に変化（コントラスト強）
  hard: {
    points: [
      { x: 0, y: 0 },
      { x: 0.4, y: 0.1 },
      { x: 0.8, y: 0.7 },
      { x: 1, y: 1 },
    ],
  },
  // 中間が膨らむ（中筆圧で最大に近く）
  bell: {
    points: [
      { x: 0, y: 0.1 },
      { x: 0.5, y: 1 },
      { x: 1, y: 0.6 },
    ],
  },
};

export function applyCurve(curve: PressureCurve, p: number): number {
  const pts = curve.points;
  if (pts.length === 0) return p;
  if (p <= pts[0].x) return clamp01(pts[0].y);
  if (p >= pts[pts.length - 1].x) return clamp01(pts[pts.length - 1].y);
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1];
    const b = pts[i];
    if (p >= a.x && p <= b.x) {
      const t = b.x === a.x ? 0 : (p - a.x) / (b.x - a.x);
      return clamp01(a.y + (b.y - a.y) * t);
    }
  }
  return p;
}

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

// 制御点を正規化（範囲・順序）
export function normalizeCurve(curve: PressureCurve): PressureCurve {
  const pts = curve.points
    .map((p) => ({ x: clamp01(p.x), y: clamp01(p.y) }))
    .sort((a, b) => a.x - b.x);
  if (pts.length === 0) return LINEAR_CURVE;
  // 端を固定
  if (pts[0].x > 0) pts.unshift({ x: 0, y: pts[0].y });
  if (pts[pts.length - 1].x < 1) pts.push({ x: 1, y: pts[pts.length - 1].y });
  return { points: pts };
}
