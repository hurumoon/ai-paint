import { describe, expect, it } from "vitest";
import {
  AutoBackupRunner,
  BackupSaveError,
  formatBackupSaveError,
  normalizeAutoBackupIntervalSec,
  selectBackupIdsToDelete,
  selectOlderBackupIdsPerDocument,
  type AutoBackupTarget,
  type BackupEntry,
} from "../../src/core/autoBackup";
import type { PaintDocument } from "../../src/core/PaintDocument";

function backup(id: string, createdAt: number, size: number) {
  return { id, createdAt, size };
}

describe("auto backup interval", () => {
  it("uses the default for missing or non-finite values", () => {
    expect(normalizeAutoBackupIntervalSec(null)).toBe(300);
    expect(normalizeAutoBackupIntervalSec("abc")).toBe(300);
    expect(normalizeAutoBackupIntervalSec("Infinity")).toBe(300);
    expect(normalizeAutoBackupIntervalSec(Number.NaN)).toBe(300);
  });

  it("clamps finite values to the supported range", () => {
    expect(normalizeAutoBackupIntervalSec("1")).toBe(30);
    expect(normalizeAutoBackupIntervalSec("120")).toBe(120);
    expect(normalizeAutoBackupIntervalSec("999999999")).toBe(86_400);
  });
});

describe("auto backup retention", () => {
  it("deletes entries beyond the backup count limit", () => {
    const deleteIds = selectBackupIdsToDelete(
      [
        backup("oldest", 1, 10),
        backup("latest", 4, 10),
        backup("middle", 3, 10),
        backup("older", 2, 10),
      ],
      { maxBackups: 2, maxTotalBytes: 100 }
    );

    expect(new Set(deleteIds)).toEqual(new Set(["oldest", "older"]));
  });

  it("deletes old entries until the total size fits", () => {
    const deleteIds = selectBackupIdsToDelete(
      [
        backup("latest", 4, 60),
        backup("large-middle", 3, 50),
        backup("small-old", 2, 40),
      ],
      { maxBackups: 10, maxTotalBytes: 100 }
    );

    expect(new Set(deleteIds)).toEqual(new Set(["large-middle", "small-old"]));
  });

  it("prefers deleting larger entries when timestamps are equal", () => {
    const deleteIds = selectBackupIdsToDelete(
      [
        backup("latest", 3, 30),
        backup("small-tie", 2, 20),
        backup("large-tie", 2, 80),
      ],
      { maxBackups: 10, maxTotalBytes: 100 }
    );

    expect(deleteIds).toEqual(["large-tie"]);
  });

  it("keeps the latest backup even when it exceeds the total size limit alone", () => {
    const deleteIds = selectBackupIdsToDelete(
      [
        backup("latest", 3, 200),
        backup("old", 2, 20),
      ],
      { maxBackups: 10, maxTotalBytes: 100 }
    );

    expect(deleteIds).toEqual(["old"]);
  });

  it("selects older backups per document without deleting legacy entries", () => {
    const deleteIds = selectOlderBackupIdsPerDocument([
      { id: "tab-a-old", documentId: "tab-a", createdAt: 1 },
      { id: "tab-b-latest", documentId: "tab-b", createdAt: 5 },
      { id: "tab-a-latest", documentId: "tab-a", createdAt: 4 },
      { id: "legacy-old", createdAt: 2 },
      { id: "tab-b-old", documentId: "tab-b", createdAt: 3 },
      { id: "legacy-latest", createdAt: 6 },
    ]);

    expect(new Set(deleteIds)).toEqual(
      new Set(["tab-a-old", "tab-b-old"])
    );
  });

  it("formats quota failures with a storage cleanup action", () => {
    const message = formatBackupSaveError(
      new BackupSaveError({
        isQuota: true,
        deletedCount: 2,
        detail: "simulated quota",
        message:
          "ストレージ容量が足りないためバックアップを保存できませんでした。古いバックアップを削除するか、自動バックアップを一時停止してください。",
      })
    );

    expect(message).toContain("ストレージ容量が足りない");
    expect(message).toContain("古いバックアップ2件を削除しても");
    expect(message).toContain("自動バックアップを一時停止");
  });
});

function runnerTarget(
  id: string,
  dirty: { value: boolean },
  saved: string[]
): AutoBackupTarget {
  return {
    id,
    doc: {} as PaintDocument,
    isDirty: () => dirty.value,
    beforeSave: () => ({ id }),
    metadata: () => ({ documentId: id, fileName: `${id}.psd` }),
    onSaved: () => {
      dirty.value = false;
      saved.push(id);
    },
  };
}

