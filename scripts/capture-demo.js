/**
 * README用デモ動画・スクリーンショットの自動撮影
 *
 * 使い方:
 *   node scripts/capture-demo.js
 *
 * 出力:
 *   screenshots/analysis.png   — 分析結果
 *   screenshots/rehearsal.png  — ロープレ + フィードバック
 *   screenshots/settings.png   — 設定モーダル
 *   screenshots/demo.webm      — 全フロー動画
 *
 * 前提: npx playwright install chromium
 */
const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");

const PUBLIC_DIR = path.join(__dirname, "..", "public");
const SCREENSHOTS_DIR = path.join(__dirname, "..", "screenshots");
const APP_JS_PATH = path.join(PUBLIC_DIR, "app.js");

// スクショディレクトリを用意
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

/** 簡易静的ファイルサーバー */
function startStaticServer(port = 3099) {
  const mimeTypes = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".png": "image/png",
    ".json": "application/json",
  };

  const server = http.createServer((req, res) => {
    let filePath = path.join(PUBLIC_DIR, req.url === "/" ? "index.html" : req.url.split("?")[0]);
    const ext = path.extname(filePath);
    const mime = mimeTypes[ext] || "application/octet-stream";

    if (fs.existsSync(filePath)) {
      res.writeHead(200, { "Content-Type": mime });
      fs.createReadStream(filePath).pipe(res);
    } else {
      res.writeHead(404);
      res.end("Not Found");
    }
  });

  return new Promise((resolve) => {
    server.listen(port, () => {
      console.log(`静的サーバー起動: http://localhost:${port}`);
      resolve(server);
    });
  });
}

async function wait(page, ms = 800) {
  await page.waitForTimeout(ms);
}

