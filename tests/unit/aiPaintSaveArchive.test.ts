import { unzipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import { createAiPaintArchiveBuilder } from "../../src/core/nativeFormatParts/saveArchive";

async function unpack(blob: Blob): Promise<Record<string, Uint8Array>> {
  return unzipSync(new Uint8Array(await blob.arrayBuffer()));
}

describe("aipaint streaming archive builder", () => {
  it("writes PNG pass-through and JSON deflate entries without a final Uint8Array", async () => {
    const builder = createAiPaintArchiveBuilder();
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
    const manifest = new TextEncoder().encode(JSON.stringify({ version: 2 }));
    builder.add("layers/layer-000001.png", png);
    builder.add("manifest.json", manifest);

    const blob = builder.finish();
    expect(blob.type).toBe("application/x-aipaint");
    const files = await unpack(blob);
    expect(files["layers/layer-000001.png"]).toEqual(png);
    expect(new TextDecoder().decode(files["manifest.json"])).toBe('{"version":2}');
  });

  it("rejects use after disposal without retaining archive parts", () => {
    const builder = createAiPaintArchiveBuilder();
    builder.dispose();
    expect(() => builder.add("manifest.json", new Uint8Array())).toThrow("すでに完了");
    expect(() => builder.finish()).toThrow("すでに完了");
  });

  it("does not allocate an archive-sized buffer when adding or finishing multiple chunks", async () => {
    const chunkLimit = 1024 * 1024;
    const png = new Uint8Array(3 * chunkLimit + 17);
    for (let i = 0; i < png.length; i++) png[i] = i & 255;
    const NativeBlob = Blob;
    const NativeArrayBuffer = ArrayBuffer;
    const NativeUint8Array = Uint8Array;
    // 入力生成と検証用の展開は計測外。保存中の全量コピーだけを検出する。
    for (const [name, constructor] of [
      ["ArrayBuffer", NativeArrayBuffer],
      ["Uint8Array", NativeUint8Array],
    ] as const) {
      vi.stubGlobal(name, new Proxy(constructor, {
        construct(target, args) {
          const input = args[0];
          const allocationSize = typeof input === "number" ? input
            : input instanceof NativeUint8Array ? input.byteLength : 0;
          expect(allocationSize).toBeLessThanOrEqual(chunkLimit);
          return Reflect.construct(target, args);
        },
      }));
    }
    vi.stubGlobal("Blob", class extends NativeBlob {
      constructor(parts: BlobPart[] = [], options?: BlobPropertyBag) {
        for (const part of parts) {
          if (part instanceof NativeArrayBuffer || NativeArrayBuffer.isView(part)) {
            expect(part.byteLength).toBeLessThanOrEqual(chunkLimit);
          }
        }
        super(parts, options);
      }
    });
    const builder = createAiPaintArchiveBuilder();
    let blob: Blob;
    try {
      builder.add("layers/layer-000001.png", png);
      builder.add("manifest.json", new TextEncoder().encode('{"version":2}'));
      blob = builder.finish();
    } finally {
      builder.dispose();
      vi.unstubAllGlobals();
    }
    expect(blob.size).toBeGreaterThan(png.byteLength);
    const restored = (await unpack(blob))["layers/layer-000001.png"];
    expect(restored.byteLength).toBe(png.byteLength);
    expect(restored.every((value, index) => value === png[index])).toBe(true);
  });
});
