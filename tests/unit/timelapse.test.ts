import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Timelapse } from "../../src/core/Timelapse";
import type { PaintDocument } from "../../src/core/PaintDocument";

const flattenDocumentToBlobMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/core/paintDocumentExport", () => ({
  flattenDocumentToBlob: flattenDocumentToBlobMock,
}));

function documentStub(): PaintDocument {
  return {
    width: 200,
    height: 100,
  } as unknown as PaintDocument;
}

describe("Timelapse", () => {
  let now = 0;

  beforeEach(() => {
    now = 0;
    flattenDocumentToBlobMock.mockReset();
    flattenDocumentToBlobMock.mockResolvedValue(new Blob(["frame"]));
    vi.stubGlobal("performance", { now: () => now });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not allocate a frame while capture is disabled", async () => {
    const createBitmap = vi.fn();
    vi.stubGlobal("createImageBitmap", createBitmap);
    const timelapse = new Timelapse();

    await timelapse.captureIfEnabled(documentStub());

    expect(timelapse.frameCount()).toBe(0);
    expect(createBitmap).not.toHaveBeenCalled();
  });

  it("throttles captures and closes frames evicted by the memory limit", async () => {
    const bitmaps = Array.from({ length: 3 }, (_, index) => ({
      width: 120,
      height: 60,
      close: vi.fn(),
      index,
    }));
    let bitmapIndex = 0;
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => bitmaps[bitmapIndex++])
    );
    const timelapse = new Timelapse(120, 2);
    timelapse.setEnabled(true);
    const doc = documentStub();

    now = 1000;
    await timelapse.captureIfEnabled(doc);
    now = 1100;
    await timelapse.captureIfEnabled(doc);
    now = 1300;
    await timelapse.captureIfEnabled(doc);
    now = 1600;
    await timelapse.captureIfEnabled(doc);

    expect(timelapse.frameCount()).toBe(2);
    expect(createImageBitmap).toHaveBeenCalledTimes(3);
    expect(bitmaps[0].close).toHaveBeenCalledOnce();

    timelapse.clear();
    expect(bitmaps[1].close).toHaveBeenCalledOnce();
    expect(bitmaps[2].close).toHaveBeenCalledOnce();
    expect(timelapse.frameCount()).toBe(0);
  });

  it("returns null when exporting without frames", async () => {
    await expect(new Timelapse().exportWebM()).resolves.toBeNull();
  });

  function mediaStub() {
    const drawImage = vi.fn();
    const stopTrack = vi.fn();
    const canvas = {
      width: 0, height: 0,
      getContext: () => ({ clearRect: vi.fn(), fillRect: vi.fn(), drawImage, fillStyle: "" }),
      captureStream: () => ({ getTracks: () => [{ stop: stopTrack }] }),
    } as unknown as HTMLCanvasElement;
    class Recorder {
      static isTypeSupported() { return true; }
      state = "inactive";
      onstop?: () => void;
      start() { this.state = "recording"; }
      stop() { this.state = "inactive"; this.onstop?.(); }
    }
    vi.stubGlobal("document", { createElement: () => canvas });
    vi.stubGlobal("MediaRecorder", Recorder);
    return { canvas, drawImage, stopTrack };
  }

  async function capturedFrames() {
    const bitmaps = Array.from({ length: 3 }, () => ({ width: 120, height: 60, close: vi.fn() }));
    let index = 0;
    vi.stubGlobal("createImageBitmap", vi.fn(async () => bitmaps[index++]));
    const timelapse = new Timelapse(120, 2);
    timelapse.setEnabled(true);
    for (const time of [1000, 1300]) {
      now = time;
      await timelapse.captureIfEnabled(documentStub());
    }
    return { timelapse, bitmaps };
  }

  it.each(["play", "export"])("keeps the %s snapshot alive through eviction and clear", async mode => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { canvas, drawImage, stopTrack } = mediaStub();
    const { timelapse, bitmaps } = await capturedFrames();
    const running = mode === "play" ? timelapse.play(canvas, 10) : timelapse.exportWebM(10);
    now = 1600;
    await timelapse.captureIfEnabled(documentStub());
    timelapse.clear();
    expect(timelapse.frameCount()).toBe(0);
    expect(bitmaps[0].close).not.toHaveBeenCalled();
    expect(bitmaps[1].close).not.toHaveBeenCalled();
    expect(bitmaps[2].close).toHaveBeenCalledOnce();
    await vi.runAllTimersAsync();
    await running;
    expect(drawImage.mock.calls.map(call => call[0])).toEqual(bitmaps.slice(0, 2));
    for (const bitmap of bitmaps) expect(bitmap.close).toHaveBeenCalledOnce();
    if (mode === "export") expect(stopTrack).toHaveBeenCalledOnce();
  });

  it("retains shared images until both playback and export finish", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { canvas } = mediaStub();
    const { timelapse, bitmaps } = await capturedFrames();
    const play = timelapse.play(canvas, 10);
    const exporting = timelapse.exportWebM(10);
    timelapse.clear();
    timelapse.stopPlayback();
    await vi.advanceTimersByTimeAsync(100);
    await play;
    expect(bitmaps[0].close).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    await exporting;
    expect(bitmaps[0].close).toHaveBeenCalledOnce();
    expect(bitmaps[1].close).toHaveBeenCalledOnce();
  });

  it.each(["play", "export"])("releases the %s snapshot after a drawing failure", async mode => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { canvas, drawImage, stopTrack } = mediaStub();
    const { timelapse, bitmaps } = await capturedFrames();
    const running = mode === "play" ? timelapse.play(canvas, 10) : timelapse.exportWebM(10);
    const rejected = expect(running).rejects.toThrow("draw failed");
    timelapse.clear();
    drawImage.mockImplementation(() => { throw new Error("draw failed"); });
    await vi.runAllTimersAsync();
    await rejected;
    expect(bitmaps[0].close).toHaveBeenCalledOnce();
    expect(bitmaps[1].close).toHaveBeenCalledOnce();
    if (mode === "export") expect(stopTrack).toHaveBeenCalledOnce();
  });

  it("discards a capture that was still pending when cleared", async () => {
    let resolveBitmap!: (bitmap: object) => void;
    const bitmap = { width: 120, height: 60, close: vi.fn() };
    vi.stubGlobal("createImageBitmap", () => new Promise(resolve => { resolveBitmap = resolve; }));
    const timelapse = new Timelapse();
    timelapse.setEnabled(true);
    now = 1000;
    const capture = timelapse.captureIfEnabled(documentStub());
    await Promise.resolve();
    timelapse.clear();
    resolveBitmap(bitmap);
    await capture;
    expect(timelapse.frameCount()).toBe(0);
    expect(bitmap.close).toHaveBeenCalledOnce();
  });
});
