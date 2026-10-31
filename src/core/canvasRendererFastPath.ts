import type { PixelLayer } from "./PaintDocument";

export interface RendererScope {
  pivot: PixelLayer;
  pivotIdx: number;
  parentId: string | undefined;
}

export function evaluateCanvasRendererFastPath(
  layers: PixelLayer[],
  activeId: string
): RendererScope[] | null {
  if (!activeId) return null;
  const activeIdx = layers.findIndex((l) => l.meta.id === activeId);
  if (activeIdx < 0) return null;
  const active = layers[activeIdx];
  if (active.meta.kind === "group") return null;
  if (active.meta.clippingMask) return null;

  const idxById = new Map<string, number>();
  for (let i = 0; i < layers.length; i += 1) idxById.set(layers[i].meta.id, i);

  const scopes: RendererScope[] = [
    { pivot: active, pivotIdx: activeIdx, parentId: active.meta.parentId },
  ];
  const visited = new Set<string>([active.meta.id]);
  let pId = active.meta.parentId;
  while (pId !== undefined) {
    if (visited.has(pId)) return null;
    visited.add(pId);
    const pIdx = idxById.get(pId);
    if (pIdx === undefined) return null;
    const pLayer = layers[pIdx];
    if (pLayer.meta.kind !== "group") return null;
    if (pLayer.meta.clippingMask) return null;
    scopes.push({ pivot: pLayer, pivotIdx: pIdx, parentId: pLayer.meta.parentId });
    pId = pLayer.meta.parentId;
  }

  for (let i = 1; i < scopes.length; i += 1) {
    if (scopes[i].pivotIdx >= scopes[i - 1].pivotIdx) return null;
  }

  for (const scope of scopes) {
    for (let j = scope.pivotIdx + 1; j < layers.length; j += 1) {
      if (layers[j].meta.parentId === scope.parentId) {
        if (layers[j].meta.clippingMask) return null;
        break;
      }
    }
  }

  for (const scope of scopes) {
    for (let j = scope.pivotIdx + 1; j < layers.length; j += 1) {
      const layer = layers[j];
      if (layer.meta.parentId !== scope.parentId) continue;
      if (layer.meta.blendMode !== "normal") return null;
    }
  }

  const pivotIdxs = scopes.map((scope) => scope.pivotIdx);
  const pivotIdxSet = new Set(pivotIdxs);

  for (let i = 0; i < layers.length; i += 1) {
    if (pivotIdxSet.has(i)) continue;
    const pid = layers[i].meta.parentId;
    if (!pid) continue;
    const parentIdx = idxById.get(pid);
    if (parentIdx === undefined) continue;
    if (pivotIdxSet.has(parentIdx)) continue;
    const lo = Math.min(i, parentIdx);
    const hi = Math.max(i, parentIdx);
    for (const pivotIdx of pivotIdxs) {
      if (pivotIdx > lo && pivotIdx < hi) return null;
    }
  }

  const siblingsByParent = new Map<string | undefined, number[]>();
  for (let i = 0; i < layers.length; i += 1) {
    const pid = layers[i].meta.parentId;
    const siblings = siblingsByParent.get(pid);
    if (siblings) siblings.push(i);
    else siblingsByParent.set(pid, [i]);
  }

  for (let i = 0; i < layers.length; i += 1) {
    if (!layers[i].meta.clippingMask) continue;
    const pid = layers[i].meta.parentId;
    const siblings = siblingsByParent.get(pid);
    if (!siblings) continue;
    const pos = siblings.indexOf(i);
    if (pos <= 0) continue;
    const belowIdx = siblings[pos - 1];
    for (const pivotIdx of pivotIdxs) {
      if (pivotIdx > belowIdx && pivotIdx < i) return null;
    }
  }

  return scopes;
}
