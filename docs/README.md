# ai-paint ドキュメント

このディレクトリは、README に載せると長くなりすぎる開発者向け情報を置く。

## 一覧

- [architecture.md](./architecture.md): React / Tauri / 描画エンジンの現在の責務分離。
- [aipaint-format-v2.md](./aipaint-format-v2.md): `.aipaint v2` の保存形式と読み込み防御仕様。
- [heavy-operation-locks.md](./heavy-operation-locks.md): 保存、描画、AI 送信、PSD 読み込み、自動バックアップの排他仕様。
- [ai-drawing-playback-plan.md](./ai-drawing-playback-plan.md): GPT 対応、全機能の API 化、工程に沿って反復する作業 Agent の開発計画。
- [paint-api.md](./paint-api.md): AIドロー（β版）の接続、共通APIの対応表、保存・再生の仕様。

## 更新方針

- ユーザー向けの機能説明、セットアップ、基本操作はルートの [README.md](../README.md) に置く。
- 実装境界、主要ファイル、検証手順は `docs/architecture.md` に置く。
