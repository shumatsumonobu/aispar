// ===== モード設定 =====
// "live" = バックエンドAPI通信, "demo" = サンプルデータ表示
const MODE = "demo";

const companyInput = document.getElementById("company");
const analyzeBtn = document.getElementById("analyze-btn");
const loading = document.getElementById("loading");
const resultDiv = document.getElementById("result");
const historyDiv = document.getElementById("history");
const historyToggle = document.getElementById("history-toggle");
const sidebar = document.querySelector(".sidebar");
const sidebarAnalysis = document.getElementById("sidebar-analysis");
const loadingText = document.querySelector("#loading p");
let currentData = null;

// HTMLエスケープ
function esc(str) {
  if (!str) return "";
  return String(str).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// 分析実行
analyzeBtn.addEventListener("click", analyze);
companyInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") analyze();
});

async function analyze() {
  const company = companyInput.value.trim();
  if (!company) return;

  // ロープレ中なら先に閉じる
  if (roleplayActive) closeSession();

  // 製品未登録チェック（liveモードのみ）
  if (MODE === "live") {
    try {
      const settingsRes = await fetch("/api/settings");
      const settings = await settingsRes.json();
      if (!settings.products || settings.products.length === 0) {
        resultDiv.innerHTML = `
          <div class="empty-products-msg">
            <p>製品未登録</p>
            <p class="empty-products-sub">分析するには、まず自社製品を登録</p>
            <button class="open-settings-btn" onclick="openSettings()">⚙ 製品を登録する</button>
          </div>
        `;
        resultDiv.classList.remove("hidden");
        return;
      }
    } catch (e) {
      // 設定取得に失敗しても分析は続行
    }
  }

  analyzeBtn.disabled = true;
  loading.classList.remove("hidden");
  resultDiv.classList.add("hidden");
  loadingText.textContent = "分析中...";

  try {
    let entry;

    if (MODE === "demo") {
      // デモモード: サンプルデータを使用
      await new Promise((r) => setTimeout(r, 1500)); // ローディング演出
      entry = DEMO_DATA[company];
      if (!entry) {
        // サンプルにない会社名 → SmartHRのデータを流用
        const keys = Object.keys(DEMO_DATA);
        entry = { ...DEMO_DATA[keys[0]], company, id: Date.now() };
      }
    } else {
      // liveモード: API通信
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "分析失敗");
      }
      entry = await res.json();
    }

    showResult(entry);
    loading.classList.add("hidden");
    analyzeBtn.disabled = false;
    loadHistory();
  } catch (err) {
    resultDiv.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    resultDiv.classList.remove("hidden");
    analyzeBtn.disabled = false;
    loading.classList.add("hidden");
  }
}

// 結果表示（右サイドバーに分析カード、左メインにチャット自動開始）
function showResult(data) {
  currentData = data;
  const a = data.analysis;

  const talkPointsHtml = a.talkPoints
    .map((t) => `<li>${esc(t)}</li>`)
    .join("");

  const concernsHtml = a.concerns
    .map(
      (c) => `
      <div class="concern-item">
        <div class="concern-q">💬 ${esc(c.concern)}</div>
        <div class="concern-a">→ ${esc(c.counter)}</div>
      </div>
    `
    )
    .join("");

  // 分析カードを右サイドバーに表示
  sidebar.classList.add("analysis-mode");
  document.body.classList.add("analysis-active");

  sidebarAnalysis.innerHTML = `
    <div class="company-name">${esc(data.company)}</div>

    <div class="card card-blue card-appear" style="animation-delay: 0s">
      <div class="card-label">現状分析</div>
      <p>${esc(a.situation)}</p>
    </div>

    <div class="card card-pink card-appear" style="animation-delay: 0.12s">
      <div class="card-label">おすすめ製品</div>
      <div class="product-name">${esc(a.product.name)}</div>
      <p>${esc(a.product.reason)}</p>
    </div>

    <div class="card card-green card-appear" style="animation-delay: 0.24s">
      <div class="card-label">トークポイント</div>
      <ul>${talkPointsHtml}</ul>
    </div>

    <div class="card card-orange card-appear" style="animation-delay: 0.36s">
      <div class="card-label">想定Q&A</div>
      ${concernsHtml}
    </div>
  `;

  // モバイル: LOGボタンをINTELに変更
  updateToggleLabel();

  // 左メインにロープレを自動開始
  startRoleplay();
}

