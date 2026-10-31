import { expect, test, type Page } from "@playwright/test";
import { createCanvas, fillCanvasWithBucket } from "./canvas-helpers";
import type { LargePsdLayerSpec } from "./large-psd-fixture";

interface NativeCall {
  cmd: string;
  args: Record<string, unknown>;
}

interface NativeBridgeState {
  calls: NativeCall[];
  writeByteCounts: Record<string, number>;
  writePaths: Record<string, string>;
  openFile?: NativeBridgeOptions["openFile"];
  releaseOpenDialog?: () => void;
  releaseRead?: () => void;
}

interface NativeBridgeOptions {
  projectPath?: string;
  defaultOpenPath?: string;
  deferOpenDialog?: boolean;
  deferRead?: boolean;
  openFile?: {
    name: string;
    path: string;
    bytes: number[];
    reportedSize?: number;
    headerBytes?: number[];
  };
}

const NATIVE_PROJECT_PATH = String.raw`C:\Users\Public\Pictures\native-project.aipaint`;
const NATIVE_SOURCE_PATH = String.raw`C:\Users\Public\Pictures\native-source.png`;
const NATIVE_LARGE_PSD_PATH = String.raw`C:\Users\Public\Pictures\native-large.psd`;
const LARGE_NATIVE_PSD_WIDTH = 12_000;
const LARGE_NATIVE_PSD_HEIGHT = 9_000;
const MAX_PSD_FILE_BYTES = 500 * 1024 * 1024;
const PSD_1X1_HEADER = [
  0x38, 0x42, 0x50, 0x53, 0, 1, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 1, 0, 0, 0, 1,
  0, 8, 0, 3,
];
const PNG_2X2_BLACK = [
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 2,
  0, 0, 0, 2, 8, 6, 0, 0, 0, 114, 182, 13, 36, 0, 0, 0, 20, 73, 68, 65, 84,
  120, 1, 98, 98, 96, 96, 248, 15, 194, 32, 6, 144, 102, 96, 0, 0, 0, 0, 255,
  255, 187, 210, 247, 1, 0, 0, 0, 6, 73, 68, 65, 84, 3, 0, 24, 48, 2, 3, 172,
  155, 194, 182, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
];

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });
});

test("exports through native save session and reuses that path for Ctrl+S", async ({
  page,
}) => {
  await installNativeBridgeMock(page);
  await page.goto("/");
  await createCanvas(page, { width: 80, height: 60, dpi: 144 });
  await fillCanvasWithBucket(page);

  await page.locator('button[title="エクスポート"]').click();
  const dialog = page.locator(".popover").filter({ hasText: "エクスポート" });
  await expect(dialog).toBeVisible();
  await dialog.locator("label").filter({ hasText: ".aipaint" }).click();
  await dialog.locator("button.btn.primary").click();

  await waitForNativeCommand(page, "native_finish_write_file");
  await expect(dialog).toBeHidden();
  await expect.poll(() => page.title()).not.toMatch(/^\*/);

  await page.keyboard.press("Control+Shift+N");
  await expect.poll(() => page.title()).toMatch(/^\*/);
  await page.locator('button[title*="Ctrl+S"]').click();

  await waitForNativeCommand(page, "native_begin_write_file");
  await waitForNativeCommand(page, "native_finish_write_file", 2);

  const calls = await getNativeCalls(page);
  const beginSave = calls.find((call) => call.cmd === "native_begin_save_file");
  expect(beginSave?.args.defaultName).toEqual(expect.stringMatching(/\.aipaint$/));
  expect(beginSave?.args.filter).toMatchObject({
    extensions: ["aipaint"],
  });

  const directWrite = calls.find((call) => call.cmd === "native_begin_write_file");
  expect(directWrite?.args.path).toBe(NATIVE_PROJECT_PATH);

  const state = await getNativeBridgeState(page);
  expect(state.writeByteCounts["native-save-1"]).toBeGreaterThan(0);
  expect(state.writeByteCounts["native-write-2"]).toBeGreaterThan(0);
  expect(state.writePaths["native-write-2"]).toBe(NATIVE_PROJECT_PATH);
});

