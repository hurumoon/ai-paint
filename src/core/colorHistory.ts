// カラー履歴: 使用した前景色を新しい順で保持する。
// localStorage に永続化。重複は除去し、最新のものが先頭に来る。

export type ColorHistoryDisplay = "grid" | "list" | "compact";

export interface ColorHistoryConfig {
  enabled: boolean;
  display: ColorHistoryDisplay;
  maxCount: number;
}

export const DEFAULT_COLOR_HISTORY_CONFIG: ColorHistoryConfig = {
  enabled: true,
  display: "grid",
  maxCount: 24,
};

const COLORS_STORAGE = "ai-paint-color-history";
const CONFIG_STORAGE = "ai-paint-color-history-config";

function normalizeColor(c: string): string {
  return c.trim().toLowerCase();
}

export function loadColorHistory(): string[] {
  try {
    const raw = localStorage.getItem(COLORS_STORAGE);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

export function saveColorHistory(colors: string[]): void {
  try {
    localStorage.setItem(COLORS_STORAGE, JSON.stringify(colors));
  } catch {
    // localStorage が使えない環境では履歴保存だけ諦める。
  }
}

export function pushColor(
  history: string[],
  color: string,
  maxCount: number
): string[] {
  const norm = normalizeColor(color);
  if (!norm) return history;
  const filtered = history.filter((c) => normalizeColor(c) !== norm);
  const next = [norm, ...filtered];
  if (next.length > maxCount) next.length = maxCount;
  return next;
}

export function loadColorHistoryConfig(): ColorHistoryConfig {
  try {
    const raw = localStorage.getItem(CONFIG_STORAGE);
    if (!raw) return { ...DEFAULT_COLOR_HISTORY_CONFIG };
    return normalizeColorHistoryConfig(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_COLOR_HISTORY_CONFIG };
  }
}

export function normalizeColorHistoryConfig(value: unknown): ColorHistoryConfig {
  const parsed =
    typeof value === "object" && value !== null
      ? (value as Partial<ColorHistoryConfig>)
      : {};
  const out: ColorHistoryConfig = { ...DEFAULT_COLOR_HISTORY_CONFIG };
  if (typeof parsed.enabled === "boolean") out.enabled = parsed.enabled;
  if (
    parsed.display === "grid" ||
    parsed.display === "list" ||
    parsed.display === "compact"
  ) {
    out.display = parsed.display;
  }
  if (typeof parsed.maxCount === "number" && parsed.maxCount > 0) {
    out.maxCount = Math.min(256, Math.max(1, Math.floor(parsed.maxCount)));
  }
  return out;
}

export function saveColorHistoryConfig(config: ColorHistoryConfig): void {
  try {
    localStorage.setItem(CONFIG_STORAGE, JSON.stringify(config));
  } catch {
    // localStorage が使えない環境では設定保存だけ諦める。
  }
}
