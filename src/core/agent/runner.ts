import type { PaintApiDefinition, PaintApiExecuteResult, PaintApiImageResult } from "../paintApi/types";
import { isDrawingAgentToolAllowed } from "./toolPolicy";
import { requestModel as defaultRequestModel } from "./modelClient";
import type {
  ModelRequest,
  ModelResponse,
  ModelTool,
  ModelToolCall,
  ModelToolResult,
} from "./modelTypes";
import {
  addDrawingAgentOperation,
  addDrawingAgentPreviewFrame,
  addFrameReason,
  getPngDataUrlByteLength,
} from "./recording";
import type { AgentPreviewImage } from "./recording";
import type { DrawingAgentPreviewFrame } from "./recording";
import type { DrawingAgentReference } from "./referenceImages";
import { validateAgentReferences } from "./referenceImages";
import { REFERENCE_DRAWING_STAGES, runReferenceDrawing, validateReferencePngSize } from "./referenceRun";
import {
  cloneDrawingAgentSession,
  createDrawingAgentSession,
} from "./session";
import type {
  DrawingAgentLimits,
  DrawingAgentActivity,
  DrawingAgentSession,
  DrawingAgentSnapshot,
  DrawingAgentStage,
} from "./session";

export interface DrawingAgentPaintApi {
  list(): PaintApiDefinition[];
  execute(
    name: string,
    args: unknown,
    options?: { signal?: AbortSignal }
  ): Promise<PaintApiExecuteResult>;
}

export type DrawingAgentModelRequester = (
  request: ModelRequest,
  options?: { signal?: AbortSignal }
) => Promise<ModelResponse>;

export interface DrawingAgentOptions {
  paintApi: DrawingAgentPaintApi;
  bindingId: string;
  requestModel?: DrawingAgentModelRequester;
  isBindingAvailable?: () => boolean;
  getBindingRevision?: () => number;
  session?: DrawingAgentSession;
  now?: () => number;
  onSessionChange?: (session: DrawingAgentSession) => void;
}

export interface DrawingAgentStartInput {
  prompt: string;
  provider: "openai" | "anthropic";
  model: string;
  stages?: readonly DrawingAgentStage[];
  limits?: Partial<DrawingAgentLimits>;
  references?: readonly DrawingAgentReference[];
}

export interface DrawingAgentResumeInput {
  limits?: Partial<DrawingAgentLimits>;
  references?: readonly DrawingAgentReference[];
}

type Listener = () => void;

interface CurrentObservation {
  image: AgentPreviewImage;
  frameId?: string;
  canvasRevision: number;
  bindingRevision?: number;
}

interface ExecutedCall {
  result: ModelToolResult;
  mutated: boolean;
}

const EMPTY_SNAPSHOT: DrawingAgentSnapshot = {
  status: "idle",
  settling: false,
  prompt: "",
  currentStageIndex: 0,
  stages: [],
  stageStates: [],
  usage: {
    iterations: 0,
    elapsedMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    modelCalls: 0,
    toolCalls: 0,
  },
  limits: {
    maxIterations: 0,
    maxDurationMs: 0,
    maxInputTokens: 0,
    maxOutputTokens: 0,
    maxTotalTokens: 0,
    maxModelCalls: 0,
    maxToolCalls: 0,
    maxRecordingFrames: 0,
    maxRecordingFrameBytes: 0,
    maxRecordingBytes: 0,
    maxOperationRecords: 0,
  },
  recording: {
    frameCount: 0,
    operationCount: 0,
    totalFrameBytes: 0,
    droppedFrames: 0,
    droppedOperations: 0,
  },
};

const MODEL_TOOLS: ModelTool[] = [
  {
    name: "app_list_tools",
    description: "AIドローに許可された描画用APIの名前、引数、用途を取得します。",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "名前や説明に含まれる語。省略時は全件。" },
        mutatingOnly: { type: "boolean", description: "変更操作だけを返す場合は true。" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "app_call_tool",
    description: "ai-paint API を1件実行します。name は app_list_tools が返すドット区切りの正式名を使います。",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        arguments: { type: "object", additionalProperties: true },
      },
      required: ["name", "arguments"],
      additionalProperties: false,
    },
  },
  {
    name: "agent_complete_stage",
    description: "現在工程の完了条件を、直近のキャンバス画像で確認できた場合だけ完了します。描画後の画像確認前は拒否されます。",
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string", description: "この工程で完成した内容" },
        criteriaEvidence: {
          type: "array",
          items: { type: "string" },
          description: "各完了条件を満たしたと画像から判断した根拠",
        },
      },
      required: ["summary", "criteriaEvidence"],
      additionalProperties: false,
    },
  },
  {
    name: "agent_revisit_stage",
    description: "後工程の確認で修正が必要になった場合に、前の工程を再度開きます。",
    parameters: {
      type: "object",
      properties: {
        stageId: { type: "string" },
        reason: { type: "string" },
      },
      required: ["stageId", "reason"],
      additionalProperties: false,
    },
  },
];

export class DrawingAgent {
  private readonly paintApi: DrawingAgentPaintApi;
  private readonly requestModel: DrawingAgentModelRequester;
  private readonly bindingId: string;
  private readonly isBindingAvailable: () => boolean;
  private readonly getBindingRevision?: () => number;
  private readonly now: () => number;
  private readonly onSessionChange?: (session: DrawingAgentSession) => void;
  private readonly listeners = new Set<Listener>();
  private session?: DrawingAgentSession;
  private snapshot: DrawingAgentSnapshot = EMPTY_SNAPSHOT;
  private runEpoch = 0;
  private abortController?: AbortController;
  private activeRun?: Promise<void>;
  private activeStartedAt?: number;
  private durationTimer?: ReturnType<typeof setTimeout>;
  private currentObservation?: CurrentObservation;
  private lastObservedImageDataUrl?: string;
  private activity?: DrawingAgentActivity;
  private settlingRun?: Promise<void>;
  private terminalCapture?: Promise<void>;

