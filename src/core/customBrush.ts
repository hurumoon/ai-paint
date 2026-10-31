// カスタムブラシ：ユーザーが画像をスタンプ素材として登録できる。
// 画像は ImageBitmap として保持し、brushEngine が描画時に拾う。
// 永続化は dataURL を localStorage に保存（小さめの画像想定）。

export interface CustomBrushDef {
  id: string;
  name: string;
  dataUrl: string;       // 復元用
  spacingRatio: number;  // size に対するスタンプ間隔の比率
  // 描画時にカラー化するか（白黒ブラシ画像に前景色を載せる）
  tint: boolean;
}

const STORAGE_KEY = "ai-paint-custom-brushes";
const MAX_BRUSHES = 32;
const MAX_DATAURL_LEN = 2_000_000; // 2MB ぐらい

let brushes: CustomBrushDef[] = [];
const bitmapCache = new Map<string, ImageBitmap>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

function load(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const arr = JSON.parse(raw) as CustomBrushDef[];
    if (Array.isArray(arr)) brushes = arr.slice(0, MAX_BRUSHES);
  } catch {
    brushes = [];
  }
}
load();

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(brushes));
  } catch (e) {
    // QuotaExceeded など
    console.warn("custom brush save failed:", e);
  }
}

export function listCustomBrushes(): CustomBrushDef[] {
  return brushes.slice();
}

export function subscribeCustomBrushes(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export async function addCustomBrush(file: File): Promise<CustomBrushDef> {
  const dataUrl = await readFileAsDataURL(file);
  if (dataUrl.length > MAX_DATAURL_LEN) {
    throw new Error("画像が大きすぎます (2MB目安)。リサイズしてください。");
  }
  const id = `cb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const def: CustomBrushDef = {
    id,
    name: file.name.replace(/\.[^.]+$/, "") || "ブラシ",
    dataUrl,
    spacingRatio: 0.2,
    tint: true,
  };
  brushes.push(def);
  if (brushes.length > MAX_BRUSHES) {
    const dropped = brushes.shift();
    // 上限超過で破棄したブラシの ImageBitmap キャッシュを閉じてメモリを解放する。
    // 閉じ忘れると removeCustomBrush と非対称になり、ネイティブ側ビットマップが残留する。
    if (dropped) {
      const bmp = bitmapCache.get(dropped.id);
      if (bmp) {
        bmp.close();
        bitmapCache.delete(dropped.id);
      }
    }
  }
  persist();
  notify();
  return def;
}

export function removeCustomBrush(id: string): void {
  brushes = brushes.filter((b) => b.id !== id);
  const bmp = bitmapCache.get(id);
  if (bmp) {
    bmp.close();
    bitmapCache.delete(id);
  }
  persist();
  notify();
}

export function updateCustomBrush(id: string, patch: Partial<CustomBrushDef>): void {
  const idx = brushes.findIndex((b) => b.id === id);
  if (idx < 0) return;
  // dataUrl を差し替える場合は ImageBitmap キャッシュを破棄する。
  // 残しておくと getCustomBrushBitmap が古い画像のビットマップを返し続ける。
  if (patch.dataUrl !== undefined && patch.dataUrl !== brushes[idx].dataUrl) {
    const bmp = bitmapCache.get(id);
    if (bmp) {
      bmp.close();
      bitmapCache.delete(id);
    }
  }
  brushes[idx] = { ...brushes[idx], ...patch };
  persist();
  notify();
}

export function getCustomBrush(id: string): CustomBrushDef | undefined {
  return brushes.find((b) => b.id === id);
}

// 描画用 ImageBitmap を取得（キャッシュ）
export async function getCustomBrushBitmap(id: string): Promise<ImageBitmap | null> {
  const cached = bitmapCache.get(id);
  if (cached) return cached;
  const def = getCustomBrush(id);
  if (!def) return null;
  try {
    const res = await fetch(def.dataUrl);
    const blob = await res.blob();
    const bmp = await createImageBitmap(blob);
    bitmapCache.set(id, bmp);
    return bmp;
  } catch {
    return null;
  }
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}
