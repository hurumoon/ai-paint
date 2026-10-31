import { beforeEach, describe, expect, it, vi } from "vitest";
import { invokeClaudeCommand } from "../../src/core/ai/transport";
import { scoreChallenge } from "../../src/core/ai/challengeScoring";

vi.mock("../../src/core/ai/transport", () => ({
  invokeClaudeCommand: vi.fn(),
}));

describe("challenge scoring", () => {
  beforeEach(() => {
    vi.mocked(invokeClaudeCommand).mockResolvedValue({
      text: JSON.stringify({
        score: 80,
        subscores: {
          structure: 75,
          color: 82,
          completion: 79,
        },
        advice: "good",
        guides: [],
      }),
      usage: {},
    });
  });

  it("sends the challenge image and rounded session metadata through the scoring task", async () => {
    const result = await scoreChallenge({
      category: "composition",
      prompt: "主役を目立たせる",
      strictness: "strict",
      durationSec: 61.6,
      mainImageBase64: "image-data",
      canvasWidth: 640,
      canvasHeight: 480,
    });

    expect(invokeClaudeCommand).toHaveBeenCalledWith(
      "analyze_canvas_v2",
      expect.objectContaining({
        claudeTask: "challengeScoring",
        mainImageBase64: "image-data",
        referenceImages: [],
        userText: expect.stringMatching(
          /課題カテゴリ: 構図[\s\S]*課題内容: 主役を目立たせる[\s\S]*作業時間: 62秒[\s\S]*画像サイズ: 640×480px/
        ),
      })
    );
    expect(result.score).toBe(80);
  });
});
