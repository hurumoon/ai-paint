import { expect, test, type Page } from "@playwright/test";
import {
  countDarkCompositePixels,
  createCanvas,
  drawHorizontalStroke,
  fillCanvasWithBucket,
} from "./canvas-helpers";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });
});

test("creates a manual backup and exposes cleanup controls", async ({ page }) => {
  page.on("dialog", (dialog) => dialog.accept());

  await page.goto("/");
  await createCanvas(page, { width: 48, height: 36, dpi: 144 });

  await page.getByTestId("topbar-backup").click();
  const panel = page.getByTestId("backup-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("backup-storage-summary")).toContainText("0件");

  await panel.getByTestId("backup-save-now").click();
  await expect(
    page.locator(".toast.success", { hasText: "バックアップを作成しました" })
  ).toBeVisible();
  await expect(panel.getByTestId("backup-storage-summary")).toContainText("1件");
  await expect(panel.getByTestId("backup-delete-all")).toBeEnabled();

  await panel.getByTestId("backup-delete-all").click();
  await expect(
    page.locator(".toast.success", { hasText: "バックアップをすべて削除しました" })
  ).toBeVisible();
  await expect(panel.getByText("バックアップはまだありません")).toBeVisible();
  await expect(panel.getByTestId("backup-storage-summary")).toContainText("0件");
});

test("deleting older backups in the current-tab view preserves other tabs", async ({
  page,
}) => {
  page.on("dialog", (dialog) => dialog.accept());

  await page.goto("/");
  await createCanvas(page, { width: 48, height: 36, dpi: 144 });

  await page.getByTestId("topbar-backup").click();
  let panel = page.getByTestId("backup-panel");
  await panel.getByTestId("backup-save-now").click();
  await panel.getByTestId("backup-save-now").click();
  await expect(panel.getByTestId("backup-storage-summary")).toContainText("2件");
  await panel.getByRole("button", { name: "×" }).click();

  await page.locator(".tab-add").click();
  await expect(page.locator(".tab")).toHaveCount(2);

  await page.getByTestId("topbar-backup").click();
  panel = page.getByTestId("backup-panel");
  await panel.getByTestId("backup-save-now").click();
  await expect(panel.getByTestId("backup-storage-summary")).toContainText("3件");
  await panel.getByRole("button", { name: "×" }).click();

  await page.locator(".tab").first().click();
  await page.getByTestId("topbar-backup").click();
  panel = page.getByTestId("backup-panel");

  const deleteOlder = panel.getByTestId("backup-delete-older");
  await expect(deleteOlder).toHaveText("このタブの古いバックアップを削除");
  await deleteOlder.click();
  await expect(
    page.locator(".toast.success", {
      hasText: "現在のタブの古いバックアップを削除しました",
    })
  ).toBeVisible();

  await panel.getByTestId("backup-filter").selectOption("all");
  await expect(deleteOlder).toHaveText("文書ごとの古いバックアップを削除");
  await expect(panel.getByTestId("backup-storage-summary")).toContainText("2件");
  await expect(panel.getByTestId("backup-document-group")).toHaveCount(2);

  const backupsPerDocument = await page.evaluate(async () => {
    const { listBackups } = await import("/src/core/autoBackup.ts");
    const counts = new Map<string, number>();
    for (const entry of await listBackups()) {
      const documentId = entry.documentId ?? "legacy";
      counts.set(documentId, (counts.get(documentId) ?? 0) + 1);
    }
    return [...counts.values()].sort();
  });
  expect(backupsPerDocument).toEqual([1, 1]);
});

test("deleting older backups in the all-backups view keeps the latest for every document", async ({
  page,
}) => {
  page.on("dialog", (dialog) => dialog.accept());

  await page.goto("/");
  await createCanvas(page, { width: 48, height: 36, dpi: 144 });

  await page.getByTestId("topbar-backup").click();
  let panel = page.getByTestId("backup-panel");
  await panel.getByTestId("backup-save-now").click();
  await panel.getByTestId("backup-save-now").click();
  await panel.getByRole("button", { name: "×" }).click();

  await page.locator(".tab-add").click();
  await expect(page.locator(".tab")).toHaveCount(2);

  await page.getByTestId("topbar-backup").click();
  panel = page.getByTestId("backup-panel");
  await panel.getByTestId("backup-save-now").click();
  await panel.getByTestId("backup-save-now").click();
  await expect(panel.getByTestId("backup-storage-summary")).toContainText("4件");
  await panel.getByTestId("backup-filter").selectOption("all");

  const expectedLatestIds = await page.evaluate(async () => {
    const { listBackups } = await import("/src/core/autoBackup.ts");
    const latestByDocument = new Map<string, string>();
    for (const entry of await listBackups()) {
      if (entry.documentId && !latestByDocument.has(entry.documentId)) {
        latestByDocument.set(entry.documentId, entry.id);
      }
    }
    return [...latestByDocument.values()].sort();
  });
  expect(expectedLatestIds).toHaveLength(2);

  await panel.getByTestId("backup-delete-older").click();
  await expect(
    page.locator(".toast.success", {
      hasText: "文書ごとの古いバックアップを削除しました",
    })
  ).toBeVisible();

  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { listBackups } = await import("/src/core/autoBackup.ts");
        return (await listBackups()).map((entry) => entry.id).sort();
      })
    )
    .toEqual(expectedLatestIds);
  await expect(panel.getByTestId("backup-storage-summary")).toContainText("2件");
  await expect(panel.getByTestId("backup-document-group")).toHaveCount(2);
  await expect(panel.getByTestId("backup-delete-older")).toBeDisabled();
});

