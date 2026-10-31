// ===== 基本サイズ =====
export const DEFAULT_CANVAS_WIDTH = 1024;
export const DEFAULT_CANVAS_HEIGHT = 768;
export const DEFAULT_DPI = 96;

// ===== ツール =====
export type Tool =
  | "brush"
  | "eraser"
  | "bucket"
  | "select"
  | "blur"
  | "gradient"
  | "shape"
  | "eyedropper"
  | "move"
  | "text"
  | "layerPick";

export type BrushKind =
  | "round"
  | "pencil"
  | "marker"
  | "airbrush"
  | "calligraphy"
  | "pen"
  | "watercolor"
  | "charcoal"
  | "spray"
  | "dotted"
  | "crayon"
  | "oil"          // 油彩: 楕円ダブを複数重ね、不透明だが筆跡が荒い
  | "pastel"       // パステル: クレヨンより粒状感が強くフチがにじむ
  | "fountainPen"  // 万年筆: 細く濃淡あり、筆圧で太さが大きく変わる
  | "chalk"        // チョーク: 木炭より明るく粒が荒く、フチがバラけている
  | "scatter"      // 散布: ランダム位置にスタンプを散らす、サイズもランダム
  | "gPen"         // 漫画Gペン: 入り抜きが鋭く、筆圧で太さが大きく変わる
  | "maruPen"      // 漫画丸ペン: Gペンより細く繊細な線
  | "highlighter"  // 蛍光ペン: 半透明、multiply 合成で下の線が透ける
  | "neon"         // ネオン: 明るい中心コア + 同色のソフトグロー
  | "sparkle"      // キラキラ: 小さな四点星をランダム位置に散らす
  | "custom";      // カスタムブラシ（customBrushId で実体を指定）
export type BrushCategory = "pen" | "paint" | "spray" | "other";
export type EraserKind = "round" | "hard" | "soft";
export type ShapeKind = "rect" | "ellipse" | "line" | "polygon";
export type GradientKind = "linear" | "radial";
// 2色補間（既存挙動）と虹色（マルチストップ）の切替
export type GradientPreset = "two-color" | "rainbow";

// 範囲選択のサブツール
export type SelectKind = "rect" | "polygon" | "magic";

// 移動ツールのサブモード
// - layer:  アクティブレイヤー (選択範囲があれば中身) をドラッグで移動
// - scale:  選択範囲の中身を中心基準で等倍スケール
// - rotate: 選択範囲の中身を中心基準で回転
// - free:   選択範囲の中身を中心基準で縦横独立スケール
// - canvas: ビューポートをドラッグでパン (キャンバス自体は不変)
export type MoveMode = "layer" | "scale" | "rotate" | "free" | "canvas";

// ===== ブレンドモード =====
// 注: Canvas2D の globalCompositeOperation にはそのまま渡せない値がある。
// "linear-dodge" (加算/発光) は Canvas API では "lighter" として扱う。
// "subtract" (減算) は Canvas API には無いためピクセル単位フォールバックで処理する。
// 描画箇所では composite.ts のヘルパーを通すこと。
export type BlendMode =
  | "normal"
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten"
  | "color-dodge"
  | "color-burn"
  | "linear-dodge"
  | "subtract"
  | "soft-light"
  | "difference"
  | "color"
  | "luminosity";

// ===== レイヤー種類 =====
export type LayerKind = "raster" | "text" | "group";

export interface TextLayerData {
  text: string;
  fontFamily: string;
  fontSize: number; // px (canvas座標)
  color: string;
  bold: boolean;
  italic: boolean;
  align: "left" | "center" | "right";
  x: number; // canvas座標、テキスト基準点
  y: number;
  maxWidth?: number;
  lineHeight: number; // 倍率 (1.2など)
}

// ===== レイヤー =====
// ピクセルの正本は OffscreenCanvas。
// React state には id 等のメタ情報だけを置き、ピクセルは別ストア（DocumentStore）が持つ。
export interface LayerMeta {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;        // 0..1
  blendMode: BlendMode;
  locked: boolean;
  transparentPixelLock?: boolean;
  kind?: LayerKind;       // 省略時はraster
  text?: TextLayerData;   // kind==="text" のときのみ
  // グループ所属。undefined はトップレベル。グループ自身は parentId で別グループにネスト可能。
  parentId?: string;
  // kind==="group" のときのみ、UI 上の開閉状態。
  collapsed?: boolean;
  // Photoshop のクリッピングマスク。直下の非クリップレイヤー（同じ親内）の
  // 不透明部分にのみピクセルを表示する。連続して true が並ぶと同じベースに重ねてクリップ。
  clippingMask?: boolean;
}

// ===== 範囲指定 =====
// 多角形やマジックワンド、変形後の選択範囲は ImageData マスクで表現。
// maskWidth/maskHeight は doc 全体サイズの場合も、bbox に切り出したサイズの場合もある。
// cropped mask の場合は x/y が doc 座標上の配置位置を表す。
// 値が >= 128 のピクセルが選択範囲。
export type Selection =
  | { kind: "none" }
  | { kind: "rect"; x: number; y: number; w: number; h: number }
  | {
      kind: "polygon";
      points: { x: number; y: number }[];
      // bounding box (描画ヒント)
      x: number;
      y: number;
      w: number;
      h: number;
    }
  | {
      kind: "mask";
      // RGBA バッファ。alpha>=128 のピクセルが選択範囲。
      // ImageDataをそのままstateに置くとReact devtoolsが重くなるので生データで持つ。
      data: Uint8ClampedArray;
      maskWidth: number;
      maskHeight: number;
      x: number;
      y: number;
      w: number;
      h: number;
    };

