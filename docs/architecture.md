# アーキテクチャ

## 全体

ai-paint は Vite + React + TypeScript のフロントエンドと、Tauri 2 + Rust のデスクトップ側コマンドで構成する。

- React 側は UI、描画状態の接着、ショートカット、保存 UI、AI パネルを担当する。
- Rust 側は OpenAI Responses API / Anthropic Messages API への HTTP、API キー保持、Tauri プラグイン連携を担当する。
- ピクセルデータの正本は React state ではなく `PaintDocument` と各 layer の `TileStore` に置く。

## React の主要境界

- `src/App.tsx`: アプリ全体の基礎状態と上位 controller / view model hook の結線。重い UI 実装や props 組み立ては直接持たない。
- `src/hooks/useAppAIChatControllers.ts`: AI controller とチャット controller の依存関係を束ねる。
- `src/hooks/useAIController.ts`: AI パネル状態と AI action hook の結線を担当する。API キー状態は `src/hooks/ai/useAIApiKeyState.ts`、リファレンス画像の検証と Object URL 寿命管理は `src/hooks/ai/useAIReferences.ts`、タブ UI への反映は `src/hooks/ai/useAITabUiStatePatch.ts` に置く。
- `src/hooks/useAppActionControllers.ts`: ファイル、タブ、保存、エクスポート、新規キャンバス、テキスト編集、バックアップの action controller を束ねる。
- `src/hooks/useFileActions.ts`: ファイル入力、drag/drop、読み込み/保存中の UI 状態を担当する。形式判定と保存 blob 生成は `src/core/fileFormats.ts`、読み込み/保存 workflow は `src/hooks/fileActions` に置く。
- `src/hooks/useAppViewModel.ts`: `AppChrome` / `AppCanvasArea` / `AppPanels` / `AppDialogs` / `AppStatusBar` へ渡す model と props を組み立てる。
- `src/components/AppChrome.tsx`: メニュー、タブ、ツールバー、ツールオプションの chrome composition。`App.tsx` からは `menu` / `tabs` / `toolbar` / `toolOptions` の domain model を受け、子コンポーネントへ配線する。
- `src/components/AppCanvasArea.tsx`: 中央キャンバス領域、空キャンバス表示、サブビュー、リファレンス、描き方参照、AI 課題モード。
- `src/components/AppDialogs.tsx`: About、ショートカット、キャンバス設定、キャンバス拡張、レイアウト設定、エクスポート、バックアップ、新規キャンバス、色調補正。
- `src/components/AppPanels.tsx`: 左右パネルの layout shell。`RightSectionId` と各パネル表示の対応は `src/components/panels/panelRegistry.tsx` に置き、表示パネルやテキスト編集などの section JSX は `src/components/panels` 側へ分ける。パネルへ渡す document / view / chat / AI の model 組み立ては `src/hooks/useAppPanelModel.ts` に閉じ込める。
- `src/components/Canvas.tsx`: Canvas DOM、renderer lifecycle、viewport、描画入力 controller の接着。各描画 session hook と overlay 入力配線は `src/hooks/canvasTools/useCanvasInteractionController.ts` に置く。
- `src/components/CanvasSettings.tsx`: 設定ダイアログの shell と解像度/DPI適用を担当する。AI、履歴メモリ、色履歴などの各設定 UI は `src/components/canvasSettings` の section に置く。
- `src/hooks`: App や Canvas から切り出した controller/state 同期処理。`useAppShortcuts` は keyboard lifecycle と gate を担当し、action handler は `src/hooks/shortcuts` の domain factory で作る。
- `src/core`: 描画、履歴、保存形式、AI client、ショートカットなどの中核ロジック。
- `src/workers`: フラッディングやパレット抽出など、メインスレッドから外す重い処理。

`App.tsx` は composition root として残し、Canvas 領域やダイアログ群の JSX を再び戻さない。新しい画面単位のまとまりが増える場合も、まず `src/components` 側へ切る。

## 描画と履歴

- `PaintDocument` がドキュメントサイズ、レイヤー、アクティブレイヤー、レイヤー構造を持つ。
- `PaintDocument` はピクセル正本への所有権、layer tree、active layer、通知/version の境界に留める。保存用の合成は `src/core/paintDocumentExport.ts`、AI 送信用画像は `src/core/aiImagePayload.ts`、重いピクセル変換は `src/core/paintDocumentLayerPixels.ts`、UI workflow は `src/hooks`、履歴政策は `History` 側へ置き、呼び出し元は各 service/helper を直接使う。
- `PaintDocument` の公開メソッド追加は意図的な設計変更として扱う。`tests/unit/paintDocumentPublicApi.test.ts` は責務を意味的に証明するものではなく、未レビューの公開 API 追加を検知する tripwire である。新機能で必要になった処理は、まず既存の helper / service module へ置けないか確認し、追加する場合は公開 API 棚卸しも更新する。
- `TileStore` がピクセル格納を担当し、PSD 読み込み直後の deferred layer を必要になるまで doc サイズに展開しない。
- `History` は undo/redo と snapshot を担当する。新しい描画・レイヤー操作では履歴範囲と `PaintDocument.invalidate()` / `invalidateActive()` の使い分けを確認する。
- クリッピングマスク、グループ、ブレンドモードは合成経路と PSD/.aipaint 保存形式の両方に関係する。

## AI / Tauri

- 作業Agentは `src/core/agent` が工程・反復・上限・制作記録を持ち、`src/core/paintApi` から既存の描画・履歴処理を呼ぶ。UI controllerとの接続は `src/hooks/agent`、画面は `src/components/agent` に置く。`PaintDocument` の公開メソッドは増やさない。
- `request_model` は `src-tauri/src/agent_models.rs` で提供元を切り替える。従来の解析・チャットは既存のClaudeコマンドを使い続ける。API一覧と記録仕様は [paint-api.md](./paint-api.md)。

- フロントエンドは外部 API を直接呼ばず、`src-tauri/src/main.rs` の Tauri command を呼ぶ。
- Rust 側は `analyze_canvas_v2` と `chat_with_claude` から Anthropic Messages API へ送信する。
- `src-tauri/src/native_files.rs` は Tauri command の入口を担当する。path 権限管理は `src-tauri/src/native_files/paths.rs`、read/write セッションと atomic write は `src-tauri/src/native_files/sessions.rs` に置く。
- デバッグビルドでは API キーをメモリ上だけに保持する。リリースビルドでは OS の資格情報ストアに保存し、`localStorage` には保存しない。
- チャットの独立ウィンドウは Tauri の WebviewWindow とイベントでメインウィンドウと同期する。

## 検証

- TypeScript / Vite に関わる変更後: `npm.cmd run build`
- UI や描画挙動を変えた場合: `npm.cmd run test:e2e -- tests/e2e/app-smoke.spec.ts`
- Rust 側に関わる変更後: `src-tauri` で `cargo check`
