import { BlendMode, DEFAULT_DPI, LayerKind, LayerMeta, TextLayerData } from "../types";
import { MAX_AIPAINT_DPI } from "./nativeFormatParts/constants";
import { sharedCanvasPool } from "./canvasPool";
import { TileStore } from "./TileStore";
import { renderTextToLayer } from "./textLayerRaster";
import {
  createLayerFromCanvas,
  createLayerFromImageData,
  extendLayerPixels,
  materializeDeferredLayer,
  mergeLayerPixelsDown,
  resizeLayerPixels,
} from "./paintDocumentLayerPixels";
import {
  getDescendantIds as getLayerDescendantIds,
  insertionIndexAboveActive,
  normalizeLayerOrder,
} from "./layerTree";
import { isBgInvariantPatch } from "./layerMeta";
import { assertRasterImageDimensions } from "./rasterImageLimits";

// ピクセルの正本を保持するレイヤー。
//
// 書き込みは `store.withCtx` / `store.putImageData` / `store.clearRect`、
// 読み出しは `store.drawTo` / `store.drawToScaled` / `store.getImageData` /
// `store.toPngBytes` / `store.toHtmlCanvasSnapshot` のいずれかを使う。
// `store.canvas` / `store.ctx` の直接アクセスは原則しない (タイル化時に
// 動かなくなる)。
//
// 通常レイヤー: store は doc サイズ。deferred は undefined。
// 遅延レイヤー (PSD ロード直後): store は元 PSD レイヤーのバウンディング rect
//   サイズのまま保持される。doc 全域への展開は「初めて書き込みが必要になった時」
//   または「保存/履歴スナップショットで doc 寸の ImageData が必要になった時」に
//   行う (materializeLayer)。これにより 50 レイヤーの PSD を開くだけで doc サイズ
//   × 50 のメモリを確保していた問題を解消できる。
//
// deferred.offsetX/Y は store を doc 座標系のどこに置くかのオフセット。
// composite/savePsd は offset を見て描画する。書き込みが起きるとレイヤーは
// "通常" 形態に昇格し、deferred は undefined になる。
export interface PixelLayer {
  meta: LayerMeta;
  store: TileStore;
  deferred?: DeferredLayerInfo;
}

export interface DeferredLayerInfo {
  offsetX: number;
  offsetY: number;
  bboxWidth: number;
  bboxHeight: number;
}

interface MergeDownPair {
  upper: PixelLayer;
  lower: PixelLayer;
}

function getMergeDownPair(
  layers: readonly PixelLayer[],
  id: string
): MergeDownPair | undefined {
  const idx = layers.findIndex((layer) => layer.meta.id === id);
  if (idx <= 0) return undefined;

  const upper = layers[idx];
  const lower = layers[idx - 1];
  if (upper.meta.kind === "group" || lower.meta.kind === "group") return undefined;
  if (upper.meta.parentId !== lower.meta.parentId) return undefined;

  // upper の opacity / blendMode はピクセルへ焼き込めるが、lower の合成条件は
  // 結合後の全ピクセルへ掛かるため、見た目を保てる単純な条件だけ許可する。
  if (!upper.meta.visible || !lower.meta.visible) return undefined;
  if (lower.meta.opacity !== 1 || lower.meta.blendMode !== "normal") return undefined;
  if (upper.meta.clippingMask || lower.meta.clippingMask) return undefined;

  // upper をベースにするクリッピングレイヤーがあると、結合後は lower の alpha まで
  // クリップ範囲が広がるため、直上の同一親レイヤーがクリッピング中なら拒否する。
  const above = layers[idx + 1];
  if (
    above &&
    above.meta.parentId === upper.meta.parentId &&
    above.meta.clippingMask
  ) {
    return undefined;
  }

  return { upper, lower };
}

export function canMergeLayerDown(layers: readonly PixelLayer[], id: string): boolean {
  return getMergeDownPair(layers, id) !== undefined;
}

