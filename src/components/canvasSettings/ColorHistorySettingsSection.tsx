import { ColorHistoryConfig } from "../../core/colorHistory";

interface Props {
  colorHistoryConfig: ColorHistoryConfig;
  onChangeColorHistoryConfig: (c: ColorHistoryConfig) => void;
  onClearColorHistory: () => void;
}

export function ColorHistorySettingsSection({
  colorHistoryConfig,
  onChangeColorHistoryConfig,
  onClearColorHistory,
}: Props) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600 }}>
        カラー履歴
      </div>
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 12,
          color: "var(--text-dim)",
        }}
      >
        <input
          type="checkbox"
          checked={colorHistoryConfig.enabled}
          onChange={(e) =>
            onChangeColorHistoryConfig({
              ...colorHistoryConfig,
              enabled: e.target.checked,
            })
          }
        />
        ツールオプションに表示する
      </label>
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          opacity: colorHistoryConfig.enabled ? 1 : 0.5,
        }}
      >
        <label style={{ fontSize: 11, color: "var(--text-dim)", minWidth: 60 }}>
          表示方式
        </label>
        <div className="tabs" style={{ flex: 1 }}>
          <button
            className={`tab ${
              colorHistoryConfig.display === "grid" ? "active" : ""
            }`}
            onClick={() =>
              onChangeColorHistoryConfig({
                ...colorHistoryConfig,
                display: "grid",
              })
            }
            disabled={!colorHistoryConfig.enabled}
          >
            グリッド
          </button>
          <button
            className={`tab ${
              colorHistoryConfig.display === "compact" ? "active" : ""
            }`}
            onClick={() =>
              onChangeColorHistoryConfig({
                ...colorHistoryConfig,
                display: "compact",
              })
            }
            disabled={!colorHistoryConfig.enabled}
          >
            コンパクト
          </button>
          <button
            className={`tab ${
              colorHistoryConfig.display === "list" ? "active" : ""
            }`}
            onClick={() =>
              onChangeColorHistoryConfig({
                ...colorHistoryConfig,
                display: "list",
              })
            }
            disabled={!colorHistoryConfig.enabled}
          >
            リスト
          </button>
        </div>
      </div>
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          opacity: colorHistoryConfig.enabled ? 1 : 0.5,
        }}
      >
        <label style={{ fontSize: 11, color: "var(--text-dim)", minWidth: 60 }}>
          最大件数
        </label>
        <input
          type="number"
          className="input"
          min={1}
          max={256}
          value={colorHistoryConfig.maxCount}
          disabled={!colorHistoryConfig.enabled}
          onChange={(e) => {
            const n = Math.max(
              1,
              Math.min(256, Math.floor(Number(e.target.value) || 1))
            );
            onChangeColorHistoryConfig({
              ...colorHistoryConfig,
              maxCount: n,
            });
          }}
          style={{ maxWidth: 100 }}
        />
        <button
          className="btn ghost"
          style={{ padding: "2px 10px", fontSize: 11 }}
          onClick={onClearColorHistory}
          title="保存された色履歴を削除"
        >
          履歴をクリア
        </button>
      </div>
      <div
        style={{
          fontSize: 10,
          color: "var(--text-faint)",
        }}
      >
        ブラシ等で使った色を新しい順に記録し、ツールオプションから再選択できます。
      </div>
    </div>
  );
}
