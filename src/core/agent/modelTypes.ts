export type ModelProvider = "openai" | "anthropic";

export const DEFAULT_OPENAI_AGENT_MODEL = "gpt-6-astra";
export const DEFAULT_ANTHROPIC_AGENT_MODEL = "claude-sonnet-4-5";

export interface ModelTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ModelToolResult {
  callId: string;
  output: unknown;
  isError?: boolean;
}

export interface ModelRequest {
  provider: ModelProvider;
  model: string;
  instructions: string;
  text: string;
  imageDataUrl?: string;
  referenceImages?: { name: string; dataUrl: string }[];
  reasoningEffort?: "low" | "medium" | "high" | "xhigh" | "max";
  tools: ModelTool[];
  maxOutputTokens: number;
  continuation?: string;
  toolResults?: ModelToolResult[];
}

export interface ModelToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ModelResponse {
  text: string;
  calls: ModelToolCall[];
  inputTokens: number;
  outputTokens: number;
  continuation?: string;
}
