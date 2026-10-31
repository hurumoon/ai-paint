import type { PaintDocument } from "../PaintDocument";
import { MAX_RASTER_IMAGE_DIMENSION } from "../rasterImageLimits";
import type { ModelProvider } from "./modelTypes";
import { validateAgentReferences } from "./referenceImages";
import type { DrawingAgentReference } from "./referenceImages";
import type { ReferenceDrawingProgress } from "./referenceRun";
import {
  MAX_AGENT_OPERATION_RECORDS,
  MAX_AGENT_RECORDING_BYTES,
  MAX_AGENT_RECORDING_FRAME_BYTES,
  MAX_AGENT_RECORDING_FRAMES,
  createDrawingAgentRecording,
  getPngDataUrlByteLength,
} from "./recording";
import type {
  DrawingAgentOperationRecord,
  DrawingAgentPreviewFrame,
  DrawingAgentRecording,
} from "./recording";

export const DRAWING_AGENT_SESSION_VERSION = 1;
// 録画 PNG 48 MiB と参照 PNG 6 MiB の data URL 化（約4/3）に、従来同等の JSON 余白を加える。
export const MAX_AGENT_SESSION_JSON_BYTES = 80 * 1024 * 1024;

export const DEFAULT_DRAWING_STAGES: readonly DrawingAgentStage[] = [
  {
    id: "composition",
    title: "構図",
    goal: "主題、視線誘導、余白、画面内の配置を決める",
    completionCriteria: ["主題と主要要素の位置が明確", "画面全体のバランスが成立"],
  },
  {
    id: "rough",
    title: "ラフ",
    goal: "形、ポーズ、比率、主要なディテールを具体化する",
    completionCriteria: ["主要な形と比率が読める", "清書に必要な情報が揃っている"],
  },
  {
    id: "line",
    title: "線画",
    goal: "必要な輪郭と内部線を整理する",
    completionCriteria: ["輪郭が意図どおり閉じている", "不要線が整理されている"],
  },
  {
    id: "base",
    title: "ベース塗り",
    goal: "主要な領域へ基準色を置く",
    completionCriteria: ["主要領域に塗り残しがない", "色の関係が狙いに合う"],
  },
  {
    id: "shadow",
    title: "影",
    goal: "光源と立体に沿った影を加える",
    completionCriteria: ["光源が一貫している", "立体と奥行きが読める"],
  },
  {
    id: "highlight",
    title: "ハイライト",
    goal: "光と質感を表す明部を加える",
    completionCriteria: ["光源と整合する", "素材の差が読める"],
  },
  {
    id: "finish",
    title: "仕上げ",
    goal: "全体を見直し、破綻、塗り残し、不要物を修正する",
    completionCriteria: ["全体画像を再確認済み", "目立つ破綻や未完成箇所がない"],
  },
] as const;

export type DrawingAgentStatus =
  | "idle"
  | "running"
  | "paused"
  | "completed"
  | "stopped"
  | "error"
  | "limit_reached";

export interface DrawingAgentStage {
  id: string;
  title: string;
  goal: string;
  completionCriteria: string[];
}

export interface DrawingAgentStageState {
  stageId: string;
  status: "pending" | "active" | "completed";
  visits: number;
  completedAt?: number;
  summary?: string;
  /** この工程の現在の訪問で、描画差分を要求する基準 revision。 */
  visitStartedRevision: number;
}

export interface DrawingAgentActivity {
  phase: "idle" | "observing" | "thinking" | "drawing" | "checking";
  label: string;
  startedAt: number;
  lastProgressAt: number;
  toolName?: string;
}

export interface DrawingAgentLimits {
  maxIterations: number;
  maxDurationMs: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxTotalTokens: number;
  maxModelCalls: number;
  maxToolCalls: number;
  maxRecordingFrames: number;
  maxRecordingFrameBytes: number;
  maxRecordingBytes: number;
  maxOperationRecords: number;
}

