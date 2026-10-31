# MPL対象ソース

AI PaintのWindows向け依存に含まれるMPL-2.0対象コードの、未改変の元ソースを収録しています。`.crate`はgzip圧縮されたtarアーカイブです。`tar -xzf ファイル名.crate`などで展開できます。

アーカイブは各Cargo.lockのSHA-256と一致します。チェックサムは[SHA256SUMS](./SHA256SUMS)、ライセンス本文と著作権表示は[THIRD_PARTY_NOTICES.txt](../THIRD_PARTY_NOTICES.txt)を参照してください。

- [cssparser-macros 0.6.1](./cssparser-macros-0.6.1.crate) — [crates.ioの元ソース](https://crates.io/api/v1/crates/cssparser-macros/0.6.1/download)
- [cssparser 0.36.0](./cssparser-0.36.0.crate) — [crates.ioの元ソース](https://crates.io/api/v1/crates/cssparser/0.36.0/download)
- [dtoa-short 0.3.5](./dtoa-short-0.3.5.crate) — [crates.ioの元ソース](https://crates.io/api/v1/crates/dtoa-short/0.3.5/download)
- [option-ext 0.2.0](./option-ext-0.2.0.crate) — [crates.ioの元ソース](https://crates.io/api/v1/crates/option-ext/0.2.0/download)
- [selectors 0.36.1](./selectors-0.36.1.crate) — [crates.ioの元ソース](https://crates.io/api/v1/crates/selectors/0.36.1/download)

元のMPLコードはMPL-2.0の条件で提供されます。AI Paint本体のMIT Licenseは、これらのソースのライセンスを変更するものではありません。

依存バージョンを更新した場合は`npm run licenses:generate`で表示とアーカイブを更新してください。MPL対象コードを変更して配布する場合は、その変更後のソースも入手できるようにし、生成スクリプトの未改変ソースという説明も調整してください。