test("keeps legacy backups when organizing document backups", async ({ page }) => {
  page.on("dialog", (dialog) => dialog.accept());

  await page.goto("/");
  await createCanvas(page, { width: 48, height: 36, dpi: 144 });

  await page.getByTestId("topbar-backup").click();
  const panel = page.getByTestId("backup-panel");
  await panel.getByTestId("backup-save-now").click();
  await panel.getByTestId("backup-save-now").click();

  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("ai-paint-backups", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("snapshots", "readwrite");
      const store = transaction.objectStore("snapshots");
      store.put({
        id: "legacy-backup-old",
        createdAt: 1,
        width: 8,
        height: 8,
        size: 3,
        blob: new Blob(["old"]),
      });
      store.put({
        id: "legacy-backup-latest",
        createdAt: 2,
        width: 8,
        height: 8,
        size: 6,
        blob: new Blob(["latest"]),
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
  });

  await panel.getByTestId("backup-refresh").click();
  await panel.getByTestId("backup-filter").selectOption("all");
  await expect(panel.getByTestId("backup-storage-summary")).toContainText("4件");
  await panel.getByTestId("backup-delete-older").click();
  await expect(
    page.locator(".toast.success", {
      hasText: "文書ごとの古いバックアップを削除しました",
    })
  ).toBeVisible();

  const entries = await page.evaluate(async () => {
    const { listBackups } = await import("/src/core/autoBackup.ts");
    return (await listBackups()).map((entry) => ({
      id: entry.id,
      documentId: entry.documentId,
    }));
  });
  expect(entries.filter((entry) => entry.documentId)).toHaveLength(1);
  expect(
    entries
      .filter((entry) => !entry.documentId)
      .map((entry) => entry.id)
      .sort()
  ).toEqual(["legacy-backup-latest", "legacy-backup-old"]);
  await expect(panel.getByTestId("backup-storage-summary")).toContainText("3件");
});

test("rolls back document cleanup when one delete fails", async ({ page }) => {
  await page.addInitScript(() => {
    const originalDelete = IDBObjectStore.prototype.delete;
    let snapshotDeleteCount = 0;
    IDBObjectStore.prototype.delete = function (
      this: IDBObjectStore,
      query: IDBValidKey | IDBKeyRange
    ) {
      if (this.name === "snapshots") {
        snapshotDeleteCount += 1;
        if (snapshotDeleteCount === 2) {
          throw new DOMException("simulated delete failure", "AbortError");
        }
      }
      return originalDelete.call(this, query);
    };
  });
  page.on("dialog", (dialog) => dialog.accept());

  await page.goto("/");
  await createCanvas(page, { width: 48, height: 36, dpi: 144 });

  await page.getByTestId("topbar-backup").click();
  const panel = page.getByTestId("backup-panel");
  await panel.getByTestId("backup-save-now").click();
  await expect(panel.getByTestId("backup-storage-summary")).toContainText("1件");
  await panel.getByTestId("backup-save-now").click();
  await expect(panel.getByTestId("backup-storage-summary")).toContainText("2件");
  await panel.getByTestId("backup-save-now").click();
  await expect(panel.getByTestId("backup-storage-summary")).toContainText("3件");

  const backupIds = async () =>
    page.evaluate(async () => {
      const { listBackups } = await import("/src/core/autoBackup.ts");
      return (await listBackups()).map((entry) => entry.id).sort();
    });
  const beforeIds = await backupIds();
  expect(beforeIds).toHaveLength(3);

  await panel.getByTestId("backup-delete-older").click();
  await expect(page.locator(".toast.error")).toContainText("削除失敗");
  await expect.poll(backupIds).toEqual(beforeIds);
  await expect(panel.getByTestId("backup-storage-summary")).toContainText("3件");
});

test("reports a committed backup as saved when pruning aborts and skips the next unchanged run", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { AutoBackupRunner, MAX_BACKUPS, listBackups, saveBackup } =
      await import("/src/core/autoBackup.ts");
    const { PaintDocument } = await import("/src/core/PaintDocument.ts");
    const doc = new PaintDocument(8, 8);
    for (let i = 0; i < MAX_BACKUPS; i += 1) {
      await saveBackup(doc);
    }
    const originalDelete = IDBObjectStore.prototype.delete;
    let deleteAttempts = 0;
    IDBObjectStore.prototype.delete = function (query) {
      const request = originalDelete.call(this, query);
      if (this.name === "snapshots") {
        deleteAttempts += 1;
        this.transaction.abort();
      }
      return request;
    };
    let dirty = true;
    let savedCalls = 0;
    let savedId = "";
    const events: string[] = [];
    const runner = new AutoBackupRunner(
      () => ({
        id: "prune-failure",
        doc,
        isDirty: () => dirty,
        beforeSave: () => 42,
        metadata: () => ({ documentId: "prune-failure" }),
        onSaved: (entry, token) => {
          if (token !== 42) throw new Error("Unexpected backup token");
          dirty = false;
          savedCalls += 1;
          savedId = entry.id;
        },
      }),
      () => true,
      undefined,
      (event) => events.push(event.type)
    );
    try {
      await runner.runPending();
      const secondRun = await runner.runPending();
      const entries = await listBackups();
      return {
        deleteAttempts,
        savedCalls,
        events,
        secondRun,
        count: entries.length,
        expectedCount: MAX_BACKUPS + 1,
        savedExists: entries.some((entry) => entry.id === savedId),
      };
    } finally {
      IDBObjectStore.prototype.delete = originalDelete;
    }
  });
  expect(result.deleteAttempts).toBe(1);
  expect(result.savedCalls).toBe(1);
  expect(result.events).toEqual(["saving", "saved"]);
  expect(result.secondRun).toEqual({ attempted: 0, blocked: false });
  expect(result.count).toBe(result.expectedCount);
  expect(result.savedExists).toBe(true);
});

