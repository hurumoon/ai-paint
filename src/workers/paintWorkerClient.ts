// マルチコア活用のため、Worker を hardwareConcurrency 分（最大4）束ねるシンプルなプール。
// 操作は基本的に1ピクセルバッファあたり1Workerなので、複数同時実行（例: 2レイヤーのblurを並行）で効く。

import PaintWorker from "./paint.worker?worker";

interface PoolJob {
  workerIdx: number;
  resolve: (data: unknown) => void;
  reject: (err: unknown) => void;
}

class WorkerPool {
  private workers: Worker[] = [];
  private nextId = 1;
  private pending = new Map<number, PoolJob>();
  private rrIndex = 0;

  constructor() {
    const cores = Math.max(
      1,
      Math.min(4, (navigator.hardwareConcurrency || 2) - 1)
    );
    for (let i = 0; i < cores; i += 1) {
      this.workers.push(this.spawnWorker(i));
    }
  }

  private spawnWorker(idx: number): Worker {
    const w = new PaintWorker();
    w.onmessage = (ev: MessageEvent) => {
      const { id, ...rest } = ev.data;
      const job = this.pending.get(id);
      if (!job) return;
      this.pending.delete(id);
      job.resolve(rest);
    };
    w.onerror = (ev) => {
      // クラッシュした worker の pending を全て reject し、worker 自体は作り直してプールに復帰させる
      for (const [id, job] of this.pending) {
        if (job.workerIdx === idx) {
          this.pending.delete(id);
          job.reject(ev.message);
        }
      }
      try {
        this.workers[idx]?.terminate();
      } catch {
        // 既に終了済みの worker はそのまま再生成する。
      }
      this.workers[idx] = this.spawnWorker(idx);
    };
    return w;
  }

  call<T>(op: string, payload: Record<string, unknown>, transfer: Transferable[] = []): Promise<T> {
    const id = this.nextId;
    this.nextId += 1;
    const workerIdx = this.rrIndex % this.workers.length;
    this.rrIndex += 1;
    const worker = this.workers[workerIdx];
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        workerIdx,
        resolve: (data) => resolve(data as T),
        reject,
      });
      worker.postMessage({ id, op, ...payload }, transfer);
    });
  }
}

let pool: WorkerPool | null = null;
function getPool(): WorkerPool {
  if (!pool) pool = new WorkerPool();
  return pool;
}

interface BufferResult { buffer: ArrayBuffer; }
interface PaletteResult extends BufferResult { palette: string[]; }

// 呼び出し側が before として再読する ImageData を detach しないため、転送対象はコピーする。
function copyImageDataBufferForTransfer(imageData: ImageData): ArrayBuffer {
  const copy = new Uint8ClampedArray(imageData.data);
  return copy.buffer;
}

// ===== 公開 API =====
export async function floodFillWorker(
  imageData: ImageData,
  startX: number,
  startY: number,
  fill: [number, number, number, number],
  tolerance: number,
  options: { gapClose?: number; expand?: number; refImageData?: ImageData } = {}
): Promise<ImageData> {
  const buffer = copyImageDataBufferForTransfer(imageData);
  const transfer: Transferable[] = [buffer];
  const payload: Record<string, unknown> = {
    width: imageData.width,
    height: imageData.height,
    startX,
    startY,
    fill,
    tolerance,
    gapClose: options.gapClose ?? 0,
    expand: options.expand ?? 0,
    buffer,
  };
  if (options.refImageData) {
    const refBuffer = copyImageDataBufferForTransfer(options.refImageData);
    payload.refBuffer = refBuffer;
    transfer.push(refBuffer);
  }
  const result = await getPool().call<BufferResult>("flood", payload, transfer);
  return new ImageData(
    new Uint8ClampedArray(result.buffer),
    imageData.width,
    imageData.height
  );
}

export async function blurWorker(
  imageData: ImageData,
  radius: number
): Promise<ImageData> {
  const buffer = copyImageDataBufferForTransfer(imageData);
  const result = await getPool().call<BufferResult>(
    "blur",
    { width: imageData.width, height: imageData.height, radius, buffer },
    [buffer]
  );
  return new ImageData(
    new Uint8ClampedArray(result.buffer),
    imageData.width,
    imageData.height
  );
}

export interface GradientStop {
  pos: number; // 0..1
  rgba: [number, number, number, number];
}

export async function linearGradientWorker(
  width: number,
  height: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  from: [number, number, number, number],
  to: [number, number, number, number],
  stops?: GradientStop[]
): Promise<ImageData> {
  const result = await getPool().call<BufferResult>(
    "gradient-linear",
    { width, height, x1, y1, x2, y2, from, to, stops }
  );
  return new ImageData(new Uint8ClampedArray(result.buffer), width, height);
}

export async function radialGradientWorker(
  width: number,
  height: number,
  cx: number,
  cy: number,
  r: number,
  from: [number, number, number, number],
  to: [number, number, number, number],
  stops?: GradientStop[]
): Promise<ImageData> {
  const result = await getPool().call<BufferResult>(
    "gradient-radial",
    { width, height, cx, cy, r, from, to, stops }
  );
  return new ImageData(new Uint8ClampedArray(result.buffer), width, height);
}

export async function paletteWorker(
  imageData: ImageData,
  k = 5
): Promise<string[]> {
  const buffer = copyImageDataBufferForTransfer(imageData);
  const result = await getPool().call<PaletteResult>(
    "palette",
    { width: imageData.width, height: imageData.height, k, buffer },
    [buffer]
  );
  return result.palette;
}
