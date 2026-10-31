import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });
});

test("TileStore writes and reads pixels across tile boundaries", async ({ page }) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const { TileStore } = await import("/src/core/TileStore.ts");
    const width = 300;
    const store = new TileStore(width, 12);
    const data = new ImageData(4, 2);
    for (let i = 0; i < data.data.length; i += 4) {
      data.data[i] = 200;
      data.data[i + 1] = 20;
      data.data[i + 2] = 10;
      data.data[i + 3] = 255;
    }

    store.putImageData(data, 254, 5);
    const sample = store.getImageData(253, 4, 6, 4).data;
    const bounds = store.getAlphaBounds();

    const alphaGrid: number[] = [];
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 6; x += 1) {
        alphaGrid.push(sample[(y * 6 + x) * 4 + 3]);
      }
    }

    return { alphaGrid, bounds };
  });

  expect(result.alphaGrid).toEqual([
    0, 0, 0, 0, 0, 0,
    0, 255, 255, 255, 255, 0,
    0, 255, 255, 255, 255, 0,
    0, 0, 0, 0, 0, 0,
  ]);
  expect(result.bounds).toEqual({ x: 254, y: 5, w: 4, h: 2 });
});

test("TileStore preserves adopted flat backing pixels after the first tiled write", async ({ page }) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const { TileStore } = await import("/src/core/TileStore.ts");
    const canvas = document.createElement("canvas");
    canvas.width = 300;
    canvas.height = 8;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("2d context was not available");
    }

    ctx.fillStyle = "rgba(20, 40, 200, 1)";
    ctx.fillRect(252, 2, 8, 3);

    const store = TileStore.fromCanvas(canvas, ctx);
    const patch = new ImageData(2, 2);
    for (let i = 0; i < patch.data.length; i += 4) {
      patch.data[i] = 0;
      patch.data[i + 1] = 220;
      patch.data[i + 2] = 40;
      patch.data[i + 3] = 255;
    }

    store.putImageData(patch, 255, 3);
    const sample = store.getImageData(252, 3, 8, 1).data;

    const pixels: number[][] = [];
    for (let x = 0; x < 8; x += 1) {
      pixels.push(Array.from(sample.slice(x * 4, x * 4 + 4)));
    }
    return pixels;
  });

  expect(result).toEqual([
    [20, 40, 200, 255],
    [20, 40, 200, 255],
    [20, 40, 200, 255],
    [0, 220, 40, 255],
    [0, 220, 40, 255],
    [20, 40, 200, 255],
    [20, 40, 200, 255],
    [20, 40, 200, 255],
  ]);
});

test("TileStore materializes only hinted flat backing tiles on the first withCtx write", async ({ page }) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const { TileStore } = await import("/src/core/TileStore.ts");
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d context was not available");
    ctx.fillStyle = "rgba(20, 40, 200, 1)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const store = TileStore.fromCanvas(canvas, ctx);
    let drawImageCalls = 0;
    let drawImageCallsDuringWrite = 0;
    const originalCanvasDrawImage = CanvasRenderingContext2D.prototype.drawImage;
    const originalOffscreenDrawImage =
      typeof OffscreenCanvasRenderingContext2D !== "undefined"
        ? OffscreenCanvasRenderingContext2D.prototype.drawImage
        : null;

    CanvasRenderingContext2D.prototype.drawImage = function countedCanvasDrawImage(
      this: CanvasRenderingContext2D,
      ...args: unknown[]
    ): void {
      drawImageCalls += 1;
      Reflect.apply(originalCanvasDrawImage, this, args);
    } as CanvasRenderingContext2D["drawImage"];

    if (originalOffscreenDrawImage) {
      OffscreenCanvasRenderingContext2D.prototype.drawImage = function countedOffscreenDrawImage(
        this: OffscreenCanvasRenderingContext2D,
        ...args: unknown[]
      ): void {
        drawImageCalls += 1;
        Reflect.apply(originalOffscreenDrawImage, this, args);
      } as OffscreenCanvasRenderingContext2D["drawImage"];
    }

    try {
      store.withCtx((writeCtx) => {
        writeCtx.fillStyle = "rgba(200, 30, 40, 1)";
        writeCtx.fillRect(10, 10, 2, 2);
      }, { x: 10, y: 10, w: 2, h: 2 });
      drawImageCallsDuringWrite = drawImageCalls;
    } finally {
      CanvasRenderingContext2D.prototype.drawImage = originalCanvasDrawImage;
      if (originalOffscreenDrawImage) {
        OffscreenCanvasRenderingContext2D.prototype.drawImage = originalOffscreenDrawImage;
      }
    }

    const edited = store.getImageData(10, 10, 1, 1).data;
    const untouched = store.getImageData(800, 800, 1, 1).data;
    return {
      drawImageCallsDuringWrite,
      edited: Array.from(edited),
      untouched: Array.from(untouched),
    };
  });

  expect(result.drawImageCallsDuringWrite).toBeLessThan(4);
  expect(result.edited).toEqual([200, 30, 40, 255]);
  expect(result.untouched).toEqual([20, 40, 200, 255]);
});