export const DEFAULT_DRAWING_AGENT_LIMITS: DrawingAgentLimits = {
  maxIterations: 120,
  maxDurationMs: 30 * 60 * 1_000,
  maxInputTokens: 300_000,
  maxOutputTokens: 80_000,
  maxTotalTokens: 360_000,
  maxModelCalls: 160,
  maxToolCalls: 600,
  maxRecordingFrames: MAX_AGENT_RECORDING_FRAMES,
  maxRecordingFrameBytes: MAX_AGENT_RECORDING_FRAME_BYTES,
  maxRecordingBytes: MAX_AGENT_RECORDING_BYTES,
  maxOperationRecords: MAX_AGENT_OPERATION_RECORDS,
};

export interface DrawingAgentUsage {
  iterations: number;
  elapsedMs: number;
  inputTokens: number;
  outputTokens: number;
  modelCalls: number;
  toolCalls: number;
}

export interface DrawingAgentMessageRecord {
  at: number;
  stageId: string;
  role: "model" | "system";
  text: string;
}

export interface DrawingAgentSession {
  version: 1;
  mode?: "reference";
  referenceProgress?: ReferenceDrawingProgress;
  id: string;
  bindingId: string;
  prompt: string;
  provider: ModelProvider;
  model: string;
  references: DrawingAgentReference[];
  status: DrawingAgentStatus;
  createdAt: number;
  updatedAt: number;
  stages: DrawingAgentStage[];
  stageStates: DrawingAgentStageState[];
  currentStageIndex: number;
  limits: DrawingAgentLimits;
  usage: DrawingAgentUsage;
  canvasRevision: number;
  lastInspectedRevision: number;
  messages: DrawingAgentMessageRecord[];
  recording: DrawingAgentRecording;
  error?: string;
  stopReason?: string;
}

export interface DrawingAgentSnapshot {
  mode?: "reference";
  referenceProgress?: ReferenceDrawingProgress;
  sessionId?: string;
  bindingId?: string;
  status: DrawingAgentStatus;
  settling: boolean;
  prompt: string;
  currentStageIndex: number;
  currentStage?: DrawingAgentStage;
  stages: readonly DrawingAgentStage[];
  stageStates: readonly DrawingAgentStageState[];
  usage: Readonly<DrawingAgentUsage>;
  limits: Readonly<DrawingAgentLimits>;
  recording: {
    frameCount: number;
    operationCount: number;
    totalFrameBytes: number;
    droppedFrames: number;
    droppedOperations: number;
  };
  lastMessage?: string;
  error?: string;
  stopReason?: string;
  activity?: DrawingAgentActivity;
}

const sessionsByDocument = new WeakMap<PaintDocument, DrawingAgentSession>();

export function getDrawingAgentSession(document: PaintDocument): DrawingAgentSession | undefined {
  const session = sessionsByDocument.get(document);
  return session ? cloneDrawingAgentSession(session) : undefined;
}

export function setDrawingAgentSession(
  document: PaintDocument,
  session: DrawingAgentSession | undefined
): void {
  if (!session) {
    sessionsByDocument.delete(document);
    return;
  }
  sessionsByDocument.set(document, validateDrawingAgentSession(session, false));
}

export function exportDrawingAgentSession(document: PaintDocument): string | undefined {
  const session = sessionsByDocument.get(document);
  return session ? serializeDrawingAgentSession(session) : undefined;
}

export function importDrawingAgentSession(
  document: PaintDocument,
  json: string
): DrawingAgentSession {
  const session = parseDrawingAgentSession(json);
  sessionsByDocument.set(document, session);
  return cloneDrawingAgentSession(session);
}

export function serializeDrawingAgentSession(session: DrawingAgentSession): string {
  const validated = validateDrawingAgentSession(session, false);
  const json = JSON.stringify(validated);
  if (utf8ByteLength(json) > MAX_AGENT_SESSION_JSON_BYTES) {
    throw new Error("AIドロー（β版）の制作記録の保存データが上限を超えています");
  }
  return json;
}

