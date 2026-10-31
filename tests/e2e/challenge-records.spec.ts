import { expect, test } from "@playwright/test";

test("challenge records persist, sort newest first, and delete through IndexedDB", async ({
  page,
}) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const records = await import("/src/core/challengeRecords.ts");
    const existing = await records.loadChallengeRecords();
    await Promise.all(existing.map((record) => records.deleteChallengeRecord(record.id)));

    const base = {
      category: "drawing" as const,
      prompt: "箱を描く",
      timerMode: "countdown" as const,
      strictness: "normal" as const,
      durationSec: 60,
      score: 70,
      subscores: {
        structure: 18,
        color: 17,
        completion: 16,
      },
      advice: "続けましょう",
      thumbnailBase64: "data:image/png;base64,test",
    };
    await records.saveChallengeRecord({
      ...base,
      id: "older",
      createdAt: 100,
    });
    await records.saveChallengeRecord({
      ...base,
      id: "newer",
      createdAt: 200,
    });
    const ordered = await records.loadChallengeRecords();
    await records.deleteChallengeRecord("newer");
    const afterDelete = await records.loadChallengeRecords();
    await records.deleteChallengeRecord("older");
    return {
      orderedIds: ordered.map((record) => record.id),
      remainingIds: afterDelete.map((record) => record.id),
    };
  });

  expect(result.orderedIds).toEqual(["newer", "older"]);
  expect(result.remainingIds).toEqual(["older"]);
});
