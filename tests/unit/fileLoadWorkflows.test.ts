import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadDirectImageForEditing,
  loadFileIntoApp,
} from "../../src/hooks/fileActions/fileLoadWorkflows";
import { MAX_RASTER_IMAGE_DIMENSION } from "../../src/core/rasterImageLimits";
import type { TabStore } from "../../src/hooks/useTabs";

function fileNamed(name: string): File {
  return Object.assign(new Blob(["image"], { type: "image/png" }), { name }) as File;
}

describe("file load workflows", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects oversized normal image loads before creating a tab", async () => {
    const close = vi.fn();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({
        width: MAX_RASTER_IMAGE_DIMENSION + 1,
        height: 100,
        close,
      }) as unknown as ImageBitmap)
    );
    const stashAndAddTab = vi.fn();
    const tabStore = { closeTab: vi.fn() } as unknown as TabStore;

    await expect(
      loadFileIntoApp({
        activeTab: null,
        file: fileNamed("large.png"),
        tabStore,
        stashAndAddTab,
      })
    ).rejects.toThrow("画像読み込み失敗: 画像のサイズが大きすぎます");
    expect(stashAndAddTab).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("rejects oversized direct-edit image loads before creating a tab", async () => {
    const close = vi.fn();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({
        width: 100,
        height: MAX_RASTER_IMAGE_DIMENSION + 1,
        close,
      }) as unknown as ImageBitmap)
    );
    const stashAndAddTab = vi.fn();
    const tabStore = { closeTab: vi.fn() } as unknown as TabStore;

    await expect(
      loadDirectImageForEditing({
        file: fileNamed("large.png"),
        tabStore,
        stashAndAddTab,
      })
    ).rejects.toThrow("画像読み込み失敗: 画像のサイズが大きすぎます");
    expect(stashAndAddTab).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