  constructor(options: DrawingAgentOptions) {
    this.paintApi = options.paintApi;
    this.requestModel = options.requestModel ?? defaultRequestModel;
    this.bindingId = options.bindingId;
    this.isBindingAvailable = options.isBindingAvailable ?? (() => true);
    this.getBindingRevision = options.getBindingRevision;
    this.now = options.now ?? (() => Date.now());
    this.onSessionChange = options.onSessionChange;
    if (options.session) {
      this.session = cloneDrawingAgentSession(options.session);
      if (this.session.bindingId !== this.bindingId) {
        throw new Error("AIドロー（β版）の制作記録の対象ドキュメントが一致しません");
      }
      if (this.session.status === "running") this.session.status = "paused";
      this.session.lastInspectedRevision = -1;
      this.lastObservedImageDataUrl = latestRecordedImageDataUrl(this.session);
      this.activity = createIdleActivity(this.now(), activityLabelForStatus(this.session.status));
      this.rebuildSnapshot();
    }
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): DrawingAgentSnapshot => this.snapshot;

  getSession(): DrawingAgentSession | undefined {
    return this.session ? cloneDrawingAgentSession(this.session) : undefined;
  }

  getPreviewFrame(index: number): DrawingAgentPreviewFrame | undefined {
    if (!Number.isInteger(index) || index < 0) return undefined;
    const frame = this.session?.recording.frames[index];
    return frame ? { ...frame, reasons: [...frame.reasons] } : undefined;
  }

  getReferences(): DrawingAgentReference[] {
    return this.session?.references.map((reference) => ({ ...reference })) ?? [];
  }

  start(input: DrawingAgentStartInput): Promise<void> {
    if (this.session?.status === "running") {
      throw new Error("AIドロー（β版）はすでに実行中です");
    }
    if (this.settlingRun || this.activeRun || this.terminalCapture) {
      throw new Error("AIドロー（β版）の停止処理が完了するまでお待ちください");
    }
    const prompt = input.prompt.trim();
    if (!prompt) throw new Error("描画指示を入力してください");
    this.cancelActiveRun();
    const now = this.now();
    this.session = createDrawingAgentSession({
      id: createId("agent"),
      bindingId: this.bindingId,
      prompt,
      provider: input.provider,
      model: input.model,
      stages: input.stages,
      limits: input.limits,
      references: input.references,
      now,
    });
    this.session.status = "running";
    this.currentObservation = undefined;
    this.lastObservedImageDataUrl = undefined;
    return this.launchRun();
  }

  resume(input: DrawingAgentResumeInput = {}): Promise<void> {
    if (this.settlingRun || this.activeRun || this.terminalCapture) {
      throw new Error("AIドロー（β版）の停止処理が完了するまでお待ちください");
    }
    const session = this.requireSession();
    if (session.mode === "reference") throw new Error("見本の再描画は、開始ボタンからやり直してください");
    if (!["paused", "error", "limit_reached"].includes(session.status)) {
      throw new Error("この AIドロー（β版）の制作記録は再開できません");
    }
    if (input.limits) {
      session.limits = cloneDrawingAgentSession({
        ...session,
        limits: { ...session.limits, ...input.limits },
      }).limits;
    }
    if (input.references !== undefined) session.references = validateAgentReferences(input.references);
    session.status = "running";
    session.error = undefined;
    session.stopReason = undefined;
    session.lastInspectedRevision = -1;
    this.currentObservation = undefined;
    this.lastObservedImageDataUrl = latestRecordedImageDataUrl(session);
    return this.launchRun();
  }

  pause(): void {
    if (this.session?.status !== "running") return;
    if (this.session.mode === "reference") { void this.stop(); return; }
    this.finishActiveDuration();
    this.session.status = "paused";
    this.session.stopReason = "ユーザーが一時停止しました";
    this.session.updatedAt = this.now();
    this.cancelActiveRun();
    this.setActivity("idle", "一時停止中");
    this.emitChange();
  }

  async stop(): Promise<void> {
    const session = this.session;
    if (!session || session.status === "stopped") return;
    if (session.status === "running") this.finishActiveDuration();
    session.status = "stopped";
    session.stopReason = "ユーザーが中止しました";
    session.updatedAt = this.now();
    const activeRun = this.activeRun;
    this.cancelActiveRun();
    this.setActivity("idle", "停止しました");
    this.emitChange();
    if (activeRun) {
      try {
        await activeRun;
      } catch {
        // 実行ループ内で表示用エラーへ変換する。中止時の AbortError は無視する。
      }
    }
    const capture = this.captureTerminalFrame();
    this.terminalCapture = capture;
    this.emitRuntimeChange();
    try { await capture; }
    finally { if (this.terminalCapture === capture) { this.terminalCapture = undefined; this.emitRuntimeChange(); } }
  }

  private launchRun(): Promise<void> {
    const session = this.requireSession();
    this.cancelActiveRun();
    session.status = "running";
    session.updatedAt = this.now();
    this.activeStartedAt = this.now();
    const epoch = ++this.runEpoch;
    const controller = new AbortController();
    this.abortController = controller;
    this.scheduleDurationLimit(epoch);
    this.setActivity("observing", "キャンバスを確認しています");
    this.emitChange();
    const run = this.run(epoch, controller.signal).finally(() => {
      if (this.activeRun === run) this.activeRun = undefined;
      if (this.settlingRun === run) {
        this.settlingRun = undefined;
        this.emitRuntimeChange();
      }
    });
    this.activeRun = run;
    return run;
  }

