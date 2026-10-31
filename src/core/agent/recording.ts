export const MAX_AGENT_RECORDING_FRAMES = 180;
export const MAX_AGENT_RECORDING_FRAME_BYTES = 12 * 1024 * 1024;
export const MAX_AGENT_RECORDING_BYTES = 48 * 1024 * 1024;
export const MAX_AGENT_OPERATION_RECORDS = 2_000;

export type DrawingAgentFrameReason =
  | "initial"
  | "observation"
  | "stage_complete"
  | "final";

export interface DrawingAgentPreviewFrame {
  id: string;
  sequence: number;
  capturedAt: number;
  stageId: string;
  reasons: DrawingAgentFrameReason[];
  dataUrl: string;
  mimeType: "image/png";
  width: number;
  height: number;
  byteLength: number;
}

export interface DrawingAgentOperationRecord {
  id: string;
  sequence: number;
  iteration: number;
  stageId: string;
  toolName: string;
  startedAt: number;
  finishedAt: number;
  mutates: boolean;
  status: "succeeded" | "failed" | "cancelled" | "rejected";
  arguments: unknown;
  result: unknown;
}

export interface DrawingAgentRecording {
  version: 1;
  frames: DrawingAgentPreviewFrame[];
  operations: DrawingAgentOperationRecord[];
  totalFrameBytes: number;
  droppedFrames: number;
  droppedOperations: number;
}

export interface AgentPreviewImage {
  dataUrl: string;
  mimeType: "image/png";
  width: number;
  height: number;
  byteLength: number;
}

export function createDrawingAgentRecording(): DrawingAgentRecording {
  return {
    version: 1,
    frames: [],
    operations: [],
    totalFrameBytes: 0,
    droppedFrames: 0,
    droppedOperations: 0,
  };
}

export function addDrawingAgentPreviewFrame(
  recording: DrawingAgentRecording,
  frame: Omit<DrawingAgentPreviewFrame, "id" | "sequence">,
  limits: {
    maxFrames?: number;
    maxFrameBytes?: number;
    maxTotalBytes?: number;
  } = {}
): DrawingAgentPreviewFrame | undefined {
  const maxFrames = limits.maxFrames ?? MAX_AGENT_RECORDING_FRAMES;
  const maxFrameBytes = limits.maxFrameBytes ?? MAX_AGENT_RECORDING_FRAME_BYTES;
  const maxTotalBytes = limits.maxTotalBytes ?? MAX_AGENT_RECORDING_BYTES;
  if (frame.byteLength > maxFrameBytes || frame.byteLength > maxTotalBytes) {
    recording.droppedFrames += 1;
    return undefined;
  }

  const next: DrawingAgentPreviewFrame = {
    ...frame,
    id: `frame-${nextSequence(recording.frames)}`,
    sequence: nextSequence(recording.frames),
    reasons: [...new Set(frame.reasons)],
  };

  while (
    recording.frames.length >= maxFrames ||
    recording.totalFrameBytes + next.byteLength > maxTotalBytes
  ) {
    const removableIndex = recording.frames.findIndex(
      (candidate) => !candidate.reasons.includes("initial") && !candidate.reasons.includes("final")
    );
    if (removableIndex < 0) {
      recording.droppedFrames += 1;
      return undefined;
    }
    const [removed] = recording.frames.splice(removableIndex, 1);
    recording.totalFrameBytes -= removed.byteLength;
    recording.droppedFrames += 1;
  }

  recording.frames.push(next);
  recording.totalFrameBytes += next.byteLength;
  return next;
}

export function addFrameReason(
  recording: DrawingAgentRecording,
  frameId: string,
  reason: DrawingAgentFrameReason
): boolean {
  const frame = recording.frames.find((candidate) => candidate.id === frameId);
  if (!frame) return false;
  if (!frame.reasons.includes(reason)) frame.reasons.push(reason);
  return true;
}

export function addDrawingAgentOperation(
  recording: DrawingAgentRecording,
  operation: Omit<DrawingAgentOperationRecord, "id" | "sequence">,
  maxOperations = MAX_AGENT_OPERATION_RECORDS
): DrawingAgentOperationRecord {
  const sequence = nextSequence(recording.operations);
  const next: DrawingAgentOperationRecord = {
    ...operation,
    id: `operation-${sequence}`,
    sequence,
    arguments: sanitizeAgentLogValue(operation.arguments),
    result: sanitizeAgentLogValue(operation.result),
  };
  if (recording.operations.length >= maxOperations) {
    recording.operations.shift();
    recording.droppedOperations += 1;
  }
  recording.operations.push(next);
  return next;
}

export function sanitizeAgentLogValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[省略]";
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "string") {
    if (value.startsWith("data:")) return `[画像データ ${value.length}文字]`;
    return value.length <= 4_000 ? value : `${value.slice(0, 4_000)}…[省略]`;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => sanitizeAgentLogValue(item, depth + 1));
  }
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
      if (/(api.?key|secret|authorization|password|token|base64|data.?url)/i.test(key)) {
        output[key] = "[秘匿]";
      } else {
        output[key] = sanitizeAgentLogValue(child, depth + 1);
      }
    }
    return output;
  }
  return String(value);
}

export function getPngDataUrlByteLength(dataUrl: string): number | undefined {
  const prefix = "data:image/png;base64,";
  if (!dataUrl.startsWith(prefix)) return undefined;
  const payload = dataUrl.slice(prefix.length);
  if (!payload || payload.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) {
    return undefined;
  }
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return (payload.length / 4) * 3 - padding;
}

function nextSequence(items: readonly { sequence: number }[]): number {
  return (items[items.length - 1]?.sequence ?? 0) + 1;
}
