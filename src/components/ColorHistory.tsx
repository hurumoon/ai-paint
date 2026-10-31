import { ColorHistoryDisplay } from "../core/colorHistory";

interface Props {
  colors: string[];
  display: ColorHistoryDisplay;
  currentColor?: string;
  onPick: (c: string) => void;
  onClear?: () => void;
}

export function ColorHistory({
  colors,
  display,
  currentColor,
  onPick,
  onClear,
}: Props) {
  if (colors.length === 0) {
    return (
      <div className="color-history-empty">まだ使用した色がありません</div>
    );
  }

  const normCurrent = currentColor?.trim().toLowerCase();

  if (display === "list") {
    return (
      <div className="color-history">
        <div className="color-history-header">
          <span style={{ fontSize: 10, color: "var(--text-faint)" }}>
            最近使った色 ({colors.length})
          </span>
          {onClear && colors.length > 0 && (
            <button
              className="btn ghost"
              style={{ padding: "1px 6px", fontSize: 10 }}
              onClick={onClear}
              title="履歴をクリア"
            >
              ×
            </button>
          )}
        </div>
        <div className="color-history-list">
          {colors.map((c, i) => (
            <button
              key={`${c}-${i}`}
              className={`color-history-row ${
                normCurrent === c ? "selected" : ""
              }`}
              onClick={() => onPick(c)}
              title={c}
            >
              <span
                className="color-history-chip"
                style={{ background: c }}
              />
              <span className="color-history-label">{c}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // grid / compact: 同じ並びだがチップサイズが違う
  const cls =
    display === "compact" ? "color-history-grid compact" : "color-history-grid";
  return (
    <div className="color-history">
      <div className="color-history-header">
        <span style={{ fontSize: 10, color: "var(--text-faint)" }}>
          最近使った色 ({colors.length})
        </span>
        {onClear && colors.length > 0 && (
          <button
            className="btn ghost"
            style={{ padding: "1px 6px", fontSize: 10 }}
            onClick={onClear}
            title="履歴をクリア"
          >
            ×
          </button>
        )}
      </div>
      <div className={cls}>
        {colors.map((c, i) => (
          <button
            key={`${c}-${i}`}
            className={`color-history-cell ${
              normCurrent === c ? "selected" : ""
            }`}
            style={{ background: c }}
            onClick={() => onPick(c)}
            title={c}
          />
        ))}
      </div>
    </div>
  );
}