  startReference(referenceValue: DrawingAgentReference, contextReferences: DrawingAgentReference[] = []): Promise<void> {
    if (this.activeRun || this.settlingRun || this.terminalCapture || this.session?.status === "running") throw new Error("AIドロー（β版） の停止が完了するまでお待ちください");
    if (!this.isBindingAvailable()) throw new Error("キャンバスを作成してから再描画してください");
    const [reference, ...otherReferences] = validateAgentReferences([referenceValue, ...contextReferences.filter(item => item.id !== referenceValue.id)]);
    validateReferencePngSize(reference);
    this.cancelActiveRun();
    this.session = createDrawingAgentSession({
      id: createId("reference"), bindingId: this.bindingId,
      prompt: `${reference.name}をブラシで再描画`, provider: "openai", model: "reference-brush",
      references: [reference, ...otherReferences], stages: REFERENCE_DRAWING_STAGES, now: this.now(),
    });
    this.session.mode = "reference";
    this.session.referenceProgress = { phase: "planning", completedStrokes: 0, totalStrokes: 0 };
    this.session.status = "running";
    this.currentObservation = undefined; this.lastObservedImageDataUrl = undefined;
    this.activeStartedAt = this.now();
    const epoch = ++this.runEpoch;
    const controller = new AbortController(); this.abortController = controller;
    this.scheduleDurationLimit(epoch);
    this.setActivity("checking", "お手本を解析しています");
    this.emitChange();
    const run = this.runReference(reference, epoch, controller.signal).finally(() => {
      if (this.activeRun === run) this.activeRun = undefined;
      if (this.settlingRun === run) { this.settlingRun = undefined; this.emitRuntimeChange(); }
    });
    this.activeRun = run;
    return run;
  }

  private async runReference(reference: DrawingAgentReference, epoch: number, signal: AbortSignal): Promise<void> {
    const session = this.requireSession();
    const assertCurrent = () => {
      if (signal.aborted || !this.isRunCurrent(epoch)) throw new DOMException("中止しました", "AbortError");
      if (!this.isBindingAvailable()) throw new Error("対象のキャンバスが切り替わりました");
    };
    try {
      await runReferenceDrawing({
        reference, signal, assertCurrent,
        clearSelection: async () => {
          if (this.session !== session || !this.isBindingAvailable()) return;
          const result = await this.paintApi.execute("selection.set", { kind: "none" });
          if (!result.ok) throw new Error(result.error.message);
        },
        call: async (name, args) => {
          assertCurrent();
          session.usage.toolCalls += 1;
          const executed = await this.executeCall({ id: `reference-${session.usage.toolCalls}`, name: "app_call_tool", arguments: { name, arguments: args } }, signal);
          assertCurrent();
          if (executed.result.isError) {
            const output = executed.result.output as { error?: { message?: string } };
            throw new Error(output.error?.message ?? `${name}に失敗しました`);
          }
          return executed.result.output;
        },
        capture: async (reason, stageComplete) => {
          assertCurrent();
          const observation = await this.observe(reason, signal);
          assertCurrent();
          if (stageComplete && observation.frameId) addFrameReason(session.recording, observation.frameId, "stage_complete");
        },
        progress: (value, label) => {
          if (!this.isRunCurrent(epoch)) return;
          session.referenceProgress = value;
          this.setActivity(value.phase === "planning" ? "checking" : "drawing", label);
        },
        stage: (index, complete) => {
          assertCurrent();
          session.currentStageIndex = index;
          const stage = session.stageStates[index];
          stage.status = complete ? "completed" : "active";
          if (complete) { stage.completedAt = this.now(); stage.summary = "筆致の描画と記録が完了しました"; }
          else { stage.visits = 1; stage.visitStartedRevision = session.canvasRevision; }
          this.emitChange();
        },
      });
      assertCurrent();
      await this.captureTerminalFrame();
      assertCurrent();
      this.finishActiveDuration();
      session.status = "completed";
      session.stopReason = "お手本の再描画が完了しました";
      this.cancelRunResources(false);
      this.setActivity("idle", session.stopReason);
      this.emitChange();
    } catch (error) {
      if (this.isRunCurrent(epoch)) this.fail(error instanceof Error ? error.message : "再描画に失敗しました", epoch);
    }
  }

