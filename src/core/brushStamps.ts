import {
  clamp01,
  effectiveOpacity,
  stampSize,
} from "./brushDynamics";
import type { BrushSettings, StrokePoint } from "./brushEngine";
import {
  drawFourPointStar,
  lightenHex,
  stampAntialiasedDisk,
  type AnyCtx,
} from "./brushStampPrimitives";

export function paintStamp(ctx: AnyCtx, p: StrokePoint, s: BrushSettings): void {
  const effectiveSize = stampSize(p, s);
  const eff: BrushSettings = { ...s, opacity: effectiveOpacity(p, s) };
  s = eff;
  switch (s.kind) {
    case "round":
      return stampRound(ctx, p, effectiveSize, s);
    case "pencil":
      return stampPencil(ctx, p, effectiveSize, s);
    case "marker":
      return stampMarker(ctx, p, effectiveSize, s);
    case "airbrush":
      return stampAirbrush(ctx, p, effectiveSize, s);
    case "calligraphy":
      return stampCalligraphy(ctx, p, effectiveSize, s);
    case "pen":
      return stampPen(ctx, p, effectiveSize, s);
    case "watercolor":
      return stampWatercolor(ctx, p, effectiveSize, s);
    case "charcoal":
      return stampCharcoal(ctx, p, effectiveSize, s);
    case "spray":
      return stampSpray(ctx, p, effectiveSize, s);
    case "dotted":
      return stampDotted(ctx, p, effectiveSize, s);
    case "crayon":
      return stampCrayon(ctx, p, effectiveSize, s);
    case "oil":
      return stampOil(ctx, p, effectiveSize, s);
    case "pastel":
      return stampPastel(ctx, p, effectiveSize, s);
    case "fountainPen":
      return stampFountainPen(ctx, p, effectiveSize, s);
    case "chalk":
      return stampChalk(ctx, p, effectiveSize, s);
    case "scatter":
      return stampScatter(ctx, p, effectiveSize, s);
    case "gPen":
      return stampGPen(ctx, p, effectiveSize, s);
    case "maruPen":
      return stampMaruPen(ctx, p, effectiveSize, s);
    case "highlighter":
      return stampHighlighter(ctx, p, effectiveSize, s);
    case "neon":
      return stampNeon(ctx, p, effectiveSize, s);
    case "sparkle":
      return stampSparkle(ctx, p, effectiveSize, s);
    case "custom":
      return stampCustom(ctx, p, effectiveSize, s);
    case "eraser-round":
      return stampEraserRound(ctx, p, effectiveSize, s);
    case "eraser-hard":
      return stampEraserHard(ctx, p, effectiveSize);
    case "eraser-soft":
      return stampEraserSoft(ctx, p, effectiveSize, s);
  }
}

