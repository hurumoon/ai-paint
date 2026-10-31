/// <reference lib="webworker" />

export type ReqFlood = {
  id: number;
  op: "flood";
  width: number;
  height: number;
  startX: number;
  startY: number;
  fill: [number, number, number, number];
  tolerance: number;
  // 線画の隙間を埋める半径 (0で無効)
  gapClose: number;
  // 塗り結果を膨張させる半径 (0で無効)
  expand: number;
  // 参照画像 (線画を含む合成画像) があれば、その alpha を「壁」として塗る
  refBuffer?: ArrayBuffer;
  buffer: ArrayBuffer;
};

export type ReqBlur = {
  id: number;
  op: "blur";
  width: number;
  height: number;
  radius: number;
  buffer: ArrayBuffer;
};

export type GradientStop = {
  pos: number; // 0..1
  rgba: [number, number, number, number];
};

export type ReqLinearGradient = {
  id: number;
  op: "gradient-linear";
  width: number;
  height: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  // stops が渡された場合はそちらを優先。空なら from/to の2色補間にフォールバック。
  stops?: GradientStop[];
  from: [number, number, number, number];
  to: [number, number, number, number];
};

export type ReqRadialGradient = {
  id: number;
  op: "gradient-radial";
  width: number;
  height: number;
  cx: number;
  cy: number;
  r: number;
  stops?: GradientStop[];
  from: [number, number, number, number];
  to: [number, number, number, number];
};

export type ReqPalette = {
  id: number;
  op: "palette";
  width: number;
  height: number;
  k: number;
  buffer: ArrayBuffer;
};

export type PaintWorkerRequest =
  | ReqFlood
  | ReqBlur
  | ReqLinearGradient
  | ReqRadialGradient
  | ReqPalette;

export function reply(
  id: number,
  payload: Record<string, unknown>,
  transfer: Transferable[]
): void {
  (self as unknown as Worker).postMessage({ id, ...payload }, transfer);
}
