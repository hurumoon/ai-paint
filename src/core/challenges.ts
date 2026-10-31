import { ChallengeCategory, ChallengeItem } from "../types";
import {
  CHALLENGE_CATEGORY_LABEL as CATEGORY_LABEL,
  DEFAULT_CHALLENGE_ITEMS,
} from "./challengeCatalog";
import { safeGetStorageItem, safeSetStorageItem } from "./safeStorage";

const STORAGE_KEY = "ai-paint-challenge-items";

export { CHALLENGE_CATEGORY_LABEL } from "./challengeCatalog";

const CATEGORIES = Object.keys(CATEGORY_LABEL) as ChallengeCategory[];

function isChallengeCategory(value: unknown): value is ChallengeCategory {
  return typeof value === "string" && CATEGORIES.includes(value as ChallengeCategory);
}

function cloneChallengeItems(items: ChallengeItem[]): ChallengeItem[] {
  return items.map((item) => ({ ...item }));
}

export function createChallengeId(): string {
  return `challenge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getDefaultChallengeItems(): ChallengeItem[] {
  return cloneChallengeItems(DEFAULT_CHALLENGE_ITEMS);
}

export function normalizeChallengeItems(input: unknown): ChallengeItem[] {
  if (!Array.isArray(input)) return getDefaultChallengeItems();

  const seen = new Set<string>();
  const items: ChallengeItem[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Partial<ChallengeItem>;
    const prompt = typeof raw.prompt === "string" ? raw.prompt.trim() : "";
    if (!prompt || !isChallengeCategory(raw.category)) continue;
    const id =
      typeof raw.id === "string" && raw.id.trim() && !seen.has(raw.id)
        ? raw.id
        : createChallengeId();
    seen.add(id);
    items.push({
      id,
      category: raw.category,
      prompt,
      enabled: raw.enabled !== false,
    });
  }

  return items.length > 0 ? items : getDefaultChallengeItems();
}

export function loadChallengeItems(): ChallengeItem[] {
  try {
    const raw = safeGetStorageItem(STORAGE_KEY);
    if (!raw) return getDefaultChallengeItems();
    return normalizeChallengeItems(JSON.parse(raw));
  } catch {
    return getDefaultChallengeItems();
  }
}

export function saveChallengeItems(items: ChallengeItem[]): boolean {
  return safeSetStorageItem(
    STORAGE_KEY,
    JSON.stringify(normalizeChallengeItems(items))
  );
}

export function pickChallengeItem(
  items: ChallengeItem[],
  exclude?: ChallengeItem
): ChallengeItem {
  const enabled = normalizeChallengeItems(items).filter((item) => item.enabled);
  const pool = enabled.length > 0 ? enabled : getDefaultChallengeItems();
  if (pool.length <= 1) return pool[0];
  let next = pool[Math.floor(Math.random() * pool.length)];
  while (exclude && next.id === exclude.id) {
    next = pool[Math.floor(Math.random() * pool.length)];
  }
  return next;
}
