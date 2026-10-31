import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
} from "react";
import {
  DIRECT_IMAGE_FILTERS,
  OPEN_IMAGE_FILTERS,
  defaultFilenameForFormat,
  pickImageFormatFromPath,
  pickFormatFromPath,
  saveFilterForFormat,
  type SaveFormat,
} from "../core/fileFormats";
import {
  checkFileActionGate,
  type FileActionKind,
} from "../core/fileActionGate";
import {
  basename,
  isTauri,
  openFileFromUserPath,
  saveBlobToUserPath,
  takeStartupOpenFiles,
  writeBlobToPath,
} from "../utils/saveFile";
import { pushToast } from "../ui/primitives";
import type { NativeReadTiming } from "../types";
import {
  loadDirectImageForEditing,
  loadFileIntoApp,
} from "./fileActions/fileLoadWorkflows";
import { formatStorageWriteError } from "../core/storageErrors";
import { blockShortcutEventWhileFileLoading } from "../core/shortcutLoadingLock";
import { preflightPsdOpen } from "../core/psdPreflight";
import {
  saveTabDocument,
  type SaveWriteResult,
} from "./fileActions/fileSaveWorkflow";
import { waitForLoadingOverlayPaint } from "./fileActions/paintWait";
import type { Tab, TabStore } from "./useTabs";

const hasFiles = (e: DragEvent) =>
  Array.from(e.dataTransfer.types || []).includes("Files");

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

interface UseFileActionsOptions {
  activeTab: Tab | null;
  tabStore: TabStore;
  anyDialogOpen: boolean;
  currentFileName: string | null;
  currentFilePath: string | null;
  stashAndAddTab: (w?: number, h?: number, dpi?: number) => Tab;
  isAutoBackupBusy: () => boolean;
}

