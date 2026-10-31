import { invoke } from "@tauri-apps/api/core";

import { isTauri } from "../utils/saveFile";

interface NativeIpcResult {
  payload_bytes: number;
  response_bytes: number;
}

interface IpcProbeStats {
  minMs: number;
  avgMs: number;
  maxMs: number;
  p95Ms: number;
}

interface IpcProbeCase {
  label: string;
  payloadBytes: number;
  iterations: number;
  transferredBytes: number;
  stats?: IpcProbeStats;
  error?: string;
}

export interface TauriIpcMeasurementReport {
  measuredAt: string;
  userAgent: string;
  cases: IpcProbeCase[];
}

declare global {
  interface Window {
    __AI_PAINT_MEASURE_TAURI_IPC__?: () => Promise<TauriIpcMeasurementReport>;
  }
}

const JSON_PAYLOAD_BYTES = [0, 1024, 64 * 1024, 1024 * 1024];
const RAW_PAYLOAD_BYTES = [
  1024,
  64 * 1024,
  1024 * 1024,
  4 * 1024 * 1024,
  8 * 1024 * 1024,
  16 * 1024 * 1024,
  32 * 1024 * 1024,
];
const ITERATIONS = 7;
const OVERLAY_ID = "ai-paint-debug-ipc-report";
const AUTO_MEASURE = import.meta.env.VITE_AI_PAINT_MEASURE_TAURI_IPC === "1";

let installed = false;
let running: Promise<TauriIpcMeasurementReport> | null = null;

function makeTextPayload(bytes: number): string {
  return "x".repeat(bytes);
}

function makeBinaryPayload(bytes: number): Uint8Array {
  const payload = new Uint8Array(bytes);
  for (let i = 0; i < payload.byteLength; i += 1) {
    payload[i] = i % 251;
  }
  return payload;
}

function byteLength(value: ArrayBuffer | Uint8Array): number {
  return value instanceof ArrayBuffer ? value.byteLength : value.byteLength;
}

function summarize(samples: number[]): IpcProbeStats {
  const sorted = [...samples].sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  const p95Index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return {
    minMs: sorted[0],
    avgMs: total / sorted.length,
    maxMs: sorted[sorted.length - 1],
    p95Ms: sorted[p95Index],
  };
}

