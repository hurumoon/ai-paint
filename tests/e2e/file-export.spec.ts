import { expect, test } from "@playwright/test";
import { createCanvas, fillCanvasWithBucket } from "./canvas-helpers";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });
});

test("exports an .aipaint file through the dialog and clears dirty state", async ({
  page,
}) => {
  await page.goto("/");
  await createCanvas(page, { width: 80, height: 60, dpi: 144 });
  await fillCanvasWithBucket(page);

  await expect.poll(() => page.title()).toMatch(/^\*/);

  await page.locator('button[title="エクスポート"]').click();
  const dialog = page.locator(".popover").filter({ hasText: "エクスポート" });
  await expect(dialog).toBeVisible();

  await dialog.locator("label").filter({ hasText: ".aipaint" }).click();
  const saveButton = dialog.getByRole("button", { name: "保存" });
  await expect(saveButton).toBeEnabled();

  const downloadPromise = page.waitForEvent("download");
  await saveButton.click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/\.aipaint$/);
  await expect(dialog).toBeHidden();
  await expect.poll(() => page.title()).not.toMatch(/^\*/);
});

test("keeps the export dialog open while a raster export is saving", async ({
  page,
}) => {
  await page.goto("/");
  await createCanvas(page, { width: 80, height: 60, dpi: 144 });
  await fillCanvasWithBucket(page);

  await page.getByTestId("topbar-export").click();
  const dialog = page.getByTestId("export-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).not.toContainText("計算中");

  await page.evaluate(() => {
    const originalToBlob = HTMLCanvasElement.prototype.toBlob;
    let releaseExportToBlob: () => void = () => undefined;
    const waitForRelease = new Promise<void>((resolve) => {
      releaseExportToBlob = resolve;
    });
    (window as Window & { __releaseExportToBlob?: () => void }).__releaseExportToBlob =
      releaseExportToBlob;
    HTMLCanvasElement.prototype.toBlob = function (
      this: HTMLCanvasElement,
      callback: BlobCallback,
      type?: string,
      quality?: number,
    ): void {
      if (type === "image/png") {
        void waitForRelease.then(() => {
          HTMLCanvasElement.prototype.toBlob = originalToBlob;
          originalToBlob.call(this, callback, type, quality);
        });
        return;
      }
      originalToBlob.call(this, callback, type, quality);
    };
  });

  await dialog.getByTestId("export-save").click();
  await expect(dialog.getByTestId("export-save")).toHaveText("保存中...");
  await expect(dialog.getByRole("button", { name: "×" })).toBeDisabled();

  await page.locator(".popover-backdrop").click({ position: { x: 5, y: 5 } });
  await expect(dialog).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.evaluate(() => {
    (window as Window & { __releaseExportToBlob?: () => void }).__releaseExportToBlob?.();
  });
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/\.png$/);
  await expect(dialog).toBeHidden();
});

test("locks pointer drawing while the public export API is pending and releases it afterwards", async ({ page }) => {
  await page.goto("/");
  await createCanvas(page, { width: 80, height: 60, dpi: 144 });
  await fillCanvasWithBucket(page);
  await page.evaluate(() => window.aiPaint!.execute("tool.update", { color: "#ef3344" }));

  await page.evaluate(() => {
    const originalHtmlToBlob = HTMLCanvasElement.prototype.toBlob;
    const originalOffscreenToBlob = OffscreenCanvas.prototype.convertToBlob;
    let releaseExportToBlob: () => void = () => undefined;
    const waitForRelease = new Promise<void>((resolve) => {
      releaseExportToBlob = resolve;
    });
    Reflect.set(window, "__releaseApiExportToBlob", releaseExportToBlob);
    HTMLCanvasElement.prototype.toBlob = function (
      this: HTMLCanvasElement,
      callback: BlobCallback,
      type?: string,
      quality?: number,
    ): void {
      if (type === "image/png") {
        Reflect.set(window, "__apiExportReachedEncoder", true);
        void waitForRelease.then(() => {
          HTMLCanvasElement.prototype.toBlob = originalHtmlToBlob;
          OffscreenCanvas.prototype.convertToBlob = originalOffscreenToBlob;
          originalHtmlToBlob.call(this, callback, type, quality);
        });
        return;
      }
      originalHtmlToBlob.call(this, callback, type, quality);
    };
    OffscreenCanvas.prototype.convertToBlob = function (options?: ImageEncodeOptions): Promise<Blob> {
      if (options?.type === "image/png") {
        Reflect.set(window, "__apiExportReachedEncoder", true);
        return waitForRelease.then(() => {
          HTMLCanvasElement.prototype.toBlob = originalHtmlToBlob;
          OffscreenCanvas.prototype.convertToBlob = originalOffscreenToBlob;
          return originalOffscreenToBlob.call(this, options);
        });
      }
      return originalOffscreenToBlob.call(this, options);
    };
    Reflect.set(window, "__apiExportPromise", window.aiPaint!.execute("file.export", { format: "aipaint" }));
  });

  await expect.poll(() => page.evaluate(() => Reflect.get(window, "__apiExportReachedEncoder"))).toBe(true);
  await expect(page.locator(".app")).toHaveAttribute("inert", "");
  const beforeBlockedStroke = await page.locator("canvas.composite-canvas").evaluate(canvas => canvas.toDataURL());
  await fillCanvasWithBucket(page);
  await expect(page.locator("canvas.composite-canvas")).toHaveJSProperty("width", 80);
  expect(await page.locator("canvas.composite-canvas").evaluate(canvas => canvas.toDataURL())).toBe(beforeBlockedStroke);

  await page.evaluate(() => {
    const release = Reflect.get(window, "__releaseApiExportToBlob") as (() => void) | undefined;
    release?.();
  });
  const exported = await page.evaluate(async () => await Reflect.get(window, "__apiExportPromise"));
  expect(exported).toMatchObject({ ok: true, value: { bytes: expect.any(Number) } });
  await expect(page.locator(".app")).not.toHaveAttribute("inert");

  await fillCanvasWithBucket(page);
  await expect.poll(() => page.locator("canvas.composite-canvas").evaluate(canvas => canvas.toDataURL())).not.toBe(beforeBlockedStroke);
});

test("releases the public export API lock when encoding fails", async ({ page }) => {
  await page.goto("/");
  await createCanvas(page, { width: 80, height: 60, dpi: 144 });
  await fillCanvasWithBucket(page);

  const result = await page.evaluate(async () => {
    const originalToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback: BlobCallback, type?: string): void {
      HTMLCanvasElement.prototype.toBlob = originalToBlob;
      if (type === "image/png") {
        callback(null);
        return;
      }
      originalToBlob.call(this, callback, type);
    };
    return window.aiPaint!.execute("file.export", { format: "png" });
  });

  expect(result.ok).toBe(false);
  await expect(page.locator(".app")).not.toHaveAttribute("inert");
});
