import { expect, test } from "@playwright/test";
import { createCanvas } from "./canvas-helpers";

test("replaces old attachments while preserving chat history and the latest follow-up image", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    const calls: { history: { text: string; image_base64?: string }[] }[] = [];
    Object.assign(window, {
      __CHAT_TEST_CALLS__: calls,
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => undefined },
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
        transformCallback: () => 1,
        unregisterCallback: () => undefined,
        invoke: async (command: string, args: { history: { text: string; image_base64?: string }[] }) => {
          if (command === "has_claude_api_key") return true;
          if (command === "chat_with_claude") {
            calls.push(args);
            return { text: JSON.stringify({ advice: `回答${calls.length}`, guides: [], palette: ["#123456"] }) };
          }
          return null;
        },
      },
    });
  });
  await page.goto("/");
  await createCanvas(page, { width: 80, height: 60, dpi: 144 });
  const panel = page.locator(".chat-panel");
  const send = panel.getByRole("button", { name: "送信", exact: true });
  for (let i = 1; i <= 2; i++) {
    await panel.getByRole("checkbox").check();
    await panel.locator("textarea").fill(`質問${i}`);
    await send.click();
    await expect(panel.getByText(`回答${i}`, { exact: true })).toBeVisible();
  }
  await expect(panel.locator(".chat-msg-image")).toHaveCount(1);
  await expect(panel.getByText("質問1", { exact: true })).toBeVisible();
  await expect(panel.getByText(/以前の添付画像は省略済み/)).toHaveCount(1);
  await expect(panel.getByRole("button", { name: "パレット再表示" })).toHaveCount(2);
  await panel.locator("textarea").fill("詳しく");
  await send.click();
  await expect(panel.getByText("回答3", { exact: true })).toBeVisible();
  const histories = await page.evaluate(() => (window as unknown as {
    __CHAT_TEST_CALLS__: { history: { text: string; image_base64?: string }[] }[];
  }).__CHAT_TEST_CALLS__.map(call => call.history));
  expect(histories.map(history => history.filter(m => m.image_base64).length)).toEqual([1, 1, 1]);
  expect(histories[2][0].image_base64).toBeUndefined();
  expect(histories[2][2].image_base64).toBe(histories[1][2].image_base64);
  expect(histories[2][0].text).toContain("質問1");
  await panel.getByRole("button", { name: "会話をクリア" }).click();
  await expect(panel.locator(".chat-msg")).toHaveCount(0);
});
