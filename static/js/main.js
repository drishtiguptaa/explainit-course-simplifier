/**
 * ExplainIt — Course Simplifier | Frontend Logic
 * Features: theme toggle, file upload, simplify/chat, feedback buttons,
 *           ambiguity callout, session content history, analytics footer,
 *           markdown rendering, toast notifications, special-token stripping.
 */

// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  selectedLevel: "beginner",
  isLoading:     false,
  hasContent:    false,
  // Local analytics mirror (updated from API response)
  analytics: { beginner: 0, intermediate: 0, expert: 0, total: 0, up: 0, down: 0 },
};

// ── DOM refs ──────────────────────────────────────────────────────────────────
const courseContent      = document.getElementById("courseContent");
const charCount          = document.getElementById("charCount");
const levelBtns          = document.querySelectorAll(".level-btn");
const currentLevelBadge  = document.getElementById("currentLevelBadge");
const simplifyBtn        = document.getElementById("simplifyBtn");
const simplifyBtnText    = document.getElementById("simplifyBtnText");
const simplifyBtnLoading = document.getElementById("simplifyBtnLoading");
const clearBtn           = document.getElementById("clearBtn");
const chatMessages       = document.getElementById("chatMessages");
let   welcomeState       = document.getElementById("welcomeState");
const chatMessage        = document.getElementById("chatMessage");
const sendBtn            = document.getElementById("sendBtn");
const themeToggle        = document.getElementById("themeToggle");
const themeIcon          = document.getElementById("themeIcon");
// Upload refs
const uploadZone         = document.getElementById("uploadZone");
const fileInput          = document.getElementById("fileInput");
const uploadPrompt       = document.getElementById("uploadPrompt");
const uploadStatus       = document.getElementById("uploadStatus");
const uploadProgress     = document.getElementById("uploadProgress");
const uploadFileName     = document.getElementById("uploadFileName");
const uploadClearBtn     = document.getElementById("uploadClearBtn");
// Analytics footer refs
const cntBeginner        = document.getElementById("cntBeginner");
const cntIntermediate    = document.getElementById("cntIntermediate");
const cntExpert          = document.getElementById("cntExpert");
const cntTotal           = document.getElementById("cntTotal");
const cntUp              = document.getElementById("cntUp");
const cntDown            = document.getElementById("cntDown");

// ── Level icons/labels map ────────────────────────────────────────────────────
const LEVEL_META = {
  beginner:     { icon: "🌱", label: "Beginner" },
  intermediate: { icon: "📚", label: "Intermediate" },
  expert:       { icon: "🔬", label: "Expert" },
};

// ── Theme ─────────────────────────────────────────────────────────────────────
function initTheme() {
  applyTheme(localStorage.getItem("explainit-theme") || "dark");
}
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  themeIcon.className = theme === "dark" ? "bi bi-sun-fill" : "bi bi-moon-stars-fill";
  localStorage.setItem("explainit-theme", theme);
}
themeToggle.addEventListener("click", () => {
  applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
});

// ── File Upload ───────────────────────────────────────────────────────────────
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB

function showUploadPrompt() {
  uploadPrompt.classList.remove("d-none");
  uploadStatus.classList.add("d-none");
  uploadProgress.classList.add("d-none");
  uploadZone.classList.remove("upload-zone--success", "upload-zone--drag");
  fileInput.value = "";
}
function showUploadSuccess(filename) {
  uploadPrompt.classList.add("d-none");
  uploadProgress.classList.add("d-none");
  uploadStatus.classList.remove("d-none");
  uploadFileName.textContent = filename;
  uploadZone.classList.add("upload-zone--success");
}
function showUploadProcessing() {
  uploadPrompt.classList.add("d-none");
  uploadStatus.classList.add("d-none");
  uploadProgress.classList.remove("d-none");
}

async function processFile(file) {
  if (!file) return;
  const ext = file.name.split(".").pop().toLowerCase();
  if (!["pdf", "txt"].includes(ext)) {
    showToast("Only .pdf and .txt files are supported.", "warning");
    return;
  }
  if (file.size > MAX_FILE_BYTES) {
    showToast("File is too large. Maximum size is 25 MB.", "warning");
    return;
  }
  showUploadProcessing();
  const formData = new FormData();
  formData.append("file", file);
  try {
    const resp = await fetch("/api/upload", { method: "POST", body: formData });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
    courseContent.value = data.text;
    courseContent.dispatchEvent(new Event("input"));
    showUploadSuccess(data.filename);
    if (data.warning) {
      showToast(data.warning, "warning");
    } else {
      showToast(`Extracted ${(data.words ?? data.size).toLocaleString()} words from "${data.filename}".`, "success");
    }
  } catch (err) {
    showUploadPrompt();
    showToast(`Upload failed: ${err.message}`, "danger");
  }
}

