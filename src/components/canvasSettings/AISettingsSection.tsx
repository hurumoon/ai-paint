import { useEffect, useState } from "react";
import {
  AI_TOKEN_USAGE_EVENT,
  AITokenUsage,
  loadAITokenUsage,
  totalAITokens,
} from "../../core/aiTokenUsage";
import { AIGuideDisplayMode } from "../../types";
import { Button } from "../../ui/primitives";
import { AIApiKeySettings } from "./AIApiKeySettings";
import { AIModelSettingsSection } from "./AIModelSettingsSection";

interface Props {
  open: boolean;
  enhancedAIEnabled: boolean;
  setEnhancedAIEnabled: (enabled: boolean) => void;
  aiGuideDisplayMode: AIGuideDisplayMode;
  setAIGuideDisplayMode: (mode: AIGuideDisplayMode) => void;
  hasApiKey: boolean;
  setApiKey: (key: string) => void;
  clearApiKey: () => void;
  onOpenChallengeList: () => void;
}

const TOKEN_ESTIMATES = [
  { mode: "総合", off: "1.5k〜2.8k", on: "5.0k〜8.5k" },
  { mode: "ポーズ", off: "1.6k〜3.0k", on: "5.2k〜9.0k" },
  { mode: "構図", off: "1.6k〜3.0k", on: "5.2k〜9.0k" },
  { mode: "解剖学", off: "1.8k〜3.2k", on: "5.5k〜9.5k" },
  { mode: "配色", off: "1.6k〜3.0k", on: "5.2k〜9.0k" },
  { mode: "線整理", off: "1.6k〜3.0k", on: "5.2k〜9.0k" },
  { mode: "パレット", off: "1.2k〜2.2k", on: "4.5k〜7.5k" },
  { mode: "前回比較", off: "2.5k〜4.5k", on: "2.5k〜4.5k" },
  { mode: "課題採点", off: "使用不可", on: "1.5k〜3.2k" },
];

const numberFormat = new Intl.NumberFormat("ja-JP");

function formatTokens(value: number): string {
  return `${numberFormat.format(value)} tokens`;
}

function TokenUsageView({ usage }: { usage: AITokenUsage }) {
  const total = totalAITokens(usage);
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 6,
        fontSize: 11,
        color: "var(--text-dim)",
      }}
    >
      <span>合計</span>
      <strong style={{ color: "var(--text)" }}>{formatTokens(total)}</strong>
      <span>入力</span>
      <span>{formatTokens(usage.input)}</span>
      <span>出力</span>
      <span>{formatTokens(usage.output)}</span>
      <span>キャッシュ</span>
      <span>{formatTokens(usage.cacheCreate + usage.cacheRead)}</span>
      <span>API回数</span>
      <span>{numberFormat.format(usage.requests)} 回</span>
    </div>
  );
}

export function AISettingsSection({
  open,
  enhancedAIEnabled,
  setEnhancedAIEnabled,
  aiGuideDisplayMode,
  setAIGuideDisplayMode,
  hasApiKey,
  setApiKey,
  clearApiKey,
  onOpenChallengeList,
}: Props) {
  const [tokenUsage, setTokenUsage] = useState(() => loadAITokenUsage());

  useEffect(() => {
    if (!open) return;
    setTokenUsage(loadAITokenUsage());
    const update = () => setTokenUsage(loadAITokenUsage());
    window.addEventListener(AI_TOKEN_USAGE_EVENT, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(AI_TOKEN_USAGE_EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, [open]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <strong style={{ fontSize: 12 }}>AI</strong>
      <AIApiKeySettings
        hasApiKey={hasApiKey}
        setApiKey={setApiKey}
        clearApiKey={clearApiKey}
      />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          fontSize: 12,
          color: "var(--text-dim)",
        }}
      >
        <span>AI指摘の表示</span>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            className={`btn ${aiGuideDisplayMode === "guides" ? "primary" : ""}`}
            onClick={() => setAIGuideDisplayMode("guides")}
          >
            補助線
          </button>
          <button
            className={`btn ${aiGuideDisplayMode === "pins" ? "primary" : ""}`}
            onClick={() => setAIGuideDisplayMode("pins")}
          >
            ピン
          </button>
        </div>
        <span style={{ fontSize: 11, lineHeight: 1.5 }}>
          ピンは正確な範囲指定ではなく、その周辺への指摘として表示します。
        </span>
      </div>
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 12,
          color: "var(--text-dim)",
        }}
      >
        <input
          type="checkbox"
          checked={enhancedAIEnabled}
          onChange={(e) => setEnhancedAIEnabled(e.target.checked)}
        />
        AI強化モード
      </label>
      <div
        style={{
          fontSize: 11,
          lineHeight: 1.55,
          color: "var(--text-dim)",
        }}
      >
        ONにすると、AI解析時にキャンバスを4分割した部分画像、AIが気にした箇所の拡大画像、
        周辺カラーコード、レイヤー構成を追加で渡します。通常より細かく見ますが、
        送信画像とAPI回数が増えるためトークン使用量も増えます。
      </div>
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: 6,
          overflow: "hidden",
          fontSize: 11,
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            background: "var(--panel-2)",
            color: "var(--text-dim)",
            fontWeight: 700,
          }}
        >
          <span style={{ padding: "5px 6px" }}>モード</span>
          <span style={{ padding: "5px 6px" }}>OFF目安</span>
          <span style={{ padding: "5px 6px" }}>ON目安</span>
        </div>
        {TOKEN_ESTIMATES.map((row) => (
          <div
            key={row.mode}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              borderTop: "1px solid var(--border)",
              color: "var(--text-dim)",
            }}
          >
            <span style={{ padding: "4px 6px", color: "var(--text)" }}>
              {row.mode}
            </span>
            <span style={{ padding: "4px 6px" }}>{row.off}</span>
            <span style={{ padding: "4px 6px" }}>{row.on}</span>
          </div>
        ))}
      </div>
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: 8,
        }}
      >
        <div
          style={{
            fontSize: 11,
            color: "var(--text-faint)",
            marginBottom: 6,
          }}
        >
          これまで使用したトークン数（記録開始後）
        </div>
        <TokenUsageView usage={tokenUsage} />
      </div>
      <AIModelSettingsSection open={open} />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          fontSize: 12,
          color: "var(--text-dim)",
        }}
      >
        <span>課題一覧</span>
        <Button onClick={onOpenChallengeList}>管理</Button>
      </div>
    </div>
  );
}
