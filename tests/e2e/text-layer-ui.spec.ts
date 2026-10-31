import { expect, test } from "@playwright/test";
import {
  clickDocumentPoint,
  countDarkCompositePixels,
  createCanvas,
} from "./canvas-helpers";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });
});

for (const size of [{ width: 8192, height: 512 }, { width: 512, height: 8192 }]) {
  test(`text coordinate sliders follow the ${size.width}x${size.height} canvas`, async ({ page }) => {
    await page.goto("/");
    await createCanvas(page, { ...size, dpi: 144 });
    await page.getByRole("button", { name: "サブビューを隠す", exact: true }).click();
    await page.locator('button[title="テキスト"]').click();
    await expect(page.locator(".layer-row")).toHaveCount(1);
    const canvas = await page.locator("canvas.input-canvas").boundingBox();
    const area = await page.locator(".canvas-area").boundingBox();
    if (!canvas || !area) throw new Error("キャンバスの表示範囲を取得できません");
    await page.locator("canvas.input-canvas").click({ position: {
      x: (Math.max(canvas.x, area.x) + Math.min(canvas.x + canvas.width, area.x + area.width)) / 2 - canvas.x,
      y: (Math.max(canvas.y, area.y) + Math.min(canvas.y + canvas.height, area.y + area.height)) / 2 - canvas.y,
    } });
    const editor = page.locator(".section").filter({
      has: page.locator('textarea[placeholder="文字を入力…"]'),
    });
    await expect(editor).toBeVisible();
    for (const [label, limit] of [["X", size.width], ["Y", size.height]] as const) {
      const slider = editor.locator(".slider").filter({
        has: page.locator(".slider-label", { hasText: new RegExp(`^${label}$`) }),
      });
      await expect(slider.locator("input")).toHaveAttribute("max", String(limit));
      await slider.locator("input").focus();
      await page.keyboard.press("End");
      await expect(slider.locator("input")).toHaveValue(String(limit));
      await expect(slider.locator(".slider-val")).toHaveText(String(limit));
      await page.keyboard.press("ArrowLeft");
      await expect(slider.locator(".slider-val")).toHaveText(String(limit - 1));
    }
  });
}

test("creates, edits, and deletes a text layer through the UI", async ({ page }) => {
  await page.goto("/");
  await createCanvas(page, { width: 160, height: 100, dpi: 144 });

  await page.locator('button[title="テキスト"]').click();
  await clickDocumentPoint(page, { x: 24, y: 52 });

  await expect(page.locator(".layer-row")).toHaveCount(2);
  const editor = page.locator(".section").filter({
    has: page.locator('textarea[placeholder="文字を入力…"]'),
  });
  await expect(editor).toBeVisible();

  await editor.locator("textarea").fill("E2E");
  await expect(editor.locator("textarea")).toHaveValue("E2E");

  const textRegion = { x: 20, y: 8, width: 120, height: 60 };
  await expect
    .poll(() => countDarkCompositePixels(page, textRegion))
    .toBeGreaterThan(20);

  await editor.getByRole("button", { name: "テキストレイヤー削除" }).click();
  await expect(page.locator(".layer-row")).toHaveCount(1);
  await expect(editor).toBeHidden();
  await expect
    .poll(() => countDarkCompositePixels(page, textRegion))
    .toBeLessThan(5);
});
