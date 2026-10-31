import { TextEditor } from "../TextEditor";
import type { AppPanelsDocumentState } from "./types";

interface TextPanelSectionProps {
  documentState: AppPanelsDocumentState;
}

export function TextPanelSection({ documentState }: TextPanelSectionProps) {
  const { doc, editingTextLayer } = documentState;
  if (!doc || !editingTextLayer?.meta.text || editingTextLayer.meta.locked) {
    return null;
  }

  return (
    <TextEditor
      text={editingTextLayer.meta.text}
      canvasWidth={doc.width}
      canvasHeight={doc.height}
      onChange={documentState.onTextChange}
      onDelete={documentState.onTextDelete}
    />
  );
}
