// 自動バックアップ: 一定時間ごとに .aipaint を IndexedDB に保存。
// 起動時に最新のバックアップが存在する場合は復元できる。
// IndexedDB に保存するのは、Tauri プラグインを増やさずに数百MBまで蓄えられるため。

import { PaintDocument } from "./PaintDocument";
import { saveAiPaint, loadAiPaint } from "./nativeFormat";
import { isQuotaExceededError, storageErrorDetail } from "./storageErrors";

const DB_NAME = "ai-paint-backups";
const STORE = "snapshots";
export const MAX_BACKUPS = 10;
export const MAX_BACKUP_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
export const DEFAULT_AUTO_BACKUP_INTERVAL_SEC = 300;
export const MIN_AUTO_BACKUP_INTERVAL_SEC = 30;
export const MAX_AUTO_BACKUP_INTERVAL_SEC = 86_400;

export function normalizeAutoBackupIntervalSec(value: unknown): number {
  if (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "")
  ) {
    return DEFAULT_AUTO_BACKUP_INTERVAL_SEC;
  }
  const interval = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(interval)) return DEFAULT_AUTO_BACKUP_INTERVAL_SEC;
  return Math.min(
    MAX_AUTO_BACKUP_INTERVAL_SEC,
    Math.max(MIN_AUTO_BACKUP_INTERVAL_SEC, Math.round(interval))
  );
}

export interface BackupEntry {
  id: string;
  createdAt: number;
  width: number;
  height: number;
  size: number;
  blob: Blob;
  documentId?: string;
  fileName?: string;
  historyVersion?: number;
  documentVersion?: number;
}

export interface BackupEntryMetadata {
  documentId?: string;
  fileName?: string;
  historyVersion?: number;
  documentVersion?: number;
}

export interface BackupSaveFailure {
  message: string;
  isQuota: boolean;
  deletedCount: number;
  detail: string;
}

type BackupRetentionEntry = Pick<BackupEntry, "id" | "createdAt"> &
  Partial<Pick<BackupEntry, "size" | "blob">>;
type BackupDocumentEntry = Pick<
  BackupEntry,
  "id" | "createdAt" | "documentId"
>;

let db: IDBDatabase | null = null;

function backupEntrySize(entry: BackupRetentionEntry): number {
  if (typeof entry.size === "number" && Number.isFinite(entry.size) && entry.size >= 0) {
    return entry.size;
  }
  return entry.blob?.size ?? 0;
}

function compareBackupsForRetention(a: BackupRetentionEntry, b: BackupRetentionEntry): number {
  const createdAtDiff = b.createdAt - a.createdAt;
  if (createdAtDiff !== 0) return createdAtDiff;

  const sizeDiff = backupEntrySize(b) - backupEntrySize(a);
  if (sizeDiff !== 0) return sizeDiff;

  return a.id.localeCompare(b.id);
}

function compareBackupsForDeletion(a: BackupRetentionEntry, b: BackupRetentionEntry): number {
  const createdAtDiff = a.createdAt - b.createdAt;
  if (createdAtDiff !== 0) return createdAtDiff;

  const sizeDiff = backupEntrySize(b) - backupEntrySize(a);
  if (sizeDiff !== 0) return sizeDiff;

  return a.id.localeCompare(b.id);
}

function normalizeBackupEntry(entry: BackupEntry): BackupEntry {
  const size = backupEntrySize(entry);
  return entry.size === size ? entry : { ...entry, size };
}