export function parseDrawingAgentSession(json: string): DrawingAgentSession {
  if (utf8ByteLength(json) > MAX_AGENT_SESSION_JSON_BYTES) {
    throw new Error("AIドロー（β版）の制作記録の保存データが上限を超えています");
  }
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error("AIドロー（β版）の制作記録の JSON が壊れています");
  }
  return validateDrawingAgentSession(value, true);
}

export function cloneDrawingAgentSession(session: DrawingAgentSession): DrawingAgentSession {
  return validateDrawingAgentSession(session, false);
}

export function validateDrawingAgentSession(
  value: unknown,
  pauseRunningSession = true
): DrawingAgentSession {
  const root = requireRecord(value, "AIドロー（β版）の制作記録");
  requireExact(root.version, DRAWING_AGENT_SESSION_VERSION, "version");
  const stages = requireArray(root.stages, "stages").map((stage, index) =>
    parseStage(stage, `stages[${index}]`)
  );
  if (stages.length === 0 || stages.length > 32) {
    throw new Error("stages は1〜32件で指定してください");
  }
  const ids = new Set(stages.map((stage) => stage.id));
  if (ids.size !== stages.length) throw new Error("stage id が重複しています");
  const currentStageIndex = requireInteger(root.currentStageIndex, "currentStageIndex", 0, stages.length - 1);
  const canvasRevision = requireInteger(root.canvasRevision, "canvasRevision", 0);
  const stageStates = requireArray(root.stageStates, "stageStates").map((state, index) =>
    parseStageState(state, `stageStates[${index}]`, canvasRevision)
  );
  if (
    stageStates.length !== stages.length ||
    stageStates.some((state, index) => state.stageId !== stages[index].id)
  ) {
    throw new Error("stageStates が stages と一致しません");
  }
  const parsedStatus = requireOneOf(
    root.status,
    ["idle", "running", "paused", "completed", "stopped", "error", "limit_reached"] as const,
    "status"
  );
  const limits = parseLimits(root.limits);
  const recording = parseRecording(root.recording, limits);
  const messages = requireArray(root.messages, "messages")
    .slice(-200)
    .map((message, index) => parseMessage(message, `messages[${index}]`));

  return {
    version: 1,
    ...(root.mode === undefined ? {} : { mode: requireOneOf(root.mode, ["reference"] as const, "mode") }),
    ...(root.referenceProgress === undefined ? {} : { referenceProgress: parseReferenceProgress(root.referenceProgress) }),
    id: requireString(root.id, "id", 1, 200),
    bindingId: requireString(root.bindingId, "bindingId", 1, 500),
    prompt: requireString(root.prompt, "prompt", 1, 50_000),
    provider: requireOneOf(root.provider, ["openai", "anthropic"] as const, "provider"),
    model: requireString(root.model, "model", 1, 200),
    references: validateAgentReferences(root.references),
    status: pauseRunningSession && parsedStatus === "running" ? "paused" : parsedStatus,
    createdAt: requireFinite(root.createdAt, "createdAt", 0),
    updatedAt: requireFinite(root.updatedAt, "updatedAt", 0),
    stages,
    stageStates,
    currentStageIndex,
    limits,
    usage: parseUsage(root.usage),
    canvasRevision,
    lastInspectedRevision: requireInteger(root.lastInspectedRevision, "lastInspectedRevision", -1),
    messages,
    recording,
    ...(root.error === undefined ? {} : { error: requireString(root.error, "error", 1, 10_000) }),
    ...(root.stopReason === undefined
      ? {}
      : { stopReason: requireString(root.stopReason, "stopReason", 1, 2_000) }),
  };
}

function parseReferenceProgress(value: unknown): ReferenceDrawingProgress {
  const progress = requireRecord(value, "referenceProgress");
  const totalStrokes = requireInteger(progress.totalStrokes, "totalStrokes", 0, 60_000);
  return {
    phase: requireOneOf(progress.phase, ["planning", "drawing"] as const, "phase"),
    completedStrokes: requireInteger(progress.completedStrokes, "completedStrokes", 0, totalStrokes),
    totalStrokes,
  };
}

