/**
 * GitHub Pages 用ビルド
 *
 * public/ を docs/ にコピーし、MODE を "demo" に切り替える。
 * デモアプリは demo.html、LPは index.html（別途管理）。
 * GitHub Pages のソースを「main ブランチの /docs」に設定すれば公開される。
 *
 * 使い方: npm run build:pages
 */
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "public");
const DEST = path.join(__dirname, "..", "docs");

// docs/ をクリーンアップ（index.html は LP なので保持）
const lpPath = path.join(DEST, "index.html");
let lpContent = null;
if (fs.existsSync(lpPath)) {
  lpContent = fs.readFileSync(lpPath, "utf-8");
}

if (fs.existsSync(DEST)) {
  fs.rmSync(DEST, { recursive: true });
}
fs.mkdirSync(DEST, { recursive: true });

// LP を復元
if (lpContent) {
  fs.writeFileSync(lpPath, lpContent, "utf-8");
}

// public/ の全ファイルをコピー（index.html → demo.html にリネーム）
for (const file of fs.readdirSync(SRC)) {
  const src = path.join(SRC, file);
  const destName = file === "index.html" ? "demo.html" : file;
  const dest = path.join(DEST, destName);

  if (fs.statSync(src).isFile()) {
    fs.copyFileSync(src, dest);
  }
}

// screenshots/ をコピー（LP の動画用）
const SCREENSHOTS_SRC = path.join(__dirname, "..", "screenshots");
const SCREENSHOTS_DEST = path.join(DEST, "screenshots");
if (fs.existsSync(SCREENSHOTS_SRC)) {
  fs.mkdirSync(SCREENSHOTS_DEST, { recursive: true });
  for (const file of fs.readdirSync(SCREENSHOTS_SRC)) {
    fs.copyFileSync(
      path.join(SCREENSHOTS_SRC, file),
      path.join(SCREENSHOTS_DEST, file)
    );
  }
}

// app.js の MODE を demo に切り替え
const appJs = path.join(DEST, "app.js");
const content = fs.readFileSync(appJs, "utf-8");
fs.writeFileSync(appJs, content.replace('const MODE = "live"', 'const MODE = "demo"'), "utf-8");

// Jekyll 無効化
fs.writeFileSync(path.join(DEST, ".nojekyll"), "", "utf-8");

console.log("docs/ にビルド完了（デモモード）");
