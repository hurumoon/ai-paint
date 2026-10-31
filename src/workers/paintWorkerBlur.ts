import type { ReqBlur } from "./paintWorkerTypes";
import { reply } from "./paintWorkerTypes";

// 高速 box blur を3回適用してガウシアン近似
export function handleBlur(req: ReqBlur): void {
  const { width, height, radius } = req;
  const data = new Uint8ClampedArray(req.buffer);
  if (radius < 1) {
    return reply(req.id, { buffer: data.buffer }, [data.buffer]);
  }
  const r = Math.max(1, Math.round(radius));
  // 3回ボックスで近似（質と速度のバランス）
  for (let pass = 0; pass < 3; pass += 1) {
    boxBlurH(data, width, height, r);
    boxBlurV(data, width, height, r);
  }
  reply(req.id, { buffer: data.buffer }, [data.buffer]);
}

function boxBlurH(data: Uint8ClampedArray, w: number, h: number, r: number): void {
  const out = new Uint8ClampedArray(data.length);
  const win = r * 2 + 1;
  for (let y = 0; y < h; y += 1) {
    let sumR = 0, sumG = 0, sumB = 0, sumA = 0;
    const rowStart = y * w * 4;
    for (let i = -r; i <= r; i += 1) {
      const x = Math.max(0, Math.min(w - 1, i));
      const idx = rowStart + x * 4;
      sumR += data[idx];
      sumG += data[idx + 1];
      sumB += data[idx + 2];
      sumA += data[idx + 3];
    }
    for (let x = 0; x < w; x += 1) {
      const outIdx = rowStart + x * 4;
      out[outIdx] = sumR / win;
      out[outIdx + 1] = sumG / win;
      out[outIdx + 2] = sumB / win;
      out[outIdx + 3] = sumA / win;
      const addX = Math.min(w - 1, x + r + 1);
      const subX = Math.max(0, x - r);
      const addIdx = rowStart + addX * 4;
      const subIdx = rowStart + subX * 4;
      sumR += data[addIdx] - data[subIdx];
      sumG += data[addIdx + 1] - data[subIdx + 1];
      sumB += data[addIdx + 2] - data[subIdx + 2];
      sumA += data[addIdx + 3] - data[subIdx + 3];
    }
  }
  data.set(out);
}

function boxBlurV(data: Uint8ClampedArray, w: number, h: number, r: number): void {
  const out = new Uint8ClampedArray(data.length);
  const win = r * 2 + 1;
  for (let x = 0; x < w; x += 1) {
    let sumR = 0, sumG = 0, sumB = 0, sumA = 0;
    for (let i = -r; i <= r; i += 1) {
      const y = Math.max(0, Math.min(h - 1, i));
      const idx = (y * w + x) * 4;
      sumR += data[idx];
      sumG += data[idx + 1];
      sumB += data[idx + 2];
      sumA += data[idx + 3];
    }
    for (let y = 0; y < h; y += 1) {
      const outIdx = (y * w + x) * 4;
      out[outIdx] = sumR / win;
      out[outIdx + 1] = sumG / win;
      out[outIdx + 2] = sumB / win;
      out[outIdx + 3] = sumA / win;
      const addY = Math.min(h - 1, y + r + 1);
      const subY = Math.max(0, y - r);
      const addIdx = (addY * w + x) * 4;
      const subIdx = (subY * w + x) * 4;
      sumR += data[addIdx] - data[subIdx];
      sumG += data[addIdx + 1] - data[subIdx + 1];
      sumB += data[addIdx + 2] - data[subIdx + 2];
      sumA += data[addIdx + 3] - data[subIdx + 3];
    }
  }
  data.set(out);
}
