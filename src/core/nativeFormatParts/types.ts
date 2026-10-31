import type { DeferredLayerInfo } from "../PaintDocument";
import type { BlendMode, LayerKind, LayerMeta, TextLayerData } from "../../types";

export interface BoundsV2 {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ManifestLayerV1 {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  blendMode: BlendMode;
  locked: boolean;
  transparentPixelLock?: boolean;
  kind: LayerKind;
  text?: TextLayerData;
  parentId?: string;
  collapsed?: boolean;
  clippingMask?: boolean;
  file: string;
}

export interface ManifestV1 {
  magic: "aipaint-v1";
  version: 1;
  width: number;
  height: number;
  dpi: number;
  activeLayerId: string;
  layers: ManifestLayerV1[];
}

export interface ManifestLayerBaseV2 {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  blendMode: BlendMode;
  locked: boolean;
  transparentPixelLock?: boolean;
  kind: LayerKind;
  parentId?: string;
  collapsed?: boolean;
  clippingMask?: boolean;
}

export interface ManifestImageLayerV2 extends ManifestLayerBaseV2 {
  kind: "raster" | "text";
  text?: TextLayerData;
  empty?: boolean;
  file?: string;
  bounds?: BoundsV2;
}

export interface ManifestGroupLayerV2 extends ManifestLayerBaseV2 {
  kind: "group";
}

export type ManifestLayerV2 = ManifestImageLayerV2 | ManifestGroupLayerV2;

export interface ManifestV2 {
  magic: "aipaint-v2";
  version: 2;
  width: number;
  height: number;
  dpi: number;
  activeLayerId: string;
  layers: ManifestLayerV2[];
  agent?: { version: 1; file: "agent/session.json" };
}

export type LoadedLayer = {
  meta: LayerMeta;
  canvas: HTMLCanvasElement | null;
  ctx: CanvasRenderingContext2D | null;
  deferred?: DeferredLayerInfo;
};
