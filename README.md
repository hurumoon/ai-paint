# AI Paint

指示やお手本から描く「AIドロー（β版）」と、Claude に絵を相談する機能を備えた、Tauri 2 + React 製のお絵かきアプリ。

公開リポジトリ: https://github.com/hurumoon/ai-paint

## ライセンス

AI Paint本体は[MITライセンス](./LICENSE)で公開しています。改変・再配布・商用利用が可能です。著作権表示とライセンス文を保持してください。

依存ライブラリとUIアイコンには、それぞれのライセンスが適用されます。[第三者ライセンス一覧](./THIRD_PARTY_NOTICES.txt)に著作権表示、ライセンス文、対象ソースの入手方法をまとめています。アプリの「About」からも全文を確認できます。MPL 2.0の対象ソースは[third-party-sources](./third-party-sources/)にも収録しています。

参考画像・カスタムブラシ・フォントなど、利用者が追加する素材は本体のライセンスには含まれません。利用する権利を持つものを用意してください。外部AIサービスの利用には、それぞれの利用条件とAPI利用料金が適用されます。

依存関係を更新した場合は、`npm run licenses:generate`で第三者ライセンス一覧を再生成してください。公開前の確認は`npm run check:public`で行います。

本人の非公開メールを本文でも検査する場合は、環境変数`AI_PAINT_PRIVATE_EMAIL`で検査対象を渡してください。初回公開では`npm run check:public -- --initial-publication`を使い、履歴が1コミットだけであることも確認します。メールの値をソースや設定ファイルへ書き込まないでください。

## なにができる

### お絵かき機能

- **11種類のツール**: ブラシ / 消しゴム / バケツ / 範囲選択 / ぼかし / グラデーション / 図形 / スポイト / 移動 / テキスト / レイヤー選択（クリックでそのピクセルを含むレイヤーをアクティブに）
- **22種類のブラシ**: round / pencil / marker / airbrush / calligraphy / pen / watercolor / charcoal / spray / dotted / crayon / oil（油彩）/ pastel（パステル）/ fountainPen（万年筆）/ chalk（チョーク）/ scatter（散布）/ gPen（漫画Gペン）/ maruPen（漫画丸ペン）/ highlighter（蛍光ペン）/ neon（ネオン）/ sparkle（キラキラ）/ **custom**
- **カスタムブラシ**: 画像（PNG など）をスタンプ素材として登録、間隔・前景色での色付けを設定可
- **消しゴム3種**: round / hard / soft
- **筆圧対応**: Pointer Events の pressure を読み取り、ペン/タッチ時に反映
- **筆圧感度スライダー**: サイズ・不透明度それぞれに 0〜100%
- **筆圧カーブエディタ**: 制御点をドラッグして応答カーブを自由に編集（プリセット linear/soft/hard/bell 付き）
- **手ブレ補正** (stabilizer) スライダー
- **図形**: 矩形 / 楕円 / 直線 / 多角形（塗り・線の太さ指定可）
- **グラデーション**: linear / radial、透明への遷移にも対応
- **範囲選択**: 矩形 / 多角形 / マジックワンド
  - 「連続する領域のみ」OFF で色域全体（色相選択モード）
  - 移動ツールで選択範囲の中身を移動 / 拡大縮小 / 回転 / 自由変形
  - 「全レイヤー/アクティブのみ」サンプル元切替
- **塗りつぶし（バケツ）**:
  - 許容差スライダー
  - **隙間閉じ**（線画の途切れを N px までスキップして塗る）
  - **領域拡大**（塗り結果を N px 太らせて線の下に潜らせる）
