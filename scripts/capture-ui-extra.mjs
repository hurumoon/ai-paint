// 補足のUIスナップショット。レビュー目的で右パネル全体、テーマ、ホバー状態などを撮る。
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const URL = process.env.URL ?? "http://localhost:1420";
const OUT_DIR = join(process.cwd(), "ui-snapshots-extra");
await mkdir(OUT_DIR, { recursive: true });

const browser = await chromium.launch();

async function newPage(width = 1600, height = 1000) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await p.goto(URL, { waitUntil: "networkidle" });
  await p.waitForSelector(".toolbar", { timeout: 15000 });
  return p;
}

async function shot(page, name, opts = {}) {
  const file = join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false, ...opts });
  console.log(`  saved: ${file}`);
}

// 1) 右パネル全体（fullPage）
{
  const page = await newPage();
  // 右パネルだけスクロールして AI 周り全体を見たいので、CSS で min-height を一旦伸ばす。
  await page.addStyleTag({
    content: `.layout-right { overflow: visible !important; height: auto !important; }
              .app { height: auto !important; min-height: 100vh; overflow: visible !important; }
              html, body { overflow: visible !important; height: auto !important; }`,
  });
  await shot(page, "right-panel-full", { fullPage: true });
  await page.context().close();
}

// 2) 小さい画面（1280x800）でレイアウトがどう壊れるか
{
  const page = await newPage(1280, 800);
  await shot(page, "small-1280x800");
  await page.context().close();
}

// 3) もっと小さい（1024x720, ノートPC低解像度想定）
{
  const page = await newPage(1024, 720);
  await shot(page, "tiny-1024x720");
  await page.context().close();
}

// 4) ナビゲーターを左下に移動した状態（被って見える問題の検証用）
{
  const page = await newPage();
  const nav = page.locator(".popover, [class*='navigator']").first();
  // ドラッグの代わりに、ナビゲーター x ボタンで閉じた状態も撮る
  await shot(page, "navigator-default");
  const closeBtn = page.locator('text=ナビゲーター').first();
  if (await closeBtn.count() > 0) {
    // ×ボタンを探して押す
    const x = page.locator('.popover button:has-text("×"), button[aria-label="閉じる"]').first();
    if (await x.count() > 0) await x.click().catch(() => {});
    await page.waitForTimeout(200);
  }
  await shot(page, "navigator-closed");
  await page.context().close();
}

// 5) ダークモード
{
  const page = await newPage();
  for (const t of ["ダークモード", "ライトモード", "テーマ切替"]) {
    const btn = page.locator(`button[title="${t}"]`).first();
    if ((await btn.count()) > 0) {
      await btn.click();
      await page.waitForTimeout(300);
    }
  }
  await shot(page, "dark-initial");
  // ブラシツールでパネル開く
  await page.locator('.toolbar button[title="ブラシ"]').click();
  await page.waitForTimeout(200);
  await shot(page, "dark-brush");
  await page.context().close();
}

// 6) AIパネルにAPIキーを「ダミー」入れた直後（チャットエリアが活性化されるか）
{
  const page = await newPage();
  const input = page.locator('input[placeholder*="API"], input[type="password"]').first();
  if (await input.count() > 0) {
    await input.fill("sk-ant-test-dummy-key-1234567890");
    await page.waitForTimeout(300);
    await shot(page, "ai-with-key");
  }
  await page.context().close();
}

await browser.close();
console.log("done.");