async function capture() {
  // app.js を一時的にデモモードに切り替え
  const originalAppJs = fs.readFileSync(APP_JS_PATH, "utf-8");
  const demoAppJs = originalAppJs.replace('const MODE = "live"', 'const MODE = "demo"');
  fs.writeFileSync(APP_JS_PATH, demoAppJs, "utf-8");
  console.log("MODE → demo に切り替え");

  const server = await startStaticServer();

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: {
      dir: SCREENSHOTS_DIR,
      size: { width: 1280, height: 800 },
    },
  });

  // ダーク背景でフラッシュ防止
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setDefaultBackgroundColorOverride", {
    color: { r: 10, g: 10, b: 18, a: 1 },
  });

  try {
    await page.goto("http://localhost:3099", { waitUntil: "networkidle" });
    await wait(page, 1000);

    // === 分析実行 ===
    await page.fill("#company", "SmartHR");
    await wait(page, 500);
    await page.click("#analyze-btn");
    console.log("分析中...");

    // ローディング → 結果表示を待つ
    await page.waitForSelector(".company-name", { timeout: 10000 });
    await wait(page, 2500); // カードアニメーション + 分析結果を見せる

    // サイドバー（分析カード）だけ撮影
    console.log("分析結果を撮影");
    const sidebar = await page.locator(".sidebar");
    await sidebar.screenshot({ path: path.join(SCREENSHOTS_DIR, "analysis.png") });

    // === ロープレ（左メインに自動開始） ===
    // SCAN後に自動でチャットが左メインに表示される
    await page.waitForSelector(".chat-customer", { timeout: 10000 });
    await wait(page, 2000); // 顧客の第一声を読ませる

    // 営業トークを入力
    await page.fill("#chat-input", "VPNの認証突破による情報漏洩、御社では年間どのくらい発生していますか？");
    await wait(page, 1500); // 入力内容を見せる
    await page.click("#chat-send");
    await wait(page, 500);

    // 顧客の返答を待つ（2つ目のcustomerバブル）
    await page.waitForFunction(
      () => document.querySelectorAll(".chat-customer").length >= 2,
      { timeout: 15000 }
    );
    await wait(page, 2500); // 返答を読ませる

    // もう1ターン
    await page.fill("#chat-input", "Phantom Gateなら行動バイオメトリクスで不正アクセスを即ブロック。まず情シス50名でPoCしませんか？");
    await wait(page, 1500); // 入力内容を見せる
    await page.click("#chat-send");
    await wait(page, 500);

    await page.waitForFunction(
      () => document.querySelectorAll(".chat-customer").length >= 3,
      { timeout: 15000 }
    );
    await wait(page, 2500); // 返答を読ませる

    // フィードバック取得
    await page.click(".roleplay-end-btn");
    console.log("フィードバック生成中...");
    await page.waitForSelector(".feedback-card", { timeout: 15000 });
    await wait(page, 3000); // フィードバックを読ませる

    // メインエリア（チャット+フィードバック）だけ撮影
    console.log("ロープレを撮影");
    const mainChat = await page.locator(".main-chat");
    await mainChat.screenshot({ path: path.join(SCREENSHOTS_DIR, "rehearsal.png") });

    console.log("動画撮影完了");
  } finally {
    // 動画を保存
    const video = page.video();
    await context.close();
    if (video) {
      const tmpPath = await video.path();
      const outPath = path.join(SCREENSHOTS_DIR, "demo.webm");
      if (fs.existsSync(tmpPath)) {
        fs.copyFileSync(tmpPath, outPath);
        console.log(`動画: ${outPath}`);
      }
    }
    await browser.close();
  }

  // === OGP画像（1200x630、ロープレ+フィードバックの全画面） ===
  const browserOgp = await chromium.launch();
  const contextOgp = await browserOgp.newContext({ viewport: { width: 1200, height: 630 } });
  const pageOgp = await contextOgp.newPage();
  const cdpOgp = await contextOgp.newCDPSession(pageOgp);
  await cdpOgp.send("Emulation.setDefaultBackgroundColorOverride", {
    color: { r: 10, g: 10, b: 18, a: 1 },
  });
  await pageOgp.goto("http://localhost:3099", { waitUntil: "networkidle" });
  await wait(pageOgp, 500);
  await pageOgp.fill("#company", "SmartHR");
  await pageOgp.click("#analyze-btn");
  await pageOgp.waitForSelector(".chat-customer", { timeout: 10000 });
  await wait(pageOgp, 300);
  await pageOgp.fill("#chat-input", "VPNの認証突破による情報漏洩、御社では年間どのくらい発生していますか？");
  await pageOgp.click("#chat-send");
  await pageOgp.waitForFunction(() => document.querySelectorAll(".chat-customer").length >= 2, { timeout: 15000 });
  await wait(pageOgp, 300);
  await pageOgp.fill("#chat-input", "Phantom Gateなら行動バイオメトリクスで不正アクセスを即ブロック。まず情シス50名でPoCしませんか？");
  await pageOgp.click("#chat-send");
  await pageOgp.waitForFunction(() => document.querySelectorAll(".chat-customer").length >= 3, { timeout: 15000 });
  await wait(pageOgp, 300);
  await pageOgp.click(".roleplay-end-btn");
  await pageOgp.waitForSelector(".feedback-card", { timeout: 15000 });
  await wait(pageOgp, 500);
  console.log("OGP画像を撮影");
  await pageOgp.screenshot({ path: path.join(SCREENSHOTS_DIR, "ogp.png") });
  await browserOgp.close();

  // === 設定モーダル（スクショのみ、動画なし） ===
  const browser2 = await chromium.launch();
  const context2 = await browser2.newContext({ viewport: { width: 1280, height: 800 } });
  const page2 = await context2.newPage();
  const cdp2 = await context2.newCDPSession(page2);
  await cdp2.send("Emulation.setDefaultBackgroundColorOverride", {
    color: { r: 10, g: 10, b: 18, a: 1 },
  });
  await page2.goto("http://localhost:3099", { waitUntil: "networkidle" });
  await wait(page2, 500);
  await page2.click("#settings-btn");
  await page2.waitForSelector(".product-card", { timeout: 5000 });
  await wait(page2, 500);
  console.log("設定画面を撮影");
  await page2.screenshot({ path: path.join(SCREENSHOTS_DIR, "settings.png") });
  await browser2.close();

  server.close();

  // app.js を元に戻す
  fs.writeFileSync(APP_JS_PATH, originalAppJs, "utf-8");
  console.log("MODE → live に復元");

  // Playwright一時ファイルを削除
  const files = fs.readdirSync(SCREENSHOTS_DIR);
  for (const f of files) {
    if (f.endsWith(".webm") && f !== "demo.webm") {
      fs.unlinkSync(path.join(SCREENSHOTS_DIR, f));
    }
  }

  console.log("\n=== 出力ファイル ===");
  const outputs = fs.readdirSync(SCREENSHOTS_DIR);
  for (const f of outputs) {
    console.log(`  screenshots/${f}`);
  }
}

capture().catch((err) => {
  console.error("エラー:", err);
  // app.js を復元
  try {
    const original = fs.readFileSync(APP_JS_PATH, "utf-8");
    if (original.includes('const MODE = "demo"')) {
      fs.writeFileSync(
        APP_JS_PATH,
        original.replace('const MODE = "demo"', 'const MODE = "live"'),
        "utf-8"
      );
      console.log("MODE → live に復元（エラー時）");
    }
  } catch (e) {}
  process.exit(1);
});