- **レイヤー**: 追加・削除・並び替え・複製・表示切替・不透明度・ブレンドモード (normal/multiply/screen/overlay/darken/lighten/color-dodge/color-burn/linear-dodge/subtract/soft-light/difference/color/luminosity)・ロック・サムネイル表示
- **レイヤーフォルダ（グループ）**: グループ作成・ネスト・開閉・親ごと表示/不透明度切替。インデント操作で出し入れ可
- **クリッピングマスク**: 直下の非クリップレイヤーの不透明部分にのみ表示（Photoshop 互換）
- **テキストレイヤー**: フォント・サイズ・太字・斜体・配置・行間
- **アンドゥ / リドゥ**: `Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y`
- **キャンバスサイズ・DPI 設定**: PNG 書き出し時に DPI メタ情報を埋め込み
- **方向別キャンバス拡張**: 上/右/下/左に個別の px 値で拡張・縮小。適用後の範囲をキャンバス上で確認可能（既存ピクセルは劣化なし）
- **グリッド表示**: 間隔・色・分割数を設定
- **サブビュー**: 全体のサムネイル
- **ズーム / パン / 回転**: `0` で初期化
- **ファイル入出力**:
  - 読み込み: PNG/JPEG/WebP、`.aipaint`（レイヤー保持）、`.psd`（レイヤー保持、ag-psd 経由でラスタライズ）
  - 書き出し: PNG（DPI 埋め込み）/ JPEG（品質指定）/ WebP（透過保持）/ `.aipaint` / `.psd`（他ソフト互換、レイヤー保持）
- **自動バックアップ**: 変更のあるアクティブタブだけを IndexedDB へ保存。非アクティブタブは対象外。新しいバックアップの保存成功後、最大10件・合計2GiB以内に収まるよう古い復旧点から削除する。保存後の整理に失敗してもバックアップは成功として扱い、保存済みの新しい復旧点は有効。整理が成功するまでは、件数・合計容量が一時的に上限を超える場合がある（例: 10件から11件）。次回の保存後にも整理を試みる
- **ツールオプションパネル**: 選択中ツールの色・サイズ・不透明度などを左パネルにまとめて表示
- **タブ**: 複数ドキュメントを同時に開ける（タブごとに独立した doc / history / timelapse）
- **色調補正**: `Ctrl+U` で明度/コントラスト/彩度/色相を調整
- **カラーヒストリー**: 使った色を自動で履歴に残す
- **レイアウト設定**: 左パネル/右パネル各セクションの表示有無を切り替え可
- **ダーク / ライト テーマ**
- **キーボードショートカット**: UI から自由にリマップ可能（マウスボタンも割当可、localStorage 保存）
- **About ダイアログ**: アプリ情報の表示とハッシュ ID コピー

### AIドロー（β版）と制作過程の再生

通常パネルの **「AIドロー（β版）」** を使う。初期配置は右パネルのAIチャットの下で、「ウィンドウ配置設定」から左右移動・並べ替え・非表示にできる。

**指示から描く（GPT / Claude）**

1. キャンバスを作り、「AIドロー（β版）」の「描画方法」で **「指示から描く」** を選ぶ。
2. 「モデル・APIキー」で提供元・モデル・APIキーを設定する。
3. 描きたい絵を入力し、必要なら **「画像を添付」** でお手本を渡す。ドラッグ＆ドロップ、貼り付けにも対応。**「描画を開始」** を押す。
4. 既存キャンバスに描画し、画像確認・修正を繰り返す。パネル内に現在の作業、応答待ち時間、工程数、停止理由を表示する。上限に達した場合は「上限設定」の該当項目を増やして再開する。
5. **「絵と制作過程を保存」** で `.aipaint` に保存する。再読込後も工程画像を再生し、一時停止した制作を再開できる。

初期モデルは `gpt-6-astra` / `claude-sonnet-4-5`。接続にはデスクトップ版が必要。制作過程は既存キャンバスで記録画像を連続再生し、「現在の絵に戻る」で編集表示に戻る。通常のタイムラプスとは別に記録する。

**お手本を再描画（APIキー不要）**

「描画方法」で **「お手本を再描画」** を選び、画像を添付して **「再描画を開始」** を押す。複数のお手本がある場合は1枚を選ぶ。ローカルで画像を解析し、現在のキャンバスに新しいフォルダと工程レイヤーを追加して、既存ブラシで描く。進捗表示・中止・制作過程の再生・`.aipaint` への記録保存に対応する。途中からの再開には対応せず、再実行は新しい制作になる。

お手本は最大3枚。PNG・JPEG・WebP・GIF（静止画として扱う）を受け付け、長辺1536px以下・1枚2MiB以下のPNGへ縮小する。開始・再開時のお手本は制作記録に含めて保存する。

新しい制作を開始すると現在の記録を置き換えるため、残したい記録は先に保存する。PNG / PSD などには制作記録を含めない。旧版で `.aipaint` を保存し直すと記録は失われる。

