import type { DrawingAgent } from "../../core/agent/runner";
import type { DrawingAgentLimits } from "../../core/agent/session";
import type { DrawingAgentReference } from "../../core/agent/referenceImages";
import type { PaintApiDefinition, PaintApiExecuteResult } from "../../core/paintApi";
import { validateJsonSchema } from "../../core/paintApi/validation";
import { DEFAULT_OPENAI_AGENT_MODEL } from "../../core/agent/modelTypes";
import { objectSchema, enumSchema, stringSchema } from "./settingsApi";

const limitsSchema = objectSchema({
  maxIterations: { type: "integer", minimum: 1, maximum: 10000 },
  maxDurationMs: { type: "integer", minimum: 1000, maximum: 24 * 60 * 60 * 1000 },
  maxInputTokens: { type: "integer", minimum: 1, maximum: 10000000 },
  maxOutputTokens: { type: "integer", minimum: 1, maximum: 10000000 },
  maxTotalTokens: { type: "integer", minimum: 1, maximum: 20000000 },
  maxModelCalls: { type: "integer", minimum: 1, maximum: 10000 },
  maxToolCalls: { type: "integer", minimum: 1, maximum: 100000 },
  maxRecordingFrames: { type: "integer", minimum: 2, maximum: 180 },
  maxRecordingFrameBytes: { type: "integer", minimum: 1, maximum: 12 * 1024 * 1024 },
  maxRecordingBytes: { type: "integer", minimum: 1, maximum: 48 * 1024 * 1024 },
  maxOperationRecords: { type: "integer", minimum: 1, maximum: 2000 },
});
const referenceSchema = objectSchema({
  id: { type: "string", minLength: 1, maxLength: 200 },
  name: { type: "string", minLength: 1, maxLength: 300 },
  dataUrl: { type: "string", minLength: 1, maxLength: 2_811_000 },
  width: { type: "integer", minimum: 1, maximum: 1536 },
  height: { type: "integer", minimum: 1, maximum: 1536 },
  byteLength: { type: "integer", minimum: 1, maximum: 2 * 1024 * 1024 },
}, ["id", "name", "dataUrl", "width", "height", "byteLength"]);
const referencesSchema = { type: "array", maxItems: 3, items: referenceSchema };
export const agentControlDefinitions: PaintApiDefinition[] = [
  { name: "agent.get_state", description: "AIドロー（β版）の状態・工程・使用量を取得", mutates: false, parameters: objectSchema({}) },
  { name: "agent.get_recording", description: "制作画像と操作の記録を取得", mutates: false, parameters: objectSchema({}) },
  { name: "agent.start", description: "指示から自動描画を開始。完了を待たず状態を返す", mutates: true, parameters: objectSchema({ prompt: stringSchema, provider: enumSchema(["openai", "anthropic"]), model: stringSchema, limits: limitsSchema, references: referencesSchema }, ["prompt", "provider", "model"]) },
  { name: "agent.start_reference", description: "お手本を現在のキャンバスの新規レイヤーに再描画。APIキー不要", mutates: true, parameters: objectSchema({ reference: referenceSchema }, ["reference"]) },
  { name: "agent.resume", description: "保存された工程から再開", mutates: true, parameters: objectSchema({ limits: limitsSchema, references: referencesSchema }) },
  { name: "agent.pause", description: "進行中の自動描画を一時停止", mutates: true, parameters: objectSchema({}) },
  { name: "agent.stop", description: "自動描画を中止", mutates: true, parameters: objectSchema({}) },
];

export async function executeAgentControl(agent: DrawingAgent, name: string, args: Record<string, unknown>): Promise<PaintApiExecuteResult> {
  const definition = agentControlDefinitions.find(d => d.name === name);
  if (!definition) return { ok: false, error: { code: "NOT_FOUND", message: "APIがありません" } };
  const errors = validateJsonSchema(args, definition.parameters);
  if (errors.length) return { ok: false, error: { code: "INVALID_ARGUMENT", message: "引数が不正です", details: errors } };
  try {
    if (name === "agent.get_recording") return { ok: true, value: agent.getSession()?.recording ?? null };
    if (name === "agent.start") {
      const task = agent.start({ prompt: args.prompt as string, provider: args.provider as "openai" | "anthropic", model: (args.model ?? DEFAULT_OPENAI_AGENT_MODEL) as string, limits: args.limits as Partial<DrawingAgentLimits> | undefined, references: args.references as DrawingAgentReference[] | undefined });
      // 非同期の実行失敗はAgent自身の状態に記録され、get_stateで取得できる。
      void task.catch(() => undefined);
    }
    if (name === "agent.start_reference") { const task = agent.startReference(args.reference as DrawingAgentReference); void task.catch(() => undefined); }
    if (name === "agent.resume") { const task = agent.resume({ limits: args.limits as Partial<DrawingAgentLimits> | undefined, references: args.references as DrawingAgentReference[] | undefined }); void task.catch(() => undefined); }
    if (name === "agent.pause") agent.pause();
    if (name === "agent.stop") await agent.stop();
    return { ok: true, value: agent.getSnapshot() };
  } catch (error) { return { ok: false, error: { code: "EXECUTION_FAILED", message: error instanceof Error ? error.message : String(error) } }; }
}
