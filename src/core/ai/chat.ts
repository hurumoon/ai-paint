import { ChatMessage, GuideShape } from "../../types";
import { chatSystemPrompt } from "./prompts";
import { parseAIResponseWithFallback } from "./parse";
import { invokeClaudeCommand } from "./transport";
import { OMITTED_CHAT_IMAGE_TEXT, retainLatestChatImage } from "../chatHistory";

export interface ChatOptions {
  messages: ChatMessage[];
}

export interface ChatResult {
  advice: string;
  guides: GuideShape[];
  palette?: string[];
  raw: string;
}

interface ChatTurnPayload {
  role: "user" | "assistant";
  text: string;
  image_base64?: string;
}

export async function chatWithClaude(opts: ChatOptions): Promise<ChatResult> {
  const history: ChatTurnPayload[] = retainLatestChatImage(opts.messages).map((m) => ({
    role: m.role,
    text: m.role === "user" && m.imageOmitted
      ? [m.text, OMITTED_CHAT_IMAGE_TEXT].filter(Boolean).join("\n")
      : m.text,
    image_base64: m.role === "user" ? m.imageBase64 : undefined,
  }));

  const result = await invokeClaudeCommand("chat_with_claude", {
    systemPrompt: chatSystemPrompt(),
    history,
  });

  const parsed = parseAIResponseWithFallback(result.text);
  return {
    advice: parsed.advice || result.text,
    guides: parsed.guides,
    palette: parsed.palette,
    raw: result.text,
  };
}
