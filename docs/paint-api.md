# 描画APIとAIドロー（β版）

アプリを開くと `window.aiPaint` から機能を呼び出せる。これはアプリ内のJSON APIであり、HTTPサーバーではない。APIキーを含む外部モデル通信はTauri側で行う。

## 呼び出し方

```js
const api = window.aiPaint;
const catalog = api.list(); // 名前、説明、引数スキーマ、変更操作かどうか
await api.execute("document.get_state", {});
await api.execute("drawing.stroke", {
  points: [{ x: 100, y: 100, pressure: 1 }, { x: 300, y: 150, pressure: 1 }],
  settings: { kind: "pen", size: 8, opacity: 1, color: "#23aabb" }
});
await api.execute("document.get_image", {
  x: 80, y: 80, width: 240, height: 120, maxEdge: 1024
});
```

先にキャンバスを作成する。座標はキャンバスの画素単位。結果は `{ ok: true, value }` または `{ ok: false, error: { code, message, details? } }`。不正な引数は実行前に拒否する。部分画像は元の範囲 `region` と、縮小後の `width` / `height` を返す。

引数の正本は `api.list()`。AIドロー（β版）の「機能API」から定義の確認と手動実行もできる。例はキャンバスが320×200px以上の場合。

## 機能とAPIの対応

同じ接頭辞の名前をまとめて表記する。2026-09-05時点で94操作。

| 機能 | API |
| --- | --- |
| 作業状態・タブ一覧 | `app.get_state` |
| キャンバス・レイヤー・履歴の状態、全体/部分画像、採色 | `document.get_state`, `get_image`, `sample_color` |
| ブラシ・消去・塗りつぶし・パス・図形・グラデーション・ぼかし・色調補正 | `drawing.stroke`, `stroke_batch`, `erase`, `fill`, `path`, `shape`, `gradient`, `blur`, `color_adjust` |
| レイヤー・グループ・テキストの追加/編集、表示・ロック・透明度・ブレンド・クリッピング | `layer.add`, `add_group`, `add_text`, `update_text`, `update_meta` |
| レイヤー複製・削除・順序・結合・選択 | `layer.duplicate`, `remove`, `reorder`, `merge_down`, `set_active`, `pick` |
| 範囲選択・マジックワンド・マスク入出力・変形 | `selection.get`, `set`, `magic`, `get_mask`, `set_mask`, `transform` |
| Undo/Redo | `history.undo`, `redo` |
| サイズ・方向別拡張・DPI | `canvas.resize`, `extend`, `set_dpi` |
| ツール・カテゴリ別ブラシ設定・筆圧・消しゴム・色履歴 | `tool.get`, `update`, `clear_color_history` |
| ズーム・位置・回転・反転・グリッド・サブビュー表示 | `view.get`, `update` |
| リファレンス表示画像・位置・ズーム・原寸表示 | `reference.get`, `update` |
| テーマ・レイアウト・ショートカット・履歴容量・バックアップ設定 | `settings.get`, `update` |
| タブ作成・切替・閉じる・並べ替え | `tabs.create`, `select`, `close`, `reorder` |
| ファイル読込・保存・データ取得 | `file.open`, `save`, `export` |
| バックアップ一覧・保存・復元・削除 | `backup.list`, `save`, `restore`, `delete` |
| カスタムブラシ一覧・登録・編集・削除 | `custom_brush.list`, `add`, `update`, `remove` |
| 既存タイムラプス状態・記録切替・消去・動画保存 | `timelapse.get`, `set_enabled`, `clear`, `export` |
| Claude評価・比較・色抽出・ガイド・参考画像 | `ai.get_state`, `analyze`, `compare`, `extract_palette`, `show_guides`, `clear_guides`, `add_reference`, `get_reference`, `remove_reference` |
| Claudeのモデル設定 | `ai.model_settings.get`, `update`, `reset` |
| Claudeチャット・提案の適用・消去・別窓表示 | `chat.send`, `apply`, `clear`, `detach` |
| 描画ガイド・活動記録 | `guide.list`, `activity.get` |
| 課題・抽選・採点・記録 | `challenge.list`, `update`, `pick`, `score`, `records`, `delete_record` |
| Agent状態・制作記録・開始・見本再描画・再開・一時停止・中止 | `agent.get_state`, `get_recording`, `start`, `start_reference`, `resume`, `pause`, `stop` |

`drawing.stroke_batch` は `strokes: [{ points, settings }]` と任意の `label` を受け取る。1〜1,024筆、合計32,768点まで。筆致の間は接続せず、全件の検証後に1回の履歴操作として描画する。

APIは機能の実行窓口で、マウスイベントやOSのクリップボード・ファイル選択画面の遠隔操作は扱わない。ファイル選択は既存ダイアログを使い、データ指定なら直接読み込める。`file.export` のデータ取得は20MiBまで。それより大きい作品は `file.save` で保存する。

## Agentの動作

```js
await api.execute("agent.start", {
  prompt: "青緑の髪の人物を、全身が入る構図で描く",
  provider: "openai", model: "gpt-6-astra",
  limits: { maxIterations: 120, maxDurationMs: 1800000, maxTotalTokens: 360000 }
});
await api.execute("agent.get_state", {}); // startは完了待ちせず返る
await api.execute("agent.pause", {});
await api.execute("agent.resume", {});
```

構図 → ラフ → 線画 → ベース塗り → 影 → ハイライト → 仕上げの順で、画像取得 → 判断 → API実行 → 再確認を繰り返す。モデルは `app_list_tools` で機能を調べ、`app_call_tool` で呼び出す。各工程・再訪で観察画像の変化を必須とし、設定変更だけの完了を拒否する。描画と同じ応答での工程完了も拒否し、新しい画像を見て完了条件の根拠を返した後に進める。前工程への戻りも可能。画像変化の判定は観察PNGの一致比較で、見た目の品質を自動採点するものではない。

