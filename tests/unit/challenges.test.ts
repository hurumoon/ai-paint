import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getDefaultChallengeItems,
  normalizeChallengeItems,
  pickChallengeItem,
} from "../../src/core/challenges";

describe("challenge items", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("drops invalid entries, trims prompts, and replaces duplicate ids", () => {
    vi.spyOn(Date, "now").mockReturnValue(123);
    vi.spyOn(Math, "random").mockReturnValue(0.25);

    const items = normalizeChallengeItems([
      { id: "same", category: "drawing", prompt: "  first  ", enabled: true },
      { id: "same", category: "color", prompt: "second", enabled: false },
      { id: "bad", category: "unknown", prompt: "ignored", enabled: true },
      { id: "empty", category: "line", prompt: "   ", enabled: true },
    ]);

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ id: "same", prompt: "first" });
    expect(items[1].id).not.toBe("same");
    expect(new Set(items.map((item) => item.id)).size).toBe(2);
  });

  it("uses the default pool when every configured item is disabled", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const selected = pickChallengeItem([
      {
        id: "disabled",
        category: "drawing",
        prompt: "disabled prompt",
        enabled: false,
      },
    ]);

    expect(selected).toEqual(getDefaultChallengeItems()[0]);
  });

  it("does not repeat the excluded challenge when another enabled item exists", () => {
    const first = {
      id: "first",
      category: "drawing" as const,
      prompt: "first",
      enabled: true,
    };
    const second = {
      id: "second",
      category: "color" as const,
      prompt: "second",
      enabled: true,
    };
    vi.spyOn(Math, "random")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.75);

    expect(pickChallengeItem([first, second], first)).toEqual(second);
  });
});
