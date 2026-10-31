import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });
});

test("trackRegion history snapshots only touched tiles for brush-style writes", async ({ page }) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const NativeOffscreenCanvas = window.OffscreenCanvas;
    const allocations: { width: number; height: number }[] = [];
    const RecordingOffscreenCanvas = new Proxy(NativeOffscreenCanvas, {
      construct(target, args) {
        const [width, height] = args as [number, number];
        allocations.push({ width, height });
        return Reflect.construct(target, args);
      },
    });
    (
      window as Window & { OffscreenCanvas: typeof OffscreenCanvas }
    ).OffscreenCanvas = RecordingOffscreenCanvas;

    try {
      const { PaintDocument } = await import("/src/core/PaintDocument.ts");
      const { History } = await import("/src/core/History.ts");

      const doc = new PaintDocument(1024, 1024, 1);
      const layer = doc.getActiveLayer();
      if (!layer) throw new Error("active layer was not available");
      const history = new History();

      const firstRect = { x: 10, y: 10, w: 4, h: 4 };
      const secondRect = { x: 300, y: 10, w: 4, h: 4 };
      history.beginOperation(doc, [layer.meta.id], {
        trackRegion: true,
        initialRegion: firstRect,
      });
      layer.store.withCtx((ctx) => {
        ctx.fillStyle = "rgba(20, 40, 60, 1)";
        ctx.fillRect(firstRect.x, firstRect.y, firstRect.w, firstRect.h);
      }, firstRect);
      history.expandRegion(secondRect);
      layer.store.withCtx((ctx) => {
        ctx.fillStyle = "rgba(80, 100, 120, 1)";
        ctx.fillRect(secondRect.x, secondRect.y, secondRect.w, secondRect.h);
      }, secondRect);
      history.commitOperation(doc, "描画", [layer.meta.id]);

      const alphaAt = (x: number, y: number): number =>
        layer.store.getImageData(x, y, 1, 1).data[3];
      const changed = [alphaAt(firstRect.x, firstRect.y), alphaAt(secondRect.x, secondRect.y)];
      history.undo(doc);
      const undone = [alphaAt(firstRect.x, firstRect.y), alphaAt(secondRect.x, secondRect.y)];
      history.redo(doc);
      const redone = [alphaAt(firstRect.x, firstRect.y), alphaAt(secondRect.x, secondRect.y)];

      return {
        changed,
        undone,
        redone,
        documentCloneCount: allocations.filter(
          (a) => a.width === doc.width && a.height === doc.height
        ).length,
        maxAllocationArea: Math.max(
          0,
          ...allocations.map((a) => a.width * a.height)
        ),
      };
    } finally {
      (
        window as Window & { OffscreenCanvas: typeof OffscreenCanvas }
      ).OffscreenCanvas = NativeOffscreenCanvas;
    }
  });

  expect(result.changed).toEqual([255, 255]);
  expect(result.undone).toEqual([0, 0]);
  expect(result.redone).toEqual([255, 255]);
  expect(result.documentCloneCount).toBe(0);
  expect(result.maxAllocationArea).toBeLessThan(1024 * 1024);
});
