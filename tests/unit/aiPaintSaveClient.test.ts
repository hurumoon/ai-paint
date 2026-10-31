import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiPaintFileError } from "../../src/core/nativeFormatParts/errors";
import { createAiPaintArchiveWriter } from "../../src/workers/aiPaintSaveClient";

const state = vi.hoisted(() => ({ workers: [] as FakeWorker[], throwOnPost: false }));

interface FakeWorker {
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: { message: string }) => void) | null;
  onmessageerror: (() => void) | null;
  terminate: ReturnType<typeof vi.fn>;
  postMessage: ReturnType<typeof vi.fn>;
}

vi.mock("../../src/workers/aipaintSave.worker?worker", () => ({
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

function addResponse(worker: FakeWorker, id: number) {
  worker.onmessage?.({ data: { type: "added", id } });
}

describe("aipaint save worker client", () => {
  it("transfers a dedicated buffer and waits for each add acknowledgement", async () => {
    const writer = createAiPaintArchiveWriter();
    const worker = state.workers[0];
    const first = Uint8Array.from([1, 2]);
    const second = Uint8Array.from([3]);
    const firstAdd = writer.add("layers/layer-000001.png", first);
    const secondAdd = writer.add("manifest.json", second);
    await Promise.resolve();

    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    expect(worker.postMessage).toHaveBeenLastCalledWith(
      { type: "add", id: 1, name: "layers/layer-000001.png", bytes: first.buffer },
      [first.buffer],
    );
    addResponse(worker, 1);
    await firstAdd;
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(2));
    expect(worker.postMessage).toHaveBeenLastCalledWith(
      { type: "add", id: 2, name: "manifest.json", bytes: second.buffer },
      [second.buffer],
    );
    addResponse(worker, 2);
    await secondAdd;

    const done = writer.finish();
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(3));
    expect(worker.postMessage).toHaveBeenLastCalledWith({ type: "finish", id: 3 }, []);
    const blob = new Blob(["archive"]);
    worker.onmessage?.({ data: { type: "success", id: 3, blob } });
    expect(await done).toBe(blob);
    expectDisposed(worker);
  });

  it("preserves worker validation errors and terminates", async () => {
    const writer = createAiPaintArchiveWriter();
    const worker = state.workers[0];
    const pending = writer.add("layers/layer-000001.png", Uint8Array.from([1]));
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(1));
    worker.onmessage?.({ data: { type: "error", id: 1, name: "AiPaintFileError", message: "サイズが不正です" } });
    await expect(pending).rejects.toBeInstanceOf(AiPaintFileError);
    await expect(pending).rejects.toThrow("サイズが不正です");
    expectDisposed(worker);
  });

  it.each(["postMessage", "messageerror"])("rejects and terminates on %s", async kind => {
    state.throwOnPost = kind === "postMessage";
    const writer = createAiPaintArchiveWriter();
    const worker = state.workers[0];
    const pending = writer.add("layers/layer-000001.png", Uint8Array.from([1]));
    await Promise.resolve();
    if (kind === "messageerror") worker.onmessageerror?.();
    await expect(pending).rejects.toBeInstanceOf(Error);
    expectDisposed(worker);
  });

  it("cancels a pending add on disposal and rejects later writes", async () => {
    const writer = createAiPaintArchiveWriter();
    const worker = state.workers[0];
    const pending = writer.add("layers/layer-000001.png", Uint8Array.from([1]));
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(1));
    writer.dispose();
    await expect(pending).rejects.toThrow("中止しました");
    await expect(writer.add("manifest.json", Uint8Array.from([2]))).rejects.toThrow("追加できません");
    expectDisposed(worker);
  });

  it("keeps separate writers independent", async () => {
    const first = createAiPaintArchiveWriter();
    const second = createAiPaintArchiveWriter();
    const firstPending = first.add("layers/layer-000001.png", Uint8Array.from([1]));
    const secondPending = second.add("layers/layer-000001.png", Uint8Array.from([2]));
    await Promise.resolve();
    state.workers[0].onerror?.({ message: "failed" });
    await expect(firstPending).rejects.toThrow("failed");
    expect(state.workers[1].terminate).not.toHaveBeenCalled();
    addResponse(state.workers[1], 1);
    await secondPending;
    second.dispose();
    state.workers.forEach(expectDisposed);
  });
});
