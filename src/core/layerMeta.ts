import type { LayerMeta } from "../types";

const BG_INVARIANT_KEYS = new Set<keyof LayerMeta>([
  "opacity",
  "visible",
  "blendMode",
  "name",
  "locked",
  "transparentPixelLock",
]);

export function isBgInvariantPatch(patch: Partial<LayerMeta>): boolean {
  for (const key of Object.keys(patch) as (keyof LayerMeta)[]) {
    if (!BG_INVARIANT_KEYS.has(key)) return false;
  }
  return true;
}
