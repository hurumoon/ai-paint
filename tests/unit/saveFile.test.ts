import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  openFileFromUserPath,
  saveBlobToUserPath,
  takeStartupOpenFiles,
  writeBlobToPath,
} from "../../src/utils/saveFile";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

class TestFile extends Blob {
  readonly name: string;

  constructor(parts: BlobPart[], name: string) {
    super(parts);
    this.name = name;
  }
}

describe("native file bridge cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    vi.stubGlobal("File", TestFile);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("cancels a save session when writing a chunk fails", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "native_begin_save_file") {
        return {
          cancelled: false,
          file_name: "work.aipaint",
          path: "C:\\work.aipaint",
          write_id: "write-1",
        };
      }
      if (command === "native_write_file_chunk") {
        throw new Error("disk full");
      }
      return undefined;
    });

    await expect(
      saveBlobToUserPath(
        new Blob(["payload"]),
        "work.aipaint",
        { name: "AI Paint", extensions: ["aipaint"] }
      )
    ).rejects.toThrow("disk full");

    expect(invoke).toHaveBeenCalledWith("native_cancel_write_file", {
      writeId: "write-1",
    });
    expect(invoke).not.toHaveBeenCalledWith(
      "native_finish_write_file",
      expect.anything()
    );
  });

  it("cancels a direct-write session after a chunk failure", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "native_begin_write_file") return { write_id: "write-2" };
      if (command === "native_write_file_chunk") throw new Error("write failed");
      return undefined;
    });

    await expect(
      writeBlobToPath(new Blob(["payload"]), "C:\\existing.aipaint")
    ).rejects.toThrow("write failed");

    expect(invoke).toHaveBeenCalledWith("native_cancel_write_file", {
      writeId: "write-2",
    });
  });

  it("cancels an open session when metadata preflight rejects the file", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "native_begin_open_file") {
        return {
          cancelled: false,
          file_name: "oversized.psd",
          path: "C:\\oversized.psd",
          read_id: "read-1",
          file_size: 123,
          header_bytes: [1, 2, 3],
        };
      }
      return undefined;
    });

    await expect(
      openFileFromUserPath([], {
        preflight: () => {
          throw new Error("preflight rejected");
        },
      })
    ).rejects.toThrow("preflight rejected");

    expect(invoke).toHaveBeenCalledWith("native_cancel_read_file", {
      readId: "read-1",
    });
    expect(invoke).not.toHaveBeenCalledWith(
      "native_read_file_chunk",
      expect.anything()
    );
  });

  it("cancels every startup session when one selected file fails", async () => {
    const chunksByReadId = new Map<string, number>();
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "native_take_startup_open_files") {
        return [
          {
            cancelled: false,
            file_name: "first.aipaint",
            path: "C:\\first.aipaint",
            read_id: "read-first",
            file_size: 1,
            header_bytes: [1],
          },
          {
            cancelled: false,
            file_name: "broken.psd",
            path: "C:\\broken.psd",
            read_id: "read-broken",
            file_size: 1,
            header_bytes: [2],
          },
        ];
      }
      if (command === "native_read_file_chunk") {
        const readId = String((args as { readId?: string }).readId);
        const count = chunksByReadId.get(readId) ?? 0;
        chunksByReadId.set(readId, count + 1);
        return count === 0 ? Uint8Array.from([1]) : new Uint8Array();
      }
      return undefined;
    });

    await expect(
      takeStartupOpenFiles({
        preflight: ({ fileName }) => {
          if (fileName === "broken.psd") throw new Error("broken startup file");
        },
      })
    ).rejects.toThrow("broken startup file");

    const cancelledIds = vi
      .mocked(invoke)
      .mock.calls
      .filter(([command]) => command === "native_cancel_read_file")
      .map(([, args]) => (args as { readId: string }).readId);
    expect(cancelledIds).toEqual(
      expect.arrayContaining(["read-first", "read-broken"])
    );
  });
});