function parseStage(value: unknown, path: string): DrawingAgentStage {
  const stage = requireRecord(value, path);
  const completionCriteria = requireArray(stage.completionCriteria, `${path}.completionCriteria`).map(
    (item, index) => requireString(item, `${path}.completionCriteria[${index}]`, 1, 2_000)
  );
  if (completionCriteria.length === 0 || completionCriteria.length > 20) {
    throw new Error(`${path}.completionCriteria は1〜20件で指定してください`);
  }
  return {
    id: requireString(stage.id, `${path}.id`, 1, 100),
    title: requireString(stage.title, `${path}.title`, 1, 200),
    goal: requireString(stage.goal, `${path}.goal`, 1, 4_000),
    completionCriteria,
  };
}

function parseStageState(
  value: unknown,
  path: string,
  legacyVisitStartedRevision: number
): DrawingAgentStageState {
  const state = requireRecord(value, path);
  return {
    stageId: requireString(state.stageId, `${path}.stageId`, 1, 100),
    status: requireOneOf(state.status, ["pending", "active", "completed"] as const, `${path}.status`),
    visits: requireInteger(state.visits, `${path}.visits`, 0),
    visitStartedRevision:
      state.visitStartedRevision === undefined
        ? legacyVisitStartedRevision
        : requireInteger(state.visitStartedRevision, `${path}.visitStartedRevision`, 0),
    ...(state.completedAt === undefined
      ? {}
      : { completedAt: requireFinite(state.completedAt, `${path}.completedAt`, 0) }),
    ...(state.summary === undefined
      ? {}
      : { summary: requireString(state.summary, `${path}.summary`, 1, 4_000) }),
  };
}

function parseLimits(value: unknown): DrawingAgentLimits {
  const limits = requireRecord(value, "limits");
  return {
    maxIterations: requireInteger(limits.maxIterations, "limits.maxIterations", 1, 10_000),
    maxDurationMs: requireInteger(limits.maxDurationMs, "limits.maxDurationMs", 1_000, 24 * 60 * 60 * 1_000),
    maxInputTokens: requireInteger(limits.maxInputTokens, "limits.maxInputTokens", 1, 10_000_000),
    maxOutputTokens: requireInteger(limits.maxOutputTokens, "limits.maxOutputTokens", 1, 10_000_000),
    maxTotalTokens: requireInteger(limits.maxTotalTokens, "limits.maxTotalTokens", 1, 20_000_000),
    maxModelCalls: requireInteger(limits.maxModelCalls, "limits.maxModelCalls", 1, 10_000),
    maxToolCalls: requireInteger(limits.maxToolCalls, "limits.maxToolCalls", 1, 100_000),
    maxRecordingFrames: requireInteger(limits.maxRecordingFrames, "limits.maxRecordingFrames", 2, MAX_AGENT_RECORDING_FRAMES),
    maxRecordingFrameBytes: requireInteger(limits.maxRecordingFrameBytes, "limits.maxRecordingFrameBytes", 1, MAX_AGENT_RECORDING_FRAME_BYTES),
    maxRecordingBytes: requireInteger(limits.maxRecordingBytes, "limits.maxRecordingBytes", 1, MAX_AGENT_RECORDING_BYTES),
    maxOperationRecords: requireInteger(limits.maxOperationRecords, "limits.maxOperationRecords", 1, MAX_AGENT_OPERATION_RECORDS),
  };
}

function parseUsage(value: unknown): DrawingAgentUsage {
  const usage = requireRecord(value, "usage");
  return {
    iterations: requireInteger(usage.iterations, "usage.iterations", 0),
    elapsedMs: requireFinite(usage.elapsedMs, "usage.elapsedMs", 0),
    inputTokens: requireInteger(usage.inputTokens, "usage.inputTokens", 0),
    outputTokens: requireInteger(usage.outputTokens, "usage.outputTokens", 0),
    modelCalls: requireInteger(usage.modelCalls, "usage.modelCalls", 0),
    toolCalls: requireInteger(usage.toolCalls, "usage.toolCalls", 0),
  };
}

