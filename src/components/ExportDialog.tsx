import { useEffect, useRef, useState } from "react";
import { PaintDocument } from "../core/PaintDocument";
import { Button, pushToast, Slider } from "../ui/primitives";
import { saveAiPaint, defaultAiPaintFilename } from "../core/nativeFormat";
import { savePsd, defaultPsdFilename } from "../core/psdFormat";
import { formatStorageWriteError } from "../core/storageErrors";
import { saveBlobToUserPath } from "../utils/saveFile";
import { blobWithImageDpi } from "../utils/imageDpi";
import {
  flattenDocumentToBlob,
  type FlattenImageFormat,
} from "../core/paintDocumentExport";

interface Props {
  open: boolean;
  onClose: () => void;
  doc: PaintDocument;
  // 保存処理開始時点の history.version を返すコールバック。
  // blob 構築中の描画でバージョンが進んでも、保存済みマークは「blob を作った時点」に
  // 揃える必要があるため、呼び出し側でスナップショットを撮る前に呼ぶ。
  getHistoryVersion: () => number;
  // 履歴に乗らない document notify も保存中変更として扱うため、doc.version も同時に見る。
  getDocumentVersion: () => number;
  // .aipaint / .psd 形式で保存できたときだけ呼ばれる。タイトルバーに反映するための通知。
  // ラスタ形式 (PNG/JPEG/WebP) はレイヤー構造を失うので「現在のファイル」とは扱わない。
  // path は Tauri ネイティブダイアログ経由の時のみフルパス。以降の Ctrl+S 上書き対象になる。
  // versionAtSave は blob 構築直前に撮った history/doc version。
  onSavedAsProject?: (
    fileName: string,
    path: string | undefined,
    historyVersionAtSave: number,
    documentVersionAtSave: number,
  ) => void;
}

type Format = "png" | "jpeg" | "webp" | "aipaint" | "psd";
type ExportMime =
  | FlattenImageFormat
  | "application/x-aipaint"
  | "image/vnd.adobe.photoshop";

const FORMAT_OPTIONS: { value: Format; label: string; ext: string; mime: ExportMime; transparent: boolean }[] = [
  { value: "png", label: "PNG (可逆・透過)", ext: "png", mime: "image/png", transparent: true },
  { value: "jpeg", label: "JPEG (非可逆・小サイズ)", ext: "jpg", mime: "image/jpeg", transparent: false },
  { value: "webp", label: "WebP (非可逆・透過)", ext: "webp", mime: "image/webp", transparent: true },
  { value: "aipaint", label: ".aipaint (レイヤー保持)", ext: "aipaint", mime: "application/x-aipaint", transparent: true },
  { value: "psd", label: "PSD (レイヤー保持・他ソフト互換)", ext: "psd", mime: "image/vnd.adobe.photoshop", transparent: true },
];

