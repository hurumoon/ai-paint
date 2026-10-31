import { describe, expect, it, vi } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  loadAiPaint,
  saveAiPaint,
  MAX_AIPAINT_DIMENSION,
  MAX_AIPAINT_FILE_BYTES,
  MAX_AIPAINT_LAYER_COUNT,
} from "../../src/core/nativeFormat";
import { PaintDocument } from "../../src/core/PaintDocument";
import { computeThumbnailSize } from "../../src/core/nativeFormatParts/save";
import type { BlendMode, LayerKind } from "../../src/types";
import { createAiPaintArchiveWriter } from "../../src/workers/aiPaintSaveClient";
import { validateSavedV2LayerPng } from "../../src/core/nativeFormatParts/validation";
import { MAX_AIPAINT_LAYER_PNG_BYTES, MAX_AIPAINT_LAYER_PNG_UNCOMPRESSED_BYTES_TOTAL } from "../../src/core/nativeFormatParts/constants";

// NodeではWorker境界だけを置き換え、実際の展開・検証を実行する。
vi.mock("../../src/workers/aiPaintLoadClient", async () => {
  const { prepareAiPaintArchive } = await import("../../src/core/nativeFormatParts/prepareLoad");
  return { loadAiPaintArchiveWorker: prepareAiPaintArchive };
});

vi.mock("../../src/workers/aiPaintSaveClient", async () => {
  const { createAiPaintArchiveBuilder } = await import("../../src/core/nativeFormatParts/saveArchive");
  return {
    createAiPaintArchiveWriter: vi.fn(() => {
      const builder = createAiPaintArchiveBuilder();
      return {
        add: vi.fn(async (name: string, bytes: Uint8Array) => builder.add(name, bytes)),
        finish: vi.fn(async () => builder.finish()),
        dispose: vi.fn(() => builder.dispose()),
      };
    }),
  };
});

function manifestBlob(manifest: unknown): Blob {
  return zipBlob({
    "manifest.json": strToU8(JSON.stringify(manifest)),
  });
}

function zipBlob(files: Record<string, Uint8Array>): Blob {
  const zipped = zipSync({
    ...files,
  });
  return new Blob([zipped], { type: "application/x-aipaint" });
}

function baseManifest(overrides: Record<string, unknown> = {}) {
  return {
    magic: "aipaint-v1",
    version: 1,
    width: 100,
    height: 100,
    dpi: 96,
    activeLayerId: "layer-1",
    layers: [
      {
        id: "layer-1",
        name: "レイヤー1",
        visible: true,
        opacity: 1,
        blendMode: "normal",
        locked: false,
        kind: "raster",
        file: "layer-001.png",
      },
    ],
    ...overrides,
  };
}

function baseManifestV2(overrides: Record<string, unknown> = {}) {
  return {
    magic: "aipaint-v2",
    version: 2,
    width: 100,
    height: 100,
    dpi: 96,
    activeLayerId: "layer-1",
    layers: [
      {
        id: "layer-1",
        name: "レイヤー1",
        visible: true,
        opacity: 1,
        blendMode: "normal",
        locked: false,
        kind: "raster",
        bounds: { x: 0, y: 0, width: 10, height: 10 },
        file: "layers/layer-000001.png",
      },
    ],
    ...overrides,
  };
}

function fakeLayer(
  overrides: Partial<{
    id: string;
    name: string;
    kind: LayerKind;
    parentId: string;
    opacity: number;
    blendMode: BlendMode;
    transparentPixelLock: boolean;
  }> = {}
) {
  return {
    meta: {
      id: overrides.id ?? "layer-1",
      name: overrides.name ?? "レイヤー1",
      visible: true,
      opacity: overrides.opacity ?? 1,
      blendMode: overrides.blendMode ?? "normal",
      locked: false,
      transparentPixelLock: overrides.transparentPixelLock,
      kind: overrides.kind ?? "raster",
      parentId: overrides.parentId,
    },
    store: {
      getAlphaBounds: () => null,
    },
  };
}