  private async run(epoch: number, signal: AbortSignal): Promise<void> {
    let continuation: string | undefined;
    let toolResults: ModelToolResult[] | undefined;
    let noActionResponses = 0;
    try {
      if (!this.isRunCurrent(epoch)) return;
      if (this.requireSession().recording.frames.length === 0) {
        const initial = await this.observe("initial", signal);
        if (!this.isRunCurrent(epoch)) return;
        if (!initial.frameId) {
          this.fail("最初のプレビュー画像を記録上限内で保存できません", epoch);
          return;
        }
      }

      while (this.isRunCurrent(epoch)) {
        const budgetReason = this.getBudgetReason();
        if (budgetReason) {
          this.reachLimit(budgetReason, epoch);
          return;
        }
        if (!this.isBindingAvailable()) {
          this.fail("対象のドキュメントまたはタブが利用できません", epoch);
          return;
        }

        const observation = await this.observe("observation", signal);
        if (!this.isRunCurrent(epoch)) return;
        this.currentObservation = observation;

        const session = this.requireSession();
        session.usage.iterations += 1;
        session.usage.modelCalls += 1;
        session.updatedAt = this.now();
        this.emitChange();
        if (!this.isRunCurrent(epoch)) return;

        this.setActivity("thinking", "次の描画を考えています");
        const response = await this.requestModel(
          {
            provider: session.provider,
            model: session.model,
            instructions: buildAgentInstructions(session),
            text: buildTurnText(session, continuation !== undefined, noActionResponses),
            imageDataUrl: observation.image.dataUrl,
            ...(continuation === undefined && session.references.length > 0
              ? {
                  referenceImages: session.references.map((reference) => ({
                    name: reference.name,
                    dataUrl: reference.dataUrl,
                  })),
                }
              : {}),
            ...(session.provider === "openai" && supportsHighReasoningEffort(session.model)
              ? { reasoningEffort: "high" as const }
              : {}),
            tools: MODEL_TOOLS,
            maxOutputTokens: Math.max(
              1,
              Math.min(16_384, session.limits.maxOutputTokens - session.usage.outputTokens,
                session.limits.maxTotalTokens - session.usage.inputTokens - session.usage.outputTokens)
            ),
            ...(continuation === undefined ? {} : { continuation }),
            ...(toolResults === undefined ? {} : { toolResults }),
          },
          { signal }
        );
        if (!this.isRunCurrent(epoch)) return;
        if (!this.isBindingAvailable()) {
          this.fail("対象のドキュメントまたはタブが利用できません", epoch);
          return;
        }

        session.usage.inputTokens += normalizeTokenCount(response.inputTokens);
        session.usage.outputTokens += normalizeTokenCount(response.outputTokens);
        session.lastInspectedRevision = observation.canvasRevision;
        if (response.text.trim()) this.addMessage("model", response.text.trim());
        session.updatedAt = this.now();
        this.setActivity("checking", "モデルの提案を確認しています");
        this.emitChange();
        if (!this.isRunCurrent(epoch)) return;

        const postResponseBudgetReason = this.getPostResponseBudgetReason();
        if (postResponseBudgetReason) {
          this.reachLimit(postResponseBudgetReason, epoch);
          return;
        }

        if (response.calls.length === 0) {
          continuation = undefined;
          toolResults = undefined;
          noActionResponses += 1;
          if (noActionResponses >= 2) {
            this.fail("モデルが操作を要求しなかったため停止しました。再開して続行できます", epoch);
            return;
          }
          continue;
        }

        noActionResponses = 0;
        const executed: ExecutedCall[] = [];
        for (const call of response.calls) {
          if (!this.isRunCurrent(epoch)) return;
          if (!this.isBindingAvailable()) {
            this.fail("対象のドキュメントまたはタブが利用できません", epoch);
            return;
          }
          if (session.usage.toolCalls >= session.limits.maxToolCalls) {
            this.reachLimit("ツール呼び出し回数の上限に達しました", epoch);
            return;
          }
          session.usage.toolCalls += 1;
          const callResult = await this.executeCall(call, signal);
          if (!this.isRunCurrent(epoch)) return;
          executed.push(callResult);
        }
        toolResults = executed.map((item) => item.result);
        continuation = response.continuation;
        if (!continuation) {
          this.fail("モデル応答にツール結果を返すための continuation がありません", epoch);
          return;
        }
      }
    } catch (error) {
      if (!this.isRunCurrent(epoch) || isAbortError(error)) return;
      this.fail(error instanceof Error ? error.message : "AIドロー（β版）の実行に失敗しました", epoch);
    }
  }

  private async executeCall(
    call: ModelToolCall,
    signal: AbortSignal
  ): Promise<ExecutedCall> {
    const session = this.requireSession();
    const startedAt = this.now();
    const stageId = currentStage(session).id;
    const requestedToolName =
      call.name === "app_call_tool" && typeof call.arguments.name === "string"
        ? call.arguments.name
        : call.name;
    const definition =
      call.name === "app_call_tool"
        ? this.paintApi.list().find((item) => item.name === requestedToolName)
        : undefined;
    const mutates = definition?.mutates ?? false;
    let status: "succeeded" | "failed" | "cancelled" | "rejected" = "succeeded";
    let output: unknown;
    const activityLabels = describeToolActivity(requestedToolName, mutates);
    this.setActivity(mutates ? "drawing" : "checking", activityLabels.active, requestedToolName);

    try {
      if (call.name === "app_list_tools") {
        output = this.listTools(call.arguments);
      } else if (call.name === "app_call_tool" && !isDrawingAgentToolAllowed(requestedToolName)) {
        status = "rejected";
        output = { error: { code: "TOOL_NOT_ALLOWED", message: `AIドローではこの操作は許可されていません: ${requestedToolName}` } };
      } else if (call.name === "app_call_tool") {
        const name = requireToolString(call.arguments.name, "name");
        const args = requireToolArguments(call.arguments.arguments);
        const result = await this.paintApi.execute(name, args, { signal });
        if (this.session !== session) {
          return { result: { callId: call.id, output: { error: "cancelled" }, isError: true }, mutated: false };
        }
        if (result.ok) {
          output = result.value;
          if (mutates) {
            session.lastInspectedRevision = -1;
            this.currentObservation = undefined;
          }
        } else {
          status = result.error.code === "CANCELLED" ? "cancelled" : "failed";
          output = { error: result.error };
        }
      } else if (call.name === "agent_complete_stage") {
        output = this.completeStage(call.arguments);
        status = isErrorOutput(output) ? "rejected" : "succeeded";
      } else if (call.name === "agent_revisit_stage") {
        output = this.revisitStage(call.arguments);
        status = isErrorOutput(output) ? "rejected" : "succeeded";
      } else {
        status = "rejected";
        output = { error: { code: "UNKNOWN_AGENT_TOOL", message: `不明な Agent ツールです: ${call.name}` } };
      }
    } catch (error) {
      status = isAbortError(error) ? "cancelled" : "rejected";
      output = {
        error: {
          code: status === "cancelled" ? "CANCELLED" : "INVALID_ARGUMENT",
          message: error instanceof Error ? error.message : "ツール呼び出しに失敗しました",
        },
      };
    }

    if (this.session !== session) {
      return { result: { callId: call.id, output: { error: "cancelled" }, isError: true }, mutated: false };
    }
    addDrawingAgentOperation(
      session.recording,
      {
        iteration: session.usage.iterations,
        stageId,
        toolName:
          call.name === "app_call_tool" && typeof call.arguments.name === "string"
            ? call.arguments.name
            : call.name,
        startedAt,
        finishedAt: this.now(),
        mutates,
        status,
        arguments: call.arguments,
        result: output,
      },
      session.limits.maxOperationRecords
    );
    session.updatedAt = this.now();
    if (session.status === "running") {
      this.setActivity("checking", activityLabels.checking, requestedToolName);
    }
    this.emitChange();
    return {
      result: {
        callId: call.id,
        output,
        ...(status === "succeeded" ? {} : { isError: true }),
      },
      mutated: mutates && status === "succeeded",
    };
  }

