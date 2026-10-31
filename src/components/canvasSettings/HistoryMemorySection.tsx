import {
  DEFAULT_HISTORY_MEMORY_BUDGET,
  MAX_HISTORY_MEMORY_BUDGET,
} from "../../core/historyMemory";

interface HistoryMemoryPreset {
  label: string;
  bytes: number;
}

const HISTORY_MEMORY_PRESETS: HistoryMemoryPreset[] = [
  { label: "256 MB", bytes: DEFAULT_HISTORY_MEMORY_BUDGET },
  { label: "1 GB", bytes: 1024 * 1024 * 1024 },
  { label: "4 GB", bytes: 4 * 1024 * 1024 * 1024 },
  { label: "8 GB", bytes: MAX_HISTORY_MEMORY_BUDGET },
];

interface Props {
  historyMemoryBudget: number;
  onChangeHistoryMemoryBudget: (bytes: number) => void;
}

export function HistoryMemorySection({
  historyMemoryBudget,
  onChangeHistoryMemoryBudget,
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
        元に戻すメモリ
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <label style={{ fontSize: 11, color: "var(--text-dim)", minWidth: 36 }}>
          上限
        </label>
        <select
          className="select"
          value={String(historyMemoryBudget)}
          onChange={(e) => onChangeHistoryMemoryBudget(Number(e.target.value))}
        >
          {HISTORY_MEMORY_PRESETS.every(
            (p) => p.bytes !== historyMemoryBudget
          ) && (
            <option value={String(historyMemoryBudget)}>
              {(historyMemoryBudget / (1024 * 1024)).toFixed(0)} MB（現在）
            </option>
          )}
          {HISTORY_MEMORY_PRESETS.map((p) => (
            <option key={p.bytes} value={String(p.bytes)}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      <div
        style={{
          fontSize: 10,
          color: "var(--text-faint)",
          marginTop: 4,
        }}
      >
        全タブの元に戻す履歴が使うメモリの合計上限。「適用」を押すと変更され、上限を超える古い履歴は破棄されます。大きくするほど多くの操作を遡れますが、メモリ消費も増えます。
      </div>
    </div>
  );
}
