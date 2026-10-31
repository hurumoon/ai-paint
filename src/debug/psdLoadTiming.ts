import type { PsdLoadTimingReport } from "../types";

declare global {
  interface Window {
    __AI_PAINT_LAST_PSD_LOAD_TIMING__?: PsdLoadTimingReport;
    __AI_PAINT_PSD_LOAD_TIMINGS__?: PsdLoadTimingReport[];
  }
}

const MAX_STORED_REPORTS = 20;

function formatMs(value: number | null | undefined): string {
  return typeof value === "number" ? `${value.toFixed(2)}ms` : "-";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function shouldLogPsdTiming(): boolean {
  return (
    import.meta.env.DEV ||
    new URLSearchParams(window.location.search).has("measurePsdLoad")
  );
}

function formatPsdTiming(report: PsdLoadTimingReport): string {
  const native = report.nativeRead;
  const timings = report.timings;
  const lines = [
    "PSD load timing",
    `file: ${report.fileName ?? native?.fileName ?? "(unknown)"} (${formatBytes(report.fileBytes)})`,
    `document: ${report.width}x${report.height}, layers=${report.layerCount}, drawable=${report.drawableLayerCount}, groups=${report.groupLayerCount}, deferred=${report.deferredLayerCount}`,
  ];
  if (native) {
    lines.push(
      `native first chunk: selected=${formatMs(native.selectedToFirstChunkMs)}, readStart=${formatMs(native.readStartToFirstChunkMs)}`,
      `native chunks: ${native.chunkCount} x ${formatBytes(native.requestedChunkBytes)} max, total=${formatBytes(native.totalBytes)}, read=${formatMs(native.allChunksReadMs)}, finish=${formatMs(native.finishReadMs)}, File=${formatMs(native.fileConstructionMs)}`,
    );
  }
  lines.push(
    `header preflight: ${formatMs(timings.headerPreflightMs)}`,
    `File.arrayBuffer: ${formatMs(timings.fileArrayBufferMs)}`,
    `metadata preflight: ${formatMs(timings.metadataPreflightMs)}`,
    `readPsd raw data: ${formatMs(timings.readPsdMs)}`,
    `walkPsdChildren: ${formatMs(timings.walkPsdChildrenMs)} (layer decode ${formatMs(timings.layerDecodeMs)}, bbox canvas ${formatMs(timings.bboxCanvasMs)})`,
    `doc.resize: ${formatMs(timings.docResizeMs)}`,
    `replaceLayersFromCanvas: ${formatMs(timings.replaceLayersFromCanvasMs)}`,
    `first paint wait: ${formatMs(timings.firstPaintWaitMs)}`,
    `loadPsd total: ${formatMs(timings.loadPsdTotalMs)}`,
  );
  return lines.join("\n");
}

export function publishPsdLoadTiming(report: PsdLoadTimingReport): void {
  window.__AI_PAINT_LAST_PSD_LOAD_TIMING__ = report;
  const reports = window.__AI_PAINT_PSD_LOAD_TIMINGS__ ?? [];
  reports.push(report);
  if (reports.length > MAX_STORED_REPORTS) {
    reports.splice(0, reports.length - MAX_STORED_REPORTS);
  }
  window.__AI_PAINT_PSD_LOAD_TIMINGS__ = reports;

  if (shouldLogPsdTiming()) {
    // eslint-disable-next-line no-console -- PSD ロード診断は dev console で読む。
    console.info(formatPsdTiming(report), report);
  }
}
