// UIスクショ一括撮影スクリプト
// 使い方: node scripts/capture-ui.mjs
// 前提: dev サーバーが http://localhost:1420 で起動していること
//       npx playwright install chromium 済みであること

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const URL = process.env.URL ?? "http://localhost:1420";
const OUT_DIR = join(process.cwd(), "ui-snapshots");

await mkdir(OUT_DIR, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();

const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
});

console.log(`[capture] loading ${URL} ...`);
await page.goto(URL, { waitUntil: "networkidle" });

// 初期化（ストレージにダイアログを開きっぱなしの状態が残っていない前提でロード）。
await page.waitForSelector(".toolbar", { timeout: 15000 });

async function shot(name) {
  const file = join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`  saved: ${file}`);
}

// オーバーレイ系（ポップオーバー/ダイアログ）を全部閉じる。
// popover-backdrop はクリックで閉じる仕様。
// CanvasSettings 等の dialog は内部で `if (!open) return null` するため、
// onClose 後の React 反映を必ず待たないと次クリックでまた intercept される。
async function closeAll() {
  for (let i = 0; i < 10; i++) {
    const count = await page.locator(".popover-backdrop").count();
    if (count === 0) return;
    await page
      .locator(".popover-backdrop")
      .first()
      .click({ force: true })
      .catch(() => {});
    // React 反映後に backdrop が減るのを待つ。ダメなら ESC で押し込む。
    const closed = await page
      .waitForFunction(
        (prev) => document.querySelectorAll(".popover-backdrop").length < prev,
        count,
        { timeout: 2000 }
      )
      .then(() => true)
      .catch(() => false);
    if (!closed) {
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(200);
    }
  }
}

// 「backdrop が完全に消えた」状態をクリック前に確認するユーティリティ。
async function waitForNoBackdrop() {
  await page
    .waitForFunction(
      () => document.querySelectorAll(".popover-backdrop").length === 0,
      null,
      { timeout: 5000 }
    )
    .catch(() => {});
}

// 1) 初期状態
await shot("00-initial");

// 2) 各ツール選択時のオプションパネル
// Toolbar の各ボタンは title="ブラシ" 等。一度クリックでツール選択 + オプションパネル展開。
// 同じツールを再クリックするとオプション閉じるので、ツールごとに「閉じる→クリック」する。
const tools = [
  ["ブラシ", "tool-brush"],
  ["消しゴム", "tool-eraser"],
  ["バケツ", "tool-bucket"],
  ["スポイト", "tool-eyedropper"],
  ["範囲指定", "tool-select"],
  ["ぼかし", "tool-blur"],
  ["グラデーション", "tool-gradient"],
  ["図形", "tool-shape"],
  ["テキスト", "tool-text"],
  ["移動", "tool-move"],
];
for (const [label, name] of tools) {
  // 一旦別ツール (ブラシ以外なら移動、ブラシなら消しゴム) を経由しオプション開閉状態を確実にする
  await page.locator(`.toolbar button[title="${label}"]`).click();
  await page.waitForTimeout(200);
  await shot(`01-${name}`);
}

// 3) ヘッダーのダイアログ類を 1つずつ
const dialogs = [
  ["設定", "10-canvas-settings"],
  ["新規キャンバス (Ctrl+N)", "11-new-canvas"],
  ["色調補正 (Ctrl+U)", "12-color-adjust"],
  ["ウィンドウ配置設定", "13-layout-settings"],
  ["ショートカット設定", "14-shortcut-settings"],
  ["エクスポート", "15-export"],
  ["自動バックアップ", "16-backup"],
];
// ダイアログ閉じきれずに次のクリックがintercept される問題を避けるため、
// 各ダイアログ撮影前にページをリロードして状態をまっさらに戻す。
for (const [title, name] of dialogs) {
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForSelector(".toolbar", { timeout: 15000 });
  const btn = page.locator(`button[title="${title}"]`).first();
  if ((await btn.count()) === 0) {
    console.warn(`  skip (button not found): ${title}`);
    continue;
  }
  await btn.click({ timeout: 10000 });
  await page.waitForTimeout(500);
  await shot(name);
}

// 4) テーマ切替（ダーク/ライト）後の初期状態
// テーマトグルは「太陽/月」のいずれかが title なはず。両方試して当たれば押す。
for (const t of ["ダークモード", "ライトモード", "テーマ切替"]) {
  const btn = page.locator(`button[title="${t}"]`).first();
  if ((await btn.count()) > 0) {
    await btn.click();
    await page.waitForTimeout(250);
    await shot(`20-theme-${t}`);
  }
}

console.log("[capture] done.");
if (errors.length > 0) {
  console.log(`[capture] page errors (${errors.length}):`);
  for (const e of errors.slice(0, 20)) console.log("  -", e);
}

await browser.close();
