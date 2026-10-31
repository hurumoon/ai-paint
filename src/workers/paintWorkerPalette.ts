import type { ReqPalette } from "./paintWorkerTypes";
import { reply } from "./paintWorkerTypes";

// 簡易 k-means によるパレット抽出（AI 待たずにローカルでも提案できるように）
export function handlePalette(req: ReqPalette): void {
  const { width, height, k } = req;
  const data = new Uint8ClampedArray(req.buffer);
  const total = width * height;
  // サンプリング: 大きい画像は間引く
  const step = Math.max(1, Math.floor(total / 8000));
  const samples: [number, number, number][] = [];
  for (let i = 0; i < total; i += step) {
    const idx = i * 4;
    if (data[idx + 3] < 16) continue; // 透明はスキップ
    // 白に近いピクセルは背景なので除外
    if (data[idx] > 245 && data[idx + 1] > 245 && data[idx + 2] > 245) continue;
    samples.push([data[idx], data[idx + 1], data[idx + 2]]);
  }
  if (samples.length === 0) {
    return reply(req.id, { palette: [] as string[], buffer: data.buffer }, [data.buffer]);
  }

  // 初期重心はランダム
  const centroids: [number, number, number][] = [];
  for (let i = 0; i < k; i += 1) {
    centroids.push(samples[Math.floor(Math.random() * samples.length)]);
  }
  const assignments = new Int32Array(samples.length);
  for (let iter = 0; iter < 10; iter += 1) {
    // assign
    for (let i = 0; i < samples.length; i += 1) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < k; c += 1) {
        const dr = samples[i][0] - centroids[c][0];
        const dg = samples[i][1] - centroids[c][1];
        const db = samples[i][2] - centroids[c][2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bestD) { bestD = d; best = c; }
      }
      assignments[i] = best;
    }
    // update
    const sums = Array.from({ length: k }, () => [0, 0, 0, 0]);
    for (let i = 0; i < samples.length; i += 1) {
      const c = assignments[i];
      sums[c][0] += samples[i][0];
      sums[c][1] += samples[i][1];
      sums[c][2] += samples[i][2];
      sums[c][3] += 1;
    }
    for (let c = 0; c < k; c += 1) {
      if (sums[c][3] > 0) {
        centroids[c] = [
          Math.round(sums[c][0] / sums[c][3]),
          Math.round(sums[c][1] / sums[c][3]),
          Math.round(sums[c][2] / sums[c][3]),
        ];
      }
    }
  }
  const palette = centroids.map(
    ([r, g, b]) =>
      "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")
  );
  reply(req.id, { palette, buffer: data.buffer }, [data.buffer]);
}
