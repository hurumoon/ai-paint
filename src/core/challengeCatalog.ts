import { ChallengeCategory, ChallengeItem } from "../types";

export const CHALLENGE_CATEGORY_LABEL: Record<ChallengeCategory, string> = {
  drawing: "デッサン",
  color: "色",
  hand: "手",
  composition: "構図",
  line: "線",
  light: "光影",
};

export const DEFAULT_CHALLENGE_ITEMS: ChallengeItem[] = [
  { id: "default-drawing-1", category: "drawing", prompt: "身近な小物を1つ選び、外形と接地面を意識して描く", enabled: true },
  { id: "default-drawing-2", category: "drawing", prompt: "顔のアタリだけを描き、目・鼻・口の配置を崩さず整える", enabled: true },
  { id: "default-hand-1", category: "hand", prompt: "開いた手を箱の集合として捉え、指の長さの差を描き分ける", enabled: true },
  { id: "default-hand-2", category: "hand", prompt: "握った手を大きな塊から描き、関節の位置を整理する", enabled: true },
  { id: "default-composition-1", category: "composition", prompt: "主役を中央から少し外し、余白に意味を持たせる", enabled: true },
  { id: "default-composition-2", category: "composition", prompt: "前景・中景・背景を分け、奥行きが伝わる構図にする", enabled: true },
  { id: "default-line-1", category: "line", prompt: "外形線を太く、内側の線を細くして読みやすくする", enabled: true },
  { id: "default-line-2", category: "line", prompt: "線の重なりを減らし、必要な線だけで形を説明する", enabled: true },
  { id: "default-color-1", category: "color", prompt: "3色だけで明暗と素材感を分ける", enabled: true },
  { id: "default-color-2", category: "color", prompt: "影色を濁らせず、主役の色が沈まないように塗る", enabled: true },
  { id: "default-light-1", category: "light", prompt: "光源を1つ決め、影の向きを全体でそろえる", enabled: true },
  { id: "default-light-2", category: "light", prompt: "明部・中間・暗部の3段階だけで立体感を作る", enabled: true },
];

export const WORKSPACE_CHALLENGE_PROMPTS: Record<ChallengeCategory, string[]> = {
  drawing: [
    "身近な小物を1つ選び、外形の比率と接地面を意識して描く",
    "円柱か箱を1つ描き、奥行きの方向が読み取れるようにする",
    "顔のアタリだけを描き、目鼻口の配置を崩さず整える",
  ],
  color: [
    "3色だけでモチーフの明暗と素材感を分ける",
    "彩度を抑えた影色を使い、主役の色を濁らせずに描く",
    "暖色と寒色を1組使い、画面の主役と背景を分離する",
  ],
  hand: [
    "開いた手を箱の集合として捉え、指の長さの差を描く",
    "握った手を大きな塊から描き、関節の位置を整理する",
    "手首から指先までの流れを一本のラインで意識して描く",
  ],
  composition: [
    "主役を画面の中央から少し外し、余白に意味を持たせる",
    "前景・中景・背景を分け、奥行きが伝わる構図にする",
    "視線誘導のラインを1本決めて、主役へ向かわせる",
  ],
  line: [
    "外形線を太く、内側の線を細くして読みやすくする",
    "線の重なりを減らし、必要な線だけで形を説明する",
    "入り抜きを意識して、同じ太さだけの線を避ける",
  ],
  light: [
    "光源を1つ決め、影の向きを全体で揃える",
    "明部・中間・暗部の3段階だけで立体感を作る",
    "落ち影を描き、モチーフが床に接している感覚を出す",
  ],
};
