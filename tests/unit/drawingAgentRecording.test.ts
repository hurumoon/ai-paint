import { describe, expect, it } from "vitest";
import { PaintDocument } from "../../src/core/PaintDocument";
import {
  createDrawingAgentSession,
  exportDrawingAgentSession,
  getDrawingAgentSession,
  importDrawingAgentSession,
  parseDrawingAgentSession,
  serializeDrawingAgentSession,
  setDrawingAgentSession,
} from "../../src/core/agent/session";
import { addDrawingAgentOperation, addDrawingAgentPreviewFrame } from "../../src/core/agent/recording";

const PNG = "data:image/png;base64,AA==";

function session() {
  return createDrawingAgentSession({
    id: "session-1",
    bindingId: "tab-1",
    prompt: "テスト画像を描く",
    provider: "openai",
    model: "fake-model",
    now: 100,
  });
}

describe("DrawingAgent session recording", () => {
  it("keeps initial and final snapshots while evicting bounded intermediate frames", () => {
    const value = session();
    value.limits.maxRecordingFrames = 2;
    value.limits.maxRecordingBytes = 2;
    value.limits.maxRecordingFrameBytes = 1;
    const initial = addDrawingAgentPreviewFrame(value.recording, {
      capturedAt: 1,
      stageId: "composition",
      reasons: ["initial"],
      dataUrl: PNG,
      mimeType: "image/png",
      width: 1,
      height: 1,
      byteLength: 1,
    }, { maxFrames: 2, maxFrameBytes: 1, maxTotalBytes: 2 });
    addDrawingAgentPreviewFrame(value.recording, {
      capturedAt: 2,
      stageId: "composition",
      reasons: ["observation"],
      dataUrl: PNG,
      mimeType: "image/png",
      width: 1,
      height: 1,
      byteLength: 1,
    }, { maxFrames: 2, maxFrameBytes: 1, maxTotalBytes: 2 });
    const final = addDrawingAgentPreviewFrame(value.recording, {
      capturedAt: 3,
      stageId: "composition",
      reasons: ["final"],
      dataUrl: PNG,
      mimeType: "image/png",
      width: 1,
      height: 1,
      byteLength: 1,
    }, { maxFrames: 2, maxFrameBytes: 1, maxTotalBytes: 2 });

    expect(value.recording.frames.map((frame) => frame.id)).toEqual([initial?.id, final?.id]);
    expect(value.recording.totalFrameBytes).toBe(2);
    expect(value.recording.droppedFrames).toBe(1);
  });

  it("redacts secret and image payload fields from operation logs", () => {
    const value = session();
    addDrawingAgentOperation(value.recording, {
      iteration: 1,
      stageId: "composition",
      toolName: "settings.set_api_key",
      startedAt: 1,
      finishedAt: 2,
      mutates: true,
      status: "succeeded",
      arguments: { apiKey: "secret", nested: { imageDataUrl: PNG }, label: "safe" },
      result: { token: "secret", ok: true },
    });

    expect(value.recording.operations[0].arguments).toEqual({
      apiKey: "[秘匿]",
      nested: { imageDataUrl: "[秘匿]" },
      label: "safe",
    });
    expect(value.recording.operations[0].result).toEqual({ token: "[秘匿]", ok: true });
  });

  it("round-trips through the document WeakMap and pauses a persisted running session", () => {
    const doc = new PaintDocument(1, 1, 1);
    const value = session();
    value.status = "running";
    setDrawingAgentSession(doc, value);
    expect(getDrawingAgentSession(doc)?.status).toBe("running");

    const json = exportDrawingAgentSession(doc);
    expect(json).toBeTypeOf("string");
    const secondDoc = new PaintDocument(1, 1, 1);
    const restored = importDrawingAgentSession(secondDoc, json as string);

    expect(restored.status).toBe("paused");
    expect(getDrawingAgentSession(secondDoc)?.prompt).toBe("テスト画像を描く");
    expect(serializeDrawingAgentSession(restored)).toContain('"version":1');
  });

  it("imports legacy sessions without references or per-visit revision metadata", () => {
    const value = session();
    value.canvasRevision = 7;
    const legacy = JSON.parse(serializeDrawingAgentSession(value)) as {
      references?: unknown;
      stageStates: Array<{ visitStartedRevision?: number }>;
    };
    delete legacy.references;
    for (const state of legacy.stageStates) delete state.visitStartedRevision;

    const restored = parseDrawingAgentSession(JSON.stringify(legacy));

    expect(restored.references).toEqual([]);
    expect(restored.stageStates[0].visitStartedRevision).toBe(7);
  });

  it("rejects malformed and oversized recording metadata", () => {
    expect(() => parseDrawingAgentSession("{broken")).toThrow("JSON が壊れています");

    const value = session();
    const malformed = JSON.parse(serializeDrawingAgentSession(value)) as Record<string, unknown>;
    malformed.stageStates = [];
    expect(() => parseDrawingAgentSession(JSON.stringify(malformed))).toThrow(
      "stageStates が stages と一致しません"
    );

    const wrongFrame = session();
    wrongFrame.recording.frames.push({
      id: "bad",
      sequence: 1,
      capturedAt: 1,
      stageId: "composition",
      reasons: ["initial"],
      dataUrl: "data:text/plain;base64,AA==",
      mimeType: "image/png",
      width: 1,
      height: 1,
      byteLength: 1,
    });
    expect(() => serializeDrawingAgentSession(wrongFrame)).toThrow("PNG data URL");

    const wrongSize = session();
    wrongSize.recording.frames.push({
      id: "bad-size",
      sequence: 1,
      capturedAt: 1,
      stageId: "composition",
      reasons: ["initial"],
      dataUrl: PNG,
      mimeType: "image/png",
      width: 1,
      height: 1,
      byteLength: 2,
    });
    expect(() => serializeDrawingAgentSession(wrongSize)).toThrow("実データのサイズと一致しません");
  });
});
