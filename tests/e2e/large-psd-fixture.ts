import { readPsd, writePsd, type Layer, type Psd } from "ag-psd";

export interface LargePsdLayerSpec {
  name: string;
  left: number;
  top: number;
  width: number;
  height: number;
  color: [number, number, number, number];
  hidden?: boolean;
}

export interface PsdLayerBounds {
  left: number | undefined;
  top: number | undefined;
  right: number | undefined;
  bottom: number | undefined;
}

function makeLayerImageData(spec: LargePsdLayerSpec): ImageData {
  const data = new Uint8ClampedArray(spec.width * spec.height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = spec.color[0];
    data[i + 1] = spec.color[1];
    data[i + 2] = spec.color[2];
    data[i + 3] = spec.color[3];
  }
  return new ImageData(data, spec.width, spec.height);
}

export function makeLargeSparsePsdBlob(
  width: number,
  height: number,
  specs: LargePsdLayerSpec[]
): Blob {
  const children: Layer[] = specs.map((spec) => ({
    name: spec.name,
    left: spec.left,
    top: spec.top,
    right: spec.left + spec.width,
    bottom: spec.top + spec.height,
    imageData: makeLayerImageData(spec),
    hidden: spec.hidden,
  }));
  const psd: Psd = { width, height, children };
  const bytes = new Uint8Array(writePsd(psd, { trimImageData: false }));
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new Blob([buffer], { type: "image/vnd.adobe.photoshop" });
}

export async function readPsdLayerBounds(
  blob: Blob,
  layerName: string
): Promise<PsdLayerBounds> {
  const psd = readPsd(await blob.arrayBuffer(), {
    skipLayerImageData: true,
    skipCompositeImageData: true,
    skipThumbnail: true,
  });
  const layer = psd.children?.find((child) => child.name === layerName);
  if (!layer) throw new Error(`PSD layer was not found: ${layerName}`);
  return {
    left: layer.left,
    top: layer.top,
    right: layer.right,
    bottom: layer.bottom,
  };
}
