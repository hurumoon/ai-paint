import { safeGetStorageItem, safeRemoveStorageItem, safeSetStorageItem } from "./safeStorage";

interface ReferenceViewState {
  src: string | null;
  zoom: number;
  offset: { x: number; y: number };
  popup: boolean;
}

const STORAGE_KEY = "reference-view:image";
let state: ReferenceViewState | undefined;
const listeners = new Set<() => void>();

export function getReferenceViewState(): ReferenceViewState {
  return state ??= { src: safeGetStorageItem(STORAGE_KEY), zoom: 1, offset: { x: 0, y: 0 }, popup: false };
}

export function subscribeReferenceView(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function updateReferenceView(patch: Partial<ReferenceViewState>): void {
  const current = getReferenceViewState();
  state = { ...current, ...patch };
  for (const listener of listeners) listener();
}

export function setReferenceViewImage(src: string | null): void {
  if (src === null) safeRemoveStorageItem(STORAGE_KEY);
  else if (src.length <= 4 * 1024 * 1024) safeSetStorageItem(STORAGE_KEY, src);
  updateReferenceView({ src, zoom: 1, offset: { x: 0, y: 0 }, popup: false });
}
