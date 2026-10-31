import { PaintDocument } from "./PaintDocument";
import { flattenDocumentToBlob } from "./paintDocumentExport";

// タイムラプス: ストローク確定後に低解像度の合成 ImageBitmap を保存していき、
// 後で <canvas> に順番に描画して再生する。WebM 出力もサポート。

interface Frame {
  bitmap: ImageBitmap;
  width: number;
  height: number;
  timestamp: number;
  references: number;
}

export class Timelapse {
  private frames: Frame[] = [];
  private readonly thumbWidth: number;
  private readonly maxFrames: number;
  private enabled = false;
  private throttleMs = 200; // 連続スナップショットの最低間隔
  private lastSnapAt = 0;
  private playCancelled = false;
  private captureGeneration = 0;

  private listeners = new Set<() => void>();
  private version = 0;

  constructor(thumbWidth = 480, maxFrames = 1200) {
    this.thumbWidth = thumbWidth;
    this.maxFrames = maxFrames;
  }

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
  getSnapshot = (): number => this.version;
  private notify(): void {
    this.version += 1;
    for (const l of this.listeners) l();
  }

  setEnabled(b: boolean): void {
    this.enabled = b;
    this.notify();
  }
  isEnabled(): boolean { return this.enabled; }
  frameCount(): number { return this.frames.length; }

  async captureIfEnabled(doc: PaintDocument): Promise<void> {
    if (!this.enabled) return;
    const now = performance.now();
    if (now - this.lastSnapAt < this.throttleMs) return;
    this.lastSnapAt = now;
    await this.capture(doc);
  }

  private async capture(doc: PaintDocument): Promise<void> {
    const generation = this.captureGeneration;
    const blob = await flattenDocumentToBlob(doc);
    const bitmap = await createImageBitmap(blob, {
      resizeWidth: this.thumbWidth,
      resizeHeight: Math.round(this.thumbWidth * (doc.height / doc.width)),
      resizeQuality: "low",
    });
    if (generation !== this.captureGeneration) {
      bitmap.close();
      return;
    }
    this.frames.push({
      bitmap,
      width: bitmap.width,
      height: bitmap.height,
      timestamp: performance.now(),
      references: 1,
    });
    // メモリ上限
    while (this.frames.length > this.maxFrames) {
      const dropped = this.frames.shift();
      if (dropped) this.releaseFrames([dropped]);
    }
    this.notify();
  }

  clear(): void {
    this.captureGeneration += 1;
    this.releaseFrames(this.frames);
    this.frames = [];
    this.notify();
  }

  // 再生・書き出し開始時の集合を保持し、clear や上限による破棄でも画像を閉じない。
  private retainFrames(): Frame[] {
    const frames = this.frames.slice();
    for (const frame of frames) frame.references += 1;
    return frames;
  }

  private releaseFrames(frames: Frame[]): void {
    for (const frame of frames) {
      if (--frame.references === 0) frame.bitmap.close();
    }
  }

  // 再生中の play() を中断する
  stopPlayback(): void {
    this.playCancelled = true;
  }

  // 再生: 指定 canvas に fps で順次描画
  async play(canvas: HTMLCanvasElement, fps = 24): Promise<void> {
    if (this.frames.length === 0) return;
    const frames = this.retainFrames();
    try {
      this.playCancelled = false;
      const ctx = canvas.getContext("2d")!;
      const first = frames[0];
      canvas.width = first.width;
      canvas.height = first.height;
      const interval = 1000 / fps;
      for (const f of frames) {
        if (this.playCancelled) break;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(f.bitmap, 0, 0);
        await new Promise((r) => setTimeout(r, interval));
      }
    } finally {
      this.releaseFrames(frames);
    }
  }

  // WebM エクスポート（MediaRecorder + 描画canvas.captureStream）
  async exportWebM(fps = 24): Promise<Blob | null> {
    if (this.frames.length === 0) return null;
    const frames = this.retainFrames();
    let stream: MediaStream | undefined;
    let recorder: MediaRecorder | undefined;
    try {
      const first = frames[0];
      const canvas = document.createElement("canvas");
      canvas.width = first.width;
      canvas.height = first.height;
      const ctx = canvas.getContext("2d")!;
      stream = canvas.captureStream(fps);
      const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : "video/webm";
      recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      const interval = 1000 / fps;
      let resolveDone!: (blob: Blob) => void;
      const done = new Promise<Blob>((resolve) => { resolveDone = resolve; });
      recorder.onstop = () => resolveDone(new Blob(chunks, { type: mime }));
      recorder.start();
      for (const f of frames) {
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(f.bitmap, 0, 0);
        await new Promise((r) => setTimeout(r, interval));
      }
      // 最後のフレームを少し見せる
      await new Promise((r) => setTimeout(r, 200));
      recorder.stop();
      return await done;
    } finally {
      try {
        if (recorder && recorder.state !== "inactive") recorder.stop();
      } finally {
        stream?.getTracks().forEach(track => track.stop());
        this.releaseFrames(frames);
      }
    }
  }
}