uploadZone.addEventListener("click", (e) => {
  if (e.target === uploadClearBtn || uploadClearBtn.contains(e.target)) return;
  if (!uploadStatus.classList.contains("d-none")) return;
  fileInput.click();
});
fileInput.addEventListener("change", () => { if (fileInput.files[0]) processFile(fileInput.files[0]); });
uploadZone.addEventListener("dragover",  (e) => { e.preventDefault(); uploadZone.classList.add("upload-zone--drag"); });
uploadZone.addEventListener("dragleave", ()  => { uploadZone.classList.remove("upload-zone--drag"); });
uploadZone.addEventListener("drop", (e) => {
  e.preventDefault();
  uploadZone.classList.remove("upload-zone--drag");
  if (e.dataTransfer.files[0]) processFile(e.dataTransfer.files[0]);
});
uploadClearBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  courseContent.value = "";
  courseContent.dispatchEvent(new Event("input"));
  showUploadPrompt();
  showToast("File removed.", "info");
});

// ── Character counter ─────────────────────────────────────────────────────────
courseContent.addEventListener("input", () => {
  const len = courseContent.value.length;
  charCount.textContent = `${len.toLocaleString()} character${len !== 1 ? "s" : ""}`;
  charCount.style.color = len > 8000 ? "var(--warning)" : "";
});

// ── Level selector ────────────────────────────────────────────────────────────
levelBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    levelBtns.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.selectedLevel = btn.dataset.level;
    const meta = LEVEL_META[state.selectedLevel];
    currentLevelBadge.textContent = `${meta.icon} ${meta.label}`;
  });
});

// ── Auto-grow chat textarea ───────────────────────────────────────────────────
chatMessage.addEventListener("input", () => {
  chatMessage.style.height = "auto";
  chatMessage.style.height = Math.min(chatMessage.scrollHeight, 120) + "px";
});
chatMessage.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendChat(); }
});

// ── Utilities ─────────────────────────────────────────────────────────────────
function scrollToBottom() {
  chatMessages.scrollTo({ top: chatMessages.scrollHeight, behavior: "smooth" });
}
function formatTime() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function renderMarkdown(text) {
  if (typeof marked === "undefined") return escapeHtml(text).replace(/\n/g, "<br>");
  try { return marked.parse(text, { breaks: true, gfm: true }); }
  catch { return escapeHtml(text).replace(/\n/g, "<br>"); }
}
function escapeHtml(str) {
  return str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// ── Hide welcome state ────────────────────────────────────────────────────────
function hideWelcome() {
  if (!welcomeState) return;
  welcomeState.style.transition = "opacity 0.3s ease";
  welcomeState.style.opacity    = "0";
  setTimeout(() => { if (welcomeState) { welcomeState.remove(); welcomeState = null; } }, 300);
}

// ── User bubble ───────────────────────────────────────────────────────────────
function appendUserBubble(text) {
  hideWelcome();
  const wrap = document.createElement("div");
  wrap.className = "chat-bubble-wrap user-wrap";
  wrap.innerHTML = `
    <div>
      <div class="chat-bubble user-bubble">${escapeHtml(text)}</div>
      <span class="bubble-time">${formatTime()}</span>
    </div>
    <div class="avatar user"><i class="bi bi-person-fill"></i></div>
  `;
  chatMessages.appendChild(wrap);
  scrollToBottom();
}

// ── Ambiguity callout ─────────────────────────────────────────────────────────
function buildAmbiguityCallout(warning) {
  const div = document.createElement("div");
  div.className = "ambiguity-callout";
  div.innerHTML = `
    <i class="bi bi-exclamation-triangle-fill ambiguity-icon"></i>
    <div>
      <strong>Content may be ambiguous</strong>
      <p>${escapeHtml(warning)}</p>
    </div>
  `;
  return div;
}

// ── Bot bubble (with optional ambiguity callout + feedback row) ──────────────
function appendBotBubble(text, ambiguityWarning, isConversational) {
  hideWelcome();
  const wrap = document.createElement("div");
  wrap.className = "chat-bubble-wrap";

  const bubbleDiv = document.createElement("div");

  // Ambiguity callout — only for simplification responses
  if (ambiguityWarning && !isConversational) {
    bubbleDiv.appendChild(buildAmbiguityCallout(ambiguityWarning));
  }

  const bubble = document.createElement("div");
  bubble.className = "chat-bubble bot-bubble";
  bubble.innerHTML = renderMarkdown(text);
  bubbleDiv.appendChild(bubble);

  const timeSpan = document.createElement("span");
  timeSpan.className = "bubble-time";
  timeSpan.textContent = formatTime();
  bubbleDiv.appendChild(timeSpan);

  // Feedback row — only for simplification responses, not conversational
  if (!isConversational) {
    const feedbackRow = buildFeedbackRow(text);
    bubbleDiv.appendChild(feedbackRow);
  }

  wrap.innerHTML = `<div class="avatar bot"><i class="bi bi-mortarboard-fill"></i></div>`;
  wrap.appendChild(bubbleDiv);
  chatMessages.appendChild(wrap);
  scrollToBottom();
  return wrap;
}

// ── Feedback row ──────────────────────────────────────────────────────────────
function buildFeedbackRow(responseText) {
  const row = document.createElement("div");
  row.className = "feedback-row";
  row.innerHTML = `
    <span class="feedback-label">Was this helpful?</span>
    <button class="feedback-btn feedback-up"   data-vote="up"   title="Helpful">👍</button>
    <button class="feedback-btn feedback-down" data-vote="down" title="Not helpful">👎</button>
    <span class="feedback-thanks d-none">Thanks for the feedback!</span>
  `;

  row.querySelectorAll(".feedback-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (row.dataset.voted) return; // prevent double-vote
      row.dataset.voted = "1";
      row.querySelectorAll(".feedback-btn").forEach((b) => {
        b.disabled = true;
        b.classList.toggle("feedback-btn--chosen", b === btn);
      });
      row.querySelector(".feedback-thanks").classList.remove("d-none");

      const vote = btn.dataset.vote;
      try {
        const resp = await fetch("/api/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            vote,
            level:            state.selectedLevel,
            response_preview: responseText.slice(0, 120),
          }),
        });
        if (resp.ok) {
          if (vote === "up")   state.analytics.up++;
          else                 state.analytics.down++;
          refreshAnalyticsFooter();
        }
      } catch (_) {/* silently ignore network errors for feedback */}
    });
  });

  return row;
}

