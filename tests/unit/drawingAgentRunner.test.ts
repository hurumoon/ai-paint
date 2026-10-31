import { describe, expect, it, vi } from "vitest";
import { DrawingAgent } from "../../src/core/agent/runner";
import type { DrawingAgentPaintApi, DrawingAgentModelRequester } from "../../src/core/agent/runner";
import type { ModelResponse } from "../../src/core/agent/modelTypes";
import type { PaintApiDefinition, PaintApiExecuteResult } from "../../src/core/paintApi/types";
import { agentControlDefinitions } from "../../src/hooks/agent/agentControlApi";

const ONE_PIXEL_PNG = "data:image/png;base64,AA==";
const CHANGED_ONE_PIXEL_PNG = "data:image/png;base64,AQ==";
const REFERENCE = {
  id: "ref-1",
  name: "目標.png",
  dataUrl: ONE_PIXEL_PNG,
  width: 1,
  height: 1,
  byteLength: 1,
};

const definitions: PaintApiDefinition[] = [
  {
    name: "document.get_image",
    description: "現在画像",
    parameters: { type: "object", additionalProperties: false },
    mutates: false,
  },
  {
    name: "drawing.stroke",
    description: "線を描く",
    parameters: { type: "object", additionalProperties: true },
    mutates: true,
  },
  {
    name: "layer.set_active",
    description: "作業レイヤーを選択",
    parameters: { type: "object", additionalProperties: true },
    mutates: true,
  },
];

function imageResult(dataUrl = ONE_PIXEL_PNG): PaintApiExecuteResult {
  return {
    ok: true,
    value: {
      dataUrl,
      mimeType: "image/png",
      width: 1,
      height: 1,
      byteLength: 1,
      region: { x: 0, y: 0, width: 1, height: 1 },
    },
  };
}

function makeApi(
  executeTool: (name: string, args: unknown, signal?: AbortSignal) => Promise<PaintApiExecuteResult> =
    async () => ({ ok: true, value: { applied: true } })
): DrawingAgentPaintApi {
  let rasterChanged = false;
  return {
    list: () => definitions,
    execute: async (name, args, options) => {
      if (name === "document.get_image") {
        return imageResult(rasterChanged ? CHANGED_ONE_PIXEL_PNG : ONE_PIXEL_PNG);
      }
      const result = await executeTool(name, args, options?.signal);
      if (name === "drawing.stroke" && result.ok) rasterChanged = !rasterChanged;
      return result;
    },
  };
}

function response(value: Partial<ModelResponse>): ModelResponse {
  return {
    text: "",
    calls: [],
    inputTokens: 10,
    outputTokens: 5,
    ...value,
  };
}

function oneStage() {
  return [
    {
      id: "draw",
      title: "描画",
      goal: "線を描く",
      completionCriteria: ["線が見える"],
    },
  ];
}