test("TileStore withCtx drops drawing that reaches tiles outside the hint", async ({ page }) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const { TileStore } = await import("/src/core/TileStore.ts");
    const singleTileHintStore = new TileStore(800, 8);
    singleTileHintStore.withCtx((ctx) => {
      ctx.fillStyle = "rgba(220, 30, 40, 1)";
      ctx.fillRect(250, 2, 10, 2);
    }, { x: 250, y: 2, w: 2, h: 2 });

    const multiTileHintStore = new TileStore(800, 8);
    multiTileHintStore.withCtx((ctx) => {
      ctx.fillStyle = "rgba(20, 180, 60, 1)";
      ctx.fillRect(250, 2, 270, 2);
    }, { x: 250, y: 2, w: 10, h: 2 });

    function pixel(store: InstanceType<typeof TileStore>, x: number): number[] {
      return Array.from(store.getImageData(x, 2, 1, 1).data);
    }

    return {
      singleTileBeforeBoundary: pixel(singleTileHintStore, 255),
      singleTileAfterBoundary: pixel(singleTileHintStore, 256),
      multiTileSecondTileEnd: pixel(multiTileHintStore, 511),
      multiTileOutsideHintTiles: pixel(multiTileHintStore, 512),
    };
  });

  expect(result.singleTileBeforeBoundary).toEqual([220, 30, 40, 255]);
  expect(result.singleTileAfterBoundary).toEqual([0, 0, 0, 0]);
  expect(result.multiTileSecondTileEnd).toEqual([20, 180, 60, 255]);
  expect(result.multiTileOutsideHintTiles).toEqual([0, 0, 0, 0]);
});

test("TileStore clearRect clears flat backing pixels across tile boundaries", async ({ page }) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const { TileStore } = await import("/src/core/TileStore.ts");
    const canvas = document.createElement("canvas");
    canvas.width = 300;
    canvas.height = 4;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d context was not available");
    ctx.fillStyle = "rgba(30, 80, 220, 1)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const store = TileStore.fromCanvas(canvas, ctx);
    store.clearRect(254, 1, 4, 2);
    const sample = store.getImageData(253, 0, 6, 4).data;
    const alphaGrid: number[] = [];
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 6; x += 1) {
        alphaGrid.push(sample[(y * 6 + x) * 4 + 3]);
      }
    }
    return { alphaGrid, bounds: store.getAlphaBounds() };
  });

  expect(result.alphaGrid).toEqual([
    255, 255, 255, 255, 255, 255,
    255, 0, 0, 0, 0, 255,
    255, 0, 0, 0, 0, 255,
    255, 255, 255, 255, 255, 255,
  ]);
  expect(result.bounds).toEqual({ x: 0, y: 0, w: 300, h: 4 });
});

test("TileStore adoptFromAt crops negative destination coordinates", async ({ page }) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const { TileStore } = await import("/src/core/TileStore.ts");
    const source = new TileStore(4, 2);
    const data = new ImageData(4, 2);
    for (let i = 0; i < data.data.length; i += 4) {
      data.data[i] = 220;
      data.data[i + 1] = 30;
      data.data[i + 2] = 40;
      data.data[i + 3] = 255;
    }
    source.putImageData(data, 0, 0);

    const dest = new TileStore(6, 4);
    dest.adoptFromAt(source, -2, 1);
    const sample = dest.getImageData(0, 0, 4, 4).data;
    const alphaGrid: number[] = [];
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        alphaGrid.push(sample[(y * 4 + x) * 4 + 3]);
      }
    }
    return { alphaGrid, bounds: dest.getAlphaBounds() };
  });

  expect(result.alphaGrid).toEqual([
    0, 0, 0, 0,
    255, 255, 0, 0,
    255, 255, 0, 0,
    0, 0, 0, 0,
  ]);
  expect(result.bounds).toEqual({ x: 0, y: 1, w: 2, h: 2 });
});

test("TileStore adoptFromAt copies hybrid flat backing edits", async ({ page }) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const { TileStore } = await import("/src/core/TileStore.ts");
    const canvas = document.createElement("canvas");
    canvas.width = 300;
    canvas.height = 4;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d context was not available");
    ctx.fillStyle = "rgba(20, 40, 200, 1)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const source = TileStore.fromCanvas(canvas, ctx);
    source.withCtx((writeCtx) => {
      writeCtx.fillStyle = "rgba(220, 30, 40, 1)";
      writeCtx.fillRect(10, 1, 2, 2);
    }, { x: 10, y: 1, w: 2, h: 2 });

    const dest = new TileStore(320, 8);
    dest.adoptFromAt(source, 5, 2);
    const edited = dest.getImageData(15, 3, 1, 1).data;
    const untouched = dest.getImageData(265, 3, 1, 1).data;
    const outside = dest.getImageData(4, 2, 1, 1).data;
    return {
      edited: Array.from(edited),
      untouched: Array.from(untouched),
      outside: Array.from(outside),
    };
  });

  expect(result.edited).toEqual([220, 30, 40, 255]);
  expect(result.untouched).toEqual([20, 40, 200, 255]);
  expect(result.outside).toEqual([0, 0, 0, 0]);
});

