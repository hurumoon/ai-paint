import type {
  GradientStop,
  ReqLinearGradient,
  ReqRadialGradient,
} from "./paintWorkerTypes";
import { reply } from "./paintWorkerTypes";

// stops を pos 昇順に整え、両端 0/1 を必ず持つようにする
function normalizeStops(
  stops: GradientStop[] | undefined,
  fallbackFrom: [number, number, number, number],
  fallbackTo: [number, number, number, number]
): GradientStop[] {
  if (!stops || stops.length === 0) {
    return [
      { pos: 0, rgba: fallbackFrom },
      { pos: 1, rgba: fallbackTo },
    ];
  }
  const sorted = stops.slice().sort((a, b) => a.pos - b.pos);
  if (sorted[0].pos > 0) sorted.unshift({ pos: 0, rgba: sorted[0].rgba });
  if (sorted[sorted.length - 1].pos < 1) {
    sorted.push({ pos: 1, rgba: sorted[sorted.length - 1].rgba });
  }
  return sorted;
}

// t (0..1) を stops に沿って線形補間し、buf[idx..idx+3] に書き出す
function sampleStops(stops: GradientStop[], t: number, buf: Uint8ClampedArray, idx: number): void {
  // stops は >= 2 件、両端を覆っている前提
  // 線形探索でも実用十分（典型は 2〜10 件）
  let i = 0;
  for (; i < stops.length - 1; i += 1) {
    if (t <= stops[i + 1].pos) break;
  }
  const a = stops[i];
  const b = stops[Math.min(i + 1, stops.length - 1)];
  const span = b.pos - a.pos || 1;
  const k = (t - a.pos) / span;
  buf[idx] = a.rgba[0] + (b.rgba[0] - a.rgba[0]) * k;
  buf[idx + 1] = a.rgba[1] + (b.rgba[1] - a.rgba[1]) * k;
  buf[idx + 2] = a.rgba[2] + (b.rgba[2] - a.rgba[2]) * k;
  buf[idx + 3] = a.rgba[3] + (b.rgba[3] - a.rgba[3]) * k;
}

export function handleLinearGradient(req: ReqLinearGradient): void {
  const { width, height, x1, y1, x2, y2, from, to } = req;
  const stops = normalizeStops(req.stops, from, to);
  const buf = new Uint8ClampedArray(width * height * 4);
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy || 1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len2));
      const idx = (y * width + x) * 4;
      sampleStops(stops, t, buf, idx);
    }
  }
  reply(req.id, { buffer: buf.buffer }, [buf.buffer]);
}

export function handleRadialGradient(req: ReqRadialGradient): void {
  const { width, height, cx, cy, r, from, to } = req;
  const stops = normalizeStops(req.stops, from, to);
  const buf = new Uint8ClampedArray(width * height * 4);
  const R = Math.max(1, r);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const ddx = x - cx;
      const ddy = y - cy;
      const t = Math.max(0, Math.min(1, Math.sqrt(ddx * ddx + ddy * ddy) / R));
      const idx = (y * width + x) * 4;
      sampleStops(stops, t, buf, idx);
    }
  }
  reply(req.id, { buffer: buf.buffer }, [buf.buffer]);
}