let layerCounter = 0;
function nextLayerId(): string {
  layerCounter += 1;
  return `layer-${Date.now().toString(36)}-${layerCounter}`;
}

type Listener = () => void;

function normalizeDpi(dpi: number): number {
  if (!Number.isFinite(dpi)) return DEFAULT_DPI;
  return Math.min(MAX_AIPAINT_DPI, Math.max(1, Math.round(dpi)));
}

// React の外でドキュメント構造、レイヤーメタ、ピクセル正本への参照を管理する。
// 変更があったら listeners を通じてバージョンを増やし、React 側は useSyncExternalStore で購読する。
//
// 責務境界:
// - ここに置く: doc サイズ、active layer、layer tree、通知/version、TileStore への所有権操作。
// - ここに置かない: 保存形式、AI 送信用画像、重いピクセル処理、UI workflow、履歴政策。
//   それらは paintDocumentExport / aiImagePayload / paintDocumentLayerPixels / hooks / History などへ逃がす。
// 公開メソッドを増やす場合は `tests/unit/paintDocumentPublicApi.test.ts` で API 面を明示的に見直す。
export class PaintDocument {
  width: number;
  height: number;
  dpi: number = DEFAULT_DPI;
  layers: PixelLayer[] = [];
  activeLayerId: string;

  private listeners = new Set<Listener>();
  private version = 0;
  // bg キャッシュ無効化シグナル。
  //   CanvasRenderer の below/above キャッシュは「アクティブ以外のレイヤーが何も変わって
  //   いない」間は再利用できる。version はアクティブ自身の opacity スライダー操作でも
  //   bump されてしまうので、cache 維持判定には別の counter を使う。
  //   bg を bump する条件: 非アクティブ層のピクセル/メタ変更、レイヤー追加/削除/移動、
  //   親子関係や clippingMask 等の構造的メタ変更、doc resize、active 入れ替え以外で
  //   レイヤー一覧自体に手が加わるあらゆる経路。
  //   bg を bump しない条件: アクティブ層の opacity/visible/blendMode/name/locked/transparentPixelLock 変更、
  //   アクティブ層へのピクセル書き込み (=ブラシ後の doc.invalidateActive)。
  private bgVersion = 0;

  constructor(width: number, height: number, initialLayerCount = 3) {
    this.width = width;
    this.height = height;
    for (let i = 0; i < initialLayerCount; i += 1) {
      this.addLayer(`レイヤー${i + 1}`, false);
    }
    this.activeLayerId = this.layers[0].meta.id;
  }

  // ===== 購読 =====
  subscribe = (cb: Listener): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  getSnapshot = (): number => this.version;

  // CanvasRenderer から参照する。bg cache の鮮度判定用。
  getBgVersion(): number {
    return this.bgVersion;
  }

  private notify(opts?: { bumpBg?: boolean }): void {
    this.version += 1;
    const bumpBg = opts?.bumpBg ?? true;
    if (bumpBg) this.bgVersion += 1;
    for (const l of this.listeners) l();
  }

  setDpi(dpi: number): void {
    this.dpi = normalizeDpi(dpi);
    this.notify();
  }

  // ===== レイヤー操作 =====
  getLayer(id: string): PixelLayer | undefined {
    return this.layers.find((l) => l.meta.id === id);
  }

  getActiveLayer(): PixelLayer | undefined {
    return this.getLayer(this.activeLayerId);
  }

  // 遅延レイヤー (PSD ロード直後の bbox 保持状態) を doc サイズの canvas に展開する。
  // ブラシで書き込む直前、履歴スナップショットを取る直前など「doc 座標系で getImageData /
  // putImageData / 任意領域への drawImage が必要になる前」に呼ぶ。
  //
  // 通常レイヤー (deferred 未設定) には no-op。
  // 引数 id は配列内の検索を避けるための直接参照ハンドル。
  materializeLayer(layer: PixelLayer): void {
    materializeDeferredLayer(layer, this.width, this.height);
  }

