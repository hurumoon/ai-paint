import { invoke } from "@tauri-apps/api/core";
import { recordAITokenUsage } from "../aiTokenUsage";

export interface ClaudeCommandResponse {
  text: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

function recordClaudeUsage(result: ClaudeCommandResponse): void {
  recordAITokenUsage({
    input: result.usage?.input_tokens,
    output: result.usage?.output_tokens,
    cacheCreate: result.usage?.cache_creation_input_tokens,
    cacheRead: result.usage?.cache_read_input_tokens,
  });
}

export async function invokeClaudeCommand(
  command: "analyze_canvas_v2" | "chat_with_claude",
  args: Record<string, unknown>
): Promise<ClaudeCommandResponse> {
  const result = await invoke<ClaudeCommandResponse>(command, args);
  recordClaudeUsage(result);
  return result;
}

export async function setClaudeApiKey(apiKey: string): Promise<boolean> {
  return await invoke<boolean>("set_claude_api_key", { apiKey });
}

export async function clearClaudeApiKey(): Promise<void> {
  await invoke<void>("clear_claude_api_key");
}

export async function hasClaudeApiKey(): Promise<boolean> {
  return await invoke<boolean>("has_claude_api_key");
}
