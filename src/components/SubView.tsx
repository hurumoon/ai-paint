import { useEffect, useRef } from "react";
import { PaintDocument } from "../core/PaintDocument";
import { compositeLayers } from "../core/composite";
import { IconButton } from "../ui/primitives";

interface Props {
  doc: PaintDocument;
  version: number;
  onClose: () => void;
}

// メインキャンバスの縮小プレビュー。全体構図を確認しながら細部を描く用。
//
// 描画は実キャンバスと完全に一致させるため、compositeLayers を doc サイズの中間
// canvas に通してから縮小する。SubView 独自にループするとグループ/クリッピング/
// 不可視ベース等の挙動が実キャンバスとずれるため。
//
// doc サイズの中間 canvas は ref で保持して毎レンダー再確保しない (sharedCanvasPool
// は短命利用前提なので、表示中ずっと持ち続ける用途には向かない)。
export function SubView({ doc, version, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const interRef = useRef<OffscreenCanvas | HTMLCanvasElement | null>(null);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const aspect = doc.height / doc.width;
    const W = 184;
    const H = Math.round(W * aspect);
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "low";
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, W, H);

    // doc サイズの中間 canvas を確保 (サイズ変化時のみ再確保)。
    let inter = interRef.current;
    if (!inter || inter.width !== doc.width || inter.height !== doc.height) {
      inter =
        typeof OffscreenCanvas !== "undefined"
          ? new OffscreenCanvas(doc.width, doc.height)
          : Object.assign(document.createElement("canvas"), {
              width: doc.width,
              height: doc.height,
            });
      interRef.current = inter;
    }
    const ictx = (inter as OffscreenCanvas).getContext("2d") as
      | OffscreenCanvasRenderingContext2D
      | CanvasRenderingContext2D;
    ictx.setTransform(1, 0, 0, 1, 0, 0);
    ictx.clearRect(0, 0, doc.width, doc.height);
    compositeLayers(ictx, doc, doc.layers, undefined);

    ctx.drawImage(inter as CanvasImageSource, 0, 0, W, H);
  }, [doc, version]);

  return (
    <div className="subview">
      <div className="subview-title">
        <span>ナビゲーター</span>
        <IconButton
          onClick={onClose}
          title="閉じる"
          style={{ width: 18, height: 18 }}
        >
          ×
        </IconButton>
      </div>
      <canvas ref={canvasRef} />
    </div>
  );
}
