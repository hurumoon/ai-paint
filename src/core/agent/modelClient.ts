import { invoke } from "@tauri-apps/api/core";
import type { ModelRequest, ModelResponse } from "./modelTypes";

export interface RequestModelOptions {
  signal?: AbortSignal;
}

function abortedError(): DOMException {
  return new DOMException("モデルへのリクエストを中止しました", "AbortError");
}

export async function requestModel(
  request: ModelRequest,
  options: RequestModelOptions = {}
): Promise<ModelResponse> {
  const { signal } = options;
  if (signal?.aborted) throw abortedError();

  const invocation = invoke<ModelResponse>("request_model", { request });
  if (!signal) return await invocation;

  let onAbort: (() => void) | undefined;
  const cancellation = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(abortedError());
    signal.addEventListener("abort", onAbort, { once: true });
  });

  try {
    return await Promise.race([invocation, cancellation]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

export async function setGptApiKey(apiKey: string): Promise<boolean> {
  return await invoke<boolean>("set_gpt_api_key", { apiKey });
}

export async function clearGptApiKey(): Promise<void> {
  await invoke<void>("clear_gpt_api_key");
}

export async function hasGptApiKey(): Promise<boolean> {
  return await invoke<boolean>("has_gpt_api_key");
}
