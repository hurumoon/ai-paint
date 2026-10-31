import { Selection } from "../types";

// ===== HSL 変換 =====
// 入力 r,g,b は 0..255、出力 h は 0..360 (s,l は 0..1)
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === R) h = ((G - B) / d + (G < B ? 6 : 0)) * 60;
  else if (max === G) h = ((B - R) / d + 2) * 60;
  else h = ((R - G) / d + 4) * 60;
  return [h, s, l];
}

// h:0..360, s,l: 0..1 → r,g,b: 0..255
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const hh = ((h % 360) + 360) % 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (t: number): number => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const hk = hh / 360;
  return [
    Math.round(hue2rgb(hk + 1 / 3) * 255),
    Math.round(hue2rgb(hk) * 255),
    Math.round(hue2rgb(hk - 1 / 3) * 255),
  ];
}

// ===== LUT 構築 =====
// 0..255 の入出力テーブルを返す。

// 折れ線で 0..255 の LUT を作る。points は x で昇順、x/y とも 0..255。
// 端の補完: 先頭点より左は先頭 y、末尾点より右は末尾 y。
export function buildCurveLUT(points: { x: number; y: number }[]): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256);
  if (points.length === 0) {
    for (let i = 0; i < 256; i += 1) lut[i] = i;
    return lut;
  }
  const sorted = [...points].sort((a, b) => a.x - b.x);
  let segIdx = 0;
  for (let i = 0; i < 256; i += 1) {
    while (segIdx < sorted.length - 1 && sorted[segIdx + 1].x < i) segIdx += 1;
    const a = sorted[segIdx];
    const b = sorted[Math.min(segIdx + 1, sorted.length - 1)];
    if (i <= a.x) {
      lut[i] = a.y;
    } else if (i >= b.x || a === b) {
      lut[i] = b.y;
    } else {
      const t = (i - a.x) / (b.x - a.x);
      lut[i] = Math.round(a.y + (b.y - a.y) * t);
    }
  }
  return lut;
}

// レベル補正の LUT。
// inBlack/inWhite: 入力で黒/白とみなす値 (0..255、in<...<inWhite)
// inGamma: 入力中間調補正 (0.1..9.99、1=線形、>1で明るく、<1で暗く)
// outBlack/outWhite: 出力レンジ (0..255、outBlack<=outWhite)
export function buildLevelsLUT(
  inBlack: number,
  inGamma: number,
  inWhite: number,
  outBlack: number,
  outWhite: number
): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256);
  const ib = Math.max(0, Math.min(254, inBlack));
  const iw = Math.max(ib + 1, Math.min(255, inWhite));
  const g = Math.max(0.01, inGamma);
  const ob = Math.max(0, Math.min(255, outBlack));
  const ow = Math.max(ob, Math.min(255, outWhite));
  const span = iw - ib;
  for (let i = 0; i < 256; i += 1) {
    let t = (i - ib) / span;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    // Photoshop 流: gamma は中間調を持ち上げ/下げするので 1/gamma を pow に渡す
    const gammaCorrected = Math.pow(t, 1 / g);
    lut[i] = Math.round(ob + gammaCorrected * (ow - ob));
  }
  return lut;
}

// ===== ピクセル変換 =====
export type ColorAdjustment =
  | { kind: "brightnessContrast"; brightness: number; contrast: number } // -100..100 / -100..100
  | { kind: "hsl"; hueShift: number; satScale: number; lightAdd: number } // -180..180 / -100..100 / -100..100
  | { kind: "curves"; lutR: Uint8ClampedArray; lutG: Uint8ClampedArray; lutB: Uint8ClampedArray }
  | { kind: "levels"; lutR: Uint8ClampedArray; lutG: Uint8ClampedArray; lutB: Uint8ClampedArray }
  | { kind: "invert" }
  | { kind: "grayscale" }
  | { kind: "sepia" };

