import { beforeEach, describe, expect, it, vi } from "vitest";
import { decodeLayerPixels, readPsd } from "ag-psd";
import {
  loadPsd,
  MAX_PSD_DECODED_IMAGE_BYTES,
  MAX_PSD_DIMENSION,
  MAX_PSD_FILE_BYTES,
  MAX_PSD_LAYER_COUNT,
  preflightPsdOpen,
} from "../../src/core/psdFormat";
import type { PaintDocument } from "../../src/core/PaintDocument";
import type { Layer, Psd } from "ag-psd";

vi.mock("ag-psd", () => ({
  decodeLayerPixels: vi.fn(),
  readPsd: vi.fn(),
  writePsd: vi.fn(),
}));

function makePsdHeader(
  width: number,
  height: number,
  bitsPerChannel = 8
): Uint8Array<ArrayBuffer> {
  const buffer = new ArrayBuffer(26);
  const bytes = new Uint8Array(buffer);
  bytes.set([0x38, 0x42, 0x50, 0x53]);
  const view = new DataView(buffer);
  view.setUint16(4, 1, false);
  view.setUint16(12, 4, false);
  view.setUint32(14, height, false);
  view.setUint32(18, width, false);
  view.setUint16(22, bitsPerChannel, false);
  view.setUint16(24, 3, false);
  return bytes;
}

function metadataPsd(children: Layer[], bitsPerChannel = 8): Psd {
  return {
    width: 100,
    height: 100,
    bitsPerChannel,
    children,
  };
}