test("opens a native image for direct editing and saves back to the opened path", async ({
  page,
}) => {
  await installNativeBridgeMock(page, {
    openFile: {
      name: "native-source.png",
      path: NATIVE_SOURCE_PATH,
      bytes: PNG_2X2_BLACK,
    },
  });
  await page.goto("/");

  await page.locator('button[title="画像を読み込み（直接編集）"]').click();
  await expect(page.locator("canvas.input-canvas")).toHaveAttribute("width", "2");
  await expect(page.locator("canvas.input-canvas")).toHaveAttribute("height", "2");
  await expect.poll(() => page.title()).not.toMatch(/^\*/);

  await waitForNativeCommand(page, "native_finish_read_file");
  await page.locator('button[title*="Ctrl+S"]').click();
  await waitForNativeCommand(page, "native_finish_write_file");

  const calls = await getNativeCalls(page);
  expect(calls.filter((call) => call.cmd === "native_begin_save_file")).toHaveLength(0);
  expect(calls.filter((call) => call.cmd === "native_read_file_chunk").length).toBeGreaterThan(1);
  expect(calls.find((call) => call.cmd === "native_begin_write_file")?.args.path).toBe(
    NATIVE_SOURCE_PATH
  );

  const state = await getNativeBridgeState(page);
  expect(state.writeByteCounts["native-write-1"]).toBeGreaterThan(0);
  expect(state.writePaths["native-write-1"]).toBe(NATIVE_SOURCE_PATH);
});

test("marks file loading before the native open dialog resolves", async ({ page }) => {
  await installNativeBridgeMock(page, {
    deferOpenDialog: true,
    openFile: {
      name: "native-source.png",
      path: NATIVE_SOURCE_PATH,
      bytes: PNG_2X2_BLACK,
    },
  });
  await page.goto("/");

  await page.getByRole("button", { name: "ファイルを開く" }).click();
  await expect(page.locator(".loading-overlay")).toBeVisible();
  await expect(page.locator(".loading-overlay")).toContainText("ファイルを選択中");

  await page.evaluate(() => {
    const testWindow = window as Window & {
      __AI_PAINT_NATIVE_TEST__?: NativeBridgeState;
    };
    testWindow.__AI_PAINT_NATIVE_TEST__?.releaseOpenDialog?.();
  });

  await expect(page.locator("canvas.input-canvas")).toHaveAttribute("width", "2");
  await expect(page.locator(".loading-overlay")).toHaveCount(0);
});

test("blocks shortcuts and additional drops while a native file is loading", async ({ page }) => {
  await installNativeBridgeMock(page, {
    deferRead: true,
    openFile: {
      name: "native-source.png",
      path: NATIVE_SOURCE_PATH,
      bytes: PNG_2X2_BLACK,
    },
  });
  await page.goto("/");
  await createCanvas(page, { width: 80, height: 60, dpi: 144 });

  await page.locator('button[title="画像を読み込み（直接編集）"]').click();
  await expect(page.locator(".loading-overlay")).toBeVisible();

  const results = await page.evaluate(async () => {
    const { DEFAULT_SHORTCUTS } = await import("/src/core/shortcuts.ts");
    const combos = [
      ...Object.values(DEFAULT_SHORTCUTS).filter(
        (combo) => combo && !combo.includes("mousebutton"),
      ),
      "space",
      "f6",
      "ctrl+alt+shift+q",
    ];

    return combos.map((combo) => {
      const parts = combo.split("+");
      const keyName = parts.at(-1) ?? "";
      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: keyName === "space" ? " " : keyName,
        code: keyName === "space" ? "Space" : undefined,
        ctrlKey: parts.includes("ctrl"),
        altKey: parts.includes("alt"),
        shiftKey: parts.includes("shift"),
      });
      window.dispatchEvent(event);
      return { combo, defaultPrevented: event.defaultPrevented };
    });
  });

  expect(results).not.toHaveLength(0);
  expect(results.filter((result) => !result.defaultPrevented)).toEqual([]);

  await page.evaluate((bytes) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([new Uint8Array(bytes)], "second-image.png", { type: "image/png" }),
    );
    const overlay = document.querySelector(".loading-overlay");
    if (!overlay) throw new Error("loading overlay was not found");
    overlay.dispatchEvent(new DragEvent("drop", {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
    }));
  }, PNG_2X2_BLACK);
  await expect(
    page.getByText("ファイル読み込み中は別のファイルを開けません"),
  ).toBeVisible();
  await expect(page.locator(".loading-overlay")).toBeVisible();

  await page.evaluate(() => {
    const testWindow = window as Window & {
      __AI_PAINT_NATIVE_TEST__?: NativeBridgeState;
    };
    testWindow.__AI_PAINT_NATIVE_TEST__?.releaseRead?.();
  });
  await expect(page.locator(".loading-overlay")).toBeHidden();
  await expect(page.locator("canvas.input-canvas")).toHaveAttribute("width", "2");
});

