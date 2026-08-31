"use strict";

/* Interpretation conversation lifecycle, rendering, streaming, and recovery.
   This zero-build feature fragment shares the app.js runtime by design. */

function switchTab(key) {
  if (!tabOf(key)) return;
  if (key === state.activeTab) return;
  state.activeTab = key;
  threadScrollLock = { key, locked: false };
  renderTabs();
  renderThread();
  syncComposerState();
  saveResumeCookie();
}
function riskAckNeeded(key = state.activeTab) {
  const t = tabOf(key);
  return !!t && !state.riskAcceptedTabs.__all__;
}

function markRiskAccepted(key = state.activeTab) {
  if (!key || !tabOf(key)) return;
  state.riskAcceptedTabs = { __all__: true };
  try { localStorage.setItem(RISK_ACK_STORAGE_KEY, "1"); } catch (_) {}
}

function syncRiskAck(focus = false) {
  const wrap = $("#composer-risk-ack");
  const input = $("#risk-ack-input");
  if (!wrap || !input) return;
  const needed = riskAckNeeded(state.activeTab);
  const inlineAckVisible = !!document.querySelector(".chat-empty [data-risk-ack-tab]");
  wrap.hidden = !needed || inlineAckVisible;
  input.checked = !needed;
  if (needed && !inlineAckVisible && focus) input.focus();
}

function canStartInterpret(key = state.activeTab) {
  if (state.system === "liuyao" && lastInput?.visibility !== "private" && (!lastInput?.public_consent || lastInput?.public_consent_version !== LIUYAO_PUBLIC_CONSENT_VERSION)) {
    toast("这份旧卦没有公开授权，请重新起卦", "warn");
    return false;
  }
  if (!riskAckNeeded(key)) return true;
  toast("请先勾选参考声明", "warn");
  syncRiskAck(true);
  return false;
}

function answerCreditsUnavailable() {
  const quota = Account?.snapshot?.()?.privateQuota;
  return !!quota && !quota.can_start_answer;
}

function showAnswerCreditGate() {
  toast("今日免费积分与充值积分已用完；明日刷新，或充值后继续", "warn");
  Account?.open?.("topup", "可用积分已经用完。充值到账后，可以继续当前这份命盘或卦象的 AI 解读。");
}

function startThread(key = state.activeTab) {
  const t = tabOf(key);
  if (!t || state.streaming) return;
  if ((state.threads[key] || []).length) return;
  if (!canStartInterpret(key)) return;
  if (answerCreditsUnavailable()) {
    showAnswerCreditGate();
    return;
  }
  let q;
  if (state.system === "liuyao") {
    q = (lastPayload && lastPayload.question) || "请为我详断此卦。";
  } else {
    q = DEFAULT_Q.topic.本命;
  }
  requestInterpret(key, { scenario: t.scenario, topic: t.topic, question: q });
}

function startNewSession(key = state.activeTab) {
  const t = tabOf(key);
  if (!t || state.streaming) return;
  clearPersonalCaseContext();
  if (state.system === "liuyao") {
    toast("六爻一事一卦。新会话请重新摇卦。", "warn");
    openCastModal({ clearQuestion: true, fresh: true });
    return;
  }
  state.sessionIds[key] = createSessionId();
  state.threads[key] = [];
  if (state.pendingFork?.key === key) state.pendingFork = null;
  threadScrollLock = { key, locked: false };
  renderTabs();
  renderThread();
  saveResumeCookie();
  toast("已开启新的八字对话");
}

function fillComposerQuestion(question) {
  const input = $("#draft-input");
  if (!input) return;
  input.value = String(question || "");
  input.focus();
}

function pushUser(key, text) { state.threads[key].push({ kind: "user", text }); }
function pushAI(key, opts = {}) {
  const detailed = detailedWorkspaceActive();
  const msg = { kind: "ai", id: "m" + Date.now() + Math.random().toString(36).slice(2, 6),
    workspaceKey: currentWorkspaceKey(), profileId: activeProfileId || null,
    threadKey: key,
    scenario: "", title: "", status: detailed ? "正在合参命盘与卦象" : opts.scenario === "divination" ? "正在分析卦象" : "正在分析命盘", waitText: "", waitIndex: 0, waitTimer: null,
    taskId: "", pollTimer: null, eventSource: null, pollFailures: 0, typeFrame: null, typeLastAt: 0,
    typePendingChars: 0, typeSkippedTicks: 0, fullBody: "", displayIndex: 0,
    messageId: null, chartId: activeChartId || null, chartSessionId: null,
    body: "", streaming: true, streamable: true, streamedBody: false, followups: [], error: "",
    feedbackReaction: "", feedbackSaved: false, feedbackPending: false, feedbackError: "", publicPost: null,
    createdAt: Date.now(), completedAt: 0, finishWhenStreamCaughtUp: false, serverDone: false,
    rawScenario: opts.scenario || "", rawTopic: opts.topic || "", rawQuestion: opts.question || "",
    credits: null };
  state.threads[key].push(msg);
  return msg;
}

function messageWorkspaceSnapshot(msg) {
  const stored = msg?.workspaceKey ? sessionStore[msg.workspaceKey] : null;
  if (stored?.threads && Object.values(stored.threads).some(messages => messages.includes(msg))) return stored;
  return Object.values(sessionStore).find(snap => snap?.threads
    && Object.values(snap.threads).some(messages => messages.includes(msg))) || null;
}

function messageWorkspaceIsActive(msg) {
  return !!msg && (state.threads[msg.threadKey] || []).includes(msg);
}

function applyMessageProfileId(msg, profileId) {
  const pid = Number(profileId || 0) || null;
  msg.profileId = pid;
  if (messageWorkspaceIsActive(msg)) {
    activeProfileId = pid;
    renderProfileFab();
    return;
  }
  const snapshot = messageWorkspaceSnapshot(msg);
  if (snapshot) snapshot.activeProfileId = pid;
}

function applyMessageChartId(msg, chartId) {
  const cid = Number(chartId || 0) || null;
  msg.chartId = cid;
  if (messageWorkspaceIsActive(msg)) activeChartId = cid;
  else {
    const snapshot = messageWorkspaceSnapshot(msg);
    if (snapshot) snapshot.activeChartId = cid;
  }
}

async function refreshMessageProfileHistory(msg) {
  const profileId = Number(msg?.profileId || 0);
  if (!profileId) return;
  const response = await fetch(`/api/profiles/${profileId}/interpretations`);
  if (!response.ok) throw new Error(await response.text());
  const history = await response.json();
  if (messageWorkspaceIsActive(msg)) {
    activeHistory = history;
    renderProfileFab();
    return;
  }
  const snapshot = messageWorkspaceSnapshot(msg);
  if (snapshot) snapshot.activeHistory = history;
}

