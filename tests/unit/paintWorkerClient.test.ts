import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface WorkerMessage {
  id: number;
  op: string;
  width: number;
  height: number;
  buffer?: ArrayBuffer;
  refBuffer?: ArrayBuffer;
}

interface WorkerPost {
  message: WorkerMessage;
  transfer: Transferable[];
}

const originalImageData = Object.getOwnPropertyDescriptor(globalThis, "ImageData");
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");

function installBrowserGlobals(): void {
  Object.defineProperty(globalThis, "ImageData", {
    configurable: true,
    value: class {
      readonly data: Uint8ClampedArray;
      readonly width: number;
      readonly height: number;

      constructor(data: Uint8ClampedArray, width: number, height: number) {
        this.data = data;
        this.width = width;
        this.height = height;
      }
    },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { hardwareConcurrency: 2 },
  });
}

function restoreBrowserGlobals(): void {
  if (originalImageData) {
    Object.defineProperty(globalThis, "ImageData", originalImageData);
  } else {
    Reflect.deleteProperty(globalThis, "ImageData");
  }
  if (originalNavigator) {
    Object.defineProperty(globalThis, "navigator", originalNavigator);
  } else {
    Reflect.deleteProperty(globalThis, "navigator");
  }
}

async function importClientWithWorkerMock(): Promise<{
  client: typeof import("../../src/workers/paintWorkerClient");
  posts: WorkerPost[];
}> {
  const posts: WorkerPost[] = [];

  class MockPaintWorker {
    onmessage: ((ev: { data: { id: number; buffer: ArrayBuffer } }) => void) | null = null;
    onerror: ((ev: { message: string }) => void) | null = null;

    postMessage(message: WorkerMessage, transfer: Transferable[]): void {
      posts.push({ message, transfer });
      const buffer = message.buffer;
      if (!buffer) {
        throw new Error("buffer is required");
      }
      const data = new Uint8ClampedArray(buffer);
      data[0] = 200;
      this.onmessage?.({
        data: {
          id: message.id,
          buffer: data.buffer,
          ...(message.op === "palette" ? { palette: ["#c80000"] } : {}),
        },
      });
    }

    terminate(): void {}
  }

  vi.doMock("../../src/workers/paint.worker?worker", () => ({
    default: MockPaintWorker,
  }));

  return {
    client: await import("../../src/workers/paintWorkerClient"),
    posts,
  };
}

function makeImageData(values: number[], width: number, height: number): ImageData {
  return new ImageData(new Uint8ClampedArray(values), width, height);
}

beforeEach(() => {
  vi.resetModules();
  installBrowserGlobals();
});

afterEach(() => {
  vi.doUnmock("../../src/workers/paint.worker?worker");
  vi.resetModules();
  restoreBrowserGlobals();
});

describe("paint worker client", () => {
  it("keeps the caller's flood fill input readable after transfer", async () => {
    const { client, posts } = await importClientWithWorkerMock();
    const imageData = makeImageData([1, 2, 3, 4, 5, 6, 7, 8], 2, 1);
    const refImageData = makeImageData([9, 10, 11, 12, 13, 14, 15, 16], 2, 1);
    const beforePixels = Array.from(imageData.data);
    const refPixels = Array.from(refImageData.data);

    const result = await client.floodFillWorker(
      imageData,
      0,
      0,
      [20, 30, 40, 255],
      0,
      { refImageData }
    );

    expect(posts).toHaveLength(1);
    const { message, transfer } = posts[0];
    expect(message.buffer).toBeInstanceOf(ArrayBuffer);
    expect(message.buffer).not.toBe(imageData.data.buffer);
    expect(message.refBuffer).toBeInstanceOf(ArrayBuffer);
    expect(message.refBuffer).not.toBe(refImageData.data.buffer);
    expect(transfer).toEqual([message.buffer, message.refBuffer]);
    expect(Array.from(imageData.data)).toEqual(beforePixels);
    expect(Array.from(refImageData.data)).toEqual(refPixels);
    expect(result.data[0]).toBe(200);
    expect(result.width).toBe(2);
    expect(result.height).toBe(1);
  });

  it("keeps the caller's blur input readable after transfer", async () => {
    const { client, posts } = await importClientWithWorkerMock();
    const imageData = makeImageData([1, 2, 3, 4], 1, 1);
    const beforePixels = Array.from(imageData.data);

    const result = await client.blurWorker(imageData, 2);

    expect(posts).toHaveLength(1);
    const { message, transfer } = posts[0];
    expect(message.buffer).toBeInstanceOf(ArrayBuffer);
    expect(message.buffer).not.toBe(imageData.data.buffer);
    expect(transfer).toEqual([message.buffer]);
    expect(Array.from(imageData.data)).toEqual(beforePixels);
    expect(result.data[0]).toBe(200);
  });

  it("keeps the caller's palette input readable after transfer", async () => {
    const { client, posts } = await importClientWithWorkerMock();
    const imageData = makeImageData([10, 20, 30, 255], 1, 1);
    const beforePixels = Array.from(imageData.data);

    const result = await client.paletteWorker(imageData, 1);

    expect(posts).toHaveLength(1);
    const { message, transfer } = posts[0];
    expect(message.buffer).toBeInstanceOf(ArrayBuffer);
    expect(message.buffer).not.toBe(imageData.data.buffer);
    expect(transfer).toEqual([message.buffer]);
    expect(Array.from(imageData.data)).toEqual(beforePixels);
    expect(result).toEqual(["#c80000"]);
  });
});
