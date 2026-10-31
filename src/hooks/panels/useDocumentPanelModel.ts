import { useMemo } from "react";
import type { AppPanelsDocumentState } from "../../components/panels/types";
import type { AppActionControllers } from "../useAppActionControllers";
import type { ActiveTabDocumentState } from "../useActiveTabDocument";

interface UseDocumentPanelModelParams {
  activeDocument: ActiveTabDocumentState;
  textLayerActions: AppActionControllers["textLayerActions"];
}

export function useDocumentPanelModel({
  activeDocument,
  textLayerActions,
}: UseDocumentPanelModelParams): AppPanelsDocumentState {
  const { doc, history, timelapse } = activeDocument;
  const {
    editingTextLayer,
    handleTextChange,
    handleTextDelete,
  } = textLayerActions;

  return useMemo<AppPanelsDocumentState>(
    () => ({
      doc,
      history,
      timelapse,
      editingTextLayer,
      onTextChange: handleTextChange,
      onTextDelete: handleTextDelete,
    }),
    [
      doc,
      editingTextLayer,
      handleTextChange,
      handleTextDelete,
      history,
      timelapse,
    ]
  );
}