describe("PSD load limits", () => {
  beforeEach(() => {
    vi.mocked(decodeLayerPixels).mockReset();
    vi.mocked(readPsd).mockReset();
  });

  it("can preflight native size and header bytes without constructing a Blob", () => {
    const header = makePsdHeader(320, 240);

    expect(preflightPsdOpen(header.byteLength, header)).toEqual({
      width: 320,
      height: 240,
      bitsPerChannel: 8,
    });
    expect(() =>
      preflightPsdOpen(MAX_PSD_FILE_BYTES + 1, new Uint8Array())
    ).toThrow("PSD ファイルが大きすぎます");
  });

  it("rejects oversized PSD files before reading their header or body", async () => {
    const slice = vi.fn();
    const arrayBuffer = vi.fn();
    const file = {
      size: MAX_PSD_FILE_BYTES + 1,
      slice,
      arrayBuffer,
    } as unknown as Blob;

    await expect(loadPsd(file, {} as PaintDocument)).rejects.toThrow(
      "PSD ファイルが大きすぎます"
    );
    expect(slice).not.toHaveBeenCalled();
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(readPsd).not.toHaveBeenCalled();
  });

  it("rejects oversized PSD dimensions from the header before reading the full file", async () => {
    const header = makePsdHeader(MAX_PSD_DIMENSION + 1, 100);
    const arrayBuffer = vi.fn();
    const file = {
      size: header.byteLength,
      slice: () => new Blob([header]),
      arrayBuffer,
    } as unknown as Blob;

    await expect(loadPsd(file, {} as PaintDocument)).rejects.toThrow(
      "PSD のサイズが大きすぎます"
    );
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(readPsd).not.toHaveBeenCalled();
  });

  it("rejects excessive layer counts during metadata preflight before image decode", async () => {
    const header = makePsdHeader(100, 100);
    const layers = Array.from({ length: MAX_PSD_LAYER_COUNT + 1 }, (_, index) => ({
      name: `レイヤー${index}`,
      left: 0,
      top: 0,
      right: 1,
      bottom: 1,
    }));
    vi.mocked(readPsd).mockReturnValue(metadataPsd(layers));

    await expect(
      loadPsd(new Blob([header]), {} as PaintDocument)
    ).rejects.toThrow("PSD のレイヤー数が多すぎます");
    expect(readPsd).toHaveBeenCalledTimes(1);
    expect(vi.mocked(readPsd).mock.calls[0]?.[1]).toMatchObject({
      skipLayerImageData: true,
      skipCompositeImageData: true,
    });
    expect(decodeLayerPixels).not.toHaveBeenCalled();
  });

  it("rejects decoded image budgets during metadata preflight before image decode", async () => {
    const header = makePsdHeader(100, 100);
    const layerBytes = MAX_PSD_DIMENSION * MAX_PSD_DIMENSION * 4;
    const layerCount = Math.floor(MAX_PSD_DECODED_IMAGE_BYTES / layerBytes) + 1;
    const layers = Array.from({ length: layerCount }, (_, index) => ({
      name: `巨大レイヤー${index}`,
      left: 0,
      top: 0,
      right: MAX_PSD_DIMENSION,
      bottom: MAX_PSD_DIMENSION,
    }));
    vi.mocked(readPsd).mockReturnValue(metadataPsd(layers));

    await expect(
      loadPsd(new Blob([header]), {} as PaintDocument)
    ).rejects.toThrow("PSD の画像デコード後サイズが大きすぎます");
    expect(readPsd).toHaveBeenCalledTimes(1);
    expect(decodeLayerPixels).not.toHaveBeenCalled();
  });

  it("treats an empty children array as a folder during metadata preflight", async () => {
    const header = makePsdHeader(100, 100);
    vi.mocked(readPsd).mockReturnValue(metadataPsd([
      {
        name: "空フォルダ",
        children: [],
      },
    ]));

    await expect(
      loadPsd(new Blob([header]), {} as PaintDocument)
    ).rejects.toThrow("描画レイヤーが無く、フォルダだけの PSD は読み込めません");
    expect(readPsd).toHaveBeenCalledTimes(1);
    expect(decodeLayerPixels).not.toHaveBeenCalled();
  });

  it("does not count group bounds toward the decoded raster image budget", async () => {
    const header = makePsdHeader(100, 100);
    const raster: Layer = {
      name: "マスク付きラスターレイヤー",
      left: 0,
      top: 0,
      right: 1,
      bottom: 1,
      mask: {
        left: 0,
        top: 0,
        right: MAX_PSD_DIMENSION + 1,
        bottom: 1,
        defaultColor: 0,
      },
    };
    const nestedGroups = ["外側", "中央", "内側"].reduceRight<Layer>(
      (child, name) => ({
        name: `${name}フォルダ`,
        left: 0,
        top: 0,
        right: MAX_PSD_DIMENSION,
        bottom: MAX_PSD_DIMENSION,
        children: [child],
      }),
      raster
    );
    vi.mocked(readPsd).mockReturnValue(metadataPsd([nestedGroups]));

    await expect(
      loadPsd(new Blob([header]), {} as PaintDocument)
    ).rejects.toThrow(
      "PSD レイヤー マスク付きラスターレイヤーのマスクのサイズが大きすぎます"
    );
    expect(readPsd).toHaveBeenCalledTimes(1);
    expect(decodeLayerPixels).not.toHaveBeenCalled();
  });

  it("validates masks only for layers that will be decoded", async () => {
    const header = makePsdHeader(100, 100);
    vi.mocked(readPsd).mockReturnValue(metadataPsd([
      {
        name: "マスク付きフォルダ",
        children: [
          {
            name: "マスク付きラスターレイヤー",
            left: 0,
            top: 0,
            right: 1,
            bottom: 1,
            mask: {
              left: 0,
              top: 0,
              right: MAX_PSD_DIMENSION + 1,
              bottom: 1,
              defaultColor: 0,
            },
          },
        ],
        mask: {
          left: 0,
          top: 0,
          right: MAX_PSD_DIMENSION + 2,
          bottom: 1,
          defaultColor: 0,
        },
      },
    ]));

    await expect(
      loadPsd(new Blob([header]), {} as PaintDocument)
    ).rejects.toThrow(
      "PSD レイヤー マスク付きラスターレイヤーのマスクのサイズが大きすぎます"
    );
    expect(readPsd).toHaveBeenCalledTimes(1);
    expect(decodeLayerPixels).not.toHaveBeenCalled();
  });

  it("rejects oversized layer masks during metadata preflight before image decode", async () => {
    const header = makePsdHeader(100, 100);
    vi.mocked(readPsd).mockReturnValue(metadataPsd([
      {
        name: "マスク付きレイヤー",
        left: 0,
        top: 0,
        right: 1,
        bottom: 1,
        mask: {
          left: 0,
          top: 0,
          right: MAX_PSD_DIMENSION + 1,
          bottom: 1,
          defaultColor: 0,
        },
      },
    ]));

    await expect(
      loadPsd(new Blob([header]), {} as PaintDocument)
    ).rejects.toThrow("PSD レイヤー マスク付きレイヤーのマスクのサイズが大きすぎます");
    expect(readPsd).toHaveBeenCalledTimes(1);
    expect(decodeLayerPixels).not.toHaveBeenCalled();
  });
});