// ===== ロープレ =====
let roleplayMessages = [];
let roleplayActive = false;
let demoResponseIndex = 0;

function startRoleplay() {
  if (!currentData) return;
  roleplayMessages = [];
  roleplayActive = true;
  demoResponseIndex = 0;

  // 左メインにチャットUIを表示
  resultDiv.innerHTML = `
    <div class="main-chat">
      <div id="roleplay" class="roleplay">
        <div class="roleplay-header">
          <span>ROLEPLAY — ${esc(currentData.company)}</span>
          <button class="roleplay-end-btn" onclick="endRoleplay()">終了してフィードバック</button>
        </div>
        <div id="chat-messages" class="chat-messages"></div>
        <div class="chat-input-area">
          <input type="text" id="chat-input" placeholder="営業トークを入力..." autocomplete="off" maxlength="200">
          <button id="chat-send" onclick="sendMessage()">送信</button>
        </div>
      </div>
    </div>
  `;
  resultDiv.classList.remove("hidden");

  document.getElementById("chat-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendMessage();
  });

  sendCustomerMessage();

  document.getElementById("chat-input").focus();
}

function sendMessage() {
  const input = document.getElementById("chat-input");
  const text = input.value.trim();
  if (!text || !roleplayActive) return;

  input.value = "";
  roleplayMessages.push({ role: "sales", content: text });
  appendChatBubble("sales", text);
  sendCustomerMessage();
}

function appendChatBubble(role, text) {
  const chatMessages = document.getElementById("chat-messages");
  const bubble = document.createElement("div");
  bubble.className = `chat-bubble chat-${role}`;

  const label = role === "customer" ? "顧客" : "あなた";
  bubble.innerHTML = `<span class="chat-role">${label}</span><p>${esc(text)}</p>`;

  chatMessages.appendChild(bubble);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function sendCustomerMessage() {
  const chatMessages = document.getElementById("chat-messages");
  const sendBtn = document.getElementById("chat-send");
  const input = document.getElementById("chat-input");
  sendBtn.disabled = true;
  input.disabled = true;

  // タイピングインジケーター表示
  const typing = document.createElement("div");
  typing.className = "chat-bubble chat-customer chat-typing";
  typing.innerHTML = `<span class="chat-role">顧客</span><div class="typing-dots"><span></span><span></span><span></span></div>`;
  chatMessages.appendChild(typing);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  try {
    let responseText;

    if (MODE === "demo") {
      await new Promise((r) => setTimeout(r, 800));
      responseText = DEMO_ROLEPLAY_RESPONSES[demoResponseIndex % DEMO_ROLEPLAY_RESPONSES.length];
      demoResponseIndex++;
    } else {
      const res = await fetch("/api/rehearsal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company: currentData.company,
          analysis: currentData.analysis,
          messages: roleplayMessages,
          feedback: false,
        }),
      });
      if (!res.ok) throw new Error("通信エラー");
      const data = await res.json();
      responseText = data.text;
    }

    typing.remove();
    roleplayMessages.push({ role: "customer", content: responseText });
    appendChatBubble("customer", responseText);
  } catch (err) {
    typing.remove();
    appendChatBubble("customer", "通信エラー");
  } finally {
    sendBtn.disabled = false;
    input.disabled = false;
    input.focus();
  }
}