  private listTools(argumentsValue: Record<string, unknown>): PaintApiDefinition[] {
    const query = typeof argumentsValue.query === "string" ? argumentsValue.query.trim().toLocaleLowerCase() : "";
    const mutatingOnly = argumentsValue.mutatingOnly === true;
    return this.paintApi.list().filter((definition) => {
      if (!isDrawingAgentToolAllowed(definition.name)) return false;
      if (mutatingOnly && !definition.mutates) return false;
      if (!query) return true;
      return `${definition.name}\n${definition.description}\n${definition.usage ?? ""}`
        .toLocaleLowerCase()
        .includes(query);
    });
  }

  private completeStage(argumentsValue: Record<string, unknown>): unknown {
    const session = this.requireSession();
    const summary = requireToolString(argumentsValue.summary, "summary");
    const evidenceValue = argumentsValue.criteriaEvidence;
    if (!Array.isArray(evidenceValue) || evidenceValue.some((item) => typeof item !== "string" || !item.trim())) {
      return agentToolError("INVALID_ARGUMENT", "criteriaEvidence は空でない文字列の配列で指定してください");
    }
    const stage = currentStage(session);
    const state = session.stageStates[session.currentStageIndex];
    if (evidenceValue.length < stage.completionCriteria.length) {
      return agentToolError("CRITERIA_NOT_COVERED", "すべての完了条件について画像上の根拠を示してください");
    }
    if (session.canvasRevision <= state.visitStartedRevision) {
      return agentToolError(
        "RASTER_CHANGE_REQUIRED",
        "この工程を開いてから実画像の変化が確認できません。設定変更やレイヤー選択だけでは完了できません"
      );
    }
    if (
      !this.currentObservation ||
      !this.currentObservation.frameId ||
      session.lastInspectedRevision !== session.canvasRevision ||
      this.currentObservation.canvasRevision !== session.canvasRevision ||
      (this.getBindingRevision !== undefined &&
        this.currentObservation.bindingRevision !== this.getBindingRevision())
    ) {
      return agentToolError("INSPECTION_REQUIRED", "直近の描画後に現在のキャンバス画像を確認してから完了してください");
    }

    state.status = "completed";
    state.completedAt = this.now();
    state.summary = summary;
    addFrameReason(session.recording, this.currentObservation.frameId, "stage_complete");
    if (session.currentStageIndex === session.stages.length - 1) {
      addFrameReason(session.recording, this.currentObservation.frameId, "final");
      this.finishActiveDuration();
      session.status = "completed";
      session.stopReason = "すべての工程が完了しました";
      this.cancelRunResources(false);
      this.trackSettlingRun(this.activeRun);
      this.setActivity("idle", "すべての工程が完了しました");
      this.addMessage("system", "すべての工程が完了しました");
      return { ok: true, completed: true, stageId: stage.id };
    }

    session.currentStageIndex += 1;
    const next = session.stageStates[session.currentStageIndex];
    next.status = "active";
    next.visits += 1;
    next.visitStartedRevision = session.canvasRevision;
    this.addMessage("system", `${stage.title}を完了し、${currentStage(session).title}へ進みました`);
    return { ok: true, completed: false, nextStage: currentStage(session) };
  }

  private revisitStage(argumentsValue: Record<string, unknown>): unknown {
    const session = this.requireSession();
    const stageId = requireToolString(argumentsValue.stageId, "stageId");
    const reason = requireToolString(argumentsValue.reason, "reason");
    const targetIndex = session.stages.findIndex((stage) => stage.id === stageId);
    if (targetIndex < 0) return agentToolError("STAGE_NOT_FOUND", `工程が見つかりません: ${stageId}`);
    if (targetIndex >= session.currentStageIndex) {
      return agentToolError("INVALID_STAGE", "現在より前の工程だけを再度開けます");
    }
    for (let index = targetIndex; index < session.stageStates.length; index += 1) {
      const state = session.stageStates[index];
      state.status = index === targetIndex ? "active" : "pending";
      state.completedAt = undefined;
      state.summary = undefined;
    }
    session.currentStageIndex = targetIndex;
    session.stageStates[targetIndex].visits += 1;
    session.stageStates[targetIndex].visitStartedRevision = session.canvasRevision;
    this.addMessage("system", `${session.stages[targetIndex].title}へ戻りました: ${reason}`);
    return { ok: true, stage: session.stages[targetIndex] };
  }

  private async observe(
    reason: "initial" | "observation",
    signal: AbortSignal
  ): Promise<CurrentObservation> {
    const session = this.requireSession();
    this.setActivity("observing", "キャンバス画像を取得しています");
    const result = await this.paintApi.execute("document.get_image", {}, { signal });
    if (!result.ok) throw new Error(`キャンバス画像を取得できません: ${result.error.message}`);
    const image = parseImageResult(result.value);
    if (
      this.lastObservedImageDataUrl !== undefined &&
      this.lastObservedImageDataUrl !== image.dataUrl
    ) {
      session.canvasRevision += 1;
    }
    this.lastObservedImageDataUrl = image.dataUrl;
    const frame = addDrawingAgentPreviewFrame(
      session.recording,
      {
        capturedAt: this.now(),
        stageId: currentStage(session).id,
        reasons: [reason],
        ...image,
      },
      {
        maxFrames: session.limits.maxRecordingFrames,
        maxFrameBytes: session.limits.maxRecordingFrameBytes,
        maxTotalBytes: session.limits.maxRecordingBytes,
      }
    );
    session.updatedAt = this.now();
    this.setActivity("checking", "取得したキャンバスを確認しています");
    this.emitChange();
    return {
      image,
      frameId: frame?.id,
      canvasRevision: session.canvasRevision,
      bindingRevision: this.getBindingRevision?.(),
    };
  }