描画・編集・保存・設定などはアプリ内の共通APIからも利用できる。[API一覧と呼び出し例](docs/paint-api.md)。実APIによる生成と参考画像の画質への到達は、別途実機検証が必要。

### AI 解析（Claude）

- **7つの解析モード**:
  - `general` — 全体アドバイス
  - `pose` — ポーズ評価（重心・コントラポスト・シルエット）
  - `composition` — 構図評価（三分割・誘導線・余白）
  - `anatomy` — 解剖学チェック（骨格・関節・左右対称）
  - `color` — カラーバランス（彩度・明度・光源整合）
  - `lines` — 線の整理
  - `palette` — 5色パレット提案
- **作業段階を伝える**: ラフ / 線画 / ベース塗り / 影 / ハイライト / 仕上げ
- **リファレンス画像**: 「こういう絵に近づけたい」を複数枚 Claude に同時に渡せる
- **範囲指定して部分解析**: 選択範囲だけ切り出して送信、ガイドは元座標に戻して表示
- **比較解析**: 前回送信時の状態と現在を Claude に並べて比較してもらう
- **ガイド表示**: AI が返した line / circle / rect を半透明オーバーレイで描画、矩形は指摘ハイライト可
  - guides は 0.0〜1.0 の正規化座標で受信し、送信時のドキュメント寸法（または選択範囲寸法）に展開して表示
- **送信時の自動ダウンスケール**: AI に投げる画像は長辺 1024px までに縮小（モデルの座標感覚に揃え、API トークンと転送量を節約）
- **パレット適用**: Claude 提案の 5 色をワンクリックで色スウォッチに反映
- **タイムラプス**: 描画中のスナップショットを蓄積、後でプレビュー

### チャット（Claude）

- **画像つき会話**: テキストでの相談に加え、その時点のキャンバスを添付して投げられる
- **マルチターン**: 履歴を Claude に渡し続けるので「さっき指摘した目線の話だけど」のような文脈つきの会話が可能
- **JSON 応答対応**: 返答が advice/guides/palette を含む JSON だった場合は表示用の文章だけ展開し、ガイド/パレットはワンクリックで本体に反映できる
- **独立ウィンドウに切り離し**: チャットを別ウィンドウ（`/chat.html`）として開ける。メインウィンドウとは Tauri のイベントで状態同期する

## プライバシーと API キー

- AI 解析、比較解析、課題採点、画像つきチャットは Anthropic に画像を送信する。AIドロー（β版）の「指示から描く」は実行中、選んだ提供元（OpenAI / Anthropic）へ指示、キャンバス画像、添付したお手本、呼び出したAPIの結果を送信する。参考画像を取得する操作を選んだ場合、その画像も送信する。「お手本を再描画」はローカルで処理し、外部APIへ画像を送信しない。
- API キーはフロントエンドや `localStorage` には保存しない。
- 開発中は Tauri 側のメモリ上だけに保持し、配布 exe では OS の資格情報ストアに保存する。

## 必要なもの

1. **Node.js** 22 以上
2. **Rust** （`rustup` 推奨） — https://rustup.rs/
3. **Visual Studio C++ Build Tools** （Windows） — Tauri が要求
4. **Microsoft Edge WebView2** （Win 10/11 なら大抵入ってる）
5. 利用する提供元の **OpenAI API Key / Anthropic API Key**。既存の解析・チャットは Anthropic キーを使用。

## セットアップ

```powershell
# プロジェクトフォルダで
npm install

# 開発起動
npm run tauri -- dev
```

初回は Rust 側のクレートをビルドするので **数分〜10分** かかる。次回以降は早い。

## ビルド

フロントエンドだけを確認する場合:

```powershell
npm run build
```

Tauri の配布用 Windows 実行ファイルとインストーラを作る場合:

```powershell
npm run tauri -- build
```

Tauri の `beforeBuildCommand` で `npm run build` を実行するため、配布用ビルドでは最新の `dist/` が作成されてから同梱される。

主な成果物は次に出る。

- 実行ファイル: `src-tauri/target/release/ai-paint.exe`
- NSIS / MSI インストーラ: `src-tauri/target/release/bundle/`
この作業環境には、上記のフロントエンドビルドと Tauri ビルドをまとめて実行する `build-exe.bat` が置かれている場合がある。ただしこれはローカル用の補助スクリプトで、git には登録しない。リポジトリとしての正規手順は上の npm コマンド。

