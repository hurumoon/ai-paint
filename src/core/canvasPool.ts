// 一時 canvas を使い回すための簡易プール。
//
// なぜ要るか:
//   composite.ts は グループ / クリップ合成のたびに一時 canvas を `new OffscreenCanvas()`
//   で確保していた。例えば 4096x4096 のドキュメントで深さ 3 のグループ + クリップを使うと、
//   1 フレームの合成中に 64MB の確保と解放が複数回走る。ブラシストローク中は毎フレーム
//   再合成されるため、GC 圧力と確保コストで描き心地が落ちる。
//
//   プールが同サイズの空 canvas を保持して使い回せれば、確保コストは初回のみ、毎フレームの
//   allocation は 0 にできる。
//
// 可変サイズ対応:
//   `acquire(w, h)` は任意サイズで呼べる。バケットは `(w, h)` ペアで分離される。
//   ストローク中の部分描画 (CanvasRenderer.drawFastPath, composite.ts の destClip 経路) は
//   doc サイズではなく dirty rect サイズで acquire することで、毎フレーム alloc が
//   doc サイズではなくブラシ周辺サイズに収まる (深いネストでも同じ恩恵を受ける)。
//
// メモリ上限:
//   1) `maxIdle = 8` per バケット: 同サイズの canvas が無限増殖しないように。
//   2) `maxIdleBytes = 512 MiB` グローバル: 16384x16384 doc (1GB/枚) の残留を防ぐ。
//   release で上限超過するなら新規エントリは捨てる (= 次回 acquire は再 alloc)。
//   再 alloc コストはあるが、巨大 doc を扱った後にメモリが GB 単位で残る方が悪い。
//   512MiB は 4K doc (64MB/枚) を 8 枚保持できる目安: D=4 ネストの scopeCaches
//   (= 2D = 8 枚) が release/acquire を 1 周しても再 alloc が走らない値。
//
// 注意:
//   - 同サイズでも doc.resize() で論理的に「古いサイズ」になったエントリは捨てたいので、
//     PaintDocument.resize 等で `clear()` を呼ぶ。
//   - 再利用時に `setTransform(identity)` で transform を識別状態に戻す。前ユーザーが
//     translate を残したまま release してもここで吸収される。`clip` は別問題で、
//     呼び出し側で save/restore による剥がしを徹底する必要がある (このプールでは検知不可)。

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;
type AnyCtx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

interface PooledCanvas {
  canvas: AnyCanvas;
  ctx: AnyCtx;
}

function canvasBytes(c: AnyCanvas): number {
  // 1 ピクセル 4 byte (RGBA) で概算。実体は GPU テクスチャ等で差はあるが、上限判定としては十分。
  return c.width * c.height * 4;
}

// 1 つの (width, height) ペアに対するプール。
class SizedPool {
  readonly width: number;
  readonly height: number;
  idle: PooledCanvas[] = [];
  // 同サイズの上限は 8 で十分 (深いネスト + クリッピングでも 8 枚あれば足りる想定)。
  // それを超えたら新規エントリは破棄に任せる。
  private maxIdle = 8;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  acquire(): PooledCanvas | null {
    const reused = this.idle.pop();
    if (!reused) return null;
    // 前ユーザーの translate / 描画を必ず洗う。
    // - setTransform でリセット: 前ユーザーが save/restore を忘れて translate を残しても吸収。
    // - clip 残留は検知不可。呼び出し側で save/restore による剥がしを徹底すること。
    reused.ctx.setTransform(1, 0, 0, 1, 0, 0);
    reused.ctx.globalAlpha = 1;
    reused.ctx.globalCompositeOperation = "source-over";
    reused.ctx.clearRect(0, 0, this.width, this.height);
    return reused;
  }

  // 戻り値 true なら受理した。false なら受け入れ拒否 (呼び出し側で GC に任せる)。
  release(pc: PooledCanvas): boolean {
    if (this.idle.length >= this.maxIdle) return false;
    this.idle.push(pc);
    return true;
  }

  clear(): void {
    this.idle.length = 0;
  }
}

// doc サイズが切り替わったときの取り扱いを 1 つにまとめるためのクラス。
// 複数サイズを同時保持し得る (ストローク中の dirty rect 経路で小サイズ、cache 再構築で
// doc サイズ、と同居する)。
export class CanvasPool {
  private buckets = new Map<string, SizedPool>();
  // 全バケット合計の idle バイト数の上限。これを超えるなら release を拒否する。
  private maxIdleBytes = 512 * 1024 * 1024;
  private currentIdleBytes = 0;

  private key(w: number, h: number): string {
    return `${w}x${h}`;
  }

  acquire(width: number, height: number): PooledCanvas {
    const k = this.key(width, height);
    let pool = this.buckets.get(k);
    if (!pool) {
      pool = new SizedPool(width, height);
      this.buckets.set(k, pool);
    }
    const reused = pool.acquire();
    if (reused) {
      this.currentIdleBytes -= canvasBytes(reused.canvas);
      if (this.currentIdleBytes < 0) this.currentIdleBytes = 0;
      return reused;
    }
    return makeCanvas(width, height);
  }

  release(pc: PooledCanvas): void {
    const bytes = canvasBytes(pc.canvas);
    if (this.currentIdleBytes + bytes > this.maxIdleBytes) {
      // グローバル上限超過: 受け取らない (= GC に任せる)。
      // 巨大な canvas (16384x16384 など) は一度使い終わったら捨てた方がメモリ的に安全。
      return;
    }
    const k = this.key(pc.canvas.width, pc.canvas.height);
    const pool = this.buckets.get(k);
    if (!pool) return;
    if (pool.release(pc)) {
      this.currentIdleBytes += bytes;
    }
  }

  // doc.resize() や close 時など、保持中の canvas をまとめて解放したいときに呼ぶ。
  clear(): void {
    for (const p of this.buckets.values()) p.clear();
    this.buckets.clear();
    this.currentIdleBytes = 0;
  }
}

function makeCanvas(width: number, height: number): PooledCanvas {
  // 0 や負のサイズは canvas 仕様で拒否されるので最低 1px に丸める。
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  if (typeof OffscreenCanvas !== "undefined") {
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext("2d")!;
    return { canvas: c, ctx };
  }
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  return { canvas: c, ctx };
}

// アプリ全体で 1 つだけ持てば足りる (どこから呼んでも同じプールを共有)。
export const sharedCanvasPool = new CanvasPool();