`agent.start` / `agent.resume` は `references` に `{ id, name, dataUrl, width, height, byteLength }[]` を受け取る。PNG data URL、長辺1536px以下、1枚2MiB以下、最大3枚。再開時に省略すると保持し、空配列なら削除する。新規会話・再開の初回に、作業キャンバスと区別した目標画像として送信し、以降は会話の継続情報で保持する。

操作画面は既存パネルの「AIドロー（β版）」セクション。初期配置は右パネルのAIチャットの下で、「ウィンドウ配置設定」から左右移動・並べ替え・非表示にできる。配置済みの各セクションの順序と左右反転設定に従い、専用タブやステータスバーの起動ボタンは置かない。APIから開始・再開すると、配置先でAIドローを表示する（非表示なら右パネルへ追加）。現在の絵と記録の再生は既存キャンバスに表示する。

実行中は対象ドキュメントを固定し、通常画面と外部からの編集を止める。キャンバスのパン・ズームとAIドローの停止操作は使える。API操作同士は読み取りも含めて直列に実行する。描画中は共有の `paintBusyRef` を保持し、自動バックアップとの衝突を避ける。キャンバスのサイズ変更は既存UIと同様、選択とUndo履歴を消去する。

既定上限は120反復・30分・合計36万トークン（入力30万、出力8万）、モデル160回・操作600回。時間とトークンは累計なので、上限から再開する場合は上限を増やす。トークンは応答で返された使用量を集計するため、送信済みリクエストによる超過を完全には防がない。一時停止は遅延応答の適用を止めるが、外部サーバーの実行・課金を取り消すものではない。HTTPのタイムアウトは120秒。

接続先は `https://api.openai.com/v1/responses` と `https://api.anthropic.com/v1/messages`。OpenAIは応答ID、Claudeは会話内容をメモリ上で引き継ぐ。APIキーとこれらの継続情報は制作ファイルに保存しない。既存の解析・チャットの提供元は変更していない。

## 保存と再生

### お手本の再描画

「AIドロー（β版）」の「描画方法」で「お手本を再描画」を選び、画像を添付して「再描画を開始」を押す。複数の見本があれば1枚を選択する。モデルやAPIキーは不要で、ローカルのWorkerが輪郭・色を解析し、既存ブラシで6工程を描く。

APIからは `api.execute("agent.start_reference", { reference })` で開始する。`reference` は上記の参照画像1枚と同じ形式で、PNGの実寸との一致も検証する。完了を待たずに返る。`agent.get_state` は `mode: "reference"` と `referenceProgress: { phase, completedStrokes, totalStrokes }` を返す。`phase` は `planning` または `drawing`。中止は `agent.stop`、再生画像は `agent.get_recording` を使う。

現在のキャンバスはリサイズせず、中央に新しい最上位フォルダと白背景・工程レイヤーを追加する。元のレイヤーの画素を保持する。見本は原寸以下、キャンバス内、最大辺768px・30万画素以内に収める。最大6万筆に収まるよう解析の細かさを自動調整する。調整後も描画範囲と配置を維持するが、細かな模様は粗くなる場合がある。完了・中止後は描画用の一時選択範囲を解除する。途中の絵も残るが、再描画の途中再開は非対応で、再実行は新しい制作になる。`agent.pause` もこのモードでは中止になる。

制作記録は通常Agentと同じ `.aipaint` に保存し、再読込後も既存キャンバスで再生できる。以下の画像枚数・容量・操作記録の省略規則も共通で、全筆致のJSONは保存しない。部位を理解した「髪→肌→服」の制作順序は未対応。[試作と検証結果](./reference-paint-experiment.md)も参照。

### 共通の保存形式

`.aipaint v2` の任意項目 `agent` に工程・指示・モデル・お手本・使用量・操作記録・工程画像を保存する。再生は記録画像の連続表示であり、操作ログをもう一度実行する方式ではない。保存後の再開は現在の絵と保存された工程を読み直して新しいモデル会話を始める。お手本欄の編集は次の開始・再開時に記録へ反映する。

画像は最大180枚、1枚12MiB、合計48MiB。初期・最終画像を優先し、上限に達すると中間画像を間引く。操作記録は最大2000件で、長い引数を省略し、画像データや認証情報を除く。完全な全ストロークの動画記録ではない。

実行中の記録を読込むと一時停止になる。モデルによる描画は一時停止・エラー・上限到達から再開でき、完成・中止からは新しい制作を開始する。見本の再描画は途中再開できない。新規開始は現在の絵を残して制作記録を置き換える。

制作記録を持たない旧ファイルも読込可能。PNG / JPEG / WebP / PSDには記録を保存しない。旧版のai-paintで再保存すると、未知のAgent拡張は保持されない。

## 実装境界と検証

- `src/core/paintApi`: 引数検証と既存描画・履歴処理の呼び出し。
- `src/hooks/agent`: UI controllerとAPIの接続、状態同期、外部API窓口。
- `src/core/agent`: モデル共通型、反復処理、工程・上限・制作記録。
- `src/components/agent`: 設定・進捗・再生・API確認画面。
- `src-tauri/src/agent_models.rs`: GPT / ClaudeのHTTP通信・画像とツール結果の変換。

単体テスト、Rustテスト、ブラウザでの実描画・履歴・工程進行・記録の保存再読込を検証する。モデル応答はテスト用に置換しているため、実APIとの通信と完成絵の品質は未検証。画質の達成判定は[開発計画](./ai-drawing-playback-plan.md)に従う。