// src を変更せず、変換後の新 ImageData を返す。
export function applyAdjustment(src: ImageData, adj: ColorAdjustment): ImageData {
  const out = new ImageData(
    new Uint8ClampedArray(src.data),
    src.width,
    src.height
  );
  const d = out.data;
  const n = d.length;

  switch (adj.kind) {
    case "brightnessContrast": {
      const b = adj.brightness * 2.55; // -255..255
      // 標準的なコントラスト式: factor = (259 * (c+255)) / (255 * (259-c))
      const c = Math.max(-255, Math.min(255, adj.contrast * 2.55));
      const factor = (259 * (c + 255)) / (255 * (259 - c));
      for (let i = 0; i < n; i += 4) {
        if (d[i + 3] === 0) continue;
        d[i] = factor * (d[i] - 128) + 128 + b;
        d[i + 1] = factor * (d[i + 1] - 128) + 128 + b;
        d[i + 2] = factor * (d[i + 2] - 128) + 128 + b;
      }
      return out;
    }

    case "hsl": {
      const dh = adj.hueShift;
      const sScale = 1 + adj.satScale / 100; // -100→0, 0→1, +100→2
      const lAdd = adj.lightAdd / 100; // -1..+1
      for (let i = 0; i < n; i += 4) {
        if (d[i + 3] === 0) continue;
        const [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
        const ns = Math.max(0, Math.min(1, s * sScale));
        const nl = Math.max(0, Math.min(1, l + lAdd));
        const [r2, g2, b2] = hslToRgb(h + dh, ns, nl);
        d[i] = r2;
        d[i + 1] = g2;
        d[i + 2] = b2;
      }
      return out;
    }

    case "curves":
    case "levels": {
      const lr = adj.lutR;
      const lg = adj.lutG;
      const lb = adj.lutB;
      for (let i = 0; i < n; i += 4) {
        if (d[i + 3] === 0) continue;
        d[i] = lr[d[i]];
        d[i + 1] = lg[d[i + 1]];
        d[i + 2] = lb[d[i + 2]];
      }
      return out;
    }

    case "invert": {
      for (let i = 0; i < n; i += 4) {
        if (d[i + 3] === 0) continue;
        d[i] = 255 - d[i];
        d[i + 1] = 255 - d[i + 1];
        d[i + 2] = 255 - d[i + 2];
      }
      return out;
    }

    case "grayscale": {
      for (let i = 0; i < n; i += 4) {
        if (d[i + 3] === 0) continue;
        // ITU-R BT.709 輝度係数
        const y = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        d[i] = y;
        d[i + 1] = y;
        d[i + 2] = y;
      }
      return out;
    }

    case "sepia": {
      for (let i = 0; i < n; i += 4) {
        if (d[i + 3] === 0) continue;
        const r = d[i];
        const g = d[i + 1];
        const b = d[i + 2];
        d[i] = 0.393 * r + 0.769 * g + 0.189 * b;
        d[i + 1] = 0.349 * r + 0.686 * g + 0.168 * b;
        d[i + 2] = 0.272 * r + 0.534 * g + 0.131 * b;
      }
      return out;
    }
  }
}

// ===== ヒストグラム =====
// 輝度ヒストグラム (256 bins) を作る。レベル補正のサムネ表示用。
export function luminanceHistogram(src: ImageData): Uint32Array {
  const hist = new Uint32Array(256);
  const d = src.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const y = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) | 0;
    hist[y] += 1;
  }
  return hist;
}

// ===== 選択マスクの取り出し =====
// region 内に対応する選択マスクのアルファ (0..255) を返す。
// selection が "none" / region 全体を覆う rect の場合は null (= マスク不要)。
export function buildSelectionMaskAlpha(
  selection: Selection,
  region: { x: number; y: number; w: number; h: number },
  docWidth: number,
  docHeight: number
): Uint8Array | null {
  if (selection.kind === "none") return null;
  // rect 選択が region と完全一致するならマスク不要。
  if (selection.kind === "rect") {
    if (
      selection.x === region.x &&
      selection.y === region.y &&
      selection.w === region.w &&
      selection.h === region.h
    ) {
      return null;
    }
  }
  const c = document.createElement("canvas");
  c.width = region.w;
  c.height = region.h;
  const ctx = c.getContext("2d")!;
  ctx.translate(-region.x, -region.y);
  ctx.fillStyle = "#000";
  if (selection.kind === "rect") {
    ctx.fillRect(selection.x, selection.y, selection.w, selection.h);
  } else if (selection.kind === "polygon") {
    if (selection.points.length < 3) return null;
    ctx.beginPath();
    ctx.moveTo(selection.points[0].x, selection.points[0].y);
    for (let i = 1; i < selection.points.length; i += 1) {
      ctx.lineTo(selection.points[i].x, selection.points[i].y);
    }
    ctx.closePath();
    ctx.fill();
  } else if (selection.kind === "mask") {
    const img = new ImageData(
      new Uint8ClampedArray(selection.data),
      selection.maskWidth,
      selection.maskHeight
    );
    const tmp = document.createElement("canvas");
    tmp.width = selection.maskWidth;
    tmp.height = selection.maskHeight;
    tmp.getContext("2d")!.putImageData(img, 0, 0);
    const offsetX = selection.maskWidth === docWidth ? 0 : selection.x;
    const offsetY = selection.maskHeight === docHeight ? 0 : selection.y;
    ctx.drawImage(tmp, offsetX, offsetY);
  }
  const data = ctx.getImageData(0, 0, region.w, region.h).data;
  const alpha = new Uint8Array(region.w * region.h);
  for (let i = 0, j = 3; i < alpha.length; i += 1, j += 4) {
    alpha[i] = data[j];
  }
  // docWidth/docHeight は将来 region のクランプ検証に使えるが今は使わない
  void docWidth;
  void docHeight;
  return alpha;
}

// transformed のうち、マスクに従って original と混合した結果を返す (transformed を破壊更新)。
// mask が null なら transformed をそのまま返す。
export function blendWithMask(
  original: ImageData,
  transformed: ImageData,
  mask: Uint8Array | null
): ImageData {
  if (!mask) return transformed;
  const o = original.data;
  const t = transformed.data;
  const n = t.length;
  for (let i = 0, p = 0; i < n; i += 4, p += 1) {
    const a = mask[p];
    if (a === 255) continue; // 完全選択: transformed をそのまま使う
    if (a === 0) {
      // 完全非選択: 元に戻す
      t[i] = o[i];
      t[i + 1] = o[i + 1];
      t[i + 2] = o[i + 2];
      t[i + 3] = o[i + 3];
      continue;
    }
    // 中間: マスクアルファで線形補間 (RGB のみ。元のアルファは保持)
    const w = a / 255;
    const iw = 1 - w;
    t[i] = o[i] * iw + t[i] * w;
    t[i + 1] = o[i + 1] * iw + t[i + 1] * w;
    t[i + 2] = o[i + 2] * iw + t[i + 2] * w;
    t[i + 3] = o[i + 3] * iw + t[i + 3] * w;
  }
  return transformed;
}
