import { PaintDocument, PixelLayer } from "./PaintDocument";
import { LayerMeta } from "../types";
import {
  applyStructureState,
  captureStructureState,
  restoreSnapshot,
  snapshotLayer,
  snapshotSize,
  unionSnapshotRect as unionRect,
} from "./historySnapshots";
import type {
  LayerSnapshot,
  SnapshotRegion,
  StructureState,
} from "./historySnapshots";
import { DEFAULT_HISTORY_MEMORY_BUDGET } from "./historyMemory";

export type { SnapshotRegion } from "./historySnapshots";

// 部分操作: 特定レイヤーのピクセル変更のみ。
interface PartialEntry {
  kind: "partial";
  label: string;
  before: LayerSnapshot[];
  after: LayerSnapshot[];
}

// 構造操作 (レイヤー追加/削除/並び替え/フォルダ操作/結合)。
// ピクセルは原則複製しない:
//   - 順序・所属・メタ・アクティブは StructureState (メタのコピーのみ) で持つ
//   - 操作で doc から消えるレイヤーの実体 (TileStore) は stash に共有参照で預かり、
//     undo/redo の適用時に doc と実体の所有権を交換する (applyStructureState 参照)
//   - 結合のようにピクセル自体が変わるレイヤーだけ、呼び出し側が pixelLayerIds で
//     宣言して before/after の ImageData を複製する (通常 1 レイヤー分)
// 従来の FullEntry (全レイヤー × doc 寸 ImageData × before/after) は 100 レイヤー超で
// 操作 1 回あたり GB 級のコピーが走っていたため廃止した。
interface StructureEntry {
  kind: "structure";
  label: string;
  before: StructureState;
  after: StructureState;
  stash: Map<string, PixelLayer>;
  pixelBefore: LayerSnapshot[];
  pixelAfter: LayerSnapshot[];
  // push 時点で確定させた予算計上バイト数。stash の中身は undo/redo で増減するため、
  // 都度計算すると memoryUsed の加算と減算が食い違う。
  bytes: number;
}

// メタのみ操作 (visible / opacity / blendMode 等の Partial<LayerMeta> 変更)。
// ピクセルもレイヤー順序も変えないので、ImageData を一切撮らない。
// PSD 直後の遅延レイヤーを無駄に展開しないためにも、この経路を使う。
interface MetaOnlyEntry {
  kind: "metaOnly";
  label: string;
  before: { layerId: string; patch: Partial<LayerMeta> }[];
  after: { layerId: string; patch: Partial<LayerMeta> }[];
}

type HistoryEntry = PartialEntry | StructureEntry | MetaOnlyEntry;

interface BudgetEvictionCandidate {
  sequence: number;
  bytes: number;
}

const entrySequences = new WeakMap<HistoryEntry, number>();
let nextEntrySequence = 1;

function entrySize(e: HistoryEntry): number {
  if (e.kind === "partial") {
    return (
      e.before.reduce((a, s) => a + snapshotSize(s), 0) +
      e.after.reduce((a, s) => a + snapshotSize(s), 0)
    );
  }
  if (e.kind === "metaOnly") {
    // patch オブジェクトは数十バイト程度。budget 計算では無視できる程度の小ささだが、
    // 0 を返すと際限なく溜まるので最低限の見積もりを入れる。
    return (e.before.length + e.after.length) * 128;
  }
  return e.bytes;
}

// StructureEntry の予算計上バイト数を push 時点の状態から見積もる。
// メタは 1 レイヤーあたり定数、ピクセル複製 (結合の下側など) は実サイズ、
// stash に預かった実体 (削除されたレイヤー等) は実体化済みタイルの概算を数える。
function structureEntrySize(e: StructureEntry): number {
  let bytes = (e.before.order.length + e.after.order.length) * 128;
  for (const s of e.pixelBefore) bytes += snapshotSize(s);
  for (const s of e.pixelAfter) bytes += snapshotSize(s);
  for (const layer of e.stash.values()) bytes += layer.store.getApproxByteSize();
  return bytes;
}

function entrySequence(entry: HistoryEntry): number {
  return entrySequences.get(entry) ?? Number.MAX_SAFE_INTEGER;
}

// 全タブの History が共有する予算管理。各 History に同じ上限を配るのではなく、
// 保持中の全エントリを合算し、アプリ全体で最も古いものから破棄する。
export class HistoryMemoryBudgetManager {
  private readonly histories = new Set<History>();
  private memoryBudget: number;
  private enforcing = false;

