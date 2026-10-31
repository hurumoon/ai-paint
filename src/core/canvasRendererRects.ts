export interface DirtyRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function chooseCacheRect(
  oldCacheRect: DirtyRect | null,
  targetRect: DirtyRect | null,
  baseValid: boolean,
  docW: number,
  docH: number
): DirtyRect | null {
  if (!targetRect) return null;
  const clampedTarget = clampToDoc(targetRect, docW, docH);
  if (!clampedTarget) return null;
  if (!baseValid || oldCacheRect == null) {
    return clampedTarget;
  }
  if (rectContains(oldCacheRect, clampedTarget)) {
    return oldCacheRect;
  }
  const union = unionRect(oldCacheRect, clampedTarget);
  const clamped = clampToDoc(union, docW, docH);
  if (!clamped) return null;
  if (clamped.w * clamped.h * 2 > docW * docH) return null;
  return clamped;
}

export function rectContains(outer: DirtyRect, inner: DirtyRect): boolean {
  return (
    outer.x <= inner.x &&
    outer.y <= inner.y &&
    outer.x + outer.w >= inner.x + inner.w &&
    outer.y + outer.h >= inner.y + inner.h
  );
}

export function sameDirtyRect(a: DirtyRect | null, b: DirtyRect | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

export function clampToDoc(r: DirtyRect, w: number, h: number): DirtyRect | null {
  const x1 = Math.max(0, Math.floor(r.x));
  const y1 = Math.max(0, Math.floor(r.y));
  const x2 = Math.min(w, Math.ceil(r.x + r.w));
  const y2 = Math.min(h, Math.ceil(r.y + r.h));
  if (x2 <= x1 || y2 <= y1) return null;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export function unionRect(a: DirtyRect, b: DirtyRect): DirtyRect {
  const x1 = Math.min(a.x, b.x);
  const y1 = Math.min(a.y, b.y);
  const x2 = Math.max(a.x + a.w, b.x + b.w);
  const y2 = Math.max(a.y + a.h, b.y + b.h);
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}