// ===== ドキュメント =====
export interface DocumentSize {
  width: number;
  height: number;
}

export interface CanvasExtendPreview {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

// ===== ファイル読み込み計測 =====
export interface NativeReadTiming {
  fileName: string;
  path?: string;
  requestedChunkBytes: number;
  chunkCount: number;
  totalBytes: number;
  selectedToFirstChunkMs: number | null;
  readStartToFirstChunkMs: number | null;
  allChunksReadMs: number;
  finishReadMs: number;
  fileConstructionMs: number;
  totalOpenMs: number;
}

export interface PsdLoadTimingSummary {
  headerPreflightMs: number;
  fileArrayBufferMs: number;
  metadataPreflightMs: number;
  readPsdMs: number;
  walkPsdChildrenMs: number;
  layerDecodeMs: number;
  bboxCanvasMs: number;
  docResizeMs: number;
  replaceLayersFromCanvasMs: number;
  firstPaintWaitMs?: number;
  loadPsdTotalMs: number;
}

export interface PsdLoadTimingReport {
  fileName?: string;
  fileBytes: number;
  width: number;
  height: number;
  layerCount: number;
  drawableLayerCount: number;
  groupLayerCount: number;
  deferredLayerCount: number;
  nativeRead?: NativeReadTiming;
  timings: PsdLoadTimingSummary;
}

// ===== AI 補助線 =====
export type GuideShape =
  | {
      type: "line";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      color: string;
      label?: string;
    }
  | {
      type: "circle";
      cx: number;
      cy: number;
      r: number;
      color: string;
      label?: string;
    }
  | {
      type: "rect";
      x: number;
      y: number;
      w: number;
      h: number;
      color: string;
      label?: string;
      highlight?: boolean; // 指摘箇所ハイライト用
    };

export interface AIResponse {
  advice: string;
  guides: GuideShape[];
  palette?: string[]; // カラーパレット提案（#rrggbb x5）
}

export type AIImageMediaType =
  | "image/png"
  | "image/jpeg"
  | "image/webp"
  | "image/gif";

// ===== AI モード =====
export type AIGuideDisplayMode = "guides" | "pins";

export type AIMode =
  | "general"      // 全体アドバイス
  | "pose"         // ポーズ評価
  | "composition"  // 構図評価
  | "anatomy"      // 解剖学チェック
  | "color"        // カラーバランス
  | "lines"        // 線の整理
  | "palette";     // カラーパレット提案

export type WorkStage = "rough" | "lineart" | "baseColor" | "shadow" | "highlight" | "final";

// ===== AI 強化モード / 今日の課題 =====
export type ChallengeCategory =
  | "drawing"
  | "color"
  | "hand"
  | "composition"
  | "line"
  | "light";

export type TimerMode = "countdown" | "countup";
export type ScoringStrictness = "gentle" | "normal" | "strict";

export interface ChallengeItem {
  id: string;
  category: ChallengeCategory;
  prompt: string;
  enabled: boolean;
}

export interface ChallengeRecord {
  id: string;
  createdAt: number;
  category: ChallengeCategory;
  prompt: string;
  timerMode: TimerMode;
  durationSec: number;
  strictness: ScoringStrictness;
  score: number;
  subscores?: {
    structure?: number;
    color?: number;
    completion?: number;
  };
  advice: string;
  thumbnailBase64?: string;
}

// ===== チャット =====
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  // 表示用の純テキスト。assistant の場合は JSON 返答から advice を取り出したもの。
  // JSON 解析に失敗した場合は生テキストをそのまま入れる。
  text: string;
  // user メッセージのみ。base64（プレフィックス無し）。
  imageBase64?: string;
  // 送信した画像のピクセルサイズ (ダウンスケール後の幅・高さ)。
  // assistant が万一絶対座標で返してきた場合の救済に使用する。
  imageSentWidth?: number;
  imageSentHeight?: number;
  // 画像を送った時点のドキュメントの幅・高さ。assistant の正規化座標を
  // 展開する際の基準サイズとして使う (チャット中にキャンバスがリサイズされる
  // 可能性があるため送信時点の値を覚えておく)。
  imageDocWidth?: number;
  imageDocHeight?: number;
  // 表示用のプレビュー URL（data: 形式）。assistant 側では使わない。
  imagePreviewUrl?: string;
  // 直近画像に置き換わり、画像データとプレビューを解放した添付履歴。
  imageOmitted?: boolean;
  // assistant メッセージで、JSON 返答に guides/palette が含まれていれば保持。
  guides?: GuideShape[];
  palette?: string[];
  timestamp: number;
}

// ===== テーマ =====
export type Theme = "dark" | "light";

// ===== ショートカット =====
// action 名 → キーコンビ文字列 (例: "ctrl+z", "b", "shift+["）
export type ShortcutMap = Record<string, string>;
