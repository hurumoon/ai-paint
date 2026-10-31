# AGENTS.md

このファイルはリポジトリ全体に適用する。作業時はここに書いた規約を優先すること。

## 基本方針

- このプロジェクトは Vite + React + TypeScript のフロントエンドと、Tauri 2 + Rust のデスクトップアプリで構成する。
- 変更は目的に必要な範囲に絞る。無関係なリファクタ、フォーマット一括変更、生成物の更新は行わない。
- 既存の設計を優先する。特に `src/core`、`src/hooks`、`src/components`、`src/workers` の責務分離を崩さない。
- 既存の日本語コメントや UI 文字列には文字化けして見える箇所がある。依頼と無関係な文字列修正や再エンコードはしない。新規に追加する日本語は UTF-8 で書く。
- ユーザー向けの説明、エラー、UI 文言は原則として日本語で書く。

## コマンド

- 開発サーバー: `npm run dev`
- フロントエンドビルド: `npm run build`
- Tauri 開発起動: `npm run tauri -- dev`
- Tauri ビルド: `npm run tauri -- build`
- ESLint: `npm run lint`
- Unit test: `npm run test:unit`
- E2E test: `npm run test:e2e`
- Rust 側の確認は `src-tauri` で `cargo check`、整形は `cargo fmt` を使う。
- TypeScript は `strict`、`noUnusedLocals`、`noUnusedParameters` を通すこと。

## TypeScript / React

- import は既存の相対 import スタイルに合わせる。不要 import は残さない。
- 型は明示的に保つ。`any` は避け、既存の `src/types.ts` や各 core 型を再利用する。
- React コンポーネントは関数コンポーネントで書く。重い子コンポーネントは既存の方針に合わせて `memo`、`useMemo`、`useCallback` を使う。
- `useEffect` の依存配列を正しく保つ。クロージャが古くなる箇所は既存同様 `useRef` で最新値を保持する。
- UI の一時状態はコンポーネントまたは hook に閉じ込める。ドキュメント、履歴、レイヤーなどアプリ中核の状態は `PaintDocument`、`History`、tab store の責務を優先する。
- `localStorage` や `IndexedDB` への保存は既存キー、既存ヘルパー、既存 controller hook の流れに合わせる。

## Canvas / 描画エンジン

- ピクセルデータの正本は `PaintDocument` と各 layer の `TileStore` に置く。React state に大きな `ImageData`、canvas、base64 を持たせない。
- 描画変更は履歴、dirty 判定、timelapse、auto backup に影響する。新しい描画操作は `History` の記録範囲と `PaintDocument.invalidate()` / `invalidateActive()` の使い分けを確認する。
- アクティブレイヤーだけが変わる操作では、背景キャッシュを壊す必要があるかを判断する。不要な全体再描画や全レイヤー materialize は避ける。
- PSD 読み込み後の deferred layer はメモリ節約のため存在する。必要な直前まで materialize しない。
- 重い画像処理、全画素走査、パレット抽出、ぼかし、塗りつぶし拡張は可能な限り `src/workers/paint.worker.ts` 側に寄せる。
- `ImageBitmap`、OffscreenCanvas、canvas pool など GPU/メモリ資源を持つものは、不要になったら `close()` や dispose 相当の処理を入れる。

## UI / CSS

- 既存の `src/ui/primitives.tsx`、`src/ui/Icons.tsx`、`src/styles.css` の部品と命名に合わせる。
- ツールボタンは原則アイコン + `title` を使う。既存ツールバーの密度を崩さない。
- ペイントアプリとして、操作面はコンパクトでスキャンしやすい UI を保つ。大きな宣伝風セクションや装飾的なカードは追加しない。
- ボタン、スライダー、タブ、ポップオーバー、トーストは既存プリミティブを優先する。
- キャンバス、ツールバー、パネル、ステータスバーが重ならないよう、固定サイズや overflow の影響を確認する。
- テキストがボタンやパネルからはみ出さないよう、長い文言は短くするか折り返しを考慮する。

## Tauri / Rust

- フロントエンドから外部 API を直接呼ばず、既存方針通り Tauri command 経由にする。
- API キーや画像 base64 はログに出さない。
- `serde` の入出力型を明示し、フロントエンド側の TypeScript 型と意味を揃える。
- Rust のエラーは `Result<T, String>` の既存形式に合わせる。ユーザーに表示される可能性のある文言は日本語を基本にする。
- モデル名、API version、エンドポイントなど外部仕様に依存する箇所を変える場合は、影響範囲を明記する。

## ファイル構成

- `src/components`: UI コンポーネント。描画ロジックが大きくなる場合は `core` や hook に逃がす。
- `src/hooks`: App から切り出した controller/state 同期処理。UI と core の接着を担う。
- `src/core`: 描画、保存形式、履歴、AI client、ショートカットなどのアプリ中核ロジック。
- `src/workers`: メインスレッドから外す重い処理。
- `src/ui`: 汎用 UI プリミティブとアイコン。
- `src-tauri`: Tauri 設定と Rust commands。
- `docs`: 設計メモや作業計画。実装に追随して必要な場合だけ更新する。

## コメント

- コメントは「なぜそうしているか」「壊しやすい制約」を説明するために書く。
- 単純な処理説明コメントは増やさない。
- 既存に長い設計コメントがある箇所では、同じ粒度で必要な制約だけ追記する。

## 検証

- TypeScript / React / Vite に関わる変更後は、原則 `npm run lint` と `npm run build` を実行する。
- 挙動に関わる変更後は、影響範囲に応じて `npm run test:unit` や `npm run test:e2e` も実行する。
- Tauri/Rust に関わる変更後は、`src-tauri` で `cargo check` を実行する。
- UI や描画挙動を変えた場合は、可能な範囲で `npm run dev` を起動しブラウザで確認する。
- テストやビルドを実行できなかった場合は、理由と未検証範囲を報告する。

## Git

- 既存の未コミット変更はユーザーの作業として扱い、勝手に戻さない。
- 変更前後の差分を確認し、意図しないファイル変更を含めない。
- コミットや push はユーザーから明示された場合だけ行う。

# 注意
文字化けはほとんどの場合で起こっておらずあなたがPowerShellを上手く扱えていないことによる勘違いです！注意して！
Garbled characters do not occur in most cases, and are a misunderstanding caused by you not being able to use PowerShell well! Be careful!
