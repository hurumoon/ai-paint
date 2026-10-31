import {
  useCallback,
  useEffect,
  useState,
} from "react";
import { PaintDocument } from "../core/PaintDocument";
import { History } from "../core/History";
import { Selection } from "../types";
import {
  buildCurveLUT,
  buildLevelsLUT,
  ColorAdjustment,
} from "../core/colorAdjust";
import { Button, Tabs } from "../ui/primitives";
import {
  COLOR_ADJUST_TABS,
  CURVE_DEFAULT,
  ColorAdjustControls,
  ColorAdjustMode,
  CurvePoint,
} from "./colorAdjust/ColorAdjustControls";
import { useColorAdjustPreview } from "./colorAdjust/useColorAdjustPreview";

interface Props {
  open: boolean;
  onClose: () => void;
  doc: PaintDocument;
  history: History;
  selection: Selection;
}

export function ColorAdjustDialog({
  open,
  onClose,
  doc,
  history,
  selection,
}: Props) {
  const [mode, setMode] = useState<ColorAdjustMode>("bc");

  // 明度/コントラスト
  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(0);

  // HSL
  const [hueShift, setHueShift] = useState(0);
  const [satScale, setSatScale] = useState(0);
  const [lightAdd, setLightAdd] = useState(0);

  // レベル補正
  const [inBlack, setInBlack] = useState(0);
  const [inGamma, setInGamma] = useState(1);
  const [inWhite, setInWhite] = useState(255);
  const [outBlack, setOutBlack] = useState(0);
  const [outWhite, setOutWhite] = useState(255);

  // トーンカーブ
  const [curvePoints, setCurvePoints] = useState<CurvePoint[]>(CURVE_DEFAULT);

  const resetParams = useCallback(() => {
    setBrightness(0);
    setContrast(0);
    setHueShift(0);
    setSatScale(0);
    setLightAdd(0);
    setInBlack(0);
    setInGamma(1);
    setInWhite(255);
    setOutBlack(0);
    setOutWhite(255);
    setCurvePoints(CURVE_DEFAULT);
  }, []);

  // 現在のパラメータから ColorAdjustment を組み立てる。
  // 「ニュートラル (= 何も変えない)」のときは null を返してプレビュー差分を skip する。
  const buildAdjustment = useCallback((): ColorAdjustment | null => {
    switch (mode) {
      case "bc": {
        if (brightness === 0 && contrast === 0) return null;
        return { kind: "brightnessContrast", brightness, contrast };
      }
      case "hsl": {
        if (hueShift === 0 && satScale === 0 && lightAdd === 0) return null;
        return { kind: "hsl", hueShift, satScale, lightAdd };
      }
      case "levels": {
        if (
          inBlack === 0 &&
          inGamma === 1 &&
          inWhite === 255 &&
          outBlack === 0 &&
          outWhite === 255
        ) {
          return null;
        }
        const lut = buildLevelsLUT(inBlack, inGamma, inWhite, outBlack, outWhite);
        return { kind: "levels", lutR: lut, lutG: lut, lutB: lut };
      }
      case "curves": {
        // デフォルト2点恒等なら no-op
        if (
          curvePoints.length === 2 &&
          curvePoints[0].x === 0 &&
          curvePoints[0].y === 0 &&
          curvePoints[1].x === 255 &&
          curvePoints[1].y === 255
        ) {
          return null;
        }
        const lut = buildCurveLUT(curvePoints);
        return { kind: "curves", lutR: lut, lutG: lut, lutB: lut };
      }
      case "quick":
        // クイックフィルタはボタン即時適用方式。スライダーには紐付かない。
        return null;
    }
  }, [
    mode,
    brightness,
    contrast,
    hueShift,
    satScale,
    lightAdd,
    inBlack,
    inGamma,
    inWhite,
    outBlack,
    outWhite,
    curvePoints,
  ]);

  // プレビュー生成と履歴への確定処理は hook 側に閉じ込める。
  const {
    histogram,
    openError,
    rasterizesText,
    applyQuickFilter,
    handleApply,
    handleCancel,
  } = useColorAdjustPreview({
    open,
    onClose,
    doc,
    history,
    selection,
    buildAdjustment,
    resetParams,
  });

  const handleBackdropClick = handleCancel;

  // ESC キーで Cancel
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleCancel();
      } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleApply();
      }
    };
    // capture フェーズで先に処理して、グローバルの「選択解除 (Escape)」より先に動かす
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, handleCancel, handleApply]);

  if (!open) return null;

  return (
    <>
      <div
        className="popover-backdrop"
        style={{ background: "rgba(0,0,0,0.4)" }}
        onClick={handleBackdropClick}
      />
      <div
        className="popover"
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: 520,
          maxWidth: "90vw",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
        // ダイアログ内クリックは閉じない
        onClick={(e) => e.stopPropagation()}
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
          <strong style={{ fontSize: 13 }}>色調補正</strong>
          <button className="btn ghost" onClick={handleCancel}>
            ×
          </button>
        </div>

        {openError ? (
          <div style={{ fontSize: 12, color: "var(--danger)" }}>
            {openError}
          </div>
        ) : (
          <>
            <div style={{ fontSize: 11, color: "var(--text-faint)" }}>
              {selection.kind === "none"
                ? "レイヤー全体に適用"
                : "選択範囲のみに適用"}
            </div>
            {rasterizesText && (
              <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
                補正を適用すると文字は画像になり、文字編集できなくなります。取り消すと編集可能な文字に戻ります。
              </div>
            )}

            <Tabs value={mode} onChange={setMode} options={COLOR_ADJUST_TABS} />

            <ColorAdjustControls
              mode={mode}
              brightness={brightness}
              contrast={contrast}
              hueShift={hueShift}
              satScale={satScale}
              lightAdd={lightAdd}
              inBlack={inBlack}
              inGamma={inGamma}
              inWhite={inWhite}
              outBlack={outBlack}
              outWhite={outWhite}
              curvePoints={curvePoints}
              histogram={histogram}
              onBrightnessChange={setBrightness}
              onContrastChange={setContrast}
              onHueShiftChange={setHueShift}
              onSatScaleChange={setSatScale}
              onLightAddChange={setLightAdd}
              onInBlackChange={setInBlack}
              onInGammaChange={setInGamma}
              onInWhiteChange={setInWhite}
              onOutBlackChange={setOutBlack}
              onOutWhiteChange={setOutWhite}
              onCurvePointsChange={setCurvePoints}
              onQuickFilter={applyQuickFilter}
            />

            <div
              style={{
                display: "flex",
                gap: 6,
                justifyContent: "space-between",
                paddingTop: 6,
                borderTop: "1px solid var(--border)",
              }}
            >
              <Button onClick={resetParams}>リセット</Button>
              <div style={{ display: "flex", gap: 6 }}>
                <Button onClick={handleCancel}>キャンセル</Button>
                <Button variant="primary" onClick={handleApply}>
                  適用
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