  private async captureTerminalFrame(): Promise<void> {
    const session = this.session;
    if (!session) return;
    if (!this.isBindingAvailable()) {
      this.markLatestFrameFinal("対象を利用できないため直近の確認画像を最終画像として使用しました");
      session.updatedAt = this.now();
      this.emitChange();
      return;
    }
    try {
      const result = await this.paintApi.execute("document.get_image", {});
      if (!result.ok) throw new Error(result.error.message);
      const image = parseImageResult(result.value);
      const hasInitialFrame = session.recording.frames.some((frame) => frame.reasons.includes("initial"));
      const frame = addDrawingAgentPreviewFrame(
        session.recording,
        {
          capturedAt: this.now(),
          stageId: currentStage(session).id,
          reasons: hasInitialFrame ? ["final"] : ["initial", "final"],
          ...image,
        },
        {
          maxFrames: session.limits.maxRecordingFrames,
          maxFrameBytes: session.limits.maxRecordingFrameBytes,
          maxTotalBytes: session.limits.maxRecordingBytes,
        }
      );
      if (!frame) this.markLatestFrameFinal("最終画像は記録上限のため直近の確認画像を使用しました");
    } catch (error) {
      this.markLatestFrameFinal(
        `最終画像を取得できなかったため直近の確認画像を使用しました: ${
          error instanceof Error ? error.message : "不明なエラー"
        }`
      );
    }
    session.updatedAt = this.now();
    this.emitChange();
  }

  private markLatestFrameFinal(message: string): void {
    const session = this.requireSession();
    const latest = session.recording.frames[session.recording.frames.length - 1];
    if (latest) addFrameReason(session.recording, latest.id, "final");
    this.addMessage("system", message);
  }

  private addMessage(role: "model" | "system", text: string): void {
    const session = this.requireSession();
    session.messages.push({ at: this.now(), stageId: currentStage(session).id, role, text: text.slice(0, 10_000) });
    if (session.messages.length > 200) session.messages.splice(0, session.messages.length - 200);
  }

  private getBudgetReason(): string | undefined {
    const session = this.requireSession();
    const usage = session.usage;
    const limits = session.limits;
    if (usage.iterations >= limits.maxIterations) return "反復回数の上限に達しました";
    if (usage.modelCalls >= limits.maxModelCalls) return "モデル呼び出し回数の上限に達しました";
    if (usage.inputTokens >= limits.maxInputTokens) return "入力トークン上限に達しました";
    if (usage.outputTokens >= limits.maxOutputTokens) return "出力トークン上限に達しました";
    if (usage.inputTokens + usage.outputTokens >= limits.maxTotalTokens) return "総トークン上限に達しました";
    if (this.currentElapsedMs() >= limits.maxDurationMs) return "実行時間の上限に達しました";
    return undefined;
  }

  private getPostResponseBudgetReason(): string | undefined {
    const session = this.requireSession();
    const usage = session.usage;
    const limits = session.limits;
    if (usage.inputTokens >= limits.maxInputTokens) return "入力トークン上限に達しました";
    if (usage.outputTokens >= limits.maxOutputTokens) return "出力トークン上限に達しました";
    if (usage.inputTokens + usage.outputTokens >= limits.maxTotalTokens) return "総トークン上限に達しました";
    if (this.currentElapsedMs() >= limits.maxDurationMs) return "実行時間の上限に達しました";
    return undefined;
  }

  private reachLimit(reason: string, epoch: number): void {
    if (!this.isRunCurrent(epoch)) return;
    const session = this.requireSession();
    this.finishActiveDuration();
    session.status = "limit_reached";
    session.stopReason = reason;
    session.updatedAt = this.now();
    this.trackSettlingRun(this.activeRun);
    this.cancelRunResources(true);
    this.addMessage("system", reason);
    this.setActivity("idle", reason);
    this.emitChange();
  }

  private fail(message: string, epoch: number): void {
    if (!this.isRunCurrent(epoch)) return;
    const session = this.requireSession();
    this.finishActiveDuration();
    session.status = "error";
    session.error = message;
    session.updatedAt = this.now();
    this.trackSettlingRun(this.activeRun);
    this.cancelRunResources(false);
    this.addMessage("system", message);
    this.setActivity("idle", "エラーで停止しました");
    this.emitChange();
  }

  private scheduleDurationLimit(epoch: number): void {
    const session = this.requireSession();
    const remaining = Math.max(0, session.limits.maxDurationMs - session.usage.elapsedMs);
    this.durationTimer = setTimeout(() => {
      if (this.isRunCurrent(epoch)) this.reachLimit("実行時間の上限に達しました", epoch);
    }, remaining);
  }

  private finishActiveDuration(): void {
    const session = this.session;
    if (!session || this.activeStartedAt === undefined) return;
    session.usage.elapsedMs += Math.max(0, this.now() - this.activeStartedAt);
    this.activeStartedAt = undefined;
  }

  private currentElapsedMs(): number {
    const session = this.requireSession();
    return session.usage.elapsedMs +
      (this.activeStartedAt === undefined ? 0 : Math.max(0, this.now() - this.activeStartedAt));
  }

  private cancelActiveRun(): void {
    this.trackSettlingRun(this.activeRun);
    this.runEpoch += 1;
    this.cancelRunResources(true);
  }

  private cancelRunResources(abort: boolean): void {
    if (abort) this.abortController?.abort();
    this.abortController = undefined;
    if (this.durationTimer !== undefined) clearTimeout(this.durationTimer);
    this.durationTimer = undefined;
  }

  private isRunCurrent(epoch: number): boolean {
    return this.runEpoch === epoch && this.session?.status === "running";
  }