function waitingKey(status = "") {
  if (status === "analysis" || status === "checking" || status === "final" || status === "combining") return status;
  if (status.includes("合参")) return "combining";
  if (status.includes("识别问题边界")) return "intent";
  if (status.includes("逻辑校验")) return "logic";
  if (status.includes("发送")) return "final";
  if (status.includes("分析命盘") || status.includes("分析卦象") || status.includes("重新分析") || status.includes("重新断卦")) return "analysis";
  return "default";
}
function waitingLine(status, index = 0, msg = null) {
  const bank = detailedWorkspaceActive()
    ? WAITING_LINES
    : msg?.rawScenario === "divination"
      ? LIUYAO_WAITING_LINES
      : WAITING_LINES;
  const lines = bank[waitingKey(status)] || bank.default;
  return lines[index % lines.length];
}
function streamStatusText(msg) {
  if (msg.waitText) return msg.waitText;
  if (msg.status) return waitingLine(msg.status, msg.waitIndex || 0, msg);
  return "正在整理回复";
}
function elapsedSeconds(msg) {
  const start = msg.createdAt || Date.now();
  const end = msg.completedAt || Date.now();
  return Math.max(0, Math.floor((end - start) / 1000));
}
function elapsedText(msg) {
  const seconds = elapsedSeconds(msg);
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes} 分 ${String(rest).padStart(2, "0")} 秒`;
}
function setWaitingStatus(msg, status) {
  msg.status = status || "";
  msg.waitIndex = 0;
  msg.waitText = msg.status ? waitingLine(msg.status, 0, msg) : "";
  msg.waitTextUpdatedAt = Date.now();
}
function updateElapsedNode(msg) {
  if (!msg?.id) return false;
  const node = Array.from(document.querySelectorAll(".msg-ai")).find(item => item.dataset.id === msg.id);
  const elapsed = node?.querySelector(".ai-elapsed");
  if (!elapsed) return false;
  elapsed.textContent = `${msg.streaming ? (msg.body ? "已用" : "已等") : "总用时"} ${elapsedText(msg)}`;
  return true;
}
function updateWaitingNode(msg) {
  if (!msg?.id) return false;
  const node = Array.from(document.querySelectorAll(".msg-ai")).find(item => item.dataset.id === msg.id);
  const status = node?.querySelector(".ai-status-line");
  const text = msg.waitText || msg.status || "";
  if (!status || !text) return false;
  status.textContent = text;
  updateElapsedNode(msg);
  return true;
}
function refreshWaitingNode(msg) {
  if (!updateWaitingNode(msg) && messageWorkspaceIsActive(msg) && !shouldDeferThreadRender()) scheduleRender();
}
function startWaitingTicker(msg) {
  stopWaitingTicker(msg);
  setWaitingStatus(msg, msg.status || "正在分析命盘");
  msg.waitTimer = setInterval(() => {
    if (!msg.streaming || msg.error || !msg.status) { stopWaitingTicker(msg); return; }
    const now = Date.now();
    if (now - (msg.waitTextUpdatedAt || 0) >= WAITING_TEXT_ROTATE_MS) {
      msg.waitIndex = (msg.waitIndex || 0) + 1;
      msg.waitText = waitingLine(msg.status, msg.waitIndex, msg);
      msg.waitTextUpdatedAt = now;
      refreshWaitingNode(msg);
    } else {
      updateElapsedNode(msg);
    }
  }, 1000);
}
function stopWaitingTicker(msg) {
  if (msg?.waitTimer) clearInterval(msg.waitTimer);
  if (msg) msg.waitTimer = null;
}
function stopTaskPolling(msg) {
  if (msg?.pollTimer) clearTimeout(msg.pollTimer);
  if (msg) msg.pollTimer = null;
}
function stopTaskEvents(msg) {
  if (msg?.eventSource) msg.eventSource.close();
  if (msg) msg.eventSource = null;
}
function stopTypewriter(msg) {
  if (msg?.typeFrame) window.cancelAnimationFrame(msg.typeFrame);
  if (!msg) return;
  msg.typeFrame = null;
  msg.typeLastAt = 0;
  msg.typePendingChars = 0;
  msg.typeSkippedTicks = 0;
}
function allThreadMaps() {
  const maps = [state.threads];
  Object.values(sessionStore).forEach(snap => {
    if (snap?.threads && !maps.includes(snap.threads)) maps.push(snap.threads);
  });
  return maps;
}
function activeStreamingMessage() {
  const current = (state.threads[state.activeTab] || []).find(m => m.kind === "ai" && m.streaming);
  if (current) return current;
  for (const threads of allThreadMaps()) {
    for (const msgs of Object.values(threads || {})) {
      const msg = msgs.find(m => m.kind === "ai" && m.streaming);
      if (msg) return msg;
    }
  }
  return null;
}
function cancelTaskDownstream(msg) {
  if (!msg?.taskId && !msg?.clientRequestId) return;
  const payload = {};
  if (msg.taskId) payload.task_id = msg.taskId;
  if (msg.clientRequestId) payload.client_request_id = msg.clientRequestId;
  fetch("/api/interpret/cancel", {
    method: "POST",
    headers: Account?.csrfHeaders({ "Content-Type": "application/json" }) || { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
    .then(r => r.ok ? r.json() : null)
    .then(task => {
      if (task?.task_id) msg.taskId = task.task_id;
    })
    .catch(() => {});
}
function stopCurrentInterpret() {
  const msg = activeStreamingMessage();
  if (!msg) return;
  if (msg.serverDone) {
    revealCompletedAnswer(msg);
    return;
  }
  cancelTaskDownstream(msg);
  if (msg.requestAbort) {
    msg.requestAbort.abort();
    msg.requestAbort = null;
  }
  stopTaskPolling(msg);
  stopTaskEvents(msg);
  stopWaitingTicker(msg);
  stopTypewriter(msg);
  msg.streaming = false;
  msg.stopped = true;
  msg.status = "";
  msg.waitText = "";
  if (!msg.completedAt) msg.completedAt = Date.now();
  if (!msg.body) msg.body = "已停止生成。";
  msg.body = msg.body.trim()
    ? `${msg.body}\n\n已停止生成，可编辑刚才的问题后从这里分叉重发。`
    : "已停止生成。";
  msg.followups = [];
  state.streaming = !!activeStreamingMessage();
  syncComposerState();
  renderThread();
  renderTabs();
}
function stopAllPendingWork() {
  allThreadMaps().forEach(threads => {
    Object.values(threads || {}).forEach(msgs => {
      msgs.forEach(m => {
        if (m.kind !== "ai") return;
        if (m.requestAbort) {
          m.requestAbort.abort();
          m.requestAbort = null;
        }
        m.streaming = false;
        stopWaitingTicker(m);
        stopTaskPolling(m);
        stopTaskEvents(m);
        stopTypewriter(m);
      });
    });
  });
  state.streaming = false;
}

function findMessageLocation(id) {
  for (const [key, msgs] of Object.entries(state.threads || {})) {
    const index = msgs.findIndex(m => m.id === id);
    if (index >= 0) return { key, msgs, index, msg: msgs[index] };
  }
  return null;
}
function editStoppedMessage(id) {
  const loc = findMessageLocation(id);
  if (!loc || !loc.msg?.stopped) return;
  const prev = loc.msgs[loc.index - 1];
  const text = loc.msg.rawQuestion || (prev?.kind === "user" ? prev.text : "");
  state.pendingFork = (loc.msg.taskId || loc.msg.clientRequestId)
    ? { key: loc.key, fromTaskId: loc.msg.taskId || "", fromClientRequestId: loc.msg.clientRequestId || "", reason: "edit_after_cancel" }
    : null;
  const start = prev?.kind === "user" ? loc.index - 1 : loc.index;
  const count = prev?.kind === "user" ? 2 : 1;
  loc.msgs.splice(start, count);
  state.activeTab = loc.key;
  state.streaming = false;
  threadScrollLock = { key: loc.key, locked: false };
  renderTabs();
  renderThread();
  syncComposerState();
  const input = $("#draft-input");
  if (input) {
    input.value = text;
    input.disabled = false;
    input.focus();
  }
  toast("已回到停止点，可以编辑后重新发送");
}

function recoverFailedMessage(id, edit = false) {
  const loc = findMessageLocation(id);
  if (!loc || !loc.msg?.error || !loc.msg.rawQuestion) return;
  if (state.streaming || activeStreamingMessage()) {
    toast("请先等待当前解读完成", "warn");
    return;
  }
  state.activeTab = loc.key;
  threadScrollLock = { key: loc.key, locked: false };
  renderTabs();
  renderThread();
  if (!edit && !canStartInterpret(loc.key)) return;
  const question = loc.msg.rawQuestion;
  const route = {
    scenario: loc.msg.rawScenario || pickScenario(question).scenario,
    topic: loc.msg.rawTopic || "",
    question,
  };
  const prev = loc.msgs[loc.index - 1];
  const start = prev?.kind === "user" ? loc.index - 1 : loc.index;
  const count = prev?.kind === "user" ? 2 : 1;
  loc.msgs.splice(start, count);
  requestThreadScrollBottom();
  if (edit) {
    renderThread();
    const input = $("#draft-input");
    if (input) {
      input.value = question;
      input.disabled = false;
      input.focus();
    }
    toast("问题已放回输入框");
    return;
  }
  pushUser(loc.key, question);
  renderThread();
  requestInterpret(loc.key, route);
}

let renderScheduled = false;
let threadScrollLock = { key: "", locked: false };
function scheduleRender() {
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(() => { renderScheduled = false; renderThread(); });
}

function aiFeedbackIcon(action) {
  const rotate = action === "dislike" ? ' class="ai-feedback-icon dislike"' : ' class="ai-feedback-icon"';
  return `<svg${rotate} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M7 10v11"></path>
    <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2h0a3.13 3.13 0 0 1 3 3.88Z"></path>
  </svg>`;
}

function aiFeedbackHtml(m) {
  if (m.streaming || m.error || m.stopped || !m.body) return "";
  const value = m.feedbackReaction || "";
  const stateText = m.feedbackPending ? "记录中" : (m.feedbackError || (m.feedbackSaved ? "已记录" : ""));
  const button = action => {
    const label = action === "like" ? "点赞" : "不支持";
    const active = value === action;
    return `<button type="button" class="ai-feedback-btn${active ? " active" : ""}" title="${label}" aria-label="${label}" aria-pressed="${active ? "true" : "false"}" data-ai-feedback-id="${esc(m.id)}" data-ai-feedback-action="${action}" ${m.feedbackPending ? "disabled" : ""}>${aiFeedbackIcon(action)}</button>`;
  };
  return `<div class="ai-feedback" data-ai-feedback="${esc(m.id)}">${button("like")}${button("dislike")}<span class="ai-feedback-state" aria-live="polite">${esc(stateText)}</span></div>`;
}

async function submitMessageFeedback(id, reaction) {
  const loc = findMessageLocation(id);
  const msg = loc?.msg;
  if (!msg || msg.streaming || msg.error || msg.stopped || msg.feedbackPending) return;
  const next = reaction === "dislike" ? "dislike" : "like";
  const previous = msg.feedbackReaction || "";
  msg.feedbackReaction = next;
  msg.feedbackPending = true;
  msg.feedbackError = "";
  msg.feedbackSaved = false;
  scheduleRender();
  const payload = {
    reaction: next,
    session_id: msg.sessionId && validSessionId(msg.sessionId) ? msg.sessionId : sessionIdForTab(loc.key),
  };
  if (msg.chartId || activeChartId) payload.chart_id = msg.chartId || activeChartId;
  if (msg.messageId) payload.message_id = Number(msg.messageId);
  else if (msg.taskId) payload.task_id = msg.taskId;
  else {
    msg.feedbackReaction = previous;
    msg.feedbackPending = false;
    msg.feedbackError = "未找到回复记录";
    scheduleRender();
    return;
  }
  try {
    const r = await fetch("/api/chat-message-feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) throw new Error(await r.text().catch(() => "记录失败"));
    const data = await r.json();
    msg.messageId = data.message_id || msg.messageId;
    msg.feedbackReaction = data.reaction || next;
    msg.feedbackSaved = true;
    msg.feedbackError = "";
  } catch (e) {
    msg.feedbackReaction = previous;
    msg.feedbackSaved = !!previous;
    msg.feedbackError = humanError(String(e?.message || e));
  } finally {
    msg.feedbackPending = false;
    scheduleRender();
  }
}

function requestThreadScrollBottom() {
  threadScrollLock = { key: state.activeTab, locked: false };
  forceThreadScrollBottom = true;
}

function threadBottomDistance(thread) {
  const maxTop = Math.max(0, thread.scrollHeight - thread.clientHeight);
  return maxTop - (thread.scrollTop || 0);
}

function updateThreadScrollLock(thread, key) {
  if (!thread) return;
  const nearBottom = threadBottomDistance(thread) <= CHAT_BOTTOM_THRESHOLD;
  threadScrollLock = { key, locked: !nearBottom };
}

function shouldDeferThreadRender() {
  return threadScrollLock.key === state.activeTab && threadScrollLock.locked;
}

function captureThreadScroll(thread, key) {
  const sameThread = renderedThreadKey === key;
  const top = thread.scrollTop || 0;
  return {
    sameThread,
    top,
    locked: sameThread && threadScrollLock.key === key && threadScrollLock.locked,
    nearBottom: !sameThread || threadBottomDistance(thread) <= CHAT_BOTTOM_THRESHOLD,
  };
}

function restoreThreadScroll(thread, snapshot) {
  const forceBottom = forceThreadScrollBottom;
  forceThreadScrollBottom = false;
  if (forceBottom || snapshot.nearBottom) {
    thread.scrollTop = thread.scrollHeight;
    threadScrollLock = { key: state.activeTab, locked: false };
    return;
  }
  const maxTop = Math.max(0, thread.scrollHeight - thread.clientHeight);
  thread.scrollTop = Math.min(snapshot.top, maxTop);
  if (snapshot.locked) threadScrollLock = { key: state.activeTab, locked: true };
}

function renderThread() {
  const key = state.activeTab;
  const t = tabOf(key) || {};
  const thread = $("#chat-thread");
  const scrollSnapshot = captureThreadScroll(thread, key);

  const msgs = state.threads[key] || [];
  thread.innerHTML = "";
  if (!msgs.length) {
    const isLy = state.system === "liuyao";
    const isDetailed = detailedWorkspaceActive();
    const q = isLy ? ((lastPayload && lastPayload.question) || DEFAULT_Q.divination) : DEFAULT_Q.topic.本命;
    const needsAck = riskAckNeeded(key);
    const lyBrief = isLy && lastPayload ? (() => {
      const ben = lastPayload.ben_gua?.name || "六爻";
      const bian = (lastPayload.dong_yao || []).length ? ` → ${lastPayload.bian_gua?.name || "变卦"}` : "";
      return `${ben}${bian} · 世${LY_POS_NAME[lastPayload.shi_yao] || "?"}应${LY_POS_NAME[lastPayload.ying_yao] || "?"} · 动爻${liuyaoDongText(lastPayload)}`;
    })() : "";
    const starterHtml = isLy ? "" : `<div class="starter-grid" aria-label="常见问题">
      ${BAZI_STARTER_QUESTIONS.map(item => `<button type="button" data-fill-starter="${esc(item.question)}">${esc(item.label)}</button>`).join("")}
    </div><div class="starter-note">点一下只会把问题放进输入框，你仍可改成自己的说法。</div>`;
    const emptyHtml = `<div class="chat-empty${isDetailed ? " detailed-empty" : isLy ? " liuyao-empty" : " bazi-empty"}">
        <div class="k">${isDetailed ? "八 字 × 卦 象 · 一 事 详 断" : isLy ? esc(t.label) : "同 一 命 盘 · 一 段 对 话"}</div>
        <div class="t">${isDetailed ? "复合依据已齐，开始详断" : isLy ? "一卦已成，开始断卦" : "你想先问哪件事？"}</div>
        <div class="b">${isDetailed ? `本人命盘与 ${lyBrief} 已绑定到「${esc(liuyaoQuestionText())}」。结论会统一收束，不会把你带进单独的八字或六爻会话。` : isLy ? `${lyBrief}。点「开始解读」，围绕所问给出答案；也可直接在下方追问。` : "下面只是帮你起个头，不是不同的分析模式。后面想换到工作、感情或财运，直接在同一段对话里继续问。"}</div>
        ${needsAck ? `<label class="chat-risk-ack">
          <input type="checkbox" data-risk-ack-tab="${esc(key)}">
          <span>${esc(RISK_ACK_TEXT)}</span>
        </label>` : ""}
        ${starterHtml}
        ${isLy ? `<div class="actions">
          <button type="button" class="primary" data-start-thread ${needsAck ? "disabled" : ""}>${isDetailed ? "开始复合详断" : "开始解读"}</button>
          <button type="button" data-fill-question="${esc(q)}">${isDetailed ? "把原问题带入输入框" : "填入所问事项"}</button>
        </div>` : ""}
      </div>`;
    thread.innerHTML = emptyHtml;
    thread.querySelectorAll("[data-risk-ack-tab]").forEach(input => {
      input.onchange = () => {
        if (input.checked) {
          const riskKey = input.dataset.riskAckTab || key;
          const shouldAutoStart = pendingStartAfterRiskAck === riskKey;
          pendingStartAfterRiskAck = "";
          markRiskAccepted(riskKey);
          renderThread();
          if (shouldAutoStart) startThread(riskKey);
        }
      };
    });
    const start = thread.querySelector("[data-start-thread]");
    if (start) start.onclick = () => startThread(key);
    const fill = thread.querySelector("[data-fill-question]");
    if (fill) fill.onclick = () => fillComposerQuestion(fill.dataset.fillQuestion);
    thread.querySelectorAll("[data-fill-starter]").forEach(button => {
      button.onclick = () => fillComposerQuestion(button.dataset.fillStarter);
    });
    syncComposerState();
    renderedThreadKey = key;
    /* 空状态必须从标题开始显示；沿用上一条长解读的底部位置会把首屏滚出可达范围。 */
    forceThreadScrollBottom = false;
    thread.scrollTop = 0;
    threadScrollLock = { key, locked: false };
    return;
  }
  msgs.forEach(m => {
    if (m.kind === "user") {
      const d = document.createElement("div");
      d.className = "msg-user";
      d.innerHTML = `<div class="bubble">${esc(m.text)}</div>`;
      thread.appendChild(d);
      return;
    }
    const d = document.createElement("div");
    d.className = "msg-ai";
    d.dataset.id = m.id;
    if (!m.streaming && !m.error && !m.stopped) {
      d.tabIndex = -1;
      d.setAttribute("role", "region");
      d.setAttribute("aria-label", `解读结果：${m.rawQuestion || m.scenario || "已完成回答"}`);
    }
    if (m.restoredHistoryId) {
      d.dataset.historyId = String(m.restoredHistoryId);
      d.tabIndex = -1;
      d.setAttribute("aria-label", `历史解读：${m.rawQuestion || m.scenario || "已保存回答"}`);
    }
    let html = "";
    if (m.error) {
      const recoveredBody = String(m.body || "").trim();
      if (recoveredBody) {
        html += `<section class="ai-recovered-draft" aria-label="失败前已生成的内容">
          <span>失败前已生成的内容</span>
          <div class="ai-body">${renderBody(recoveredBody)}</div>
        </section>`;
      }
      html += `<div class="ai-error" role="alert">
        <b>${recoveredBody ? "解读中断，现有内容已保留" : "这次解读没有完成"}</b>
        <span>${esc(m.error)}</span>
        ${m.rawQuestion ? `<div class="ai-error-actions">
          <button type="button" class="primary" data-retry-interpret="${esc(m.id)}">重新解读</button>
          <button type="button" data-edit-failed="${esc(m.id)}">编辑问题</button>
        </div>` : ""}
      </div>`;
    } else {
      const waitingText = m.waitText || m.status;
      const waiting = !m.body && m.streaming && waitingText
        ? `<span class="ai-status-line">${esc(waitingText)}</span>`
        : "";
      const streamStatus = m.body && m.streaming && m.streamable
        ? `<div class="ai-stream-status">${esc(streamStatusText(m))}</div>`
        : "";
      const elapsed = m.streaming || (!m.error && m.completedAt)
        ? `<span class="ai-elapsed">${m.streaming ? (m.body ? "已用" : "已等") : "总用时"} ${esc(elapsedText(m))}</span>`
        : "";
      const byline = `<span class="ai-byline">${detailedWorkspaceActive() ? "复合推演" : "推演"}${m.scenario ? ` · ${esc(m.scenario)}` : ""}</span>`;
      html += `${byline}${elapsed}<div class="ai-body">${waiting}${renderBody(m.body)}${m.streaming ? `<span class="ai-cursor"></span>` : ""}${streamStatus}</div>`;
      if (!m.streaming && m.credits) html += answerCreditsHtml(m.credits);
      html += aiFeedbackHtml(m);
      if (m.publicPost) {
        if (m.publicPost.status === "published") {
          html += `<div class="public-post-link"><span>已匿名公开</span><a href="${esc(m.publicPost.url)}" data-community-post data-post-slug="${esc(m.publicPost.slug)}">查看卦帖</a><button type="button" data-share-public-post="${esc(m.publicPost.slug)}">分享</button></div>`;
        } else if (m.streaming) {
          html += `<div class="public-post-link pending"><span>完成后自动发布为公开卦帖</span></div>`;
        }
      }
    }
    if (!m.streaming && !m.error && m.followups && m.followups.length) {
      html += `<div class="followups">${m.followups.map(f => `<button type="button" class="followup" data-followup="${esc(f)}">${esc(f)}</button>`).join("")}</div>`;
    }
    if (m.stopped && m.rawQuestion) {
      html += `<div class="followups"><button type="button" class="followup" data-edit-stopped="${esc(m.id)}">编辑刚才的问题</button></div>`;
    }
    d.innerHTML = html;
    thread.appendChild(d);
  });
  thread.querySelectorAll("[data-followup]").forEach(b => b.onclick = () => askText(b.dataset.followup));
  thread.querySelectorAll("[data-edit-stopped]").forEach(b => b.onclick = () => editStoppedMessage(b.dataset.editStopped));
  thread.querySelectorAll("[data-retry-interpret]").forEach(b => b.onclick = () => recoverFailedMessage(b.dataset.retryInterpret));
  thread.querySelectorAll("[data-edit-failed]").forEach(b => b.onclick = () => recoverFailedMessage(b.dataset.editFailed, true));
  thread.querySelectorAll("[data-ai-feedback-action]").forEach(b => {
    b.onclick = () => submitMessageFeedback(b.dataset.aiFeedbackId, b.dataset.aiFeedbackAction);
  });
  thread.querySelectorAll("[data-share-public-post]").forEach(b => {
    b.onclick = () => sharePublicPost(b.dataset.sharePublicPost);
  });
  syncComposerState();
  renderedThreadKey = key;
  restoreThreadScroll(thread, scrollSnapshot);
}

function syncComposerState() {
  const activeMessage = activeStreamingMessage();
  const busy = !!state.streaming || !!activeMessage;
  const canRevealCompleted = !!activeMessage?.serverDone;
  const input = $("#draft-input");
  const send = $("#send-btn");
  const newSession = $("#new-session-btn");
  const newCast = $("#new-cast-btn");
  const needsAck = riskAckNeeded(state.activeTab);
  const liuyao = state.system === "liuyao";
  const detailed = detailedWorkspaceActive();
  if (detailed) {
    const statusText = detailedCaseStatusText();
    const labelStatus = document.querySelector("#detailed-workspace-label em");
    if (labelStatus) labelStatus.textContent = `八字 × 卦象 · ${statusText}`;
    const topState = $("#top-profile-state");
    if (topState) topState.textContent = statusText;
    const fabState = $("#profile-fab-state");
    if (fabState) fabState.textContent = statusText;
    $$('[data-detailed-status]').forEach(node => { node.textContent = statusText; });
    const railStatus = $("#rail-gloss-btn");
    if (railStatus?.disabled) railStatus.textContent = statusText;
  }
  if (input) {
    input.disabled = busy;
    input.placeholder = detailed
      ? "继续问这件事：何时落定？最大的变数是什么？"
      : liuyao
        ? "就此卦追问：应期？对方心思？"
        : "问：今年适合换工作吗？";
  }
  if (send) {
    send.disabled = !busy && needsAck;
    send.classList.toggle("is-stop", busy && !canRevealCompleted);
    send.title = canRevealCompleted ? "立即显示完整回答" : (busy ? "停止生成" : "发送");
    send.setAttribute("aria-label", canRevealCompleted ? "显示全文" : (busy ? "停止生成" : "发送"));
    send.innerHTML = canRevealCompleted
      ? "显示全文"
      : (busy ? `<span class="send-stop-mark" aria-hidden="true"></span>` : "发送");
    send.onclick = sendDraft;
  }
  if (newSession) {
    newSession.hidden = liuyao;
    newSession.disabled = busy;
    newSession.title = liuyao ? "六爻一事一卦，新会话需重新摇卦" : "开启新的八字对话";
    newSession.setAttribute("aria-label", liuyao ? "重新摇卦开启新会话" : "开启新的八字对话");
  }
  if (newCast) newCast.disabled = busy;
  syncRiskAck();
}
function isTerminalTask(task) {
  return task?.status === "done" || task?.status === "failed" || task?.status === "cancelled";
}

function renderInlineMarkdown(text) {
  return ChatRenderer.renderInlineMarkdown(text);
}
function renderBody(text) {
  return ChatRenderer.renderBody(text);
}

function answerCreditsHtml(credits) {
  if (!credits || Number(credits.required_credits || 0) <= 0) return "";
  const required = Number(credits.required_credits || 0);
  const daily = Number(credits.daily_free_spent || 0);
  const paid = Number(credits.paid_spent || 0);
  const covered = Number(credits.platform_covered || 0);
  if (covered > 0) {
    return `<div class="ai-credit-settlement covered" role="status"><b>本次回答已完整送达</b><span>可用积分已经扣到 0；本次不足部分由体验保护覆盖。</span></div>`;
  }
  const sources = [daily ? `今日免费 ${daily}` : "", paid ? `充值积分 ${paid}` : ""].filter(Boolean).join(" + ");
  return `<div class="ai-credit-settlement"><b>本次消耗 ${required} 分</b><span>${sources || "未扣充值积分"} · 今日免费剩余 ${Number(credits.daily_remaining || 0)} 分 · 充值剩余 ${Number(credits.paid_balance_after || 0)} 分</span></div>`;
}

/* ---------- 路由：用户问题 → scenario ---------- */
function pickScenario(text) {
  if (state.system === "liuyao") return { scenario: "divination" };
  return { scenario: "topic", topic: "" };
}

function askText(text) {
  text = (text || "").trim();
  if (!text || state.streaming) return;
  const key = state.activeTab;
  if (!canStartInterpret(key)) return;
  if (answerCreditsUnavailable()) {
    showAnswerCreditGate();
    return;
  }
  pushUser(key, text);
  requestThreadScrollBottom();
  renderTabs();
  renderThread();
  const route = pickScenario(text);
  requestInterpret(key, { ...route, question: text });
}

function sendDraft() {
  const activeMessage = activeStreamingMessage();
  if (activeMessage?.serverDone) {
    revealCompletedAnswer(activeMessage);
    return;
  }
  if (state.streaming || activeMessage) {
    stopCurrentInterpret();
    return;
  }
  const input = $("#draft-input");
  const text = input?.value || "";
  if (!text.trim()) return;
  if (!canStartInterpret(state.activeTab)) return;
  if (input) input.value = "";
  askText(text);
}

function interpretInputBody() {
  const keys = [
    "system", "input_mode",
    "calendar", "year", "month", "day", "hour", "minute",
    "is_leap_month", "gender", "location", "longitude",
    "tz_offset", "timezone", "use_true_solar", "day_boundary", "as_of",
    "manual_birth_year", "pillars", "year_pillar", "month_pillar", "day_pillar", "hour_pillar",
    "visibility", "public_consent", "public_consent_version",
    "personal_case_id",
  ];
  const body = {};
  keys.forEach(k => {
    if (Object.prototype.hasOwnProperty.call(lastInput || {}, k)) body[k] = lastInput[k];
  });
  return body;
}

/* ============================================================
   后台任务解读：POST 创建任务，GET / SSE 接收生成中的正文与最终结果。
   ============================================================ */
async function requestInterpret(key, opts) {
  if (state.streaming) return;
  const loggedIn = await Account?.requireLogin({
    mode: "register",
    message: state.system === "liuyao" && lastInput?.visibility === "private"
      ? "这是一条私密问题，请先登录后继续解读。"
      : "登录后即可使用每日免费积分开始 AI 解读。",
  });
  if (!loggedIn) return;
  if (answerCreditsUnavailable()) {
    showAnswerCreditGate();
    return;
  }
  state.streaming = true;
  syncComposerState();
  const msg = pushAI(key, opts);
  msg.scenario = scenarioLabel(opts);
  msg.title = scenarioTitle(opts);
  startWaitingTicker(msg);
  requestThreadScrollBottom();
  renderThread();

  const body = { ...interpretInputBody(), scenario: opts.scenario, question: opts.question || "" };
  if (state.system) body.system = state.system;
  if (activeChartId) body.chart_id = activeChartId;
  body.session_id = sessionIdForTab(key);
  saveResumeCookie();
  if (opts.topic) body.topic = opts.topic;
  if (opts.month_branch) body.month_branch = opts.month_branch;
  if (activeProfileId) body.profile_id = activeProfileId;
  if (activePersonalCaseId) body.personal_case_id = activePersonalCaseId;
  const clientRequestId = createClientRequestId();
  body.client_request_id = clientRequestId;
  msg.clientRequestId = clientRequestId;
  const pendingFork = state.pendingFork?.key === key ? state.pendingFork : null;
  if (pendingFork) state.pendingFork = null;
  if (pendingFork?.fromTaskId) {
    body.branch_from_task_id = pendingFork.fromTaskId;
    body.branch_reason = pendingFork.reason || "manual";
  }
  if (pendingFork?.fromClientRequestId) {
    body.branch_from_client_request_id = pendingFork.fromClientRequestId;
    body.branch_reason = pendingFork.reason || "manual";
  }

  const postInterpret = async () => {
    const controller = new AbortController();
    msg.requestAbort = controller;
    try {
      return await fetch("/api/interpret", {
        method: "POST", headers: Account.csrfHeaders({ "Content-Type": "application/json" }), body: JSON.stringify(body), signal: controller.signal,
      });
    } finally {
      if (msg.requestAbort === controller) msg.requestAbort = null;
    }
  };

  try {
    let resp = await postInterpret();
    if (!msg.streaming || msg.stopped) return;
    if (resp.status === 401) {
      // SESSION RECOVERY · 会话失效时保留问题，原地重新登录后自动续发（design-146）
      stopWaitingTicker(msg);
      msg.status = "reauth";
      msg.waitText = "登录状态已失效，重新登录后继续这次解读。";
      msg.waitTextUpdatedAt = Date.now();
      refreshWaitingNode(msg);
      accountReauthInProgress = true;
      let relogged = false;
      try {
        await Account.refresh();
        if (!msg.streaming || msg.stopped) return;
        relogged = await Account.requireLogin({
          mode: "login",
          message: "登录状态已失效。重新登录后会自动继续刚才的问题，不需要重新输入。",
        });
      } finally {
        accountReauthInProgress = false;
      }
      if (!msg.streaming || msg.stopped) return;
      if (!relogged) throw new Error("登录状态已失效，问题已保留；重新登录后可继续解读。");
      setWaitingStatus(msg, "analysis");
      startWaitingTicker(msg);
      resp = await postInterpret();
      if (!msg.streaming || msg.stopped) return;
    }
    if (!resp.ok) throw new Error(await resp.text().catch(() => "请求失败"));
    const task = await resp.json();
    if (!msg.streaming || msg.stopped) return;
    if (!task.task_id) throw new Error("后端没有返回解读任务 ID");
    if (task.chart_id) applyMessageChartId(msg, task.chart_id);
    saveResumeCookie();
    msg.taskId = task.task_id;
    applyInterpretTask(msg, task);
    if (msg.streaming && !msg.error && !isTerminalTask(task)) {
      if (msg.streamable) startTaskEventStream(msg);
      else scheduleTaskPoll(msg);
    }
  } catch (e) {
    msg.requestAbort = null;
    if (msg.stopped || e?.name === "AbortError") return;
    finishInterpretMessage(msg, { error: humanError(String(e?.message || e)) });
  }
}

function scheduleTaskPoll(msg) {
  stopTaskEvents(msg);
  stopTaskPolling(msg);
  msg.pollTimer = setTimeout(
    () => pollInterpretTask(msg),
    msg.streamable ? INTERPRET_STREAM_POLL_MS : INTERPRET_POLL_MS,
  );
}

function startTaskEventStream(msg) {
  stopTaskPolling(msg);
  stopTaskEvents(msg);
  if (!window.EventSource || !msg.taskId) {
    scheduleTaskPoll(msg);
    return;
  }
  const source = new EventSource(`/api/interpret/tasks/${msg.taskId}/events`);
  msg.eventSource = source;
  source.addEventListener("task", ev => {
    if (!msg.streaming) return;
    try {
      const task = JSON.parse(ev.data || "{}");
      msg.pollFailures = 0;
      applyInterpretTask(msg, task);
      if (isTerminalTask(task)) stopTaskEvents(msg);
    } catch (_) {}
  });
  source.addEventListener("error", () => {
    stopTaskEvents(msg);
    if (msg.streaming && !msg.error) scheduleTaskPoll(msg);
  });
}

async function pollInterpretTask(msg) {
  if (!msg.streaming || !msg.taskId) return;
  try {
    const resp = await fetch(`/api/interpret/tasks/${msg.taskId}`);
    if (!resp.ok) throw new Error(await resp.text().catch(() => "查询任务失败"));
    const task = await resp.json();
    msg.pollFailures = 0;
    applyInterpretTask(msg, task);
    if (msg.streaming && !msg.error && !isTerminalTask(task)) scheduleTaskPoll(msg);
  } catch (_) {
    if (!msg.streaming) return;
    msg.pollFailures = (msg.pollFailures || 0) + 1;
    setWaitingStatus(msg, "网络暂时中断，后台任务还在继续；正在重试。");
    refreshWaitingNode(msg);
    scheduleTaskPoll(msg);
  }
}

function applyInterpretTask(msg, task) {
  if (!task || !msg.streaming) return;
  if (task.public_post) msg.publicPost = task.public_post;
  if (task.task_id) msg.taskId = task.task_id;
  if (task.chart_id) applyMessageChartId(msg, task.chart_id);
  if (task.chart_session_id) msg.chartSessionId = task.chart_session_id;
  if (task.profile_id) {
    applyMessageProfileId(msg, task.profile_id);
  }
  const archiveSyncKey = `${task.profile_id || msg.profileId || 0}:${task.status || ""}`;
  if (archiveSyncKey !== msg.archiveSyncKey && (task.profile_id || isTerminalTask(task))) {
    msg.archiveSyncKey = archiveSyncKey;
    refreshAccountArchiveState();
  }
  if (task.session_id) msg.sessionId = task.session_id;
  if (task.streamable) msg.streamable = true;
  if (task.credits) msg.credits = { ...task.credits };
  if (msg.streamable && Object.prototype.hasOwnProperty.call(task, "answer") && !isTerminalTask(task)) {
    applyStreamingAnswer(msg, task.answer || "");
  }
  if (task.status === "done") {
    msg.serverDone = true;
    if (msg.profileId && !msg.historySyncStarted) {
      msg.historySyncStarted = true;
      refreshMessageProfileHistory(msg).catch(() => {});
    }
    syncComposerState();
    if (msg.streamable || msg.streamedBody) {
      applyStreamingAnswer(msg, task.answer || msg.fullBody || msg.body || "", { complete: true });
    } else {
      startAnswerTypewriter(msg, task.answer || "");
    }
    return;
  }
  if (task.status === "failed") {
    const partial = String(task.answer || msg.fullBody || msg.body || "");
    if (partial.trim()) {
      stopTypewriter(msg);
      msg.fullBody = partial;
      msg.body = partial;
      msg.displayIndex = partial.length;
      msg.streamedBody = true;
    }
    finishInterpretMessage(msg, { error: humanError(task.error || "解读任务失败") });
    return;
  }
  if (task.status === "cancelled") {
    msg.stopped = true;
    finishInterpretMessage(msg, { body: task.answer || msg.body || "已停止生成。" });
    return;
  }
  setWaitingStatus(msg, task.stage || "analysis");
  refreshWaitingNode(msg);
}

function resetTypewriterCadence(msg) {
  msg.typeLastAt = 0;
  msg.typePendingChars = 0;
  msg.typeSkippedTicks = 0;
}

function commonPrefixLength(left, right) {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) index += 1;
  return index;
}

function updateStreamingAnswerNode(msg) {
  if (!msg?.id || state.screen !== "dash" || msg.threadKey !== state.activeTab) return false;
  const node = Array.from(document.querySelectorAll(".msg-ai")).find(item => item.dataset.id === msg.id);
  const bodyNode = node?.querySelector(".ai-body");
  if (!bodyNode) return false;
  const thread = $("#chat-thread");
  const followBottom = !!thread && !shouldDeferThreadRender()
    && threadBottomDistance(thread) <= CHAT_BOTTOM_THRESHOLD;
  const reasoningOpen = !!bodyNode.querySelector("details.ai-reasoning[open]");
  const streamStatus = msg.streaming && msg.streamable
    ? `<div class="ai-stream-status">${esc(streamStatusText(msg))}</div>`
    : "";
  bodyNode.innerHTML = `${renderBody(msg.body)}${msg.streaming ? '<span class="ai-cursor"></span>' : ""}${streamStatus}`;
  if (reasoningOpen) {
    const reasoning = bodyNode.querySelector("details.ai-reasoning");
    if (reasoning) reasoning.open = true;
  }
  updateElapsedNode(msg);
  if (followBottom) thread.scrollTop = thread.scrollHeight;
  return true;
}

function commitTypewriterFrame(msg, target) {
  msg.body = target.slice(0, msg.displayIndex || 0);
  msg.typePendingChars = 0;
  msg.typeSkippedTicks = 0;
  if (!updateStreamingAnswerNode(msg) && messageWorkspaceIsActive(msg) && msg.threadKey === state.activeTab && !shouldDeferThreadRender()) {
    scheduleRender();
  }
}

function startStreamingTypewriter(msg) {
  if (msg.typeFrame || !msg.streaming) return;
  const scheduleNext = () => {
    msg.typeFrame = window.requestAnimationFrame(tick);
  };
  const tick = now => {
    msg.typeFrame = null;
    if (!msg.streaming) return;
    const target = msg.fullBody || "";
    if ((msg.displayIndex || 0) > target.length) msg.displayIndex = target.length;
    const remaining = target.length - (msg.displayIndex || 0);
    if (remaining <= 0) {
      resetTypewriterCadence(msg);
      if (msg.finishWhenStreamCaughtUp) finishInterpretMessage(msg, { body: target });
      return;
    }
    if (!msg.typeLastAt) msg.typeLastAt = now;
    const speed = msg.finishWhenStreamCaughtUp
      ? TYPEWRITER_COMPLETE_CHARS_PER_SECOND
      : TYPEWRITER_CHARS_PER_SECOND;
    const charInterval = 1000 / speed;
    const elapsed = now - msg.typeLastAt;
    if (elapsed + TYPEWRITER_FRAME_TOLERANCE_MS < charInterval) {
      scheduleNext();
      return;
    }
    const suggestedLength = Math.max(1, Math.round(elapsed / charInterval));
    const startIndex = msg.displayIndex || 0;
    msg.displayIndex = Math.min(target.length, startIndex + suggestedLength);
    msg.typeLastAt = now;
    const emitted = msg.displayIndex - startIndex;
    msg.typePendingChars = (msg.typePendingChars || 0) + emitted;
    msg.typeSkippedTicks = (msg.typeSkippedTicks || 0) + 1;
    const boundarySample = target.slice(Math.max(0, startIndex - 2), msg.displayIndex);
    const caughtUp = msg.displayIndex >= target.length;
    const shouldCommit = caughtUp
      || msg.typePendingChars >= TYPEWRITER_COMMIT_MIN_CHARS
      || msg.typeSkippedTicks >= TYPEWRITER_COMMIT_MAX_TICKS
      || TYPEWRITER_BLOCK_BOUNDARY_RE.test(boundarySample);
    if (shouldCommit) commitTypewriterFrame(msg, target);
    if (caughtUp && msg.finishWhenStreamCaughtUp) {
      finishInterpretMessage(msg, { body: target });
      return;
    }
    scheduleNext();
  };
  scheduleNext();
}

function applyStreamingAnswer(msg, answer, opts = {}) {
  const next = answer || "";
  const previous = msg.fullBody || "";
  const hadStreamedBody = !!msg.streamedBody || !!msg.body;
  if (opts.complete) msg.finishWhenStreamCaughtUp = true;
  if (next !== previous) {
    const sharedPrefix = commonPrefixLength(previous, next);
    msg.fullBody = next;
    msg.streamedBody = !!next;
    if ((msg.displayIndex || 0) > sharedPrefix) {
      msg.displayIndex = sharedPrefix;
      msg.body = next.slice(0, msg.displayIndex);
      resetTypewriterCadence(msg);
    } else if (!msg.body || (msg.displayIndex || 0) > next.length) {
      msg.displayIndex = Math.min(msg.displayIndex || 0, next.length);
      msg.body = next.slice(0, msg.displayIndex);
    }
  }
  if (next) {
    stopWaitingTicker(msg);
    msg.waitText = "";
    startStreamingTypewriter(msg);
  } else if (hadStreamedBody) {
    stopTypewriter(msg);
    msg.fullBody = "";
    msg.body = "";
    msg.displayIndex = 0;
    msg.streamedBody = false;
    msg.finishWhenStreamCaughtUp = false;
    startWaitingTicker(msg);
    scheduleRender();
  }
}

function startAnswerTypewriter(msg, answer) {
  stopTaskPolling(msg);
  stopWaitingTicker(msg);
  stopTypewriter(msg);
  msg.status = "";
  msg.waitText = "";
  msg.fullBody = answer || "";
  msg.body = "";
  msg.displayIndex = 0;
  msg.finishWhenStreamCaughtUp = true;
  if (!msg.fullBody) {
    finishInterpretMessage(msg, { body: "" });
    return;
  }
  if (messageWorkspaceIsActive(msg)) renderThread();
  startStreamingTypewriter(msg);
}

function revealCompletedAnswer(msg) {
  if (!msg?.serverDone) return false;
  const body = msg.fullBody || msg.body || "";
  msg.finishWhenStreamCaughtUp = false;
  msg.displayIndex = body.length;
  finishInterpretMessage(msg, { body });
  toast("已显示完整回答");
  return true;
}

function focusCompletedAnswer(msg) {
  window.requestAnimationFrame(() => {
    if (!messageWorkspaceIsActive(msg) || state.screen !== "dash" || msg.threadKey !== state.activeTab) return;
    const target = Array.from(document.querySelectorAll(".msg-ai")).find(item => item.dataset.id === msg.id);
    target?.focus({ preventScroll: true });
  });
}

async function finishInterpretMessage(msg, { body = "", error = "" } = {}) {
  const active = document.activeElement;
  const activeWorkspace = messageWorkspaceIsActive(msg);
  const shouldFocusAnswer = activeWorkspace && !error && !msg.stopped && msg.threadKey === state.activeTab
    && (!active || active === document.body || active === $("#send-btn") || !!active.closest?.("#chat-thread"));
  if (msg.requestAbort) msg.requestAbort = null;
  stopTaskPolling(msg);
  stopTaskEvents(msg);
  stopWaitingTicker(msg);
  stopTypewriter(msg);
  if (body) msg.body = body;
  if (error) msg.error = error;
  if (!msg.completedAt) msg.completedAt = Date.now();
  msg.streaming = false;
  if ((msg.error && !msg.body) || msg.stopped) msg.followups = [];
  else msg.followups = suggestedFollowups(msg.threadKey || state.activeTab, msg);
  state.streaming = !!activeStreamingMessage();
  syncComposerState();
  if (activeWorkspace) renderThread();
  if (shouldFocusAnswer) focusCompletedAnswer(msg);
  if (!msg.error && msg.profileId) {
    try { await refreshMessageProfileHistory(msg); } catch (_) {}
  }
  if (!msg.error) Account?.refresh().then(syncCastUI).catch(() => {});
  renderTabs();
}