  constructor(memoryBudget = DEFAULT_HISTORY_MEMORY_BUDGET) {
    this.memoryBudget = memoryBudget;
  }

  register(history: History): void {
    this.histories.add(history);
    this.enforceBudget();
  }

  unregister(history: History): void {
    this.histories.delete(history);
  }

  setMemoryBudget(budget: number): void {
    if (!Number.isFinite(budget) || budget <= 0) return;
    this.memoryBudget = budget;
    this.enforceBudget();
  }

  getMemoryBudget(): number {
    return this.memoryBudget;
  }

  historyMemoryChanged(): void {
    this.enforceBudget();
  }

  private enforceBudget(): void {
    if (this.enforcing) return;
    this.enforcing = true;
    try {
      let memoryUsed = 0;
      let entryCount = 0;
      for (const history of this.histories) {
        memoryUsed += history.getMemoryUsedForBudget();
        entryCount += history.getEntryCountForBudget();
      }

      // 従来と同様、操作 1 回だけで上限を超える場合はその 1 件を残す。
      // 複数タブに 1 件ずつ残すのではなく、全タブを通じて最後の 1 件だけが対象。
      while (memoryUsed > this.memoryBudget && entryCount > 1) {
        let target: History | null = null;
        let candidate: BudgetEvictionCandidate | null = null;
        for (const history of this.histories) {
          const next = history.getBudgetEvictionCandidate();
          if (!next || (candidate && next.sequence >= candidate.sequence)) {
            continue;
          }
          target = history;
          candidate = next;
        }
        if (!target || !candidate) break;
        if (!target.evictBudgetCandidate(candidate.sequence)) break;
        memoryUsed -= candidate.bytes;
        entryCount -= 1;
      }
    } finally {
      this.enforcing = false;
    }
  }
}

function tileSnapshotKey(layerId: string, x: number, y: number): string {
  return `${layerId}:${x}:${y}`;
}

export class History {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private memoryUsed = 0;
  private memoryBudget: number;
  private readonly sharedMemoryBudget: HistoryMemoryBudgetManager | null;
  private pendingBefore: LayerSnapshot[] | null = null;
  private pendingStructure: {
    doc: PaintDocument;
    before: StructureState;
    // begin 時点の id → レイヤー実体。commit 時に「操作で消えた実体」を
    // stash へ移すために保持する (removeLayer 等は配列から抜くだけなので、
    // ここで参照を握っていないと実体を取り戻せない)。
    layerObjects: Map<string, PixelLayer>;
    pixelLayerIds: string[];
    pixelRegion?: SnapshotRegion;
    pixelBefore: LayerSnapshot[];
  } | null = null;
  // region 追跡モード時の状態 (ブラシストローク用):
  // withCtx の hint と同じ矩形から交差タイルを求め、初めて触るタイルの
  // before だけを保存する。doc 全域の clone canvas は作らない。
  private pendingTileBefore: Map<string, LayerSnapshot> | null = null;
  private pendingRegion: SnapshotRegion | null = null;
  private pendingTrackDoc: PaintDocument | null = null;
  private pendingTrackLayerIds: string[] = [];
  // pendingTileBefore を作った時点での doc サイズ。
  // ストローク中に doc.resize されると before(タイル) と after(現レイヤー) の
  // サイズが食い違い、getImageData の座標系が壊れる。commit 時に一致を確認する。
  private pendingTrackWidth = 0;
  private pendingTrackHeight = 0;

  private listeners = new Set<() => void>();
  private version = 0;

  constructor(
    memoryBudget: number | HistoryMemoryBudgetManager =
      DEFAULT_HISTORY_MEMORY_BUDGET
  ) {
    this.sharedMemoryBudget =
      memoryBudget instanceof HistoryMemoryBudgetManager ? memoryBudget : null;
    this.memoryBudget =
      typeof memoryBudget === "number"
        ? memoryBudget
        : memoryBudget.getMemoryBudget();
    this.sharedMemoryBudget?.register(this);
  }

  setMemoryBudget(budget: number): void {
    if (!Number.isFinite(budget) || budget <= 0) return;
    if (this.sharedMemoryBudget) {
      this.sharedMemoryBudget.setMemoryBudget(budget);
      return;
    }
    this.memoryBudget = budget;
    this.enforceBudget();
  }

