import { PaintApiFault } from "./types";
import type {
  PaintApiContext,
  PaintApiDefinition,
  PaintApiExecuteOptions,
  PaintApiExecuteResult,
  PaintApiErrorCode,
  PaintApiHandler,
} from "./types";
import { validateJsonSchema } from "./validation";

interface RegisteredTool {
  definition: PaintApiDefinition;
  handler: PaintApiHandler;
}

export class PaintApi {
  private readonly tools = new Map<string, RegisteredTool>();
  private operationTail: Promise<void> = Promise.resolve();

  constructor(private readonly context: PaintApiContext) {}

  register(definition: PaintApiDefinition, handler: PaintApiHandler): void {
    if (!/^[a-z][a-z0-9_.-]*$/.test(definition.name)) {
      throw new Error(`不正な API 名です: ${definition.name}`);
    }
    if (this.tools.has(definition.name)) {
      throw new Error(`API は登録済みです: ${definition.name}`);
    }
    this.tools.set(definition.name, {
      definition: structuredClone(definition),
      handler,
    });
  }

  list(): PaintApiDefinition[] {
    return [...this.tools.values()]
      .map(({ definition }) => structuredClone(definition))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async execute(
    name: string,
    args: unknown,
    options: PaintApiExecuteOptions = {}
  ): Promise<PaintApiExecuteResult> {
    const tool = this.tools.get(name);
    if (!tool) return failure("NOT_FOUND", `API が見つかりません: ${name}`);
    if (options.signal?.aborted) return failure("CANCELLED", "操作はキャンセルされました");
    if (!isRecord(args)) {
      return failure("INVALID_ARGUMENT", "引数は object で指定してください");
    }
    const issues = validateJsonSchema(args, tool.definition.parameters);
    if (issues.length > 0) {
      return failure("INVALID_ARGUMENT", "引数が API 定義に一致しません", issues);
    }
    // 画像取得も同じ列で待ち、非同期の描画・保存の途中状態を返さない。
    const previous = this.operationTail;
    let release = (): void => undefined;
    this.operationTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      if (options.signal?.aborted) return failure("CANCELLED", "操作はキャンセルされました");
      if (tool.definition.mutates && this.context.isBusy?.()) return failure("BUSY", "別の処理を実行中です");
      return await this.runHandler(tool, args, options);
    } finally {
      release();
    }
  }

  private async runHandler(
    tool: RegisteredTool,
    args: Record<string, unknown>,
    options: PaintApiExecuteOptions
  ): Promise<PaintApiExecuteResult> {
    let release: (() => void) | undefined;
    try {
      if (tool.definition.mutates) release = this.context.beginMutation?.(tool.definition.name);
      const value = await tool.handler(args, { app: this.context, signal: options.signal });
      return { ok: true, value };
    } catch (error) {
      if (error instanceof PaintApiFault) return failure(error.code, error.message, error.details);
      return failure("EXECUTION_FAILED", error instanceof Error ? error.message : "API 実行に失敗しました");
    } finally {
      release?.();
    }
  }
}

function failure(
  code: PaintApiErrorCode,
  message: string,
  details?: unknown
): PaintApiExecuteResult {
  return { ok: false, error: { code, message, ...(details === undefined ? {} : { details }) } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
