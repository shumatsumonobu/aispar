const express = require("express");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const { GoogleGenAI } = require("@google/genai");

const app = express();
app.use(express.json());
app.use(express.static("public"));

const HISTORY_PATH = path.join(__dirname, "data", "history.json");
const SETTINGS_PATH = path.join(__dirname, "data", "settings.json");
const PROMPT_PATH = path.join(__dirname, "prompts", "analyze.txt");
const REHEARSAL_PROMPT_PATH = path.join(__dirname, "prompts", "rehearsal.txt");
const FEEDBACK_PROMPT_PATH = path.join(__dirname, "prompts", "rehearsal-feedback.txt");

// Gemini: APIキーがあればGemini API、なければVertex AI（サービスアカウント）
const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : new GoogleGenAI({
      vertexai: true,
      project: process.env.GCP_PROJECT_ID,
      location: "global",
    });

// 履歴
function loadHistory() {
  if (!fs.existsSync(HISTORY_PATH)) return [];
  return JSON.parse(fs.readFileSync(HISTORY_PATH, "utf-8"));
}

function saveHistory(history) {
  const dir = path.dirname(HISTORY_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2), "utf-8");
}

// 設定
function loadSettings() {
  if (!fs.existsSync(SETTINGS_PATH)) return { products: [] };
  return JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf-8"));
}

function saveSettings(settings) {
  const dir = path.dirname(SETTINGS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), "utf-8");
}

// 製品情報をプロンプト用テキストに変換
function buildProductsText(products) {
  if (!products || products.length === 0) {
    return "（製品情報が未登録です）";
  }
  return products
    .map((p) => {
      let text = `### ${p.name}\n${p.description}`;
      if (p.target) text += `\nターゲット: ${p.target}`;
      if (p.url) text += `\nLP: ${p.url}`;
      return text;
    })
    .join("\n\n");
}

// Google Custom Search
async function searchCompany(company) {
  const queries = [
    `${company} ニュース 最新`,
    `${company} 決算 業績`,
    `${company} 採用 求人`,
  ];

  const results = [];

  for (const query of queries) {
    const url = `https://www.googleapis.com/customsearch/v1?key=${process.env.GOOGLE_CSE_API_KEY}&cx=${process.env.GOOGLE_CSE_ID}&q=${encodeURIComponent(query)}&num=3`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.items) {
      for (const item of data.items) {
        results.push({
          title: item.title,
          snippet: item.snippet,
          link: item.link,
        });
      }
    }
  }

  return results;
}

// 分析API
app.post("/api/analyze", async (req, res) => {
  const { company } = req.body;
  if (!company) {
    return res.status(400).json({ error: "会社名が必要です" });
  }

  try {
    const searchResults = await searchCompany(company);
    const searchText = searchResults
      .map((r) => `- ${r.title}\n  ${r.snippet}\n  ${r.link}`)
      .join("\n\n");

    const settings = loadSettings();
    const productsText = buildProductsText(settings.products);
    const promptTemplate = fs.readFileSync(PROMPT_PATH, "utf-8");
    const prompt = promptTemplate
      .replace(/\{\{company\}\}/g, company)
      .replace("{{search_results}}", searchText)
      .replace("{{products}}", productsText);

    const result = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        temperature: 0.3,
        topP: 0.8,
        maxOutputTokens: 2048,
        thinkingConfig: { thinkingBudget: 1024 },
      },
    });

    let rawText = result.text;
    const jsonMatch = rawText.match(/```json\s*([\s\S]*?)```/);
    if (jsonMatch) rawText = jsonMatch[1];
    const analysis = JSON.parse(rawText.trim());

    const history = loadHistory();
    const entry = {
      id: Date.now(),
      company,
      analysis,
      searchResults,
      createdAt: new Date().toISOString(),
    };
    history.unshift(entry);
    saveHistory(history);

    res.json(entry);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "分析に失敗しました: " + err.message });
  }
});

// リハーサルAPI
app.post("/api/rehearsal", async (req, res) => {
  const { company, analysis, messages, feedback } = req.body;
  if (!company) {
    return res.status(400).json({ error: "会社名が必要です" });
  }

  try {
    const messagesText = messages
      .map((m) => `${m.role === "customer" ? "顧客" : "営業"}: ${m.content}`)
      .join("\n");

    const analysisText = JSON.stringify(analysis, null, 2);
    const settings = loadSettings();
    const productsText = buildProductsText(settings.products);
    const promptPath = feedback ? FEEDBACK_PROMPT_PATH : REHEARSAL_PROMPT_PATH;
    const promptTemplate = fs.readFileSync(promptPath, "utf-8");
    const prompt = promptTemplate
      .replace(/\{\{company\}\}/g, company)
      .replace("{{analysis}}", analysisText)
      .replace("{{messages}}", messagesText)
      .replace("{{products}}", productsText);

    const result = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        temperature: 0.7,
        topP: 0.9,
        maxOutputTokens: 1024,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    const text = result.text;

    if (feedback) {
      let rawText = text;
      const jsonMatch = rawText.match(/```json\s*([\s\S]*?)```/);
      if (jsonMatch) rawText = jsonMatch[1];
      const feedbackData = JSON.parse(rawText.trim());
      res.json({ feedback: feedbackData });
    } else {
      res.json({ text });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "リハーサルに失敗しました: " + err.message });
  }
});

// 設定API
app.get("/api/settings", (req, res) => {
  res.json(loadSettings());
});

app.put("/api/settings", (req, res) => {
  const { products } = req.body;
  if (!Array.isArray(products)) {
    return res.status(400).json({ error: "products は配列で指定してください" });
  }
  for (const p of products) {
    if (!p.name || typeof p.name !== "string") {
      return res.status(400).json({ error: "各製品に name が必要です" });
    }
  }
  saveSettings({ products });
  res.json({ ok: true });
});

// 履歴API
app.get("/api/history", (req, res) => {
  res.json(loadHistory());
});

app.delete("/api/history/:id", (req, res) => {
  const id = Number(req.params.id);
  const history = loadHistory().filter((h) => h.id !== id);
  saveHistory(history);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AISPAR running at http://localhost:${PORT}`);
});
