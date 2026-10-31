import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import {
  MAX_AGENT_SESSION_JSON_BYTES,
  createDrawingAgentSession,
  serializeDrawingAgentSession,
} from "../../src/core/agent/session";
import { readAgentSessionEntry } from "../../src/core/nativeFormatParts/agentArchive";
import { assertManifestV2 } from "../../src/core/nativeFormatParts/validation";
import { MAX_AGENT_RECORDING_BYTES } from "../../src/core/agent/recording";
import { MAX_AGENT_REFERENCES } from "../../src/core/agent/referenceImages";

function archiveSession(json: string): Uint8Array {
  return zipSync({ "agent/session.json": strToU8(json) });
}

function baseManifestV2() {
  return {
    magic: "aipaint-v2",
    version: 2,
    width: 64,
    height: 64,
    dpi: 96,
    activeLayerId: "layer-1",
    layers: [
      {
        id: "layer-1",
        name: "レイヤー1",
        visible: true,
        opacity: 1,
        blendMode: "normal",
        locked: false,
        kind: "raster",
        empty: true,
      },
    ],
  };
}

describe("agent session archive extension", () => {
  it("reserves JSON overhead after maximum recording and reference data URLs", () => {
    const maxReferenceBytes = MAX_AGENT_REFERENCES * 2 * 1024 * 1024;
    const encodedImageBytes = Math.ceil(
      (MAX_AGENT_RECORDING_BYTES + maxReferenceBytes) * 4 / 3
    );

    expect(MAX_AGENT_SESSION_JSON_BYTES - encodedImageBytes).toBeGreaterThanOrEqual(
      8 * 1024 * 1024
    );
  });

  it("round-trips a serialized session and pauses an interrupted run", () => {
    const session = createDrawingAgentSession({
      id: "agent-1",
      bindingId: "tab-1",
      prompt: "青空を描く",
      provider: "openai",
      model: "gpt-test",
      references: [{
        id: "reference-1",
        name: "青空見本.png",
        dataUrl: "data:image/png;base64,AA==",
        width: 1,
        height: 1,
        byteLength: 1,
      }],
      now: 1,
    });
    session.status = "running";

    const loaded = readAgentSessionEntry(
      archiveSession(serializeDrawingAgentSession(session))
    );

    expect(loaded.id).toBe("agent-1");
    expect(loaded.prompt).toBe("青空を描く");
    expect(loaded.status).toBe("paused");
    expect(loaded.references).toMatchObject([{ id: "reference-1", name: "青空見本.png" }]);
  });

  it("rejects malformed session JSON", () => {
    expect(() => readAgentSessionEntry(archiveSession("{broken"))).toThrow(
      "AIドロー（β版）の制作記録の JSON が壊れています"
    );
  });

  it("rejects an oversized session before parsing it", () => {
    const oversized = new Uint8Array(MAX_AGENT_SESSION_JSON_BYTES + 1);
    const archive = zipSync(
      { "agent/session.json": oversized },
      { level: 9 }
    );

    expect(() => readAgentSessionEntry(archive)).toThrow(
      "サイズの上限を超えています"
    );
  });

  it("keeps version 2 manifests without an agent entry backward compatible", () => {
    expect(assertManifestV2(baseManifestV2()).agent).toBeUndefined();
  });
});
