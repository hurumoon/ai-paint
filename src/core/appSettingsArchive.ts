import type { ColorHistoryConfig } from "./colorHistory";
import {
  normalizeColorHistoryConfig,
} from "./colorHistory";
import type { ClaudeModelSettings } from "./aiModelSettings";
import { normalizeClaudeModelSettings } from "./aiModelSettings";
import type { LayoutConfig } from "./panelLayout";
import { normalizeLayout } from "./panelLayout";
import {
  DEFAULT_SHORTCUTS,
  SHORTCUT_ACTIONS,
} from "./shortcuts";
import type {
  AIGuideDisplayMode,
  ChallengeItem,
  ShortcutMap,
} from "../types";
import { normalizeChallengeItems } from "./challenges";
import { normalizeHistoryMemoryBudget } from "./historyMemory";
import { normalizeAutoBackupIntervalSec } from "./autoBackup";

export const APP_SETTINGS_ARCHIVE_FORMAT = "ai-paint-settings";
export const APP_SETTINGS_ARCHIVE_VERSION = 1;

const DEFAULT_GRID: AppSettingsGridConfig = {
  show: false,
  spacing: 64,
  color: "#7c8cff",
  divisions: 2,
};

export interface AppSettingsGridConfig {
  show: boolean;
  spacing: number;
  color: string;
  divisions: number;
}

export interface AppSettingsSnapshot {
  shortcuts: ShortcutMap;
  layout: LayoutConfig;
  grid: AppSettingsGridConfig;
  ai: {
    enhancedAIEnabled: boolean;
    aiGuideDisplayMode: AIGuideDisplayMode;
  };
  claudeModelSettings?: ClaudeModelSettings;
  challengeItems: ChallengeItem[];
  colorHistoryConfig: ColorHistoryConfig;
  historyMemoryBudget: number;
  backup: {
    enabled: boolean;
    intervalSec: number;
  };
}

export interface AppSettingsArchiveV1 {
  format: typeof APP_SETTINGS_ARCHIVE_FORMAT;
  version: typeof APP_SETTINGS_ARCHIVE_VERSION;
  settings: AppSettingsSnapshot;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeShortcuts(value: unknown): ShortcutMap {
  const input = isRecord(value) ? value : {};
  const next: ShortcutMap = {};
  for (const action of SHORTCUT_ACTIONS) {
    const combo = input[action.id];
    next[action.id] =
      typeof combo === "string" ? combo : DEFAULT_SHORTCUTS[action.id] ?? "";
  }
  return next;
}

function normalizeGrid(value: unknown): AppSettingsGridConfig {
  const input = isRecord(value) ? value : {};
  const color = typeof input.color === "string" ? input.color : DEFAULT_GRID.color;
  return {
    show: typeof input.show === "boolean" ? input.show : DEFAULT_GRID.show,
    spacing: Math.round(clampNumber(input.spacing, DEFAULT_GRID.spacing, 4, 512)),
    color: /^#[0-9a-f]{6}$/i.test(color) ? color : DEFAULT_GRID.color,
    divisions: Math.round(clampNumber(input.divisions, DEFAULT_GRID.divisions, 0, 10)),
  };
}

function normalizeAiSettings(value: unknown): AppSettingsSnapshot["ai"] {
  const input = isRecord(value) ? value : {};
  return {
    enhancedAIEnabled:
      typeof input.enhancedAIEnabled === "boolean"
        ? input.enhancedAIEnabled
        : false,
    aiGuideDisplayMode: input.aiGuideDisplayMode === "pins" ? "pins" : "guides",
  };
}

function normalizeBackup(value: unknown): AppSettingsSnapshot["backup"] {
  const input = isRecord(value) ? value : {};
  return {
    enabled: typeof input.enabled === "boolean" ? input.enabled : true,
    intervalSec: normalizeAutoBackupIntervalSec(input.intervalSec),
  };
}

export function normalizeAppSettingsSnapshot(value: unknown): AppSettingsSnapshot {
  const input = isRecord(value) ? value : {};
  return {
    shortcuts: normalizeShortcuts(input.shortcuts),
    layout: normalizeLayout(input.layout),
    grid: normalizeGrid(input.grid),
    ai: normalizeAiSettings(input.ai),
    claudeModelSettings:
      input.claudeModelSettings === undefined
        ? undefined
        : normalizeClaudeModelSettings(input.claudeModelSettings),
    challengeItems: normalizeChallengeItems(input.challengeItems),
    colorHistoryConfig: normalizeColorHistoryConfig(input.colorHistoryConfig),
    historyMemoryBudget: normalizeHistoryMemoryBudget(
      input.historyMemoryBudget
    ),
    backup: normalizeBackup(input.backup),
  };
}

export function createAppSettingsArchive(
  snapshot: AppSettingsSnapshot
): AppSettingsArchiveV1 {
  return {
    format: APP_SETTINGS_ARCHIVE_FORMAT,
    version: APP_SETTINGS_ARCHIVE_VERSION,
    settings: normalizeAppSettingsSnapshot(snapshot),
  };
}

export function stringifyAppSettingsArchive(snapshot: AppSettingsSnapshot): string {
  return `${JSON.stringify(createAppSettingsArchive(snapshot), null, 2)}\n`;
}

export function parseAppSettingsArchive(text: string): AppSettingsSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("設定 JSON を読み込めませんでした");
  }

  if (!isRecord(parsed)) {
    throw new Error("設定 JSON の形式が不正です");
  }
  if (parsed.format !== APP_SETTINGS_ARCHIVE_FORMAT) {
    throw new Error("ai-paint の設定 JSON ではありません");
  }
  if (parsed.version !== APP_SETTINGS_ARCHIVE_VERSION) {
    throw new Error("対応していない設定 JSON バージョンです");
  }
  return normalizeAppSettingsSnapshot(parsed.settings);
}