  private requireSession(): DrawingAgentSession {
    if (!this.session) throw new Error("AIドロー（β版）の制作記録がありません");
    return this.session;
  }

  private setActivity(
    phase: DrawingAgentActivity["phase"],
    label: string,
    toolName?: string
  ): void {
    const now = this.now();
    const unchanged =
      this.activity?.phase === phase &&
      this.activity.label === label &&
      this.activity.toolName === toolName;
    this.activity = {
      phase,
      label,
      startedAt: unchanged && this.activity ? this.activity.startedAt : now,
      lastProgressAt: now,
      ...(toolName === undefined ? {} : { toolName }),
    };
    this.emitRuntimeChange();
  }

  private trackSettlingRun(run: Promise<void> | undefined): void {
    if (!run || this.settlingRun === run) return;
    this.settlingRun = run;
    this.emitRuntimeChange();
  }

  private emitRuntimeChange(): void {
    this.rebuildSnapshot();
    for (const listener of this.listeners) listener();
  }

  private emitChange(): void {
    const session = this.session;
    if (session) session.updatedAt = this.now();
    this.rebuildSnapshot();
    if (session && this.onSessionChange) {
      try {
        this.onSessionChange(cloneDrawingAgentSession(session));
      } catch (error) {
        this.finishActiveDuration();
        session.status = "error";
        session.error = `AIドロー（β版）の制作記録を保存できません: ${
          error instanceof Error ? error.message : "不明なエラー"
        }`;
        session.updatedAt = this.now();
        this.cancelActiveRun();
        this.activity = createIdleActivity(this.now(), "保存エラーで停止しました");
        session.messages.push({
          at: this.now(),
          stageId: currentStage(session).id,
          role: "system",
          text: session.error,
        });
        if (session.messages.length > 200) session.messages.splice(0, session.messages.length - 200);
        this.rebuildSnapshot();
      }
    }
    for (const listener of this.listeners) listener();
  }

  private rebuildSnapshot(): void {
    const session = this.session;
    if (!session) {
      this.snapshot = EMPTY_SNAPSHOT;
      return;
    }
    this.snapshot = {
      ...(session.mode === undefined ? {} : { mode: session.mode }),
      ...(session.referenceProgress === undefined ? {} : { referenceProgress: { ...session.referenceProgress } }),
      sessionId: session.id,
      bindingId: session.bindingId,
      status: session.status,
      settling: this.settlingRun !== undefined || this.terminalCapture !== undefined,
      prompt: session.prompt,
      currentStageIndex: session.currentStageIndex,
      currentStage: { ...currentStage(session), completionCriteria: [...currentStage(session).completionCriteria] },
      stages: session.stages.map((stage) => ({ ...stage, completionCriteria: [...stage.completionCriteria] })),
      stageStates: session.stageStates.map((state) => ({ ...state })),
      usage: { ...session.usage, elapsedMs: this.currentElapsedMs() },
      limits: { ...session.limits },
      recording: {
        frameCount: session.recording.frames.length,
        operationCount: session.recording.operations.length,
        totalFrameBytes: session.recording.totalFrameBytes,
        droppedFrames: session.recording.droppedFrames,
        droppedOperations: session.recording.droppedOperations,
      },
      lastMessage: session.messages[session.messages.length - 1]?.text,
      error: session.error,
      stopReason: session.stopReason,
      activity: this.activity ? { ...this.activity } : undefined,
    };
  }
}

function buildAgentInstructions(session: DrawingAgentSession): string {
  const stages = session.stages
    .map(
      (stage, index) =>
        `${index + 1}. ${stage.title} (${stage.id})\n目的: ${stage.goal}\n完了条件:\n${stage.completionCriteria
          .map((criterion) => `- ${criterion}`)
          .join("\n")}`
    )
    .join("\n\n");
  const remainingIterations = Math.max(0, session.limits.maxIterations - session.usage.iterations);
  const remainingToolCalls = Math.max(0, session.limits.maxToolCalls - session.usage.toolCalls);
  return `あなたは ai-paint を実際に操作して絵を完成させるAIドロー（β版） です。
最初に指示と工程ごとの目的・完了条件を確認し、現在工程の具体的な制作計画を立ててください。計画を文章だけで終えず、必ずツールを呼んで作業してください。

元の制作指示:
${session.prompt}

残り目安: 反復 ${remainingIterations} 回、ツール操作 ${remainingToolCalls} 回。粗い段階だけで使い切らず、確認と仕上げへ配分してください。

工程:
${stages}

現在工程: ${currentStage(session).title} (${currentStage(session).id})
現在工程の目的: ${currentStage(session).goal}

毎回添付される画像は、その時点で実際に取得した現在のキャンバスです。画像を観察し、工程の不足を判断してから操作し、操作後の次の画像で結果を確認してください。画像を見ずに成功を仮定しないでください。
目標見本が添付されている場合は、名前付きの見本ごとに構図、シルエット、比率、配色、局所ディテールを現在キャンバスと比較してください。見本にない細部を想像で一致したと断定せず、確認できる差を修正対象として扱ってください。
app_list_tools で許可された描画用APIを確認し、app_call_tool で正式名を指定して実行します。ファイル操作、アプリ設定、タブ操作、他のAI機能、キャンバスサイズ変更、レイヤー削除・結合、履歴操作は使えません。細かな呼び出しを大量に繰り返さず、バッチ指定や図形など効率のよい操作経路を優先してください。
詳細なキャラクター制作では、最初に大きな色面と形で全体を成立させ、意味のある要素をレイヤーに分けてください。その後、顔・髪・衣装・手足・小物などを局所ごとに段階的に詰めます。粗い輪郭だけの磨き込みに予算を使い切らず、仕上げと全体比較に反復を残してください。
工程の完了は文章では進みません。各工程の訪問ごとに実画像を変化させ、変更後の画像で全完了条件を確認した後だけ agent_complete_stage を呼び、条件ごとの根拠と、残る形崩れ・塗り残し・見本との差を確認した結果を渡してください。描画と完了を同じ応答で行うと、描画後画像をまだ見ていないため拒否されます。設定変更やレイヤー選択だけでは工程を完了できません。
後工程で破綻を見つけた場合は agent_revisit_stage で前工程へ戻ってください。ツールのエラーは結果を読んで引数や方法を修正してください。`;
}