async function endRoleplay() {
  if (!roleplayActive) return;
  roleplayActive = false;

  const inputArea = document.querySelector(".chat-input-area");
  const endBtn = document.querySelector(".roleplay-end-btn");
  inputArea.style.display = "none";
  endBtn.disabled = true;
  endBtn.textContent = "フィードバック生成中...";

  try {
    let feedbackData;

    if (MODE === "demo") {
      await new Promise((r) => setTimeout(r, 1000));
      feedbackData = DEMO_FEEDBACK;
    } else {
      const res = await fetch("/api/rehearsal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company: currentData.company,
          analysis: currentData.analysis,
          messages: roleplayMessages,
          feedback: true,
        }),
      });
      if (!res.ok) throw new Error("フィードバック取得失敗");
      const data = await res.json();
      feedbackData = data.feedback;
    }

    showFeedback(feedbackData);
  } catch (err) {
    appendChatBubble("customer", "フィードバック取得失敗");
  }

  endBtn.textContent = "閉じる";
  endBtn.disabled = false;
  endBtn.style.borderColor = "#00ffaa";
  endBtn.style.color = "#00ffaa";
  endBtn.onclick = closeSession;
}

function closeSession() {
  // サイドバーを履歴に戻す
  sidebar.classList.remove("analysis-mode");
  sidebar.classList.remove("open");
  document.body.classList.remove("analysis-active");
  sidebarAnalysis.innerHTML = "";

  // モバイル: ボタンをLOGに戻す
  updateToggleLabel();

  // メインエリアをクリア
  resultDiv.innerHTML = "";
  resultDiv.classList.add("hidden");
}

function feedbackHtml(fb) {
  const stars = "★".repeat(fb.score) + "☆".repeat(5 - fb.score);
  const goodHtml = fb.good.map((g) => `<li>${esc(g)}</li>`).join("");
  const improveHtml = fb.improve.map((i) => `<li>${esc(i)}</li>`).join("");
  return `
    <div class="feedback-card">
      <div class="feedback-score">${stars}</div>
      <div class="feedback-section">
        <div class="feedback-label good">Good</div>
        <ul>${goodHtml}</ul>
      </div>
      <div class="feedback-section">
        <div class="feedback-label improve">改善点</div>
        <ul>${improveHtml}</ul>
      </div>
      <div class="feedback-tip">${esc(fb.tip)}</div>
    </div>
  `;
}

function showFeedback(fb) {
  const html = feedbackHtml(fb);

  // チャット内にフィードバック表示
  const chatMessages = document.getElementById("chat-messages");
  if (chatMessages) {
    const bubble = document.createElement("div");
    bubble.className = "chat-bubble chat-feedback";
    bubble.innerHTML = `<span class="chat-role">トレーナー</span>${html}`;
    chatMessages.appendChild(bubble);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
}

// ===== 履歴 =====
async function loadHistory() {
  if (MODE === "demo") {
    historyDiv.innerHTML = '<p class="history-empty">デモモード — 履歴なし</p>';
    return;
  }

  historyDiv.innerHTML = '<p class="history-empty history-loading">読み込み中...</p>';

  let history;
  try {
    const res = await fetch("/api/history");
    history = await res.json();
  } catch (e) {
    historyDiv.innerHTML = '<p class="history-empty">接続エラー</p>';
    return;
  }

  if (history.length === 0) {
    historyDiv.innerHTML = '<p class="history-empty">履歴なし</p>';
    return;
  }

  historyDiv.innerHTML = history
    .map((item) => {
      const date = new Date(item.createdAt).toLocaleDateString("ja-JP", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
      return `
        <div class="history-item" data-id="${item.id}">
          <div class="history-item-top">
            <span class="name">${esc(item.company)}</span>
            <button class="history-delete" data-id="${item.id}" title="削除">×</button>
          </div>
          <span class="date">${date}</span>
        </div>
      `;
    })
    .join("");

  document.querySelectorAll(".history-item").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.classList.contains("history-delete")) return;
      const id = Number(el.dataset.id);
      const item = history.find((h) => h.id === id);
      if (item) {
        if (roleplayActive) closeSession();
        showResult(item);
        resultDiv.scrollIntoView({ behavior: "smooth" });
        closeDrawer();
      }
    });
  });

  document.querySelectorAll(".history-delete").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      await fetch(`/api/history/${id}`, { method: "DELETE" });
      if (currentData && String(currentData.id) === id) closeSession();
      loadHistory();
    });
  });
}