export function selectBackupIdsToDelete(
  entries: BackupRetentionEntry[],
  options: {
    maxBackups?: number;
    maxTotalBytes?: number;
  } = {}
): string[] {
  const maxBackups = Math.max(1, Math.floor(options.maxBackups ?? MAX_BACKUPS));
  const maxTotalBytes = Math.max(0, options.maxTotalBytes ?? MAX_BACKUP_TOTAL_BYTES);
  const ordered = entries.slice().sort(compareBackupsForRetention);
  const keep = ordered.slice(0, maxBackups);
  const deleteIds = new Set(ordered.slice(maxBackups).map((entry) => entry.id));
  let keptBytes = keep.reduce((sum, entry) => sum + backupEntrySize(entry), 0);

  while (keep.length > 1 && keptBytes > maxTotalBytes) {
    const [drop] = keep.slice(1).sort(compareBackupsForDeletion);
    deleteIds.add(drop.id);
    keptBytes -= backupEntrySize(drop);
    keep.splice(keep.findIndex((entry) => entry.id === drop.id), 1);
  }

  return entries.filter((entry) => deleteIds.has(entry.id)).map((entry) => entry.id);
}

export function selectOlderBackupIdsPerDocument(
  entries: BackupDocumentEntry[]
): string[] {
  const ordered = entries.slice().sort((a, b) => {
    const createdAtDiff = b.createdAt - a.createdAt;
    return createdAtDiff !== 0 ? createdAtDiff : a.id.localeCompare(b.id);
  });
  const seenDocumentIds = new Set<string>();
  const deleteIds: string[] = [];

  for (const entry of ordered) {
    // 旧形式には文書を識別する情報がない。別文書の復旧点を誤って消さないよう、
    // documentId のないエントリは個別削除か「すべて削除」でのみ削除する。
    if (!entry.documentId) continue;
    if (seenDocumentIds.has(entry.documentId)) {
      deleteIds.push(entry.id);
    } else {
      seenDocumentIds.add(entry.documentId);
    }
  }

  return deleteIds;
}

function openDb(): Promise<IDBDatabase> {
  if (db) return Promise.resolve(db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(STORE)) {
        d.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => {
      db = req.result;
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await openDb();
  return new Promise<T>((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const s = t.objectStore(STORE);
    const req = fn(s);
    let result: T | undefined;
    req.onsuccess = () => {
      result = req.result;
    };
    req.onerror = () => reject(req.error);
    t.oncomplete = () => resolve(result as T);
    t.onerror = () => reject(t.error ?? req.error);
    t.onabort = () => reject(t.error ?? req.error);
  });
}

async function deleteBackupIds(ids: string[]): Promise<void> {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) return;

  const d = await openDb();
  return new Promise<void>((resolve, reject) => {
    const transaction = d.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    let requestError: DOMException | null = null;

    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(
        transaction.error ??
          requestError ??
          new Error("バックアップの削除に失敗しました")
      );
    transaction.onabort = () =>
      reject(
        transaction.error ??
          requestError ??
          new Error("バックアップの削除を中止しました")
      );

    try {
      for (const id of uniqueIds) {
        const request = store.delete(id);
        request.onerror = () => {
          requestError = request.error;
        };
      }
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        // すでに完了・中止済みなら、元の例外をそのまま通知する。
      }
      reject(error);
    }
  });
}

async function putBackupWithDeletions(
  entry: BackupEntry,
  ids: string[]
): Promise<void> {
  const uniqueIds = [...new Set(ids)].filter((id) => id !== entry.id);
  const d = await openDb();
  return new Promise<void>((resolve, reject) => {
    const transaction = d.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    let requestError: DOMException | null = null;

    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(
        transaction.error ??
          requestError ??
          new Error("バックアップの保存に失敗しました")
      );
    transaction.onabort = () =>
      reject(
        transaction.error ??
          requestError ??
          new Error("バックアップの保存を中止しました")
      );

    try {
      // 最後の正常な復旧点を含む削除は、新しい復旧点の保存と同時にだけ確定する。
      // put や commit が失敗した場合は transaction 全体が戻り、既存分が残る。
      for (const id of uniqueIds) {
        const request = store.delete(id);
        request.onerror = () => {
          requestError = request.error;
        };
      }
      const request = store.put(entry);
      request.onerror = () => {
        requestError = request.error;
      };
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        // すでに完了・中止済みなら、元の例外をそのまま通知する。
      }
      reject(error);
    }
  });
}

