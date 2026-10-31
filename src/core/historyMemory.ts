export const DEFAULT_HISTORY_MEMORY_BUDGET = 256 * 1024 * 1024;
export const MIN_HISTORY_MEMORY_BUDGET = 16 * 1024 * 1024;
export const MAX_HISTORY_MEMORY_BUDGET = 8 * 1024 * 1024 * 1024;

export function normalizeHistoryMemoryBudget(
  value: unknown,
  fallback = DEFAULT_HISTORY_MEMORY_BUDGET
): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.round(
    Math.min(
      MAX_HISTORY_MEMORY_BUDGET,
      Math.max(MIN_HISTORY_MEMORY_BUDGET, parsed)
    )
  );
}
