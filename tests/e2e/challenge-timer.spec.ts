import { expect, test, type Page } from "@playwright/test";

interface ScoreCall {
  durationSec: number;
  timerMode: "countdown" | "countup";
}

declare global {
  interface Window {
    __challengeTimerTestCalls__?: ScoreCall[];
  }
}

async function mountChallengeTimer(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const React = (await import("/node_modules/.vite/deps/react.js")).default;
    const { createRoot } = (await import("/node_modules/.vite/deps/react-dom_client.js")).default;
    const { AIChallengeMode } = await import("/src/components/AIChallengeMode.tsx");
    const calls: ScoreCall[] = [];
    window.__challengeTimerTestCalls__ = calls;

    const host = document.createElement("div");
    document.body.append(host);
    createRoot(host).render(React.createElement(
      React.StrictMode,
      null,
      React.createElement(AIChallengeMode, {
        canScore: true,
        isScoring: false,
        challengeItems: [{
          id: "timer-test",
          category: "drawing",
          prompt: "時計を描く",
          enabled: true,
        }],
        onScoreChallenge: async (input: ScoreCall) => {
          calls.push(input);
          return {
            id: `timer-test-${calls.length}`,
            createdAt: Date.now(),
            category: "drawing",
            prompt: "時計を描く",
            timerMode: input.timerMode,
            durationSec: input.durationSec,
            strictness: "normal",
            score: 80,
            advice: "テスト採点",
          };
        },
      })
    ));
  });
}

async function openChallengeTimer(page: Page): Promise<ReturnType<Page["locator"]>> {
  await page.locator("button.ai-challenge-launch").click();
  const panel = page.getByRole("group", { name: "課題モード" });
  await expect(panel).toBeVisible();
  return panel;
}

async function scoreCalls(page: Page): Promise<ScoreCall[]> {
  return await page.evaluate(() => (window.__challengeTimerTestCalls__ ?? []).map(
    ({ durationSec, timerMode }) => ({ durationSec, timerMode })
  ));
}

async function persistedDurations(page: Page): Promise<number[]> {
  return await page.evaluate(async () => {
    const { loadChallengeRecords } = await import("/src/core/challengeRecords.ts");
    const records = await loadChallengeRecords();
    return records
      .filter((record) => record.id.startsWith("timer-test-"))
      .map((record) => record.durationSec);
  });
}

async function shiftSystemTime(page: Page, milliseconds: number): Promise<void> {
  const current = await page.evaluate(() => Date.now());
  await page.clock.setSystemTime(current + milliseconds);
}

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date("2025-01-01T00:00:00.000Z") });
  await page.goto("/");
  await mountChallengeTimer(page);
});

test("uses elapsed wall time when the interval callback is delayed", async ({ page }) => {
  const panel = await openChallengeTimer(page);
  await panel.locator(".ai-challenge-mode-toggle").click();
  await panel.getByRole("button", { name: "開始", exact: true }).click();

  // setSystemTime advances Date.now() without delivering the missed interval callbacks.
  await shiftSystemTime(page, 5_000);
  await page.clock.fastForward(1_000);

  await expect(panel.locator(".ai-challenge-time")).toContainText("0:06");
  await panel.getByRole("button", { name: "終了", exact: true }).click();
  await expect.poll(() => scoreCalls(page)).toEqual([
    { durationSec: 6, timerMode: "countup" },
  ]);
  await expect.poll(() => persistedDurations(page)).toEqual([6]);
});

test("manual finish snapshots elapsed time before the first interval callback", async ({ page }) => {
  const panel = await openChallengeTimer(page);
  await panel.locator(".ai-challenge-mode-toggle").click();
  await panel.getByRole("button", { name: "開始", exact: true }).click();

  await shiftSystemTime(page, 4_500);
  await panel.getByRole("button", { name: "終了", exact: true }).click();

  await expect.poll(() => scoreCalls(page)).toEqual([
    { durationSec: 4, timerMode: "countup" },
  ]);
  await expect.poll(() => persistedDurations(page)).toEqual([4]);
  await expect(page.locator(".ai-challenge-result-meta")).toContainText("0:04");
});

test("pause preserves fractional elapsed time and excludes the paused period", async ({ page }) => {
  const panel = await openChallengeTimer(page);
  await panel.locator(".ai-challenge-mode-toggle").click();
  await panel.getByRole("button", { name: "開始", exact: true }).click();
  await page.clock.runFor(2_500);
  await panel.getByRole("button", { name: "一時停止", exact: true }).click();
  await expect(panel.locator(".ai-challenge-time")).toContainText("0:02");

  await page.clock.runFor(5_000);
  await expect(panel.locator(".ai-challenge-time")).toContainText("0:02");
  await panel.getByRole("button", { name: "再開", exact: true }).click();
  await page.clock.runFor(1_500);

  await expect(panel.locator(".ai-challenge-time")).toContainText("0:03");
  await panel.getByRole("button", { name: "終了", exact: true }).click();
  await expect.poll(() => scoreCalls(page)).toEqual([
    { durationSec: 4, timerMode: "countup" },
  ]);
  await expect.poll(() => persistedDurations(page)).toEqual([4]);
});

test("countdown clamps at its limit and scores only once", async ({ page }) => {
  const panel = await openChallengeTimer(page);
  // 10 -> 15 -> 30 -> 5 minutes.
  await panel.locator(".ai-challenge-time").click();
  await panel.locator(".ai-challenge-time").click();
  await panel.locator(".ai-challenge-time").click();
  await expect(panel.locator(".ai-challenge-time")).toContainText("5:00");
  await panel.getByRole("button", { name: "開始", exact: true }).click();
  await page.clock.fastForward("05:01");

  await expect(page.locator(".ai-challenge-result-head")).toContainText("時間切れ");
  await expect(page.locator(".ai-challenge-result-meta")).toContainText("5:00");
  await expect.poll(() => scoreCalls(page)).toEqual([
    { durationSec: 300, timerMode: "countdown" },
  ]);
  await expect.poll(() => persistedDurations(page)).toEqual([300]);
  await page.clock.fastForward(10_000);
  expect(await scoreCalls(page)).toHaveLength(1);
});

test("resetting a paused run clears its accumulated duration", async ({ page }) => {
  const panel = await openChallengeTimer(page);
  await panel.locator(".ai-challenge-mode-toggle").click();
  await panel.getByRole("button", { name: "開始", exact: true }).click();
  await page.clock.runFor(2_500);
  await panel.getByRole("button", { name: "一時停止", exact: true }).click();

  // Changing the timer mode resets the completed portion of a stopped run.
  await panel.locator(".ai-challenge-mode-toggle").click();
  await expect(panel.locator(".ai-challenge-time")).toContainText("10:00");
  await panel.locator(".ai-challenge-mode-toggle").click();
  await expect(panel.locator(".ai-challenge-time")).toContainText("0:00");
  await panel.getByRole("button", { name: "開始", exact: true }).click();
  await shiftSystemTime(page, 1_500);
  await panel.getByRole("button", { name: "終了", exact: true }).click();

  await expect.poll(() => scoreCalls(page)).toEqual([
    { durationSec: 1, timerMode: "countup" },
  ]);
  await expect.poll(() => persistedDurations(page)).toEqual([1]);
});
