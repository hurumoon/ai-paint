import { expect, test } from "@playwright/test";

test("bundles licenses and source availability notices in About", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("このアプリについて", { exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "AI Paintについて" });
  await expect(dialog).toBeVisible();
  await dialog.getByText("本体のライセンス", { exact: true }).click();
  const appLicense = dialog.locator("details").nth(0).locator("pre");
  await expect(appLicense).toContainText("MIT License");
  await expect(appLicense).toContainText("Copyright (c) 2026 hurumoon");

  await dialog.getByText("第三者ライセンスとソースの入手方法", { exact: true }).click();
  const thirdParty = dialog.locator("details").nth(1).locator("pre");
  await expect(thirdParty).toContainText("Lucide");
  await expect(thirdParty).toContainText("Feather");
  await expect(thirdParty).toContainText("Mozilla Public License");
  await expect(thirdParty).toContainText("https://github.com/hurumoon/ai-paint");

  await dialog.getByRole("button", { name: "閉じる", exact: true }).click();
  await expect(dialog).toBeHidden();
});
