import { describe, expect, it } from "vitest";
import {
  expandGuidesToDocSize,
  extractJsonObject,
  parseAIResponse,
  parseAIResponseWithFallback,
  parseChallengeScore,
  parseChallengeScoreWithFallback,
  parseQuadrantId,
} from "../../src/core/ai/parse";

describe("ai parse helpers", () => {
  it("extracts the first balanced JSON object from fenced text", () => {
    expect(
      extractJsonObject('prefix ```json\n{"advice":"ok","nested":{"x":"}"}}\n``` suffix')
    ).toBe('{"advice":"ok","nested":{"x":"}"}}');
  });

  it("falls back to the default quadrant for malformed model output", () => {
    expect(parseQuadrantId("not json")).toBe("leftTop");
    expect(parseQuadrantId('{"quadrant":"rightBottom"}')).toBe("rightBottom");
  });

  it("sanitizes AI responses to valid guides and palette entries", () => {
    const parsed = parseAIResponse(
      JSON.stringify({
        advice: "check values",
        guides: [
          { type: "line", x1: 1, y1: 2, x2: 3, y2: 4, color: "#abc" },
          { type: "circle", cx: "bad", cy: 2, r: 3, color: "red" },
        ],
        palette: ["#123456", "red", "#fff"],
      })
    );

    expect(parsed).toEqual({
      advice: "check values",
      guides: [{ type: "line", x1: 1, y1: 2, x2: 3, y2: 4, color: "#abc" }],
      palette: ["#123456", "#fff"],
    });
  });

  it("falls back to raw advice when AI response JSON is malformed", () => {
    expect(parseAIResponseWithFallback('{"advice":"途中で壊れた"')).toEqual({
      advice: '{"advice":"途中で壊れた"',
      guides: [],
    });
  });

  it("clamps challenge scores and drops invalid guides", () => {
    const result = parseChallengeScore(
      JSON.stringify({
        score: 140,
        subscores: { structure: -1, color: 52.4, completion: 101 },
        advice: "  keep going  ",
        guides: [
          { type: "rect", x: 1, y: 2, w: 3, h: 4, color: "#ff00aa" },
          { type: "line", x1: 1, y1: 2, x2: Number.NaN, y2: 4 },
        ],
      })
    );

    expect(result.score).toBe(100);
    expect(result.subscores).toEqual({
      structure: 0,
      color: 52,
      completion: 100,
    });
    expect(result.advice).toBe("keep going");
    expect(result.guides).toEqual([
      { type: "rect", x: 1, y: 2, w: 3, h: 4, color: "#ff00aa" },
    ]);
  });

  it("falls back to raw advice when challenge score JSON is malformed", () => {
    const result = parseChallengeScoreWithFallback("採点本文だけが返った");

    expect(result).toEqual({
      score: 0,
      advice: "採点JSONを解析できませんでした。AIの返答をそのまま表示します。\n\n採点本文だけが返った",
      guides: [],
    });
  });

  it("expands normalized guide coordinates back to document size", () => {
    expect(
      expandGuidesToDocSize(
        [{ type: "circle", cx: 0.5, cy: 0.25, r: 0.1, color: "#fff" }],
        200,
        100,
        100,
        50
      )
    ).toEqual([{ type: "circle", cx: 100, cy: 25, r: 20, color: "#fff" }]);

    expect(
      expandGuidesToDocSize(
        [{ type: "rect", x: 50, y: 25, w: 20, h: 10, color: "#fff" }],
        200,
        100,
        100,
        50
      )
    ).toEqual([{ type: "rect", x: 100, y: 50, w: 40, h: 20, color: "#fff" }]);
  });
});
