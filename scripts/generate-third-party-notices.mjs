import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const target = "x86_64-pc-windows-msvc";
const publicSource = "https://github.com/hurumoon/ai-paint";
const manifests = [
  ["src-tauri/Cargo.toml", "Windows app (including build/dev dependencies)"],
  ["src-tauri/thumbnail-provider/Cargo.toml", "Windows Shell provider"],
  ["src-tauri/xnview-plugin/Cargo.toml", "XnView plugin"],
];
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const order = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const normalize = (data) =>
  new TextDecoder("utf-8", { fatal: true }).decode(data).replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").trimEnd() + "\n";
const forward = (path) => path.replaceAll("\\", "/");

function filesIn(directory) {
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => order(a.name, b.name))) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "target") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...filesIn(path));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}

function headerNotice(text) {
  const lines = text.slice(0, 65536).split(/\r?\n/);
  const header = [];
  let block = false;
  for (const line of lines) {
    const trim = line.trim();
    if (block) {
      header.push(line);
      if (trim.includes("*/")) block = false;
    } else if (trim.startsWith("/*")) {
      header.push(line);
      block = !trim.includes("*/");
    } else if (/^(?:\/\/|#(?:\s|\())/.test(trim)) {
      header.push(line);
    } else if (!trim || /^(?:["']use strict["'];?|#!)/.test(trim)) {
      header.push("");
    } else {
      break;
    }
  }
  const notice = header.join("\n").trim();
  return /copyright|\([cC]\)\s*\d{4}|SPDX-License-Identifier|This Source Code Form|Permission (?:is|to)/i.test(notice)
    ? notice + "\n"
    : null;
}

const supplementary = JSON.parse(readFileSync(join(root, "licenses/upstream/sources.json"), "utf8"));
for (const source of supplementary) {
  const path = join(root, "licenses/upstream", source.file);
  if (sha256(readFileSync(path)) !== source.sha256) throw new Error(`Supplemental license checksum mismatch: ${source.file}`);
}

const documents = new Map();
function document(text) {
  const normalized = normalize(Buffer.from(text));
  const id = sha256(normalized).slice(0, 16);
  if (documents.has(id) && documents.get(id) !== normalized) throw new Error(`Document ID collision: ${id}`);
  documents.set(id, normalized);
  return id;
}

function notices(component, directory) {
  const entries = [];
  let hasLicense = false;
  for (const path of filesIn(directory)) {
    const file = forward(relative(directory, path));
    if (/^(?:LICENSE|LICENCE|COPYING|NOTICE|UNLICENSE|COPYRIGHT)(?:[._-]|$)/i.test(path.split(/[\\/]/).at(-1))) {
      const text = normalize(readFileSync(path));
      entries.push({ file, document: document(text) });
      if (/^(?:LICENSE|LICENCE|COPYING|UNLICENSE)(?:[._-]|$)/i.test(path.split(/[\\/]/).at(-1))) hasLicense = true;
    } else if (/\.(?:rs|c|cc|cpp|h|s|S|inc|js|ts|tsx|mjs|cjs|pl|py)$/.test(extname(path))) {
      const data = readFileSync(path);
      if (data.subarray(0, 8192).includes(0)) continue;
      const header = headerNotice(data.toString("utf8"));
      if (header) entries.push({ file: `${file} (source header)`, document: document(header) });
    }
  }
  for (const source of supplementary.filter((item) => item.components.includes(component))) {
    entries.push({
      file: `licenses/upstream/${source.file} (${source.url}${source.archive_path ? `#${source.archive_path}` : ""})`,
      document: document(normalize(readFileSync(join(root, "licenses/upstream", source.file)))),
    });
    if (/LICENSE|MPL-2\.0/i.test(source.file)) hasLicense = true;
  }
  if (!hasLicense) throw new Error(`No license document for ${component}; add a version-pinned supplement in licenses/upstream.`);
  return entries;
}

function selectedLicense(expression) {
  // An explicit OR (or Cargo's historical slash notation) offers a choice.
  // Retain every bundled notice regardless of the choice, including AND terms.
  if (expression === "BSD-3-Clause/MIT") return "BSD-3-Clause AND MIT (both notices retained)";
  if (expression.includes(" AND ")) {
    return expression.replace(/\(([^()]+\s+OR\s+[^()]+)\)/g, (_match, choices) => selectedLicense(choices));
  }
  const choices = expression.split(/\s+OR\s+|\s*\/\s*/);
  if (choices.length === 1) return expression;
  return choices.includes("MIT") ? "MIT" : choices[0];
}

const components = [];
const npmLock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
for (const [path, pkg] of Object.entries(npmLock.packages).sort(([a], [b]) => order(a, b))) {
  if (!path || pkg.dev) continue;
  const directory = join(root, path);
  const installed = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
  if (installed.version !== pkg.version) throw new Error(`Run npm ci: ${path} does not match package-lock.json`);
  const id = `npm:${installed.name}@${pkg.version}`;
  const license = pkg.license || installed.license;
  if (!license || typeof license !== "string") throw new Error(`Missing SPDX license for ${id}`);
  components.push({
    id,
    name: installed.name,
    version: pkg.version,
    license,
    selected: selectedLicense(license),
    scopes: ["Frontend runtime dependency"],
    source: `https://registry.npmjs.org/${installed.name}/-/${installed.name.split("/").at(-1)}-${pkg.version}.tgz`,
    notices: notices(id, directory),
  });
}

const cargo = new Map();
const checksums = new Map();
for (const [manifest, scope] of manifests) {
  const result = spawnSync("cargo", ["metadata", "--locked", "--offline", "--filter-platform", target, "--format-version", "1", "--manifest-path", manifest], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) throw new Error(`cargo metadata failed for ${manifest}. Run cargo fetch --locked --manifest-path ${manifest} first.\n${result.stderr || result.error}`);
  const metadata = JSON.parse(result.stdout);
  const included = new Set(metadata.resolve.nodes.map((node) => node.id));
  for (const pkg of metadata.packages) {
    if (!pkg.source || !included.has(pkg.id)) continue;
    if (!pkg.source.startsWith("registry+")) throw new Error(`Unsupported non-registry dependency: ${pkg.name}`);
    const id = `cargo:${pkg.name}@${pkg.version}`;
    const existing = cargo.get(id);
    if (existing) existing.scopes.push(scope);
    else {
      if (!pkg.license) throw new Error(`Missing SPDX license: ${id}`);
      cargo.set(id, {
        id,
        name: pkg.name,
        version: pkg.version,
        license: pkg.license,
        selected: selectedLicense(pkg.license),
        scopes: [scope],
        source: `https://crates.io/api/v1/crates/${pkg.name}/${pkg.version}/download`,
        directory: dirname(pkg.manifest_path),
      });
    }
  }
  const lock = readFileSync(join(root, dirname(manifest), "Cargo.lock"), "utf8");
  for (const entry of lock.split("[[package]]").slice(1)) {
    const name = entry.match(/^name = "([^"]+)"/m)?.[1];
    const version = entry.match(/^version = "([^"]+)"/m)?.[1];
    const checksum = entry.match(/^checksum = "([a-f0-9]{64})"/m)?.[1];
    if (checksum) {
      const id = `cargo:${name}@${version}`;
      if (checksums.has(id) && checksums.get(id) !== checksum) throw new Error(`Conflicting checksums: ${id}`);
      checksums.set(id, checksum);
    }
  }
}

const sourceArchives = [];
for (const pkg of [...cargo.values()].sort((a, b) => order(a.id, b.id))) {
  const { directory, ...component } = pkg;
  component.notices = notices(component.id, directory);
  if (component.license === "MPL-2.0") {
    const file = `${component.name}-${component.version}.crate`;
    const relativePath = `third-party-sources/${file}`;
    const destination = join(root, relativePath);
    const registrySource = dirname(directory);
    const registry = dirname(dirname(registrySource));
    const cache = join(registry, "cache", registrySource.split(/[\\/]/).at(-1), file);
    const data = readFileSync(existsSync(destination) ? destination : cache);
    const checksum = checksums.get(component.id);
    if (!checksum || sha256(data) !== checksum) throw new Error(`MPL source archive checksum mismatch: ${file}`);
    if (!check) {
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, data);
    } else if (!existsSync(destination)) {
      throw new Error(`MPL source archive missing: ${relativePath}`);
    }
    component.sourceArchive = `${publicSource}/blob/main/${relativePath}`;
    sourceArchives.push({ ...component, file, checksum });
  }
  components.push(component);
}