export function ExportDialog({
  open,
  onClose,
  doc,
  getHistoryVersion,
  getDocumentVersion,
  onSavedAsProject,
}: Props) {
  const [format, setFormat] = useState<Format>("png");
  // 保存ボタン連打や Enter 連打で doExport が二重起動すると、saveAiPaint が
  // 並行で doc を materialize して blob が壊れる。同期的に弾く。
  const exportingRef = useRef(false);
  const operationRef = useRef<"estimate" | "export" | null>(null);
  const [exporting, setExporting] = useState(false);
  const [quality, setQuality] = useState(92);
  const [previewSize, setPreviewSize] = useState<number | null>(null);
  const [estimating, setEstimating] = useState(false);

  // フォーマット・品質変更、もしくはダイアログを開いた時に自動でサイズを見積もる。
  // 連続変更（品質スライダー等）に備えて 300ms デバウンス + 古い結果の上書き防止。
  useEffect(() => {
    if (!open) return;
    setPreviewSize(null);
    let cancelled = false;
    setEstimating(true);
    const timer = window.setTimeout(async () => {
      if (operationRef.current !== null) {
        setEstimating(false);
        return;
      }
      operationRef.current = "estimate";
      try {
        const size = await computeEstimate(doc, format, quality);
        if (!cancelled) setPreviewSize(size);
      } catch {
        // 見積もり失敗は無視（保存時にエラー表示される）
      } finally {
        if (operationRef.current === "estimate") {
          operationRef.current = null;
        }
        if (!cancelled) setEstimating(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [format, quality, open, doc]);

  if (!open) return null;

  const doExport = async () => {
    if (exportingRef.current || operationRef.current !== null) return;
    exportingRef.current = true;
    operationRef.current = "export";
    setExporting(true);
    try {
      const opt = FORMAT_OPTIONS.find((f) => f.value === format)!;
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      // blob を作る "前" の history.version を保存済みマーク用に撮っておく。
      // 後で getSnapshot() を撮ると、ダイアログ操作中に進んだ分まで「保存済み」と
      // 誤認してしまう。
      const historyVersionAtSave = getHistoryVersion();
      const documentVersionAtSave = getDocumentVersion();
      let blob: Blob;
      let filename: string;
      if (format === "aipaint") {
        blob = await saveAiPaint(doc);
        filename = defaultAiPaintFilename();
      } else if (format === "psd") {
        blob = await savePsd(doc);
        filename = defaultPsdFilename();
      } else if (format === "png") {
        const raw = await flattenDocumentToBlob(doc, "image/png", 0.92, "transparent");
        blob = await blobWithImageDpi(raw, "png", doc.dpi);
        filename = `ai-paint-${ts}.png`;
      } else if (format === "jpeg") {
        const raw = await flattenDocumentToBlob(doc, "image/jpeg", quality / 100, "white");
        blob = await blobWithImageDpi(raw, "jpeg", doc.dpi);
        filename = `ai-paint-${ts}.jpg`;
      } else if (format === "webp") {
        const raw = await flattenDocumentToBlob(
          doc,
          "image/webp",
          quality / 100,
          "transparent"
        );
        blob = await blobWithImageDpi(raw, "webp", doc.dpi);
        filename = `ai-paint-${ts}.webp`;
      } else {
        const bg: "transparent" | "white" = opt.transparent ? "transparent" : "white";
        blob = await flattenDocumentToBlob(doc, toRasterMime(opt.mime), quality / 100, bg);
        filename = `ai-paint-${ts}.${opt.ext}`;
      }

      const result = await saveBlobToUserPath(blob, filename, {
        name: opt.label,
        extensions: [opt.ext],
      });
      if (result.cancelled) return;

      const displayName = result.fileName ?? filename;
      pushToast(`保存しました: ${displayName} (${formatBytes(blob.size)})`, "success");
      if ((format === "aipaint" || format === "psd") && onSavedAsProject) {
        onSavedAsProject(
          displayName,
          result.path,
          historyVersionAtSave,
          documentVersionAtSave,
        );
      }
      onClose();
    } catch (e) {
      const fallback = e instanceof Error ? e.message : String(e);
      pushToast(`保存失敗: ${formatStorageWriteError(e, fallback)}`, "error");
    } finally {
      exportingRef.current = false;
      if (operationRef.current === "export") {
        operationRef.current = null;
      }
      setExporting(false);
    }
  };

  const supportsQuality = format === "jpeg" || format === "webp";
  const handleClose = () => {
    if (exportingRef.current) return;
    onClose();
  };

  return (
    <>
      <div
        className="popover-backdrop"
        style={{ background: "rgba(0,0,0,0.4)" }}
        onClick={handleClose}
      />
      <div
        className="popover"
        data-testid="export-dialog"
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          minWidth: 360,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderBottom: "1px solid var(--border)",
            paddingBottom: 8,
          }}
        >
          <strong style={{ fontSize: 13 }}>エクスポート</strong>
          <button className="btn ghost" onClick={handleClose} disabled={exporting}>×</button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>形式</span>
          {FORMAT_OPTIONS.map((f) => (
            <label
              key={f.value}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                color: "var(--text)",
                cursor: "pointer",
                padding: "4px 6px",
                background: format === f.value ? "var(--bg-elev)" : "transparent",
                borderRadius: 4,
              }}
            >
              <input
                type="radio"
                data-testid={`export-format-${f.value}`}
                checked={format === f.value}
                onChange={() => setFormat(f.value)}
              />
              {f.label}
            </label>
          ))}
        </div>

        {supportsQuality && (
          <Slider
            label="品質"
            value={quality}
            min={10}
            max={100}
            onChange={setQuality}
            format={(v) => `${v}%`}
          />
        )}

        <div
          style={{
            display: "flex",
            gap: 6,
            alignItems: "center",
            fontSize: 11,
            color: "var(--text-faint)",
            minHeight: 18,
          }}
        >
          <span>サイズ:</span>
          {estimating || previewSize === null ? (
            <span style={{ opacity: 0.6 }}>計算中…</span>
          ) : (
            <span>{formatBytes(previewSize)}</span>
          )}
        </div>

        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
          <Button data-testid="export-cancel" onClick={handleClose} disabled={exporting}>キャンセル</Button>
          <Button
            data-testid="export-save"
            variant="primary"
            onClick={doExport}
            disabled={exporting || estimating}
          >
            {exporting ? "保存中..." : "保存"}
          </Button>
        </div>
      </div>
    </>
  );
}

async function computeEstimate(
  doc: PaintDocument,
  format: Format,
  quality: number,
): Promise<number> {
  if (format === "aipaint") return (await saveAiPaint(doc)).size;
  if (format === "psd") return (await savePsd(doc)).size;
  const opt = FORMAT_OPTIONS.find((f) => f.value === format)!;
  // 透過対応フォーマットは透過保持で見積もる（JPEG は service 内部で白背景になる）
  const bg: "transparent" | "white" = opt.transparent ? "transparent" : "white";
  const b = await flattenDocumentToBlob(doc, toRasterMime(opt.mime), quality / 100, bg);
  return b.size;
}

function toRasterMime(mime: ExportMime): FlattenImageFormat {
  if (mime === "image/png" || mime === "image/jpeg" || mime === "image/webp") {
    return mime;
  }
  throw new Error("ラスタ形式ではありません");
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(2)} MB`;
}
