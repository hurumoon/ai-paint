import { useSyncExternalStore } from "react";
import type { History } from "../core/History";
import type { PaintDocument } from "../core/PaintDocument";
import type { Timelapse } from "../core/Timelapse";
import type { Tab } from "./useTabs";

const noopSubscribe = (_cb: () => void): (() => void) => () => {};
const zeroSnapshot = (): number => 0;

export interface ActiveTabDocumentState {
  doc: PaintDocument | null;
  history: History | null;
  timelapse: Timelapse | null;
  version: number;
  historyVersion: number;
  currentFileName: string | null;
  currentFilePath: string | null;
  lastSavedVersion: number;
  isDirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  dimensions: string;
}

export function useActiveTabDocument(activeTab: Tab | null): ActiveTabDocumentState {
  const doc = activeTab?.doc ?? null;
  const history = activeTab?.history ?? null;
  const timelapse = activeTab?.timelapse ?? null;

  const version = useSyncExternalStore(
    doc?.subscribe ?? noopSubscribe,
    doc?.getSnapshot ?? zeroSnapshot
  );
  const historyVersion = useSyncExternalStore(
    history?.subscribe ?? noopSubscribe,
    history?.getSnapshot ?? zeroSnapshot
  );

  const currentFileName = activeTab?.fileName ?? null;
  const currentFilePath = activeTab?.filePath ?? null;
  const lastSavedVersion = activeTab?.lastSavedVersion ?? 0;
  const lastSavedDocumentVersion = activeTab?.lastSavedDocumentVersion ?? 0;
  const isDirty =
    activeTab !== null &&
    (historyVersion !== lastSavedVersion ||
      version !== lastSavedDocumentVersion);

  const dimensions = doc ? `${doc.width}×${doc.height} @ ${doc.dpi}dpi` : "—";

  return {
    doc,
    history,
    timelapse,
    version,
    historyVersion,
    currentFileName,
    currentFilePath,
    lastSavedVersion,
    isDirty,
    canUndo: Boolean(history?.canUndo()),
    canRedo: Boolean(history?.canRedo()),
    dimensions,
  };
}