function savedEntry(documentId: string): BackupEntry {
  return {
    id: `backup-${documentId}`,
    createdAt: 1,
    width: 1,
    height: 1,
    size: 1,
    blob: new Blob(["x"]),
    documentId,
  };
}

describe("active tab auto backup runner", () => {
  it("saves only the active target for each run", async () => {
    const saved: string[] = [];
    const dirtyA = { value: true };
    const dirtyB = { value: true };
    const targetA = runnerTarget("tab-a", dirtyA, saved);
    const targetB = runnerTarget("tab-b", dirtyB, saved);
    let activeTarget: AutoBackupTarget | null = targetA;
    const runner = new AutoBackupRunner(
      () => activeTarget,
      () => true,
      async (_doc, metadata) =>
        savedEntry(metadata?.documentId ?? "unknown")
    );

    await expect(runner.runPending()).resolves.toEqual({
      attempted: 1,
      blocked: false,
    });
    expect(saved).toEqual(["tab-a"]);
    expect(dirtyB.value).toBe(true);

    activeTarget = targetB;
    await runner.runPending();
    expect(saved).toEqual(["tab-a", "tab-b"]);
  });

  it("coalesces overlapping runs without creating a queue", async () => {
    const saved: string[] = [];
    const dirty = { value: true };
    const target = runnerTarget("tab-a", dirty, saved);
    let releaseSave: (() => void) | null = null;
    let saveCalls = 0;
    const runner = new AutoBackupRunner(
      () => target,
      () => true,
      async () => {
        saveCalls += 1;
        await new Promise<void>((resolve) => {
          releaseSave = resolve;
        });
        return savedEntry("tab-a");
      }
    );

    const firstRun = runner.runPending();
    const secondRun = runner.runPending();
    await Promise.resolve();
    expect(saveCalls).toBe(1);
    expect(runner.isBusy()).toBe(true);

    releaseSave?.();
    await Promise.all([firstRun, secondRun]);
    expect(saveCalls).toBe(1);
    expect(saved).toEqual(["tab-a"]);
  });

  it("does not follow an active-tab change during the same run", async () => {
    const saved: string[] = [];
    const targetA = runnerTarget("tab-a", { value: true }, saved);
    const targetB = runnerTarget("tab-b", { value: true }, saved);
    let activeTarget: AutoBackupTarget | null = targetA;
    let releaseSave: (() => void) | null = null;
    const runner = new AutoBackupRunner(
      () => activeTarget,
      () => true,
      async (_doc, metadata) => {
        await new Promise<void>((resolve) => {
          releaseSave = resolve;
        });
        return savedEntry(metadata?.documentId ?? "unknown");
      }
    );

    const run = runner.runPending();
    await Promise.resolve();
    activeTarget = targetB;
    releaseSave?.();
    await run;

    expect(saved).toEqual(["tab-a"]);
  });

  it("reports a blocked run so the caller can retry", async () => {
    const saved: string[] = [];
    const dirty = { value: true };
    const target = runnerTarget("tab-a", dirty, saved);
    let available = false;
    const runner = new AutoBackupRunner(
      () => target,
      () => available,
      async () => savedEntry("tab-a")
    );

    await expect(runner.runPending()).resolves.toEqual({
      attempted: 0,
      blocked: true,
    });
    expect(dirty.value).toBe(true);

    available = true;
    await expect(runner.runPending()).resolves.toEqual({
      attempted: 1,
      blocked: false,
    });
    expect(saved).toEqual(["tab-a"]);
  });

  it("serializes restore and cleanup mutations with backup work", async () => {
    const saved: string[] = [];
    const target = runnerTarget("tab-a", { value: true }, saved);
    let releaseMutation: (() => void) | null = null;
    const runner = new AutoBackupRunner(
      () => target,
      () => true,
      async () => savedEntry("tab-a")
    );

    const mutation = runner.runMutation(async () => {
      await new Promise<void>((resolve) => {
        releaseMutation = resolve;
      });
    });

    expect(runner.isOperationBusy()).toBe(true);
    await expect(runner.runPending()).resolves.toEqual({
      attempted: 0,
      blocked: true,
    });
    await expect(runner.saveNow()).rejects.toThrow(
      "バックアップ関連処理中"
    );

    releaseMutation?.();
    await mutation;
    await runner.runPending();
    expect(saved).toEqual(["tab-a"]);
  });
});