describe("DrawingAgent", () => {
  it("only lists drawing tools and rejects direct calls to registered non-drawing and future APIs", async () => {
    const blocked = ["file.save", "file.export", "file.open", "settings.update", "tabs.create", "ai.generate", "agent.start", "canvas.resize", "layer.remove", "layer.merge_down", "history.undo", "history.redo", "drawing.future_tool", "unknown.tool"];
    const execute = vi.fn(async () => ({ ok: true, value: { applied: true } }) as PaintApiExecuteResult);
    const api = makeApi(execute);
    api.list = () => [...definitions, ...blocked.map(name => ({
      name, description: name, parameters: { type: "object" }, mutates: true,
    }))];
    const requests: Parameters<DrawingAgentModelRequester>[0][] = [];
    const agent = new DrawingAgent({
      paintApi: api, bindingId: "tab",
      requestModel: async request => {
        requests.push(request);
        if (requests.length === 1) return response({ continuation: "restricted", calls: [
          { id: "list", name: "app_list_tools", arguments: {} },
          { id: "filtered-list", name: "app_list_tools", arguments: { query: "file", mutatingOnly: true } },
          ...blocked.map(name => ({ id: name, name: "app_call_tool", arguments: { name, arguments: {} } })),
          { id: "draw", name: "app_call_tool", arguments: { name: "drawing.stroke", arguments: {} } },
        ] });
        return response({ calls: [{ id: "complete", name: "agent_complete_stage", arguments: { summary: "描画完了", criteriaEvidence: ["線を確認"] } }] });
      },
    });
    await agent.start({ prompt: "描画", provider: "openai", model: "fake", stages: oneStage() });
    expect(agent.getSnapshot().status).toBe("completed");
    expect(requests[1].toolResults?.[0].output).toEqual(definitions);
    expect(requests[1].toolResults?.[1].output).toEqual([]);
    for (const name of blocked) {
      expect(requests[1].toolResults?.find(result => result.callId === name)).toMatchObject({
        isError: true, output: { error: { code: "TOOL_NOT_ALLOWED" } },
      });
      expect(agent.getSession()?.recording.operations.find(operation => operation.toolName === name)?.status).toBe("rejected");
    }
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith("drawing.stroke", {}, expect.any(AbortSignal));
  });

  it("executes a mutation, sends its exact result through continuation, then completes after inspecting the new image", async () => {
    const requests: Parameters<DrawingAgentModelRequester>[0][] = [];
    const requestModel: DrawingAgentModelRequester = vi.fn(async (request) => {
      requests.push(request);
      if (requests.length === 1) {
        return response({
          continuation: "continue-1",
          calls: [
            {
              id: "call-draw",
              name: "app_call_tool",
              arguments: { name: "drawing.stroke", arguments: { points: [1, 2] } },
            },
          ],
        });
      }
      return response({
        calls: [
          {
            id: "call-complete",
            name: "agent_complete_stage",
            arguments: { summary: "線を描画", criteriaEvidence: ["最新画像で線を確認"] },
          },
        ],
      });
    });
    const agent = new DrawingAgent({
      paintApi: makeApi(),
      bindingId: "tab-1",
      requestModel,
    });

    await agent.start({
      prompt: "一本の線を描く",
      provider: "openai",
      model: "fake-model",
      stages: oneStage(),
      references: [REFERENCE],
    });

    expect(agent.getSnapshot().status).toBe("completed");
    expect(requests).toHaveLength(2);
    expect(requests[1].continuation).toBe("continue-1");
    expect(requests[0].referenceImages).toEqual([
      { name: "目標.png", dataUrl: ONE_PIXEL_PNG },
    ]);
    expect(requests[1].referenceImages).toBeUndefined();
    expect(requests[0].reasoningEffort).toBeUndefined();
    expect(requests[1].toolResults).toEqual([
      { callId: "call-draw", output: { applied: true } },
    ]);
    expect(requests[1].imageDataUrl).toBe(CHANGED_ONE_PIXEL_PNG);
    const session = agent.getSession();
    expect(session?.recording.operations.map((item) => item.toolName)).toEqual([
      "drawing.stroke",
      "agent_complete_stage",
    ]);
    expect(session?.recording.frames[0].reasons).toContain("initial");
    expect(session?.recording.frames.some((frame) => frame.reasons.includes("final"))).toBe(true);
    const preview = agent.getPreviewFrame(0);
    expect(preview?.dataUrl).toBe(ONE_PIXEL_PNG);
    preview?.reasons.push("final");
    expect(agent.getPreviewFrame(0)?.reasons).not.toContain("final");
  });

  it("rejects stage completion in the same batch as drawing and feeds the rejection back", async () => {
    const requests: Parameters<DrawingAgentModelRequester>[0][] = [];
    const requestModel: DrawingAgentModelRequester = vi.fn(async (request) => {
      requests.push(request);
      if (requests.length === 1) {
        return response({
          continuation: "continue-1",
          calls: [
            {
              id: "draw",
              name: "app_call_tool",
              arguments: { name: "drawing.stroke", arguments: {} },
            },
            {
              id: "too-early",
              name: "agent_complete_stage",
              arguments: { summary: "完了", criteriaEvidence: ["線を確認"] },
            },
          ],
        });
      }
      return response({
        calls: [
          {
            id: "complete-after-inspection",
            name: "agent_complete_stage",
            arguments: { summary: "完了", criteriaEvidence: ["描画後画像で線を確認"] },
          },
        ],
      });
    });
    const agent = new DrawingAgent({ paintApi: makeApi(), bindingId: "tab", requestModel });

    await agent.start({
      prompt: "線を描く",
      provider: "anthropic",
      model: "fake-model",
      stages: oneStage(),
    });

    expect(agent.getSnapshot().status).toBe("completed");
    expect(requests[1].toolResults?.[1]).toMatchObject({
      callId: "too-early",
      isError: true,
      output: { error: { code: "RASTER_CHANGE_REQUIRED" } },
    });
    expect(agent.getSession()?.recording.operations[1].status).toBe("rejected");
  });

  it("invalidates an earlier review when another drawing and completion share a response", async () => {
    const requests: Parameters<DrawingAgentModelRequester>[0][] = [];
    const requestModel: DrawingAgentModelRequester = vi.fn(async request => {
      requests.push(request);
      if (requests.length === 1) {
        return response({
          continuation: "first-draw",
          calls: [{ id: "draw-1", name: "app_call_tool", arguments: { name: "drawing.stroke", arguments: {} } }],
        });
      }
      if (requests.length === 2) {
        return response({
          continuation: "draw-and-complete",
          calls: [
            { id: "draw-2", name: "app_call_tool", arguments: { name: "drawing.stroke", arguments: {} } },
            { id: "complete-too-soon", name: "agent_complete_stage", arguments: { summary: "完了", criteriaEvidence: ["直前の観察画像で確認"] } },
          ],
        });
      }
      return response({
        calls: [{ id: "complete-reviewed", name: "agent_complete_stage", arguments: { summary: "再確認して完了", criteriaEvidence: ["追加描画後の画像で確認"] } }],
      });
    });
    const agent = new DrawingAgent({ paintApi: makeApi(), bindingId: "tab", requestModel });

    await agent.start({
      prompt: "二本の線を描く",
      provider: "openai",
      model: "fake-model",
      stages: oneStage(),
    });

    expect(requests[2].toolResults?.[1]).toMatchObject({
      callId: "complete-too-soon",
      isError: true,
      output: { error: { code: "INSPECTION_REQUIRED" } },
    });
    expect(agent.getSnapshot().status).toBe("completed");
    expect(agent.getSession()?.recording.operations[2]).toMatchObject({
      toolName: "agent_complete_stage",
      status: "rejected",
    });
  });

  it("lets the model recover from a failed paint operation using the returned error", async () => {
    let attempts = 0;
    const api = makeApi(async () => {
      attempts += 1;
      return attempts === 1
        ? { ok: false, error: { code: "INVALID_ARGUMENT", message: "座標が不正です" } }
        : { ok: true, value: { applied: true } };
    });
    const requests: Parameters<DrawingAgentModelRequester>[0][] = [];
    const requestModel: DrawingAgentModelRequester = vi.fn(async (request) => {
      requests.push(request);
      if (requests.length <= 2) {
        return response({
          continuation: `continue-${requests.length}`,
          calls: [
            {
              id: `draw-${requests.length}`,
              name: "app_call_tool",
              arguments: { name: "drawing.stroke", arguments: { attempt: requests.length } },
            },
          ],
        });
      }
      return response({
        calls: [
          {
            id: "complete",
            name: "agent_complete_stage",
            arguments: { summary: "再試行成功", criteriaEvidence: ["最新画像で確認"] },
          },
        ],
      });
    });
    const agent = new DrawingAgent({ paintApi: api, bindingId: "tab", requestModel });

    await agent.start({
      prompt: "線を描く",
      provider: "openai",
      model: "fake-model",
      stages: oneStage(),
    });

    expect(agent.getSnapshot().status).toBe("completed");
    expect(requests[1].toolResults?.[0]).toMatchObject({
      callId: "draw-1",
      isError: true,
      output: { error: { code: "INVALID_ARGUMENT", message: "座標が不正です" } },
    });
    expect(agent.getSession()?.recording.operations.map((item) => item.status)).toEqual([
      "failed",
      "succeeded",
      "succeeded",
    ]);
  });

  it("reopens an earlier stage and invalidates later stage completion", async () => {
    const replies: ModelResponse[] = [
      response({ continuation: "c1", calls: [{ id: "draw-1", name: "app_call_tool", arguments: { name: "drawing.stroke", arguments: {} } }] }),
      response({ continuation: "c2", calls: [{ id: "done-1", name: "agent_complete_stage", arguments: { summary: "第一工程完了", criteriaEvidence: ["画像で確認"] } }] }),
      response({ continuation: "c3", calls: [{ id: "back", name: "agent_revisit_stage", arguments: { stageId: "rough", reason: "後工程で比率の修正が必要" } }] }),
      response({ continuation: "c4", calls: [{ id: "draw-2", name: "app_call_tool", arguments: { name: "drawing.stroke", arguments: {} } }] }),
      response({ continuation: "c5", calls: [{ id: "done-again", name: "agent_complete_stage", arguments: { summary: "修正完了", criteriaEvidence: ["修正後画像で確認"] } }] }),
      response({ continuation: "c6", calls: [{ id: "draw-finish", name: "app_call_tool", arguments: { name: "drawing.stroke", arguments: {} } }] }),
      response({ calls: [{ id: "finish", name: "agent_complete_stage", arguments: { summary: "仕上げ完了", criteriaEvidence: ["全体画像で確認"] } }] }),
    ];
    const requestModel: DrawingAgentModelRequester = vi.fn(async () => replies.shift() as ModelResponse);
    const agent = new DrawingAgent({ paintApi: makeApi(), bindingId: "tab", requestModel });

    await agent.start({
      prompt: "形を描いて仕上げる",
      provider: "openai",
      model: "fake-model",
      stages: [
        { id: "rough", title: "ラフ", goal: "形を決める", completionCriteria: ["形が読める"] },
        { id: "finish", title: "仕上げ", goal: "全体を確認", completionCriteria: ["破綻がない"] },
      ],
    });

    expect(agent.getSnapshot().status).toBe("completed");
    expect(agent.getSession()?.stageStates).toMatchObject([
      { stageId: "rough", status: "completed", visits: 2, summary: "修正完了" },
      { stageId: "finish", status: "completed", visits: 2, summary: "仕上げ完了" },
    ]);
    expect(agent.getSession()?.recording.operations.map((item) => item.toolName)).toContain("agent_revisit_stage");
  });

  it("rejects blank completion after a no-op mutating tool until raster work is observed", async () => {
    const requests: Parameters<DrawingAgentModelRequester>[0][] = [];
    const replies: ModelResponse[] = [
      response({ continuation: "noop", calls: [{ id: "select", name: "app_call_tool", arguments: { name: "layer.set_active", arguments: { layerId: "already-active" } } }] }),
      response({ continuation: "rejected", calls: [{ id: "blank-complete", name: "agent_complete_stage", arguments: { summary: "完了", criteriaEvidence: ["画像で確認"] } }] }),
      response({ continuation: "drawn", calls: [{ id: "real-draw", name: "app_call_tool", arguments: { name: "drawing.stroke", arguments: {} } }] }),
      response({ calls: [{ id: "complete", name: "agent_complete_stage", arguments: { summary: "描画完了", criteriaEvidence: ["変更後画像で確認"] } }] }),
    ];
    const requestModel: DrawingAgentModelRequester = vi.fn(async request => {
      requests.push(request);
      return replies.shift() as ModelResponse;
    });
    const agent = new DrawingAgent({ paintApi: makeApi(), bindingId: "tab", requestModel });

    await agent.start({
      prompt: "線を描く",
      provider: "openai",
      model: "fake-model",
      stages: oneStage(),
    });

    expect(requests[2].toolResults?.[0]).toMatchObject({
      callId: "blank-complete",
      isError: true,
      output: { error: { code: "RASTER_CHANGE_REQUIRED" } },
    });
    expect(agent.getSnapshot().status).toBe("completed");
    expect(agent.getSession()?.canvasRevision).toBe(1);
  });

  it("retains references across budget resumes and sends them on each new conversation", async () => {
    const requests: Parameters<DrawingAgentModelRequester>[0][] = [];
    const requestModel: DrawingAgentModelRequester = vi.fn(async request => {
      requests.push(request);
      if (requests.length === 1) return response({ text: "構図を確認" });
      if (requests.length === 2) {
        return response({ continuation: "draw", calls: [{ id: "draw", name: "app_call_tool", arguments: { name: "drawing.stroke", arguments: {} } }] });
      }
      return response({ calls: [{ id: "complete", name: "agent_complete_stage", arguments: { summary: "完了", criteriaEvidence: ["見本と変更後画像を確認"] } }] });
    });
    const agent = new DrawingAgent({ paintApi: makeApi(), bindingId: "tab", requestModel });
    const longReferenceName = "目".repeat(300);
    const references = [{ ...REFERENCE, name: longReferenceName }];

    await agent.start({
      prompt: "見本に沿って描く",
      provider: "openai",
      model: "gpt-6-astra",
      stages: oneStage(),
      references,
      limits: { maxModelCalls: 1 },
    });
    expect(agent.getSnapshot().status).toBe("limit_reached");

    await agent.resume({ limits: { maxModelCalls: 2 } });
    expect(agent.getSnapshot().status).toBe("limit_reached");
    await agent.resume({ limits: { maxModelCalls: 3 } });

    expect(agent.getSnapshot().status).toBe("completed");
    expect(agent.getSession()?.usage.modelCalls).toBe(3);
    expect(agent.getReferences()).toEqual(references);
    for (const request of requests) {
      expect(request.instructions).toContain("元の制作指示:\n見本に沿って描く");
      expect(request.instructions).toMatch(/残り目安: 反復 \d+ 回、ツール操作 \d+ 回/);
      expect(request.referenceImages).toEqual([{ name: longReferenceName, dataUrl: ONE_PIXEL_PNG }]);
      expect(request.referenceImages?.[0].name).toHaveLength(300);
      expect(request.reasoningEffort).toBe("high");
    }
  });

  it("ignores a late model response after pause", async () => {
    let resolveModel: ((value: ModelResponse) => void) | undefined;
    let markRequestStarted: (() => void) | undefined;
    const requestStarted = new Promise<void>((resolve) => {
      markRequestStarted = resolve;
    });
    const requestModel: DrawingAgentModelRequester = vi.fn(
      () =>
        new Promise<ModelResponse>((resolveResponse) => {
          resolveModel = resolveResponse;
          markRequestStarted?.();
        })
    );
    const executeTool = vi.fn(async () => ({ ok: true as const, value: { applied: true } }));
    const agent = new DrawingAgent({
      paintApi: makeApi(executeTool),
      bindingId: "tab",
      requestModel,
    });
    const run = agent.start({
      prompt: "線を描く",
      provider: "openai",
      model: "fake-model",
      stages: oneStage(),
    });

    await requestStarted;
    expect(agent.getSnapshot().activity).toMatchObject({
      phase: "thinking",
      label: "次の描画を考えています",
    });
    agent.pause();
    resolveModel?.(
      response({
        continuation: "late",
        calls: [
          { id: "late-draw", name: "app_call_tool", arguments: { name: "drawing.stroke", arguments: {} } },
        ],
      })
    );
    await run;
    expect(agent.getSnapshot().status).toBe("paused");
    expect(executeTool).not.toHaveBeenCalled();
  });

  it("keeps a paused agent settling until a late tool result is recorded", async () => {
    let finishOperation: ((value: PaintApiExecuteResult) => void) | undefined;
    let markOperationStarted: (() => void) | undefined;
    const operationStarted = new Promise<void>((resolve) => {
      markOperationStarted = resolve;
    });
    const executeTool = vi.fn(
      () =>
        new Promise<PaintApiExecuteResult>((resolve) => {
          finishOperation = resolve;
          markOperationStarted?.();
        })
    );
    const requestModel: DrawingAgentModelRequester = vi.fn(async () =>
      response({
        continuation: "continue",
        calls: [
          { id: "draw", name: "app_call_tool", arguments: { name: "drawing.stroke", arguments: {} } },
        ],
      })
    );
    const agent = new DrawingAgent({
      paintApi: makeApi(executeTool),
      bindingId: "tab",
      requestModel,
    });
    const run = agent.start({
      prompt: "線を描く",
      provider: "openai",
      model: "fake-model",
      stages: oneStage(),
    });

    await operationStarted;
    agent.pause();
    agent.pause();

    expect(agent.getSnapshot()).toMatchObject({ status: "paused", settling: true });
    expect(() => agent.resume()).toThrow("停止処理が完了するまで");
    expect(() =>
      agent.start({
        prompt: "別の線を描く",
        provider: "openai",
        model: "fake-model",
        stages: oneStage(),
      })
    ).toThrow("停止処理が完了するまで");

    finishOperation?.({ ok: true, value: { applied: true } });
    await run;

    expect(agent.getSnapshot()).toMatchObject({ status: "paused", settling: false });
    expect(agent.getSession()?.recording.operations).toMatchObject([
      { toolName: "drawing.stroke", status: "succeeded", mutates: true },
    ]);
  });

  it("records an in-flight operation that finishes during stop and captures its final pixels", async () => {
    let finishOperation: ((value: PaintApiExecuteResult) => void) | undefined;
    let markOperationStarted: (() => void) | undefined;
    const operationStarted = new Promise<void>((resolve) => {
      markOperationStarted = resolve;
    });
    const executeTool = vi.fn(
      () =>
        new Promise<PaintApiExecuteResult>((resolve) => {
          finishOperation = resolve;
          markOperationStarted?.();
        })
    );
    const requestModel: DrawingAgentModelRequester = vi.fn(async () =>
      response({
        continuation: "continue",
        calls: [
          { id: "draw", name: "app_call_tool", arguments: { name: "drawing.stroke", arguments: {} } },
        ],
      })
    );
    const agent = new DrawingAgent({
      paintApi: makeApi(executeTool),
      bindingId: "tab",
      requestModel,
    });
    const run = agent.start({
      prompt: "線を描く",
      provider: "openai",
      model: "fake-model",
      stages: oneStage(),
    });
    await operationStarted;
    expect(agent.getSnapshot().activity).toMatchObject({
      phase: "drawing",
      label: "線を描いています",
      toolName: "drawing.stroke",
    });

    const stopped = agent.stop();
    const stoppedAgain = agent.stop();
    expect(agent.getSnapshot()).toMatchObject({ status: "stopped", settling: true });
    finishOperation?.({ ok: true, value: { applied: true } });
    await Promise.all([run, stopped, stoppedAgain]);

    expect(agent.getSnapshot()).toMatchObject({ status: "stopped", settling: false });
    expect(agent.getSession()?.recording.operations).toMatchObject([
      { toolName: "drawing.stroke", status: "succeeded", mutates: true },
    ]);
    expect(agent.getSession()?.recording.frames.some((frame) => frame.reasons.includes("final"))).toBe(true);
  });

  it("stops at the configured iteration budget without spinning", async () => {
    const requestModel = vi.fn(async () => response({ text: "計画だけ返す" }));
    const agent = new DrawingAgent({ paintApi: makeApi(), bindingId: "tab", requestModel });

    await agent.start({
      prompt: "線を描く",
      provider: "openai",
      model: "fake-model",
      stages: oneStage(),
      limits: { maxIterations: 1 },
    });

    expect(requestModel).toHaveBeenCalledTimes(1);
    expect(agent.getSnapshot()).toMatchObject({
      status: "limit_reached",
      stopReason: "反復回数の上限に達しました",
    });
  });

  it("exposes every resumable execution limit through the public agent API", () => {
    const resume = agentControlDefinitions.find(definition => definition.name === "agent.resume");
    const parameters = resume?.parameters as {
      properties?: { limits?: { properties?: Record<string, unknown> } };
    };

    expect(Object.keys(parameters.properties?.limits?.properties ?? {}).sort()).toEqual([
      "maxDurationMs",
      "maxInputTokens",
      "maxIterations",
      "maxModelCalls",
      "maxOperationRecords",
      "maxOutputTokens",
      "maxRecordingBytes",
      "maxRecordingFrameBytes",
      "maxRecordingFrames",
      "maxToolCalls",
      "maxTotalTokens",
    ]);
  });

  it("does not execute calls from a response that crosses the token budget", async () => {
    const executeTool = vi.fn(async () => ({ ok: true as const, value: { applied: true } }));
    const requestModel: DrawingAgentModelRequester = vi.fn(async () =>
      response({
        inputTokens: 9,
        outputTokens: 2,
        continuation: "over-budget",
        calls: [
          { id: "draw", name: "app_call_tool", arguments: { name: "drawing.stroke", arguments: {} } },
        ],
      })
    );
    const agent = new DrawingAgent({
      paintApi: makeApi(executeTool),
      bindingId: "tab",
      requestModel,
    });

    await agent.start({
      prompt: "線を描く",
      provider: "openai",
      model: "fake-model",
      stages: oneStage(),
      limits: { maxTotalTokens: 10 },
    });

    expect(agent.getSnapshot()).toMatchObject({
      status: "limit_reached",
      stopReason: "総トークン上限に達しました",
    });
    expect(executeTool).not.toHaveBeenCalled();
  });

  it("surfaces session adapter failures and stops before calling the model", async () => {
    const requestModel = vi.fn(async () => response({}));
    const agent = new DrawingAgent({
      paintApi: makeApi(),
      bindingId: "tab",
      requestModel,
      onSessionChange: () => {
        throw new Error("disk unavailable");
      },
    });

    await agent.start({
      prompt: "線を描く",
      provider: "openai",
      model: "fake-model",
      stages: oneStage(),
    });

    expect(agent.getSnapshot()).toMatchObject({
      status: "error",
      error: "AIドロー（β版）の制作記録を保存できません: disk unavailable",
    });
    expect(requestModel).not.toHaveBeenCalled();
  });
});
