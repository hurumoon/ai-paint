import { useMemo } from "react";
import type { AppChromeToolOptionsModel } from "../../components/AppChrome";
import { TOOL_LABEL } from "../../core/toolLabels";
import type { UseAppChromeModelParams } from "./types";

export function useAppToolOptionsModel({
  tool: toolInputs,
}: UseAppChromeModelParams): AppChromeToolOptionsModel {
  const { toolState, toolOptionsProps } = toolInputs;
  const {
    tool,
    toolOptionsOpen,
    setToolOptionsOpen,
  } = toolState;

  return useMemo<AppChromeToolOptionsModel>(
    () => ({
      toolOptionsOpen,
      toolOptionsTitle: TOOL_LABEL[tool],
      toolOptionsProps,
      onCloseToolOptions: () => setToolOptionsOpen(false),
    }),
    [setToolOptionsOpen, tool, toolOptionsOpen, toolOptionsProps]
  );
}
