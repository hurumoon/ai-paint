import { expect, test } from "@playwright/test";

interface BrushPaintProbeResult {
  elapsedMs: number;
  frames: number;
  darkPixels: number;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });
});

test("brush invalidation reaches the composite canvas within a few frames", async ({
  page,
}) => {
  await page.goto("/");

  const result = await page.evaluate(async (): Promise<BrushPaintProbeResult> => {
    const { PaintDocument } = await import("/src/core/PaintDocument.ts");
    const { CanvasRenderer } = await import("/src/core/CanvasRenderer.ts");
    const { beginStroke, continueStroke } = await import("/src/core/brushEngine.ts");
    const { brushStrokeBounds } = await import("/src/core/brushDynamics.ts");

    function waitFrame(): Promise<void> {
      return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }

    function countDarkPixels(
      ctx: CanvasRenderingContext2D,
      point: { x: number; y: number }
    ): number {
      const radius = 4;
      const x = Math.max(0, Math.round(point.x) - radius);
      const y = Math.max(0, Math.round(point.y) - radius);
      const width = radius * 2 + 1;
      const height = radius * 2 + 1;
      const data = ctx.getImageData(x, y, width, height).data;
      let count = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];
        if (a > 0 && r < 96 && g < 96 && b < 96) {
          count += 1;
        }
      }
      return count;
    }

    function waitForDarkPixels(
      canvas: HTMLCanvasElement,
      point: { x: number; y: number },
      startedAt: number
    ): Promise<BrushPaintProbeResult> {
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        throw new Error("2d context was not available");
      }

      let frames = 0;
      return new Promise<BrushPaintProbeResult>((resolve, reject) => {
        const tick = () => {
          frames += 1;
          const elapsedMs = performance.now() - startedAt;
          const darkPixels = countDarkPixels(ctx, point);
          if (darkPixels > 0) {
            resolve({ elapsedMs, frames, darkPixels });
            return;
          }
          if (elapsedMs > 1_000) {
            reject(new Error("brush paint did not reach the composite canvas"));
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    }

    const doc = new PaintDocument(320, 240, 1);
    const layer = doc.getActiveLayer();
    if (!layer) {
      throw new Error("active layer was not available");
    }

    const canvas = document.createElement("canvas");
    const renderer = new CanvasRenderer(canvas, doc);
    renderer.invalidate();
    await waitFrame();

    const settings = {
      kind: "pen",
      size: 12,
      opacity: 1,
      color: "#222222",
      pressureSize: 0,
      pressureOpacity: 0,
      antiAliasStrength: 0.5,
    } as const;
    const from = { x: 120, y: 120, pressure: 0.5 };
    const to = { x: 200, y: 120, pressure: 0.5 };
    const dirtyRect = brushStrokeBounds(from, to, settings);
    const startedAt = performance.now();

    layer.store.withCtx((ctx) => {
      beginStroke(ctx, from, settings);
      continueStroke(ctx, from, to, settings);
    }, dirtyRect);
    renderer.invalidate(dirtyRect);

    try {
      return await waitForDarkPixels(canvas, to, startedAt);
    } finally {
      renderer.dispose();
    }
  });

  expect(result.darkPixels).toBeGreaterThan(0);
  expect(result.frames).toBeLessThanOrEqual(4);
});
