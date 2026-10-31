import { invoke } from "@tauri-apps/api/core";

export type ClaudeTaskKey = "canvasAnalysis" | "chat" | "challengeScoring";

export interface ClaudeModelConfig {
  model: string;
  maxTokens: number;
}

export type ClaudeModelSettings = Record<ClaudeTaskKey, ClaudeModelConfig>;

export const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-5";
export const DEFAULT_CLAUDE_MAX_TOKENS = 2048;
export const MAX_CLAUDE_MAX_TOKENS = 64000;

export const DEFAULT_CLAUDE_MODEL_SETTINGS: ClaudeModelSettings = {
  canvasAnalysis: {
    model: DEFAULT_CLAUDE_MODEL,
    maxTokens: DEFAULT_CLAUDE_MAX_TOKENS,
  },
  chat: {
    model: DEFAULT_CLAUDE_MODEL,
    maxTokens: DEFAULT_CLAUDE_MAX_TOKENS,
  },
  challengeScoring: {
    model: DEFAULT_CLAUDE_MODEL,
    maxTokens: DEFAULT_CLAUDE_MAX_TOKENS,
  },
};

const CLAUDE_TASK_KEYS: ClaudeTaskKey[] = [
  "canvasAnalysis",
  "chat",
  "challengeScoring",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeClaudeModelConfig(
  value: unknown,
  fallback: ClaudeModelConfig
): ClaudeModelConfig {
  if (!isRecord(value)) return { ...fallback };
  const model =
    typeof value.model === "string" && value.model.trim()
      ? value.model.trim()
      : fallback.model;
  const maxTokens =
    typeof value.maxTokens === "number" ? value.maxTokens : Number(value.maxTokens);
  return {
    model,
    maxTokens: Number.isFinite(maxTokens)
      ? Math.min(MAX_CLAUDE_MAX_TOKENS, Math.max(1, Math.round(maxTokens)))
      : fallback.maxTokens,
  };
}

export function normalizeClaudeModelSettings(value: unknown): ClaudeModelSettings {
  const input = isRecord(value) ? value : {};
  const next = { ...DEFAULT_CLAUDE_MODEL_SETTINGS };
  for (const key of CLAUDE_TASK_KEYS) {
    next[key] = normalizeClaudeModelConfig(input[key], DEFAULT_CLAUDE_MODEL_SETTINGS[key]);
  }
  return next;
}

export async function getClaudeModelSettings(): Promise<ClaudeModelSettings> {
  return await invoke<ClaudeModelSettings>("get_claude_model_settings");
}

export async function setClaudeModelSettings(
  settings: ClaudeModelSettings
): Promise<ClaudeModelSettings> {
  return await invoke<ClaudeModelSettings>("set_claude_model_settings", {
    settings,
  });
}

export async function resetClaudeModelSettings(): Promise<ClaudeModelSettings> {
  return await invoke<ClaudeModelSettings>("reset_claude_model_settings");
}
