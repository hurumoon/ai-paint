import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

let nextDataUrl = "data:image/png;base64,brush";

class StubFileReader {
  result: string | ArrayBuffer | null = null;
  error: DOMException | null = null;
  onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
  onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;

  readAsDataURL(): void {
    this.result = nextDataUrl;
    queueMicrotask(() => this.onload?.({} as ProgressEvent<FileReader>));
  }
}

function imageFile(name: string): File {
  return { name } as File;
}

describe("custom brushes", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("localStorage", new MemoryStorage());
    vi.stubGlobal("FileReader", StubFileReader);
    nextDataUrl = "data:image/png;base64,brush";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("persists additions, updates, removals, and subscriber notifications", async () => {
    const storage = localStorage as unknown as MemoryStorage;
    const brushes = await import("../../src/core/customBrush");
    const listener = vi.fn();
    const unsubscribe = brushes.subscribeCustomBrushes(listener);

    const added = await brushes.addCustomBrush(imageFile("stamp.png"));
    brushes.updateCustomBrush(added.id, { spacingRatio: 0.5, tint: false });
    brushes.removeCustomBrush(added.id);
    unsubscribe();

    expect(added.name).toBe("stamp");
    expect(listener).toHaveBeenCalledTimes(3);
    expect(brushes.listCustomBrushes()).toEqual([]);
    expect(storage.getItem("ai-paint-custom-brushes")).toBe("[]");
  });

  it("rejects data URLs beyond the supported size", async () => {
    nextDataUrl = `data:image/png;base64,${"a".repeat(2_000_001)}`;
    const brushes = await import("../../src/core/customBrush");

    await expect(
      brushes.addCustomBrush(imageFile("too-large.png"))
    ).rejects.toThrow("画像が大きすぎます");
    expect(brushes.listCustomBrushes()).toEqual([]);
  });

  it("closes a cached bitmap when its image is replaced or removed", async () => {
    const close = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => ({ blob: async () => new Blob(["x"]) })));
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ close })));
    const brushes = await import("../../src/core/customBrush");
    const added = await brushes.addCustomBrush(imageFile("cached.png"));

    await brushes.getCustomBrushBitmap(added.id);
    brushes.updateCustomBrush(added.id, {
      dataUrl: "data:image/png;base64,replaced",
    });
    expect(close).toHaveBeenCalledOnce();

    await brushes.getCustomBrushBitmap(added.id);
    brushes.removeCustomBrush(added.id);
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("evicts the oldest brush and closes its cached bitmap at the 32-brush limit", async () => {
    let timestamp = 1000;
    vi.spyOn(Date, "now").mockImplementation(() => timestamp++);
    const close = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => ({ blob: async () => new Blob(["x"]) })));
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ close })));
    const brushes = await import("../../src/core/customBrush");

    const first = await brushes.addCustomBrush(imageFile("first.png"));
    await brushes.getCustomBrushBitmap(first.id);
    for (let index = 1; index < 33; index += 1) {
      await brushes.addCustomBrush(imageFile(`brush-${index}.png`));
    }

    expect(brushes.listCustomBrushes()).toHaveLength(32);
    expect(brushes.getCustomBrush(first.id)).toBeUndefined();
    expect(close).toHaveBeenCalledOnce();
  });
});
