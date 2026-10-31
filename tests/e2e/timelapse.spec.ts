import { expect, test } from "@playwright/test";

test("timelapse exports its starting frames while recording, clearing and playing", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { PaintDocument } = await import("/src/core/PaintDocument.ts");
    const { Timelapse } = await import("/src/core/Timelapse.ts");
    const doc = new PaintDocument(32, 32, 1);
    const timelapse = new Timelapse(32, 2);
    timelapse.setEnabled(true);
    const capture = async () => {
      await new Promise(resolve => setTimeout(resolve, 220));
      await timelapse.captureIfEnabled(doc);
    };
    await capture();
    await capture();
    const canvas = document.createElement("canvas");
    const playing = timelapse.play(canvas, 2);
    const exporting = timelapse.exportWebM(2);
    await capture();
    timelapse.clear();
    const clearedCount = timelapse.frameCount();
    await capture();
    const blob = await exporting;
    await playing;
    const remainingCount = timelapse.frameCount();
    timelapse.clear();
    return { clearedCount, remainingCount, size: blob?.size, type: blob?.type };
  });
  expect(result.clearedCount).toBe(0);
  expect(result.remainingCount).toBe(1);
  expect(result.size).toBeGreaterThan(0);
  expect(result.type).toContain("video/webm");
});
