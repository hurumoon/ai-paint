import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveTabDocument } from "../../src/hooks/fileActions/fileSaveWorkflow";
import { TabStore, tabHasUnsavedChanges } from "../../src/hooks/useTabs";
import { buildSaveBlob } from "../../src/core/fileFormats";

vi.mock("../../src/core/fileFormats", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/core/fileFormats")>();
  return {
    ...actual,
    buildSaveBlob: vi.fn(async () => new Blob(["saved"])),
    formatBytes: vi.fn(() => "5 B"),
  };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("file save workflow", () => {
  beforeEach(() => {
    vi.mocked(buildSaveBlob).mockResolvedValue(new Blob(["saved"]));
  });

  it("does not update tab metadata when the writer is cancelled", async () => {
    const tabStore = new TabStore(1024 * 1024);
    const tab = tabStore.addBlankTab(1, 1);

    await expect(
      saveTabDocument({
        targetTab: tab,
        tabStore,
        format: "aipaint",
        write: vi.fn(async () => null),
      })
    ).resolves.toBeNull();

    expect(tab.fileName).toBeNull();
    expect(tab.filePath).toBeNull();
  });

  it("keeps the original target tab when the active tab changes during writing", async () => {
    const tabStore = new TabStore(1024 * 1024);
    const target = tabStore.addBlankTab(1, 1);
    const writeGate = deferred<{ fileName: string; path: string }>();
    const save = saveTabDocument({
      targetTab: target,
      tabStore,
      format: "aipaint",
      write: () => writeGate.promise,
    });

    const other = tabStore.addBlankTab(1, 1);
    writeGate.resolve({ fileName: "target.aipaint", path: "C:\\target.aipaint" });
    await save;

    expect(target.fileName).toBe("target.aipaint");
    expect(target.filePath).toBe("C:\\target.aipaint");
    expect(other.fileName).toBeNull();
  });

  it("leaves the tab dirty when its document changes during writing", async () => {
    const tabStore = new TabStore(1024 * 1024);
    const tab = tabStore.addBlankTab(1, 1);
    const writeGate = deferred<{ fileName: string; path: undefined }>();
    const save = saveTabDocument({
      targetTab: tab,
      tabStore,
      format: "aipaint",
      write: () => writeGate.promise,
    });

    tab.doc.invalidate();
    writeGate.resolve({ fileName: "work.aipaint", path: undefined });
    const result = await save;

    expect(result?.hasUnsavedChangesAfterSave).toBe(true);
    expect(tabHasUnsavedChanges(tab)).toBe(true);
    expect(tab.fileName).toBe("work.aipaint");
  });

  it("does not update metadata when serialization fails", async () => {
    const tabStore = new TabStore(1024 * 1024);
    const tab = tabStore.addBlankTab(1, 1);
    vi.mocked(buildSaveBlob).mockRejectedValueOnce(new Error("serialize failed"));
    const writer = vi.fn();

    await expect(
      saveTabDocument({
        targetTab: tab,
        tabStore,
        format: "aipaint",
        write: writer,
      })
    ).rejects.toThrow("serialize failed");

    expect(writer).not.toHaveBeenCalled();
    expect(tab.fileName).toBeNull();
  });
});
