# Tauri IPC 実測

Tauri の実 IPC 経路で、JSON 引数と raw body の往復時間を測るための開発用診断。

## 実行方法

1. `npm run tauri -- dev` で Tauri 開発版を起動する。
2. 起動したアプリ上で `Ctrl+Alt+Shift+I` を押す。
3. 画面上に表示される CSV 形式の結果を確認する。

`?measureTauriIpc` が付いた URL で起動した場合も自動実行する。通常のブラウザ版では実 Tauri IPC ではないため、プローブはエラーを表示する。

結果をファイルに回収したい場合は、Tauri dev 起動時に次の 2 つの環境変数を指定する。

- `VITE_AI_PAINT_MEASURE_TAURI_IPC=1`
- `AI_PAINT_TAURI_IPC_REPORT_PATH=<出力先ファイル>`

この場合、起動後に自動で測定し、CSV と JSON を指定ファイルに保存する。

## 測定内容

- `json echo`: 指定サイズの JSON 文字列を Tauri command に渡し、同じ文字列を返す。
- `raw sink`: `Uint8Array` を raw body として Tauri command に渡し、Rust 側で受け取ったバイト数だけ返す。
- `raw roundtrip`: `Uint8Array` を raw body として渡し、Rust 側から `tauri::ipc::Response` で同じバイト列を返す。

RAW は 1KB / 64KB / 1MB / 4MB / 8MB / 16MB / 32MB を測る。大きい payload が環境上限などで失敗した場合は、そのケースを `ERROR` 行として残し、他のケースの測定は継続する。

各ケースは 1 回ウォームアップしてから 7 回測り、`min` / `avg` / `p95` / `max` を出す。

## 注意

- 測定用 command は `debug_assertions` の時だけ登録する。配布用 build には載せない。
- 結果は WebView2、PC の負荷、dev build の状態に依存するため、性能判断には同じ環境で複数回測った値を使う。
