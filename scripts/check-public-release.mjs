import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const git = (...args) => execFileSync("git", args, {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
}).trimEnd();
const problems = [];
const allowedEmail = /^[0-9]+\+[a-z0-9-]+@users\.noreply\.github\.com$/i;
const commits = git("log", "--all", "--format=%H%x09%ae%x09%ce").split("\n");
for (const entry of commits) {
  const [sha, author, committer] = entry.split("\t");
  if (!allowedEmail.test(author) || !allowedEmail.test(committer)) {
    problems.push(`${sha.slice(0, 12)}: コミットのメールがGitHubの非公開用アドレスではありません`);
  }
}
if (process.argv.includes("--initial-publication") && commits.length !== 1) {
  problems.push("初回公開には過去の履歴を引き継がない1コミットのリポジトリが必要です");
}
if (git("status", "--porcelain")) {
  problems.push("未コミットの変更があります。確認対象をコミットした状態で実行してください");
}

const paths = git("ls-files", "-z").split("\0").filter(Boolean);
const required = ["LICENSE", "THIRD_PARTY_NOTICES.txt", "third-party-sources/README.md"];
for (const path of required) {
  if (!paths.includes(path)) problems.push(`${path}: 公開用の表示・ソース案内がありません`);
}
const rules = [
  ["秘密鍵", /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/g],
  ["認証情報を含むURL", /https?:\/\/[^\s/:"'<>]{2,}:[^\s/@"'<>]{5,}@/g],
  ["APIトークン", /\b(?:sk-(?:ant-|proj-|svcacct-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}|xox[baprs]-[A-Za-z0-9-]{16,}|AIza[0-9A-Za-z_-]{30,}|AKIA[0-9A-Z]{16})\b/g],
];
const privateEmail = process.env.AI_PAINT_PRIVATE_EMAIL?.trim();
if (process.argv.includes("--initial-publication") && !privateEmail) {
  problems.push("初回公開ではAI_PAINT_PRIVATE_EMAILで非公開メールの検査対象を指定してください");
}
let textFiles = 0;
for (const path of paths) {
  if (/(^|\/)(?:\.env(?:\.|$)|settings\.local\.json$)|\.(?:pfx|p12|pem|key)$/i.test(path) && !path.endsWith(".env.example")) {
    problems.push(`${path}: 公開対象にローカル設定・秘密情報ファイルが含まれています`);
  }
  if (path === "docs/ai-drawing-assets/target-reference.png") {
    problems.push(`${path}: 許諾未確認の参考画像が含まれています`);
  }
  const bytes = readFileSync(resolve(root, path));
  const text = bytes.toString("utf8");
  if (privateEmail && text.toLowerCase().includes(privateEmail.toLowerCase())) {
    problems.push(`${path}: 非公開メールが含まれています`);
  }
  if (bytes.subarray(0, 8192).includes(0)) continue;
  textFiles += 1;
  for (const [kind, pattern] of rules) {
    for (const match of text.matchAll(pattern)) {
      if (kind === "APIトークン" && match[0] === "sk-ant-test-dummy-key-1234567890") continue;
      const line = text.slice(0, match.index).split("\n").length;
      problems.push(`${path}:${line}: ${kind}らしい値があります`);
    }
  }
}
if (problems.length) {
  console.error(problems.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`公開前チェック成功: ${commits.length}コミット、${paths.length}ファイル（テキスト${textFiles}）。作者・コミッターは非公開用メール、主要トークン形式の混入なし。`);
  console.log(privateEmail ? "指定した非公開メールの本文への混入なし。" : "本人メールの本文検査は未実施です。AI_PAINT_PRIVATE_EMAILを指定すると検査できます。");
}