export function useFileActions({
  activeTab,
  tabStore,
  anyDialogOpen,
  currentFileName,
  currentFilePath,
  stashAndAddTab,
  isAutoBackupBusy,
}: UseFileActionsOptions) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const directImageInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);
  const [loadingFileName, setLoadingFileName] = useState<string | null>(null);
  const loadingRef = useRef(false);
  const [savingFileName, setSavingFileName] = useState<string | null>(null);
  const savingRef = useRef(false);
  const paintBusyRef = useRef(false);
  const startupOpenCheckedRef = useRef(false);

  const setFileLoading = useCallback((fileName: string | null) => {
    loadingRef.current = fileName !== null;
    setLoadingFileName(fileName);
  }, []);
  const isFileLoading = useCallback(() => loadingRef.current, []);

  useLayoutEffect(() => {
    // 子コンポーネントの個別ショートカット処理より先にイベントを止める。
    const onKeyDown = (event: KeyboardEvent) => {
      blockShortcutEventWhileFileLoading(event, loadingRef.current);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  const canStartFileAction = useCallback((action: FileActionKind): boolean => {
    const decision = checkFileActionGate(action, {
      loading: loadingRef.current,
      saving: savingRef.current,
      painting: paintBusyRef.current,
      autoBackupBusy: isAutoBackupBusy(),
      anyDialogOpen,
      hasActiveTab: activeTab !== null,
    });
    if (decision.allowed) return true;
    if (decision.message) pushToast(decision.message);
    return false;
  }, [activeTab, anyDialogOpen, isAutoBackupBusy]);

  const preflightNativeOpen = useCallback((selection: {
    fileName: string;
    path?: string;
    fileSize: number;
    headerBytes: Uint8Array;
  }): void => {
    const openPath = selection.path ?? selection.fileName;
    if (pickFormatFromPath(openPath) === "psd") {
      preflightPsdOpen(selection.fileSize, selection.headerBytes);
    }
  }, []);

  const loadImageFile = useCallback(async (
    file: File,
    path?: string,
    nativeReadTiming?: NativeReadTiming,
  ) => {
    try {
      const notice = await loadFileIntoApp({
        activeTab,
        file,
        path,
        nativeReadTiming,
        tabStore,
        stashAndAddTab,
      });
      pushToast(notice.text, notice.kind);
    } catch (e) {
      pushToast(errorMessage(e), "error");
    }
  }, [activeTab, stashAndAddTab, tabStore]);

  const loadDirectImageFile = useCallback(async (file: File, path?: string) => {
    try {
      const notice = await loadDirectImageForEditing({
        file,
        path,
        tabStore,
        stashAndAddTab,
      });
      pushToast(notice.text, notice.kind);
    } catch (e) {
      pushToast(errorMessage(e), "error");
    }
  }, [stashAndAddTab, tabStore]);

  const handleImageFile = useCallback(async (
    file: File,
    path?: string,
    nativeReadTiming?: NativeReadTiming,
  ) => {
    if (!canStartFileAction("open-file")) return;
    setFileLoading(file.name);
    try {
      await loadImageFile(file, path, nativeReadTiming);
    } finally {
      setFileLoading(null);
    }
  }, [canStartFileAction, loadImageFile, setFileLoading]);

  const handleDirectImageFile = useCallback(async (file: File, path?: string) => {
    if (!canStartFileAction("open-image")) return;
    setFileLoading(file.name);
    try {
      await loadDirectImageFile(file, path);
    } finally {
      setFileLoading(null);
    }
  }, [canStartFileAction, loadDirectImageFile, setFileLoading]);

  const handleOpenImage = useCallback(async () => {
    if (isTauri()) {
      if (!canStartFileAction("open-file")) return;
      setFileLoading("ファイルを選択中");
      try {
        const res = await openFileFromUserPath(
          OPEN_IMAGE_FILTERS,
          {
            preflight: preflightNativeOpen,
            onSelected: async ({ fileName }) => {
              setFileLoading(fileName);
              await waitForLoadingOverlayPaint();
            },
          },
        );
        if (res.cancelled || !res.file) return;
        await loadImageFile(res.file, res.path, res.nativeReadTiming);
      } catch (e) {
        pushToast(`ファイルを開けません: ${errorMessage(e)}`, "error");
      } finally {
        setFileLoading(null);
      }
      return;
    }
    if (!canStartFileAction("open-file")) return;
    fileInputRef.current?.click();
  }, [canStartFileAction, loadImageFile, preflightNativeOpen, setFileLoading]);

  const handleOpenDirectImage = useCallback(async () => {
    if (isTauri()) {
      if (!canStartFileAction("open-image")) return;
      setFileLoading("ファイルを選択中");
      try {
        const res = await openFileFromUserPath(
          DIRECT_IMAGE_FILTERS,
          {
            onSelected: async ({ fileName }) => {
              setFileLoading(fileName);
              await waitForLoadingOverlayPaint();
            },
          },
        );
        if (res.cancelled || !res.file) return;
        await loadDirectImageFile(res.file, res.path);
      } catch (e) {
        pushToast(`画像を開けません: ${errorMessage(e)}`, "error");
      } finally {
        setFileLoading(null);
      }
      return;
    }
    if (!canStartFileAction("open-image")) return;
    directImageInputRef.current?.click();
  }, [canStartFileAction, loadDirectImageFile, setFileLoading]);

  useEffect(() => {
    if (startupOpenCheckedRef.current || !isTauri()) return;
    startupOpenCheckedRef.current = true;
    if (!canStartFileAction("open-file")) return;

    void (async () => {
      try {
        const results = await takeStartupOpenFiles({
          preflight: preflightNativeOpen,
          onSelected: async ({ fileName }) => {
            setFileLoading(fileName);
            await waitForLoadingOverlayPaint();
          },
        });
        for (const res of results) {
          if (res.cancelled || !res.file) continue;
          const targetPath = res.path ?? res.file.name;
          if (pickImageFormatFromPath(targetPath)) {
            await loadDirectImageFile(res.file, res.path);
          } else {
            await loadImageFile(res.file, res.path, res.nativeReadTiming);
          }
        }
      } catch (e) {
        pushToast(`起動時のファイルを開けません: ${errorMessage(e)}`, "error");
      } finally {
        setFileLoading(null);
      }
    })();
  }, [
    canStartFileAction,
    loadDirectImageFile,
    loadImageFile,
    preflightNativeOpen,
    setFileLoading,
  ]);

  const runLockedSave = useCallback(async (
    overlayName: string,
    format: SaveFormat,
    write: (blob: Blob) => Promise<SaveWriteResult | null>,
  ): Promise<void> => {
    if (!canStartFileAction("save") || !activeTab) return;
    savingRef.current = true;
    const targetTab = activeTab;
    setSavingFileName(overlayName);
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    try {
      const result = await saveTabDocument({
        targetTab,
        tabStore,
        format,
        write,
      });
      if (!result) return;
      pushToast(
        `保存しました: ${result.fileName} (${result.sizeLabel})`,
        "success",
      );
      if (result.hasUnsavedChangesAfterSave) {
        pushToast("保存中に変更が入ったため、未保存の変更が残っています");
      }
    } catch (e) {
      pushToast(
        `保存失敗: ${formatStorageWriteError(e, errorMessage(e))}`,
        "error"
      );
    } finally {
      savingRef.current = false;
      setSavingFileName(null);
    }
  }, [activeTab, canStartFileAction, tabStore]);

  const handleSaveAs = useCallback(async () => {
    const format: SaveFormat =
      (currentFileName ? pickFormatFromPath(currentFileName) : null) ?? "aipaint";
    const defaultName = currentFileName ?? defaultFilenameForFormat(format);
    const filter = saveFilterForFormat(format);
    await runLockedSave(defaultName, format, async (blob) => {
      const result = await saveBlobToUserPath(blob, defaultName, filter);
      if (result.cancelled) return null;
      return {
        fileName: result.fileName ?? defaultName,
        path: result.path,
      };
    });
  }, [currentFileName, runLockedSave]);

  const handleSave = useCallback(async () => {
    if (currentFilePath && isTauri()) {
      const format = pickFormatFromPath(currentFilePath);
      if (format) {
        const path = currentFilePath;
        const fileName = basename(path);
        await runLockedSave(fileName, format, async (blob) => {
          await writeBlobToPath(blob, path);
          return { fileName, path };
        });
        return;
      }
    }
    await handleSaveAs();
  }, [currentFilePath, handleSaveAs, runLockedSave]);

  const handleDragEnter = useCallback((e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragCounterRef.current += 1;
    setIsDragOver(true);
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    if (!hasFiles(e)) return;
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(async (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length === 0) return;
    for (const f of files) {
      await handleImageFile(f);
    }
  }, [handleImageFile]);

  return {
    fileInputRef,
    directImageInputRef,
    isDragOver,
    loadingFileName,
    isFileLoading,
    savingFileName,
    savingRef,
    paintBusyRef,
    handleOpenImage,
    handleOpenDirectImage,
    handleImageFile,
    handleDirectImageFile,
    handleSave,
    handleSaveAs,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  };
}

export type FileActions = ReturnType<typeof useFileActions>;
