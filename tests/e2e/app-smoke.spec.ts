import { expect, test } from "@playwright/test";
import { createCanvas, drawHorizontalStroke } from "./canvas-helpers";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });
});

test("creates a canvas and keeps the drawing surface interactive", async ({ page }) => {
  await page.goto("/");

  await createCanvas(page);

  const inputCanvas = page.locator("canvas.input-canvas");
  await expect(inputCanvas).toHaveAttribute("width", "320");
  await expect(inputCanvas).toHaveAttribute("height", "240");

  await drawHorizontalStroke(page);

  await expect(page.locator('button[title="アンドゥ"]')).toBeEnabled();
  await page.locator('button[title="アンドゥ"]').click();
  await expect(page.locator('button[title="リドゥ"]')).toBeEnabled();
});

test("applies DPI from print resolution presets in the new canvas dialog", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator(".empty-canvas-title")).toBeVisible();
  await page.getByTestId("topbar-newCanvas").click();

  const dialog = page.getByTestId("new-canvas-dialog");
  await expect(dialog).toBeVisible();
  await dialog
    .getByTestId("new-canvas-resolution-preset")
    .selectOption("1748x2480");
  await expect(dialog.getByTestId("new-canvas-width")).toHaveValue("1748");
  await expect(dialog.getByTestId("new-canvas-height")).toHaveValue("2480");
  await expect(dialog.getByTestId("new-canvas-dpi")).toHaveValue("300");

  await dialog.getByTestId("new-canvas-create").click();
  await expect(page.locator(".statusbar")).toContainText(
    "1748×2480 @ 300dpi"
  );
});

test("applies QHD and 4K resolution presets in the new canvas dialog", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.locator(".empty-canvas-title")).toBeVisible();
  await page.getByTestId("topbar-newCanvas").click();

  const dialog = page.getByTestId("new-canvas-dialog");
  await expect(dialog).toBeVisible();

  const presets = [
    { value: "2560x1440", width: "2560", height: "1440" },
    { value: "3840x2160", width: "3840", height: "2160" },
    { value: "1080x1920", width: "1080", height: "1920" },
    { value: "1440x2560", width: "1440", height: "2560" },
    { value: "2160x3840", width: "2160", height: "3840" },
  ];

  for (const preset of presets) {
    await dialog
      .getByTestId("new-canvas-resolution-preset")
      .selectOption(preset.value);
    await expect(dialog.getByTestId("new-canvas-width")).toHaveValue(
      preset.width
    );
    await expect(dialog.getByTestId("new-canvas-height")).toHaveValue(
      preset.height
    );
  }
});