  // 渡された ID 集合に対応する遅延レイヤーをまとめて展開する。
  // ブラシ開始時に「影響を受けるレイヤー」を一括 materialize するなど。
  materializeLayers(ids: Iterable<string>): void {
    for (const id of ids) {
      const layer = this.getLayer(id);
      if (layer) this.materializeLayer(layer);
    }
  }

  // 全レイヤーを doc サイズに展開する。aipaint / PSD 保存のように、すべての
  // ピクセルを doc 座標系で取り出す必要がある場面で使う。
  materializeAllLayers(): void {
    for (const layer of this.layers) this.materializeLayer(layer);
  }

  addLayer(name?: string, notify = true, kind: LayerKind = "raster"): PixelLayer {
    const store = new TileStore(this.width, this.height);
    // 新規レイヤーはアクティブレイヤーと同じ親グループに入れる
    const activeMeta = this.getActiveLayer()?.meta;
    const parentId = activeMeta?.kind === "group" ? activeMeta.id : activeMeta?.parentId;
    const layer: PixelLayer = {
      meta: {
        id: nextLayerId(),
        name: name ?? `レイヤー${this.layers.length + 1}`,
        visible: true,
        opacity: 1,
        blendMode: "normal",
        locked: false,
        transparentPixelLock: false,
        kind,
        parentId,
      },
      store,
    };
    this.insertAboveActive(layer);
    if (notify) this.notify();
    return layer;
  }

  // グループ（フォルダ）レイヤーを追加。store は持つが描画には使わない。
  addGroup(name?: string): PixelLayer {
    const activeMeta = this.getActiveLayer()?.meta;
    const parentId = activeMeta?.kind === "group" ? activeMeta.id : activeMeta?.parentId;
    const store = new TileStore(this.width, this.height);
    const layer: PixelLayer = {
      meta: {
        id: nextLayerId(),
        name: name ?? `フォルダ${this.layers.filter((l) => l.meta.kind === "group").length + 1}`,
        visible: true,
        opacity: 1,
        blendMode: "normal",
        locked: false,
        transparentPixelLock: false,
        kind: "group",
        collapsed: false,
        parentId,
      },
      store,
    };
    this.insertAboveActive(layer);
    this.activeLayerId = layer.meta.id;
    this.notify();
    return layer;
  }

  // 新規レイヤーを「アクティブレイヤーの 1 つ上 (UI 上)」 = 配列上の直後に挿入する。
  // アクティブがグループなら、そのグループの中の最上位 (グループ配下の最終 index の直後) に入れる。
  // アクティブが無い or 見つからなければ末尾へ。
  private insertAboveActive(layer: PixelLayer): void {
    const insertAt = insertionIndexAboveActive(this.layers, this.activeLayerId);
    this.layers.splice(insertAt, 0, layer);
  }

  // グループ配下の全レイヤー id を返す（再帰的に子グループも含む）
  // 不正データ(parentId が循環など)で無限ループしないよう visited を持つ
  getDescendantIds(groupId: string): string[] {
    return getLayerDescendantIds(this.layers, groupId);
  }

