import {
  cropDocumentToBase64ForAI,
  DEFAULT_AI_IMAGE_MAX_EDGE,
  flattenDocumentToBase64ForAI,
} from "../aiImagePayload";
import { objectSchema, emptyObjectSchema } from "./schemas";
import { requireState, selectionSummary, throwIfAborted } from "./helpers";
import type { PaintApi } from "./PaintApi";
import { PaintApiFault, type PaintApiImageResult } from "./types";

export function registerDocumentTools(api: PaintApi): void {
  api.register(
    {
      name: "document.get_state",
      description: "現在のキャンバス、選択範囲、レイヤー、履歴、タイムラプス状態を返します。",
      parameters: emptyObjectSchema,
      mutates: false,
      usage: "描画前後の状態確認に使います。",
    },
    (_args, { app }) => {
      const { doc, history, timelapse, selection } = requireState(app);
      return {
        width: doc.width,
        height: doc.height,
        dpi: doc.dpi,
        version: doc.getSnapshot(),
        activeLayerId: doc.activeLayerId,
        selection: selectionSummary(selection),
        history: { canUndo: history.canUndo(), canRedo: history.canRedo() },
        timelapse: { enabled: timelapse.isEnabled(), frameCount: timelapse.frameCount() },
        layers: doc.layers.map((layer, index) => ({
          index,
          ...layer.meta,
          deferred: layer.deferred ? { ...layer.deferred } : undefined,
        })),
      };
    }
  );

  api.register(
    {
      name: "document.get_image",
      description: "合成済みキャンバス全体または矩形範囲を PNG data URL で返します。",
      parameters: objectSchema({
        x: { type: "integer", minimum: 0 },
        y: { type: "integer", minimum: 0 },
        width: { type: "integer", minimum: 1 },
        height: { type: "integer", minimum: 1 },
        maxEdge: { type: "integer", minimum: 1, maximum: 16384 },
      }),
      mutates: false,
      returns: objectSchema({
        dataUrl: { type: "string" },
        mimeType: { type: "string", enum: ["image/png"] },
        width: { type: "integer" },
        height: { type: "integer" },
        byteLength: { type: "integer" },
        region: { type: "object" },
      }, ["dataUrl", "mimeType", "width", "height", "byteLength", "region"]),
      usage: "視覚的な確認には毎回この結果を使います。x/y/width/height は4項目すべて指定します。",
    },
    async (args, { app, signal }): Promise<PaintApiImageResult> => {
      const { doc } = requireState(app);
      const hasCrop = args.x !== undefined || args.y !== undefined || args.width !== undefined || args.height !== undefined;
      if (hasCrop && [args.x, args.y, args.width, args.height].some((value) => value === undefined)) {
        throw new PaintApiFault(
          "INVALID_ARGUMENT",
          "切り出しには x, y, width, height のすべてが必要です"
        );
      }
      const region = hasCrop
        ? { x: args.x as number, y: args.y as number, width: args.width as number, height: args.height as number }
        : { x: 0, y: 0, width: doc.width, height: doc.height };
      if (region.x + region.width > doc.width || region.y + region.height > doc.height) {
        throw new PaintApiFault("INVALID_ARGUMENT", "切り出し範囲がキャンバス外です");
      }
      const maxEdge = (args.maxEdge as number | undefined) ?? DEFAULT_AI_IMAGE_MAX_EDGE;
      throwIfAborted(signal);
      const payload = hasCrop
        ? await cropDocumentToBase64ForAI(doc, region.x, region.y, region.width, region.height, maxEdge)
        : await flattenDocumentToBase64ForAI(doc, maxEdge);
      throwIfAborted(signal);
      return {
        dataUrl: `data:image/png;base64,${payload.base64}`,
        mimeType: "image/png",
        width: payload.width,
        height: payload.height,
        byteLength: base64ByteLength(payload.base64),
        region,
      };
    }
  );
}

function base64ByteLength(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}
