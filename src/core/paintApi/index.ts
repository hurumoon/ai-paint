import { registerDocumentTools } from "./documentTools";
import { registerDrawingTools } from "./drawingTools";
import { registerLayerAndCanvasTools } from "./layerTools";
import { PaintApi } from "./PaintApi";
import { registerSelectionTools } from "./selectionTools";
import { registerUtilityTools } from "./utilityTools";
import type { PaintApiContext } from "./types";

export function createPaintApi(context: PaintApiContext): PaintApi {
  const api = new PaintApi(context);
  registerDocumentTools(api);
  registerDrawingTools(api);
  registerSelectionTools(api);
  registerUtilityTools(api);
  registerLayerAndCanvasTools(api);
  return api;
}

export { PaintApi } from "./PaintApi";
export { validateJsonSchema } from "./validation";
export type {
  JsonSchema,
  PaintApiContext,
  PaintApiDefinition,
  PaintApiError,
  PaintApiErrorCode,
  PaintApiExecuteOptions,
  PaintApiExecuteResult,
  PaintApiHandler,
  PaintApiImageResult,
  SerializableBrushSettings,
} from "./types";