async function pruneBackups(): Promise<void> {
  await deleteBackupIds(selectBackupIdsToDelete(await listBackups()));
}

async function retryBackupWithPruning(entry: BackupEntry): Promise<void> {
  const deleteIds = selectBackupIdsToDelete([...(await listBackups()), entry]).filter(
    (id) => id !== entry.id
  );
  await putBackupWithDeletions(entry, deleteIds);
}

function backupSaveFailure(
  error: unknown,
  deletedCount: number
): BackupSaveFailure {
  const isQuota = isQuotaExceededError(error);
  return {
    isQuota,
    deletedCount,
    detail: storageErrorDetail(error),
    message: isQuota
      ? "ストレージ容量が足りないためバックアップを保存できませんでした。古いバックアップを削除するか、自動バックアップを一時停止してください。"
      : `バックアップを保存できませんでした: ${storageErrorDetail(error)}`,
  };
}

export function formatBackupSaveError(error: unknown): string {
  if (isBackupSaveError(error)) {
    if (error.failure.deletedCount > 0) {
      return `${error.failure.message} 古いバックアップ${error.failure.deletedCount}件を削除しても空き容量が足りませんでした。`;
    }
    return error.failure.message;
  }
  return backupSaveFailure(error, 0).message;
}

export function isBackupSaveError(error: unknown): error is BackupSaveError {
  return error instanceof BackupSaveError;
}

export class BackupSaveError extends Error {
  readonly failure: BackupSaveFailure;

  constructor(failure: BackupSaveFailure) {
    super(failure.message);
    this.name = "BackupSaveError";
    this.failure = failure;
  }
}

export async function saveBackup(
  doc: PaintDocument,
  metadata: BackupEntryMetadata = {}
): Promise<BackupEntry> {
  const blob = await saveAiPaint(doc);
  const createdAt = Date.now();
  const randomSuffix =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2, 10);
  const entry: BackupEntry = {
    id: `backup-${createdAt}-${randomSuffix}`,
    createdAt,
    width: doc.width,
    height: doc.height,
    size: blob.size,
    blob,
    ...metadata,
  };
  try {
    await tx("readwrite", (s) => s.put(entry));
  } catch (e) {
    if (!isQuotaExceededError(e)) {
      throw new BackupSaveError(backupSaveFailure(e, 0));
    }
    try {
      await retryBackupWithPruning(entry);
    } catch (retryError) {
      // 原子的な再試行が失敗した場合、削除候補もロールバックされている。
      throw new BackupSaveError(backupSaveFailure(retryError, 0));
    }
  }
  try {
    await pruneBackups();
  } catch (error) {
    // 保存は確定済み。後処理の失敗で保存通知やバックアップ済み判定を止めない。
    console.warn("バックアップは保存済みですが、古いバックアップの整理に失敗しました", error);
  }
  return entry;
}

