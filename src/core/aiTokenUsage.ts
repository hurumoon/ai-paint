import { safeGetStorageItem, safeSetStorageItem } from "./safeStorage";

export interface AITokenUsage {
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
  requests: number;
}

export interface AITokenUsageDelta {
  input?: number;
  output?: number;
  cacheCreate?: number;
  cacheRead?: number;
}

export const AI_TOKEN_USAGE_EVENT = "ai-paint-token-usage";

const STORAGE_KEY = "ai-paint-token-usage";

const EMPTY_USAGE: AITokenUsage = {
  input: 0,
  output: 0,
  cacheCreate: 0,
  cacheRead: 0,
  requests: 0,
};

function finiteInt(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : 0;
}

export function loadAITokenUsage(): AITokenUsage {
  try {
    const raw = safeGetStorageItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY_USAGE };
    const parsed = JSON.parse(raw) as Partial<AITokenUsage>;
    return {
      input: finiteInt(parsed.input),
      output: finiteInt(parsed.output),
      cacheCreate: finiteInt(parsed.cacheCreate),
      cacheRead: finiteInt(parsed.cacheRead),
      requests: finiteInt(parsed.requests),
    };
  } catch {
    return { ...EMPTY_USAGE };
  }
}

export function recordAITokenUsage(delta: AITokenUsageDelta | undefined): void {
  if (!delta) return;
  const input = finiteInt(delta.input);
  const output = finiteInt(delta.output);
  const cacheCreate = finiteInt(delta.cacheCreate);
  const cacheRead = finiteInt(delta.cacheRead);
  if (input === 0 && output === 0 && cacheCreate === 0 && cacheRead === 0) return;

  const current = loadAITokenUsage();
  const next: AITokenUsage = {
    input: current.input + input,
    output: current.output + output,
    cacheCreate: current.cacheCreate + cacheCreate,
    cacheRead: current.cacheRead + cacheRead,
    requests: current.requests + 1,
  };
  if (safeSetStorageItem(STORAGE_KEY, JSON.stringify(next))) {
    window.dispatchEvent(new Event(AI_TOKEN_USAGE_EVENT));
  }
}

export function totalAITokens(usage: AITokenUsage): number {
  return usage.input + usage.output + usage.cacheCreate + usage.cacheRead;
}
