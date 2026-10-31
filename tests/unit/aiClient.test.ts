import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

function installStorage(): void {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
  });
  vi.stubGlobal("window", {
    dispatchEvent: vi.fn(),
  });
}

describe("AI client command payloads", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    installStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends canvas analysis through analyze_canvas_v2 and parses the response", async () => {
    const { analyzeCanvas } = await import("../../src/core/aiClient");
    invokeMock.mockResolvedValueOnce({
      text: JSON.stringify({
        advice: "構図を確認",
        guides: [{ type: "rect", x: 0.1, y: 0.2, w: 0.3, h: 0.4, color: "#ffffff" }],
      }),
    });

    const result = await analyzeCanvas({
      mode: "composition",
      stage: "rough",
      userPrompt: "余白を見て",
      mainImageBase64: "main",
      referenceImages: [{ mediaType: "image/png", base64: "ref" }],
      auxiliaryImages: [{ mediaType: "image/png", base64: "aux" }],
      canvasWidth: 800,
      canvasHeight: 600,
      enhancedAnalysis: true,
    });

    expect(result.advice).toBe("構図を確認");
    expect(result.guides).toHaveLength(1);
    expect(invokeMock).toHaveBeenCalledWith(
      "analyze_canvas_v2",
      expect.objectContaining({
        mainImageBase64: "main",
        referenceImages: [{ mediaType: "image/png", base64: "ref" }],
        auxiliaryImages: [{ mediaType: "image/png", base64: "aux" }],
      })
    );
    expect(invokeMock.mock.calls[0][1].userText).toContain("800×600");
    expect(invokeMock.mock.calls[0][1].userText).toContain("余白を見て");
  });

  it("sends comparison as previous main image plus current auxiliary image", async () => {
    const { compareCanvas } = await import("../../src/core/aiClient");
    invokeMock.mockResolvedValueOnce({
      text: JSON.stringify({ advice: "良くなった", guides: [] }),
    });

    const result = await compareCanvas({
      previousBase64: "before",
      currentBase64: "after",
      canvasWidth: 320,
      canvasHeight: 240,
    });

    expect(result.advice).toBe("良くなった");
    expect(invokeMock).toHaveBeenCalledWith(
      "analyze_canvas_v2",
      expect.objectContaining({
        mainImageBase64: "before",
        referenceImages: [],
        auxiliaryImages: [{ mediaType: "image/png", base64: "after" }],
      })
    );
  });

  it("sends chat history images only for user messages", async () => {
    const { chatWithClaude } = await import("../../src/core/ai/chat");
    invokeMock.mockResolvedValueOnce({
      text: JSON.stringify({
        advice: "線を整理",
        guides: [{ type: "line", x1: 0, y1: 0, x2: 1, y2: 1, color: "#abcdef" }],
        palette: ["#123456"],
      }),
    });

    const result = await chatWithClaude({
      messages: [
        { id: "u1", role: "user", text: "見て", imageBase64: "image" },
        { id: "a1", role: "assistant", text: "前回回答", imageBase64: "ignored" },
      ],
    });

    expect(result).toMatchObject({
      advice: "線を整理",
      palette: ["#123456"],
      raw: expect.any(String),
    });
    expect(invokeMock).toHaveBeenCalledWith(
      "chat_with_claude",
      expect.objectContaining({
        history: [
          { role: "user", text: "見て", image_base64: "image" },
          { role: "assistant", text: "前回回答", image_base64: undefined },
        ],
      })
    );
  });

  it("sends only the latest image even when called with untrimmed history", async () => {
    const { chatWithClaude } = await import("../../src/core/ai/chat");
    const { OMITTED_CHAT_IMAGE_TEXT } = await import("../../src/core/chatHistory");
    invokeMock.mockResolvedValueOnce({ text: "回答" });
    const messages = Array.from({ length: 30 }, (_, i) => ({
      id: `u-${i}`, role: "user" as const, text: i === 0 ? "" : `質問-${i}`,
      imageBase64: `image-${i}`, timestamp: i,
    }));
    await chatWithClaude({ messages: [...messages,
      { id: "follow-up", role: "user", text: "詳しく", timestamp: 30 }] });
    const history = invokeMock.mock.calls[0][1].history;
    expect(history).toHaveLength(31);
    expect(history.filter((m: { image_base64?: string }) => m.image_base64)).toEqual([
      { role: "user", text: "質問-29", image_base64: "image-29" },
    ]);
    expect(history[0].text).toBe(OMITTED_CHAT_IMAGE_TEXT);
    expect(history[1].text).toBe(`質問-1\n${OMITTED_CHAT_IMAGE_TEXT}`);
    expect(history[30].text).toBe("詳しく");
    expect(messages[0].imageBase64).toBe("image-0");
  });
});
