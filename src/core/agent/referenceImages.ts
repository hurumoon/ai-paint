import { imageFileToBase64ForAI } from "../aiImagePayload";
import { getPngDataUrlByteLength } from "./recording";

export const MAX_AGENT_REFERENCES = 3;
const MAX_REFERENCE_BYTES = 2 * 1024 * 1024;

export interface DrawingAgentReference {
  id: string;
  name: string;
  dataUrl: string;
  width: number;
  height: number;
  byteLength: number;
}

export function validateAgentReferences(value: unknown): DrawingAgentReference[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_AGENT_REFERENCES) throw new Error("お手本は3枚まで指定できます");
  const ids = new Set<string>();
  return value.map(item => {
    if (!item || typeof item !== "object") throw new Error("お手本のデータが不正です");
    const r = item as Record<string, unknown>;
    if (typeof r.id !== "string" || !r.id || r.id.length > 200 || ids.has(r.id) ||
      typeof r.name !== "string" || !r.name || r.name.length > 300 ||
      typeof r.dataUrl !== "string" || r.dataUrl.length > MAX_REFERENCE_BYTES * 1.34 + 100 ||
      !Number.isInteger(r.width) || (r.width as number) < 1 || (r.width as number) > 1536 ||
      !Number.isInteger(r.height) || (r.height as number) < 1 || (r.height as number) > 1536) throw new Error("お手本の形式・サイズが不正です");
    const byteLength = getPngDataUrlByteLength(r.dataUrl);
    if (byteLength === undefined || byteLength > MAX_REFERENCE_BYTES || byteLength !== r.byteLength) throw new Error("お手本の画像サイズが不正です");
    ids.add(r.id);
    return { id: r.id, name: r.name, dataUrl: r.dataUrl, width: r.width as number, height: r.height as number, byteLength };
  });
}

export async function createAgentReference(file: File): Promise<DrawingAgentReference> {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error("お手本はPNG・JPEG・WebP・GIFを選んでください");
  if (file.size > 20 * 1024 * 1024) throw new Error("お手本は1枚20MB以下にしてください");
  let payload = await imageFileToBase64ForAI(file, 1536, 4096 * 4096);
  let dataUrl = `data:image/png;base64,${payload.base64}`;
  if ((getPngDataUrlByteLength(dataUrl) ?? Infinity) > MAX_REFERENCE_BYTES) {
    payload = await imageFileToBase64ForAI(file, 768, 4096 * 4096);
    dataUrl = `data:image/png;base64,${payload.base64}`;
  }
  return validateAgentReferences([{
    id: crypto.randomUUID(), name: file.name.slice(0, 300) || "お手本",
    dataUrl, width: payload.width, height: payload.height,
    byteLength: getPngDataUrlByteLength(dataUrl),
  }])[0];
}
