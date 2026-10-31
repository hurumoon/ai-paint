import { strFromU8, unzipSync } from "fflate";
import { MAX_AGENT_SESSION_JSON_BYTES, parseDrawingAgentSession } from "../agent/session";

export function readAgentSessionEntry(buf: Uint8Array) {
  let count = 0;
  const files = unzipSync(buf, { filter: (entry) => {
    if (entry.name !== "agent/session.json") return false;
    if (++count > 1 || entry.originalSize > MAX_AGENT_SESSION_JSON_BYTES) {
      throw new Error("AIドロー（β版） の記録が重複しているか、サイズの上限を超えています");
    }
    return true;
  } });
  const bytes = files["agent/session.json"];
  if (!bytes || bytes.byteLength > MAX_AGENT_SESSION_JSON_BYTES) throw new Error("AIドロー（β版） の記録が不正です");
  return parseDrawingAgentSession(strFromU8(bytes));
}
