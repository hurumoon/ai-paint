import type { StrokePoint } from "../brushEngine";
import type { ReferencePaintPlan, ReferencePaintProgress, ReferencePaintStage, ReferenceStroke } from "./types";

export const REFERENCE_PAINT_MAX_EDGE = 768;
export const REFERENCE_PAINT_MAX_PIXELS = 300_000;
export const REFERENCE_PAINT_MAX_STROKES = 60_000;

export class ReferencePaintBudgetError extends Error {
  constructor() {
    super("描画操作の上限に達しました");
    this.name = "ReferencePaintBudgetError";
  }
}

export interface ReferencePaintSurface {
  draw(stroke: ReferenceStroke): void;
  read(): Uint8ClampedArray;
}

export function opaqueReference(data: Uint8ClampedArray): Uint8ClampedArray<ArrayBuffer> {
  if (data.length % 4 !== 0) throw new Error("画像の画素数が不正です");
  const result = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] / 255;
    for (let c = 0; c < 3; c += 1) result[i + c] = data[i + c] * alpha + 255 * (1 - alpha);
    result[i + 3] = 255;
  }
  return result;
}

export function meanAbsoluteError(target: Uint8ClampedArray, painted: Uint8ClampedArray): number {
  if (target.length !== painted.length || !target.length || target.length % 4 !== 0) throw new Error("比較する画像の大きさが一致しません");
  let sum = 0;
  for (let i = 0; i < target.length; i += 4) {
    for (let c = 0; c < 3; c += 1) sum += Math.abs(target[i + c] - painted[i + c]);
  }
  return sum / (target.length / 4 * 3);
}

export function validateReferenceSize(width: number, height: number, byteLength: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || width > REFERENCE_PAINT_MAX_EDGE || height > REFERENCE_PAINT_MAX_EDGE
    || width * height > REFERENCE_PAINT_MAX_PIXELS || byteLength !== width * height * 4) {
    throw new Error("試作の画像サイズは最大768px・30万画素です");
  }
}

export function buildReferencePaintPlan(
  width: number,
  height: number,
  pixels: Uint8ClampedArray,
  surface: ReferencePaintSurface,
  onProgress?: (progress: ReferencePaintProgress) => void,
): ReferencePaintPlan {
  validateReferenceSize(width, height, pixels.length);
  const target = opaqueReference(pixels);
  const stages: ReferencePaintStage[] = [];
  let strokeCount = 0;
  const stageCount = 6;
  const makeStage = (id: string, label: string, run: (emit: (stroke: ReferenceStroke) => void) => void) => {
    const strokes: ReferenceStroke[] = [];
    const emit = (stroke: ReferenceStroke) => {
      if (strokeCount >= REFERENCE_PAINT_MAX_STROKES) throw new ReferencePaintBudgetError();
      strokeCount += 1;
      surface.draw(stroke);
      strokes.push(stroke);
      if (strokes.length % 256 === 0) onProgress?.({ label, stage: stages.length, stageCount, strokes: strokeCount });
    };
    onProgress?.({ label, stage: stages.length, stageCount, strokes: strokeCount });
    run(emit);
    stages.push({ id, label, strokes, meanAbsoluteError: meanAbsoluteError(target, surface.read()) });
  };

  makeStage("outline", "輪郭の下描き", emit => traceEdges(target, width, height, emit));
  const passes = [
    { id: "large", label: "大きな色面", size: 12, blur: 3, threshold: 12 },
    { id: "color", label: "色の塗り重ね", size: 6, blur: 1, threshold: 10 },
    { id: "detail", label: "細部の描き込み", size: 3, blur: 0, threshold: 8 },
    { id: "fine", label: "細い輪郭と色", size: 1.5, blur: 0, threshold: 7 },
  ];
  for (const pass of passes) {
    makeStage(pass.id, pass.label, emit => {
      const reference = boxBlur(target, width, height, pass.blur);
      const gradient = gradients(reference, width, height);
      const step = Math.max(2, Math.round(pass.size * 0.7));
      const cells: number[] = [];
      for (let y = 0; y < height; y += step) for (let x = 0; x < width; x += step) cells.push(y * width + x);
      // 行ごとの印刷を避け、同じ入力では同じ順番になるよう固定seedで分散する。
      shuffle(cells, 4711 + Math.round(pass.size * 100));
      let painted = surface.read();
      let drawn = 0;
      for (const cell of cells) {
        const x0 = cell % width; const y0 = Math.floor(cell / width);
        let strongest = -1; let errorSum = 0; let count = 0; let best = cell;
        for (let y = y0; y < Math.min(height, y0 + step); y += 1) {
          for (let x = x0; x < Math.min(width, x0 + step); x += 1) {
            const index = y * width + x;
            const error = pixelError(reference, painted, index, index);
            errorSum += error; count += 1;
            if (error > strongest) { strongest = error; best = index; }
          }
        }
        if (errorSum / count < pass.threshold) continue;
        const points = makeCurve(best, pass.size, reference, gradient, width, height);
        emit(stroke(points, pass.size, colorAt(reference, best)));
        if (++drawn % 32 === 0) painted = surface.read();
      }
    });
  }
  makeStage("correction", "見本との差を修正", emit => {
    // ここだけは実際に描いた画素との差を行ごとに取り直し、残った小さい誤差を補う。
    const rows = Array.from({ length: height }, (_, i) => i);
    shuffle(rows, 198);
    for (const y of rows) {
      const painted = surface.read();
      let x = 0;
      while (x < width) {
        const start = y * width + x;
        if (pixelError(target, painted, start, start) < 7) { x += 1; continue; }
        let end = x;
        while (end + 1 < width && end - x < 12
          && pixelError(target, target, start, y * width + end + 1) < 5
          && pixelError(target, painted, y * width + end + 1, y * width + end + 1) >= 7) end += 1;
        emit(stroke([{ x: x + 0.5, y: y + 0.5, pressure: 1 }, { x: end + 0.5, y: y + 0.5, pressure: 1 }], 1.25, colorAt(target, start)));
        x = end + 1;
      }
    }
  });
  return { format: "ai-paint-reference-strokes", version: 1, width, height, background: "#ffffff", stages };
}

