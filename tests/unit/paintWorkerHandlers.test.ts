import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleBlur } from "../../src/workers/paintWorkerBlur";
import { handleFlood } from "../../src/workers/paintWorkerFlood";
import {
  handleLinearGradient,
  handleRadialGradient,
} from "../../src/workers/paintWorkerGradient";
import { handlePalette } from "../../src/workers/paintWorkerPalette";

interface WorkerReply {
  id: number;
  buffer?: ArrayBuffer;
  palette?: string[];
}

const replies: WorkerReply[] = [];

function installWorkerReplyTarget(): void {
  Object.defineProperty(globalThis, "self", {
    configurable: true,
    value: {
      postMessage: (message: WorkerReply) => {
        replies.push(message);
      },
    },
  });
}

function pixelIndex(width: number, x: number, y: number): number {
  return (y * width + x) * 4;
}

function makeBuffer(
  width: number,
  height: number,
  write: (data: Uint8ClampedArray) => void
): ArrayBuffer {
  const data = new Uint8ClampedArray(width * height * 4);
  write(data);
  return data.buffer;
}

function lastBuffer(): Uint8ClampedArray {
  const reply = replies.at(-1);
  expect(reply?.buffer).toBeInstanceOf(ArrayBuffer);
  return new Uint8ClampedArray(reply!.buffer!);
}

beforeEach(() => {
  replies.length = 0;
  installWorkerReplyTarget();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("paint worker handlers", () => {
  it("flood-fills only the connected area bounded by a reference wall", () => {
    const width = 4;
    const height = 3;
    const refBuffer = makeBuffer(width, height, (data) => {
      for (let y = 0; y < height; y += 1) {
        const idx = pixelIndex(width, 2, y);
        data[idx] = 0;
        data[idx + 1] = 0;
        data[idx + 2] = 0;
        data[idx + 3] = 255;
      }
    });

    handleFlood({
      id: 1,
      op: "flood",
      width,
      height,
      startX: 0,
      startY: 1,
      fill: [10, 20, 30, 255],
      tolerance: 8,
      gapClose: 0,
      expand: 0,
      buffer: new Uint8ClampedArray(width * height * 4).buffer,
      refBuffer,
    });

    const result = lastBuffer();
    expect(Array.from(result.slice(pixelIndex(width, 0, 1), pixelIndex(width, 0, 1) + 4))).toEqual([10, 20, 30, 255]);
    expect(Array.from(result.slice(pixelIndex(width, 1, 1), pixelIndex(width, 1, 1) + 4))).toEqual([10, 20, 30, 255]);
    expect(Array.from(result.slice(pixelIndex(width, 2, 1), pixelIndex(width, 2, 1) + 4))).toEqual([0, 0, 0, 0]);
    expect(Array.from(result.slice(pixelIndex(width, 3, 1), pixelIndex(width, 3, 1) + 4))).toEqual([0, 0, 0, 0]);
  });

  it("expands blur from an opaque center pixel without preserving the original peak", () => {
    const width = 5;
    const height = 1;
    const buffer = makeBuffer(width, height, (data) => {
      const idx = pixelIndex(width, 2, 0);
      data[idx] = 255;
      data[idx + 1] = 120;
      data[idx + 2] = 60;
      data[idx + 3] = 255;
    });

    handleBlur({ id: 2, op: "blur", width, height, radius: 1, buffer });

    const result = lastBuffer();
    expect(result[pixelIndex(width, 0, 0) + 3]).toBeGreaterThan(0);
    expect(result[pixelIndex(width, 2, 0) + 3]).toBeLessThan(255);
    expect(result[pixelIndex(width, 4, 0) + 3]).toBeGreaterThan(0);
  });

  it("samples linear and radial gradient stops at predictable positions", () => {
    handleLinearGradient({
      id: 3,
      op: "gradient-linear",
      width: 3,
      height: 1,
      x1: 0,
      y1: 0,
      x2: 2,
      y2: 0,
      from: [0, 0, 0, 0],
      to: [100, 0, 0, 255],
    });

    const linear = lastBuffer();
    expect(Array.from(linear.slice(0, 4))).toEqual([0, 0, 0, 0]);
    expect(Array.from(linear.slice(4, 8))).toEqual([50, 0, 0, 128]);
    expect(Array.from(linear.slice(8, 12))).toEqual([100, 0, 0, 255]);

    handleRadialGradient({
      id: 4,
      op: "gradient-radial",
      width: 3,
      height: 1,
      cx: 1,
      cy: 0,
      r: 1,
      from: [0, 10, 0, 255],
      to: [0, 90, 0, 255],
    });

    const radial = lastBuffer();
    expect(Array.from(radial.slice(0, 4))).toEqual([0, 90, 0, 255]);
    expect(Array.from(radial.slice(4, 8))).toEqual([0, 10, 0, 255]);
    expect(Array.from(radial.slice(8, 12))).toEqual([0, 90, 0, 255]);
  });

  it("extracts a deterministic palette while skipping transparent and white pixels", () => {
    vi.spyOn(Math, "random")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.99);

    const width = 4;
    const height = 1;
    const buffer = makeBuffer(width, height, (data) => {
      data.set([255, 0, 0, 255], pixelIndex(width, 0, 0));
      data.set([0, 0, 255, 255], pixelIndex(width, 1, 0));
      data.set([255, 255, 255, 255], pixelIndex(width, 2, 0));
      data.set([0, 255, 0, 0], pixelIndex(width, 3, 0));
    });

    handlePalette({ id: 5, op: "palette", width, height, k: 2, buffer });

    expect(replies.at(-1)?.palette).toEqual(["#ff0000", "#0000ff"]);
  });
});
