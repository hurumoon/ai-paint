import { expect, test, type Page } from "@playwright/test";

type SelectionKind = "polygon" | "mask";
type Completion = "cancel" | "zero" | "subpixel" | "move";
type MoveMode = "layer" | "scale" | "rotate" | "free";

async function probeSelectionMove(
  page: Page,
  options: {
    selectionKind: SelectionKind;
    completion: Completion;
    moveMode?: MoveMode;
  },
) {
  return page.evaluate(async ({ selectionKind, completion, moveMode = "layer" }) => {
    const { PaintDocument } = await import("/src/core/PaintDocument.ts");
    const { History } = await import("/src/core/History.ts");
    const { Timelapse } = await import("/src/core/Timelapse.ts");
    const { useMoveLayerSession } = await import(
      "/src/hooks/canvasTools/useMoveLayerSession.ts"
    );
    const { createElement } = (await import("/node_modules/.vite/deps/react.js")).default;
    const { createRoot } = (await import("/node_modules/.vite/deps/react-dom_client.js")).default;
    const { flushSync } = (await import("/node_modules/.vite/deps/react-dom.js")).default;
    type Selection = import("../../src/types").Selection;
    type Session = ReturnType<typeof useMoveLayerSession>;

    const width = 620;
    const height = 96;
    const doc = new PaintDocument(width, height, 1);
    const history = new History();
    const layer = doc.getActiveLayer()!;
    const seed = new ImageData(width, height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4;
        seed.data.set(
          [
            (x * 17 + y * 3) % 256,
            (x * 5 + y * 19) % 256,
            (x * 11 + y * 7) % 256,
            255,
          ],
          i,
        );
      }
    }
    layer.store.putImageData(seed, 0, 0);

    let selection: Selection;
    if (selectionKind === "polygon") {
      selection = {
        kind: "polygon",
        x: 230,
        y: 12,
        w: 330,
        h: 62,
        points: [
          { x: 230.25, y: 12.5 },
          { x: 559.5, y: 19.25 },
          { x: 521.5, y: 73.5 },
          { x: 244.25, y: 66.5 },
        ],
      };
    } else {
      const maskWidth = 330;
      const maskHeight = 62;
      const data = new Uint8ClampedArray(maskWidth * maskHeight * 4);
      for (let y = 0; y < maskHeight; y += 1) {
        for (let x = 0; x < maskWidth; x += 1) {
          const i = (y * maskWidth + x) * 4;
          const alpha = x % 11 < 4 ? 96 : x % 11 < 8 ? 160 : 255;
          data.set([255, 255, 255, alpha], i);
        }
      }
      selection = {
        kind: "mask",
        data,
        maskWidth,
        maskHeight,
        x: 230,
        y: 12,
        w: maskWidth,
        h: maskHeight,
      };
    }

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const preview = document.createElement("canvas");
    preview.width = width;
    preview.height = height;
    let currentSelection = selection;
    let session: Session | undefined;
    function Harness() {
      session = useMoveLayerSession({
        doc,
        history,
        timelapse: new Timelapse(),
        selection,
        setSelection: (next) => {
          currentSelection = next;
        },
        previewRef: { current: preview },
        rendererRef: { current: null },
        isDrawingRef: { current: false },
        clearPreview: () => preview.getContext("2d")!.clearRect(0, 0, width, height),
      });
      return null;
    }
    flushSync(() => root.render(createElement(Harness)));
    if (!session) throw new Error("Move session harness did not mount");

    const pixelsEqual = (a: ImageData, b: ImageData) =>
      a.data.every((value, index) => value === b.data[index]);
    const before = layer.store.getImageData(0, 0, width, height);
    const move = session;
    try {
      move.startMoveLayerSession({ x: 300, y: 40 }, moveMode);
      if (completion === "move") {
        move.updateMoveLayerSession({ x: 337, y: 45 });
        await move.finishMoveLayerSession();
      } else if (completion === "subpixel") {
        move.updateMoveLayerSession({ x: 300.4, y: 40.4 });
        await move.finishMoveLayerSession();
      } else if (completion === "zero") {
        await move.finishMoveLayerSession();
      } else {
        move.cancelMoveLayerSession();
      }

      const after = layer.store.getImageData(0, 0, width, height);
      const committed = history.canUndo();
      const selectionAfter = currentSelection;
      let undoMatches = true;
      let redoMatches = true;
      if (committed) {
        history.undo(doc);
        undoMatches = pixelsEqual(
          layer.store.getImageData(0, 0, width, height),
          before,
        );
        history.redo(doc);
        redoMatches = pixelsEqual(
          layer.store.getImageData(0, 0, width, height),
          after,
        );
      }
      return {
        unchanged: pixelsEqual(before, after),
        committed,
        undoMatches,
        redoMatches,
        selectionPosition:
          selectionAfter.kind === "none"
            ? null
            : { x: selectionAfter.x, y: selectionAfter.y },
      };
    } finally {
      flushSync(() => root.unmount());
      host.remove();
    }
  }, options);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto("/");
});

for (const moveMode of ["scale", "rotate", "free"] as const) {
  test(`${moveMode} selection identity finish restores exact pixels without history`, async ({
    page,
  }) => {
    const result = await probeSelectionMove(page, {
      selectionKind: "polygon",
      completion: "zero",
      moveMode,
    });
    expect(result.unchanged).toBe(true);
    expect(result.committed).toBe(false);
  });
}

test("subpixel selection move rounded to zero restores exact pixels without history", async ({
  page,
}) => {
  const result = await probeSelectionMove(page, {
    selectionKind: "mask",
    completion: "subpixel",
  });
  expect(result.unchanged).toBe(true);
  expect(result.committed).toBe(false);
});

for (const selectionKind of ["polygon", "mask"] as const) {
  test(`${selectionKind} selection cancellation restores exact pixels without history`, async ({
    page,
  }) => {
    const result = await probeSelectionMove(page, { selectionKind, completion: "cancel" });
    expect(result.unchanged).toBe(true);
    expect(result.committed).toBe(false);
  });

  test(`${selectionKind} selection zero-distance finish restores exact pixels without history`, async ({
    page,
  }) => {
    const result = await probeSelectionMove(page, { selectionKind, completion: "zero" });
    expect(result.unchanged).toBe(true);
    expect(result.committed).toBe(false);
  });
}

test("polygon selection move across tile boundaries remains undoable and redoable", async ({
  page,
}) => {
  const result = await probeSelectionMove(page, {
    selectionKind: "polygon",
    completion: "move",
  });
  expect(result.unchanged).toBe(false);
  expect(result.committed).toBe(true);
  expect(result.undoMatches).toBe(true);
  expect(result.redoMatches).toBe(true);
  expect(result.selectionPosition?.x).toBe(267);
  expect(result.selectionPosition?.y).toBe(17);
});