export function referenceStrokeBatches(strokes: ReferenceStroke[]): ReferenceStroke[][] {
  const batches: ReferenceStroke[][] = [];
  let batch: ReferenceStroke[] = []; let points = 0;
  for (const item of strokes) {
    if (batch.length && (batch.length >= 1024 || points + item.points.length > 32_768)) {
      batches.push(batch); batch = []; points = 0;
    }
    batch.push(item); points += item.points.length;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

function stroke(points: StrokePoint[], size: number, color: string): ReferenceStroke {
  return { points, settings: { kind: "round", size, color, opacity: 1, pressureSize: 0, pressureOpacity: 0, antiAliasStrength: 0 } };
}

function pixelError(a: Uint8ClampedArray, b: Uint8ClampedArray, ia: number, ib: number): number {
  return (Math.abs(a[ia * 4] - b[ib * 4]) + Math.abs(a[ia * 4 + 1] - b[ib * 4 + 1]) + Math.abs(a[ia * 4 + 2] - b[ib * 4 + 2])) / 3;
}

function colorAt(data: Uint8ClampedArray, index: number): string {
  return `#${[data[index * 4], data[index * 4 + 1], data[index * 4 + 2]].map(v => v.toString(16).padStart(2, "0")).join("")}`;
}

function boxBlur(data: Uint8ClampedArray, width: number, height: number, radius: number): Uint8ClampedArray {
  if (!radius) return data;
  const horizontal = new Uint8ClampedArray(data.length);
  const output = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    for (let c = 0; c < 3; c += 1) {
      let sum = 0; let n = 0;
      for (let dx = -radius; dx <= radius; dx += 1) { sum += data[(y * width + Math.max(0, Math.min(width - 1, x + dx))) * 4 + c]; n += 1; }
      horizontal[(y * width + x) * 4 + c] = sum / n;
    }
    horizontal[(y * width + x) * 4 + 3] = 255;
  }
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    for (let c = 0; c < 3; c += 1) {
      let sum = 0; let n = 0;
      for (let dy = -radius; dy <= radius; dy += 1) { sum += horizontal[(Math.max(0, Math.min(height - 1, y + dy)) * width + x) * 4 + c]; n += 1; }
      output[(y * width + x) * 4 + c] = sum / n;
    }
    output[(y * width + x) * 4 + 3] = 255;
  }
  return output;
}

