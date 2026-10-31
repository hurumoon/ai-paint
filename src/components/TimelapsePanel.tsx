import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Timelapse } from "../core/Timelapse";
import { Button, IconButton, pushToast } from "../ui/primitives";
import { IconDownload, IconFilm, IconTrash } from "../ui/Icons";

interface Props {
  timelapse: Timelapse;
}

export function TimelapsePanel({ timelapse }: Props) {
  useSyncExternalStore(timelapse.subscribe, timelapse.getSnapshot);
  const [playing, setPlaying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const previewRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = previewRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, c.width, c.height);
  }, []);

  const handlePlay = async () => {
    if (!previewRef.current || playing) return;
    setPlaying(true);
    try {
      await timelapse.play(previewRef.current, 24);
    } finally {
      setPlaying(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const blob = await timelapse.exportWebM(24);
      if (!blob) {
        pushToast("フレームがありません", "info");
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `timelapse-${new Date().toISOString().replace(/[:.]/g, "-")}.webm`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      pushToast("WebM を保存しました", "success");
    } catch (e) {
      pushToast(`書き出し失敗: ${e}`, "error");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="section">
      <div className="section-title">
        <span>
          <IconFilm width={11} height={11} style={{ verticalAlign: -1 }} /> タイムラプス
        </span>
        <span style={{ fontSize: 10, fontWeight: 400, color: "var(--text-faint)" }}>
          {timelapse.frameCount()} フレーム
        </span>
      </div>

      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 12,
          color: "var(--text-dim)",
        }}
      >
        <input
          type="checkbox"
          checked={timelapse.isEnabled()}
          onChange={(e) => timelapse.setEnabled(e.target.checked)}
        />
        録画する（描画ごとに自動保存）
      </label>

      {timelapse.frameCount() > 0 && (
        <>
          <canvas
            ref={previewRef}
            style={{
              width: "100%",
              height: 120,
              objectFit: "contain",
              background: "#000",
              borderRadius: 4,
            }}
          />
          <div className="btn-row">
            <Button onClick={handlePlay} disabled={playing} style={{ flex: 1 }}>
              {playing ? "再生中..." : "再生"}
            </Button>
            <IconButton
              title="WebM 書き出し"
              onClick={handleExport}
              disabled={exporting}
            >
              <IconDownload />
            </IconButton>
            <IconButton title="フレームをクリア" onClick={() => timelapse.clear()}>
              <IconTrash />
            </IconButton>
          </div>
        </>
      )}
    </div>
  );
}
