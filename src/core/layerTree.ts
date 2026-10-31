import type { LayerKind, LayerMeta } from "../types";

export interface LayerTreeNode {
  meta: Pick<LayerMeta, "id" | "kind" | "parentId">;
}

// 元配列内のトップレベル順・同一親内の兄弟順を保ったまま、
// 各グループを「親、全子孫」の連続ブロックへ並べ直す。
// 不正グラフを検証する責務は持たないが、欠損親や循環が混じっても要素は捨てない。
export function normalizeLayerOrder<T extends LayerTreeNode>(layers: readonly T[]): T[] {
  const childrenByParent = new Map<string | undefined, T[]>();
  for (const layer of layers) {
    const siblings = childrenByParent.get(layer.meta.parentId);
    if (siblings) siblings.push(layer);
    else childrenByParent.set(layer.meta.parentId, [layer]);
  }

  const ordered: T[] = [];
  const visited = new Set<T>();
  const visit = (layer: T): void => {
    if (visited.has(layer)) return;
    visited.add(layer);
    ordered.push(layer);
    for (const child of childrenByParent.get(layer.meta.id) ?? []) {
      visit(child);
    }
  };

  for (const root of childrenByParent.get(undefined) ?? []) visit(root);
  // 通常は読み込み検証で弾かれるが、欠損親や循環があっても入力要素を失わない。
  for (const layer of layers) visit(layer);
  return ordered;
}

export function getDescendantIds(layers: readonly LayerTreeNode[], groupId: string): string[] {
  const out: string[] = [];
  const visited = new Set<string>([groupId]);
  const queue = [groupId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const layer of layers) {
      if (layer.meta.parentId === id && !visited.has(layer.meta.id)) {
        visited.add(layer.meta.id);
        out.push(layer.meta.id);
        if (layer.meta.kind === "group") queue.push(layer.meta.id);
      }
    }
  }
  return out;
}

export function isDescendantOf(
  layers: readonly LayerTreeNode[],
  id: string,
  ancestorId: string | undefined
): boolean {
  if (!ancestorId) return false;
  const byId = new Map(layers.map((layer) => [layer.meta.id, layer]));
  let cur: string | undefined = byId.get(id)?.meta.parentId;
  const visited = new Set<string>();
  while (cur) {
    if (cur === ancestorId) return true;
    if (visited.has(cur)) return false;
    visited.add(cur);
    cur = byId.get(cur)?.meta.parentId;
  }
  return false;
}

export function insertionIndexAboveActive(
  layers: readonly LayerTreeNode[],
  activeLayerId: string
): number {
  const activeIdx = layers.findIndex((layer) => layer.meta.id === activeLayerId);
  if (activeIdx < 0) return layers.length;
  const active = layers[activeIdx];
  let insertAt = activeIdx + 1;
  if (active.meta.kind === ("group" satisfies LayerKind)) {
    const descendants = new Set(getDescendantIds(layers, active.meta.id));
    for (let i = activeIdx + 1; i < layers.length; i += 1) {
      if (descendants.has(layers[i].meta.id)) insertAt = i + 1;
      else break;
    }
  }
  return insertAt;
}