function gradients(data: Uint8ClampedArray, width: number, height: number): { x: Float32Array; y: Float32Array; magnitude: Float32Array } {
  const gx = new Float32Array(width * height); const gy = new Float32Array(width * height); const magnitude = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y += 1) for (let x = 1; x < width - 1; x += 1) {
    const p = y * width + x;
    let max = 0;
    for (let c = 0; c < 3; c += 1) {
      const dx = data[(p + 1) * 4 + c] - data[(p - 1) * 4 + c];
      const dy = data[(p + width) * 4 + c] - data[(p - width) * 4 + c];
      const length = Math.hypot(dx, dy);
      if (length > max) { max = length; gx[p] = dx; gy[p] = dy; }
    }
    magnitude[p] = max;
  }
  return { x: gx, y: gy, magnitude };
}

function makeCurve(index: number, size: number, data: Uint8ClampedArray, gradient: ReturnType<typeof gradients>, width: number, height: number): StrokePoint[] {
  const start = { x: index % width + 0.5, y: Math.floor(index / width) + 0.5, pressure: 1 };
  const trace = (sign: number): StrokePoint[] => {
    const points: StrokePoint[] = [];
    let x = start.x; let y = start.y;
    let previousX = -gradient.y[index] * sign; let previousY = gradient.x[index] * sign;
    if (Math.hypot(previousX, previousY) < 1) { previousX = sign; previousY = 0.3; }
    for (let i = 0; i < 5; i += 1) {
      const p = Math.min(height - 1, Math.floor(y)) * width + Math.min(width - 1, Math.floor(x));
      let dx = -gradient.y[p]; let dy = gradient.x[p];
      if (Math.hypot(dx, dy) < 1) { dx = previousX; dy = previousY; }
      if (dx * previousX + dy * previousY < 0) { dx *= -1; dy *= -1; }
      let length = Math.hypot(dx, dy); dx /= length; dy /= length;
      length = Math.hypot(previousX, previousY);
      dx = dx * 0.5 + previousX / length * 0.5; dy = dy * 0.5 + previousY / length * 0.5;
      length = Math.hypot(dx, dy);
      x += dx / length * Math.max(0.7, size * 0.6); y += dy / length * Math.max(0.7, size * 0.6);
      if (x < 0.5 || y < 0.5 || x >= width - 0.5 || y >= height - 0.5) break;
      const next = Math.floor(y) * width + Math.floor(x);
      if (pixelError(data, data, index, next) > (size >= 6 ? 20 : 10)) break;
      points.push({ x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, pressure: 1 });
      previousX = dx; previousY = dy;
    }
    return points;
  };
  return [...trace(-1).reverse(), start, ...trace(1)];
}

function traceEdges(data: Uint8ClampedArray, width: number, height: number, emit: (s: ReferenceStroke) => void): void {
  const gradient = gradients(boxBlur(data, width, height, 1), width, height);
  const edges = new Uint8Array(width * height);
  const used = new Uint8Array(edges.length);
  for (let y = 1; y < height - 1; y += 1) for (let x = 1; x < width - 1; x += 1) {
    const p = y * width + x;
    const d = Math.abs(gradient.x[p]) > Math.abs(gradient.y[p]) ? 1 : width;
    if (gradient.magnitude[p] > 35 && gradient.magnitude[p] >= gradient.magnitude[p - d] && gradient.magnitude[p] > gradient.magnitude[p + d]) edges[p] = 1;
  }
  for (let p = 0; p < edges.length; p += 1) {
    if (!edges[p] || used[p]) continue;
    const points: StrokePoint[] = [];
    let current = p;
    while (points.length < 200) {
      used[current] = 1;
      const x = current % width; const y = Math.floor(current / width);
      points.push({ x: x + 0.5, y: y + 0.5, pressure: 1 });
      let next = -1;
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        if (x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height) continue;
        const candidate = (y + dy) * width + x + dx;
        if (edges[candidate] && !used[candidate] && (next < 0 || gradient.magnitude[candidate] > gradient.magnitude[next])) next = candidate;
      }
      if (next < 0) break;
      current = next;
    }
    if (points.length >= 3) emit(stroke(points, 0.8, "#bcc9ca"));
  }
}

function shuffle(values: number[], seed: number): void {
  let state = seed >>> 0;
  for (let i = values.length - 1; i > 0; i -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = state % (i + 1);
    [values[i], values[j]] = [values[j], values[i]];
  }
}
