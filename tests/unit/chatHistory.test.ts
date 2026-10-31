import { describe, expect, it } from "vitest";
import { retainLatestChatImage } from "../../src/core/chatHistory";
import type { ChatMessage } from "../../src/types";

function attachment(index: number): ChatMessage {
  return {
    id: `u-${index}`, role: "user", text: "", timestamp: index,
    imageBase64: `image-${index}`, imagePreviewUrl: `data:image/png;base64,image-${index}`,
    imageSentWidth: 100, imageSentHeight: 50, imageDocWidth: 1000, imageDocHeight: 500,
  };
}

describe("chat image retention", () => {
  it("bounds image data across 30 turns while preserving text and action history", () => {
    let history: ChatMessage[] = [];
    for (let i = 0; i < 30; i++) {
      history = retainLatestChatImage([...history, attachment(i)]);
      history.push({ id: `a-${i}`, role: "assistant", text: `answer-${i}`, timestamp: i,
        palette: ["#123456"], guides: [] });
      expect(history.filter(m => m.imageBase64)).toHaveLength(1);
      expect(history.filter(m => m.imagePreviewUrl)).toHaveLength(1);
    }
    expect(history).toHaveLength(60);
    expect(history.filter(m => m.imageOmitted)).toHaveLength(29);
    expect(history[1]).toMatchObject({ text: "answer-0", palette: ["#123456"], guides: [] });
    expect(history[58]).toEqual(attachment(29));
  });

  it("keeps the latest image and its guide coordinate reference on text-only follow-ups", () => {
    const latest = attachment(1);
    const history = retainLatestChatImage([attachment(0), latest,
      { id: "follow-up", role: "user", text: "補助線をください", timestamp: 2 }]);
    expect(history[1]).toBe(latest);
    expect(history[1]).toMatchObject({ imageDocWidth: 1000, imageSentWidth: 100 });
    expect(retainLatestChatImage(history)).toEqual(history);
  });

  it("releases both representations without mutating input and ignores assistant images", () => {
    const old = attachment(0);
    const latest = attachment(1);
    const invalid: ChatMessage = { ...attachment(2), role: "assistant" };
    const result = retainLatestChatImage([old, latest, invalid]);
    expect(result[0]).not.toHaveProperty("imageBase64");
    expect(result[0]).not.toHaveProperty("imagePreviewUrl");
    expect(old).toEqual(attachment(0));
    expect(result[1]).toBe(latest);
    expect(result[2].imageBase64).toBeUndefined();
    expect(retainLatestChatImage([])).toEqual([]);
  });
});
