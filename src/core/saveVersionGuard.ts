export interface SavedProjectMetadataPatch {
  fileName: string;
  filePath: string | null;
  lastSavedVersion?: number;
  lastSavedDocumentVersion?: number;
}

export interface SavedProjectMetadataPatchResult {
  patch: SavedProjectMetadataPatch;
  hasUnsavedChangesAfterSave: boolean;
}

export function createSavedProjectMetadataPatch({
  fileName,
  path,
  historyVersionAtSave,
  documentVersionAtSave,
  currentHistoryVersion,
  currentDocumentVersion,
}: {
  fileName: string;
  path: string | undefined;
  historyVersionAtSave: number;
  documentVersionAtSave: number;
  currentHistoryVersion: number;
  currentDocumentVersion: number;
}): SavedProjectMetadataPatchResult {
  const hasUnsavedChangesAfterSave =
    currentHistoryVersion !== historyVersionAtSave ||
    currentDocumentVersion !== documentVersionAtSave;
  const patch: SavedProjectMetadataPatch = {
    fileName,
    filePath: path ?? null,
  };
  if (!hasUnsavedChangesAfterSave) {
    patch.lastSavedVersion = historyVersionAtSave;
    patch.lastSavedDocumentVersion = documentVersionAtSave;
  }
  return { patch, hasUnsavedChangesAfterSave };
}
