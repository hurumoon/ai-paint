import { expect, test } from "@playwright/test";
import { clickDocumentPoint, createCanvas, saveAipaintDownload } from "./canvas-helpers";

test("text correction explains rasterization and restores editable text with undo", async ({ page }, testInfo) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto("/");
  await createCanvas(page, { width: 240, height: 120, dpi: 144 });
  await page.locator('button[title="テキスト"]').click();
  await clickDocumentPoint(page, { x: 20, y: 25 });
  const editor = page.locator('textarea[placeholder="文字を入力…"]');
  await editor.fill("Keep correction");
  await page.locator('button[title="移動"]').click();
  const readPixels = () => page.locator("canvas.composite-canvas").evaluate((canvas) =>
    Array.from(canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data));
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const original = await readPixels();

  await page.keyboard.press("Control+u");
  const dialog = page.locator(".popover").filter({ has: page.getByText("色調補正", { exact: true }) });
  const notice = dialog.getByText("補正を適用すると文字は画像になり、文字編集できなくなります。取り消すと編集可能な文字に戻ります。", { exact: true });
  await expect(notice).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("text-correction-notice.png") });
  await dialog.getByRole("button", { name: "キャンセル", exact: true }).click();
  await expect(editor).toHaveValue("Keep correction");
  await expect.poll(readPixels).toEqual(original);

  await page.keyboard.press("Control+u");
  await expect(notice).toBeVisible();
  await dialog.getByRole("button", { name: "簡易フィルタ", exact: true }).click();
  await dialog.getByRole("button", { name: "階調反転", exact: true }).click();
  await expect(notice).toBeHidden();
  await dialog.getByRole("button", { name: "適用", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(editor).toBeHidden();
  await expect.poll(readPixels).not.toEqual(original);
  const corrected = await readPixels();

  await page.keyboard.press("Control+z");
  await expect(editor).toHaveValue("Keep correction");
  await expect.poll(readPixels).toEqual(original);
  await page.keyboard.press("Control+y");
  await expect(editor).toBeHidden();
  await expect.poll(readPixels).toEqual(corrected);

  const savedPath = await saveAipaintDownload(page, testInfo, "corrected-text");
  await page.getByTestId("project-file-input").setInputFiles(savedPath);
  await expect(page.locator(".layer-row")).toHaveCount(2);
  await expect(editor).toBeHidden();
  await expect.poll(readPixels).toEqual(corrected);
});