test("opens a large native PSD through chunked bridge before loading it", async ({ page }) => {
  const specs: LargePsdLayerSpec[] = [
    {
      name: "native bottom mark",
      left: 10_900,
      top: 8_100,
      width: 5,
      height: 4,
      color: [210, 40, 30, 255],
    },
    {
      name: "native top mark",
      left: 720,
      top: 640,
      width: 3,
      height: 6,
      color: [20, 130, 220, 255],
    },
  ];
  await installNativeBridgeMock(page);
  await page.goto("/");

  const fixture = await page.evaluate(
    async ({ height, path, specs, width }) => {
      const { makeLargeSparsePsdBlob } = await import("/tests/e2e/large-psd-fixture.ts");
      const blob = makeLargeSparsePsdBlob(width, height, specs);
      const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
      (
        window as Window & {
          __AI_PAINT_NATIVE_TEST__: NativeBridgeState;
        }
      ).__AI_PAINT_NATIVE_TEST__.openFile = {
        name: "native-large.psd",
        path,
        bytes,
      };
      return { blobSize: blob.size };
    },
    {
      height: LARGE_NATIVE_PSD_HEIGHT,
      path: NATIVE_LARGE_PSD_PATH,
      specs,
      width: LARGE_NATIVE_PSD_WIDTH,
    }
  );

  const result = await page.evaluate(async ({ height, width }) => {
    const { PaintDocument } = await import("/src/core/PaintDocument.ts");
    const { loadPsd } = await import("/src/core/psdFormat.ts");
    const { openFileFromUserPath } = await import("/src/utils/saveFile.ts");

    const openStartedAt = performance.now();
    const openResult = await openFileFromUserPath([
      { name: "PSD (レイヤー保持)", extensions: ["psd"] },
    ]);
    const openMs = performance.now() - openStartedAt;
    if (openResult.cancelled || !openResult.file) {
      throw new Error("native PSD open was cancelled");
    }

    const doc = new PaintDocument(1, 1, 1);
    const loadStartedAt = performance.now();
    const timing = await loadPsd(openResult.file, doc, {
      fileName: openResult.file.name,
      nativeReadTiming: openResult.nativeReadTiming,
    });
    const loadMs = performance.now() - loadStartedAt;
    const nativeCalls = (window as Window & {
      __AI_PAINT_NATIVE_TEST__: NativeBridgeState;
    }).__AI_PAINT_NATIVE_TEST__.calls;

    return {
      openMs,
      loadMs,
      // 11バイト分割の全呼び出しを転送すると、読み込みよりテスト用の転送が長くなる。
      readChunkCount: nativeCalls.filter((call) => call.cmd === "native_read_file_chunk").length,
      readFinished: nativeCalls.some((call) => call.cmd === "native_finish_read_file"),
      fileName: openResult.file.name,
      fileSize: openResult.file.size,
      path: openResult.path,
      size: { width: doc.width, height: doc.height },
      timing,
      layers: doc.layers.map((layer) => ({
        name: layer.meta.name,
        deferred: layer.deferred ?? null,
        storeSize: {
          width: layer.store.width,
          height: layer.store.height,
        },
        pixels: Array.from(layer.store.getImageData(0, 0, layer.store.width, layer.store.height).data),
      })),
      expectedSize: { width, height },
    };
  }, { height: LARGE_NATIVE_PSD_HEIGHT, width: LARGE_NATIVE_PSD_WIDTH });

  console.log(
    `large native PSD bridge open: ${result.openMs.toFixed(1)}ms; load: ${result.loadMs.toFixed(
      1
    )}ms (${result.fileSize} bytes)`
  );
  console.log(
    [
      "PSD load timing:",
      `native first chunk selected=${result.timing.nativeRead?.selectedToFirstChunkMs?.toFixed(1) ?? "-"}ms`,
      `native chunks=${result.timing.nativeRead?.chunkCount ?? "-"} requested=${result.timing.nativeRead?.requestedChunkBytes ?? "-"}B read=${result.timing.nativeRead?.allChunksReadMs.toFixed(1) ?? "-"}ms`,
      `File.arrayBuffer=${result.timing.timings.fileArrayBufferMs.toFixed(1)}ms`,
      `readPsd=${result.timing.timings.readPsdMs.toFixed(1)}ms`,
      `walk=${result.timing.timings.walkPsdChildrenMs.toFixed(1)}ms`,
      `bbox=${result.timing.timings.bboxCanvasMs.toFixed(1)}ms`,
      `docResize=${result.timing.timings.docResizeMs.toFixed(1)}ms`,
      `replace=${result.timing.timings.replaceLayersFromCanvasMs.toFixed(1)}ms`,
      `total=${result.timing.timings.loadPsdTotalMs.toFixed(1)}ms`,
    ].join(" ")
  );
  expect(result.fileName).toBe("native-large.psd");
  expect(result.fileSize).toBe(fixture.blobSize);
  expect(result.path).toBe(NATIVE_LARGE_PSD_PATH);
  expect(result.size).toEqual(result.expectedSize);
  expect(result.timing.fileBytes).toBe(fixture.blobSize);
  expect(result.timing.nativeRead?.requestedChunkBytes).toBe(8 * 1024 * 1024);
  // 時計の分解能より短い処理は 0ms になり得る。読み込みの成否は下の画素・構造で確認する。
  expect(Number.isFinite(result.timing.timings.readPsdMs)).toBe(true);
  expect(result.timing.timings.readPsdMs).toBeGreaterThanOrEqual(0);
  expect(result.timing.timings.replaceLayersFromCanvasMs).toBeGreaterThanOrEqual(0);
  expect(result.layers).toEqual(
    specs.map((spec) =>
      expect.objectContaining({
        name: spec.name,
        deferred: {
          offsetX: spec.left,
          offsetY: spec.top,
          bboxWidth: spec.width,
          bboxHeight: spec.height,
        },
        storeSize: {
          width: spec.width,
          height: spec.height,
        },
        pixels: Array.from({ length: spec.width * spec.height }, () => spec.color).flat(),
      })
    )
  );

  expect(result.readChunkCount).toBeGreaterThan(1);
  expect(result.readFinished).toBe(true);
});