test("restores saved backup pixels through the backup panel", async ({ page }) => {
  page.on("dialog", (dialog) => dialog.accept());

  await page.goto("/");
  await createCanvas(page, { width: 80, height: 60, dpi: 144 });

  const fullCanvas = await fillCanvasWithBucket(page);
  await expect
    .poll(() => countDarkCompositePixels(page, fullCanvas))
    .toBeGreaterThan(4_000);

  await page.getByTestId("topbar-backup").click();
  let panel = page.getByTestId("backup-panel");
  await panel.getByTestId("backup-save-now").click();
  await expect(
    page.locator(".toast.success", { hasText: "バックアップを作成しました" })
  ).toBeVisible();
  await panel.getByRole("button", { name: "×" }).click();
  await expect(panel).toBeHidden();

  await page.keyboard.press("e");
  await drawHorizontalStroke(page);
  await expect
    .poll(() => countDarkCompositePixels(page, fullCanvas))
    .toBeLessThan(4_600);
  await expect.poll(() => page.title()).toMatch(/^\*/);

  await page.getByTestId("topbar-backup").click();
  panel = page.getByTestId("backup-panel");
  await panel.getByRole("button", { name: "復元" }).click();
  await expect(
    page.locator(".toast.success", { hasText: "バックアップから復元しました" })
  ).toBeVisible();
  await expect(panel).toBeHidden();
  await expect
    .poll(() => countDarkCompositePixels(page, fullCanvas))
    .toBeGreaterThan(4_000);
});