async function measureCase(
  label: string,
  payloadBytes: number,
  run: () => Promise<number>,
): Promise<IpcProbeCase> {
  try {
    await run();

    const samples: number[] = [];
    let transferredBytes = 0;
    for (let i = 0; i < ITERATIONS; i += 1) {
      const startedAt = performance.now();
      transferredBytes = await run();
      samples.push(performance.now() - startedAt);
    }
    return {
      label,
      payloadBytes,
      iterations: ITERATIONS,
      transferredBytes,
      stats: summarize(samples),
    };
  } catch (error) {
    return {
      label,
      payloadBytes,
      iterations: 0,
      transferredBytes: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function requireStats(item: IpcProbeCase): IpcProbeStats | null {
  return item.stats ?? null;
}

function formatCaseLine(item: IpcProbeCase): string {
  const stats = requireStats(item);
  if (!stats) {
    return [
      item.label,
      item.payloadBytes,
      item.iterations,
      item.transferredBytes,
      "ERROR",
      item.error ?? "unknown error",
      "",
      "",
    ].join(",");
  }
  return [
    item.label,
    item.payloadBytes,
    item.iterations,
    item.transferredBytes,
    formatMs(stats.minMs),
    formatMs(stats.avgMs),
    formatMs(stats.p95Ms),
    formatMs(stats.maxMs),
  ].join(",");
}

async function measureJsonEcho(payloadBytes: number): Promise<IpcProbeCase> {
  const payload = makeTextPayload(payloadBytes);
  return measureCase(`json echo ${payloadBytes}B`, payloadBytes, async () => {
    const response = await invoke<string>("debug_ipc_json_echo", { payload });
    return payload.length + response.length;
  });
}

async function measureRawSink(payloadBytes: number): Promise<IpcProbeCase> {
  const payload = makeBinaryPayload(payloadBytes);
  return measureCase(`raw sink ${payloadBytes}B`, payloadBytes, async () => {
    const response = await invoke<NativeIpcResult>("debug_ipc_raw_sink", payload);
    return response.payload_bytes + response.response_bytes;
  });
}

async function measureRawRoundtrip(payloadBytes: number): Promise<IpcProbeCase> {
  const payload = makeBinaryPayload(payloadBytes);
  return measureCase(`raw roundtrip ${payloadBytes}B`, payloadBytes, async () => {
    const response = await invoke<ArrayBuffer | Uint8Array>("debug_ipc_raw_roundtrip", payload);
    return payload.byteLength + byteLength(response);
  });
}

async function measureTauriIpc(): Promise<TauriIpcMeasurementReport> {
  if (!isTauri()) {
    throw new Error("Tauri 環境で起動してから IPC 計測を実行してください");
  }

  const cases: IpcProbeCase[] = [];
  for (const payloadBytes of JSON_PAYLOAD_BYTES) {
    cases.push(await measureJsonEcho(payloadBytes));
  }
  for (const payloadBytes of RAW_PAYLOAD_BYTES) {
    cases.push(await measureRawSink(payloadBytes));
  }
  for (const payloadBytes of RAW_PAYLOAD_BYTES) {
    cases.push(await measureRawRoundtrip(payloadBytes));
  }

  return {
    measuredAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    cases,
  };
}

function formatMs(value: number): string {
  return `${value.toFixed(2)}ms`;
}

function formatReport(report: TauriIpcMeasurementReport): string {
  const lines = [
    "Tauri IPC 実測",
    `measuredAt: ${report.measuredAt}`,
    `userAgent: ${report.userAgent}`,
    "",
    "case,payload,iterations,transferred,min,avg,p95,max",
  ];
  for (const item of report.cases) {
    lines.push(formatCaseLine(item));
  }
  return lines.join("\n");
}

function showOverlay(text: string): void {
  let overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) {
    overlay = document.createElement("pre");
    overlay.id = OVERLAY_ID;
    overlay.setAttribute("role", "status");
    overlay.style.position = "fixed";
    overlay.style.inset = "12px";
    overlay.style.zIndex = "99999";
    overlay.style.margin = "0";
    overlay.style.padding = "12px";
    overlay.style.overflow = "auto";
    overlay.style.maxHeight = "calc(100vh - 24px)";
    overlay.style.background = "rgba(16, 18, 22, 0.96)";
    overlay.style.color = "#f5f7fb";
    overlay.style.border = "1px solid rgba(255, 255, 255, 0.2)";
    overlay.style.borderRadius = "6px";
    overlay.style.fontSize = "12px";
    overlay.style.lineHeight = "1.45";
    document.body.appendChild(overlay);
  }
  overlay.textContent = text;
}

async function runMeasurementWithOverlay(): Promise<void> {
  if (!running) {
    showOverlay("Tauri IPC を計測中...");
    running = measureTauriIpc().finally(() => {
      running = null;
    });
  }

  try {
    const report = await running;
    const formatted = formatReport(report);
    showOverlay(formatted);
    if (AUTO_MEASURE) {
      await invoke<void>("debug_ipc_save_measurement_report", {
        report: `${formatted}\n\n${JSON.stringify(report, null, 2)}\n`,
      });
    }
  } catch (error) {
    showOverlay(error instanceof Error ? error.message : String(error));
  }
}

export function installDebugIpcProbe(): void {
  if (installed) return;
  installed = true;

  window.__AI_PAINT_MEASURE_TAURI_IPC__ = measureTauriIpc;
  window.addEventListener("keydown", (event) => {
    if (event.ctrlKey && event.altKey && event.shiftKey && event.code === "KeyI") {
      event.preventDefault();
      void runMeasurementWithOverlay();
    }
  });

  if (AUTO_MEASURE || new URLSearchParams(window.location.search).has("measureTauriIpc")) {
    void runMeasurementWithOverlay();
  }
}