  // レイヤーをグループに入れる / 出す。
  // targetGroupId: 入れたいグループの id。null/undefined でトップレベルに出す。
  setLayerParent(id: string, targetGroupId: string | null | undefined): void {
    const layer = this.getLayer(id);
    if (!layer) return;
    const newParentId = targetGroupId ?? undefined;
    // 自分の子孫グループに自分自身を入れるのは禁止（循環参照）
    if (newParentId && layer.meta.kind === "group") {
      const descendants = this.getDescendantIds(id);
      if (id === newParentId || descendants.includes(newParentId)) return;
    }
    if (newParentId) {
      const target = this.getLayer(newParentId);
      if (!target || target.meta.kind !== "group") return;
    }
    if (layer.meta.parentId === newParentId) return;

    // 親の外へ出す場合は、元の親から移動先の階層までをつなぐ枝の直後に置く。
    // parentId だけを変えると元のグループの子孫ブロックを分断してしまう。
    let beforeId: string | undefined;
    const oldParentId = layer.meta.parentId;
    if (oldParentId) {
      let branch = this.getLayer(oldParentId);
      const visited = new Set<string>();
      while (branch && branch.meta.parentId !== newParentId) {
        if (!branch.meta.parentId || visited.has(branch.meta.id)) {
          branch = undefined;
          break;
        }
        visited.add(branch.meta.id);
        branch = this.getLayer(branch.meta.parentId);
      }
      if (branch && branch.meta.parentId === newParentId) {
        const branchDescendants = new Set(this.getDescendantIds(branch.meta.id));
        const branchIdx = this.layers.indexOf(branch);
        let nextIdx = branchIdx + 1;
        while (
          nextIdx < this.layers.length &&
          branchDescendants.has(this.layers[nextIdx].meta.id)
        ) {
          nextIdx += 1;
        }
        beforeId = this.layers[nextIdx]?.meta.id;
      }
    }

    this.reorderLayer(id, newParentId, beforeId);
  }

  // グループの開閉状態
  setGroupCollapsed(id: string, collapsed: boolean): void {
    const layer = this.getLayer(id);
    if (!layer || layer.meta.kind !== "group") return;
    layer.meta.collapsed = collapsed;
    this.notify();
  }

  // テキストレイヤーを追加。textを設定し、初回ラスタライズも行う。
  addTextLayer(text: TextLayerData, name?: string): PixelLayer {
    const layer = this.addLayer(name ?? "テキスト", false, "text");
    layer.meta.text = text;
    renderTextToLayer(layer, this.width, this.height, text);
    this.activeLayerId = layer.meta.id;
    this.notify();
    return layer;
  }

  // テキストレイヤーの中身を更新して再ラスタライズ
  updateTextLayer(id: string, patch: Partial<TextLayerData>): void {
    const layer = this.getLayer(id);
    if (!layer || layer.meta.kind !== "text" || !layer.meta.text) return;
    this.materializeLayer(layer);
    layer.meta.text = { ...layer.meta.text, ...patch };
    renderTextToLayer(layer, this.width, this.height, layer.meta.text);
    // アクティブなテキスト層の本体だけが変わっているなら bg キャッシュは維持できる。
    this.notify({ bumpBg: id !== this.activeLayerId });
  }

  removeLayer(id: string): boolean {
    const target = this.getLayer(id);
    if (!target) return false;
    // 削除対象 id 集合 = 自分 + (グループなら子孫すべて)
    const toRemove = new Set<string>([id]);
    if (target.meta.kind === "group") {
      for (const d of this.getDescendantIds(id)) toRemove.add(d);
    }
    // 削除後に「描画可能なレイヤー(raster/text)」が0になるなら拒否する
    const remainingDrawable = this.layers.filter(
      (l) => !toRemove.has(l.meta.id) && l.meta.kind !== "group"
    ).length;
    if (remainingDrawable === 0) return false;
    const firstIdx = this.layers.findIndex((l) => l.meta.id === id);
    this.layers = this.layers.filter((l) => !toRemove.has(l.meta.id));
    if (toRemove.has(this.activeLayerId)) {
      const next = this.layers[Math.min(firstIdx, this.layers.length - 1)];
      this.activeLayerId = next ? next.meta.id : "";
    }
    this.notify();
    return true;
  }