test("TileStore adoptFromScaled preserves scaled alpha bounds", async ({ page }) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const { TileStore } = await import("/src/core/TileStore.ts");
    const source = new TileStore(2, 2);
    const data = new ImageData(2, 2);
    for (let i = 0; i < data.data.length; i += 4) {
      data.data[i] = 20;
      data.data[i + 1] = 200;
      data.data[i + 2] = 80;
      data.data[i + 3] = 255;
    }
    source.putImageData(data, 0, 0);

    const dest = new TileStore(6, 6);
    dest.adoptFromScaled(source, 0, 0, 2, 2, 1, 1, 4, 4);
    const sample = dest.getImageData(0, 0, 6, 6);
    function alphaAt(x: number, y: number): number {
      return sample.data[(y * sample.width + x) * 4 + 3];
    }
    function pixelAt(x: number, y: number): number[] {
      const i = (y * sample.width + x) * 4;
      return Array.from(sample.data.slice(i, i + 4));
    }
    return {
      bounds: dest.getAlphaBounds(),
      outside: alphaAt(0, 0),
      center: pixelAt(2, 2),
      farOutside: alphaAt(5, 5),
    };
  });

  expect(result.bounds).toEqual({ x: 1, y: 1, w: 4, h: 4 });
  expect(result.outside).toBe(0);
  expect(result.center).toEqual([20, 200, 80, 255]);
  expect(result.farOutside).toBe(0);
});

test("TileStore toPngBytes writes only the requested rect", async ({ page }) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const { TileStore } = await import("/src/core/TileStore.ts");
    const store = new TileStore(4, 4);
    const data = new ImageData(2, 1);
    data.data.set([220, 30, 40, 255], 0);
    data.data.set([20, 200, 80, 255], 4);
    store.putImageData(data, 2, 2);

    const bytes = await store.toPngBytes({ x: 2, y: 2, w: 2, h: 1 });
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d context was not available");
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const sample = ctx.getImageData(0, 0, 2, 1).data;
    return {
      size: { width: canvas.width, height: canvas.height },
      left: Array.from(sample.slice(0, 4)),
      right: Array.from(sample.slice(4, 8)),
    };
  });

  expect(result.size).toEqual({ width: 2, height: 1 });
  expect(result.left).toEqual([220, 30, 40, 255]);
  expect(result.right).toEqual([20, 200, 80, 255]);
});

test("transparent pixel lock preserves TileStore alpha while applying color edits", async ({ page }) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const { TileStore } = await import("/src/core/TileStore.ts");
    const { applyTransparentPixelLockToStore } = await import(
      "/src/core/transparentPixelLock.ts"
    );

    const store = new TileStore(4, 1);
    const before = new ImageData(4, 1);
    before.data.set([0, 0, 0, 0], 0);
    before.data.set([20, 40, 60, 128], 4);
    before.data.set([80, 100, 120, 255], 8);
    before.data.set([140, 160, 180, 64], 12);
    store.putImageData(before, 0, 0);

    const beforeCanvas = document.createElement("canvas");
    beforeCanvas.width = 4;
    beforeCanvas.height = 1;
    const beforeCtx = beforeCanvas.getContext("2d");
    if (!beforeCtx) throw new Error("2d context was not available");
    beforeCtx.putImageData(before, 0, 0);

    const after = new ImageData(4, 1);
    for (let i = 0; i < after.data.length; i += 4) {
      after.data[i] = 220;
      after.data[i + 1] = 10;
      after.data[i + 2] = 30;
      after.data[i + 3] = 255;
    }
    store.putImageData(after, 0, 0);
    applyTransparentPixelLockToStore(store, beforeCtx, { x: 0, y: 0, w: 4, h: 1 }, 4, 1);

    return Array.from(store.getImageData(0, 0, 4, 1).data);
  });

  expect(result.slice(0, 4)).toEqual([0, 0, 0, 0]);
  expect(result.slice(8, 12)).toEqual([220, 10, 30, 255]);
  expect(result[7]).toBe(128);
  expect(result[15]).toBe(64);
  for (const index of [4, 5, 6, 12, 13, 14]) {
    expect(result[index]).toBeGreaterThanOrEqual([220, 10, 30][index % 4] - 2);
    expect(result[index]).toBeLessThanOrEqual([220, 10, 30][index % 4] + 2);
  }
});