## CI の検証と配布

GitHub Actions の `CI` は、`Frontend tests` と `Rust check` でコードを検証する。main への push、タグへの push、手動実行では、続けて `Windows build and smoke test` が Windows アプリとインストーラをビルドし、実行ファイルの smoke test を行う。

installer のアップロード結果は `Windows installer distribution` で別に判定する。検証済みのファイルをそのまま配布するため、アップロード処理自体は Windows の job に残し、その結果を専用 job に渡す。アップロードだけが失敗した場合、検証 job は成功、配布 job は失敗となる。workflow 全体は失敗のままなので、原因は各 job の結果で区別する。Windows のビルド・smoke test が失敗した場合や実行対象外の場合、配布 job はスキップされる。

アップロードの詳細ログは `Windows build and smoke test` の `Upload Windows installers` にある。配布 job だけの再実行は結果の再判定のみで、再アップロードには Windows job を含む再実行が必要。

## Windows サムネイル / プレビュー

`.aipaint v2` は保存時に `thumbnail.png` を ZIP 内へ埋め込む。Windows のエクスプローラーやプレビューペインでその画像を表示したい場合は、Windows 専用の Shell Provider DLL をビルドして、ユーザー単位のレジストリへ登録する。

```powershell
npm.cmd run thumbnail:build
npm.cmd run thumbnail:register
```

登録スクリプトは `HKCU:\Software\Classes` に Thumbnail Provider と Preview Handler を登録し、`.aipaint` の既定アプリ関連付けは上書きしない。反映されない場合は Explorer を再起動する。解除する場合は:

```powershell
npm.cmd run thumbnail:unregister
```

## XnView MP プラグイン

XnView MP のブラウザー内で `.aipaint` をサムネイル表示したい場合は、Windows Shell Provider ではなく XnView MP 用の read-only plugin を使う。対象は Windows x86_64 版の XnView MP 1.11.x。プラグインは `.aipaint` の ZIP 内にある `thumbnail.png` だけを読み、ファイルの保存やレイヤー合成は行わない。`thumbnail.png` は保存時に合成結果を最大辺 2048 px 以内に収め、低解像度では等倍、高解像度ほど低い倍率で作る。

```powershell
npm.cmd run xnview-plugin:build
npm.cmd run xnview-plugin:install
```

既定では `C:\Program Files\XnViewMP\plugins\Xaipaint.usr` へコピーする。XnView の外部 I/O plugin は `X` で始まる `.usr` として配置する。通常の PowerShell では書き込み権限がないため、インストールは管理者権限の PowerShell で実行する。別の場所に入れる場合は:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-xnview-aipaint-plugin.ps1 -PluginDir "D:\Apps\XnViewMP\plugins"
```

解除する場合は:

```powershell
npm.cmd run xnview-plugin:uninstall
```

## 使い方

1. 起動したらまず右パネルの **API Key** 欄に `sk-ant-...` を貼る（開発中は Tauri 側で起動中のみ保持、配布 exe では OS の資格情報ストアに保存。localStorage には保存しない）
2. ツールバーでツールを選んで描く。`B` でブラシ、`E` で消しゴム、`G` でバケツ…
3. 困ったら AI パネルでモード・作業段階を選び、必要なら相談を書いて「キャンバスを見てもらう」
4. アドバイスがテキストで、補助線がキャンバスに重なって表示される
5. リファレンスを入れたい場合は AI パネルから画像を追加（複数可）
6. 範囲選択中に「ズームして送る」をオンにすると、その部分だけを送って詳細にコメントしてもらえる
7. 作業の保存は `Ctrl+S` で上書き保存、`Ctrl+Shift+S` で名前を付けて保存（`.aipaint` か `.psd`）。`Ctrl+O` でファイルを開く。Tauri デスクトップ版ならファイルパスを記憶して同じファイルに書き戻す。書き出しを細かく指定したい場合は **エクスポート** ボタンから PNG/JPEG/WebP/.aipaint/.psd を選択。後で続きから描きたい場合は `.aipaint`、他ソフトに持って行く場合は `.psd`
8. AI とテキストで往復したい場合はチャットパネルを使う。送信時にキャンバス画像を添付することも、別ウィンドウとして切り離すこともできる
9. 万が一に備え、ツールバーの 💾 から自動バックアップ間隔を設定しておくと安心

## デフォルトのキー

| アクション | キー |
|---|---|
| ブラシ / 消しゴム / バケツ / スポイト | `B` / `E` / `G` / `I` |
| 範囲選択 / 図形 / 移動 / テキスト | `M` / `U` / `V` / `T` |
| グラデーション / ぼかし | `Shift+G` / `Shift+B` |
| 新規キャンバス / 開く | `Ctrl+N` / `Ctrl+O` |
| 上書き保存 / 名前を付けて保存 | `Ctrl+S` / `Ctrl+Shift+S` |
| 新規レイヤー / タブを閉じる | `Ctrl+Shift+N` / `Ctrl+W` |
| アンドゥ / リドゥ | `Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y` |
| 色調補正 / 全選択 | `Ctrl+U` / `Ctrl+A` |
| ブラシサイズ -/+ | `[` / `]` |
| 手振れ補正 -/+ | `Alt+[` / `Alt+]` |
| 前景/背景色入れ替え | `X` |
| 選択解除 | `Esc` |
| グリッド表示切替 | `Shift+'` |
| ズーム/パン リセット | `0` |
| ズームイン / ズームアウト | `Ctrl+=` / `Ctrl+-` |
| 右回転 / 左回転 (90°) | `Shift+]` / `Shift+[` |
| パン（キャンバスドラッグ移動） | 右クリックドラッグ |

