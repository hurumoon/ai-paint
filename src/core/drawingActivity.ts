export interface DrawingActivityDay {
  date: string;
  amount: number;
  operations: number;
  updatedAt: number;
}

interface DrawingActivityStore {
  days: Record<string, DrawingActivityDay>;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const STORAGE_KEY = "ai-paint-drawing-activity-v1";
const MAX_DAYS = 730;

let cache: DrawingActivityStore | null = null;
const listeners = new Set<() => void>();

export function subscribeDrawingActivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function loadDrawingActivityDays(): DrawingActivityDay[] {
  return Object.values(readStore().days).sort((a, b) =>
    a.date.localeCompare(b.date)
  );
}

export function recordDrawingActivity(amount: number, at = Date.now()): void {
  if (!Number.isFinite(amount) || amount <= 0) return;
  const date = toLocalDateKey(at);
  const store = readStore();
  const current = store.days[date];
  store.days[date] = {
    date,
    amount: Math.round((current?.amount ?? 0) + amount),
    operations: (current?.operations ?? 0) + 1,
    updatedAt: at,
  };
  pruneStore(store);
  writeStore(store);
  notify();
}

export function estimateRectDrawingAmount(
  rect: Rect,
  width: number,
  height: number
): number {
  const x1 = Math.max(0, Math.floor(rect.x));
  const y1 = Math.max(0, Math.floor(rect.y));
  const x2 = Math.min(width, Math.ceil(rect.x + rect.w));
  const y2 = Math.min(height, Math.ceil(rect.y + rect.h));
  if (x2 <= x1 || y2 <= y1) return 0;
  return (x2 - x1) * (y2 - y1);
}

export function countChangedPixels(before: ImageData, after: ImageData): number {
  if (before.width !== after.width || before.height !== after.height) {
    return Math.max(before.width * before.height, after.width * after.height);
  }
  const a = before.data;
  const b = after.data;
  let count = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (
      a[i] !== b[i] ||
      a[i + 1] !== b[i + 1] ||
      a[i + 2] !== b[i + 2] ||
      a[i + 3] !== b[i + 3]
    ) {
      count += 1;
    }
  }
  return count;
}

function readStore(): DrawingActivityStore {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      cache = { days: {} };
      return cache;
    }
    const parsed = JSON.parse(raw) as Partial<DrawingActivityStore>;
    const days: Record<string, DrawingActivityDay> = {};
    if (parsed.days && typeof parsed.days === "object") {
      for (const value of Object.values(parsed.days)) {
        if (!isValidDay(value)) continue;
        days[value.date] = {
          date: value.date,
          amount: Math.max(0, Math.round(value.amount)),
          operations: Math.max(0, Math.round(value.operations)),
          updatedAt: value.updatedAt,
        };
      }
    }
    cache = { days };
  } catch {
    cache = { days: {} };
  }
  return cache;
}

function writeStore(store: DrawingActivityStore): void {
  cache = store;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // localStorage が使えない環境では描画記録の保存だけ諦める。
  }
}

function pruneStore(store: DrawingActivityStore): void {
  const dates = Object.keys(store.days).sort();
  const overflow = dates.length - MAX_DAYS;
  if (overflow <= 0) return;
  for (const date of dates.slice(0, overflow)) {
    delete store.days[date];
  }
}

function notify(): void {
  for (const listener of listeners) listener();
}

function toLocalDateKey(at: number): string {
  const date = new Date(at);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isValidDay(value: unknown): value is DrawingActivityDay {
  if (!value || typeof value !== "object") return false;
  const day = value as Partial<DrawingActivityDay>;
  return (
    typeof day.date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(day.date) &&
    typeof day.amount === "number" &&
    Number.isFinite(day.amount) &&
    typeof day.operations === "number" &&
    Number.isFinite(day.operations) &&
    typeof day.updatedAt === "number" &&
    Number.isFinite(day.updatedAt)
  );
}