  getMemoryBudget(): number {
    return this.sharedMemoryBudget?.getMemoryBudget() ?? this.memoryBudget;
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

  canUndo(): boolean { return this.undoStack.length > 0; }
  canRedo(): boolean { return this.redoStack.length > 0; }

  // ===== ピクセルのみ操作 =====
  // opts.trackRegion=true でストローク用の region モードに入る。
  // モード中は expandRegion(rect) で変更範囲を伸ばす。rect に交差するタイルは
  // 初回だけ before を保存し、commit 時に同じタイルの after を保存する。
  // 追加の rect は、描画前に expandRegion へ渡す必要がある。
  beginOperation(
    doc: PaintDocument,
    affectedLayerIds: string[],
    opts?: { trackRegion?: boolean; initialRegion?: SnapshotRegion }
  ): void {
    // 影響レイヤーが PSD 直後の遅延状態なら、ここで doc サイズに展開しておく。
    // 以降のスナップショット・ブラシ書き込みは layer.ctx を doc 座標系で扱える前提なので、
    // この一回で全部の経路が整合する。
    doc.materializeLayers(affectedLayerIds);
    if (opts?.trackRegion) {
      this.pendingBefore = null;
      this.pendingTileBefore = new Map();
      this.pendingTrackDoc = doc;
      this.pendingTrackLayerIds = [...affectedLayerIds];
      this.pendingTrackWidth = doc.width;
      this.pendingTrackHeight = doc.height;
      this.pendingRegion = null;
      if (opts.initialRegion) this.expandRegion(opts.initialRegion);
    } else {
      this.pendingTileBefore = null;
      this.pendingRegion = null;
      this.pendingTrackDoc = null;
      this.pendingTrackLayerIds = [];
      this.pendingTrackWidth = 0;
      this.pendingTrackHeight = 0;
      this.pendingBefore = affectedLayerIds
        .map((id) => snapshotLayer(doc, id))
        .filter((s): s is LayerSnapshot => s !== null);
    }
  }

  // region 追跡モード中のみ有効。bbox を蓄積し、交差タイルの before を
  // 初回だけ保存する。新しく触る範囲は描画前に渡すこと。
  expandRegion(rect: SnapshotRegion): void {
    if (!this.pendingTileBefore) return;
    this.pendingRegion = this.pendingRegion
      ? unionRect(this.pendingRegion, rect)
      : { ...rect };
    this.capturePendingBeforeTiles(rect);
  }

  // 追跡中のストローク bbox を覗き見する。commit 前 (= ストローク終了直後の
  // 後処理パス) で TileStore.withCtx の hint として使い、polygon/mask 復元時に
  // 影響タイルだけ materialize するのに使う。返り値はコピーなので破壊変更しても
  // 内部に影響しない。
  getPendingRegion(): SnapshotRegion | null {
    return this.pendingRegion ? { ...this.pendingRegion } : null;
  }

  // 描画後処理は履歴の before を共有し、別の全画面スナップショットを持たない。
  // visit は同期的な読み取り専用。ImageData.data を変更・保持してはいけない。
  forEachPendingBeforeTile(
    layerId: string,
    rect: SnapshotRegion | null,
    visit: (before: ImageData, tileRect: SnapshotRegion) => void
  ): void {
    if (!this.pendingTileBefore || !this.pendingTrackDoc ||
      this.pendingTrackDoc.width !== this.pendingTrackWidth ||
      this.pendingTrackDoc.height !== this.pendingTrackHeight) return;
    if (rect) {
      // 区間ごとの透明ロックで、それまでの全ストロークを毎回走査しない。
      const layer = this.pendingTrackDoc.getLayer(layerId);
      if (!layer || rect.w <= 0 || rect.h <= 0) return;
      layer.store.forEachTileRectInDocRect(rect.x, rect.y, rect.w, rect.h, (tileRect) => {
        const snap = this.pendingTileBefore?.get(tileSnapshotKey(layerId, tileRect.x, tileRect.y));
        if (snap) visit(snap.imageData, tileRect);
      });
      return;
    }
    for (const snap of this.pendingTileBefore.values()) {
      if (snap.layerId !== layerId) continue;
      const tileRect = {
        x: snap.x ?? 0, y: snap.y ?? 0,
        w: snap.imageData.width, h: snap.imageData.height,
      };
      visit(snap.imageData, tileRect);
    }
  }

  commitOperation(doc: PaintDocument, label: string, affectedLayerIds: string[]): void {
    if (this.pendingTileBefore) {
      const tileBefore = this.pendingTileBefore;
      // ストローク中に doc.resize された場合は before/after の座標系が
      // 一致しないため、エントリを破棄する。Undo は無理に作るより
      // 「resize 操作の側で full スナップショットを撮る」設計に委ねる。
      if (
        doc.width !== this.pendingTrackWidth ||
        doc.height !== this.pendingTrackHeight
      ) {
        this.clearPendingRegionTracking();
        return;
      }
      const affected = new Set(affectedLayerIds);
      const before: LayerSnapshot[] = [];
      const after: LayerSnapshot[] = [];
      for (const snap of tileBefore.values()) {
        if (!affected.has(snap.layerId)) continue;
        const layer = doc.getLayer(snap.layerId);
        if (!layer) continue;
        const x = snap.x ?? 0;
        const y = snap.y ?? 0;
        before.push(snap);
        after.push({
          layerId: snap.layerId,
          imageData: layer.store.getImageData(
            x,
            y,
            snap.imageData.width,
            snap.imageData.height
          ),
          width: doc.width,
          height: doc.height,
          x,
          y,
        });
      }
      this.clearPendingRegionTracking();
      if (before.length === 0) {
        return;
      }
      const entry: PartialEntry = {
        kind: "partial",
        label,
        before,
        after,
      };
      this.pushEntry(entry);
      return;
    }
    if (!this.pendingBefore) return;
    const after = affectedLayerIds
      .map((id) => snapshotLayer(doc, id))
      .filter((s): s is LayerSnapshot => s !== null);
    const entry: PartialEntry = {
      kind: "partial",
      label,
      before: this.pendingBefore,
      after,
    };
    this.pendingBefore = null;
    this.pushEntry(entry);
  }

  cancelOperation(): void {
    this.pendingBefore = null;
    this.pendingStructure = null;
    this.clearPendingRegionTracking();
  }

  // ストローク中に pointercancel 等でピクセル変更が発生した状態から中断する場合、
  // cancelOperation だけだと before タイルが捨てられて
  // 描かれた画素が history entry もなく残留し、undo で消せないゴミになる。
  // この経路では保存済み before タイルをレイヤーに焼き戻してから pending をクリアする。
  // trackRegion モードで beginOperation した時のみ意味がある (それ以外は no-op
  // と同等で、内部的に cancelOperation に落ちる)。
  rollbackOperation(doc: PaintDocument): void {
    if (
      this.pendingTileBefore &&
      doc.width === this.pendingTrackWidth &&
      doc.height === this.pendingTrackHeight
    ) {
      for (const snap of this.pendingTileBefore.values()) {
        restoreSnapshot(doc, snap);
      }
      doc.invalidate();
    }
    this.cancelOperation();
  }

  // ===== 構造変更操作（レイヤー追加・削除・並び替え・結合・テキスト追加） =====
  // ピクセルを複製せず、順序・メタ・実体参照だけで undo/redo を成立させる。
  // 操作でピクセルが変わるレイヤー (mergeDown の下側など) がある場合のみ、
  // opts.pixelLayerIds で宣言する。pixelRegion を渡す場合は、変更前後を含む同じ領域を撮る。
  beginStructureOperation(
    doc: PaintDocument,
    opts?: { pixelLayerIds?: string[]; pixelRegion?: SnapshotRegion }
  ): void {
    const pixelLayerIds = opts?.pixelLayerIds ?? [];
    // ピクセルスナップショットは doc 座標系 (doc 寸) で撮る必要があるため、
    // 対象レイヤーだけ遅延形態を解く。構造だけのレイヤーは bbox 形態のまま触らない。
    doc.materializeLayers(pixelLayerIds);
    this.pendingStructure = {
      doc,
      before: captureStructureState(doc),
      layerObjects: new Map(doc.layers.map((l) => [l.meta.id, l])),
      pixelLayerIds,
      pixelRegion: opts?.pixelRegion ? { ...opts.pixelRegion } : undefined,
      pixelBefore: pixelLayerIds
        .map((id) => snapshotLayer(doc, id, opts?.pixelRegion))
        .filter((s): s is LayerSnapshot => s !== null),
    };
  }

  commitStructureOperation(doc: PaintDocument, label: string): void {
    const pending = this.pendingStructure;
    this.pendingStructure = null;
    if (!pending || pending.doc !== doc) return;
    // 構造操作中に doc サイズは変わらない前提。変わっていたら before/after の
    // 座標系が食い違うので、エントリを作らず破棄する。
    if (doc.width !== pending.before.width || doc.height !== pending.before.height) {
      return;
    }
    const after = captureStructureState(doc);
    // 操作で doc から消えたレイヤーの実体を stash へ (削除・結合の上側など)。
    // ピクセルは複製せず、実体そのものの所有権をエントリへ移す。
    const afterIds = new Set(after.order);
    const stash = new Map<string, PixelLayer>();
    for (const id of pending.before.order) {
      if (afterIds.has(id)) continue;
      const removed = pending.layerObjects.get(id);
      if (removed) stash.set(id, removed);
    }
    const entry: StructureEntry = {
      kind: "structure",
      label,
      before: pending.before,
      after,
      stash,
      pixelBefore: pending.pixelBefore,
      pixelAfter: pending.pixelLayerIds
        .map((id) => snapshotLayer(doc, id, pending.pixelRegion))
        .filter((s): s is LayerSnapshot => s !== null),
      bytes: 0,
    };
    entry.bytes = structureEntrySize(entry);
    this.pushEntry(entry);
  }

  // ===== メタのみ操作 (visible / opacity / blendMode 等) =====
  // ピクセルも順序も変えないので ImageData を一切撮らない。
  // 変更前後の meta から、変わったキーだけを抽出した patch を保存する。
  // PSD 直後の遅延レイヤーを doc サイズに展開せずに済むのが主目的。
  recordMetaChange(
    doc: PaintDocument,
    layerIds: string[],
    label: string,
    fn: () => void
  ): void {
    const beforeMetas = new Map<string, LayerMeta>();
    for (const id of layerIds) {
      const layer = doc.getLayer(id);
      if (layer) beforeMetas.set(id, { ...layer.meta });
    }
    fn();
    const before: { layerId: string; patch: Partial<LayerMeta> }[] = [];
    const after: { layerId: string; patch: Partial<LayerMeta> }[] = [];
    for (const [id, beforeMeta] of beforeMetas) {
      const layer = doc.getLayer(id);
      if (!layer) continue;
      const beforePatch: Partial<LayerMeta> = {};
      const afterPatch: Partial<LayerMeta> = {};
      let changed = false;
      for (const key of Object.keys(layer.meta) as (keyof LayerMeta)[]) {
        if (beforeMeta[key] !== layer.meta[key]) {
          (beforePatch as Record<string, unknown>)[key] = beforeMeta[key];
          (afterPatch as Record<string, unknown>)[key] = layer.meta[key];
          changed = true;
        }
      }
      if (changed) {
        before.push({ layerId: id, patch: beforePatch });
        after.push({ layerId: id, patch: afterPatch });
      }
    }
    if (before.length === 0) return;
    const entry: MetaOnlyEntry = { kind: "metaOnly", label, before, after };
    this.pushEntry(entry);
  }

  private pushEntry(entry: HistoryEntry): void {
    entrySequences.set(entry, nextEntrySequence);
    nextEntrySequence += 1;
    this.undoStack.push(entry);
    this.memoryUsed += entrySize(entry);
    for (const e of this.redoStack) this.memoryUsed -= entrySize(e);
    this.redoStack = [];
    this.enforceBudget();
    this.notify();
  }

  private enforceBudget(): void {
    if (this.sharedMemoryBudget) {
      this.sharedMemoryBudget.historyMemoryChanged();
      return;
    }
    while (this.memoryUsed > this.memoryBudget && this.undoStack.length > 1) {
      const dropped = this.undoStack.shift()!;
      this.memoryUsed -= entrySize(dropped);
    }
  }

  undo(doc: PaintDocument): void {
    const entry = this.undoStack.pop();
    if (!entry) return;
    if (entry.kind === "partial") {
      for (const snap of entry.before) restoreSnapshot(doc, snap);
    } else if (entry.kind === "metaOnly") {
      for (const m of entry.before) doc.updateLayerMeta(m.layerId, m.patch);
    } else {
      // 構造を戻してから、ピクセルが変わったレイヤーの before を焼き戻す
      // (結合の undo なら、上側レイヤーの復帰 → 下側ピクセルの復元の順)。
      applyStructureState(doc, entry.before, entry.stash);
      for (const snap of entry.pixelBefore) restoreSnapshot(doc, snap);
    }
    this.redoStack.push(entry);
    if (entry.kind === "structure") this.reaccountStructureEntry(entry);
    doc.invalidate();
    this.notify();
  }

  redo(doc: PaintDocument): void {
    const entry = this.redoStack.pop();
    if (!entry) return;
    if (entry.kind === "partial") {
      for (const snap of entry.after) restoreSnapshot(doc, snap);
    } else if (entry.kind === "metaOnly") {
      for (const m of entry.after) doc.updateLayerMeta(m.layerId, m.patch);
    } else {
      applyStructureState(doc, entry.after, entry.stash);
      for (const snap of entry.pixelAfter) restoreSnapshot(doc, snap);
    }
    this.undoStack.push(entry);
    if (entry.kind === "structure") this.reaccountStructureEntry(entry);
    doc.invalidate();
    this.notify();
  }

  // applyStructureState で stash の中身が増減した後に、エントリの計上バイト数を
  // 実態へ追従させる。「ピクセル入りレイヤーを追加した操作」を undo すると、
  // push 時 (stash 空) には計上されていなかった大きな実体が stash へ移るため、
  // ここで差分計上しないと redo スタックが予算外のメモリを保持し続けてしまう。
  // 増加時は enforceBudget で古い undo エントリを間引く (エントリ削除時は
  // その時点の bytes を引くので、加算と減算は常に対で釣り合う)。
  private reaccountStructureEntry(entry: StructureEntry): void {
    const bytes = structureEntrySize(entry);
    if (bytes === entry.bytes) return;
    this.memoryUsed += bytes - entry.bytes;
    entry.bytes = bytes;
    this.enforceBudget();
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.memoryUsed = 0;
    this.notify();
  }

  getMemoryUsedForBudget(): number {
    return this.memoryUsed;
  }

  getEntryCountForBudget(): number {
    return this.undoStack.length + this.redoStack.length;
  }

  getBudgetEvictionCandidate(): BudgetEvictionCandidate | null {
    const undo = this.undoStack[0];
    const redo = this.redoStack[0];
    if (!undo && !redo) return null;
    if (!undo) {
      return { sequence: entrySequence(redo), bytes: entrySize(redo) };
    }
    if (!redo || entrySequence(undo) <= entrySequence(redo)) {
      return { sequence: entrySequence(undo), bytes: entrySize(undo) };
    }
    return { sequence: entrySequence(redo), bytes: entrySize(redo) };
  }

  evictBudgetCandidate(sequence: number): boolean {
    const undo = this.undoStack[0];
    if (undo && entrySequence(undo) === sequence) {
      this.undoStack.shift();
      this.memoryUsed -= entrySize(undo);
      return true;
    }
    // redoStack[0] は「現在位置から最も遠い未来」の操作なので、ここからなら
    // 途中の redo 依存関係を壊さず 1 件ずつ捨てられる。
    const redo = this.redoStack[0];
    if (redo && entrySequence(redo) === sequence) {
      this.redoStack.shift();
      this.memoryUsed -= entrySize(redo);
      return true;
    }
    return false;
  }

  private capturePendingBeforeTiles(rect: SnapshotRegion): void {
    if (!this.pendingTileBefore || !this.pendingTrackDoc) return;
    const doc = this.pendingTrackDoc;
    if (
      doc.width !== this.pendingTrackWidth ||
      doc.height !== this.pendingTrackHeight
    ) {
      return;
    }
    for (const layerId of this.pendingTrackLayerIds) {
      const layer = doc.getLayer(layerId);
      if (!layer) continue;
      layer.store.forEachTileRectInDocRect(rect.x, rect.y, rect.w, rect.h, (tileRect) => {
        const key = tileSnapshotKey(layerId, tileRect.x, tileRect.y);
        if (this.pendingTileBefore?.has(key)) return;
        this.pendingTileBefore?.set(key, {
          layerId,
          imageData: layer.store.getImageData(
            tileRect.x,
            tileRect.y,
            tileRect.w,
            tileRect.h
          ),
          width: doc.width,
          height: doc.height,
          x: tileRect.x,
          y: tileRect.y,
        });
      });
    }
  }

  private clearPendingRegionTracking(): void {
    this.pendingTileBefore = null;
    this.pendingRegion = null;
    this.pendingTrackDoc = null;
    this.pendingTrackLayerIds = [];
    this.pendingTrackWidth = 0;
    this.pendingTrackHeight = 0;
  }
}