  // レイヤー(or グループ)を任意の位置に移動する。D&D 用の汎用 API。
  // - id: 動かすレイヤー
  // - targetParentId: 移動先の親グループ id (null/undefined でトップレベル)
  // - beforeId: 「この id の配列上の直前」に挿入。undefined なら targetParent の末尾(UI 最上)に置く
  //   beforeId が動かす本人 / 子孫 / 別 parent 配下のものを指していてもガードする
  // グループを動かす場合は配列上の自分 + 配列直下の連続子孫ブロックを一塊で移動する。
  // 子孫の parentId 自体は変えない（ツリーの内部構造は維持）。
  reorderLayer(id: string, targetParentId: string | null | undefined, beforeId?: string): void {
    const layer = this.getLayer(id);
    if (!layer) return;
    // null と undefined を統一
    const newParentId = targetParentId ?? undefined;
    // 自分自身/子孫の中には入れられない（循環）
    if (layer.meta.kind === "group" && newParentId) {
      if (newParentId === id) return;
      const descendants = this.getDescendantIds(id);
      if (descendants.includes(newParentId)) return;
    }
    if (newParentId) {
      const target = this.getLayer(newParentId);
      if (!target || target.meta.kind !== "group") return;
    }
    if (beforeId) {
      const before = this.getLayer(beforeId);
      if (!before || before.meta.parentId !== newParentId) return;
    }

    const idx = this.layers.indexOf(layer);
    if (idx < 0) return;

    // 自分のブロック (= 自分 + 配列直下の連続子孫)
    const ownDescendants = layer.meta.kind === "group" ? new Set(this.getDescendantIds(id)) : new Set<string>();
    const block: PixelLayer[] = [layer];
    let j = idx + 1;
    while (j < this.layers.length && ownDescendants.has(this.layers[j].meta.id)) {
      block.push(this.layers[j]);
      j += 1;
    }
    const blockIds = new Set(block.map((l) => l.meta.id));

    // beforeId が自分や自分の子孫を指している → 不正なドロップなのでキャンセル
    if (beforeId && blockIds.has(beforeId)) return;

    // 配列から自分のブロックを抜く
    this.layers.splice(idx, block.length);

    // 親付け替え
    layer.meta.parentId = newParentId;

    // 挿入位置を計算
    let insertAt: number;
    if (beforeId) {
      const beforeIdx = this.layers.findIndex((l) => l.meta.id === beforeId);
      if (beforeIdx < 0) {
        // 既に剥がした後で見つからないケースはありえないが念のため末尾フォールバック
        insertAt = this.layers.length;
      } else {
        insertAt = beforeIdx;
      }
    } else {
      // newParent の末尾(= newParent の子孫の中で最も後ろ + 1)
      // newParent が undefined ならグローバル末尾
      if (!newParentId) {
        insertAt = this.layers.length;
      } else {
        // newParent 配下の最終 index を探す
        const targetDesc = new Set(this.getDescendantIds(newParentId));
        let lastIdx = this.layers.findIndex((l) => l.meta.id === newParentId);
        for (let i = lastIdx + 1; i < this.layers.length; i += 1) {
          if (targetDesc.has(this.layers[i].meta.id)) lastIdx = i;
        }
        insertAt = lastIdx + 1;
      }
    }

    this.layers.splice(insertAt, 0, ...block);
    this.notify();
  }

  setActiveLayer(id: string): void {
    if (!this.getLayer(id)) return;
    this.activeLayerId = id;
    this.notify();
  }

  updateLayerMeta(id: string, patch: Partial<LayerMeta>): void {
    const layer = this.getLayer(id);
    if (!layer) return;
    layer.meta = { ...layer.meta, ...patch };
    // アクティブ層の bg 影響なしメタ (opacity/visible/blendMode/name/locked/transparentPixelLock) だけの変更は
    // CanvasRenderer の below/above キャッシュを破棄しなくて済む。
    // それ以外 (parentId/clippingMask/kind/collapsed/text/非アクティブ層) は bg を bump。
    const isActive = id === this.activeLayerId;
    const onlyBgInvariant = isActive && isBgInvariantPatch(patch);
    this.notify({ bumpBg: !onlyBgInvariant });
  }

  setVisibility(id: string, visible: boolean): void {
    this.updateLayerMeta(id, { visible });
  }

  setOpacity(id: string, opacity: number): void {
    this.updateLayerMeta(id, { opacity: Math.max(0, Math.min(1, opacity)) });
  }

