Third-party license generation
==============================

Run npm ci and fetch the Rust dependencies in each of the three Cargo manifests,
then run:

  node scripts/generate-third-party-notices.mjs
  node scripts/generate-third-party-notices.mjs --check

The script uses package-lock.json plus installed npm runtime packages, and
cargo metadata --locked --offline for x86_64-pc-windows-msvc. It includes Rust
build and dev dependencies as a conservative inventory. These counts do not
mean that every listed package is linked into the final executable.

The generated THIRD_PARTY_NOTICES.txt is included in the app's About dialog.
The original license documents and leading source copyright/license notices
are collected without changing their terms. Repeated documents are stored
once in that file and referenced using a content-derived document ID.

upstream/ contains version-pinned license documents omitted from some original
crate packages, plus the Lucide/Feather license for the adapted inline SVGs.
sources.json records the exact source URL, applicable component versions, and
SHA-256 of every supplement. No personal Git identity or absolute local paths
are recorded in the generated notices.

The five unmodified MPL-2.0 crate archives are preserved in
third-party-sources/. Each archive is checked against the corresponding
Cargo.lock SHA-256, and its source URL appears in the app's notices.

After dependency updates, regenerate and review the notices. Add supplements
for newly introduced packages whose release archives omit licensing files.
If MPL-covered source is modified, also provide the modified source under MPL
and update the descriptions that currently identify it as unmodified.

Source/license inventory is scoped to the Windows target supported by this
release. Re-run and extend the inventory before distributing another target.
