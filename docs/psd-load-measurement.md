# PSD ロード計測

PSD を開くと、直近の読み込み計測が `window.__AI_PAINT_LAST_PSD_LOAD_TIMING__` に保存される。過去分は最大 20 件まで `window.__AI_PAINT_PSD_LOAD_TIMINGS__` に残る。

Tauri 開発版または `?measurePsdLoad` 付き URL では、読み込み完了時に dev console へ概要も出力する。

## 主な項目

- `nativeRead.selectedToFirstChunkMs`: ファイル選択後、最初の native read chunk が返るまで。
- `nativeRead.allChunksReadMs`: native read loop 開始から EOF chunk 到着まで。
- `nativeRead.fileConstructionMs`: native chunk 配列から `File` を作る時間。
- `timings.headerPreflightMs`: 先頭 26 byte の PSD ヘッダーから寸法上限を確認する時間。全ファイル読込より前に実行する。
- `timings.fileArrayBufferMs`: `File.arrayBuffer()` の時間。
- `timings.metadataPreflightMs`: レイヤー画像を展開せず、レイヤー数・bbox・デコード後メモリ量を確認する時間。
- `timings.readPsdMs`: 安全性確認後に圧縮レイヤーデータを raw のまま参照する `ag-psd` の `readPsd()` 本体。
- `timings.walkPsdChildrenMs`: PSD children をアプリのレイヤー入力へ変換する時間。
- `timings.layerDecodeMs`: 事前検証後、レイヤーを一枚ずつ画像へデコードする時間。
- `timings.bboxCanvasMs`: `walkPsdChildren` 内の bbox canvas 化に使った時間。
- `timings.docResizeMs`: 既存 `PaintDocument` を PSD サイズへ変更する時間。
- `timings.replaceLayersFromCanvasMs`: `PaintDocument.replaceLayersFromCanvas()` の時間。
- `timings.firstPaintWaitMs`: doc 差し替え後、次の描画フレームを待った時間。
