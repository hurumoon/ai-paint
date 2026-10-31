import type { BrushSettings, CustomBrushRuntime } from "../brushEngine";
import type { History } from "../History";
import type { PaintDocument } from "../PaintDocument";
import type { Timelapse } from "../Timelapse";
import type { Selection } from "../../types";

export type JsonSchema = Record<string, unknown>;

export interface PaintApiDefinition {
  name: string;
  description: string;
  parameters: JsonSchema;
  mutates: boolean;
  returns?: JsonSchema;
  usage?: string;
}

export type PaintApiErrorCode =
  | "NOT_FOUND"
  | "INVALID_ARGUMENT"
  | "NO_DOCUMENT"
  | "BUSY"
  | "LOCKED"
  | "CANCELLED"
  | "EXECUTION_FAILED";

export interface PaintApiError {
  code: PaintApiErrorCode;
  message: string;
  details?: unknown;
}

export type PaintApiExecuteResult<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; error: PaintApiError };

export interface PaintApiExecuteOptions {
  signal?: AbortSignal;
}

export interface PaintApiContext {
  getDocument(): PaintDocument | null;
  getHistory(): History | null;
  getTimelapse(): Timelapse | null;
  getSelection(): Selection;
  setSelection(selection: Selection): void;
  isBusy?(): boolean;
  beginMutation?(name: string): (() => void) | undefined;
  resolveCustomBrush?(id: string): Promise<CustomBrushRuntime | null>;
}

export interface PaintApiHandlerContext {
  app: PaintApiContext;
  signal?: AbortSignal;
}

export type PaintApiHandler = (
  args: Record<string, unknown>,
  context: PaintApiHandlerContext
) => unknown | Promise<unknown>;

export interface PaintApiImageResult {
  dataUrl: string;
  mimeType: "image/png";
  width: number;
  height: number;
  byteLength: number;
  region: { x: number; y: number; width: number; height: number };
}

export type SerializableBrushSettings = Omit<BrushSettings, "custom"> & {
  customBrushId?: string;
};

export class PaintApiFault extends Error {
  constructor(
    readonly code: PaintApiErrorCode,
    message: string,
    readonly details?: unknown
  ) {
    super(message);
    this.name = "PaintApiFault";
  }
}