  setBlendMode(id: string, blendMode: BlendMode): void {
    this.updateLayerMeta(id, { blendMode });
  }

  setTransparentPixelLock(id: string, locked: boolean): void {
    const layer = this.getLayer(id);
    if (!layer || layer.meta.kind === "group") return;
    this.updateLayerMeta(id, { transparentPixelLock: locked });
  }

  // クリッピングマスク（直下レイヤーへクリップ）の ON/OFF。
  // グループへの適用は実用上意味が無いので拒否する。
  setClippingMask(id: string, clip: boolean): void {
    const layer = this.getLayer(id);
    if (!layer || layer.meta.kind === "group") return;
    this.updateLayerMeta(id, { clippingMask: clip });
  }

  // 構造ごと差し替える（History.undo / redo の Full 復元から呼ぶ）
  // deferred が付いていれば bbox サイズの canvas + offset で復元する (PSD 直後の遅延形態)。
  replaceLayers(
    layers: {
      meta: LayerMeta;
      imageData: ImageData;
      deferred?: DeferredLayerInfo;
    }[],
    activeLayerId: string
  ): void {
    this.adoptLayerObjects(
      layers.map((src) => createLayerFromImageData(src, this.width, this.height)),
      activeLayerId
    );
  }

  // 構築済みの PixelLayer 配列をそのまま採用する差し替え (History の構造 undo/redo 用)。
  // ピクセル正本 (TileStore) の複製や作り直しは行わず、渡された実体への参照を
  // そのまま使う。呼び出し側 (applyStructureState) が実体の所有権管理に責任を持つ。
  replaceLayerObjects(layers: PixelLayer[], activeLayerId: string): void {
    this.adoptLayerObjects(layers, activeLayerId);
  }

  private adoptLayerObjects(layers: PixelLayer[], activeLayerId: string): void {
    this.layers = normalizeLayerOrder(layers);
    this.activeLayerId =
      this.layers.find((l) => l.meta.id === activeLayerId)?.meta.id ??
      this.layers[0]?.meta.id ??
      "";
    this.notify();
  }

  // 既に doc サイズ or bbox サイズで描画済みの canvas をそのまま採用する差し替え。
  // PSD ロードなど「読み込み時点でレイヤー canvas を一発で構築できる」経路で使う。
  // 中間 ImageData を経由しないので doc サイズ ×N のメモリ確保とアルファ往復が
  // まるごと省ける（高解像度 PSD の主な遅さの原因はここ）。
  //
  // deferred を渡すと、canvas は bbox サイズのまま保持され、合成時に offset 付きで描かれる。
  // この場合 canvas.width !== doc.width / canvas.height !== doc.height でも警告は出さない。
  // canvas が null の要素（グループ等）は空の OffscreenCanvas を新規作成する。
  replaceLayersFromCanvas(
    layers: {
      meta: LayerMeta;
      canvas: OffscreenCanvas | HTMLCanvasElement | null;
      ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
      deferred?: DeferredLayerInfo;
    }[],
    activeLayerId: string
  ): void {
    this.adoptLayerObjects(
      layers.map((src) => createLayerFromCanvas(src, this.width, this.height)),
      activeLayerId
    );
  }

  // 画像をレイヤーとして読み込む。バウンディングをセンタリング、必要なら縮小。
  async loadImageAsLayer(file: File | Blob, name?: string): Promise<PixelLayer> {
    const bitmap = await createImageBitmap(file);
    try {
      assertRasterImageDimensions({
        width: bitmap.width,
        height: bitmap.height,
      });
      const layer = this.addLayer(name ?? "画像", false, "raster");
      // 縦横どちらも収まるよう縮小
      const scale = Math.min(this.width / bitmap.width, this.height / bitmap.height, 1);
      const w = bitmap.width * scale;
      const h = bitmap.height * scale;
      const x = (this.width - w) / 2;
      const y = (this.height - h) / 2;
      layer.store.withCtx((ctx) => {
        (ctx as CanvasRenderingContext2D).drawImage(
          bitmap as unknown as CanvasImageSource,
          x,
          y,
          w,
          h
        );
      }, { x, y, w, h });
      this.activeLayerId = layer.meta.id;
      this.notify();
      return layer;
    } finally {
      bitmap.close();
    }
  }