// ===== スマホ用ドロワー =====
historyToggle.addEventListener("click", () => {
  if (sidebar.classList.contains("open")) {
    closeDrawer();
  } else {
    openDrawer();
  }
});

function updateToggleLabel() {
  if (document.body.classList.contains("analysis-active")) {
    historyToggle.textContent = "INTEL";
  } else {
    historyToggle.textContent = "LOG";
  }
}

function openDrawer() {
  sidebar.classList.add("open");
  document.body.style.overflow = "hidden";
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.addEventListener("click", closeDrawer);
  document.body.appendChild(overlay);
}

function closeDrawer() {
  sidebar.classList.remove("open");
  document.body.style.overflow = "";
  const overlay = document.querySelector(".overlay");
  if (overlay) overlay.remove();
}

// ===== 設定画面 =====
const settingsBtn = document.getElementById("settings-btn");
const settingsModal = document.getElementById("settings-modal");
let settingsProducts = [];
settingsBtn.addEventListener("click", openSettings);

async function openSettings() {
  settingsModal.classList.remove("hidden");
  if (MODE === "demo") {
    settingsProducts = [
      { name: "Sentinel AI", description: "AIによるリアルタイム脅威検知プラットフォーム", target: "金融・通信・官公庁・SaaS企業", url: "" },
      { name: "Phantom Gate", description: "ゼロトラスト認証ゲートウェイ", target: "リモートワーク導入企業・多拠点展開企業", url: "" },
    ];
  } else {
    const res = await fetch("/api/settings");
    const settings = await res.json();
    settingsProducts = settings.products || [];
  }
  renderProductList();
}

function closeSettings() {
  settingsModal.classList.add("hidden");
}

settingsModal.querySelector(".modal-backdrop").addEventListener("click", closeSettings);

function renderProductList() {
  const list = document.getElementById("product-list");
  if (settingsProducts.length === 0) {
    list.innerHTML = '<p class="no-products">製品未登録</p>';
    return;
  }
  list.innerHTML = settingsProducts
    .map(
      (p, i) => `
      <div class="product-card">
        <div class="product-card-header">
          <span class="product-card-name">${esc(p.name)}</span>
          <button class="product-delete" onclick="removeProduct(${i})">×</button>
        </div>
        <div class="product-card-body">
          <label>製品名 <input type="text" value="${esc(p.name)}" onchange="updateProduct(${i},'name',this.value)"></label>
          <label>説明 <textarea onchange="updateProduct(${i},'description',this.value)">${esc(p.description)}</textarea></label>
          <label>ターゲット業界 <input type="text" value="${esc(p.target || "")}" onchange="updateProduct(${i},'target',this.value)"></label>
          <label>LP URL <input type="text" value="${esc(p.url || "")}" onchange="updateProduct(${i},'url',this.value)"></label>
        </div>
      </div>
    `
    )
    .join("");
}

function addProductForm() {
  settingsProducts.push({ name: "新しい製品", description: "", target: "", url: "" });
  renderProductList();
}

function removeProduct(index) {
  settingsProducts.splice(index, 1);
  renderProductList();
}

function updateProduct(index, field, value) {
  settingsProducts[index][field] = value;
  if (field === "name") renderProductList();
}

async function saveSettings() {
  if (MODE === "live") {
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ products: settingsProducts }),
    });
  }
  closeSettings();
}

// 初期化
loadHistory().catch(() => {});