const lucide = supplementary.find((item) => item.components.includes("icons:lucide-feather"));
components.push({
  id: "icons:lucide-feather",
  name: "Lucide / Feather",
  version: "adapted SVG paths",
  license: "ISC AND MIT (Feather-derived icons)",
  selected: "ISC AND MIT (Feather-derived icons)",
  scopes: ["Modified inline SVG icons in src/ui/Icons.tsx"],
  source: "https://lucide.dev/license",
  notices: [{ file: `licenses/upstream/${lucide.file}`, document: document(normalize(readFileSync(join(root, "licenses/upstream", lucide.file)))) }],
});
components.sort((a, b) => order(a.id, b.id));

const lines = [
  "AI Paint — Third-Party Notices",
  "==============================",
  "",
  "AI Paint 本体は MIT License で提供します。以下の第三者コード・素材には、それぞれのライセンスが適用されます。",
  "本書はインストールされた固定バージョンから生成しています。フロントエンド実行時依存、Windows向けRust依存（ビルド・開発用を含む）、改変したLucide / Featherアイコンを掲載しています。",
  "依存一覧には、最適化や機能選択により配布バイナリに含まれないコードも含まれます。npmの開発ツール自体は配布アプリに同梱しません。",
  "OR式では Selected license に記載した条件を選択します。AND式と元の著作権表示は維持します。選択しなかった条件の文書も参考として保持しています。",
  "同一文書は document ID でまとめています。各コンポーネントの Documents を参照してください。",
  "",
  "Mozilla Public License 2.0 — Source Availability",
  "----------------------------------------------",
  "MPL-2.0対象の未改変ソースは、下記公開リポジトリの third-party-sources/ に元の.crateアーカイブとして収録しています。",
  "各アーカイブはCargo.lockのSHA-256と照合済みです。MPL対象部分への変更を配布する場合、その変更したソースもMPLの条件で入手できるようにしてください。",
  `${publicSource}/tree/main/third-party-sources`,
  "",
  "Components",
  "----------",
];
for (const pkg of components) {
  lines.push("", `${pkg.id}`, `License expression: ${pkg.license}`, `Selected license: ${pkg.selected}`, `Scope: ${pkg.scopes.join("; ")}`, `Source: ${pkg.source}`);
  if (pkg.sourceArchive) lines.push(`Bundled MPL source: ${pkg.sourceArchive}`);
  lines.push("Documents:");
  for (const entry of pkg.notices) lines.push(`  ${entry.document}  ${entry.file}`);
}
lines.push("", "License and attribution documents", "=================================");
for (const [id, text] of [...documents.entries()].sort(([a], [b]) => order(a, b))) {
  lines.push("", `----- BEGIN DOCUMENT ${id} -----`, text.trimEnd(), `----- END DOCUMENT ${id} -----`);
}

