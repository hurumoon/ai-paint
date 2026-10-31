import type { ReqFlood } from "./paintWorkerTypes";
import { reply } from "./paintWorkerTypes";

export function handleFlood(req: ReqFlood): void {
  const { width, height, startX, startY, fill, tolerance, gapClose, expand } = req;
  const data = new Uint8ClampedArray(req.buffer);
  const sx = Math.floor(startX);
  const sy = Math.floor(startY);
  if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
    return reply(req.id, { buffer: data.buffer }, [data.buffer]);
  }
  const startIdx = (sy * width + sx) * 4;

  // 「壁マップ」を構築する：参照画像（合成画像）か、塗り対象データ自身を使う
  const refData = req.refBuffer ? new Uint8ClampedArray(req.refBuffer) : data;
  // スタート色は wallMap と同じ座標系から取らないと、空レイヤー (data 側が透明)
  // をクリックした時に refData 側の色との差が常に閾値超になり、クリック点自身が
  // 「壁」扱いされて塗りが skip されるバグを起こす。refBuffer 経路でも data 経路でも
  // refData = wallMap の参照元から sr/sg/sb/sa を取る。
  const sr = refData[startIdx];
  const sg = refData[startIdx + 1];
  const sb = refData[startIdx + 2];
  const sa = refData[startIdx + 3];
  // 線画判定: refData の alpha が高い & スタート色との差が大きいピクセルは壁
  // 単純化: alpha>=64 で「ペイント済み」とみなし、スタート色と異なれば壁
  const wallMap = new Uint8Array(width * height);
  for (let i = 0; i < wallMap.length; i += 1) {
    const idx = i * 4;
    const a = refData[idx + 3];
    if (a < 32) {
      wallMap[i] = 0; // 透明は壁ではない
      continue;
    }
    // スタート色との距離
    const dr = refData[idx] - sr;
    const dg = refData[idx + 1] - sg;
    const db = refData[idx + 2] - sb;
    const da = a - sa;
    if (Math.abs(dr) > tolerance || Math.abs(dg) > tolerance || Math.abs(db) > tolerance || Math.abs(da) > tolerance) {
      wallMap[i] = 1;
    }
  }

  // gapClose: 壁マップを N px 膨張させて隙間を閉じる
  let effectiveWall: Uint8Array = wallMap;
  if (gapClose > 0) {
    effectiveWall = dilateBinary(wallMap, width, height, Math.max(1, Math.min(16, Math.floor(gapClose))));
  }

  // 塗り対象マスクを生成（壁ではないピクセル & 連結）
  const fillMask = new Uint8Array(width * height);
  // BFS / DFS
  const startP = sy * width + sx;
  if (effectiveWall[startP]) {
    // 開始点が壁内: gapClose で潰された可能性。そのまま塗らずに返す
    return reply(req.id, { buffer: data.buffer }, [data.buffer]);
  }
  const stack: number[] = [sx, sy];
  fillMask[startP] = 1;
  while (stack.length > 0) {
    const y = stack.pop()!;
    const x = stack.pop()!;
    // 4近傍
    if (x > 0) {
      const np = y * width + (x - 1);
      if (!fillMask[np] && !effectiveWall[np]) {
        fillMask[np] = 1;
        stack.push(x - 1, y);
      }
    }
    if (x < width - 1) {
      const np = y * width + (x + 1);
      if (!fillMask[np] && !effectiveWall[np]) {
        fillMask[np] = 1;
        stack.push(x + 1, y);
      }
    }
    if (y > 0) {
      const np = (y - 1) * width + x;
      if (!fillMask[np] && !effectiveWall[np]) {
        fillMask[np] = 1;
        stack.push(x, y - 1);
      }
    }
    if (y < height - 1) {
      const np = (y + 1) * width + x;
      if (!fillMask[np] && !effectiveWall[np]) {
        fillMask[np] = 1;
        stack.push(x, y + 1);
      }
    }
  }

  // expand: 塗りマスクを膨張させて線画の下に潜り込ませる
  let effectiveFill: Uint8Array = fillMask;
  if (expand > 0) {
    effectiveFill = dilateBinary(fillMask, width, height, Math.max(1, Math.min(16, Math.floor(expand))));
  }

  // 結果を data に書く
  for (let i = 0; i < effectiveFill.length; i += 1) {
    if (effectiveFill[i]) {
      const idx = i * 4;
      data[idx] = fill[0];
      data[idx + 1] = fill[1];
      data[idx + 2] = fill[2];
      data[idx + 3] = fill[3];
    }
  }
  reply(req.id, { buffer: data.buffer }, [data.buffer]);
}

// 2値マスクを r px 膨張 (チェビシェフ距離)
function dilateBinary(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  // 2pass: 水平 → 垂直
  const tmp = new Uint8Array(src.length);
  const out = new Uint8Array(src.length);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let v = 0;
      const xStart = Math.max(0, x - r);
      const xEnd = Math.min(w - 1, x + r);
      for (let xi = xStart; xi <= xEnd; xi += 1) {
        if (src[y * w + xi]) { v = 1; break; }
      }
      tmp[y * w + x] = v;
    }
  }
  for (let x = 0; x < w; x += 1) {
    for (let y = 0; y < h; y += 1) {
      let v = 0;
      const yStart = Math.max(0, y - r);
      const yEnd = Math.min(h - 1, y + r);
      for (let yi = yStart; yi <= yEnd; yi += 1) {
        if (tmp[yi * w + x]) { v = 1; break; }
      }
      out[y * w + x] = v;
    }
  }
  return out;
}
