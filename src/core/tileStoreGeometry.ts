export const TILE_SIZE = 256;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function tileKey(tx: number, ty: number, tilesX: number): number {
  return ty * tilesX + tx;
}

export function rectsIntersect(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number
): boolean {
  return ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah;
}
