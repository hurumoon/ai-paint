import {
  buildSaveBlob,
  formatBytes,
  type SaveFormat,
} from "../../core/fileFormats";
import { createSavedProjectMetadataPatch } from "../../core/saveVersionGuard";
import type { Tab, TabStore } from "../useTabs";

export interface SaveWriteResult {
  fileName: string;
  path: string | undefined;
}

export type SaveWriter = (blob: Blob) => Promise<SaveWriteResult | null>;

export interface SaveTabDocumentResult {
  fileName: string;
  sizeLabel: string;
  hasUnsavedChangesAfterSave: boolean;
}

interface SaveTabDocumentOptions {
  targetTab: Tab;
  tabStore: TabStore;
  format: SaveFormat;
  write: SaveWriter;
}

export async function saveTabDocument({
  targetTab,
  tabStore,
  format,
  write,
}: SaveTabDocumentOptions): Promise<SaveTabDocumentResult | null> {
  const targetDoc = targetTab.doc;
  const targetHistory = targetTab.history;
  const historyVersionAtSave = targetHistory.getSnapshot();
  const documentVersionAtSave = targetDoc.getSnapshot();
  const blob = await buildSaveBlob(targetDoc, format);
  const result = await write(blob);
  if (!result) return null;

  const { patch, hasUnsavedChangesAfterSave } = createSavedProjectMetadataPatch({
    fileName: result.fileName,
    path: result.path,
    historyVersionAtSave,
    documentVersionAtSave,
    currentHistoryVersion: targetHistory.getSnapshot(),
    currentDocumentVersion: targetDoc.getSnapshot(),
  });
  tabStore.updateTab(targetTab.id, patch);
  return {
    fileName: result.fileName,
    sizeLabel: formatBytes(blob.size),
    hasUnsavedChangesAfterSave,
  };
}