function stampRound(ctx: AnyCtx, p: StrokePoint, size: number, s: BrushSettings): void {
  ctx.save();
  ctx.globalAlpha = s.opacity;
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = s.color;
  ctx.beginPath();
  ctx.arc(p.x, p.y, size / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// 鉛筆: 硬めのフチ＋テクスチャ（軽い粒子感）
function stampPencil(ctx: AnyCtx, p: StrokePoint, size: number, s: BrushSettings): void {
  ctx.save();
  ctx.globalAlpha = s.opacity * 0.7;
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = s.color;
  ctx.beginPath();
  ctx.arc(p.x, p.y, size / 2, 0, Math.PI * 2);
  ctx.fill();
  // 軽くテクスチャ
  const grain = Math.max(1, Math.floor(size / 4));
  for (let i = 0; i < grain; i += 1) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * (size / 2);
    ctx.globalAlpha = s.opacity * 0.15;
    ctx.beginPath();
    ctx.arc(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, 0.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// マーカー: 半透明で重なりが濃くなる
function stampMarker(ctx: AnyCtx, p: StrokePoint, size: number, s: BrushSettings): void {
  ctx.save();
  ctx.globalAlpha = s.opacity * 0.35;
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = s.color;
  ctx.beginPath();
  ctx.arc(p.x, p.y, size / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// エアブラシ: グラデーション付き、フチがフェード
function stampAirbrush(ctx: AnyCtx, p: StrokePoint, size: number, s: BrushSettings): void {
  const r = size / 2;
  const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
  grad.addColorStop(0, s.color);
  grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.save();
  ctx.globalAlpha = s.opacity * 0.18;
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// カリグラフィ: 縦長楕円で角度のあるストローク
function stampCalligraphy(ctx: AnyCtx, p: StrokePoint, size: number, s: BrushSettings): void {
  ctx.save();
  ctx.globalAlpha = s.opacity;
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = s.color;
  ctx.translate(p.x, p.y);
  ctx.rotate(-Math.PI / 4);
  ctx.beginPath();
  ctx.ellipse(0, 0, size / 2, size / 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ペン（ミリペン）: 不透明度100%固定、フチがシャープ、筆圧で太さ少し変動
function stampPen(ctx: AnyCtx, p: StrokePoint, size: number, s: BrushSettings): void {
  stampAntialiasedDisk(ctx, p, size / 2, s);
}

// 水彩: 薄く重なり、にじみ風の二重スタンプ
function stampWatercolor(ctx: AnyCtx, p: StrokePoint, size: number, s: BrushSettings): void {
  const r = size / 2;
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  // 内側コア
  ctx.globalAlpha = s.opacity * 0.18;
  ctx.fillStyle = s.color;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r * 0.5, 0, Math.PI * 2);
  ctx.fill();
  // ぼやけた外輪
  const grad = ctx.createRadialGradient(p.x, p.y, r * 0.4, p.x, p.y, r);
  grad.addColorStop(0, s.color);
  grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.globalAlpha = s.opacity * 0.12;
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// 木炭: ザラッとした粗いテクスチャ、複数粒子
function stampCharcoal(ctx: AnyCtx, p: StrokePoint, size: number, s: BrushSettings): void {
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = s.color;
  // 中心
  ctx.globalAlpha = s.opacity * 0.55;
  ctx.beginPath();
  ctx.arc(p.x, p.y, size / 2, 0, Math.PI * 2);
  ctx.fill();
  // 粒子
  const grains = Math.max(4, Math.floor(size * 1.2));
  ctx.globalAlpha = s.opacity * 0.5;
  for (let i = 0; i < grains; i += 1) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * (size * 0.85);
    const dotR = 0.5 + Math.random() * 1.4;
    ctx.beginPath();
    ctx.arc(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, dotR, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// スプレー: 範囲内に細かい点をばら撒く
function stampSpray(ctx: AnyCtx, p: StrokePoint, size: number, s: BrushSettings): void {
  const r = size / 2;
  const drops = Math.max(8, Math.floor(size * 2));
  ctx.save();
  ctx.globalAlpha = s.opacity * 0.6;
  ctx.fillStyle = s.color;
  for (let i = 0; i < drops; i += 1) {
    const a = Math.random() * Math.PI * 2;
    const rr = Math.random() * r;
    ctx.beginPath();
    ctx.arc(p.x + Math.cos(a) * rr, p.y + Math.sin(a) * rr, 0.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// 点線: スタンプ間隔が広い丸
function stampDotted(ctx: AnyCtx, p: StrokePoint, size: number, s: BrushSettings): void {
  ctx.save();
  ctx.globalAlpha = s.opacity;
  ctx.fillStyle = s.color;
  ctx.beginPath();
  ctx.arc(p.x, p.y, size / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// クレヨン: ノイズで欠けたフチ、不透明
function stampCrayon(ctx: AnyCtx, p: StrokePoint, size: number, s: BrushSettings): void {
  const r = size / 2;
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = s.color;
  // 細かいランダムスポットの重ね
  const dabs = Math.max(6, Math.floor(size * 0.8));
  ctx.globalAlpha = s.opacity * 0.4;
  for (let i = 0; i < dabs; i += 1) {
    const a = Math.random() * Math.PI * 2;
    const rr = Math.random() * r * 0.95;
    const dr = 1 + Math.random() * (size * 0.18);
    ctx.beginPath();
    ctx.arc(p.x + Math.cos(a) * rr, p.y + Math.sin(a) * rr, dr, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// 油彩: 不透明だが複数の楕円ダブをランダム角度で重ね、筆跡が荒く出る
function stampOil(ctx: AnyCtx, p: StrokePoint, size: number, s: BrushSettings): void {
  const r = size / 2;
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = s.color;
  // 中央の主スタンプ
  ctx.globalAlpha = s.opacity * 0.8;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fill();
  // 周辺に楕円ダブ
  const dabs = Math.max(3, Math.floor(size * 0.3));
  ctx.globalAlpha = s.opacity * 0.5;
  for (let i = 0; i < dabs; i += 1) {
    const a = Math.random() * Math.PI * 2;
    const off = Math.random() * r * 0.5;
    const rot = Math.random() * Math.PI;
    ctx.save();
    ctx.translate(p.x + Math.cos(a) * off, p.y + Math.sin(a) * off);
    ctx.rotate(rot);
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.6, r * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

// パステル: 粒状感が強くフチがにじむ。crayon と charcoal の中間
function stampPastel(ctx: AnyCtx, p: StrokePoint, size: number, s: BrushSettings): void {
  const r = size / 2;
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = s.color;
  // 内側コア（薄め）
  ctx.globalAlpha = s.opacity * 0.3;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r * 0.6, 0, Math.PI * 2);
  ctx.fill();
  // 粒子（控えめにして大サイズでも軽量に）
  const grains = Math.max(6, Math.floor(size * 0.8));
  ctx.globalAlpha = s.opacity * 0.4;
  for (let i = 0; i < grains; i += 1) {
    const a = Math.random() * Math.PI * 2;
    const rr = Math.random() * r;
    const dotR = 0.4 + Math.random() * (size * 0.08);
    ctx.beginPath();
    ctx.arc(p.x + Math.cos(a) * rr, p.y + Math.sin(a) * rr, dotR, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// 万年筆: ペンより細く（半径 size/3 ≒ 直径 size*2/3）、筆圧で太さが大きく変わる前提。
function stampFountainPen(ctx: AnyCtx, p: StrokePoint, size: number, s: BrushSettings): void {
  stampAntialiasedDisk(ctx, p, Math.max(0.4, size / 3), s);
}

// チョーク: 木炭より明るく粒が荒い。小サイズでも線が見えるよう中心に薄いコアを置き、粒で広げる
function stampChalk(ctx: AnyCtx, p: StrokePoint, size: number, s: BrushSettings): void {
  const r = size / 2;
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = s.color;
  // 薄い中心コア（小サイズでも視認できるようにするための保険）
  ctx.globalAlpha = s.opacity * 0.25;
  ctx.beginPath();
  ctx.arc(p.x, p.y, Math.max(0.5, r * 0.4), 0, Math.PI * 2);
  ctx.fill();
  // 粒（下限を高めにして size=1 でも数個は乗る）
  ctx.globalAlpha = s.opacity * 0.45;
  const grains = Math.max(8, Math.floor(size * 1.2));
  for (let i = 0; i < grains; i += 1) {
    const a = Math.random() * Math.PI * 2;
    const rr = Math.random() * r * 1.05;
    const dotR = 0.4 + Math.random() * 1.6;
    ctx.beginPath();
    ctx.arc(p.x + Math.cos(a) * rr, p.y + Math.sin(a) * rr, dotR, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// 散布: 1スタンプにつき複数の丸を広範囲にばら撒く。サイズもばらつく
function stampScatter(ctx: AnyCtx, p: StrokePoint, size: number, s: BrushSettings): void {
  const r = size / 2;
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = s.color;
  ctx.globalAlpha = s.opacity * 0.85;
  const drops = Math.max(3, Math.floor(size * 0.25));
  // dotR のばらつき幅。小サイズでも違いが見えるよう下限 2 を確保
  const dotRange = Math.max(2, r * 0.4);
  for (let i = 0; i < drops; i += 1) {
    const a = Math.random() * Math.PI * 2;
    const rr = Math.random() * r * 1.4; // 範囲は size の 1.4 倍まで広がる
    const dotR = 1 + Math.random() * dotRange;
    ctx.beginPath();
    ctx.arc(p.x + Math.cos(a) * rr, p.y + Math.sin(a) * rr, dotR, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// カスタム: ユーザー画像をスタンプとして描画。
// 「サイズ」はスタンプの長辺ピクセルとして扱い、もう一方の辺はアスペクト比で計算。
function stampCustom(ctx: AnyCtx, p: StrokePoint, size: number, s: BrushSettings): void {
  if (!s.custom) return;
  const bmp = s.custom.bitmap;
  let w: number;
  let h: number;
  if (bmp.width >= bmp.height) {
    w = size;
    h = size * (bmp.height / bmp.width);
  } else {
    h = size;
    w = size * (bmp.width / bmp.height);
  }
  ctx.save();
  ctx.globalAlpha = s.opacity;
  ctx.globalCompositeOperation = "source-over";
  if (s.custom.tint) {
    // 一時 canvas に画像を描き、source-in で前景色を貼って色付け
    const tmp = document.createElement("canvas");
    tmp.width = Math.max(1, Math.ceil(w));
    tmp.height = Math.max(1, Math.ceil(h));
    const tctx = tmp.getContext("2d")!;
    tctx.drawImage(bmp, 0, 0, tmp.width, tmp.height);
    tctx.globalCompositeOperation = "source-in";
    tctx.fillStyle = s.color;
    tctx.fillRect(0, 0, tmp.width, tmp.height);
    ctx.drawImage(tmp, p.x - w / 2, p.y - h / 2, w, h);
  } else {
    ctx.drawImage(bmp, p.x - w / 2, p.y - h / 2, w, h);
  }
  ctx.restore();
}

// Gペン: 入り抜きが鋭い漫画用ペン。
// stampSize での pressureSize 適用に加え、筆圧 0→1 で半径が 0.2→1.0 倍に変化する追加テーパーを掛ける。
function stampGPen(ctx: AnyCtx, p: StrokePoint, size: number, s: BrushSettings): void {
  const taper = 0.2 + 0.8 * clamp01(p.pressure);
  stampAntialiasedDisk(ctx, p, Math.max(0.3, (size / 2) * taper), s);
}

// 丸ペン: Gペンより細く、変化は控えめ。繊細な線画向け。
function stampMaruPen(ctx: AnyCtx, p: StrokePoint, size: number, s: BrushSettings): void {
  const taper = 0.5 + 0.5 * clamp01(p.pressure);
  stampAntialiasedDisk(ctx, p, Math.max(0.2, (size / 3) * taper), s);
}

// 蛍光ペン: multiply 合成で重ねるたびに濃くなる。線画の上から塗っても下が透ける。
function stampHighlighter(ctx: AnyCtx, p: StrokePoint, size: number, s: BrushSettings): void {
  ctx.save();
  ctx.globalAlpha = s.opacity * 0.4;
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = s.color;
  ctx.beginPath();
  ctx.arc(p.x, p.y, size / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ネオン: 中心は明色コア、周囲に同色のグローを描く。発光感のあるエフェクト。
function stampNeon(ctx: AnyCtx, p: StrokePoint, size: number, s: BrushSettings): void {
  const r = size / 2;
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 1.5);
  glow.addColorStop(0, s.color);
  glow.addColorStop(0.4, s.color);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.globalAlpha = s.opacity * 0.4;
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r * 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = s.opacity;
  ctx.fillStyle = lightenHex(s.color, 0.65);
  ctx.beginPath();
  ctx.arc(p.x, p.y, Math.max(0.5, r * 0.35), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// キラキラ: 4点の光芒(四芒星)をランダム位置に散らす。スパークル/ラメ表現。
function stampSparkle(ctx: AnyCtx, p: StrokePoint, size: number, s: BrushSettings): void {
  const r = size / 2;
  const count = Math.max(1, Math.floor(size * 0.12));
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = s.color;
  ctx.globalAlpha = s.opacity;
  for (let i = 0; i < count; i += 1) {
    const a = Math.random() * Math.PI * 2;
    const rr = Math.random() * r;
    const cx = p.x + Math.cos(a) * rr;
    const cy = p.y + Math.sin(a) * rr;
    const sparkSize = 1 + Math.random() * Math.max(1.5, size * 0.18);
    drawFourPointStar(ctx, cx, cy, sparkSize);
  }
  ctx.restore();
}

// 消しゴム: 通常の丸
function stampEraserRound(ctx: AnyCtx, p: StrokePoint, size: number, s: BrushSettings): void {
  ctx.save();
  ctx.globalAlpha = s.opacity;
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = "rgba(0,0,0,1)";
  ctx.beginPath();
  ctx.arc(p.x, p.y, size / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// 消しゴム ハード: 完全に消す（不透明度無視）
function stampEraserHard(ctx: AnyCtx, p: StrokePoint, size: number): void {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = "rgba(0,0,0,1)";
  ctx.beginPath();
  ctx.arc(p.x, p.y, size / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// 消しゴム ソフト: フチがフェード
function stampEraserSoft(ctx: AnyCtx, p: StrokePoint, size: number, s: BrushSettings): void {
  const r = size / 2;
  const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
  grad.addColorStop(0, "rgba(0,0,0,1)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.save();
  ctx.globalAlpha = s.opacity * 0.25;
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
