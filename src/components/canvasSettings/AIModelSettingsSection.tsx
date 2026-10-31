import { Fragment, useEffect, useState } from "react";
import {
  ClaudeModelSettings,
  ClaudeTaskKey,
  DEFAULT_CLAUDE_MODEL_SETTINGS,
  MAX_CLAUDE_MAX_TOKENS,
  getClaudeModelSettings,
  resetClaudeModelSettings,
  setClaudeModelSettings,
} from "../../core/aiModelSettings";
import { Button, pushToast } from "../../ui/primitives";

interface Props {
  open: boolean;
}

const TASK_ROWS: { key: ClaudeTaskKey; label: string }[] = [
  { key: "canvasAnalysis", label: "キャンバス解析" },
  { key: "chat", label: "チャット" },
  { key: "challengeScoring", label: "課題採点" },
];

function cloneSettings(settings: ClaudeModelSettings): ClaudeModelSettings {
  return {
    canvasAnalysis: { ...settings.canvasAnalysis },
    chat: { ...settings.chat },
    challengeScoring: { ...settings.challengeScoring },
  };
}

function inputMaxTokens(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.round(parsed));
}

export function AIModelSettingsSection({ open }: Props) {
  const [settings, setSettings] = useState<ClaudeModelSettings>(() =>
    cloneSettings(DEFAULT_CLAUDE_MODEL_SETTINGS)
  );
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    getClaudeModelSettings()
      .then((loaded) => {
        if (!cancelled) setSettings(loaded);
      })
      .catch((e) => {
        if (!cancelled) {
          pushToast(
            `AIモデル設定の読み込み失敗: ${e instanceof Error ? e.message : String(e)}`,
            "error"
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const updateTask = (
    key: ClaudeTaskKey,
    patch: Partial<ClaudeModelSettings[ClaudeTaskKey]>
  ) => {
    setSettings((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        ...patch,
      },
    }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const saved = await setClaudeModelSettings(settings);
      setSettings(saved);
      pushToast("AIモデル設定を保存しました", "success");
    } catch (e) {
      pushToast(
        `AIモデル設定の保存失敗: ${e instanceof Error ? e.message : String(e)}`,
        "error"
      );
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    setSaving(true);
    try {
      const saved = await resetClaudeModelSettings();
      setSettings(saved);
      pushToast("AIモデル設定を初期値に戻しました", "success");
    } catch (e) {
      pushToast(
        `AIモデル設定の初期化失敗: ${e instanceof Error ? e.message : String(e)}`,
        "error"
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 6,
        padding: 8,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
        }}
      >
        <strong style={{ fontSize: 12, color: "var(--text)" }}>AIモデル</strong>
        <div style={{ display: "flex", gap: 6 }}>
          <Button onClick={reset} disabled={loading || saving}>初期値</Button>
          <Button variant="primary" onClick={save} disabled={loading || saving}>
            {saving ? "保存中..." : "保存"}
          </Button>
        </div>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(82px, 0.8fr) minmax(150px, 1.6fr) minmax(92px, 0.8fr)",
          gap: 6,
          alignItems: "center",
          fontSize: 11,
          color: "var(--text-dim)",
        }}
      >
        <span>用途</span>
        <span>モデル</span>
        <span>max_tokens</span>
        {TASK_ROWS.map((task) => (
          <Fragment key={task.key}>
            <span key={`${task.key}-label`} style={{ color: "var(--text)" }}>
              {task.label}
            </span>
            <input
              key={`${task.key}-model`}
              className="input"
              value={settings[task.key].model}
              disabled={loading || saving}
              onChange={(e) => updateTask(task.key, { model: e.target.value })}
            />
            <input
              key={`${task.key}-tokens`}
              className="input"
              type="number"
              min={1}
              max={MAX_CLAUDE_MAX_TOKENS}
              step={1}
              value={settings[task.key].maxTokens}
              disabled={loading || saving}
              onChange={(e) =>
                updateTask(task.key, {
                  maxTokens: inputMaxTokens(e.target.value),
                })
              }
            />
          </Fragment>
        ))}
      </div>
    </div>
  );
}
