import { describe, expect, it } from "vitest";
import {
  parseAppSettingsArchive,
  stringifyAppSettingsArchive,
  type AppSettingsSnapshot,
} from "../../src/core/appSettingsArchive";
import { DEFAULT_LAYOUT } from "../../src/core/panelLayout";

function settingsSnapshot(): AppSettingsSnapshot {
  return {
    shortcuts: {
      "tool.brush": "b",
      "tool.eraser": "e",
      "tool.bucket": "g",
      "tool.eyedropper": "i",
      "tool.select": "m",
      "tool.shape": "u",
      "tool.move": "v",
      "tool.layerPick": "",
      "tool.text": "t",
      "tool.gradient": "shift+g",
      "tool.blur": "shift+b",
      "file.new": "ctrl+n",
      "file.save": "ctrl+s",
      "file.saveAs": "ctrl+shift+s",
      "file.open": "ctrl+o",
      "edit.undo": "ctrl+z",
      "edit.redo": "ctrl+shift+z",
      "edit.redo2": "ctrl+y",
      "edit.colorAdjust": "ctrl+u",
      "edit.selectAll": "ctrl+a",
      "layer.new": "ctrl+shift+n",
      "tab.close": "ctrl+w",
      "brush.sizeDown": "[",
      "brush.sizeUp": "]",
      "brush.stabilizerDown": "alt+[",
      "brush.stabilizerUp": "alt+]",
      "color.swap": "x",
      "selection.clear": "escape",
      "view.grid": "shift+'",
      "view.reset": "0",
      "view.zoomIn": "ctrl+=",
      "view.zoomOut": "ctrl+-",
      "view.rotateCW": "shift+]",
      "view.rotateCCW": "shift+[",
      "view.flipHorizontal": "shift+h",
      "view.pan": "mousebutton2",
      "system.clearCanvasPool": "",
    },
    layout: {
      ...DEFAULT_LAYOUT,
      flipped: true,
    },
    grid: {
      show: true,
      spacing: 32,
      color: "#112233",
      divisions: 4,
    },
    ai: {
      enhancedAIEnabled: true,
      aiGuideDisplayMode: "pins",
    },
    claudeModelSettings: {
      canvasAnalysis: {
        model: "claude-sonnet-4-5",
        maxTokens: 2048,
      },
      chat: {
        model: "claude-sonnet-4-5",
        maxTokens: 4096,
      },
      challengeScoring: {
        model: "claude-sonnet-4-5",
        maxTokens: 1024,
      },
    },
    challengeItems: [
      {
        id: "challenge-test-1",
        category: "composition",
        prompt: "三角構図で人物を描く",
        enabled: true,
      },
      {
        id: "challenge-test-2",
        category: "color",
        prompt: "低彩度の配色だけで描く",
        enabled: false,
      },
    ],
    colorHistoryConfig: {
      enabled: true,
      display: "compact",
      maxCount: 12,
    },
    historyMemoryBudget: 512 * 1024 * 1024,
    backup: {
      enabled: false,
      intervalSec: 120,
    },
  };
}

describe("app settings archive", () => {
  it("roundtrips exported settings JSON through import and export", () => {
    const firstJson = stringifyAppSettingsArchive(settingsSnapshot());
    const imported = parseAppSettingsArchive(firstJson);
    const secondJson = stringifyAppSettingsArchive(imported);

    expect(JSON.parse(secondJson)).toEqual(JSON.parse(firstJson));
  });

  it("preserves the 8 GiB history memory maximum", () => {
    const snapshot = settingsSnapshot();
    snapshot.historyMemoryBudget = 8 * 1024 * 1024 * 1024;

    const imported = parseAppSettingsArchive(
      stringifyAppSettingsArchive(snapshot)
    );

    expect(imported.historyMemoryBudget).toBe(8 * 1024 * 1024 * 1024);
  });

  it("clamps imported history memory above the maximum to 8 GiB", () => {
    const snapshot = settingsSnapshot();
    snapshot.historyMemoryBudget = 16 * 1024 * 1024 * 1024;

    const imported = parseAppSettingsArchive(
      stringifyAppSettingsArchive(snapshot)
    );

    expect(imported.historyMemoryBudget).toBe(8 * 1024 * 1024 * 1024);
  });

  it("rejects non-settings JSON", () => {
    expect(() => parseAppSettingsArchive('{"format":"other","version":1}')).toThrow(
      "ai-paint の設定 JSON ではありません"
    );
  });
});