function fakeDoc(overrides: Partial<PaintDocument> = {}): PaintDocument {
  return {
    width: 100,
    height: 100,
    dpi: 96,
    activeLayerId: "layer-1",
    layers: [fakeLayer()],
    ...overrides,
  } as unknown as PaintDocument;
}

describe("nativeFormat load limits", () => {
  it("rejects oversized .aipaint files before reading their bytes", async () => {
    const file = {
      size: MAX_AIPAINT_FILE_BYTES + 1,
      arrayBuffer: () => {
        throw new Error("should not read oversized files");
      },
    } as unknown as Blob;

    await expect(loadAiPaint(file, {} as PaintDocument)).rejects.toThrow(
      ".aipaint ファイルが大きすぎます"
    );
  });

  it("rejects .aipaint manifests with oversized canvas dimensions", async () => {
    const file = manifestBlob(baseManifest({
      width: MAX_AIPAINT_DIMENSION + 1,
    }));

    await expect(loadAiPaint(file, {} as PaintDocument)).rejects.toThrow(
      ".aipaint のサイズが大きすぎます"
    );
  });

  it("rejects unsafe layer file paths", async () => {
    const file = manifestBlob(baseManifest({
      layers: [
        {
          id: "layer-1",
          name: "レイヤー1",
          visible: true,
          opacity: 1,
          blendMode: "normal",
          locked: false,
          kind: "raster",
          file: "../manifest.json",
        },
      ],
    }));

    await expect(loadAiPaint(file, {} as PaintDocument)).rejects.toThrow(
      "レイヤー 1 のファイル名が不正です"
    );
  });

  it("rejects missing referenced layer files", async () => {
    const file = manifestBlob(baseManifest());

    await expect(loadAiPaint(file, {} as PaintDocument)).rejects.toThrow(
      "レイヤーファイルが見つかりません: layers/layer-001.png"
    );
  });

  it("rejects manifests without drawable layers", async () => {
    const file = manifestBlob(baseManifest({
      activeLayerId: "group-1",
      layers: [
        {
          id: "group-1",
          name: "フォルダ",
          visible: true,
          opacity: 1,
          blendMode: "normal",
          locked: false,
          kind: "group",
          file: "group.png",
        },
      ],
    }));

    await expect(loadAiPaint(file, {} as PaintDocument)).rejects.toThrow(
      "描画レイヤーがありません"
    );
  });

  it("rejects excessive layer counts", async () => {
    const layers = Array.from({ length: MAX_AIPAINT_LAYER_COUNT + 1 }, (_, i) => ({
      id: `layer-${i}`,
      name: `レイヤー${i}`,
      visible: true,
      opacity: 1,
      blendMode: "normal",
      locked: false,
      kind: "raster",
      file: `layer-${i}.png`,
    }));
    const file = manifestBlob(baseManifest({
      activeLayerId: "layer-0",
      layers,
    }));

    await expect(loadAiPaint(file, {} as PaintDocument)).rejects.toThrow(
      "レイヤー数が多すぎます"
    );
  });

  it("rejects v2 files with invalid layer paths", async () => {
    const file = manifestBlob(baseManifestV2({
      layers: [
        {
          id: "layer-1",
          name: "レイヤー1",
          visible: true,
          opacity: 1,
          blendMode: "normal",
          locked: false,
          kind: "raster",
          bounds: { x: 0, y: 0, width: 10, height: 10 },
          file: "layer-000001.png",
        },
      ],
    }));

    await expect(loadAiPaint(file, {} as PaintDocument)).rejects.toThrow(
      "レイヤー 1 のファイル名が不正です"
    );
  });

  it("rejects v2 groups that carry image fields", async () => {
    const file = manifestBlob(baseManifestV2({
      activeLayerId: "group-1",
      layers: [
        {
          id: "group-1",
          name: "フォルダ",
          visible: true,
          opacity: 1,
          blendMode: "normal",
          locked: false,
          kind: "group",
          file: "layers/layer-000001.png",
        },
      ],
    }));

    await expect(loadAiPaint(file, {} as PaintDocument)).rejects.toThrow(
      "グループ 1 に画像情報は指定できません"
    );
  });

  it("rejects v2 layers with invalid transparent pixel lock state", async () => {
    const file = manifestBlob(baseManifestV2({
      layers: [
        {
          id: "layer-1",
          name: "レイヤー1",
          visible: true,
          opacity: 1,
          blendMode: "normal",
          locked: false,
          transparentPixelLock: "yes",
          kind: "raster",
          empty: true,
        },
      ],
    }));

    await expect(loadAiPaint(file, {} as PaintDocument)).rejects.toThrow(
      "レイヤー 1 の透明ピクセルロック状態"
    );
  });

  it("rejects v2 parent ids that do not reference groups", async () => {
    const file = manifestBlob(baseManifestV2({
      activeLayerId: "layer-2",
      layers: [
        {
          id: "layer-1",
          name: "親ではないレイヤー",
          visible: true,
          opacity: 1,
          blendMode: "normal",
          locked: false,
          kind: "raster",
          empty: true,
        },
        {
          id: "layer-2",
          name: "子",
          visible: true,
          opacity: 1,
          blendMode: "normal",
          locked: false,
          kind: "raster",
          parentId: "layer-1",
          empty: true,
        },
      ],
    }));

    await expect(loadAiPaint(file, {} as PaintDocument)).rejects.toThrow(
      "レイヤー layer-2 の親IDが不正です"
    );
  });

  it("rejects v2 bounds outside the document", async () => {
    const file = manifestBlob(baseManifestV2({
      layers: [
        {
          id: "layer-1",
          name: "レイヤー1",
          visible: true,
          opacity: 1,
          blendMode: "normal",
          locked: false,
          kind: "raster",
          bounds: { x: 95, y: 0, width: 10, height: 10 },
          file: "layers/layer-000001.png",
        },
      ],
    }));

    await expect(loadAiPaint(file, {} as PaintDocument)).rejects.toThrow(
      "レイヤー 1 のboundsがキャンバス外です"
    );
  });

  it("rejects v2 manifests that exceed the decoded RGBA budget", async () => {
    const layers = Array.from({ length: 3 }, (_, i) => ({
      id: `layer-${i}`,
      name: `レイヤー${i}`,
      visible: true,
      opacity: 1,
      blendMode: "normal",
      locked: false,
      kind: "raster",
      bounds: { x: 0, y: 0, width: 16384, height: 16384 },
      file: `layers/layer-${(i + 1).toString().padStart(6, "0")}.png`,
    }));
    const file = manifestBlob(baseManifestV2({
      width: 16384,
      height: 16384,
      activeLayerId: "layer-0",
      layers,
    }));

    await expect(loadAiPaint(file, {} as PaintDocument)).rejects.toThrow(
      ".aipaint のRGBAデコード後サイズが大きすぎます"
    );
  });

  it("rejects v2 referenced PNGs before decode when the signature is invalid", async () => {
    const file = zipBlob({
      "manifest.json": strToU8(JSON.stringify(baseManifestV2())),
      "layers/layer-000001.png": new Uint8Array([1, 2, 3, 4]),
    });

    await expect(loadAiPaint(file, {} as PaintDocument)).rejects.toThrow(
      "PNGヘッダが不正です: layers/layer-000001.png"
    );
  });

  it("saves v2 manifests for empty raster layers", async () => {
    const blob = await saveAiPaint(fakeDoc({
      layers: [fakeLayer({ transparentPixelLock: true })],
    }));
    const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    const manifest = JSON.parse(strFromU8(entries["manifest.json"]));

    expect(manifest.magic).toBe("aipaint-v2");
    expect(manifest.version).toBe(2);
    expect(manifest.layers).toHaveLength(1);
    expect(manifest.layers[0]).toMatchObject({
      id: "layer-1",
      kind: "raster",
      empty: true,
      transparentPixelLock: true,
    });
    expect(entries["layers/layer-000001.png"]).toBeUndefined();
  });

  it("preserves PNG bytes in stored ZIP entries alongside compressed metadata", async () => {
    const png = Uint8Array.from(Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1cAAAAASUVORK5CYII=",
      "base64"
    ));
    const layer = {
      ...fakeLayer(),
      store: {
        getAlphaBounds: () => ({ x: 0, y: 0, w: 1, h: 1 }),
        toPngBytes: async () => png,
      },
    };
    const blob = await saveAiPaint(fakeDoc({
      layers: [layer] as unknown as PaintDocument["layers"],
    }));
    const methods: Record<string, number> = {};
    const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()), {
      filter: (entry) => {
        methods[entry.name] = entry.compression;
        return true;
      },
    });

    expect(entries["layers/layer-000001.png"]).toEqual(png);
    expect(methods["layers/layer-000001.png"]).toBe(0);
    expect(methods["manifest.json"]).toBe(8);
    expect(JSON.parse(strFromU8(entries["manifest.json"])).layers[0]).toMatchObject({
      file: "layers/layer-000001.png",
      bounds: { x: 0, y: 0, width: 1, height: 1 },
    });
  });

  it("saves layer graphs in normalized contiguous hierarchy order", async () => {
    const childA = fakeLayer({ id: "child-a", parentId: "group" });
    const group = fakeLayer({ id: "group", kind: "group" });
    const top = fakeLayer({ id: "top" });
    const childB = fakeLayer({ id: "child-b", parentId: "group" });
    const blob = await saveAiPaint(fakeDoc({
      activeLayerId: "child-a",
      layers: [childA, group, top, childB],
    }));
    const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    const manifest = JSON.parse(strFromU8(entries["manifest.json"]));

    expect(manifest.layers.map((layer: { id: string }) => layer.id)).toEqual([
      "group",
      "child-a",
      "child-b",
      "top",
    ]);
  });

  it("sizes v2 thumbnails with a lower scale for higher resolution documents", () => {
    expect(computeThumbnailSize(1024, 512)).toEqual({ width: 1024, height: 512 });
    expect(computeThumbnailSize(2000, 1000)).toEqual({ width: 2000, height: 1000 });
    expect(computeThumbnailSize(4096, 2048)).toEqual({ width: 2048, height: 1024 });
    expect(computeThumbnailSize(8000, 4000)).toEqual({ width: 2048, height: 1024 });
    expect(computeThumbnailSize(1200, 3600)).toEqual({ width: 683, height: 2048 });
  });

  it("loads valid v2 manifests with empty raster layers", async () => {
    const doc = new PaintDocument(100, 100, 1);
    const file = manifestBlob(baseManifestV2({
      layers: [
        {
          id: "layer-1",
          name: "レイヤー1",
          visible: true,
          opacity: 1,
          blendMode: "normal",
          locked: false,
          transparentPixelLock: true,
          kind: "raster",
          empty: true,
        },
      ],
    }));

    await loadAiPaint(file, doc);

    expect(doc.width).toBe(100);
    expect(doc.height).toBe(100);
    expect(doc.activeLayerId).toBe("layer-1");
    expect(doc.layers[0].meta.kind).toBe("raster");
    expect(doc.layers[0].meta.transparentPixelLock).toBe(true);
  });

  it("normalizes valid v2 layer graphs into contiguous hierarchy blocks", async () => {
    const doc = new PaintDocument(100, 100, 1);
    const raster = (id: string, parentId?: string) => ({
      id,
      name: id,
      visible: true,
      opacity: 1,
      blendMode: "normal",
      locked: false,
      kind: "raster",
      parentId,
      empty: true,
    });
    const group = {
      id: "group",
      name: "フォルダ",
      visible: true,
      opacity: 1,
      blendMode: "normal",
      locked: false,
      kind: "group",
    };
    const file = manifestBlob(baseManifestV2({
      activeLayerId: "child-a",
      layers: [
        raster("child-a", "group"),
        group,
        raster("top"),
        raster("child-b", "group"),
      ],
    }));

    await loadAiPaint(file, doc);

    expect(doc.layers.map((layer) => layer.meta.id)).toEqual([
      "group",
      "child-a",
      "child-b",
      "top",
    ]);
    expect(doc.activeLayerId).toBe("child-a");
  });

  it("rejects saving v2 documents with invalid active layer ids", async () => {
    await expect(saveAiPaint(fakeDoc({ activeLayerId: "missing" }))).rejects.toThrow(
      "アクティブレイヤーIDが存在しません"
    );
    const writer = vi.mocked(createAiPaintArchiveWriter).mock.results.at(-1)!.value;
    expect(writer.finish).not.toHaveBeenCalled();
    expect(writer.dispose).toHaveBeenCalledOnce();
  });

  it("rejects an invalid PNG before generating the next layer and disposes the archive", async () => {
    const nextPng = vi.fn();
    const layers = [
      { ...fakeLayer(), store: {
        getAlphaBounds: () => ({ x: 0, y: 0, w: 1, h: 1 }),
        toPngBytes: async () => new Uint8Array([1, 2, 3]),
      } },
      { ...fakeLayer({ id: "layer-2" }), store: {
        getAlphaBounds: () => ({ x: 0, y: 0, w: 1, h: 1 }),
        toPngBytes: nextPng,
      } },
    ];
    await expect(saveAiPaint(fakeDoc({ layers: layers as unknown as PaintDocument["layers"] })))
      .rejects.toThrow("PNGヘッダが不正です");
    expect(nextPng).not.toHaveBeenCalled();
    const writer = vi.mocked(createAiPaintArchiveWriter).mock.results.at(-1)!.value;
    expect(writer.add).not.toHaveBeenCalled();
    expect(writer.finish).not.toHaveBeenCalled();
    expect(writer.dispose).toHaveBeenCalledOnce();
  });

  it("waits for the archive to consume each PNG before generating the next", async () => {
    const png = Uint8Array.from(Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1cAAAAASUVORK5CYII=",
      "base64"
    ));
    const writer = createAiPaintArchiveWriter();
    const add = writer.add;
    let release!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const firstEntry = new Promise<void>(resolve => { entered = resolve; });
    writer.add = vi.fn(async (name, bytes) => {
      if (name === "layers/layer-000001.png") {
        entered();
        await blocked;
      }
      await add(name, bytes);
    });
    vi.mocked(createAiPaintArchiveWriter).mockReturnValueOnce(writer);
    const nextPng = vi.fn(async () => png.slice());
    const layers = [
      { ...fakeLayer(), store: {
        getAlphaBounds: () => ({ x: 0, y: 0, w: 1, h: 1 }),
        toPngBytes: async () => png.slice(),
      } },
      { ...fakeLayer({ id: "layer-2" }), store: {
        getAlphaBounds: () => ({ x: 0, y: 0, w: 1, h: 1 }),
        toPngBytes: nextPng,
      } },
    ];
    const saving = saveAiPaint(fakeDoc({ layers: layers as unknown as PaintDocument["layers"] }));
    await firstEntry;
    try {
      expect(nextPng).not.toHaveBeenCalled();
    } finally {
      release();
    }
    const blob = await saving;
    const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    expect(nextPng).toHaveBeenCalledOnce();
    expect(entries["layers/layer-000001.png"]).toEqual(png);
    expect(entries["layers/layer-000002.png"]).toEqual(png);
    expect(writer.dispose).toHaveBeenCalledOnce();
  });

  it("enforces per-layer and cumulative PNG limits before inspecting or retaining pixels", () => {
    const layer = {
      ...fakeLayer().meta,
      kind: "raster" as const,
      file: "layers/layer-000001.png",
      bounds: { x: 0, y: 0, width: 1, height: 1 },
    };
    // 巨大な実配列を確保せず、ヘッダ参照より前の上限判定を検証する。
    const oversized = { byteLength: MAX_AIPAINT_LAYER_PNG_BYTES + 1 } as Uint8Array;
    expect(() => validateSavedV2LayerPng(layer, oversized, 0)).toThrow("レイヤーファイルが大きすぎます");
    expect(() => validateSavedV2LayerPng(layer, new Uint8Array(1), MAX_AIPAINT_LAYER_PNG_UNCOMPRESSED_BYTES_TOTAL))
      .toThrow("参照PNG合計サイズが大きすぎます");
  });
});