export async function listBackups(): Promise<BackupEntry[]> {
  const d = await openDb();
  return new Promise<BackupEntry[]>((resolve, reject) => {
    const t = d.transaction(STORE, "readonly");
    const s = t.objectStore(STORE);
    const req = s.getAll();
    req.onsuccess = () => {
      const arr = (req.result as BackupEntry[]).map(normalizeBackupEntry);
      arr.sort((a, b) => b.createdAt - a.createdAt);
      resolve(arr);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteBackup(id: string): Promise<void> {
  await deleteBackupIds([id]);
}

export async function deleteBackups(ids: string[]): Promise<void> {
  await deleteBackupIds(ids);
}

export async function deleteAllBackups(): Promise<void> {
  await deleteBackupIds((await listBackups()).map((entry) => entry.id));
}

export async function restoreBackup(entry: BackupEntry, doc: PaintDocument): Promise<void> {
  await loadAiPaint(entry.blob, doc);
}

export interface AutoBackupTarget {
  id: string;
  doc: PaintDocument;
  isDirty: () => boolean;
  beforeSave: () => unknown;
  metadata: (token: unknown) => BackupEntryMetadata;
  onSaved: (entry: BackupEntry, token: unknown) => void;
}

export type AutoBackupRunnerEvent =
  | { type: "saving"; targetId: string; source: "auto" | "manual" }
  | { type: "saved"; targetId: string; entry: BackupEntry; source: "auto" | "manual" }
  | {
      type: "error";
      targetId: string;
      failure: BackupSaveFailure;
      source: "auto" | "manual";
    };

type SaveBackupFn = (
  doc: PaintDocument,
  metadata?: BackupEntryMetadata
) => Promise<BackupEntry>;

export interface AutoBackupRunResult {
  attempted: number;
  blocked: boolean;
}

// tick 開始時のアクティブタブだけを保存する。対象は保存開始前に固定し、
// 完了までは呼び出し側でタブ操作を止めて途中の切替を防ぐ。
export class AutoBackupRunner {
  private saving = false;
  private currentRun: Promise<AutoBackupRunResult> | null = null;
  private mutationBusy = false;

  constructor(
    private readonly getActiveTarget: () => AutoBackupTarget | null,
    private readonly canStart: () => boolean,
    private readonly save: SaveBackupFn = saveBackup,
    private readonly onEvent?: (event: AutoBackupRunnerEvent) => void
  ) {}

  isBusy(): boolean {
    return this.saving;
  }

  isOperationBusy(): boolean {
    return (
      this.currentRun !== null ||
      this.saving ||
      this.mutationBusy
    );
  }

  async runPending(): Promise<AutoBackupRunResult> {
    if (this.currentRun) return this.currentRun;
    if (this.mutationBusy) return { attempted: 0, blocked: true };
    const run = this.saveActiveIfNeeded();
    this.currentRun = run;
    try {
      return await run;
    } finally {
      if (this.currentRun === run) this.currentRun = null;
    }
  }

  async saveNow(): Promise<BackupEntry> {
    if (this.currentRun) await this.currentRun;
    if (this.mutationBusy) {
      throw new Error("別のバックアップ関連処理中のため保存できません");
    }
    if (!this.canStart()) {
      throw new Error("別の重い処理中のためバックアップを開始できません");
    }
    const target = this.getActiveTarget();
    if (!target) throw new Error("バックアップ対象のアクティブタブがありません");
    return this.saveTarget(target, "manual");
  }

  async runMutation<T>(operation: () => Promise<T>): Promise<T> {
    if (this.isOperationBusy()) {
      throw new Error("別のバックアップ関連処理中です");
    }
    this.mutationBusy = true;
    try {
      return await operation();
    } finally {
      this.mutationBusy = false;
    }
  }

  private async saveActiveIfNeeded(): Promise<AutoBackupRunResult> {
    if (this.mutationBusy || !this.canStart()) {
      return { attempted: 0, blocked: true };
    }
    const target = this.getActiveTarget();
    if (!target || !target.isDirty()) {
      return { attempted: 0, blocked: false };
    }
    try {
      await this.saveTarget(target, "auto");
    } catch {
      // 失敗状態はイベントで通知済み。次の tick まで再試行しない。
    }
    return { attempted: 1, blocked: false };
  }

  private async saveTarget(
    target: AutoBackupTarget,
    source: "auto" | "manual"
  ): Promise<BackupEntry> {
    if (this.saving) {
      throw new Error("別のバックアップを保存中です");
    }
    const token = target.beforeSave();
    this.saving = true;
    this.onEvent?.({ type: "saving", targetId: target.id, source });
    try {
      const entry = await this.save(target.doc, target.metadata(token));
      target.onSaved(entry, token);
      this.onEvent?.({ type: "saved", targetId: target.id, entry, source });
      return entry;
    } catch (error) {
      const failure = isBackupSaveError(error)
        ? error.failure
        : backupSaveFailure(error, 0);
      this.onEvent?.({ type: "error", targetId: target.id, failure, source });
      throw error;
    } finally {
      this.saving = false;
    }
  }
}