function output(path, text) {
  const destination = join(root, path);
  const normalized = text.replace(/\r\n/g, "\n").trimEnd() + "\n";
  if (check) {
    if (!existsSync(destination) || readFileSync(destination, "utf8") !== normalized) throw new Error(`Generated file is out of date: ${path}`);
  } else {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, normalized, "utf8");
  }
}

output("THIRD_PARTY_NOTICES.txt", lines.join("\n"));
output("third-party-sources/SHA256SUMS", sourceArchives.map((pkg) => `${pkg.checksum}  ${pkg.file}`).join("\n"));
output("third-party-sources/README.md", [
  "# MPL対象ソース",
  "",
  "AI PaintのWindows向け依存に含まれるMPL-2.0対象コードの、未改変の元ソースを収録しています。`.crate`はgzip圧縮されたtarアーカイブです。`tar -xzf ファイル名.crate`などで展開できます。",
  "",
  "アーカイブは各Cargo.lockのSHA-256と一致します。チェックサムは[SHA256SUMS](./SHA256SUMS)、ライセンス本文と著作権表示は[THIRD_PARTY_NOTICES.txt](../THIRD_PARTY_NOTICES.txt)を参照してください。",
  "",
  ...sourceArchives.flatMap((pkg) => [`- [${pkg.name} ${pkg.version}](./${pkg.file}) — [crates.ioの元ソース](${pkg.source})`]),
  "",
  "元のMPLコードはMPL-2.0の条件で提供されます。AI Paint本体のMIT Licenseは、これらのソースのライセンスを変更するものではありません。",
  "",
  "依存バージョンを更新した場合は`npm run licenses:generate`で表示とアーカイブを更新してください。MPL対象コードを変更して配布する場合は、その変更後のソースも入手できるようにし、生成スクリプトの未改変ソースという説明も調整してください。",
].join("\n"));
console.log(`${check ? "Verified" : "Generated"} notices: ${components.length} components, ${documents.size} unique documents, ${sourceArchives.length} checksum-verified MPL source archives.`);
