# AISPAR 設計書

## 概要

会社名を入力 → ニュース・決算・採用情報を自動取得 → AIが攻め方を提案
そのままAI相手にロープレ → 終了後にスコア付きフィードバック

## 解決する課題

- 商談前の顧客リサーチに時間がかかる
- 調べた情報と自社製品の結びつけが属人的
- 新人営業は「どう攻めるか」の引き出しが少ない
- 商談練習の相手がいない

## アーキテクチャ

```
[ブラウザ] → [Express (Node.js)] → [Google Custom Search API]
                                   → [Vertex AI (Gemini 2.5 Flash)]
```

- SDK: `@google/genai`（Vertex AI経由）
- 認証: サービスアカウント（ADC / .envで管理）
- 通信: JSON API（POST/GET）

## 動作モード

`public/app.js` 先頭の `MODE` フラグで切り替え:

| モード | 説明 |
|--------|------|
| `live` | バックエンドAPI通信。実際にGoogle検索 + Gemini分析 |
| `demo` | サンプルデータで動作。サーバー不要。静的サイトとして公開可能 |

デモモードでは `demo.js` のサンプルデータ（SmartHR・freee）を使用

## デザイン

- ダークサイバーテーマ（ハッカー端末風）
- フォント: JetBrains Mono（見出し・ラベル） / Noto Sans JP（本文）
- 背景: ダークネイビー `#0a0a12`
- メインカラー: ネオングリーン `#00ffaa`（見出し・ボタン・ラベル）
- アクセント: シアン `#00e5ff`（フォーカス・チャット送信） / ピンク `#ff3d71`（ロープレUI） / パープル `#a855f7`（顧客チャット）
- 補助テキスト: `#7a7a96` / `#9494b0`（青みグレー、テーマに合わせた色調）
- CSS: Tailwind CSS (CDN) + カスタムCSS
- カード: グラスモーフィズム（backdrop-filter: blur）
- ローディング: バウンシングドット（ネオン3色）
- カード出現: スライドアップアニメーション
- スクロールバー: 細身ネオングリーン（6px）
- レイアウト: 左メイン（ロープレ） + 右サイドバー（分析 + 履歴の2段）
- モバイル: サイドバー → ボトムドロワー、ヘッダーのLOG/INTELボタンでトグル

## API

### `POST /api/analyze`
会社分析のメインエンドポイント

リクエスト:
```json
{ "company": "会社名" }
```

レスポンス:
```json
{
  "id": 1234567890,
  "company": "会社名",
  "analysis": {
    "situation": "現状分析テキスト",
    "product": { "name": "製品名", "reason": "理由" },
    "talkPoints": ["セリフ1", "セリフ2", "セリフ3"],
    "concerns": [
      { "concern": "懸念", "counter": "切り返し" }
    ]
  },
  "searchResults": [...],
  "createdAt": "2026-03-22T..."
}
```

処理フロー:
1. フロントエンドで製品登録の有無をチェック（0件なら分析をブロックし、設定画面を案内）
2. Google Custom Searchで3クエリ（ニュース・決算・採用）× 3件 = 最大9件
3. 検索結果 + 設定画面の製品情報をプロンプトに組み立て
4. Gemini 2.5 Flash（thinking有効）で生成
5. JSON抽出 → 履歴保存 → レスポンス返却

### `POST /api/rehearsal`
ロープレ用エンドポイント

リクエスト:
```json
{
  "company": "会社名",
  "analysis": { ... },
  "messages": [
    { "role": "customer", "content": "..." },
    { "role": "sales", "content": "..." }
  ],
  "feedback": false
}
```

レスポンス（`feedback: false`）:
```json
{ "text": "顧客役AIの返答" }
```

レスポンス（`feedback: true`）:
```json
{
  "feedback": {
    "score": 3,
    "good": ["良かった点1", "良かった点2"],
    "improve": ["改善点1", "改善点2"],
    "tip": "次回のアドバイス"
  }
}
```

### `GET /api/settings`
製品設定の取得

### `PUT /api/settings`
製品設定の保存。`products` 配列に `name`（必須）を含むオブジェクトを渡す

```json
{
  "products": [
    {
      "name": "製品名",
      "description": "説明",
      "target": "ターゲット業界",
      "url": "LP URL（任意）"
    }
  ]
}
```

### `GET /api/history`
検索履歴の取得（新しい順）

### `DELETE /api/history/:id`
履歴の個別削除

## プロンプト設計

### `prompts/analyze.txt`（分析用）
- 敬語なし、体言止め・断定調
- 短文（1文40文字以内）
- 事実ベース（ニュース・数字を引用）
- `{{products}}` に設定画面の製品情報を注入
- JSON出力: situation, product, talkPoints, concerns

### `prompts/rehearsal.txt`（ロープレ用）
- 顧客の担当者役
- 分析結果をもとにリアルな反応
- 簡単に納得しない（予算・既存システム・導入工数を気にする）
- 短く返す（2〜3文）
- ビジネス敬語
- `{{products}}` に設定画面の製品情報を注入

### `prompts/rehearsal-feedback.txt`（フィードバック用）
- 営業のトーク全体を評価
- JSON出力: score(1-5), good[], improve[], tip

## ディレクトリ構成

```
aispar/
├── DESIGN.md
├── README.md
├── .env
├── .env.example
├── .gitignore
├── package.json
├── server.js
├── data/
│   ├── history.json
│   ├── settings.json
│   └── settings-sample.json
├── docs/                  ← GitHub Pages用（build-pages.jsで生成）
├── prompts/
│   ├── analyze.txt
│   ├── rehearsal.txt
│   └── rehearsal-feedback.txt
├── scripts/
│   ├── build-pages.js     ← docs/ビルド（デモモード）
│   └── capture-demo.js    ← スクショ・動画の自動撮影
├── screenshots/
└── public/
    ├── index.html
    ├── style.css
    ├── app.js
    └── demo.js
```

## 環境変数

| 変数名 | 用途 |
|--------|------|
| `GEMINI_API_KEY` | Gemini APIキー（方法1） |
| `GOOGLE_APPLICATION_CREDENTIALS` | サービスアカウントキーのパス（方法2） |
| `GCP_PROJECT_ID` | GCPプロジェクトID（方法2） |
| `GOOGLE_CSE_API_KEY` | Custom Search APIキー |
| `GOOGLE_CSE_ID` | Custom Search Engine ID |
| `PORT` | サーバーポート（デフォルト: 3000） |

## 注意事項

- `.env`やサービスアカウントキーはGitにコミットしない
- Custom Search API: 1日100クエリ無料、超過は$5/1000クエリ
- Vertex AI（Gemini）: トークン従量課金
