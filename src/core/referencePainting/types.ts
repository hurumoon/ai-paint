import type { StrokePoint } from "../brushEngine";
import type { SerializableBrushSettings } from "../paintApi/types";

export interface ReferenceStroke {
  points: StrokePoint[];
  settings: SerializableBrushSettings;
}

export interface ReferencePaintStage {
  id: string;
  label: string;
  strokes: ReferenceStroke[];
  meanAbsoluteError: number;
}

// 元画像の画素を含めず、同じブラシで再実行できる操作だけを保持する。
export interface ReferencePaintPlan {
  format: "ai-paint-reference-strokes";
  version: 1;
  width: number;
  height: number;
  planningSize?: { width: number; height: number };
  background: "#ffffff";
  stages: ReferencePaintStage[];
}

export interface ReferencePaintProgress {
  label: string;
  stage: number;
  stageCount: number;
  strokes: number;
}
