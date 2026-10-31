import { loadAiPaint } from "../../core/nativeFormat";
import {
  isSupportedOpenFilePath,
  pickImageFormatFromPath,
} from "../../core/fileFormats";
import { assertRasterImageDimensions } from "../../core/rasterImageLimits";
import { publishPsdLoadTiming } from "../../debug/psdLoadTiming";
import { readImageDpi } from "../../utils/imageDpi";
import type { NativeReadTiming } from "../../types";
import type { Tab, TabStore } from "../useTabs";
import {
  waitForLoadingOverlayPaint,
  waitForNextPaint,
} from "./paintWait";

export interface FileWorkflowNotice {
  text: string;
  kind: "info" | "success" | "error";
}

export class FileWorkflowError extends Error {
  readonly kind = "error" as const;
}

interface FileWorkflowBaseOptions {
  tabStore: TabStore;
  stashAndAddTab: (w?: number, h?: number, dpi?: number) => Tab;
}

interface LoadFileIntoAppOptions extends FileWorkflowBaseOptions {
  activeTab: Tab | null;
  file: File;
  path?: string;
  nativeReadTiming?: NativeReadTiming;
}

interface LoadDirectImageOptions extends FileWorkflowBaseOptions {
  file: File;
  path?: string;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function markTabClean(
  tabStore: TabStore,
  tab: Tab,
  fileName: string,
  path: string | undefined,
): void {
  const cleanHistoryVersion = tab.history.getSnapshot();
  const cleanDocumentVersion = tab.doc.getSnapshot();
  tabStore.updateTab(tab.id, {
    fileName,
    filePath: path ?? null,
    lastSavedVersion: cleanHistoryVersion,
    lastSavedDocumentVersion: cleanDocumentVersion,
    lastBackupVersion: cleanHistoryVersion,
    lastBackupDocumentVersion: cleanDocumentVersion,
  });
}

async function readBitmapSize(file: File): Promise<{
  width: number;
  height: number;
}> {
  const bitmap = await createImageBitmap(file);
  try {
    assertRasterImageDimensions({
      width: bitmap.width,
      height: bitmap.height,
    });
    return {
      width: bitmap.width,
      height: bitmap.height,
    };
  } finally {
    bitmap.close();
  }
}

async function loadAiPaintProject({
  file,
  path,
  tabStore,
  stashAndAddTab,
}: LoadFileIntoAppOptions): Promise<FileWorkflowNotice> {
  const newTab = stashAndAddTab();
  try {
    await waitForLoadingOverlayPaint();
    await loadAiPaint(file, newTab.doc);
    newTab.history.clear();
    markTabClean(tabStore, newTab, file.name, path);
    return { text: `${file.name} を読み込みました`, kind: "success" };
  } catch (e) {
    tabStore.closeTab(newTab.id);
    throw new FileWorkflowError(`.aipaint 読み込み失敗: ${errorMessage(e)}`);
  }
}

async function loadPsdProject({
  file,
  path,
  nativeReadTiming,
  tabStore,
  stashAndAddTab,
}: LoadFileIntoAppOptions): Promise<FileWorkflowNotice> {
  const newTab = stashAndAddTab();
  try {
    await waitForLoadingOverlayPaint();
    const { loadPsd } = await import("../../core/psdFormat");
    const timing = await loadPsd(file, newTab.doc, {
      fileName: file.name,
      nativeReadTiming,
    });
    newTab.history.clear();
    markTabClean(tabStore, newTab, file.name, path);
    const firstPaintStartedAt = performance.now();
    await waitForNextPaint();
    timing.timings.firstPaintWaitMs = performance.now() - firstPaintStartedAt;
    publishPsdLoadTiming(timing);
    return { text: `${file.name} を読み込みました`, kind: "success" };
  } catch (e) {
    tabStore.closeTab(newTab.id);
    throw new FileWorkflowError(`PSD 読み込み失敗: ${errorMessage(e)}`);
  }
}

async function loadImageAsLayer({
  activeTab,
  file,
  tabStore,
  stashAndAddTab,
}: LoadFileIntoAppOptions): Promise<FileWorkflowNotice> {
  let targetTab = activeTab;
  let createdTab: Tab | null = null;
  let operationStarted = false;
  try {
    let sourceDpi: number | null = null;
    if (!targetTab) {
      const { width, height } = await readBitmapSize(file);
      sourceDpi = await readImageDpi(file);
      targetTab = stashAndAddTab(width, height, sourceDpi ?? undefined);
      createdTab = targetTab;
      await waitForLoadingOverlayPaint();
    }

    const targetDoc = targetTab.doc;
    const targetHistory = targetTab.history;
    targetHistory.beginStructureOperation(targetDoc);
    operationStarted = true;
    await targetDoc.loadImageAsLayer(file, file.name);
    targetHistory.commitStructureOperation(targetDoc, `画像読み込み ${file.name}`);
    operationStarted = false;
    return { text: "画像をレイヤーとして読み込みました", kind: "success" };
  } catch (e) {
    if (operationStarted) targetTab?.history.cancelOperation();
    if (createdTab) tabStore.closeTab(createdTab.id);
    throw new FileWorkflowError(`画像読み込み失敗: ${errorMessage(e)}`);
  }
}

export async function loadFileIntoApp(
  options: LoadFileIntoAppOptions,
): Promise<FileWorkflowNotice> {
  const lower = options.file.name.toLowerCase();
  if (!isSupportedOpenFilePath(lower)) {
    throw new FileWorkflowError(
      "読み込めるファイルは .aipaint / PSD / PNG / JPEG / WebP です",
    );
  }
  if (lower.endsWith(".aipaint")) return loadAiPaintProject(options);
  if (lower.endsWith(".psd")) return loadPsdProject(options);
  return loadImageAsLayer(options);
}

export async function loadDirectImageForEditing({
  file,
  path,
  tabStore,
  stashAndAddTab,
}: LoadDirectImageOptions): Promise<FileWorkflowNotice> {
  const format = pickImageFormatFromPath(file.name);
  if (!format) {
    throw new FileWorkflowError("直接編集できる画像は PNG/JPEG/WebP です");
  }

  let newTab: Tab | null = null;
  let operationStarted = false;
  try {
    const { width, height } = await readBitmapSize(file);
    const sourceDpi = await readImageDpi(file);
    newTab = stashAndAddTab(width, height, sourceDpi ?? undefined);
    await waitForLoadingOverlayPaint();

    newTab.history.beginStructureOperation(newTab.doc);
    operationStarted = true;
    await newTab.doc.loadImageAsLayer(file, file.name);
    newTab.history.commitStructureOperation(newTab.doc, `画像を直接読み込み ${file.name}`);
    operationStarted = false;
    newTab.history.clear();
    markTabClean(tabStore, newTab, file.name, path);
    return { text: `${file.name} を直接編集用に読み込みました`, kind: "success" };
  } catch (e) {
    if (operationStarted) newTab?.history.cancelOperation();
    if (newTab) tabStore.closeTab(newTab.id);
    throw new FileWorkflowError(`画像読み込み失敗: ${errorMessage(e)}`);
  }
}