function parseMessage(value: unknown, path: string): DrawingAgentMessageRecord {
  const message = requireRecord(value, path);
  return {
    at: requireFinite(message.at, `${path}.at`, 0),
    stageId: requireString(message.stageId, `${path}.stageId`, 1, 100),
    role: requireOneOf(message.role, ["model", "system"] as const, `${path}.role`),
    text: requireString(message.text, `${path}.text`, 1, 10_000),
  };
}

function parseRecording(value: unknown, limits: DrawingAgentLimits): DrawingAgentRecording {
  const recording = requireRecord(value, "recording");
  requireExact(recording.version, 1, "recording.version");
  const frames = requireArray(recording.frames, "recording.frames").map((frame, index) =>
    parseFrame(frame, `recording.frames[${index}]`)
  );
  if (frames.length > limits.maxRecordingFrames) throw new Error("録画フレーム数が上限を超えています");
  const totalFrameBytes = frames.reduce((sum, frame) => sum + frame.byteLength, 0);
  if (frames.some((frame) => frame.byteLength > limits.maxRecordingFrameBytes)) {
    throw new Error("録画フレームのサイズが上限を超えています");
  }
  if (totalFrameBytes > limits.maxRecordingBytes) throw new Error("録画データが上限を超えています");
  const operations = requireArray(recording.operations, "recording.operations").map(
    (operation, index) => parseOperation(operation, `recording.operations[${index}]`)
  );
  if (operations.length > limits.maxOperationRecords) throw new Error("操作記録数が上限を超えています");
  if (new Set(frames.map((frame) => frame.id)).size !== frames.length) {
    throw new Error("録画フレーム id が重複しています");
  }
  if (new Set(frames.map((frame) => frame.sequence)).size !== frames.length) {
    throw new Error("録画フレーム sequence が重複しています");
  }
  if (new Set(operations.map((operation) => operation.id)).size !== operations.length) {
    throw new Error("操作記録 id が重複しています");
  }
  if (new Set(operations.map((operation) => operation.sequence)).size !== operations.length) {
    throw new Error("操作記録 sequence が重複しています");
  }
  return {
    version: 1,
    frames,
    operations,
    totalFrameBytes,
    droppedFrames: requireInteger(recording.droppedFrames, "recording.droppedFrames", 0),
    droppedOperations: requireInteger(recording.droppedOperations, "recording.droppedOperations", 0),
  };
}

function parseFrame(value: unknown, path: string): DrawingAgentPreviewFrame {
  const frame = requireRecord(value, path);
  const reasons = requireArray(frame.reasons, `${path}.reasons`).map((reason, index) =>
    requireOneOf(reason, ["initial", "observation", "stage_complete", "final"] as const, `${path}.reasons[${index}]`)
  );
  if (reasons.length === 0) throw new Error(`${path}.reasons は1件以上必要です`);
  const dataUrl = requireString(frame.dataUrl, `${path}.dataUrl`, 1);
  if (!dataUrl.startsWith("data:image/png;base64,")) throw new Error(`${path}.dataUrl は PNG data URL ではありません`);
  const actualByteLength = getPngDataUrlByteLength(dataUrl);
  if (actualByteLength === undefined) throw new Error(`${path}.dataUrl の base64 が不正です`);
  const declaredByteLength = requireInteger(frame.byteLength, `${path}.byteLength`, 1);
  if (actualByteLength !== declaredByteLength) {
    throw new Error(`${path}.byteLength が実データのサイズと一致しません`);
  }
  return {
    id: requireString(frame.id, `${path}.id`, 1, 200),
    sequence: requireInteger(frame.sequence, `${path}.sequence`, 1),
    capturedAt: requireFinite(frame.capturedAt, `${path}.capturedAt`, 0),
    stageId: requireString(frame.stageId, `${path}.stageId`, 1, 100),
    reasons,
    dataUrl,
    mimeType: requireExact(frame.mimeType, "image/png", `${path}.mimeType`),
    width: requireInteger(frame.width, `${path}.width`, 1, MAX_RASTER_IMAGE_DIMENSION),
    height: requireInteger(frame.height, `${path}.height`, 1, MAX_RASTER_IMAGE_DIMENSION),
    byteLength: actualByteLength,
  };
}