test("shows a helpful quota error when backup storage is full", async ({ page }) => {
  await page.addInitScript(() => {
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey
    ) {
      const candidate = value as { id?: unknown };
      if (
        this.name === "snapshots" &&
        typeof candidate.id === "string" &&
        candidate.id.startsWith("backup-")
      ) {
        throw new DOMException("simulated quota", "QuotaExceededError");
      }
      return key === undefined
        ? originalPut.call(this, value)
        : originalPut.call(this, value, key);
    };
  });

  await page.goto("/");
  await createCanvas(page, { width: 48, height: 36, dpi: 144 });

  await page.getByTestId("topbar-backup").click();
  const panel = page.getByTestId("backup-panel");
  await expect(panel).toBeVisible();

  await panel.getByTestId("backup-save-now").click();
  await expect(page.locator(".toast.error")).toContainText("ストレージ容量が足りない");
  await expect(page.locator(".toast.error")).toContainText("自動バックアップを一時停止");
  await expect(panel.getByTestId("backup-storage-summary")).toContainText("0件");
});

test("keeps the last existing backup when the quota retry also fails", async ({
  page,
}) => {
  await page.goto("/");
  await createCanvas(page, { width: 48, height: 36, dpi: 144 });

  await page.getByTestId("topbar-backup").click();
  const panel = page.getByTestId("backup-panel");
  await panel.getByTestId("backup-save-now").click();
  await expect(panel.getByTestId("backup-storage-summary")).toContainText("1件");

  const backupIds = async () =>
    page.evaluate(async () => {
      const { listBackups } = await import("/src/core/autoBackup.ts");
      return (await listBackups()).map((entry) => entry.id);
    });
  const beforeIds = await backupIds();
  expect(beforeIds).toHaveLength(1);

  await page.evaluate(() => {
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey
    ) {
      const candidate = value as { id?: unknown; size?: number };
      if (
        this.name === "snapshots" &&
        typeof candidate.id === "string" &&
        candidate.id.startsWith("backup-")
      ) {
        candidate.size = 3 * 1024 * 1024 * 1024;
        throw new DOMException("simulated quota", "QuotaExceededError");
      }
      return key === undefined
        ? originalPut.call(this, value)
        : originalPut.call(this, value, key);
    };
  });

  await panel.getByTestId("backup-save-now").click();
  const errorToast = page.locator(".toast.error");
  await expect(errorToast).toContainText("ストレージ容量が足りない");
  await expect(errorToast).not.toContainText("古いバックアップ1件を削除しても");
  await expect.poll(backupIds).toEqual(beforeIds);
});

test("automatically backs up only the active tab", async ({ page }) => {
  await page.goto("/");
  await createCanvas(page, { width: 48, height: 36, dpi: 144 });
  await fillCanvasWithBucket(page);

  await page.locator(".tab-add").click();
  await expect(page.locator(".tab")).toHaveCount(2);

  const backupCount = () =>
    page.evaluate(async () => {
      const { listBackups } = await import("/src/core/autoBackup.ts");
      return (await listBackups()).length;
    });

  await page.waitForTimeout(750);
  expect(await backupCount()).toBe(0);

  await page.locator(".tab").first().click();
  await expect.poll(backupCount).toBe(1);
});

