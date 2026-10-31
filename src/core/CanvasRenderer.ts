import { PaintDocument } from "./PaintDocument";
import { compositeLayers, drawCanvasWithBlendMode, drawLayer } from "./composite";
import { sharedCanvasPool } from "./canvasPool";
import {
  evaluateCanvasRendererFastPath,
  type RendererScope,
} from "./canvasRendererFastPath";
import {
  chooseCacheRect,
  clampToDoc,
  sameDirtyRect,
  unionRect,
  type DirtyRect,
} from "./canvasRendererRects";

export type { DirtyRect } from "./canvasRendererRects";

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;
type AnyCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
interface PooledBuf {
  canvas: AnyCanvas;
  ctx: AnyCtx;
}

// 表示用 canvas にレイヤーを毎フレーム合成するレンダラ。
// invalidate() を呼ぶと次フレームで描画される。
// invalidate(rect) を渡すと、その矩形領域だけを再合成する（ブラシストローク中の高速化）。
//
// パフォーマンス（fast path）:
//   アクティブから root までの「祖先チェーン」を取り、各スコープごとに
//   「ピボットより下の兄弟」「ピボットより上の兄弟」の合成結果をキャッシュする。
//   ストローク中はこれらキャッシュ + アクティブの3枚を最深スコープから順に折りたたみ、
//   親スコープに上げるときグループの blend/opacity を適用する。
//   キャッシュ数は深さ D に比例 (各スコープ × 2)。合成コストは O(D) フレーム。
//   レイヤー総数 N には依存しない。
//
//   キャッシュは doc.bgVersion (= 非アクティブ層の変化シグナル) が変わった時、
//   またはアクティブ ID が変わった時のみ再構築。
//   アクティブ層の opacity スライダー操作などは bgVersion を bump しないので
//   キャッシュは維持される。
//
//   キャッシュの物理サイズ (cachedRect):
//     ストローク中 (invalidate(rect) 経路) は scopeCaches.below/above を **rect サイズ**
//     で確保する。doc サイズではなく「これまでに塗られた範囲」だけを保持するので、
//     4K/16K doc でも cache buffer は数 MB に収まる。
//     ・初回 invalidate(rect) で cachedRect = rect として buffer を rect サイズ + translate で確保
//     ・後続 invalidate(rect2) が cachedRect 内ならキャッシュ hit (rebuild なし)
//     ・rect2 が cachedRect を逸脱したら union を取って rebuild
//     ・union が doc 面積の 50% を超えたら cachedRect = null に昇格 (= doc サイズ cache)
//     ・全画面 invalidate (rect なし) は従来通り doc サイズで構築
//     ・bgVersion / activeId が変わると cachedRect も含め完全 invalidate
//
//   fast path 不適用ケース（fallback して全合成）:
//     - active がグループ
//     - active.clippingMask === true (active 自身が下にクリップされる)
//     - 祖先のいずれかが clippingMask=true、または group でない
//     - スコープのピボット直上兄弟が clippingMask=true (ピボットがクリップ元)
//     - レイヤー親子関係/クリップ関係がいずれかのピボット位置を跨ぐ
//     - 祖先チェーンの配列順が深さ順 (deeper-idx > shallower-idx) でない
export class CanvasRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private doc: PaintDocument;
  private rafId: number | null = null;
  private fullDirty = false;
  private dirtyRect: DirtyRect | null = null;
  private checkerPattern: CanvasPattern | null = null;

  // 各スコープごとに below / above の合成済み canvas を持つ。
  // scopeCaches[0] が最深 (アクティブ周辺)、scopeCaches[D] が root 近く。
  // buffer のサイズは cachedRect で決まる (rect-sized or doc-sized)。
  private scopeCaches: { below: PooledBuf; above: PooledBuf }[] = [];
  private cacheBgVersion: number | null = null;
  private cacheActiveId: string | null = null;
  // 現在の scopeCaches が表現している doc 範囲。null = doc 全域。
  // rect-sized なら buffer の物理 (0,0) は doc(cachedRect.x, cachedRect.y) に対応する
  // (= 各 buffer の ctx に translate(-cachedRect.x, -cachedRect.y) を適用済み)。
  private cachedRect: DirtyRect | null = null;

  constructor(canvas: HTMLCanvasElement, doc: PaintDocument) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.doc = doc;
    this.checkerPattern = makeCheckerPattern(this.ctx);
    this.resize();
  }

  setDocument(doc: PaintDocument): void {
    this.releaseCache();
    this.doc = doc;
    this.resize();
    this.invalidate();
  }

  resize(): void {
    // サイズが同じなら何もしない。
    //   useEffect が version 依存で resize() を毎ティック呼ぶ既存実装でも、ここで早期 return すれば
    //   キャッシュは破棄されない (= opacity スライダー操作で毎回キャッシュが壊れる従来挙動の修正)。
    if (
      this.canvas.width === this.doc.width &&
      this.canvas.height === this.doc.height
    ) {
      return;
    }
    this.canvas.width = this.doc.width;
    this.canvas.height = this.doc.height;
    // doc サイズが変わったらキャッシュ canvas もサイズ違いになるので破棄
    this.releaseCache();
    this.invalidate();
  }

  invalidate(rect?: DirtyRect): void {
    if (rect == null) {
      this.fullDirty = true;
      this.dirtyRect = null;
    } else if (!this.fullDirty) {
      const clamped = clampToDoc(rect, this.doc.width, this.doc.height);
      if (clamped) {
        this.dirtyRect = this.dirtyRect ? unionRect(this.dirtyRect, clamped) : clamped;
      }
    }
    if (this.rafId == null) {
      this.rafId = requestAnimationFrame(this.render);
    }
  }

  private render = (): void => {
    this.rafId = null;
    if (!this.fullDirty && !this.dirtyRect) return;

    const ctx = this.ctx;
    const { width, height } = this.doc;
    const rect = this.fullDirty ? null : this.dirtyRect;
    this.fullDirty = false;
    this.dirtyRect = null;

    // fast path eligibility + cache validity
    const scopes = evaluateCanvasRendererFastPath(
      this.doc.layers,
      this.doc.activeLayerId
    );
    if (scopes) {
      const docBg = this.doc.getBgVersion();
      const docActive = this.doc.activeLayerId;
      const baseValid =
        this.scopeCaches.length === scopes.length &&
        this.cacheBgVersion === docBg &&
        this.cacheActiveId === docActive;
      const targetCacheRect = chooseCacheRect(
        baseValid ? this.cachedRect : null,
        rect,
        baseValid,
        width,
        height
      );
      if (!baseValid || !sameDirtyRect(targetCacheRect, this.cachedRect)) {
        this.rebuildScopeCaches(scopes, targetCacheRect);
        this.cacheBgVersion = docBg;
        this.cacheActiveId = docActive;
        this.cachedRect = targetCacheRect;
      }
    } else {
      // 不適用ならキャッシュは保持しても無意味なので解放
      this.releaseCache();
    }

    ctx.save();
    if (rect) {
      ctx.beginPath();
      ctx.rect(rect.x, rect.y, rect.w, rect.h);
      ctx.clip();
      ctx.clearRect(rect.x, rect.y, rect.w, rect.h);
      if (this.checkerPattern) {
        ctx.fillStyle = this.checkerPattern;
      } else {
        ctx.fillStyle = "#ffffff";
      }
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    } else {
      ctx.clearRect(0, 0, width, height);
      if (this.checkerPattern) {
        ctx.fillStyle = this.checkerPattern;
      } else {
        ctx.fillStyle = "#ffffff";
      }
      ctx.fillRect(0, 0, width, height);
    }

    if (scopes) {
      this.drawFastPath(ctx, scopes, rect);
    } else {
      // ストローク部分描画では rect を destClip としても渡し、密に塗られた tiled
      // レイヤーで毎フレーム全タイル drawImage が走らないようにする。
      compositeLayers(ctx, this.doc, this.doc.layers, undefined, rect ?? undefined);
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.restore();
  };

  dispose(): void {
    if (this.rafId != null) cancelAnimationFrame(this.rafId);
    this.releaseCache();
  }

  // ===== fast path 補助 =====

  // 各スコープの below / above キャッシュを再構築する。
  //
  // cacheRect:
  //   - null: doc サイズ buffer (translate なし)。全画面再描画やキャッシュ無し時のフォールバック。
  //   - DirtyRect: rect サイズ buffer + translate(-x, -y)。compositeLayers にも destClip として
  //     渡し、内部の一時 canvas もすべて rect サイズに揃える。
  //
  // 既存 buffer はサイズが変わる可能性があるため、毎回 release + 再 acquire する。
  // pool は (w, h) 単位でバケットを持つので、サイズが一致すれば同じ canvas が返ってくる。
  private rebuildScopeCaches(
    scopes: RendererScope[],
    cacheRect: DirtyRect | null
  ): void {
    const { width, height, layers } = this.doc;

    // 既存 buffer をすべて返却 (サイズ変更 / scope 数変更どちらにも対応)
    while (this.scopeCaches.length > 0) {
      const c = this.scopeCaches.pop()!;
      sharedCanvasPool.release(c.below);
      sharedCanvasPool.release(c.above);
    }

    const bufW = cacheRect ? cacheRect.w : width;
    const bufH = cacheRect ? cacheRect.h : height;
    const tx = cacheRect ? -cacheRect.x : 0;
    const ty = cacheRect ? -cacheRect.y : 0;

    for (let k = 0; k < scopes.length; k += 1) {
      const below = sharedCanvasPool.acquire(bufW, bufH);
      const above = sharedCanvasPool.acquire(bufW, bufH);
      // pool.acquire 側で transform は identity / 全域 clear 済み。
      // translate は cache が release されるまでそのまま乗せておく。次の release 時に
      // pool が同じ canvas を再利用するなら setTransform(identity) で巻き戻す。
      if (cacheRect) {
        below.ctx.translate(tx, ty);
        above.ctx.translate(tx, ty);
      }
      this.scopeCaches.push({ below, above });
    }

    for (let k = 0; k < scopes.length; k += 1) {
      const scope = scopes[k];
      const cache = this.scopeCaches[k];
      const belowSlice = layers.slice(0, scope.pivotIdx);
      const aboveSlice = layers.slice(scope.pivotIdx + 1);
      // compositeLayers は doc 座標で書き込む。cache.below.ctx は translate 済みなので
      // 物理 (0..bufW, 0..bufH) が doc (cacheRect.x..+w, cacheRect.y..+h) に対応する。
      // destClip = cacheRect を渡すと、compositeLayers が内部で生成する aBuf/mBuf/gBuf/off も
      // rect サイズで確保され、drawTo もタイル enumerate を rect 内に絞る。
      if (belowSlice.length > 0) {
        compositeLayers(
          cache.below.ctx,
          this.doc,
          belowSlice,
          scope.parentId,
          cacheRect ?? undefined
        );
      }
      if (aboveSlice.length > 0) {
        compositeLayers(
          cache.above.ctx,
          this.doc,
          aboveSlice,
          scope.parentId,
          cacheRect ?? undefined
        );
      }
    }
  }

  // 最深スコープから順に「below + ピボット描画 + above」を折りたたむ。
  // 中間結果は pool から借りた canvas に蓄える (acc)。最上位スコープ (root) の合成は
  // 直接 targetCtx に流し込む。
  //
  // rect (部分描画): 中間 canvas は **rect サイズで確保** + translate(-rect.x, -rect.y)
  //   で ctx を doc 座標で扱えるようにする。これにより:
  //     - 確保メモリが O(rect 面積)。深さ D の祖先チェーンで D-1 枚の中間が必要だが、
  //       それぞれ rect サイズなので、doc サイズが 4K/16K でも中間は数百 KB に収まる。
  //     - canvas 自体が rect サイズなので clip 不要 (= save/restore の clip 剥がしも不要)。
  //     - 下位スコープ (acc) も同じ rect 位置を表すので、親に貼るときは (rect.x, rect.y)。
  //   cache.below/above は cachedRect サイズ + translate(-cachedRect.x, -cachedRect.y) で
  //   保持されている (= 物理 (0, 0) が doc(cachedRect.x, cachedRect.y))。outCtx 側は
  //   doc 座標前提なので drawImage 時の位置は (cachedRect.x, cachedRect.y)。cachedRect
  //   が null (doc 全域) の場合は (0, 0)。
  //
  // rect なし (全画面再描画): 従来通り doc サイズで中間を確保 (translate なし)。
  private drawFastPath(
    targetCtx: AnyCtx,
    scopes: RendererScope[],
    rect: DirtyRect | null
  ): void {
    const { width, height, layers } = this.doc;
    let acc: PooledBuf | null = null;
    // 中間 canvas のサイズと translate / 親貼り位置を rect から決める。
    // rect なし: doc サイズ・translate なし・(0,0) 貼り (従来挙動)。
    // rect あり: rect サイズ・translate(-rect.x, -rect.y)・(rect.x, rect.y) 貼り。
    const interW = rect ? rect.w : width;
    const interH = rect ? rect.h : height;
    const interDx = rect ? rect.x : 0;
    const interDy = rect ? rect.y : 0;
    // cache buffer の doc 座標位置 (cachedRect.x, cachedRect.y)。null は全域 = (0, 0)。
    const cacheRect = this.cachedRect;
    const cacheDx = cacheRect ? cacheRect.x : 0;
    const cacheDy = cacheRect ? cacheRect.y : 0;

    for (let k = 0; k < scopes.length; k += 1) {
      const isFinal = k === scopes.length - 1;
      const cache = this.scopeCaches[k];
      const pivot = scopes[k].pivot;

      let outCtx: AnyCtx;
      let outBuf: PooledBuf | null = null;
      let intermediateSaved = false;
      if (isFinal) {
        // targetCtx は render() 側で既に save+clip(rect)+背景塗り済み。doc 座標で動く。
        outCtx = targetCtx;
      } else {
        outBuf = sharedCanvasPool.acquire(interW, interH);
        outCtx = outBuf.ctx;
        outCtx.save();
        intermediateSaved = true;
        if (rect) {
          // ctx を doc 座標で扱えるよう translate。drawLayer / drawImage の引数は
          // すべて doc 座標。canvas 自体が rect サイズなので clip は不要 (範囲外は
          // 物理的に存在しない = browser がカリング)。
          outCtx.translate(-rect.x, -rect.y);
        }
        // pool.acquire 側で:
        //   - 再利用 canvas: setTransform(identity) + clearRect(0,0,w,h) 済み
        //   - 新規 canvas: spec 上 transparent で生成される
        // どちらも outBuf 全域は透明な状態で返ってくるので、ここでの追加 clearRect は不要。
        // (clip 漏れがあった場合は pool 側の clearRect も同じ clip 下なので無効。
        //  clip の責任は呼び出し側で save/restore による剥がしを徹底することで担保)
      }

      // below: cache.below の物理 (0, 0) は doc(cacheDx, cacheDy) を表す。outCtx は
      // doc 座標 (rect 経路では translate 済み) なので、cache を (cacheDx, cacheDy) に貼る。
      // cachedRect == null なら (0, 0) に doc サイズ buffer を貼る (従来挙動)。
      outCtx.drawImage(cache.below.canvas as CanvasImageSource, cacheDx, cacheDy);

      // pivot 描画
      if (pivot.meta.visible) {
        if (k === 0) {
          // 最深: ピボット = active 層自身。drawLayer 内で blend/opacity が適用される。
          // ストローク部分描画では rect を destClip として渡し、active 層が密に
          // 塗られていても drawTo が rect 内の数タイルだけに絞られる。
          // outCtx は translate 済み (rect 経路) なので drawLayer 内の doc 座標書き込みは
          // 正しく rect-sized canvas に着地する。
          drawLayer(outCtx, this.doc, pivot, layers, rect ?? undefined);
        } else if (acc) {
          // 親グループ: 直前 acc (= pivot の素ピクセル) に pivot の blend/opacity を被せる。
          // acc は同じ rect 位置 (rect 経路) なので doc(rect.x, rect.y) に貼る。
          // rect なし経路は acc も doc サイズ・(0, 0) 貼り。
          drawCanvasWithBlendMode(
            outCtx,
            acc.canvas,
            interDx,
            interDy,
            pivot.meta.blendMode,
            pivot.meta.opacity
          );
        }
      }

      // above
      outCtx.drawImage(cache.above.canvas as CanvasImageSource, cacheDx, cacheDy);

      // 中間 canvas の translate (save した状態全部) を剥がしてから pool に返す
      if (intermediateSaved) outCtx.restore();

      // roll up
      if (acc) sharedCanvasPool.release(acc);
      acc = outBuf;
    }
    // ループ後 acc は最終スコープが isFinal=true なので null。
    // 念のため (scopes.length=0 は前段で弾けないが) leak を防ぐ。
    if (acc) sharedCanvasPool.release(acc);
  }

  private releaseCache(): void {
    for (const c of this.scopeCaches) {
      sharedCanvasPool.release(c.below);
      sharedCanvasPool.release(c.above);
    }
    this.scopeCaches.length = 0;
    this.cacheBgVersion = null;
    this.cacheActiveId = null;
    this.cachedRect = null;
  }
}

function makeCheckerPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  const size = 16;
  const tile = document.createElement("canvas");
  tile.width = size;
  tile.height = size;
  const tctx = tile.getContext("2d");
  if (!tctx) return null;
  const half = size / 2;
  tctx.fillStyle = "#ffffff";
  tctx.fillRect(0, 0, size, size);
  tctx.fillStyle = "#d0d0d0";
  tctx.fillRect(0, 0, half, half);
  tctx.fillRect(half, half, half, half);
  return ctx.createPattern(tile, "repeat");
}