// ── Typing indicator ──────────────────────────────────────────────────────────
function showTyping() {
  hideWelcome();
  const wrap = document.createElement("div");
  wrap.className = "chat-bubble-wrap";
  wrap.id = "typingIndicator";
  wrap.innerHTML = `
    <div class="avatar bot"><i class="bi bi-mortarboard-fill"></i></div>
    <div class="typing-indicator">
      <div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>
    </div>
  `;
  chatMessages.appendChild(wrap);
  scrollToBottom();
}
function removeTyping() {
  const el = document.getElementById("typingIndicator");
  if (el) el.remove();
}

// ── Error bubble ──────────────────────────────────────────────────────────────
function appendErrorBubble(msg) {
  removeTyping();
  const wrap = document.createElement("div");
  wrap.className = "chat-bubble-wrap";
  wrap.innerHTML = `
    <div class="avatar bot"><i class="bi bi-mortarboard-fill"></i></div>
    <div class="error-bubble">
      <i class="bi bi-exclamation-triangle-fill"></i>
      <span>${escapeHtml(msg)}</span>
    </div>
  `;
  chatMessages.appendChild(wrap);
  scrollToBottom();
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(message, type = "info") {
  const toastEl   = document.getElementById("toastNotif");
  const toastBody = document.getElementById("toastBody");
  const colorMap  = { info:"text-bg-secondary", success:"text-bg-success",
                      warning:"text-bg-warning", danger:"text-bg-danger" };
  toastEl.className  = `toast align-items-center border-0 ${colorMap[type] || "text-bg-secondary"}`;
  toastBody.textContent = message;
  new bootstrap.Toast(toastEl, { delay: 4500 }).show();
}

// ── Analytics footer ──────────────────────────────────────────────────────────
function refreshAnalyticsFooter(serverData) {
  if (serverData) {
    state.analytics.beginner     = serverData.simplifications.beginner    || 0;
    state.analytics.intermediate = serverData.simplifications.intermediate|| 0;
    state.analytics.expert       = serverData.simplifications.expert      || 0;
    state.analytics.total        = serverData.simplifications.total       || 0;
    state.analytics.up           = serverData.feedback.up                 || 0;
    state.analytics.down         = serverData.feedback.down               || 0;
  }
  cntBeginner.textContent    = state.analytics.beginner;
  cntIntermediate.textContent = state.analytics.intermediate;
  cntExpert.textContent      = state.analytics.expert;
  cntTotal.textContent       = state.analytics.total;
  cntUp.textContent          = state.analytics.up;
  cntDown.textContent        = state.analytics.down;
}

async function fetchAnalytics() {
  try {
    const resp = await fetch("/api/analytics");
    if (resp.ok) refreshAnalyticsFooter(await resp.json());
  } catch (_) {}
}

// ── Loading state ─────────────────────────────────────────────────────────────
function setLoading(on) {
  state.isLoading = on;
  simplifyBtn.disabled = on;
  sendBtn.disabled     = on;
  simplifyBtnText.classList.toggle("d-none", on);
  simplifyBtnLoading.classList.toggle("d-none", !on);
  if (on) showTyping(); else removeTyping();
}

// ── Core API call ─────────────────────────────────────────────────────────────
async function callSimplifyAPI(content, message) {
  const resp = await fetch("/api/simplify", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ content, level: state.selectedLevel, message }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
  return data;
}

// ── Simplify button ───────────────────────────────────────────────────────────
simplifyBtn.addEventListener("click", async () => {
  const content = courseContent.value.trim();
  if (!content) {
    showToast("Please upload a file or paste some course content first.", "warning");
    courseContent.focus();
    return;
  }
  const meta    = LEVEL_META[state.selectedLevel];
  const preview = content.length > 80 ? content.slice(0, 80) + "…" : content;
  appendUserBubble(`${meta.icon} Simplify for ${meta.label}:\n\n"${preview}"`);
  setLoading(true);
  try {
    const data = await callSimplifyAPI(content, "");
    appendBotBubble(data.response, data.ambiguity_warning, data.is_conversational);
    state.hasContent = true;
    // Bump local counter and refresh footer
    if (!data.is_conversational) {
      state.analytics[state.selectedLevel] = (state.analytics[state.selectedLevel] || 0) + 1;
      state.analytics.total = (state.analytics.total || 0) + 1;
      refreshAnalyticsFooter();
    }
  } catch (err) {
    appendErrorBubble(err.message);
    showToast(err.message, "danger");
  } finally {
    setLoading(false);
  }
});

// ── Follow-up chat ────────────────────────────────────────────────────────────
async function handleSendChat() {
  const msg = chatMessage.value.trim();
  if (!msg) return;
  appendUserBubble(msg);
  chatMessage.value = "";
  chatMessage.style.height = "auto";
  setLoading(true);
  const contextContent = state.hasContent ? courseContent.value.trim() : "";
  try {
    const data = await callSimplifyAPI(contextContent, msg);
    appendBotBubble(data.response, data.ambiguity_warning, data.is_conversational);
  } catch (err) {
    appendErrorBubble(err.message);
    showToast(err.message, "danger");
  } finally {
    setLoading(false);
  }
}
sendBtn.addEventListener("click", handleSendChat);

// ── Clear session ─────────────────────────────────────────────────────────────
clearBtn.addEventListener("click", async () => {
  try { await fetch("/api/clear", { method: "POST" }); } catch (_) {}
  courseContent.value = "";
  charCount.textContent = "0 characters";
  state.hasContent = false;
  showUploadPrompt();

  chatMessages.innerHTML = "";
  welcomeState = document.createElement("div");
  welcomeState.id = "welcomeState";
  welcomeState.className = "welcome-state";
  welcomeState.innerHTML = `
    <div class="welcome-icon"><i class="bi bi-stars"></i></div>
    <h3 class="welcome-title">Welcome to ExplainIt</h3>
    <p class="welcome-sub">
      Upload a file or paste course content on the left, choose your proficiency level,
      and let IBM Granite AI transform complex material into crystal-clear explanations.
    </p>
    <div class="welcome-features">
      <div class="feature-chip"><i class="bi bi-file-earmark-arrow-up me-1"></i>PDF &amp; TXT Upload</div>
      <div class="feature-chip"><i class="bi bi-translate me-1"></i>Plain Language</div>
      <div class="feature-chip"><i class="bi bi-list-check me-1"></i>Key Takeaways</div>
      <div class="feature-chip"><i class="bi bi-link-45deg me-1"></i>Real-world Examples</div>
      <div class="feature-chip"><i class="bi bi-chat-square-dots me-1"></i>Follow-up Chat</div>
      <div class="feature-chip"><i class="bi bi-hand-thumbs-up me-1"></i>Feedback</div>
    </div>
  `;
  chatMessages.appendChild(welcomeState);
  showToast("Session cleared.", "success");
});

// ── Init ──────────────────────────────────────────────────────────────────────
initTheme();
fetchAnalytics();
