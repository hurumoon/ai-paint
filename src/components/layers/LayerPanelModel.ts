import {
  canMergeLayerDown,
  PaintDocument,
  PixelLayer,
} from "../../core/PaintDocument";
import { History } from "../../core/History";

export interface DisplayRow {
  layer: PixelLayer;
  depth: number;
}

export type DropPos = "before" | "after" | "inside";

export interface DropTarget {
  rowId: string;
  pos: DropPos;
}

// レイヤー構造操作 (追加/削除/並び替え/フォルダ/結合) を履歴付きで実行する。
// 履歴は構造 (順序・メタ・実体参照) のみを記録し、全レイヤーのピクセル複製は
// 行わない。操作でピクセルが変わるレイヤーがある場合 (mergeDown の下側など) は
// opts.pixelLayerIds で宣言すると、そのレイヤーだけ before/after を複製する。
export function withStructureHistory(
  doc: PaintDocument,
  history: History,
  label: string,
  fn: () => unknown,
  opts?: { pixelLayerIds?: string[] }
): boolean {
  history.beginStructureOperation(doc, opts);
  try {
    const changed = fn();
    if (changed === false) {
      history.cancelOperation();
      return false;
    }
    history.commitStructureOperation(doc, label);
    return true;
  } catch (e) {
    history.cancelOperation();
    throw e;
  }
}

export function canMergeDown(doc: PaintDocument, active: PixelLayer | undefined): boolean {
  return !!active && canMergeLayerDown(doc.layers, active.meta.id);
}

export function canRemoveLayer(doc: PaintDocument, active: PixelLayer | undefined): boolean {
  if (!active) return false;
  const toRemove = new Set<string>([active.meta.id]);
  if (active.meta.kind === "group") {
    for (const id of doc.getDescendantIds(active.meta.id)) toRemove.add(id);
  }
  return doc.layers.some(
    (layer) => !toRemove.has(layer.meta.id) && layer.meta.kind !== "group"
  );
}

export function findIndentTarget(
  doc: PaintDocument,
  active: PixelLayer
): PixelLayer | undefined {
  const idx = doc.layers.findIndex((l) => l.meta.id === active.meta.id);
  for (let i = idx - 1; i >= 0; i -= 1) {
    const l = doc.layers[i];
    if (l.meta.kind === "group" && l.meta.parentId === active.meta.parentId) {
      return l;
    }
    if (l.meta.parentId === active.meta.parentId) return undefined;
  }
  return undefined;
}

export function buildDisplayRows(doc: PaintDocument): DisplayRow[] {
  const byId = new Map<string, PixelLayer>();
  for (const l of doc.layers) byId.set(l.meta.id, l);

  const isHidden = (l: PixelLayer): boolean => {
    let pid = l.meta.parentId;
    while (pid) {
      const p = byId.get(pid);
      if (!p) return false;
      if (p.meta.collapsed) return true;
      pid = p.meta.parentId;
    }
    return false;
  };

  const depthOf = (l: PixelLayer): number => {
    let d = 0;
    let pid = l.meta.parentId;
    while (pid) {
      const p = byId.get(pid);
      if (!p) break;
      d += 1;
      pid = p.meta.parentId;
    }
    return d;
  };

  const rows: DisplayRow[] = [];
  for (let i = doc.layers.length - 1; i >= 0; i -= 1) {
    const l = doc.layers[i];
    if (isHidden(l)) continue;
    rows.push({ layer: l, depth: depthOf(l) });
  }
  return rows;
}

export function findSiblingRow(
  rows: DisplayRow[],
  layer: PixelLayer,
  direction: "up" | "down"
): DisplayRow | undefined {
  const idx = rows.findIndex((r) => r.layer.meta.id === layer.meta.id);
  if (idx < 0) return undefined;
  const step = direction === "up" ? -1 : 1;
  for (let i = idx + step; i >= 0 && i < rows.length; i += step) {
    if (rows[i].layer.meta.parentId === layer.meta.parentId) return rows[i];
  }
  return undefined;
}

export function isSelfOrDescendant(
  doc: PaintDocument,
  draggingId: string,
  targetId: string
): boolean {
  if (draggingId === targetId) return true;
  const layer = doc.getLayer(draggingId);
  if (!layer || layer.meta.kind !== "group") return false;
  return doc.getDescendantIds(draggingId).includes(targetId);
}