test("reprotects an active unsaved tab after its recovery point is removed", async ({
  page,
}) => {
  page.on("dialog", (dialog) => dialog.accept());

  await page.goto("/");
  await createCanvas(page, { width: 48, height: 36, dpi: 144 });
  await fillCanvasWithBucket(page);

  await page.getByTestId("topbar-backup").click();
  let panel = page.getByTestId("backup-panel");
  await panel.getByTestId("backup-save-now").click();
  await panel.getByRole("button", { name: "×" }).click();

  await page.locator(".tab-add").click();
  await page.getByTestId("topbar-backup").click();
  panel = page.getByTestId("backup-panel");
  await panel.getByTestId("backup-delete-all").click();
  await panel.getByRole("button", { name: "×" }).click();

  const backupCount = () =>
    page.evaluate(async () => {
      const { listBackups } = await import("/src/core/autoBackup.ts");
      return (await listBackups()).length;
    });

  await page.waitForTimeout(750);
  expect(await backupCount()).toBe(0);

  await page.locator(".tab").first().click();
  await expect.poll(backupCount).toBe(1);
});

test("keeps a recovery point for a restored new tab after deleting the source backup", async ({
  page,
}) => {
  page.on("dialog", (dialog) => dialog.accept());

  await page.goto("/");
  await createCanvas(page, { width: 48, height: 36, dpi: 144 });

  // 手動保存の件数を検証する間だけ自動バックアップを止め、
  // ダイアログを開く直前に開始された自動保存との競合を避ける。
  await page.getByTestId("topbar-backup").click();
  let panel = page.getByTestId("backup-panel");
  await panel.getByRole("checkbox", { name: "自動バックアップを有効にする" }).uncheck();
  await panel.getByRole("button", { name: "×" }).click();

  await fillCanvasWithBucket(page);

  await page.getByTestId("topbar-backup").click();
  panel = page.getByTestId("backup-panel");
  await panel.getByTestId("backup-save-now").click();
  await panel.getByRole("button", { name: "×" }).click();

  await page.locator(".tab-add").click();
  await expect(page.locator(".tab")).toHaveCount(2);

  const backupEntries = () =>
    page.evaluate(async () => {
      const { listBackups } = await import("/src/core/autoBackup.ts");
      return (await listBackups()).map(({ id, documentId, fileName }) => ({
        id,
        documentId,
        fileName,
      }));
    });
  await expect.poll(backupEntries).toHaveLength(1);
  const [sourceBackup] = await backupEntries();

  await page.getByTestId("topbar-backup").click();
  panel = page.getByTestId("backup-panel");
  // 復元タブの復旧点は自動バックアップで作られる仕様なので、ここで戻す。
  await panel.getByRole("checkbox", { name: "自動バックアップを有効にする" }).check();
  await panel.getByTestId("backup-filter").selectOption("all");
  await panel.getByRole("button", { name: "新しいタブで開く" }).click();

  await expect(
    page.locator(".toast.success", {
      hasText: "バックアップを新しいタブで開きました",
    })
  ).toBeVisible();
  await expect(page.locator(".tab")).toHaveCount(3);
  await expect
    .poll(async () => {
      const entries = await backupEntries();
      return (
        entries.length === 2 &&
        entries.some(
          (entry) =>
            entry.documentId !== sourceBackup.documentId &&
            entry.fileName === `${sourceBackup.fileName}（復元）`
        )
      );
    })
    .toBe(true);

  const restoredBackup = (await backupEntries()).find(
    (entry) => entry.documentId !== sourceBackup.documentId
  );
  expect(restoredBackup?.documentId).toBeTruthy();

  await page.getByTestId("topbar-backup").click();
  panel = page.getByTestId("backup-panel");
  await panel.getByTestId("backup-filter").selectOption("all");
  const sourceGroup = panel.getByTestId("backup-document-group").filter({
    has: page.getByText(sourceBackup.fileName ?? "", { exact: true }),
  });
  await sourceGroup.getByRole("button", { name: "削除" }).click();

  await expect.poll(backupEntries).toEqual([
    expect.objectContaining({
      documentId: restoredBackup?.documentId,
      fileName: `${sourceBackup.fileName}（復元）`,
    }),
  ]);
});