function parseOperation(value: unknown, path: string): DrawingAgentOperationRecord {
  const operation = requireRecord(value, path);
  return {
    id: requireString(operation.id, `${path}.id`, 1, 200),
    sequence: requireInteger(operation.sequence, `${path}.sequence`, 1),
    iteration: requireInteger(operation.iteration, `${path}.iteration`, 0),
    stageId: requireString(operation.stageId, `${path}.stageId`, 1, 100),
    toolName: requireString(operation.toolName, `${path}.toolName`, 1, 500),
    startedAt: requireFinite(operation.startedAt, `${path}.startedAt`, 0),
    finishedAt: requireFinite(operation.finishedAt, `${path}.finishedAt`, 0),
    mutates: requireBoolean(operation.mutates, `${path}.mutates`),
    status: requireOneOf(operation.status, ["succeeded", "failed", "cancelled", "rejected"] as const, `${path}.status`),
    arguments: cloneJsonValue(operation.arguments, `${path}.arguments`),
    result: cloneJsonValue(operation.result, `${path}.result`),
  };
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} は object で指定してください`);
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} は array で指定してください`);
  return value;
}

function requireString(value: unknown, path: string, min: number, max = Number.MAX_SAFE_INTEGER): string {
  if (typeof value !== "string" || value.length < min || value.length > max) {
    throw new Error(`${path} が不正です`);
  }
  return value;
}

function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${path} は boolean で指定してください`);
  return value;
}

function requireFinite(value: unknown, path: string, min: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min) {
    throw new Error(`${path} が不正です`);
  }
  return value;
}

function requireInteger(value: unknown, path: string, min: number, max = Number.MAX_SAFE_INTEGER): number {
  const number = requireFinite(value, path, min);
  if (!Number.isInteger(number) || number > max) throw new Error(`${path} が不正です`);
  return number;
}

function requireExact<const T extends string | number>(value: unknown, expected: T, path: string): T {
  if (value !== expected) throw new Error(`${path} が不正です`);
  return expected;
}

function requireOneOf<const T extends readonly string[]>(value: unknown, values: T, path: string): T[number] {
  if (typeof value !== "string" || !values.includes(value)) throw new Error(`${path} が不正です`);
  return value as T[number];
}

function cloneJsonValue(value: unknown, path: string): unknown {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    throw new Error(`${path} は JSON として保存できません`);
  }
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function createDrawingAgentSession(input: {
  id: string;
  bindingId: string;
  prompt: string;
  provider: ModelProvider;
  model: string;
  references?: readonly DrawingAgentReference[];
  stages?: readonly DrawingAgentStage[];
  limits?: Partial<DrawingAgentLimits>;
  now: number;
}): DrawingAgentSession {
  const stages = (input.stages ?? DEFAULT_DRAWING_STAGES).map((stage) => ({
    ...stage,
    completionCriteria: [...stage.completionCriteria],
  }));
  const limits = { ...DEFAULT_DRAWING_AGENT_LIMITS, ...input.limits };
  return validateDrawingAgentSession(
    {
      version: 1,
      id: input.id,
      bindingId: input.bindingId,
      prompt: input.prompt,
      provider: input.provider,
      model: input.model,
      references: validateAgentReferences(input.references),
      status: "idle",
      createdAt: input.now,
      updatedAt: input.now,
      stages,
      stageStates: stages.map((stage, index) => ({
        stageId: stage.id,
        status: index === 0 ? "active" : "pending",
        visits: index === 0 ? 1 : 0,
        visitStartedRevision: 0,
      })),
      currentStageIndex: 0,
      limits,
      usage: {
        iterations: 0,
        elapsedMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        modelCalls: 0,
        toolCalls: 0,
      },
      canvasRevision: 0,
      lastInspectedRevision: -1,
      messages: [],
      recording: createDrawingAgentRecording(),
    },
    false
  );
}
