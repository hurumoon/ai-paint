import { useEffect, useMemo, useState } from "react";
import { PaintDocument } from "../core/PaintDocument";
import { History } from "../core/History";
import { Button, pushToast } from "../ui/primitives";
import { CanvasExtendPreview } from "../types";

interface Props {
  open: boolean;
  doc: PaintDocument;
  history: History;
  onClose: () => void;
  onPreviewChange: (preview: CanvasExtendPreview | null) => void;
}

const MAX_CANVAS_SIZE = 8192;

function readNumber(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

export function CanvasExtendDialog({
  open,
  doc,
  history,
  onClose,
  onPreviewChange,
}: Props) {
  const [extTop, setExtTop] = useState(0);
  const [extRight, setExtRight] = useState(0);
  const [extBottom, setExtBottom] = useState(0);
  const [extLeft, setExtLeft] = useState(0);

  const preview = useMemo<CanvasExtendPreview>(
    () => ({ top: extTop, right: extRight, bottom: extBottom, left: extLeft }),
    [extBottom, extLeft, extRight, extTop]
  );
  const newWidth = doc.width + extLeft + extRight;
  const newHeight = doc.height + extTop + extBottom;
  const hasChanges = extTop !== 0 || extRight !== 0 || extBottom !== 0 || extLeft !== 0;
  const isValid = newWidth > 0 && newHeight > 0 && newWidth <= MAX_CANVAS_SIZE && newHeight <= MAX_CANVAS_SIZE;

  useEffect(() => {
    if (!open) return;
    setExtTop(0);
    setExtRight(0);
    setExtBottom(0);
    setExtLeft(0);
  }, [open, doc]);

  useEffect(() => {
    onPreviewChange(open ? preview : null);
  }, [open, onPreviewChange, preview]);

  useEffect(() => {
    return () => onPreviewChange(null);
  }, [onPreviewChange]);

  if (!open) return null;

  const close = () => {
    onPreviewChange(null);
    onClose();
  };

  const reset = () => {
    setExtTop(0);
    setExtRight(0);
    setExtBottom(0);
    setExtLeft(0);
  };

  const apply = () => {
    if (!hasChanges) {
      pushToast("拡張量を入力してください", "info");
      return;
    }
    if (newWidth <= 0 || newHeight <= 0) {
      pushToast("結果サイズは 1px 以上にしてください", "error");
      return;
    }
    if (newWidth > MAX_CANVAS_SIZE || newHeight > MAX_CANVAS_SIZE) {
      pushToast(`結果サイズは ${MAX_CANVAS_SIZE}px 以下にしてください`, "error");
      return;
    }
    if (
      !confirm(
        `キャンバスを ${doc.width}x${doc.height} から ${newWidth}x${newHeight} に変更します。Undo履歴は消去され、この操作は元に戻せません。続行しますか？`
      )
    ) {
      return;
    }
    doc.extendCanvas(extTop, extRight, extBottom, extLeft);
    history.clear();
    pushToast(`キャンバスを ${newWidth}x${newHeight} に変更しました`, "success");
    close();
  };

  const input = (
    label: string,
    value: number,
    setValue: (value: number) => void
  ) => (
    <label className="canvas-extend-field">
      <span>{label}</span>
      <input
        className="input"
        type="number"
        value={value}
        onChange={(e) => setValue(readNumber(e.currentTarget.value))}
      />
    </label>
  );

  return (
    <div className="canvas-extend-dialog">
      <div className="canvas-extend-head">
        <strong>キャンバス拡張</strong>
        <button className="btn ghost" onClick={close}>
          x
        </button>
      </div>

      <div className="canvas-extend-grid">
        <div />
        {input("上", extTop, setExtTop)}
        <div />
        {input("左", extLeft, setExtLeft)}
        <div className="canvas-extend-size">
          <span>{doc.width}x{doc.height}</span>
          <strong className={isValid ? "" : "invalid"}>{newWidth}x{newHeight}</strong>
        </div>
        {input("右", extRight, setExtRight)}
        <div />
        {input("下", extBottom, setExtBottom)}
        <div />
      </div>

      <div className="canvas-extend-summary">
        <span>既存画像の移動先</span>
        <strong>x {Math.max(0, extLeft)} / y {Math.max(0, extTop)}</strong>
      </div>

      <div className="canvas-extend-note">
        正の値で余白を追加し、負の値で端を切り詰めます。キャンバス上の点線が適用後の範囲です。
      </div>

      <div className="canvas-extend-actions">
        <Button onClick={reset}>リセット</Button>
        <Button variant="primary" onClick={apply} disabled={!hasChanges || !isValid}>
          適用
        </Button>
      </div>
    </div>
  );
}