  // 下のレイヤーと結合。グループ境界や見た目を保持できない合成条件では no-op。
  // UI の活性判定も canMergeLayerDown を使い、このガードと同じ契約に揃える。
  mergeDown(id: string): boolean {
    const pair = getMergeDownPair(this.layers, id);
    if (!pair) return false;
    const { upper, lower } = pair;
    const idx = this.layers.indexOf(upper);

    mergeLayerPixelsDown(upper, lower, this.width, this.height);
    this.layers.splice(idx, 1);
    if (this.activeLayerId === id) {
      this.activeLayerId = lower.meta.id;
    }
    this.notify();
    return true;
  }

  // ===== キャンバス方向別拡張 =====
  // 各方向に追加するピクセル数 (負値で縮小)。既存ピクセルはリサンプリングせず位置だけずらす。
  extendCanvas(top: number, right: number, bottom: number, left: number): void {
    const newWidth = this.width + left + right;
    const newHeight = this.height + top + bottom;
    if (newWidth <= 0 || newHeight <= 0) return;
    if (top === 0 && right === 0 && bottom === 0 && left === 0) return;
    for (const layer of this.layers) {
      extendLayerPixels(layer, newWidth, newHeight, top, left);
    }
    this.width = newWidth;
    this.height = newHeight;
    // doc サイズ変更でプールの保持 canvas は別サイズになるので破棄
    sharedCanvasPool.clear();
    this.notify();
  }

  // ===== 新規キャンバスへ初期化 =====
  // 既存レイヤーをすべて破棄し、指定サイズ・DPI で空の初期レイヤーを 1 枚作る。
  // 「ファイル > 新規」相当。履歴のクリアは呼び出し側で行う。
  resetForNew(newWidth: number, newHeight: number, dpi: number = DEFAULT_DPI): void {
    this.width = newWidth;
    this.height = newHeight;
    this.dpi = normalizeDpi(dpi);
    this.layers = [];
    const store = new TileStore(newWidth, newHeight);
    const layer: PixelLayer = {
      meta: {
        id: nextLayerId(),
        name: "レイヤー1",
        visible: true,
        opacity: 1,
        blendMode: "normal" as BlendMode,
        locked: false,
        transparentPixelLock: false,
        kind: "raster" as LayerKind,
      },
      store,
    };
    this.layers.push(layer);
    this.activeLayerId = layer.meta.id;
    sharedCanvasPool.clear();
    this.notify();
  }

  // ===== 解像度変更 =====
  // 既存ピクセルを引き継いで全レイヤーをリサンプリングする。
  // テキストレイヤーは現在の見た目を保つためラスターレイヤーへ変換する。
  // deferred レイヤーは bbox 内容を doc 座標系に展開してからリサンプリング。
  resize(newWidth: number, newHeight: number): void {
    for (const layer of this.layers) {
      resizeLayerPixels(layer, this.width, this.height, newWidth, newHeight);
    }
    this.width = newWidth;
    this.height = newHeight;
    // doc サイズ変更でプールの保持 canvas は別サイズになるので破棄
    sharedCanvasPool.clear();
    this.notify();
  }

  // 描画系メソッドの後に呼ぶ（レンダラの再合成トリガ）。
  // 構造変更や非アクティブ層への書き込み後はこちら。
  invalidate(): void {
    this.notify();
  }

  // アクティブ層のピクセルだけ変えた後に呼ぶ用。
  // CanvasRenderer の below/above キャッシュを壊さずに React 側へだけ通知する。
  // ブラシ/ぼかし/シェイプ/グラデのコミット後など、確実にアクティブ層しか触っていない経路で使う。
  invalidateActive(): void {
    this.notify({ bumpBg: false });
  }
}
