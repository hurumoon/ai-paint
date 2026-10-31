import type { Selection } from "../types";

export interface AppStatusBarProps {
  dimensions: string;
  zoom: number;
  toolLabel: string;
  selection: Selection;
  onClearSelection: () => void;
  editingDisabled?: boolean;
}

function selectionLabel(selection: Selection): string {
  if (selection.kind === "rect") {
    return `選択 ${Math.round(selection.w)}×${Math.round(selection.h)}`;
  }
  if (selection.kind === "polygon") {
    return `多角形選択 ${selection.points.length}頂点`;
  }
  if (selection.kind === "mask") {
    return `自動選択 ${Math.round(selection.w)}×${Math.round(selection.h)}`;
  }
  return "選択なし";
}

export function AppStatusBar({
  dimensions,
  zoom,
  toolLabel,
  selection,
  onClearSelection,
  editingDisabled,
}: AppStatusBarProps) {
  return (
    <div className="statusbar">
      <div className="statusbar-left">
        <span>{dimensions}</span>
        <span>ズーム {Math.round(zoom * 100)}%</span>
        <span>{toolLabel}</span>
      </div>
      <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
        {selectionLabel(selection)}
        {selection.kind !== "none" && (
          <button
            className="btn ghost"
            style={{ padding: "2px 8px", fontSize: 10 }}
            onClick={onClearSelection}
            disabled={editingDisabled}
            title="選択範囲を解除 (Esc)"
          >
            解除
          </button>
        )}
      </span>
    </div>
  );
}