すべて設定パネルからリマップ可能。

## カスタマイズの入口

- **AIモデル設定**: アプリの設定画面から、キャンバス解析・チャット・課題採点ごとにモデル名と `max_tokens` を変更。既定値を変える場合は `src-tauri/src/ai_models.rs`
- **システムプロンプト**: `src/core/ai/prompts.ts` の `systemPromptFor` / `comparisonSystemPrompt` / `chatSystemPrompt`
- **AI 送信画像の上限長辺**: `src/core/aiImagePayload.ts` の `DEFAULT_AI_IMAGE_MAX_EDGE`（`flattenDocumentToBase64ForAI` / `cropDocumentToBase64ForAI` などで既定値として使用）
- **デフォルトキャンバスサイズ / DPI**: `src/types.ts` の `DEFAULT_CANVAS_WIDTH` / `DEFAULT_CANVAS_HEIGHT` / `DEFAULT_DPI`
- **デフォルトショートカット**: `src/core/shortcuts.ts` の `SHORTCUT_ACTIONS`
- **ブラシエンジン**: `src/core/brushEngine.ts`
- **筆圧カーブのプリセット**: `src/core/pressureCurve.ts` の `PRESET_CURVES`
- **自動バックアップ上限**: `src/core/autoBackup.ts` の `MAX_BACKUPS` / `MAX_BACKUP_TOTAL_BYTES`
- **レイヤー保持形式の読み込み上限**: `.aipaint` は `src/core/nativeFormat.ts` の `MAX_AIPAINT_ZIP_FILE_BYTES` / `MAX_AIPAINT_LAYER_PNG_UNCOMPRESSED_BYTES_TOTAL` / `MAX_AIPAINT_DECODED_RGBA_BYTES`、PSD は `src/core/psdFormat.ts` の `MAX_PSD_FILE_BYTES` / `MAX_PSD_DIMENSION`
- **AI ガイドのスタイル**: `src/hooks/useCanvasOverlayRenderer.ts` のオーバーレイ描画

## 開発者向けドキュメント

- [docs/README.md](./docs/README.md): ドキュメント一覧
- [docs/architecture.md](./docs/architecture.md): 実装境界、描画・AI・検証のメモ
- [docs/aipaint-format-v2.md](./docs/aipaint-format-v2.md): `.aipaint v2` の保存形式と読み込み防御仕様

## アイコン差し替え

`src-tauri/icons/` の中身を自前のものに置き換えれば OK。ベースの PNG があるなら:

```powershell
npm run tauri -- icon path/to/source.png
```

で各サイズが自動生成される。

## 既知の制約

- ベクターレイヤーは未実装
- PSD 入出力はラスタライズ済みレイヤー中心。レイヤー効果 / 調整レイヤー / スマートオブジェクト / ベクターマスクは未対応
- KRA など他のレイヤー保持外部形式は未対応（ネイティブ形式は `.aipaint`）
