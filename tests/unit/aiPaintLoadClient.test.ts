import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiPaintFileError } from "../../src/core/nativeFormatParts/errors";
import { loadAiPaintArchiveWorker } from "../../src/workers/aiPaintLoadClient";

const state = vi.hoisted(() => ({ workers: [] as FakeWorker[], throwOnPost: false }));
interface FakeWorker {
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: { message: string }) => void) | null;
  onmessageerror: (() => void) | null;
  terminate: ReturnType<typeof vi.fn>;
  postMessage: ReturnType<typeof vi.fn>;
}
vi.mock("../../src/workers/aipaintLoad.worker?worker", () => ({
  default: class implements FakeWorker {
    onmessage: FakeWorker["onmessage"] = null;
    onerror: FakeWorker["onerror"] = null;
    onmessageerror: FakeWorker["onmessageerror"] = null;
    terminate = vi.fn();
    postMessage = vi.fn(() => { if (state.throwOnPost) throw new Error("clone failed"); });
    constructor() { state.workers.push(this); }
  },
}));

beforeEach(() => { state.workers = []; state.throwOnPost = false; });

function expectDisposed(worker: FakeWorker) {
  expect(worker.terminate).toHaveBeenCalledTimes(1);
  expect(worker.onmessage).toBeNull();
  expect(worker.onerror).toBeNull();
  expect(worker.onmessageerror).toBeNull();
}

describe("aipaint load worker lifecycle", () => {
  it("passes the Blob without reading UI bytes and terminates after success", async () => {
    const blob = new Blob(["archive"]);
    const read = vi.spyOn(blob, "arrayBuffer");
    const pending = loadAiPaintArchiveWorker(blob);
    const worker = state.workers[0];
    expect(worker.postMessage).toHaveBeenCalledWith({ file: blob });
    const archive = { manifest: { version: 2 }, entries: {} };
    worker.onmessage?.({ data: { type: "success", archive } });
    expect(await pending).toBe(archive);
    expect(read).not.toHaveBeenCalled();
    expectDisposed(worker);
  });

  it("restores validation errors and disposes the worker", async () => {
    const pending = loadAiPaintArchiveWorker(new Blob());
    const worker = state.workers[0];
    worker.onmessage?.({ data: { type: "error", name: "AiPaintFileError", message: "サイズが不正です" } });
    await expect(pending).rejects.toBeInstanceOf(AiPaintFileError);
    await expect(pending).rejects.toThrow("サイズが不正です");
    expectDisposed(worker);
  });

  it.each(["error", "messageerror", "postMessage"])("rejects and disposes on %s failure", async kind => {
    state.throwOnPost = kind === "postMessage";
    const pending = loadAiPaintArchiveWorker(new Blob());
    const worker = state.workers[0];
    if (kind === "error") worker.onerror?.({ message: "worker crashed" });
    if (kind === "messageerror") worker.onmessageerror?.();
    await expect(pending).rejects.toBeInstanceOf(Error);
    expectDisposed(worker);
  });

  it("keeps simultaneous loads independent when one fails", async () => {
    const first = loadAiPaintArchiveWorker(new Blob());
    const second = loadAiPaintArchiveWorker(new Blob());
    state.workers[0].onerror?.({ message: "failed" });
    await expect(first).rejects.toThrow("failed");
    expect(state.workers[1].terminate).not.toHaveBeenCalled();
    const archive = { manifest: { version: 1 }, entries: {} };
    state.workers[1].onmessage?.({ data: { type: "success", archive } });
    expect(await second).toBe(archive);
    state.workers.forEach(expectDisposed);
  });
});
