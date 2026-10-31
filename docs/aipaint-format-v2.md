# .aipaint v2 Format

`.aipaint` は AI Paint の正本形式。PSD 互換ではなく、アプリ内部の
`PaintDocument` / `TileStore` / deferred layer へ安全かつ高速に戻すことを優先する。

## Container

- ZIP コンテナを使う。
- 必須 entry は `manifest.json`。
- レイヤー画像は `layers/layer-000001.png` 形式の PNG。
- `thumbnail.png` は任意。保存実装は合成結果を最大辺 2048 px 以内に収め、
  それ以下の解像度では等倍の PNG を埋め込む。
- 未知 entry と manifest 未参照 PNG は読み込まない。
- v1 は読み込み互換のみ維持し、新規保存は v2 を既定にする。

## 任意の制作記録拡張

作業Agentの記録がある場合、manifestへ `"agent": { "version": 1, "file": "agent/session.json" }` を追加する。記録には指示・工程・モデル名・使用量・操作ログ・再生用PNG画像を含む。キーやモデル通信の継続情報は含めない。

`agent/session.json` は展開後72MiB以下。指定パス、バージョン、重複ZIP entry、セッションの型・参照・画像量を確認してからドキュメントへ適用する。画像の上限は180枚・1枚12MiB・合計48MiB。実行中の記録は一時停止として読込む。拡張がないファイルでは古い制作記録を消去する。

形式バージョンはv2を維持する。旧版でも絵は開けるが、旧版からの再保存ではこの拡張を失う。再生と再開の詳細は[描画API](./paint-api.md)を参照。

## Limits

- `maxZipFileBytes`: `.aipaint` ファイル全体。初期値 500 MiB。
- `maxManifestBytes`: `manifest.json` の ZIP 展開後サイズ。初期値 2 MiB。
- `maxLayerPngBytes`: 参照 PNG 1 個の ZIP 展開後サイズ。初期値 128 MiB。
- `maxLayerPngUncompressedBytesTotal`: manifest が参照する layer PNG の ZIP 展開後サイズ合計。初期値 500 MiB。
- `maxDecodedRgbaBytes`: `sum(bounds.width * bounds.height * 4)`。初期値 2 GiB。
- キャンバス辺長: 1..16384 px。
- レイヤー数: 1..1024。
- グループ深さ: 64 以内。
- DPI: 1..2400。
- テキスト本文: 200000 文字以内。

ZIP 展開後 PNG サイズと PNG デコード後 RGBA サイズは別の上限として扱う。

## Manifest

```json
{
  "magic": "aipaint-v2",
  "version": 2,
  "width": 1024,
  "height": 768,
  "dpi": 96,
  "activeLayerId": "layer-1",
  "layers": []
}
```

- `magic` は `aipaint-v2`。
- `version` は `2`。
- `width` / `height` は整数。
- `dpi` は整数。
- `activeLayerId` は存在する layer id。
- `layers` は下から上の順に並べる。

## Layer Schema

共通フィールド:

- `id`: 非空文字列。manifest 内でユニーク。
- `name`: 文字列。
- `kind`: `raster` / `text` / `group`。
- `visible`: boolean。
- `opacity`: 0..1。
- `blendMode`: AI Paint の既存 enum のみ。
- `locked`: boolean。
- `transparentPixelLock`: boolean。省略時 false。
- `parentId`: 省略可。指定する場合は存在する `group` の id。
- `clippingMask`: boolean。省略時 false。

構造制約:

- group 以外を parent にできない。
- parent 循環は禁止。
- グループ深さは 64 以内。
- 保存時は各 group を子より前に置き、全子孫を連続させる。
- 読み込み時は、グラフとして有効な非正規順も元のトップレベル順・兄弟順を保つ安定 DFS でこの順序へ正規化する。
- 未知フィールドは無視してよい。
- 既知フィールドの型または値が不正なら拒否する。

画像を持つ `raster` / `text`:

```json
{
  "id": "layer-1",
  "name": "線画",
  "kind": "raster",
  "visible": true,
  "opacity": 1,
  "blendMode": "normal",
  "locked": false,
  "bounds": { "x": 120, "y": 80, "width": 640, "height": 480 },
  "file": "layers/layer-000001.png"
}
```

- `file` は `layers/layer-000001.png` 形式のみ。
- `../`、絶対パス、`\`、重複 file は禁止。
- `bounds` は整数で、正のサイズかつ doc 範囲内。
- `empty: true` の場合は `file` / `bounds` を持ってはならない。
- `empty` が true でない `raster` / `text` は `file` / `bounds` 必須。
- PNG の IHDR 寸法は `bounds.width` / `bounds.height` と完全一致すること。

`group`:

- `file` / `bounds` / `empty` を持っていたら不正。
- `collapsed` は boolean。省略時 false。

## Text Layer

`text` layer は表示用 PNG と編集用情報を両方保存する。

- 保存 PNG は表示正本。
- `text` 情報は編集用正本。
- 読み込み直後は PNG で見た目を維持する。
- 編集操作が入った時点で `text` 情報から再ラスタライズする。
- フォント環境差などによる再ラスタライズ後の見た目差異は許容する。

保存する編集情報:

- `text`
- `fontFamily`
- `fontSize`
- `color`
- `bold`
- `italic`
- `align`
- `x`
- `y`
- `maxWidth`
- `lineHeight`

## Load Order

1. `maxZipFileBytes` を確認する。
2. `manifest.json` だけを読む。
3. manifest schema を検証する。
4. manifest が参照する layer PNG だけを読む。
5. PNG signature / IHDR / width / height をデコード前に検査する。
6. PNG を decode する。
7. すべての検証と decode が通った後に doc へ一括反映する。

失敗時は既存 doc を変更しない。

## Save Validation

新規保存は v2 manifest を生成した後、ZIP 作成前に同じ schema と manifest / layer PNG budget を検証する。ZIP 作成後は archive 全体サイズを検証する。

- 保存した `.aipaint` は同じ実装で読み込める制約を満たすこと。
- `maxLayerPngBytes` / `maxLayerPngUncompressedBytesTotal` / `maxDecodedRgbaBytes` を保存時にも超えてはならない。
- 生成した PNG の signature / IHDR / width / height は manifest の `bounds` と一致すること。
- bbox 抽出のために doc サイズ全体を一度に RGBA 化しない。必要な場合はチャンク単位で alpha を走査する。

## Out Of Scope For Initial v2

- Central directory レベルの duplicate entry 厳密検出。
- ZIP 読み込み専用の独自実装。
- 別 ZIP ライブラリ検討。
- Undo/Redo 履歴、選択範囲、ビュー状態、AI ガイド、チャット履歴、自動バックアップ一覧、タイムラプスの保存。
