import type { LayerMeta } from "../types";
import type { PaintDocument, PixelLayer } from "./PaintDocument";

export interface LayerSnapshot {
  layerId: string;
  imageData: ImageData;
  width: number;
  height: number;
  x?: number;
  y?: number;
}

export interface SnapshotRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

// レイヤー構造 (配列順・所属・メタ・アクティブ) だけのスナップショット。
// ピクセル (TileStore) は一切複製しない。レイヤー追加/削除/並び替え/フォルダ操作の
// 履歴はこれで表現する。100 レイヤー超のドキュメントでも数 KB で済む。
export interface StructureState {
  activeLayerId: string;
  // 配列順 (下→上) のレイヤー id
  order: string[];
  // id → その時点のメタのコピー
  metas: Map<string, LayerMeta>;
  // 撮影時の doc サイズ。適用時に一致しなければ何もしない (安全ガード)。
  width: number;
  height: number;
}

export type AnySnapshotCanvas = OffscreenCanvas | HTMLCanvasElement;
export type AnySnapshotCtx =
  | OffscreenCanvasRenderingContext2D
  | CanvasRenderingContext2D;

export function snapshotSize(s: LayerSnapshot): number {
  return s.imageData.width * s.imageData.height * 4;
}

export function snapshotLayer(
  doc: PaintDocument,
  layerId: string,
  region?: SnapshotRegion
): LayerSnapshot | null {
  const layer = doc.getLayer(layerId);
  if (!layer) return null;
  if (region && (region.w <= 0 || region.h <= 0 ||
    region.x >= doc.width || region.y >= doc.height ||
    region.x + region.w <= 0 || region.y + region.h <= 0)) return null;
  const rect = region
    ? clampSnapshotRect(region, doc.width, doc.height)
    : { x: 0, y: 0, w: doc.width, h: doc.height };
  const imageData = layer.store.getImageData(rect.x, rect.y, rect.w, rect.h);
  return {
    layerId,
    imageData,
    width: doc.width,
    height: doc.height,
    ...(region ? { x: rect.x, y: rect.y } : {}),
  };
}

export function restoreSnapshot(doc: PaintDocument, snap: LayerSnapshot): void {
  const layer = doc.getLayer(snap.layerId);
  if (!layer) return;
  if (doc.width !== snap.width || doc.height !== snap.height) return;
  doc.materializeLayer(layer);
  const x = snap.x ?? 0;
  const y = snap.y ?? 0;
  layer.store.putImageData(snap.imageData, x, y);
}

export function makeSnapshotCanvas(
  w: number,
  h: number
): { canvas: AnySnapshotCanvas; ctx: AnySnapshotCtx } {
  if (typeof OffscreenCanvas !== "undefined") {
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext("2d", { willReadFrequently: false })!;
    return { canvas: c, ctx };
  }
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: false })!;
  return { canvas: c, ctx };
}

export function clampSnapshotRect(
  r: SnapshotRegion,
  w: number,
  h: number
): SnapshotRegion {
  const x1 = Math.max(0, Math.floor(r.x));
  const y1 = Math.max(0, Math.floor(r.y));
  const x2 = Math.min(w, Math.ceil(r.x + r.w));
  const y2 = Math.min(h, Math.ceil(r.y + r.h));
  const cw = Math.max(1, x2 - x1);
  const ch = Math.max(1, y2 - y1);
  return { x: x1, y: y1, w: cw, h: ch };
}

export function unionSnapshotRect(
  a: SnapshotRegion,
  b: SnapshotRegion
): SnapshotRegion {
  const x1 = Math.min(a.x, b.x);
  const y1 = Math.min(a.y, b.y);
  const x2 = Math.max(a.x + a.w, b.x + b.w);
  const y2 = Math.max(a.y + a.h, b.y + b.h);
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export function captureStructureState(doc: PaintDocument): StructureState {
  return {
    activeLayerId: doc.activeLayerId,
    order: doc.layers.map((l) => l.meta.id),
    metas: new Map(doc.layers.map((l) => [l.meta.id, { ...l.meta }])),
    width: doc.width,
    height: doc.height,
  };
}

// 構造スナップショットを doc に適用する。stash は「この履歴エントリが所有権を
// 預かっているレイヤー実体」の置き場で、undo⇔redo の往復で doc と実体を
// 交換する:
//   - state.order に居るレイヤー: doc に現存すればその実体 (store/deferred) を
//     そのまま使い回し、メタだけをスナップショット時点のコピーへ戻す。
//     現存しなければ stash から取り出して復帰させる。
//   - doc に現存するが state.order に居ないレイヤー: stash へ退避する。
// 実体の交換は常に「doc から外れるその瞬間」に行うので、stash 内のピクセルは
// 次に逆方向へ適用される時点の正しい状態を保持している (doc から外れている間は
// どの経路からも書き込まれない)。ピクセルの複製はどこにも発生しない。
//
// deferred は store の物理形態 (bbox 保持か doc 寸か) を表すため、スナップショット
// ではなく現在の実体側から引き継ぐ。メタと違い、materialize は履歴に載らない
// 透過的な状態遷移なので、撮影時点の値を書き戻すと実体と食い違う。
//
// doc サイズが撮影時と異なる場合は何もしない (サイズ変更系の履歴が先に
// undo/redo されるべきで、無理に適用すると座標系が壊れる)。
export function applyStructureState(
  doc: PaintDocument,
  state: StructureState,
  stash: Map<string, PixelLayer>
): void {
  if (doc.width !== state.width || doc.height !== state.height) return;
  const current = new Map(doc.layers.map((l) => [l.meta.id, l]));
  const next: PixelLayer[] = [];
  for (const id of state.order) {
    const live = current.get(id) ?? stash.get(id);
    const meta = state.metas.get(id);
    if (!live || !meta) continue;
    stash.delete(id);
    next.push({
      meta: { ...meta },
      store: live.store,
      deferred: live.deferred ? { ...live.deferred } : undefined,
    });
  }
  const keep = new Set(state.order);
  for (const [id, layer] of current) {
    if (!keep.has(id)) stash.set(id, layer);
  }
  doc.replaceLayerObjects(next, state.activeLayerId);
}