test("rejects an oversized native PSD before requesting any file chunk", async ({ page }) => {
  await installNativeBridgeMock(page, {
    openFile: {
      name: "oversized.psd",
      path: String.raw`C:\Users\Public\Pictures\oversized.psd`,
      bytes: PSD_1X1_HEADER,
      reportedSize: MAX_PSD_FILE_BYTES + 1,
    },
  });
  await page.goto("/");

  await page.getByRole("button", { name: "ファイルを開く" }).click();

  await expect(page.locator(".toast.error")).toContainText("PSD ファイルが大きすぎます");
  await waitForNativeCommand(page, "native_cancel_read_file");
  const calls = await getNativeCalls(page);
  expect(calls.filter((call) => call.cmd === "native_read_file_chunk")).toHaveLength(0);
  expect(calls.filter((call) => call.cmd === "native_finish_read_file")).toHaveLength(0);
});

async function installNativeBridgeMock(
  page: Page,
  options: NativeBridgeOptions = {}
): Promise<void> {
  const bridgeOptions: NativeBridgeOptions = {
    projectPath: NATIVE_PROJECT_PATH,
    defaultOpenPath: NATIVE_SOURCE_PATH,
    ...options,
  };
  await page.addInitScript((mockOptions: NativeBridgeOptions) => {
    type BrowserNativeCall = {
      cmd: string;
      args: Record<string, unknown>;
    };
    type BrowserNativeState = {
      calls: BrowserNativeCall[];
      writeByteCounts: Record<string, number>;
      writePaths: Record<string, string>;
      openFile?: NativeBridgeOptions["openFile"];
      releaseOpenDialog?: () => void;
      releaseRead?: () => void;
    };
    type TauriInternals = {
      metadata: {
        currentWindow: { label: string };
        currentWebview: { windowLabel: string; label: string };
      };
      invoke: (
        cmd: string,
        args?: Record<string, unknown> | Uint8Array,
        options?: { headers?: Record<string, string> }
      ) => Promise<unknown>;
      transformCallback: (callback?: (response: unknown) => void, once?: boolean) => number;
      unregisterCallback: (id: number) => void;
      runCallback: (id: number, data: unknown) => void;
      callbacks: Map<number, (data: unknown) => void>;
      convertFileSrc: (filePath: string, protocol?: string) => string;
    };
    type TestWindow = Window & {
      __TAURI_INTERNALS__: TauriInternals;
      __TAURI_EVENT_PLUGIN_INTERNALS__: {
        unregisterListener?: (event: string, id: number) => void;
      };
      __AI_PAINT_NATIVE_TEST__: BrowserNativeState;
    };

    const testWindow = window as TestWindow;
    const callbacks = new Map<number, (data: unknown) => void>();
    const state: BrowserNativeState = {
      calls: [],
      writeByteCounts: {},
      writePaths: {},
    };
    let callbackId = 1;
    let writeId = 1;
    let readOffset = 0;
    let releaseRead: () => void = () => undefined;
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    if (mockOptions.deferRead) state.releaseRead = releaseRead;
    let releaseOpenDialog: () => void = () => undefined;
    const openDialogGate = new Promise<void>((resolve) => {
      releaseOpenDialog = resolve;
    });
    if (mockOptions.deferOpenDialog) {
      state.releaseOpenDialog = releaseOpenDialog;
    }

    function summarizeArgs(
      args: Record<string, unknown> | Uint8Array,
      options?: { headers?: Record<string, string> }
    ): Record<string, unknown> {
      if (args instanceof Uint8Array) {
        return {
          rawBytesLength: args.byteLength,
          headers: options?.headers ?? {},
        };
      }
      const copy: Record<string, unknown> = { ...args };
      if (Array.isArray(copy.bytes)) {
        copy.bytesLength = copy.bytes.length;
        delete copy.bytes;
      }
      return copy;
    }

    async function invoke(
      cmd: string,
      args: Record<string, unknown> | Uint8Array = {},
      options?: { headers?: Record<string, string> }
    ): Promise<unknown> {
      state.calls.push({ cmd, args: summarizeArgs(args, options) });

      if (cmd === "native_begin_save_file") {
        const id = `native-save-${writeId++}`;
        const path = mockOptions.projectPath ?? "";
        state.writePaths[id] = path;
        state.writeByteCounts[id] = 0;
        return {
          cancelled: false,
          file_name: "native-project.aipaint",
          path,
          write_id: id,
        };
      }

      if (cmd === "native_begin_write_file") {
        const id = `native-write-${writeId++}`;
        state.writePaths[id] = args instanceof Uint8Array ? "" : String(args.path ?? "");
        state.writeByteCounts[id] = 0;
        return { write_id: id };
      }

      if (cmd === "native_write_file_chunk") {
        if (args instanceof Uint8Array) {
          const id = String(options?.headers?.["x-ai-paint-write-id"] ?? "");
          state.writeByteCounts[id] = (state.writeByteCounts[id] ?? 0) + args.byteLength;
        } else {
          const id = String(args.writeId ?? "");
          const bytes = Array.isArray(args.bytes) ? args.bytes.length : 0;
          state.writeByteCounts[id] = (state.writeByteCounts[id] ?? 0) + bytes;
        }
        return null;
      }

      if (
        cmd === "native_finish_write_file" ||
        cmd === "native_cancel_write_file" ||
        cmd === "native_finish_read_file" ||
        cmd === "native_cancel_read_file"
      ) {
        return null;
      }

      if (cmd === "native_take_startup_open_files") {
        return [];
      }

      if (cmd === "native_begin_open_file") {
        if (mockOptions.deferOpenDialog) await openDialogGate;
        const openFile = state.openFile ?? mockOptions.openFile;
        const bytes = openFile?.bytes ?? [];
        return {
          cancelled: false,
          file_name: openFile?.name ?? "native-source.png",
          path: openFile?.path ?? mockOptions.defaultOpenPath ?? "",
          read_id: "native-read-1",
          file_size: openFile?.reportedSize ?? bytes.length,
          header_bytes: openFile?.headerBytes ?? bytes.slice(0, 26),
        };
      }

      if (cmd === "native_read_file_chunk") {
        if (mockOptions.deferRead) await readGate;
        if (args instanceof Uint8Array) return new Uint8Array();
        const source = (state.openFile ?? mockOptions.openFile)?.bytes ?? [];
        const maxBytes = Math.max(1, Math.min(Number(args.maxBytes ?? 1), 11));
        const bytes = source.slice(readOffset, readOffset + maxBytes);
        readOffset += bytes.length;
        const rawBytes = new Uint8Array(bytes);
        return Object.assign(rawBytes, {
          bytes,
          done: readOffset >= source.length,
        });
      }

      if (cmd === "plugin:event|listen") {
        return args.handler ?? null;
      }

      return null;
    }

    testWindow.__AI_PAINT_NATIVE_TEST__ = state;
    testWindow.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: () => undefined,
    };
    testWindow.__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { windowLabel: "main", label: "main" },
      },
      invoke,
      transformCallback: (callback, once = false) => {
        const id = callbackId++;
        callbacks.set(id, (data) => {
          if (once) callbacks.delete(id);
          callback?.(data);
        });
        return id;
      },
      unregisterCallback: (id) => {
        callbacks.delete(id);
      },
      runCallback: (id, data) => {
        callbacks.get(id)?.(data);
      },
      callbacks,
      convertFileSrc: (filePath, protocol = "asset") =>
        `http://${protocol}.localhost/${encodeURIComponent(filePath)}`,
    };
  }, bridgeOptions);
}

async function getNativeCalls(page: Page): Promise<NativeCall[]> {
  return page.evaluate(() => {
    const testWindow = window as Window & {
      __AI_PAINT_NATIVE_TEST__?: NativeBridgeState;
    };
    return testWindow.__AI_PAINT_NATIVE_TEST__?.calls ?? [];
  });
}

async function getNativeBridgeState(page: Page): Promise<NativeBridgeState> {
  return page.evaluate(() => {
    const testWindow = window as Window & {
      __AI_PAINT_NATIVE_TEST__?: NativeBridgeState;
    };
    if (!testWindow.__AI_PAINT_NATIVE_TEST__) {
      return { calls: [], writeByteCounts: {}, writePaths: {} };
    }
    return testWindow.__AI_PAINT_NATIVE_TEST__;
  });
}

async function waitForNativeCommand(
  page: Page,
  cmd: string,
  minCount = 1
): Promise<void> {
  await expect
    .poll(async () => {
      const calls = await getNativeCalls(page);
      return calls.filter((call) => call.cmd === cmd).length;
    })
    .toBeGreaterThanOrEqual(minCount);
}
