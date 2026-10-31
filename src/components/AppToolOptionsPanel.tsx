import { lazy } from "react";
import type { ToolOptionsProps } from "./ToolOptions";

const ToolOptions = lazy(() =>
  import("./ToolOptions").then((module) => ({ default: module.ToolOptions }))
);

interface AppToolOptionsPanelProps {
  title: string;
  toolOptionsProps: ToolOptionsProps;
  onClose: () => void;
}

export function AppToolOptionsPanel({
  title,
  toolOptionsProps,
  onClose,
}: AppToolOptionsPanelProps) {
  return (
    <div className="tool-options-panel">
      <div className="tool-options-header">
        <div className="tool-options-title">{title}</div>
        <button
          className="btn ghost"
          style={{ padding: "2px 8px", fontSize: 11 }}
          onClick={onClose}
          title="ツールオプションを閉じる"
        >
          ×
        </button>
      </div>
      <ToolOptions {...toolOptionsProps} />
    </div>
  );
}
