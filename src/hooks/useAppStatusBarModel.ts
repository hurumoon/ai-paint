import { useCallback, useMemo } from "react";
import type { AppStatusBarProps } from "../components/AppStatusBar";
import { TOOL_LABEL } from "../core/toolLabels";
import type { ActiveTabDocumentState } from "./useActiveTabDocument";
import type { AppCanvasViewState } from "./useCanvasViewState";
import type { ToolState } from "./useToolState";

interface UseAppStatusBarModelParams {
  activeDocument: ActiveTabDocumentState;
  viewState: AppCanvasViewState;
  toolState: ToolState;
}

export function useAppStatusBarModel({
  activeDocument,
  viewState,
  toolState,
}: UseAppStatusBarModelParams): AppStatusBarProps {
  const { dimensions } = activeDocument;
  const { zoom, selection, setSelection } = viewState;
  const { tool } = toolState;

  const handleClearSelection = useCallback(() => {
    setSelection({ kind: "none" });
  }, [setSelection]);

  return useMemo<AppStatusBarProps>(
    () => ({
      dimensions,
      zoom,
      toolLabel: TOOL_LABEL[tool],
      selection,
      onClearSelection: handleClearSelection,
    }),
    [dimensions, handleClearSelection, selection, tool, zoom]
  );
}