function buildTurnText(
  session: DrawingAgentSession,
  isContinuation: boolean,
  noActionResponses: number
): string {
  if (isContinuation) {
    return "ツール結果と最新キャンバス画像を確認し、現在工程の作業または検証を続けてください。";
  }
  if (noActionResponses > 0) {
    return "文章だけでは工程は進みません。最新画像を確認し、次に必要なツールを必ず呼んでください。";
  }
  if (session.usage.modelCalls === 1) {
    const referenceNote = session.references.length > 0
      ? `\n\n目標見本: ${session.references.map((reference, index) => `${index + 1}. ${reference.name}`).join(" / ")}\n見本と現在キャンバスの大きな差から優先して作業してください。`
      : "";
    return `制作指示:\n${session.prompt}${referenceNote}\n\n工程と完了条件を確認し、現在工程の計画を短く定めて、最初のツールを呼んでください。`;
  }
  return "最新キャンバス画像を確認し、現在工程の不足を直すか、条件を満たした根拠を示して工程を完了してください。";
}

function currentStage(session: DrawingAgentSession): DrawingAgentStage {
  const stage = session.stages[session.currentStageIndex];
  if (!stage) throw new Error("現在工程が不正です");
  return stage;
}

function parseImageResult(value: unknown): AgentPreviewImage {
  if (typeof value !== "object" || value === null) throw new Error("キャンバス画像の返り値が不正です");
  const image = value as Partial<PaintApiImageResult>;
  if (
    typeof image.dataUrl !== "string" ||
    !image.dataUrl.startsWith("data:image/png;base64,") ||
    image.mimeType !== "image/png" ||
    !Number.isInteger(image.width) ||
    (image.width ?? 0) <= 0 ||
    !Number.isInteger(image.height) ||
    (image.height ?? 0) <= 0 ||
    !Number.isInteger(image.byteLength) ||
    (image.byteLength ?? 0) <= 0
  ) {
    throw new Error("キャンバス画像の返り値が不正です");
  }
  const actualByteLength = getPngDataUrlByteLength(image.dataUrl);
  if (actualByteLength === undefined || actualByteLength !== image.byteLength) {
    throw new Error("キャンバス画像のデータサイズが不正です");
  }
  return {
    dataUrl: image.dataUrl,
    mimeType: "image/png",
    width: image.width as number,
    height: image.height as number,
    byteLength: image.byteLength as number,
  };
}

function requireToolString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} は空でない文字列で指定してください`);
  return value.trim();
}

function requireToolArguments(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("arguments は object で指定してください");
  }
  return value as Record<string, unknown>;
}

function agentToolError(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } };
}

function isErrorOutput(value: unknown): boolean {
  return typeof value === "object" && value !== null && "error" in value;
}

function normalizeTokenCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}

function createId(prefix: string): string {
  return typeof globalThis.crypto?.randomUUID === "function"
    ? `${prefix}-${globalThis.crypto.randomUUID()}`
    : `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function createIdleActivity(now: number, label: string): DrawingAgentActivity {
  return { phase: "idle", label, startedAt: now, lastProgressAt: now };
}

function activityLabelForStatus(status: DrawingAgentSession["status"]): string {
  if (status === "completed") return "すべての工程が完了しました";
  if (status === "stopped") return "停止しました";
  if (status === "error") return "エラーで停止しました";
  if (status === "limit_reached") return "上限に達して停止しました";
  if (status === "paused") return "一時停止中";
  return "待機中";
}

function latestRecordedImageDataUrl(session: DrawingAgentSession): string | undefined {
  const frames = session.recording.frames;
  return frames[frames.length - 1]?.dataUrl;
}

function supportsHighReasoningEffort(model: string): boolean {
  const normalized = model.trim().toLocaleLowerCase();
  return /^(?:gpt-6-astra(?:-|$)|gpt-5(?:[.-]|$)|o(?:1|3|4)(?:-|$))/.test(normalized);
}

function describeToolActivity(
  toolName: string,
  mutates: boolean
): { active: string; checking: string } {
  const labels: Record<string, [string, string]> = {
    "drawing.stroke": ["線を描いています", "描いた線を確認しています"],
    "paint.stroke": ["線を描いています", "描いた線を確認しています"],
    "drawing.erase": ["線を消しています", "消去結果を確認しています"],
    "drawing.shape": ["図形を描いています", "描いた図形を確認しています"],
    "drawing.path": ["パスを描いています", "描いたパスを確認しています"],
    "drawing.fill": ["塗りつぶしています", "塗りつぶし結果を確認しています"],
    "drawing.gradient": ["グラデーションを描いています", "グラデーションを確認しています"],
    "drawing.blur": ["画像をぼかしています", "ぼかし結果を確認しています"],
    "drawing.color_adjust": ["色調を調整しています", "色調整結果を確認しています"],
    "layer.set_active": ["作業レイヤーを切り替えています", "作業レイヤーを確認しています"],
    app_list_tools: ["利用できる操作を確認しています", "利用できる操作を確認しています"],
    agent_complete_stage: ["工程の完了条件を確認しています", "工程の判定結果を確認しています"],
    agent_revisit_stage: ["見直す工程を確認しています", "工程の切り替え結果を確認しています"],
  };
  const known = labels[toolName];
  if (known) return { active: known[0], checking: known[1] };
  return mutates
    ? { active: "キャンバスを編集しています", checking: "編集結果を確認しています" }
    : { active: "操作内容を確認しています", checking: "操作結果を確認しています" };
}
