import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

function installStorage(): Map<string, string> {
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
  return store;
}

describe("AI Tauri transport", () => {
  let storage: Map<string, string>;

  beforeEach(() => {
    invokeMock.mockReset();
    storage = installStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("invokes the requested Claude command and records token usage", async () => {
    const { invokeClaudeCommand } = await import("../../src/core/ai/transport");
    invokeMock.mockResolvedValueOnce({
      text: '{"advice":"ok"}',
      usage: {
        input_tokens: 12.4,
        output_tokens: 8,
        cache_creation_input_tokens: 3,
        cache_read_input_tokens: 2,
      },
    });

    const result = await invokeClaudeCommand("analyze_canvas_v2", {
      mainImageBase64: "image",
    });

    expect(result.text).toBe('{"advice":"ok"}');
    expect(invokeMock).toHaveBeenCalledWith("analyze_canvas_v2", {
      mainImageBase64: "image",
    });
    expect(JSON.parse(storage.get("ai-paint-token-usage") ?? "{}")).toEqual({
      input: 12,
      output: 8,
      cacheCreate: 3,
      cacheRead: 2,
      requests: 1,
    });
    expect(window.dispatchEvent).toHaveBeenCalledTimes(1);
  });

  it("passes API key commands through without writing usage", async () => {
    const { clearClaudeApiKey, hasClaudeApiKey, setClaudeApiKey } = await import(
      "../../src/core/ai/transport"
    );
    invokeMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(false);

    await expect(setClaudeApiKey("sk-test")).resolves.toBe(true);
    await expect(clearClaudeApiKey()).resolves.toBeUndefined();
    await expect(hasClaudeApiKey()).resolves.toBe(false);

    expect(invokeMock).toHaveBeenNthCalledWith(1, "set_claude_api_key", {
      apiKey: "sk-test",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "clear_claude_api_key");
    expect(invokeMock).toHaveBeenNthCalledWith(3, "has_claude_api_key");
    expect(storage.has("ai-paint-token-usage")).toBe(false);
  });
});
