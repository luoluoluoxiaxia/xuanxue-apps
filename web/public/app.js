"use strict";
/* ============================================================
   子平命盘分析系统 · 桌面端前端（零构建原生 JS）
   - 命盘 / 当前阶段：取自 POST /api/chart 的 full_payload（纯事实）
   - 对话解读：POST /api/interpret 创建任务，轮询拿到安全审查后的最终结果
   - 古典解读浮窗 / 古籍·名词：静态字典，不调 LLM
   - 趋势展示：消费后端投影分值，客户端只负责图形表达
   ============================================================ */

const Core = window.XuanxueCore;
if (!Core) throw new Error("XuanxueCore is not loaded");
const {
  $,
  $$,
  RESUME_COOKIE,
  RISK_ACK_TEXT,
  bindHorizontalTabKeys,
  clearCookie,
  createClientRequestId,
  createSessionId,
  normalizedRiskAcceptance,
  readCookie,
  validSessionId,
  writeCookie,
} = Core;
const ChatRenderer = window.XuanxueChatRenderer;
if (!ChatRenderer) throw new Error("XuanxueChatRenderer is not loaded");
const Account = window.XuanxueAccount;
const PersonalHome = window.XuanxuePersonalHome;
const CreditLedger = window.XuanxueCreditLedger;
const LocationPickerModule = window.XuanxueLocationPicker;
if (!LocationPickerModule) throw new Error("XuanxueLocationPicker is not loaded");
const ChartDomain = window.XuanxueChartDomain;
if (!ChartDomain) throw new Error("XuanxueChartDomain is not loaded");
const {
  CN_NUM,
  EL_PAPER,
  GAN_CHARS,
  GLOSSARY,
  GLOSSARY_BU,
  GODPHRASE,
  LY_YAO_NAME,
  PILLAR_ROLE,
  WUXING_ORDER,
  ZHI_CHARS,
} = ChartDomain;
const esc = ChatRenderer.escapeHtml;
const DayunMechanicsModule = window.XuanxueDayunMechanics;
if (!DayunMechanicsModule) throw new Error("XuanxueDayunMechanics is not loaded");
const DayunMechanics = DayunMechanicsModule.create({ escapeHtml: esc });
const LIUYAO_PUBLIC_CONSENT_VERSION = "liuyao-public-v2";
const COMMUNITY_HELP_CONSENT_VERSION = "community-help-v1";

/* ---------- 子平常量 ---------- */
/* ---------- 应用状态 ---------- */
const TABS = [
  { key: "解读", label: "命理解读", scenario: "topic", topic: "" },
];
const TAB_BY_KEY = Object.fromEntries(TABS.map(t => [t.key, t]));
/* 六爻一事一断：单场景「断卦」。算种相关的 tab 集由 currentTabs()/tabOf() 分派。 */
const LIUYAO_TABS = [
  { key: "断卦", label: "断卦", scenario: "divination" },
];
const LIUYAO_TAB_BY_KEY = Object.fromEntries(LIUYAO_TABS.map(t => [t.key, t]));
function currentTabs() { return state.system === "liuyao" ? LIUYAO_TABS : TABS; }
function tabOf(key) { return (state.system === "liuyao" ? LIUYAO_TAB_BY_KEY : TAB_BY_KEY)[key]; }
const ChatCopyModule = window.XuanxueChatCopy;
if (!ChatCopyModule) throw new Error("XuanxueChatCopy is not loaded");
const {
  BAZI_STARTER_QUESTIONS,
  DEFAULT_Q,
  LIUYAO_WAITING_LINES,
  WAITING_LINES,
} = ChatCopyModule;
const INTERPRET_POLL_MS = 5000;
const INTERPRET_STREAM_POLL_MS = 1000;
const WAITING_TEXT_ROTATE_MS = 5000;
// ANSWER REVEAL UX · 上游增量进入缓冲区，页面按帧匀速消费，避免“蹦一截、停一下”。
const TYPEWRITER_CHARS_PER_SECOND = 50;
const TYPEWRITER_COMPLETE_CHARS_PER_SECOND = 100000;
const TYPEWRITER_FRAME_TOLERANCE_MS = 8.3;
const TYPEWRITER_COMMIT_MIN_CHARS = 12;
const TYPEWRITER_COMMIT_MAX_TICKS = 3;
const TYPEWRITER_BLOCK_BOUNDARY_RE = /\n\n|```|\[\(/;
const CHAT_BOTTOM_THRESHOLD = 80;
function sessionIdForTab(key) {
  if (!state.sessionIds[key]) state.sessionIds[key] = createSessionId();
  return state.sessionIds[key];
}
function handleAccountAuthChange(event) {
  const authenticated = !!event.detail?.authenticated;
  if (authenticated) {
    appHadAuthenticatedAccount = true;
    renderProfileFab();
    refreshAccountProfileIndex().catch(() => {});
    return;
  }
  resetAccountProfileIndex();
  clearCookie(RESUME_COOKIE);
  if (!appHadAuthenticatedAccount) return;
  if (accountReauthInProgress) {
    appHadAuthenticatedAccount = false;
    renderProfileFab();
    return;
  }
  appHadAuthenticatedAccount = false;
  stopAllPendingWork();
  window.location.replace("/");
}
function readResumeCookie() {
  const raw = readCookie(RESUME_COOKIE);
  if (!raw) return null;
  try {
    const data = JSON.parse(decodeURIComponent(raw));
    return data && data.v === 1 ? data : null;
  } catch (_) {
    clearCookie(RESUME_COOKIE);
    return null;
  }
}
function saveResumeCookie() {
  if (!activeChartId && !activeProfileId) return;
  const updatedAt = Date.now();
  touchWorkspaceActivity(currentWorkspaceKey(), updatedAt);
  const activeKey = tabOf(state.activeTab) ? state.activeTab : currentTabs()[0]?.key;
  if (activeKey) sessionIdForTab(activeKey);
  const sessionIds = {};
  Object.entries(state.sessionIds || {}).forEach(([key, sid]) => {
    if (validSessionId(sid)) sessionIds[key] = sid;
  });
  writeCookie(RESUME_COOKIE, JSON.stringify({
    v: 1,
    system: state.system,
    profile_name: profileName || "",
    profile_id: activeProfileId || 0,
    chart_id: activeChartId || 0,
    personal_case_id: activePersonalCaseId || "",
    active_tab: state.activeTab || "",
    session_ids: sessionIds,
    updated_at: updatedAt,
  }));
}
function restoreResumeSessionIds(resume) {
  resumeSessionEntries(resume).forEach(([key, sid]) => {
    if (validSessionId(sid)) state.sessionIds[key] = sid;
  });
}

function resumeSessionEntries(resume) {
  const entries = Object.entries(resume?.session_ids || {}).filter(([, sid]) => validSessionId(sid));
  if (resume?.system === "liuyao") {
    const chosen = entries.find(([key]) => key === "断卦") || entries.find(([key]) => key === resume?.active_tab) || entries[0];
    return chosen ? [["断卦", chosen[1]]] : [];
  }
  // 旧版八字按话题保存了多条并行会话。新版只恢复当时正在看的那一条，
  // 其他回答仍保留在档案历史里，避免把不同旧会话硬拼成一段上下文。
  const chosen = entries.find(([key]) => key === "解读") || entries.find(([key]) => key === resume?.active_tab) || entries[0];
  return chosen ? [["解读", chosen[1]]] : [];
}
function nameFromPayload(system, payload, fallback = "命盘") {
  if (system === "liuyao") return payload?.ben_gua?.name || "六爻";
  return payload?.chart?.pillars?.day ? `${payload.chart.pillars.day}日` : fallback;
}
function calendarFromInput(system, input) {
  if (system === "liuyao") return "六爻";
  return input?.input_mode === "manual_pillars" ? "" : (input?.calendar === "lunar" ? "农历" : "公历");
}
function chatRowsToThread(key, rows = []) {
  const thread = [];
  let lastUser = "";
  rows.forEach(row => {
    if (row.role === "user") {
      lastUser = row.content || "";
      thread.push({ kind: "user", text: lastUser });
      return;
    }
    if (row.role !== "assistant") return;
    const restoredMsg = {
      kind: "ai",
      id: "c" + row.id,
      messageId: row.id || null,
      taskId: row.task_id || "",
      chartId: row.chart_id || null,
      chartSessionId: row.chart_session_id || null,
      scenario: scenarioLabel({ scenario: row.scenario || "natal", topic: row.topic || "" }),
      title: "历史对话",
      body: row.content || "",
      streaming: false,
      followups: [],
      error: "",
      feedbackReaction: row.feedback_reaction || "",
      feedbackSaved: !!row.feedback_reaction,
      feedbackPending: false,
      feedbackError: "",
      publicPost: row.public_post || null,
      rawScenario: row.scenario || "natal",
      rawTopic: row.topic || "",
      rawQuestion: lastUser,
    };
    restoredMsg.followups = suggestedFollowups(key, restoredMsg);
    thread.push(restoredMsg);
  });
  return thread;
}
function restoredTaskTime(value, fallback = Date.now()) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}
function restoreTaskMessage(key, task) {
  if (!task?.task_id || task.status === "done") return null;
  state.threads[key] = state.threads[key] || [];
  if (state.threads[key].some(message => message.kind === "ai" && message.taskId === task.task_id)) return null;
  const question = String(task.question || "").trim();
  const messages = state.threads[key];
  const last = messages[messages.length - 1];
  if (question && !(last?.kind === "user" && last.text === question)) pushUser(key, question);
  const opts = {
    scenario: task.scenario || (state.system === "liuyao" ? "divination" : "natal"),
    topic: task.topic || "",
    question,
  };
  const msg = pushAI(key, opts);
  msg.taskId = task.task_id;
  msg.clientRequestId = task.client_request_id || "";
  msg.chartId = task.chart_id || activeChartId || null;
  msg.chartSessionId = task.chart_session_id || null;
  msg.sessionId = task.session_id || sessionIdForTab(key);
  msg.scenario = scenarioLabel(opts);
  msg.title = scenarioTitle(opts);
  msg.createdAt = restoredTaskTime(task.created_at);
  msg.completedAt = task.completed_at ? restoredTaskTime(task.completed_at, 0) : 0;
  msg.streamable = task.streamable !== false;
  if (task.public_post) msg.publicPost = task.public_post;
  if (task.status === "failed") {
    msg.streaming = false;
    msg.error = humanError(task.error || "本次解读没有完成");
    const partial = String(task.answer || "");
    if (partial.trim()) {
      msg.fullBody = partial;
      msg.body = partial;
      msg.displayIndex = partial.length;
      msg.streamedBody = true;
    }
    if (!msg.completedAt) msg.completedAt = restoredTaskTime(task.updated_at);
    return msg;
  }
  if (task.status === "cancelled") {
    msg.streaming = false;
    msg.stopped = true;
    msg.body = String(task.answer || "已停止生成。").trim();
    if (!msg.body.includes("编辑刚才的问题")) {
      msg.body += "\n\n已停止生成。编辑问题后可分叉重发。";
    }
    if (!msg.completedAt) msg.completedAt = restoredTaskTime(task.updated_at);
    return msg;
  }
  setWaitingStatus(msg, task.stage || "analysis");
  const partial = String(task.answer || "");
  if (partial) {
    msg.fullBody = partial;
    msg.body = partial;
    msg.displayIndex = partial.length;
    msg.streamedBody = true;
  }
  return msg;
}
function restoreActiveTasks(items = []) {
  const pending = [];
  items.forEach(item => {
    if (!item?.ok || !item.active_task) return;
    const key = tabOf(item.key)
      ? item.key
      : historyTabKey({ scenario: item.active_task.scenario || "natal", topic: item.active_task.topic || "" });
    const msg = restoreTaskMessage(key, item.active_task);
    if (msg?.streaming) pending.push(msg);
  });
  state.streaming = pending.length > 0;
  pending.forEach(msg => {
    startWaitingTicker(msg);
    if (msg.streamable) startTaskEventStream(msg);
    else scheduleTaskPoll(msg);
  });
}
async function restoreResumeFromCookie({ expectedSystem = "", requireRecent = false } = {}) {
  const resume = readResumeCookie();
  if (!resume?.chart_id) return false;
  if (expectedSystem && resume.system !== expectedSystem) return false;
  if (requireRecent && !withinWorkspaceReopenWindow(resume.updated_at)) {
    clearCookie(RESUME_COOKIE);
    return false;
  }
  const items = resumeSessionEntries(resume)
    .map(([key, sid]) => ({
      key,
      chart_id: Number(resume.chart_id || 0),
      session_id: sid,
      profile_id: Number(resume.profile_id || 0) || null,
      limit: 80,
    }));
  if (!items.length) return false;
  try {
    const r = await fetch("/api/resume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
    if (!r.ok) throw new Error(await r.text());
    const data = await r.json();
    const restored = (data.items || []).filter(item => item.ok);
    if (!restored.length) { clearCookie(RESUME_COOKIE); return false; }
    const main = restored.find(item => item.profile) || restored[0];
    state.system = main.system || resume.system || "bazi";
    lastInput = main.input || null;
    lastPayload = main.payload || null;
    activeChartId = main.chart_id || lastPayload?.chart_id || null;
    activeProfileId = main.profile?.id || null;
    activeHistory = main.profile?.history || [];
    profileName = main.profile?.name || resume.profile_name || nameFromPayload(state.system, lastPayload);
    calendarLabel = calendarFromInput(state.system, lastInput);
    resetThreads();
    restoreResumeSessionIds(resume);
    restored.forEach(item => {
      const key = tabOf(item.key) ? item.key : historyTabKey({ scenario: item.messages?.[0]?.scenario || "natal", topic: item.messages?.[0]?.topic || "" });
      state.threads[key] = chatRowsToThread(key, item.messages || []);
    });
    state.activeTab = tabOf(resume.active_tab) ? resume.active_tab : currentTabs()[0].key;
    restoreActiveTasks(restored);
    return true;
  } catch (_) {
    return false;
  }
}

const state = {
  screen: "landing",
  mode: "basic",
  system: "bazi",
  sessionIds: {},
  activeTab: "解读",
  threads: {},
  riskAcceptedTabs: normalizedRiskAcceptance(),
  streaming: false,
  pendingFork: null,
};
let lastInput = null;
let lastPayload = null;
let activeChartId = null;
let profileName = "命盘";
let calendarLabel = "公历";
let activeProfileId = null;
let activePersonalCaseId = "";
let activePersonalCase = null;
let activeDetailedBaziProfile = null;
let detailedBaziProfileRequest = null;
let pendingCombinedEntry = false;
let pendingCommunityHelp = false;
const DETAILED_PUBLIC_ENTRY_ENABLED = false;

async function createCommunityHelp(profileId, question) {
  const response = await fetch("/api/community/help-posts", {
    method: "POST",
    headers: Account.csrfHeaders({
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Xuanshu-Interaction": "same-origin-v1",
    }),
    credentials: "same-origin",
    body: JSON.stringify({
      profile_id: Number(profileId || 0),
      question: String(question || "").trim(),
      consent_version: COMMUNITY_HELP_CONSENT_VERSION,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.detail || "求助发布失败，请稍后再试");
  return payload;
}

function closeCommunityHelpDialog() {
  const dialog = document.querySelector("[data-community-help-dialog]");
  if (dialog?.open) dialog.close();
}

async function openCommunityHelpDialog() {
  if (!activeProfileId || !lastPayload) {
    toast("请先完成排盘或起卦，再向社区求助", "warn");
    return;
  }
  const loggedIn = await Account?.requireLogin({
    mode: "register",
    message: "登录并验证邮箱后可免费求助，不调用 AI，不扣积分。",
  });
  if (!loggedIn) return;
  const dialog = document.querySelector("[data-community-help-dialog]");
  const form = dialog?.querySelector("[data-community-help-form]");
  if (!dialog || !form) return;
  const chartCopy = dialog.querySelector("[data-community-help-chart]");
  if (chartCopy) chartCopy.textContent = state.system === "liuyao"
    ? "将公开当前卦象、所问和社区昵称；邮箱不会展示。求助内容需与起卦时所问一致。"
    : "将公开四柱、日主、五行数量和社区昵称；出生日期、时刻、地点与邮箱不会展示。";
  const question = form.elements.question;
  if (state.system === "liuyao") {
    question.value = String(lastPayload.question || lastInput?.question || "");
    question.readOnly = true;
  } else {
    question.readOnly = false;
    if (!question.value) question.value = "请大家帮我看看这个命盘，重点想了解：";
  }
  const stateNode = dialog.querySelector("[data-community-help-state]");
  if (stateNode) stateNode.textContent = "";
  if (!dialog.open) dialog.showModal();
  requestAnimationFrame(() => (question.readOnly ? form.elements.consent : question)?.focus({ preventScroll: true }));
}

function setupCommunityHelpDialog() {
  const dialog = document.querySelector("[data-community-help-dialog]");
  const form = dialog?.querySelector("[data-community-help-form]");
  if (!dialog || !form) return;
  dialog.querySelectorAll("[data-community-help-close]").forEach(button => {
    button.addEventListener("click", closeCommunityHelpDialog);
  });
  dialog.addEventListener("click", event => {
    if (event.target === dialog) closeCommunityHelpDialog();
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const stateNode = dialog.querySelector("[data-community-help-state]");
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.textContent = "正在发布…";
    if (stateNode) stateNode.textContent = "正在检查隐私并生成公开帖子…";
    try {
      const payload = await createCommunityHelp(activeProfileId, form.elements.question.value);
      location.assign(payload.post?.url || `/community/${encodeURIComponent(payload.post?.slug || "")}`);
    } catch (error) {
      if (stateNode) stateNode.textContent = humanError(String(error?.message || error));
      submit.disabled = false;
      submit.textContent = "发布求助";
    }
  });
}

function setActivePersonalCase(item) {
  activePersonalCase = item && typeof item === "object" ? item : null;
  activePersonalCaseId = String(activePersonalCase?.id || "");
  const baziProfileId = Number(activePersonalCase?.bazi_profile_id || 0);
  if (!baziProfileId || Number(activeDetailedBaziProfile?.id || 0) !== baziProfileId) {
    activeDetailedBaziProfile = null;
  }
}

function clearPersonalCaseContext() {
  activePersonalCaseId = "";
  activePersonalCase = null;
  activeDetailedBaziProfile = null;
  detailedBaziProfileRequest = null;
  pendingCombinedEntry = false;
  const url = new URL(window.location.href);
  if (!url.searchParams.has("personal_case") && !url.searchParams.has("resume_case") && !url.searchParams.has("flow")) return;
  url.searchParams.delete("personal_case");
  url.searchParams.delete("resume_case");
  url.searchParams.delete("flow");
  history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

function detailedWorkspaceActive() {
  return state.system === "liuyao" && !!activePersonalCaseId && !!lastPayload;
}
let activeHistory = [];
let pendingStartAfterRiskAck = "";
let feedbackRating = "";
let appHadAuthenticatedAccount = false;
let accountReauthInProgress = false;
let pendingProfileDeleteId = null;
let deletingProfileId = null;
let profileLibraryRequestId = 0;
let profileArchiveTab = "bazi";
let pendingHistoryDeleteId = null;
let deletingHistoryId = null;
let renderedThreadKey = "";
let forceThreadScrollBottom = false;
let activePillarKey = "";
let activePillarStem = "";
let suppressPillarFocus = false;
let ritualTimer = null;
let ritualShowTimer = null;
let ritualHideTimer = null;
let ritualShownAt = 0;
let chartDrawerOpener = null;
let chartDrawerHistoryRegistered = false;
const CHART_DRAWER_OVERLAY_ID = "app-chart-drawer";
const RITUAL_REVEAL_DELAY_MS = 140;
const RITUAL_MIN_VISIBLE_MS = 280;

/* ---------- 断点：≥1024px 桌面双栏，<1024px 手机单列 ---------- */
const desktopQuery = window.matchMedia("(min-width: 1024px)");
function isDesktopLayout() { return desktopQuery.matches; }
function syncLayout() {
  document.body.dataset.layout = isDesktopLayout() ? "desktop" : "mobile";
  if (isDesktopLayout()) closeChartDrawer();
  syncAppViewportHeight();
  syncManualPillarInputs();
  applyBigText();
}
if (typeof desktopQuery.addEventListener === "function") desktopQuery.addEventListener("change", syncLayout);
else if (typeof desktopQuery.addListener === "function") desktopQuery.addListener(syncLayout);

let appViewportTimer = null;
function isEditableFocused() {
  const el = document.activeElement;
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (!["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return false;
  return !el.disabled && !el.readOnly;
}
function appViewportHeight() {
  const vv = window.visualViewport;
  const layoutHeight = window.innerHeight || document.documentElement.clientHeight || vv?.height || 0;
  if (!isDesktopLayout() && vv && isEditableFocused()) {
    return Math.max(320, Math.round(vv.height));
  }
  return Math.max(320, Math.round(layoutHeight));
}
function resetWindowScrollIfDashboard() {
  if (state.screen !== "dash" || isDesktopLayout()) return;
  if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
}
function syncAppViewportHeight() {
  document.documentElement.style.setProperty("--app-viewport-height", `${appViewportHeight()}px`);
  resetWindowScrollIfDashboard();
}
function scheduleAppViewportSync(delay = 0) {
  if (delay > 0) {
    window.setTimeout(syncAppViewportHeight, delay);
    return;
  }
  if (appViewportTimer) window.clearTimeout(appViewportTimer);
  appViewportTimer = window.setTimeout(() => {
    appViewportTimer = null;
    syncAppViewportHeight();
  }, 0);
}
function setupMobileViewportGuards() {
  syncAppViewportHeight();
  window.addEventListener("resize", () => scheduleAppViewportSync(), { passive: true });
  window.addEventListener("orientationchange", () => {
    scheduleAppViewportSync();
    scheduleAppViewportSync(280);
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", () => scheduleAppViewportSync(), { passive: true });
    window.visualViewport.addEventListener("scroll", () => scheduleAppViewportSync(), { passive: true });
  }
  document.addEventListener("focusin", e => {
    if (!["INPUT", "TEXTAREA", "SELECT"].includes(e.target?.tagName || "")) return;
    scheduleAppViewportSync();
    scheduleAppViewportSync(80);
  });
  document.addEventListener("focusout", e => {
    if (!["INPUT", "TEXTAREA", "SELECT"].includes(e.target?.tagName || "")) return;
    scheduleAppViewportSync();
    scheduleAppViewportSync(180);
    scheduleAppViewportSync(520);
  });
}

/* ---------- 桌面大字模式：手机端不展示、不生效 ---------- */
const BIG_TEXT_KEY = "xz-big-text";
let bigText = false;
try { bigText = localStorage.getItem(BIG_TEXT_KEY) === "1"; } catch (_) {}
function applyBigText() {
  const enabled = bigText && isDesktopLayout();
  document.documentElement.classList.toggle("big-text", enabled);
  $$("[data-big-toggle]").forEach(b => {
    b.textContent = (bigText ? "标准字" : "大字") + (b.dataset.bigSuffix || "");
  });
}
function toggleBigText() {
  bigText = !bigText;
  try { localStorage.setItem(BIG_TEXT_KEY, bigText ? "1" : "0"); } catch (_) {}
  applyBigText();
  toast(bigText ? "已开启大字模式" : "已恢复标准字号");
}

/* ---------- 三工作区并存：命 / 卦 / 详断随切随回，生成任务继续在后台运行 ---------- */
const WORKSPACE_REOPEN_WINDOW_MS = 10 * 60 * 1000;
const sessionStore = { bazi: null, liuyao: null, detailed: null };
const workspaceActivityAt = { bazi: 0, liuyao: 0, detailed: 0 };
const accountProfileIndex = { bazi: null, liuyao: null };
let accountProfileIndexRequest = null;
let accountProfileIndexGeneration = 0;

function profileSystemKey(profile) {
  return (profile?.system || profile?.summary?.system) === "liuyao" ? "liuyao" : "bazi";
}

function setAccountProfileIndex(profiles = []) {
  accountProfileIndex.bazi = null;
  accountProfileIndex.liuyao = null;
  (Array.isArray(profiles) ? profiles : []).forEach(profile => {
    const system = profileSystemKey(profile);
    const current = accountProfileIndex[system];
    const shouldReplace = !current
      || (system === "bazi" && !!profile.is_default && !current.is_default)
      || (!!profile.is_default === !!current.is_default
        && Number(profile.id || 0) > Number(current.id || 0));
    if (shouldReplace) {
      accountProfileIndex[system] = profile;
    }
  });
  if (state.screen === "dash" && lastPayload) renderSessionSwitcher(state.system);
}

function resetAccountProfileIndex() {
  accountProfileIndexGeneration += 1;
  accountProfileIndexRequest = null;
  setAccountProfileIndex([]);
}

function accountProfileFor(system) {
  return accountProfileIndex[system === "liuyao" ? "liuyao" : "bazi"] || null;
}

function activityTimestamp(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function withinWorkspaceReopenWindow(value, now = Date.now()) {
  const timestamp = activityTimestamp(value);
  const elapsed = now - timestamp;
  return timestamp > 0 && elapsed >= 0 && elapsed <= WORKSPACE_REOPEN_WINDOW_MS;
}

function workspaceSnapshotHasActiveWork(snapshot) {
  return Object.values(snapshot?.threads || {}).some(messages =>
    (Array.isArray(messages) ? messages : []).some(message => message?.kind === "ai" && message.streaming),
  );
}

function touchWorkspaceActivity(target = currentWorkspaceKey(), updatedAt = Date.now()) {
  if (!Object.prototype.hasOwnProperty.call(workspaceActivityAt, target)) return;
  workspaceActivityAt[target] = updatedAt;
  if (sessionStore[target]) sessionStore[target].updatedAt = updatedAt;
}

function workspaceRecentlyActive(target, now = Date.now()) {
  const snapshot = sessionStore[target];
  if (workspaceSnapshotHasActiveWork(snapshot)) return true;
  if (currentWorkspaceKey() === target && activeStreamingMessage()) return true;
  const resume = readResumeCookie();
  const resumeAt = resume?.system === target ? activityTimestamp(resume.updated_at) : 0;
  const updatedAt = Math.max(
    activityTimestamp(snapshot?.updatedAt),
    activityTimestamp(workspaceActivityAt[target]),
    resumeAt,
  );
  return withinWorkspaceReopenWindow(updatedAt, now);
}

function profileRecentlyCreated(profile, now = Date.now()) {
  return withinWorkspaceReopenWindow(profile?.created_at, now);
}

async function refreshAccountProfileIndex({ force = false } = {}) {
  if (!Account?.snapshot()?.authenticated) {
    resetAccountProfileIndex();
    return accountProfileIndex;
  }
  if (accountProfileIndexRequest && !force) return accountProfileIndexRequest;
  const generation = ++accountProfileIndexGeneration;
  const request = (async () => {
    const response = await fetch("/api/profiles", { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(await response.text());
    const profiles = await response.json();
    if (generation === accountProfileIndexGeneration && Account?.snapshot()?.authenticated) {
      setAccountProfileIndex(profiles);
    }
    return accountProfileIndex;
  })();
  accountProfileIndexRequest = request;
  try {
    return await request;
  } finally {
    if (accountProfileIndexRequest === request) accountProfileIndexRequest = null;
  }
}

// ACCOUNT ARCHIVE SYNC · 档案或解读变化后立即刷新账户概览（design-149）
async function refreshAccountArchiveState() {
  if (!Account?.snapshot()?.authenticated) return;
  await Promise.allSettled([
    Account.refresh(),
    refreshAccountProfileIndex({ force: true }),
  ]);
}
function currentWorkspaceKey(screen = state.screen) {
  if (detailedWorkspaceActive() || pendingCombinedEntry) return "detailed";
  if (screen === "birth") return "bazi";
  if (screen === "cast") return "liuyao";
  return state.system === "liuyao" ? "liuyao" : "bazi";
}
function snapshotSession(workspaceScreen = state.screen) {
  const workspaceKey = currentWorkspaceKey(workspaceScreen);
  const updatedAt = Date.now();
  workspaceActivityAt[workspaceKey] = updatedAt;
  return {
    system: state.system,
    workspaceScreen,
    updatedAt,
    lastInput, lastPayload, activeChartId, profileName, calendarLabel,
    activeProfileId, activeHistory,
    threads: state.threads, sessionIds: state.sessionIds,
    riskAcceptedTabs: state.riskAcceptedTabs, pendingFork: state.pendingFork,
    activeTab: state.activeTab,
    activePersonalCaseId, activePersonalCase, activeDetailedBaziProfile,
    pendingCombinedEntry,
    castDraft: workspaceKey === "liuyao" || workspaceKey === "detailed" ? snapshotCastDraft() : null,
  };
}
function restoreSession(snap) {
  state.system = snap.system === "liuyao" ? "liuyao" : "bazi";
  lastInput = snap.lastInput;
  lastPayload = snap.lastPayload;
  activeChartId = snap.activeChartId;
  profileName = snap.profileName;
  calendarLabel = snap.calendarLabel;
  activeProfileId = snap.activeProfileId;
  activeHistory = snap.activeHistory;
  state.threads = snap.threads;
  state.sessionIds = snap.sessionIds;
  state.riskAcceptedTabs = normalizedRiskAcceptance(snap.riskAcceptedTabs);
  state.pendingFork = snap.pendingFork;
  state.activeTab = snap.activeTab;
  activePersonalCaseId = snap.activePersonalCaseId || "";
  activePersonalCase = snap.activePersonalCase || null;
  activeDetailedBaziProfile = snap.activeDetailedBaziProfile || null;
  detailedBaziProfileRequest = null;
  pendingCombinedEntry = !!snap.pendingCombinedEntry;
  if (snap.castDraft) restoreCastDraft(snap.castDraft);
  touchWorkspaceActivity(currentWorkspaceKey());
}
function stashCurrentWorkspace(workspaceScreen = state.screen) {
  if (!lastPayload && workspaceScreen !== "birth" && workspaceScreen !== "cast") return;
  sessionStore[currentWorkspaceKey(workspaceScreen)] = snapshotSession(workspaceScreen);
}
function restoreWorkspaceScreen(snap, target) {
  restoreSession(snap);
  threadScrollLock = { key: state.activeTab, locked: false };
  if (snap.lastPayload) {
    enterDashboard({ historyMode: state.screen === "landing" ? "push" : "replace", focusPage: true });
    saveResumeCookie();
    return true;
  }
  if (snap.workspaceScreen === "birth" && target === "bazi") {
    showScreen("birth", { historyMode: "push", focusPage: true });
    return true;
  }
  if (snap.workspaceScreen === "cast" && (target === "liuyao" || target === "detailed")) {
    syncCastEntryMode();
    syncCastMethod();
    showScreen("cast", { historyMode: "push", focusPage: true });
    return true;
  }
  return false;
}
async function switchToSystem(target) {
  const current = currentWorkspaceKey();
  if (current === target && lastPayload) {
    if (!workspaceRecentlyActive(target)) return false;
    enterDashboard({ historyMode: state.screen === "landing" ? "push" : "replace", focusPage: true });
    return true;
  }
  const snap = sessionStore[target];
  if (!snap) return false;
  if (!workspaceRecentlyActive(target)) {
    sessionStore[target] = null;
    workspaceActivityAt[target] = 0;
    return false;
  }
  if (current !== target) stashCurrentWorkspace();
  return restoreWorkspaceScreen(snap, target);
}

async function openSystemWorkspace(target) {
  if (await switchToSystem(target)) return;
  if (await restoreResumeFromCookie({ expectedSystem: target, requireRecent: true })) {
    enterDashboard({ historyMode: state.screen === "landing" ? "push" : "replace", focusPage: true });
    return;
  }
  const current = currentWorkspaceKey();
  if (current !== target) stashCurrentWorkspace();
  sessionStore[target] = null;
  workspaceActivityAt[target] = 0;
  const saved = accountProfileFor(target);
  if (saved?.id && (["pending", "running"].includes(saved.task_status) || profileRecentlyCreated(saved))) {
    toast(target === "liuyao" ? "打开卦档…" : "打开命盘…");
    await openSavedProfile(Number(saved.id));
    return;
  }
  clearPersonalCaseContext();
  if (target === "liuyao") openCastModal({ clearQuestion: true, fresh: true });
  else openBirthModal({ fresh: true });
}

async function openDetailedWorkspace() {
  const current = currentWorkspaceKey();
  if (current === "detailed") {
    if (lastPayload) {
      enterDashboard({ historyMode: state.screen === "landing" ? "push" : "replace", focusPage: true });
      return true;
    }
    if (pendingCombinedEntry) {
      syncCastEntryMode();
      syncCastMethod();
      showScreen("cast", { historyMode: "push", focusPage: true });
      return true;
    }
  }
  const snap = sessionStore.detailed;
  if (snap) {
    stashCurrentWorkspace();
    if (restoreWorkspaceScreen(snap, "detailed")) return true;
  }
  stashCurrentWorkspace();
  return !!(await PersonalHome?.openDetailed());
}

/* ---------- 手机版看盘抽屉 ---------- */
function chartDrawerIsOpen() {
  return document.body.classList.contains("chart-open");
}

function centerActiveDayunTimeline() {
  const strip = $("#dayun-timeline .dayun-strip-main");
  const active = $("#dayun-timeline [data-dayun-selected]") || $("#dayun-timeline [data-dayun-current]");
  if (!strip || !active || !strip.clientWidth) return;
  const stripBox = strip.getBoundingClientRect();
  const activeBox = active.getBoundingClientRect();
  const activeCenter = activeBox.left - stripBox.left + strip.scrollLeft + activeBox.width / 2;
  strip.scrollLeft = Math.max(0, activeCenter - strip.clientWidth / 2);
}

function centerSelectedLiunianTimeline() {
  const strip = $("#dayun-timeline .liunian-strip");
  const selected = $("#dayun-timeline [data-liunian-selected]") || $("#dayun-timeline .liunian-year-card.current");
  if (!strip || !selected || !strip.clientWidth) return;
  const stripBox = strip.getBoundingClientRect();
  const selectedBox = selected.getBoundingClientRect();
  const selectedCenter = selectedBox.left - stripBox.left + strip.scrollLeft + selectedBox.width / 2;
  strip.scrollLeft = Math.max(0, selectedCenter - strip.clientWidth / 2);
}

function openChartDrawerNow() {
  if (state.screen !== "dash") return;
  document.body.classList.add("chart-open");
  const mask = $("#chart-mask");
  if (mask) mask.hidden = false;
  if (!isDesktopLayout()) {
    const drawer = $("#chart-rail");
    const active = document.activeElement;
    chartDrawerOpener = availableModalFocusTarget(active) ? active : $("#open-chart-btn");
    drawer?.setAttribute("role", "dialog");
    drawer?.setAttribute("aria-modal", "true");
    window.requestAnimationFrame(() => {
      if (!document.body.classList.contains("chart-open")) return;
      $("#chart-rail-close")?.focus({ preventScroll: true });
      centerActiveDayunTimeline();
      centerSelectedLiunianTimeline();
    });
  }
}

function closeChartDrawerNow() {
  const wasOpen = chartDrawerIsOpen();
  document.body.classList.remove("chart-open");
  const mask = $("#chart-mask");
  if (mask) mask.hidden = true;
  const drawer = $("#chart-rail");
  drawer?.removeAttribute("role");
  drawer?.removeAttribute("aria-modal");
  const restore = chartDrawerOpener;
  chartDrawerOpener = null;
  if (wasOpen && !isDesktopLayout() && state.screen === "dash" && availableModalFocusTarget(restore)) {
    window.requestAnimationFrame(() => restore.focus({ preventScroll: true }));
  }
}

function registerChartDrawerOverlay() {
  const overlay = window.XuanOverlayHistory;
  if (!overlay || chartDrawerHistoryRegistered) return;
  chartDrawerHistoryRegistered = true;
  overlay.register(CHART_DRAWER_OVERLAY_ID, {
    isOpen: chartDrawerIsOpen,
    open: () => { if (!isDesktopLayout()) openChartDrawerNow(); },
    close: closeChartDrawerNow,
  });
}

function openChartDrawer() {
  if (state.screen !== "dash") return undefined;
  const overlay = window.XuanOverlayHistory;
  if (!isDesktopLayout() && overlay) {
    registerChartDrawerOverlay();
    return overlay.open(CHART_DRAWER_OVERLAY_ID);
  }
  return openChartDrawerNow();
}

function closeChartDrawer(afterClose = null) {
  const overlay = window.XuanOverlayHistory;
  if (overlay && overlay.isCurrent(CHART_DRAWER_OVERLAY_ID)) {
    registerChartDrawerOverlay();
    return overlay.requestClose(CHART_DRAWER_OVERLAY_ID, afterClose);
  }
  closeChartDrawerNow();
  return Promise.resolve(typeof afterClose === "function" ? afterClose() : true);
}
function initThreads() {
  state.threads = {};
  state.sessionIds = {};
  state.riskAcceptedTabs = normalizedRiskAcceptance(state.riskAcceptedTabs);
  state.pendingFork = null;
  currentTabs().forEach(t => {
    state.threads[t.key] = [];
    state.sessionIds[t.key] = createSessionId();
  });
}
initThreads();

const ChatFollowups = ChatCopyModule.createFollowups({
  getSystem: () => state.system,
  getThread: key => state.threads[key] || [],
});
const { suggestedFollowups } = ChatFollowups;

/* ============================================================
   屏幕导航
   ============================================================ */
// HOME ROUTE HISTORY · 观象台、排盘、起卦、工作台支持浏览器返回与前进（design-147）
const HomeCommunityModule = window.XuanxueHomeCommunity;
if (!HomeCommunityModule) throw new Error("XuanxueHomeCommunity is not loaded");
const HOME_COMMUNITY_HASH = HomeCommunityModule.HOME_COMMUNITY_HASH;
const HOME_ROUTE_STATE_KEY = "xuanshuHomeRoute";

function currentHomeRoute() {
  const route = history.state?.[HOME_ROUTE_STATE_KEY];
  return route && typeof route === "object" ? route : null;
}

function replaceHomeLocation({ start = "", flow = "", hash = "", screen = "landing", historyMode = "replace", fromScreen = "" } = {}) {
  try {
    const url = new URL(location.href);
    if (start) url.searchParams.set("start", start);
    else url.searchParams.delete("start");
    if (flow) url.searchParams.set("flow", flow);
    else url.searchParams.delete("flow");
    if (screen === "credits") url.searchParams.set("view", "credits");
    else if (screen === "archives") url.searchParams.set("view", "archives");
    else {
      url.searchParams.delete("view");
      url.searchParams.delete("month");
    }
    if (screen === "landing") {
      url.searchParams.delete("personal_case");
      url.searchParams.delete("resume_case");
    }
    url.hash = hash;
    const href = `${url.pathname}${url.search}${url.hash}`;
    const previousRoute = currentHomeRoute();
    const route = {
      screen,
      system: screen === "dash" && (state.system === "bazi" || state.system === "liuyao") ? state.system : "",
      workspace: screen === "dash" && detailedWorkspaceActive() ? "detailed" : "",
      fromScreen: historyMode === "push" ? fromScreen : (previousRoute?.fromScreen || fromScreen),
      pushed: historyMode === "push" || previousRoute?.pushed === true,
    };
    const nextState = {
      ...(history.state && typeof history.state === "object" ? history.state : {}),
      [HOME_ROUTE_STATE_KEY]: route,
    };
    const sameRoute = location.pathname === url.pathname
      && location.search === url.search
      && location.hash === url.hash
      && previousRoute?.screen === screen;
    if (historyMode === "push" && !sameRoute) history.pushState(nextState, "", href);
    else history.replaceState(nextState, "", href);
  } catch (_) {}
}

function setPrimaryNavCurrent(target = "") {
  $$('[data-hero-nav]').forEach(button => {
    if (button.dataset.heroNav === target) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  $$('[data-home-community-nav]').forEach(link => {
    if (target === "community") link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}

function currentScreenNavTarget() {
  if (state.screen === "birth") return "bazi";
  if (state.screen === "cast") return combinedCastActive() ? "detailed" : "liuyao";
  if (state.screen === "dash") return detailedWorkspaceActive() ? "detailed" : state.system;
  if (state.screen === "credits") return "credits";
  if (state.screen === "archives") return "profile";
  if (location.hash === HOME_COMMUNITY_HASH) return "community";
  return "landing";
}

function setupSidebarToggle() {
  const nav = $(".hero-nav");
  const toggle = $("[data-sidebar-toggle]");
  if (!nav || !toggle) return;
  const label = toggle.querySelector("[data-sidebar-toggle-label]");
  const close = () => {
    nav.removeAttribute("data-sidebar-expanded");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "展开 Tab 栏");
    toggle.setAttribute("title", "展开 Tab 栏");
    if (label) label.textContent = "展开 Tab 栏";
  };
  toggle.addEventListener("click", event => {
    event.stopPropagation();
    const open = nav.dataset.sidebarExpanded !== "true";
    if (!open) {
      close();
      return;
    }
    nav.dataset.sidebarExpanded = "true";
    toggle.setAttribute("aria-expanded", "true");
    toggle.setAttribute("aria-label", "收起 Tab 栏");
    toggle.setAttribute("title", "收起 Tab 栏");
    if (label) label.textContent = "收起 Tab 栏";
  });
  nav.querySelector("[data-account-button]")?.addEventListener("click", close);
  nav.querySelector("[data-community-notifications]")?.addEventListener("click", close);
  nav.querySelectorAll("[data-hero-nav], [data-home-community-nav]").forEach(item => item.addEventListener("click", close));
  document.addEventListener("click", event => {
    if (nav.dataset.sidebarExpanded === "true" && !nav.contains(event.target)) close();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && nav.dataset.sidebarExpanded === "true") {
      close();
      toggle.focus();
    }
  });
  window.matchMedia("(min-width: 1121px)").addEventListener("change", close);
}

// PAGE FOCUS HANDOFF · 页面切换后把键盘与读屏焦点交给新主区域（design-148）
function focusScreenMain(screen, preferredTarget = "") {
  const target = preferredTarget
    ? $(preferredTarget)
    : screen === "birth"
      ? $("#birth-modal")
      : screen === "cast"
        ? $("#cast-modal")
        : screen === "dash"
          ? $("#dashboard")
          : screen === "credits"
            ? $("#credit-ledger-page")
            : screen === "archives"
              ? $("#profile-library-page")
            : PersonalHome?.isVisible()
              ? $("#personal-workbench")
              : $("#home-main");
  if (!target) return;
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  window.requestAnimationFrame(() => {
    if (target.isConnected && !target.closest("[hidden]")) target.focus({ preventScroll: true });
  });
}

function showScreen(screen, { preserveEntryLocation = false, historyMode = "replace", routeHash = "", focusPage = false, focusTarget = "" } = {}) {
  const previousScreen = state.screen;
  if (screen === "landing" && previousScreen !== "landing") stashCurrentWorkspace(previousScreen);
  state.screen = screen;
  if (screen !== "dash") closeChartDrawer();
  if (!preserveEntryLocation) {
    const start = screen === "birth" ? "bazi" : screen === "cast" ? "liuyao" : "";
    const flow = screen === "cast" && combinedCastActive() ? "detailed" : "";
    replaceHomeLocation({ start, flow, hash: routeHash, screen, historyMode, fromScreen: previousScreen });
  }
  const communityLanding = screen === "landing" && location.hash === HOME_COMMUNITY_HASH;
  if (communityLanding) document.documentElement.dataset.communityView = "true";
  else delete document.documentElement.dataset.communityView;
  // 观象台同时承担全站导航壳；排盘、起卦和问答只切换右侧内容。
  $("#landing").hidden = false;
  $("#personal-workbench").hidden = true;
  if (screen === "credits") CreditLedger?.activate();
  else CreditLedger?.deactivate();
  const profileLibraryPage = $("#profile-library-page");
  if (profileLibraryPage) profileLibraryPage.hidden = screen !== "archives";
  $("#dashboard").hidden = screen !== "dash";
  $("#birth-modal").hidden = screen !== "birth";
  $("#cast-modal").hidden = screen !== "cast";
  document.body.dataset.screen = screen;
  if (screen !== "dash") document.body.removeAttribute("data-workspace");
  const personalHomeVisible = !!PersonalHome?.syncScreen(screen);
  $$('[data-home-action-panel]').forEach(el => {
    el.hidden = screen !== "landing" || communityLanding || personalHomeVisible;
  });
  $("#gua-square").hidden = screen !== "landing" || personalHomeVisible || !communityLanding;
  const skipLink = $("#skip-to-main");
  if (skipLink) {
    const mainTarget = screen === "birth"
      ? "birth-modal"
      : screen === "cast"
        ? "cast-modal"
        : screen === "dash"
          ? "dashboard"
          : screen === "credits"
            ? "credit-ledger-page"
            : screen === "archives"
              ? "profile-library-page"
          : communityLanding
            ? "gua-square"
            : PersonalHome?.isVisible()
              ? "personal-workbench"
              : "home-main";
    skipLink.setAttribute("href", `#${mainTarget}`);
  }
  const navTarget = screen === "birth"
    ? "bazi"
    : screen === "cast"
      ? (combinedCastActive() ? "detailed" : "liuyao")
      : screen === "dash"
        ? (detailedWorkspaceActive() ? "detailed" : state.system)
        : screen === "credits"
          ? "credits"
          : screen === "archives"
            ? "profile"
        : "landing";
  setPrimaryNavCurrent(navTarget);
  const activePage = screen === "birth" ? $("#birth-modal") : screen === "cast" ? $("#cast-modal") : null;
  if (activePage) {
    activePage.scrollTop = 0;
    const scrollArea = activePage.querySelector(".entry-shell");
    if (scrollArea) scrollArea.scrollTop = 0;
  }
  window.scrollTo(0, 0);
  scheduleAppViewportSync();
  if (screen === "dash") scheduleAppViewportSync(120);
  if (focusPage) focusScreenMain(screen, focusTarget);
}

const HomeCommunity = HomeCommunityModule.create({
  select: $,
  selectAll: $$,
  escapeHtml: esc,
  getScreen: () => state.screen,
  showScreen,
  setPrimaryNavCurrent,
});
const {
  closeEntryScreen,
  loadSiteStats,
  openHomeCommunity,
  refreshHomeCommunityPosts,
  restoreHomeRouteFromLocation,
  scrollHomeCommunityIntoView,
  setMode,
  setupHomeCommunityFeed,
} = HomeCommunity;

/* ============================================================
   录入弹窗
   ============================================================ */
const LocationPicker = LocationPickerModule.create({ select: $, escapeHtml: esc });
const {
  initLocationPicker,
  normalizedLocationName,
  resetLocationPicker,
  restoreLocationPicker,
} = LocationPicker;

function birthInputMode() {
  return $("#f-input-mode")?.value || "birth_time";
}
function isManualPillarsMode() {
  return birthInputMode() === "manual_pillars";
}
function isManualBaziPayload(payload = lastPayload) {
  return payload?.profile?.input_mode === "manual_pillars" || lastInput?.input_mode === "manual_pillars";
}
function normalizePillar(value) {
  return String(value || "").replace(/\s+/g, "");
}
function readPillarInput(key) {
  return normalizePillar($(`#f-${key}-pillar`).value);
}
function isValidPillar(value) {
  const v = normalizePillar(value);
  if (v.length !== 2) return false;
  const gi = GAN_CHARS.indexOf(v[0]);
  const zi = ZHI_CHARS.indexOf(v[1]);
  return gi >= 0 && zi >= 0 && gi % 2 === zi % 2;
}
function setBirthInputMode(mode) {
  const select = $("#f-input-mode");
  if (!select) return;
  clearBirthError();
  select.value = mode;
  syncBirthInputMode();
}
function syncBirthModeTabs() {
  const mode = birthInputMode();
  $$("[data-input-mode-btn]").forEach(btn => {
    const active = btn.dataset.inputModeBtn === mode;
    btn.setAttribute("aria-selected", active ? "true" : "false");
    btn.tabIndex = active ? 0 : -1;
  });
}
function pillarInput(key) {
  return $(`#f-${key}-pillar`);
}
function usePillarPickerOnly() {
  return !isDesktopLayout() && isManualPillarsMode();
}
function syncManualPillarInputs() {
  const pickerOnly = usePillarPickerOnly();
  $$("[data-pillar-input]").forEach(input => {
    input.readOnly = pickerOnly;
    input.dataset.pickerOnly = pickerOnly ? "true" : "false";
    if (pickerOnly) input.setAttribute("inputmode", "none");
    else input.removeAttribute("inputmode");
  });
}
function sameParityBranches(stem) {
  const gi = GAN_CHARS.indexOf(stem);
  if (gi < 0) return [];
  return Array.from(ZHI_CHARS).filter((_, zi) => gi % 2 === zi % 2);
}
function renderPillarPicker() {
  const root = $("#pillar-picker");
  if (!root || !activePillarKey) return;
  const value = readPillarInput(activePillarKey);
  const currentStem = activePillarStem || value[0] || "";
  const branches = sameParityBranches(currentStem);
  root.hidden = false;
  root.innerHTML =
    `<div class="pk-head">
      <div class="pk-title">选 ${esc(PILLAR_ROLE[activePillarKey]?.name || "四柱")}</div>
      <span class="pk-hint">${currentStem ? "第二步 · 选地支（仅列可配之支）" : "第一步 · 选天干"}</span>
      <button type="button" class="pk-close" data-pillar-close aria-label="关闭">×</button>
    </div>
    <div class="pk-label">天 干</div>
    <div class="pk-row pk-stems">${Array.from(GAN_CHARS).map(ch =>
      `<button type="button" class="pk-btn${ch === currentStem ? " active" : ""}" data-pk-stem="${ch}">${ch}</button>`).join("")}</div>
    <div class="pk-label">地 支${currentStem ? ` · 可配 ${currentStem}` : ""}</div>
    <div class="pk-row pk-branches">${branches.length ? branches.map(ch =>
      `<button type="button" class="pk-btn${value[1] === ch ? " active" : ""}" data-pk-branch="${ch}">${ch}</button>`).join("") : `<span class="bm-hint">先选天干，再选同阴阳地支。</span>`}</div>`;
  root.querySelector("[data-pillar-close]").onclick = closePillarPicker;
  root.querySelectorAll("[data-pk-stem]").forEach(btn => {
    btn.onclick = () => {
      activePillarStem = btn.dataset.pkStem || "";
      const input = pillarInput(activePillarKey);
      if (input) input.value = activePillarStem;
      renderPillarPicker();
      if (activePillarKey === "year") renderJiaziCandidates();
    };
  });
  root.querySelectorAll("[data-pk-branch]").forEach(btn => {
    const branch = btn.dataset.pkBranch || "";
    btn.onclick = () => {
      const input = pillarInput(activePillarKey);
      const stem = activePillarStem || input?.value?.trim()?.[0] || "";
      if (input && stem) {
        input.value = stem + branch;
        if (usePillarPickerOnly()) {
          input.blur();
        } else {
          suppressPillarFocus = true;
          input.focus({ preventScroll: true });
          requestAnimationFrame(() => { suppressPillarFocus = false; });
        }
      }
      if (activePillarKey === "year") renderJiaziCandidates();
      closePillarPicker();
    };
  });
}
function openPillarPicker(key) {
  const input = pillarInput(key);
  if (!input) return;
  activePillarKey = key;
  const value = readPillarInput(key);
  activePillarStem = value[0] && GAN_CHARS.includes(value[0]) ? value[0] : "";
  renderPillarPicker();
}
function closePillarPicker() {
  const root = $("#pillar-picker");
  if (root) root.hidden = true;
  activePillarKey = "";
  activePillarStem = "";
}
function jiaziYearsForPillar(pillar) {
  if (!isValidPillar(pillar)) return [];
  const currentYear = new Date().getFullYear();
  const years = [];
  for (let y = currentYear; y >= currentYear - 119; y -= 1) {
    if (pillarForYear(y) === pillar) years.push(y);
    if (years.length >= 2) break;
  }
  return years;
}
function setManualBirthYear(year) {
  const el = $("#f-manual-birth-year");
  if (el) el.value = year ? String(year) : "";
  renderJiaziCandidates();
}
function renderJiaziCandidates() {
  const root = $("#jiazi-candidates");
  if (!root) return;
  const yearEl = $("#f-manual-birth-year");
  const pillar = readPillarInput("year");
  const years = jiaziYearsForPillar(pillar);
  if (!years.length) {
    root.classList.remove("has-candidates");
    root.innerHTML = pillar
      ? "年柱干支不合（阳干配阳支、阴干配阴支，如「乙巳」「甲子」），请检查。"
      : "填写年柱后显示近 120 年候选。";
    if (yearEl) yearEl.value = "";
    return;
  }
  const selected = Number(yearEl?.value || 0);
  if (selected && !years.includes(selected) && yearEl) yearEl.value = "";
  const currentYear = new Date().getFullYear();
  root.classList.add("has-candidates");
  root.innerHTML = years.map((year, index) => {
    const active = Number(yearEl?.value || 0) === year || (!yearEl?.value && index === 0);
    if (active && yearEl) yearEl.value = String(year);
    const label = index === 0 ? "本甲子" : "上一甲子";
    const age = currentYear - year + 1;
    return `<button type="button" class="jiazi-candidate${active ? " active" : ""}" data-jiazi-year="${year}">
      <span class="jz-row"><b>${esc(pillar)}年 · 公历 ${year}</b><i>${active ? "◆" : "◇"}</i></span>
      <span>${label} · 虚岁约 ${age}</span>
    </button>`;
  }).join("");
  root.querySelectorAll("[data-jiazi-year]").forEach(btn => {
    btn.onclick = () => setManualBirthYear(btn.dataset.jiaziYear || "");
  });
}
function syncBirthEntryCopy() {
  const editing = birthEditingCurrent;
  const manual = isManualPillarsMode();
  const title = $("#birth-form-title");
  const copy = $("#birth-form-copy");
  const submit = $("#birth-submit");
  const foot = $("#birth-foot-note");
  if (title) title.textContent = editing ? "修改出生信息" : "出生信息";
  if (copy) copy.textContent = editing
    ? "当前命盘资料已回填；提交后会更新此档案并按新信息重新排盘。"
    : "支持公历、农历；临界时辰会提示。";
  if (submit && !submit.disabled) submit.textContent = editing ? "更 新 并 重 新 排 盘" : "生 成 命 盘";
  if (foot) foot.textContent = editing
    ? "更新后从新盘重新开始解读，原有解读不再挂在当前档案下"
    : manual
      ? "选择生年候选匹配出生锚点，无需城市"
      : "";
}
function syncBirthInputMode() {
  const manual = isManualPillarsMode();
  syncBirthModeTabs();
  $$(".birth-time-only").forEach(el => { el.hidden = manual; });
  $("#manual-pillars-section").hidden = !manual;
  if (!manual) closePillarPicker();
  syncManualPillarInputs();
  renderJiaziCandidates();
  syncLeapVisibility();
  syncBirthEntryCopy();
}

function resetBirthForm() {
  closePillarPicker();
  const form = $("#birth-form");
  form?.reset();
  $("#f-input-mode").value = "birth_time";
  $("#f-name").value = "";
  $("#f-gender").value = "男";
  $("#f-calendar").value = "solar";
  ["year", "month", "day", "hour", "minute"].forEach(key => { $(`#f-${key}`).value = ""; });
  ["year", "month", "day", "hour"].forEach(key => { $(`#f-${key}-pillar`).value = ""; });
  $("#f-manual-birth-year").value = "";
  $("#f-leap").checked = false;
  $("#f-tst").checked = true;
  $("#f-boundary").value = "zi";
  const advanced = $(".bm-advanced", form);
  if (advanced) advanced.open = false;
  resetLocationPicker();
  syncBirthInputMode();
}

function normalizedBirthGender(value) {
  if (value === "male" || value === "男") return "男";
  if (value === "female" || value === "女") return "女";
  return "";
}

function populateBirthForm(input = {}) {
  resetBirthForm();
  const mode = input.input_mode === "manual_pillars" ? "manual_pillars" : "birth_time";
  $("#f-input-mode").value = mode;
  $("#f-name").value = String(input.name || profileName || "").trim();
  $("#f-gender").value = normalizedBirthGender(input.gender);
  if (mode === "manual_pillars") {
    const pillars = input.pillars || {};
    ["year", "month", "day", "hour"].forEach(key => {
      $(`#f-${key}-pillar`).value = normalizePillar(input[`${key}_pillar`] || pillars[key] || "");
    });
    syncBirthInputMode();
    if (input.manual_birth_year) $("#f-manual-birth-year").value = String(input.manual_birth_year);
    renderJiaziCandidates();
    return;
  }
  $("#f-calendar").value = input.calendar === "lunar" ? "lunar" : "solar";
  ["year", "month", "day", "hour", "minute"].forEach(key => {
    $(`#f-${key}`).value = input[key] === null || input[key] === undefined ? "" : String(input[key]);
  });
  $("#f-leap").checked = !!input.is_leap_month;
  $("#f-tst").checked = input.use_true_solar !== false;
  $("#f-boundary").value = ["zi", "midnight", "late_zi"].includes(input.day_boundary) ? input.day_boundary : "zi";
  restoreLocationPicker(input.location || "");
  syncBirthInputMode();
}

let birthEntryFrom = "landing";
let birthEditingCurrent = false;
let birthEditingProfileId = null;
let castEntryFrom = "landing";

const ModalManagerModule = window.XuanxueModalManager;
if (!ModalManagerModule) throw new Error("XuanxueModalManager is not loaded");
const ModalManager = ModalManagerModule.create({
  select: $,
  selectAll: $$,
  isDesktopLayout,
  closeHandlerFor: id => ({
    "birth-modal": closeBirthModal,
    "cast-modal": closeCastModal,
    "pop-modal": closePop,
    "trend-modal": closeTrend,
    "gloss-modal": closeGloss,
    "profile-modal": closeProfileModal,
    "feedback-modal": closeFeedback,
  })[id],
});
const {
  availableModalFocusTarget,
  closeTopModal,
  hideModalMask,
  showModalMask,
  trapChartDrawerFocus,
  trapModalFocus,
} = ModalManager;

function showRitualOverlay(lines, rotateMs = 900) {
  const overlay = $("#ritual-overlay");
  const text = $("#ritual-text");
  if (!overlay || !text) return;
  const seq = lines && lines.length ? lines : ["起局 · 观盘", "推演 · 参详", "斟酌 · 落笔"];
  let index = 0;
  text.textContent = seq[index];
  clearTimeout(ritualShowTimer);
  clearTimeout(ritualHideTimer);
  clearInterval(ritualTimer);
  ritualShowTimer = null;
  ritualHideTimer = null;
  ritualShownAt = 0;
  overlay.hidden = true;
  ritualShowTimer = setTimeout(() => {
    ritualShowTimer = null;
    ritualShownAt = Date.now();
    overlay.hidden = false;
    ritualTimer = setInterval(() => {
      index = (index + 1) % seq.length;
      text.textContent = seq[index];
    }, rotateMs);
  }, RITUAL_REVEAL_DELAY_MS);
}
function hideRitualOverlay() {
  clearTimeout(ritualShowTimer);
  ritualShowTimer = null;
  clearInterval(ritualTimer);
  ritualTimer = null;
  clearTimeout(ritualHideTimer);
  ritualHideTimer = null;
  const overlay = $("#ritual-overlay");
  if (!overlay) return;
  const finish = () => {
    overlay.hidden = true;
    ritualShownAt = 0;
    ritualHideTimer = null;
  };
  const elapsed = ritualShownAt ? Date.now() - ritualShownAt : RITUAL_MIN_VISIBLE_MS;
  const remaining = RITUAL_MIN_VISIBLE_MS - elapsed;
  if (!overlay.hidden && remaining > 0) ritualHideTimer = setTimeout(finish, remaining);
  else finish();
}
async function openBirthModal(options = {}) {
  const historyMode = options?.historyMode === "replace" ? "replace" : "push";
  const openingFromDashboard = state.screen === "dash";
  const editingCurrentBazi = !options?.fresh && openingFromDashboard && state.system === "bazi" && !!lastInput;
  if (editingCurrentBazi && activeStreamingMessage()) {
    toast("请先停止当前解读，再修改出生信息", "warn");
    return false;
  }
  const loggedIn = await Account?.requireLogin({
    mode: "login",
    message: "私人排盘，先登录或注册。",
  });
  if (!loggedIn) return false;
  if (!options?.preservePersonalCase) clearPersonalCaseContext();
  await closeChartDrawer();
  birthEntryFrom = openingFromDashboard && !options?.fresh ? "work" : "landing";
  birthEditingCurrent = editingCurrentBazi;
  birthEditingProfileId = editingCurrentBazi && activeProfileId ? Number(activeProfileId) : null;
  clearBirthError();
  if (birthEditingCurrent) populateBirthForm(lastInput);
  else resetBirthForm();
  showScreen("birth", { historyMode, focusPage: true });
  if (isDesktopLayout()) setTimeout(() => $(isManualPillarsMode() ? "#f-year-pillar" : "#f-year").focus(), 30);
  return true;
}
function closeBirthModal() { closeEntryScreen("birth", birthEntryFrom === "work" ? "dash" : "landing"); }
function syncLeapVisibility() {
  $("#f-leap-wrap").hidden = isManualPillarsMode() || $("#f-calendar").value !== "lunar";
}

function todayISO() { return new Date().toISOString().slice(0, 10); }
function localDateTimeISO() {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function readInput() {
  const num = id => { const v = $(id).value.trim(); return v === "" ? null : Number(v); };
  const inputMode = birthInputMode();
  if (inputMode === "manual_pillars") {
    const pillars = {
      year: readPillarInput("year"),
      month: readPillarInput("month"),
      day: readPillarInput("day"),
      hour: readPillarInput("hour"),
    };
    return {
      system: "bazi",
      name: $("#f-name").value.trim() || null,
      input_mode: "manual_pillars",
      gender: $("#f-gender").value || null,
      manual_birth_year: $("#f-manual-birth-year")?.value ? Number($("#f-manual-birth-year").value) : null,
      year_pillar: pillars.year,
      month_pillar: pillars.month,
      day_pillar: pillars.day,
      hour_pillar: pillars.hour,
      pillars,
      as_of: todayISO(),
    };
  }
  return {
    system: "bazi",
    name: $("#f-name").value.trim() || null,
    input_mode: "birth_time",
    calendar: $("#f-calendar").value,
    year: num("#f-year"), month: num("#f-month"), day: num("#f-day"),
    hour: num("#f-hour"), minute: num("#f-minute") ?? 0,
    is_leap_month: $("#f-leap").checked,
    gender: $("#f-gender").value || null,
    location: $("#f-location").value.trim() || null,
    use_true_solar: $("#f-tst").checked,
    day_boundary: $("#f-boundary").value,
    as_of: todayISO(),
  };
}

function validSolarDate(year, month, day) {
  const value = new Date(Date.UTC(year, month - 1, day));
  return value.getUTCFullYear() === year
    && value.getUTCMonth() === month - 1
    && value.getUTCDate() === day;
}

function clearBirthError() {
  const form = $("#birth-form");
  const error = $("#birth-error");
  if (!form || !error) return;
  form.querySelectorAll('[aria-describedby~="birth-error"]').forEach(field => {
    const ids = (field.getAttribute("aria-describedby") || "")
      .split(/\s+/).filter(id => id && id !== "birth-error");
    if (ids.length) field.setAttribute("aria-describedby", ids.join(" "));
    else field.removeAttribute("aria-describedby");
  });
  form.querySelectorAll('[aria-invalid="true"]').forEach(field => field.removeAttribute("aria-invalid"));
  const foot = form.querySelector(".bm-foot");
  if (foot && error.nextElementSibling !== foot) foot.before(error);
  error.classList.remove("is-field-error");
  error.textContent = "";
  error.hidden = true;
}

function birthErrorField(message) {
  const text = String(message || "");
  if (/出生日期|年月日|公历日期|农历日期/.test(text)) return "#f-day";
  if (/分钟|分应|0[–-]59/.test(text)) return "#f-minute";
  if (/小时|时辰|0[–-]23/.test(text)) return "#f-hour";
  if (/月份|1[–-]12/.test(text)) return "#f-month";
  if (/日期/.test(text)) return "#f-day";
  if (/出生年|年份/.test(text)) return "#f-year";
  return "";
}

function showBirthError(message, fieldSelector = "") {
  clearBirthError();
  const error = $("#birth-error");
  const field = fieldSelector ? $(fieldSelector) : null;
  error.textContent = message;
  error.hidden = false;
  if (!field) return;
  field.setAttribute("aria-invalid", "true");
  const describedBy = new Set((field.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean));
  describedBy.add("birth-error");
  field.setAttribute("aria-describedby", Array.from(describedBy).join(" "));
  const anchor = field.closest(".bm-grid-time,.bm-manual-pillars") || field.closest("label");
  if (anchor) {
    anchor.insertAdjacentElement("afterend", error);
    error.classList.add("is-field-error");
  }
  field.focus({ preventScroll: true });
  (anchor || field).scrollIntoView({ block: "center", inline: "nearest" });
}

function validateInput(inp) {
  if (inp.input_mode === "manual_pillars") {
    const fields = [
      ["year_pillar", "年柱", "#f-year-pillar"],
      ["month_pillar", "月柱", "#f-month-pillar"],
      ["day_pillar", "日柱", "#f-day-pillar"],
      ["hour_pillar", "时柱", "#f-hour-pillar"],
    ];
    for (const [k, label, field] of fields) {
      if (!inp[k]) return { ok: false, msg: `请填写${label}`, field };
      if (!isValidPillar(inp[k])) return { ok: false, msg: `${label}应为有效干支，如 甲子`, field };
    }
    return { ok: true };
  }
  for (const [k, label] of [["year", "年"], ["month", "月"], ["day", "日"]]) {
    if (inp[k] == null || Number.isNaN(inp[k])) return { ok: false, msg: `请填写出生${label}`, field: `#f-${k}` };
  }
  if (!Number.isInteger(inp.year) || inp.year < 1) return { ok: false, msg: "请填写有效的出生年份", field: "#f-year" };
  if (!Number.isInteger(inp.month)) return { ok: false, msg: "月份请填写整数", field: "#f-month" };
  if (!Number.isInteger(inp.day)) return { ok: false, msg: "日期请填写整数", field: "#f-day" };
  if (inp.month < 1 || inp.month > 12) return { ok: false, msg: "月份应在 1–12 之间", field: "#f-month" };
  if (inp.day < 1 || inp.day > 31) return { ok: false, msg: "日期应在 1–31 之间", field: "#f-day" };
  if (inp.calendar === "solar" && !validSolarDate(inp.year, inp.month, inp.day)) {
    return { ok: false, msg: "该公历日期不存在，请检查月份和日期", field: "#f-day" };
  }
  if (inp.calendar === "lunar" && inp.day > 30) {
    return { ok: false, msg: "农历日期应在 1–30 之间", field: "#f-day" };
  }
  if (inp.hour == null || Number.isNaN(inp.hour)) {
    return { ok: false, msg: "请填写出生小时；不确定时可先填 12", field: "#f-hour" };
  }
  if (!Number.isInteger(inp.hour)) return { ok: false, msg: "小时请填写整数", field: "#f-hour" };
  if (inp.hour < 0 || inp.hour > 23) return { ok: false, msg: "小时应在 0–23 之间", field: "#f-hour" };
  if (!Number.isInteger(inp.minute) || inp.minute < 0 || inp.minute > 59) {
    return { ok: false, msg: "分钟应在 0–59 之间", field: "#f-minute" };
  }
  return { ok: true };
}

async function submitBirth(ev) {
  if (ev) ev.preventDefault();
  clearBirthError();
  const inp = readInput();
  const v = validateInput(inp);
  if (!v.ok) {
    showBirthError(v.msg, v.field || "");
    return;
  }
  const chartSessionId = createSessionId();
  inp.session_id = chartSessionId;
  const updatingProfileId = birthEditingProfileId ? Number(birthEditingProfileId) : null;
  const submit = $("#birth-submit");
  submit.disabled = true; submit.textContent = updatingProfileId ? "更新并排盘中…" : "排盘中…";
  showRitualOverlay(
    inp.input_mode === "manual_pillars"
      ? ["录四柱 · 定甲子 …", "定大运 · 起流年 …"]
      : ["校真太阳时 · 排四柱 …", "定大运 · 起流年 …"],
    800,
  );
  try {
    const r = await fetch(updatingProfileId ? `/api/profiles/${updatingProfileId}` : "/api/chart", {
      method: updatingProfileId ? "PUT" : "POST", headers: Account.csrfHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(inp),
    });
    if (!r.ok) throw new Error(await r.text());
    const data = await r.json();
    const payload = data.payload || data;
    state.system = "bazi";
    lastInput = inp;
    lastPayload = payload;
    activeChartId = data.chart_id || payload.chart_id || null;
    profileName = data.name || payload.profile_name || inp.name || `${payload.chart.pillars.day}日`;
    calendarLabel = calendarFromInput("bazi", inp);
    activeProfileId = data.id || payload.profile_id || updatingProfileId || null;
    activeHistory = Array.isArray(data.history) ? data.history : [];
    const personalHomeSetup = new URLSearchParams(location.search).get("set_default") === "1";
    if (personalHomeSetup && activeProfileId && !updatingProfileId) {
      const defaultResponse = await fetch("/api/personal-home/default-profile", {
        method: "PUT",
        headers: Account.csrfHeaders({ "Content-Type": "application/json", Accept: "application/json" }),
        body: JSON.stringify({ profile_id: activeProfileId }),
      });
      if (!defaultResponse.ok) throw new Error(await defaultResponse.text());
      window.location.replace("/");
      return;
    }
    resetThreads();
    state.sessionIds["解读"] = chartSessionId;
    enterDashboard({ historyMode: "replace", focusPage: true });
    saveResumeCookie();
    refreshAccountArchiveState();
    if (pendingCommunityHelp) {
      pendingCommunityHelp = false;
      window.setTimeout(openCommunityHelpDialog, 0);
    }
    /* 时辰边界等警告（后端 boundary_check → warnings）：单独提示 */
    const warning = (lastPayload.warnings || [])[0];
    if (warning) toast(warning, "warn");
    else if (updatingProfileId) toast("档案已更新，已按新信息重新排盘");
  } catch (e) {
    const message = humanError(String(e.message || e));
    showBirthError((updatingProfileId ? "更新失败：" : "排盘失败：") + message, birthErrorField(message));
  } finally {
    hideRitualOverlay();
    submit.disabled = false;
    syncBirthEntryCopy();
  }
}

/* ---------- 六爻起卦（图形化爻线 + 三钱掷币动画） ---------- */
const CLIENT_CAST_REVEAL_DELAY_MS = 1340;
let clientCastYaos = [];
let clientCastCoins = [];
let manualYaos = Array(6).fill(undefined);
let clientCastCompletedAt = "";
let clientCastPendingPos = 0;
let clientCastPendingCoins = null;
let clientCastRevealAt = 0;
let clientCastRevealTimer = null;
let clientCastFaceTimer = null;
function snapshotCastDraft() {
  return {
    question: $("#cast-question")?.value || "",
    method: castMethodValue(),
    visibility: document.querySelector('input[name="cast-visibility"]:checked')?.value || "help",
    clientCastYaos: clientCastYaos.slice(),
    clientCastCoins: clientCastCoins.map(coins => Array.isArray(coins) ? coins.slice() : coins),
    manualYaos: manualYaos.slice(),
    completedAt: clientCastCompletedAt,
  };
}
function restoreCastDraft(draft = {}) {
  clearClientCastPending();
  const question = $("#cast-question");
  if (question) question.value = String(draft.question || "");
  const method = draft.method === "manual" ? "manual" : "client_coins";
  const methodSelect = $("#cast-method");
  if (methodSelect) methodSelect.value = method;
  clientCastYaos = Array.isArray(draft.clientCastYaos) ? draft.clientCastYaos.slice(0, 6) : [];
  clientCastCoins = Array.isArray(draft.clientCastCoins)
    ? draft.clientCastCoins.slice(0, 6).map(coins => Array.isArray(coins) ? coins.slice(0, 3) : coins)
    : [];
  manualYaos = Array.from({ length: 6 }, (_, index) => {
    const value = Array.isArray(draft.manualYaos) ? draft.manualYaos[index] : undefined;
    return [6, 7, 8, 9].includes(value) ? value : undefined;
  });
  clientCastCompletedAt = String(draft.completedAt || "");
  const visibilityValue = ["help", "public", "private"].includes(draft.visibility) ? draft.visibility : "help";
  const visibility = document.querySelector(`input[name="cast-visibility"][value="${visibilityValue}"]`);
  if (visibility) visibility.checked = true;
  clearCastError();
  syncCastEntryMode();
  syncCoinFaces(null, false);
  syncCastMethod();
}
function clearCastQuestionError() {
  const field = $("#cast-question");
  const error = $("#cast-question-error");
  if (field) field.removeAttribute("aria-invalid");
  if (!error) return;
  error.textContent = "";
  error.hidden = true;
}
function clearCastError() {
  const err = $("#cast-error");
  if (err) {
    err.textContent = "";
    err.hidden = true;
  }
  clearCastQuestionError();
}
function showCastError(message) {
  const err = $("#cast-error");
  if (!err) return;
  err.textContent = message;
  err.hidden = false;
}
function showCastQuestionError(message) {
  const field = $("#cast-question");
  const error = $("#cast-question-error");
  if (!field || !error) return;
  field.setAttribute("aria-invalid", "true");
  error.textContent = message;
  error.hidden = false;
  field.focus({ preventScroll: true });
  field.closest(".cast-question-label")?.scrollIntoView({ block: "center", inline: "nearest" });
}
function combinedCastActive() {
  return pendingCombinedEntry || !!activePersonalCaseId;
}

function syncCastEntryMode() {
  const combined = combinedCastActive();
  const modal = $("#cast-modal");
  if (!modal) return;
  modal.dataset.castFlow = combined ? "detailed" : "standard";
  const publicVisibility = document.querySelector('input[name="cast-visibility"][value="public"]');
  const helpVisibility = document.querySelector('input[name="cast-visibility"][value="help"]');
  const privateVisibility = document.querySelector('input[name="cast-visibility"][value="private"]');
  const visibility = document.querySelector(".cast-visibility");
  if (publicVisibility) publicVisibility.disabled = combined;
  if (helpVisibility) helpVisibility.disabled = combined;
  if (privateVisibility) privateVisibility.disabled = false;
  if (combined && privateVisibility) privateVisibility.checked = true;
  if (visibility) visibility.hidden = combined;
  const cardTitle = modal.querySelector(".cast-head-row h2");
  const cardCopy = modal.querySelector(".cast-head-row p");
  const hint = $("#cast-question-hint");
  if (cardTitle) cardTitle.textContent = combined ? "一事 · 详断" : "六爻 · 起卦";
  if (cardCopy) cardCopy.textContent = combined
    ? "默认命盘已带入，写下所问。"
    : "写下一个具体问题，再完成六爻。";
  if (hint) {
    const account = Account?.snapshot?.() || {};
    const quota = account.privateQuota;
    const wallet = account.creditWallet;
    hint.textContent = combined
      ? `仅自己可见${quota ? ` · 今日免费 ${quota.remaining}/${quota.total} 分` : ""}${wallet ? ` · 账户积分 ${Number(wallet.balance || 0)} 分` : ""}`
      : "写清时间范围；不要填写姓名、电话、住址或证件号。";
  }
}

function openCastModal(opts = {}) {
  if (chartDrawerIsOpen() && window.XuanOverlayHistory?.isCurrent(CHART_DRAWER_OVERLAY_ID)) {
    void closeChartDrawer(() => openCastModal(opts));
    return;
  }
  if (opts?.combined) {
    clearPersonalCaseContext();
    pendingCombinedEntry = true;
  } else if (!opts?.preservePersonalCase) {
    clearPersonalCaseContext();
  }
  const historyMode = opts?.historyMode === "replace" ? "replace" : "push";
  closeChartDrawerNow();
  castEntryFrom = state.screen === "dash" ? "work" : "landing";
  clearCastError();
  /* 重新起卦保留原卦，弃卦需显式点「重新起卦」；从首页进入则起新卦 */
  if (opts.fresh || castEntryFrom === "landing") resetClientCast();
  if (opts.clearQuestion) $("#cast-question").value = "";
  syncCastEntryMode();
  syncCastMethod();
  showScreen("cast", { historyMode, focusPage: true });
  Account?.ready().then(syncCastUI).catch(() => {});
  if (isDesktopLayout()) setTimeout(() => $("#cast-question").focus(), 30);
}
function closeCastModal() {
  clearClientCastPending();
  if (combinedCastActive()) clearPersonalCaseContext();
  closeEntryScreen("cast", castEntryFrom === "work" ? "dash" : "landing");
}
function setCastMethod(method) {
  const select = $("#cast-method");
  if (!select || select.value === method) return;
  /* 中途互切保留已成之爻：手动有空档时摇钱须按序，清盘重来 */
  if (method === "client_coins") {
    let lead = 0;
    while (lead < 6 && manualYaos[lead] !== undefined) lead += 1;
    const sparse = manualYaos.slice(lead).some(v => v !== undefined);
    if (sparse) {
      clientCastYaos = [];
      clientCastCoins = [];
      manualYaos = Array(6).fill(undefined);
      toast("手动录入有空档，摇钱须按序 · 已清盘", "warn");
    } else {
      clientCastYaos = manualYaos.slice(0, lead);
      clientCastCoins = clientCastYaos.map(() => null);
    }
    clientCastCompletedAt = clientCastYaos.length === 6 ? localDateTimeISO() : "";
  } else {
    clearClientCastPending();
    manualYaos = Array(6).fill(undefined);
    clientCastYaos.forEach((v, i) => { manualYaos[i] = v; });
  }
  select.value = method;
  syncCastMethod();
}
function syncCastMethodTabs() {
  const method = $("#cast-method")?.value || "client_coins";
  $$("[data-cast-method-btn]").forEach(btn => {
    const active = btn.dataset.castMethodBtn === method;
    btn.setAttribute("aria-selected", active ? "true" : "false");
    btn.tabIndex = active ? 0 : -1;
  });
}
function castMethodValue() { return $("#cast-method")?.value || "client_coins"; }
function currentCastYaos() {
  return castMethodValue() === "manual" ? manualYaos.filter(v => v !== undefined) : clientCastYaos;
}
function castComplete() {
  return castMethodValue() === "manual"
    ? manualYaos.every(v => v !== undefined)
    : clientCastYaos.length === 6;
}
function syncCastMethod() {
  const coins = castMethodValue() === "client_coins";
  if (!coins) clearClientCastPending();
  syncCastMethodTabs();
  $("#coin-stage").hidden = !coins;
  const caption = document.querySelector(".coin-caption");
  if (caption) caption.hidden = !coins;
  renderCastRows();
}
function castYaoValueAt(pos) {
  return castMethodValue() === "manual" ? manualYaos[pos] : clientCastYaos[pos];
}
function setManualYao(index, value) {
  if (!$("#cast-question").value.trim()) {
    showCastQuestionError("先写下所问之事，再录入六爻。");
    return;
  }
  manualYaos[index] = value;
  renderCastRows();
}
function clearManualYao(index) {
  manualYaos[index] = undefined;
  renderCastRows();
}
/* 六爻位：自下而上点亮。waitBar 虚线 / isNext 呼吸 / 阳阴爻线 / 动爻标记 / 手动逐爻点选 */
function renderCastRows() {
  const root = $("#cast-rows");
  if (!root) return;
  const manual = castMethodValue() === "manual";
  const rows = [5, 4, 3, 2, 1, 0].map(i => {
    const v = castYaoValueAt(i);
    const done = v !== undefined;
    const isNext = !manual && i === clientCastYaos.length && clientCastYaos.length < 6;
    const pickable = manual && !done;
    const clearable = manual && done;
    let line = "";
    if (pickable) {
      line = `<span class="cr-picks">
        <button type="button" data-pick-yao="${i}:7">少阳</button>
        <button type="button" data-pick-yao="${i}:8">少阴</button>
        <button type="button" data-pick-yao="${i}:9">老阳 ○</button>
        <button type="button" data-pick-yao="${i}:6">老阴 ✕</button>
      </span>`;
    } else if (done) {
      const moving = v === 6 || v === 9;
      const mark = v === 9 ? "○" : v === 6 ? "✕" : "";
      line = (v === 7 || v === 9)
        ? `<span class="cr-yang"></span>`
        : `<span class="cr-yin"></span><span class="cr-gap"></span><span class="cr-yin flip"></span>`;
      if (moving) line += `<b class="cr-move">${mark}</b>`;
    } else if (isNext) {
      line = `<span class="cr-next"></span>`;
    } else {
      line = `<span class="cr-wait"></span>`;
    }
    const name = done
      ? LY_YAO_NAME[v]
      : (isNext ? (clientCastPendingPos ? "掷钱中…" : "次掷此爻") : (manual ? "待 录" : "待掷"));
    return `<span class="cr-pos">${LY_POS_NAME[i + 1]}爻</span>
      <span class="cr-line${clearable ? " clearable" : ""}"${clearable ? ` data-clear-yao="${i}" title="点击清除重选"` : ""}>${line}</span>
      <span class="cr-name">${esc(name)}</span>`;
  }).join("");
  root.innerHTML = rows;
  root.querySelectorAll("[data-pick-yao]").forEach(btn => {
    btn.onclick = () => {
      const [i, v] = btn.dataset.pickYao.split(":").map(Number);
      setManualYao(i, v);
    };
  });
  root.querySelectorAll("[data-clear-yao]").forEach(el => {
    el.onclick = () => clearManualYao(Number(el.dataset.clearYao));
  });
  syncCastUI();
}
/* LIUYAO CAST PROGRESS · 问题就近报错并明确显示六掷进度（design-155） */
/* 主按钮状态机：掷第 1/6 爻 → 钱落… → 开始解读；手动模式未成卦时只提示 */
function syncCastUI() {
  syncCastEntryMode();
  const submit = $("#cast-submit");
  const manualHint = $("#cast-manual-hint");
  const reset = $("#cast-reset-btn");
  const note = $("#cast-foot-note");
  const banner = $("#cast-complete-banner");
  const visibility = document.querySelector('input[name="cast-visibility"]:checked')?.value || "help";
  const isPrivate = visibility === "private";
  const isHelp = visibility === "help";
  const account = Account?.snapshot?.() || {};
  const quota = account.privateQuota;
  const wallet = account.creditWallet;
  const creditBalance = Number(wallet?.balance || 0);
  const quotaLabel = document.querySelector("[data-private-quota-label]");
  if (quotaLabel) {
    quotaLabel.textContent = quota
      ? Number(quota.remaining || 0) > 0
        ? `今日免费 ${quota.remaining}/${quota.total} 分`
        : `今日免费已用 · 充值 ${creditBalance} 分`
      : "登录后每日赠送 10 分";
  }
  if (!submit) return;
  const manual = castMethodValue() === "manual";
  const done = castComplete();
  if (banner) {
    banner.hidden = !done;
    if (done) {
      const movingCount = currentCastYaos().filter(value => value === 6 || value === 9).length;
      banner.innerHTML = `<div><span>卦 成</span><b>六爻已就绪</b></div><em>动爻 ${esc(CN_NUM[movingCount])} 处</em>`;
    }
  }
  if (done) {
    submit.hidden = false;
    const privateExhausted = (
      isPrivate
      && quota
      && !quota.can_start_answer
    );
    submit.disabled = false;
    submit.textContent = isHelp
      ? "发 布 社 区 求 助"
      : isPrivate
      ? (privateExhausted ? "积 分 暂 不 可 用 · 查 看 账 户" : "开 始 私 密 解 读")
      : "开 始 公 开 解 读";
    if (manualHint) manualHint.hidden = true;
    if (reset) reset.textContent = manual ? "重新起卦" : "重新摇一次";
    if (note) note.textContent = isHelp
      ? "公开脱敏卦象，不调用 AI，不扣积分"
      : "围绕这件事继续追问";
    return;
  }
  if (manual) {
    submit.hidden = true;
    if (manualHint) manualHint.hidden = false;
    if (reset) reset.textContent = "重新起卦";
    if (note) note.textContent = "按记录逐爻录入";
    return;
  }
  submit.hidden = false;
  const completed = clientCastYaos.length;
  const nextPosition = Math.min(6, completed + 1);
  submit.disabled = clientCastPendingPos > 0;
  submit.textContent = clientCastPendingPos > 0
    ? `第 ${clientCastPendingPos} 爻 · 钱 落 …`
    : `掷 第 ${nextPosition} 爻 · 共 6 爻`;
  if (manualHint) manualHint.hidden = true;
  if (reset) reset.textContent = "重新起卦";
  if (note) note.textContent = completed
    ? `已完成 ${completed}/6 · 下一爻继续自下而上点亮`
    : "本机随机 · 自下而上六掷";
}
function clientCastWaitingMs() {
  return Math.max(0, clientCastRevealAt - Date.now());
}
function clearClientCastPending() {
  clientCastPendingPos = 0;
  clientCastPendingCoins = null;
  clientCastRevealAt = 0;
  if (clientCastRevealTimer) clearTimeout(clientCastRevealTimer);
  if (clientCastFaceTimer) clearTimeout(clientCastFaceTimer);
  clientCastRevealTimer = null;
  clientCastFaceTimer = null;
  const stage = $("#coin-stage");
  if (stage) stage.classList.remove("is-casting");
}
/* 铜钱正背常驻，480ms 高速时按各钱结果切 opacity；1.34s 全部落定后写入爻 */
function syncCoinFaces(coins, settled) {
  const faces = $$("#coin-stage .coin-face");
  faces.forEach((face, i) => {
    const zi = !coins || coins[i] === "字";
    face.classList.toggle("show-back", !zi);
    const tag = face.querySelector(".coin-tag");
    if (tag) {
      tag.textContent = settled && coins ? coins[i] : "";
      tag.classList.toggle("bei", !!(settled && coins && coins[i] === "背"));
    }
  });
}
function revealClientYao() {
  if (!clientCastPendingPos || !clientCastPendingCoins) {
    clearClientCastPending();
    renderCastRows();
    return;
  }
  const coins = clientCastPendingCoins;
  const value = coins.reduce((sum, coin) => sum + (coin === "背" ? 3 : 2), 0);
  clientCastCoins.push(coins);
  clientCastYaos.push(value);
  if (clientCastYaos.length === 6) clientCastCompletedAt = localDateTimeISO();
  clearClientCastPending();
  syncCoinFaces(coins, true);
  renderCastRows();
}
function startClientCastReveal() {
  clearClientCastPending();
  if (clientCastYaos.length >= 6) {
    syncCastUI();
    return;
  }
  if (!window.crypto?.getRandomValues) {
    showCastError("当前浏览器不支持安全随机数，无法本机摇钱。");
    return;
  }
  const bytes = new Uint8Array(3);
  window.crypto.getRandomValues(bytes);
  clientCastPendingCoins = Array.from(bytes, b => (b % 2 ? "背" : "字"));
  clientCastPendingPos = clientCastYaos.length + 1;
  clientCastRevealAt = Date.now() + CLIENT_CAST_REVEAL_DELAY_MS;
  const stage = $("#coin-stage");
  if (stage) stage.classList.add("is-casting");
  syncCoinFaces(null, false);
  clientCastFaceTimer = setTimeout(() => syncCoinFaces(clientCastPendingCoins, false), 480);
  clientCastRevealTimer = setTimeout(revealClientYao, CLIENT_CAST_REVEAL_DELAY_MS);
  renderCastRows();
}
function resetClientCast() {
  clearClientCastPending();
  clientCastYaos = [];
  clientCastCoins = [];
  manualYaos = Array(6).fill(undefined);
  clientCastCompletedAt = "";
  const publicVisibility = document.querySelector('input[name="cast-visibility"][value="public"]');
  const helpVisibility = document.querySelector('input[name="cast-visibility"][value="help"]');
  const privateVisibility = document.querySelector('input[name="cast-visibility"][value="private"]');
  if (combinedCastActive()) {
    if (privateVisibility) privateVisibility.checked = true;
  } else if (helpVisibility || publicVisibility) {
    (helpVisibility || publicVisibility).checked = true;
  }
  syncCastEntryMode();
  syncCoinFaces(null, false);
  renderCastRows();
}
function shakeClientYao() {
  clearCastError();
  if (!$("#cast-question").value.trim()) {
    showCastQuestionError("先写下所问之事，再掷铜钱。");
    return;
  }
  if (clientCastYaos.length >= 6) return;
  if (clientCastWaitingMs() > 0) return;
  startClientCastReveal();
}
function initCastModal() {
  $("#cast-method").addEventListener("change", syncCastMethod);
  const castMethodButtons = $$("[data-cast-method-btn]");
  castMethodButtons.forEach(btn => {
    btn.onclick = () => setCastMethod(btn.dataset.castMethodBtn || "client_coins");
  });
  bindHorizontalTabKeys(castMethodButtons, btn => setCastMethod(btn.dataset.castMethodBtn || "client_coins"));
  $("#cast-reset-btn").onclick = () => { clearCastError(); resetClientCast(); };
  $$('input[name="cast-visibility"]').forEach(input => input.addEventListener("change", syncCastUI));
  $("#cast-question")?.addEventListener("input", clearCastQuestionError);
  renderCastRows();
  syncCastMethod();
}
function readCastYaos() {
  return manualYaos.map(v => (v === undefined ? null : v)).filter(v => v !== null);
}
async function submitCast(ev) {
  if (ev) ev.preventDefault();
  const method = $("#cast-method").value;
  const question = $("#cast-question").value.trim();
  clearCastError();
  if (!question) {
    showCastQuestionError("先写下所问之事，再掷铜钱。");
    return;
  }
  if (method === "client_coins" && clientCastYaos.length < 6) {
    shakeClientYao();
    return;
  }
  if (method === "manual" && readCastYaos().length !== 6) {
    toast("先自下而上录满六爻，再开始解读", "warn");
    return;
  }
  const visibility = document.querySelector('input[name="cast-visibility"]:checked')?.value || "help";
  const communityHelp = visibility === "help";
  const loggedIn = await Account?.requireLogin({
    mode: "register",
    message: communityHelp
      ? "登录并验证邮箱后可免费求助，不调用 AI，不扣积分。"
      : visibility === "private"
      ? "私密提问，先登录或注册。"
      : "登录后使用每日免费积分。分享公开问题可增加每日积分。",
  });
  if (!loggedIn) return;
  const answerQuota = Account?.snapshot()?.privateQuota;
  if (!communityHelp && answerQuota && !answerQuota.can_start_answer) {
    showCastError("今日免费积分与账户积分已用完；明日北京时间 0 点刷新，或到账户充值后继续。");
    Account?.open?.("topup", "积分已用完。充值后继续当前解读。");
    syncCastUI();
    return;
  }
  const body = {
    system: "liuyao",
    method,
    question,
    as_of: method === "client_coins" && clientCastCompletedAt ? clientCastCompletedAt : localDateTimeISO(),
    visibility: communityHelp ? "private" : visibility,
    public_consent: visibility === "public",
    public_consent_version: visibility === "public" ? LIUYAO_PUBLIC_CONSENT_VERSION : "",
  };
  const chartSessionId = createSessionId();
  body.session_id = chartSessionId;
  if (method === "client_coins") body.yaos = clientCastYaos.slice();
  if (method === "manual") body.yaos = readCastYaos();
  const submit = $("#cast-submit");
  submit.disabled = true; submit.textContent = "入 局 中 …";
  showRitualOverlay(["装卦 · 纳甲定世应 …", "排六神 · 观动爻 …"], 750);
  try {
    if (pendingCombinedEntry && !activePersonalCaseId) {
      submit.textContent = "建 立 详 断 …";
      const caseResponse = await fetch("/api/personal-home/cases", {
        method: "POST",
        headers: Account.csrfHeaders({ "Content-Type": "application/json", Accept: "application/json" }),
        credentials: "same-origin",
        body: JSON.stringify({ mode: "combined", question }),
      });
      if (!caseResponse.ok) throw new Error(await caseResponse.text());
      const casePayload = await caseResponse.json();
      setActivePersonalCase(casePayload?.item);
      if (!activePersonalCaseId) throw new Error("详断事项没有建立成功，请重试");
      pendingCombinedEntry = false;
      const url = new URL(window.location.href);
      url.searchParams.set("personal_case", activePersonalCaseId);
      url.searchParams.delete("flow");
      history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
      syncCastEntryMode();
    }
    if (activePersonalCaseId) body.personal_case_id = activePersonalCaseId;
    const r = await fetch("/api/chart", {
      method: "POST", headers: Account.csrfHeaders({ "Content-Type": "application/json" }), body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(await r.text());
    state.system = "liuyao";
    lastInput = body;
    lastPayload = await r.json();
    if (activePersonalCaseId && activePersonalCase) {
      activePersonalCase = {
        ...activePersonalCase,
        liuyao_profile_id: Number(lastPayload.profile_id || activePersonalCase.liuyao_profile_id || 0),
        status: "awaiting_interpretation",
      };
    }
    activeChartId = lastPayload.chart_id || null;
    profileName = lastPayload.profile_name || (lastPayload.ben_gua && lastPayload.ben_gua.name) || "六爻";
    calendarLabel = "六爻";
    activeProfileId = lastPayload.profile_id || null;
    if (communityHelp) {
      submit.textContent = "发 布 求 助 …";
      const created = await createCommunityHelp(activeProfileId, question);
      window.location.assign(created.post?.url || `/community/${encodeURIComponent(created.post?.slug || "")}`);
      return;
    }
    activeHistory = [];
    resetThreads();
    if (activePersonalCaseId) {
      const draft = $("#draft-input");
      if (draft) draft.value = "";
    }
    state.sessionIds["断卦"] = chartSessionId;
    clearClientCastPending();
    enterDashboard({ historyMode: "replace", focusPage: true });
    saveResumeCookie();
    refreshAccountArchiveState();
    const key = "断卦";
    if (riskAckNeeded(key)) {
      pendingStartAfterRiskAck = key;
      toast("卦已成，确认参考声明后将自动开始解读");
      window.requestAnimationFrame(() => {
        document.querySelector(`[data-risk-ack-tab="${key}"]`)?.focus({ preventScroll: true });
      });
    } else {
      pendingStartAfterRiskAck = "";
      startThread(key);
    }
  } catch (e) {
    const er = $("#cast-error"); er.textContent = "起卦失败：" + humanError(String(e.message || e)); er.hidden = false;
  } finally {
    hideRitualOverlay();
    syncCastUI();
  }
}

function humanError(raw) {
  const friendlyTransportError = (message) => {
    const text = String(message || "").trim();
    if (/Internal Server Error|Bad Gateway|Service Unavailable|Gateway Timeout|HTTP\s*5\d\d/i.test(text)) {
      return "服务暂时不可用，请稍后重试；已填写的信息不会丢失。";
    }
    if (/Failed to fetch|NetworkError|Network request failed|Load failed|网络连接失败/i.test(text)) {
      return "网络连接不稳定，请检查网络后重试；已填写的信息不会丢失。";
    }
    return "";
  };
  if (/key|configured/i.test(raw)) {
    const unit = state.system === "liuyao" ? "卦盘" : "命盘";
    return `AI 解读不可用。${unit}已保存，稍后重试。`;
  }
  const transportError = friendlyTransportError(raw);
  if (transportError) return transportError;
  try {
    const o = JSON.parse(raw);
    if (o.detail) {
      if (typeof o.detail === "string") return friendlyTransportError(o.detail) || o.detail;
      if (typeof o.detail.message === "string") return friendlyTransportError(o.detail.message) || o.detail.message;
      return JSON.stringify(o.detail);
    }
  } catch (_) {}
  return raw.length > 200 ? raw.slice(0, 200) + "…" : raw;
}

function resetThreads() {
  stopAllPendingWork();
  pendingStartAfterRiskAck = "";
  initThreads();
  state.activeTab = currentTabs()[0].key;
}

function renderSessionSwitcher(kind) {
  const bazi = $("#session-bazi-btn");
  const liuyao = $("#session-liuyao-btn");
  if (!bazi || !liuyao) return;
  const isBazi = kind === "bazi";
  const compact = !isDesktopLayout();
  /* 主导航只恢复十分钟内的会话；更早的内容统一从“我的档案”打开。 */
  const otherBazi = workspaceRecentlyActive("bazi") ? sessionStore.bazi : null;
  const otherLiuyao = workspaceRecentlyActive("liuyao") ? sessionStore.liuyao : null;
  const baziName = otherBazi?.lastPayload
    ? (otherBazi.profileName || "命盘")
    : "";
  const baziEmpty = !isBazi && !baziName;
  const liuyaoEmpty = isBazi && !otherLiuyao?.lastPayload;
  bazi.textContent = isBazi
    ? `命 · ${profileName || "命盘"}`
    : (baziName ? (compact ? "命" : `命 · ${baziName}`) : (compact ? "排盘" : "命 +"));
  const benName = isBazi
    ? (otherLiuyao?.lastPayload?.ben_gua?.name
      || "")
    : (lastPayload?.ben_gua?.name || "六爻");
  const bianName = !isBazi && compact && (lastPayload?.dong_yao || []).length
    ? (lastPayload?.bian_gua?.name || "")
    : "";
  const currentLiuyaoName = bianName ? `${benName}→${bianName}` : benName;
  liuyao.textContent = isBazi
    ? (benName ? (compact ? "卦" : `卦 · ${benName}`) : (compact ? "起卦" : "起卦 +"))
    : `卦 · ${currentLiuyaoName}`;
  bazi.className = `session-btn${isBazi ? " active" : " add"}${baziEmpty ? " empty" : ""}`;
  liuyao.className = `session-btn${isBazi ? " add" : " active"}${liuyaoEmpty ? " empty" : ""}`;
  bazi.title = isBazi
    ? "当前命盘"
    : (otherBazi?.lastPayload ? "回到最近命盘" : "排一张新命盘");
  liuyao.title = isBazi
    ? (otherLiuyao?.lastPayload ? "回到最近一卦" : "重新起一卦")
    : "当前卦盘";
}

/* ---------- 手机版盘条：四柱/卦名速览 + 「看盘」抽屉入口 ---------- */
function renderBoardStrip() {
  const main = $("#board-strip-main");
  if (!main || !lastPayload) return;
  if (detailedWorkspaceActive()) {
    const ben = lastPayload.ben_gua || {};
    const arrow = (lastPayload.dong_yao || []).length ? ` → ${(lastPayload.bian_gua || {}).name || ""}` : "";
    main.innerHTML =
      `<span class="bs-detailed-chip">一事详断</span>` +
      `<span class="bs-detailed-question">${esc(liuyaoQuestionText())}</span>` +
      `<span class="bs-meta">命盘 × ${esc((ben.name || "本卦") + arrow)}</span>`;
    return;
  }
  if (state.system === "liuyao") {
    const p = lastPayload;
    const ben = p.ben_gua || {};
    const arrow = (p.dong_yao || []).length ? ` → ${(p.bian_gua || {}).name || ""}` : "";
    main.innerHTML =
      `<span class="bs-gua-chip">${esc((ben.name || "六爻") + arrow)}</span>` +
      `<span class="bs-meta">动爻 ${esc(CN_NUM[(p.dong_yao || []).length] || "零")}</span>`;
  } else {
    const c = lastPayload.chart || {};
    const dm = c.day_master || {};
    main.innerHTML =
      `<span class="bs-pillars">${renderPillarChips(c.pillars || {})}</span>` +
      `<span class="bs-meta">日主${esc(dm.stem || "")}${esc(dm.element || "")}</span>`;
  }
}

function liuyaoQuestionText() {
  return String(lastPayload?.question || lastInput?.question || "所问事项").trim() || "所问事项";
}

function detailedCaseStatusText() {
  if (state.streaming || activeStreamingMessage()) return "正在合参";
  const messages = state.threads?.断卦 || [];
  if (messages.some(item => item.kind === "ai" && String(item.body || "").trim())) return "可继续追问";
  const status = String(activePersonalCase?.status || "");
  if (status === "completed") return "已回看";
  if (status === "review") return "已有结论";
  return "等待详断";
}

function detailedBaziProfileView() {
  const caseProfileId = Number(activePersonalCase?.bazi_profile_id || 0);
  if (Number(activeDetailedBaziProfile?.id || 0) === caseProfileId) return activeDetailedBaziProfile;
  const indexed = accountProfileFor("bazi");
  if (indexed && (!caseProfileId || Number(indexed.id || 0) === caseProfileId)) return indexed;
  return null;
}

function detailedBaziFacts() {
  const profile = detailedBaziProfileView();
  const summary = profile?.summary || {};
  const payload = profile?.payload || {};
  const chart = payload.chart || {};
  const pillars = chart.pillars || summary.pillars || {};
  const pillarText = ["year", "month", "day", "hour"].map(key => pillars[key]).filter(Boolean).join(" ");
  const dm = chart.day_master || {};
  const phase = [
    payload.da_yun?.current ? `大运 ${payload.da_yun.current}` : "",
    payload.liu_nian?.pillar ? `${payload.liu_nian.year || "本年"} ${payload.liu_nian.pillar}` : "",
  ].filter(Boolean).join(" · ");
  return {
    id: Number(profile?.id || activePersonalCase?.bazi_profile_id || 0),
    name: profile?.name || "本人默认命盘",
    pillars: pillarText,
    dayMaster: dm.stem ? `日主${dm.stem}${dm.element || ""}` : (summary.shengxiao ? `生肖${summary.shengxiao}` : ""),
    phase,
    loaded: !!profile,
  };
}

async function ensureDetailedBaziProfile() {
  const caseId = activePersonalCaseId;
  const profileId = Number(activePersonalCase?.bazi_profile_id || 0);
  if (!caseId || !profileId || Number(activeDetailedBaziProfile?.id || 0) === profileId) return;
  if (detailedBaziProfileRequest?.profileId === profileId) return detailedBaziProfileRequest.promise;
  const request = fetch(`/api/profiles/${profileId}`, {
    headers: { Accept: "application/json" },
    credentials: "same-origin",
  }).then(async response => {
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  });
  detailedBaziProfileRequest = { profileId, promise: request };
  try {
    const profile = await request;
    if (activePersonalCaseId !== caseId || Number(activePersonalCase?.bazi_profile_id || 0) !== profileId) return;
    activeDetailedBaziProfile = profile;
    if (detailedWorkspaceActive()) {
      renderBoardStrip();
      renderRailChrome();
      renderLiuYaoTopbar();
      renderLiuYaoChart();
      renderProfileFab();
    }
  } catch (_) {
    // 复合页仍可用卦象与事项作降级展示；命盘只显示“正在读取”，不拼造事实。
  } finally {
    if (detailedBaziProfileRequest?.promise === request) detailedBaziProfileRequest = null;
  }
}

/* 手机版看盘抽屉的标题与底部动作行 */
function renderRailChrome() {
  const title = $("#rail-title-m");
  const sub = $("#rail-sub-m");
  const rechart = $("#rail-rechart-btn");
  const gloss = $("#rail-gloss-btn");
  if (!title) return;
  if (detailedWorkspaceActive()) {
    title.textContent = "复合依据";
    if (sub) sub.textContent = "八字 × 卦象同参";
    if (rechart) rechart.textContent = "另起一事";
    if (gloss) {
      gloss.textContent = detailedCaseStatusText();
      gloss.title = "当前事项状态";
      gloss.disabled = true;
      gloss.classList.add("question");
      gloss.setAttribute("aria-disabled", "true");
    }
    return;
  }
  if (state.system === "liuyao") {
    const p = lastPayload || {};
    const question = liuyaoQuestionText();
    title.textContent = "卦 盘";
    if (sub) sub.textContent = `月建 ${p.month_jian || "—"} · 日辰 ${p.day_chen || "—"}`;
    if (rechart) rechart.textContent = "重新起卦";
    if (gloss) {
      gloss.textContent = question;
      gloss.title = question;
      gloss.disabled = true;
      gloss.classList.add("question");
      gloss.setAttribute("aria-disabled", "true");
    }
  } else {
    const dm = lastPayload?.chart?.day_master || {};
    title.textContent = "命 盘";
    if (sub) sub.textContent = dm.stem ? `日主${dm.stem}${dm.element || ""}` : "";
    if (rechart) rechart.textContent = "修改信息";
    if (gloss) {
      gloss.textContent = "名词解释";
      gloss.title = "名词解释";
      gloss.disabled = false;
      gloss.classList.remove("question");
      gloss.removeAttribute("aria-disabled");
    }
  }
}

function renderPillarChips(pillars = {}) {
  return ["year", "month", "day", "hour"].map(k => {
    const gz = pillars[k] || "—";
    return `<span class="dt-pillar-chip${k === "day" ? " day" : ""}">${esc(gz)}</span>`;
  }).join("");
}

/* ============================================================
   进入工作台 + 渲染顶栏 / 命盘 / 当前阶段
   ============================================================ */
function enterDashboard({ preserveEntryLocation = false, historyMode = "replace", focusPage = false } = {}) {
  showScreen("dash", { preserveEntryLocation, historyMode, focusPage });
  sessionStore[currentWorkspaceKey("dash")] = snapshotSession("dash");
  document.body.dataset.system = state.system;
  const detailed = detailedWorkspaceActive();
  document.body.dataset.workspace = detailed ? "detailed" : state.system;
  const sessionSwitcher = $("#session-switcher");
  const detailedLabel = $("#detailed-workspace-label");
  if (sessionSwitcher) sessionSwitcher.hidden = detailed;
  if (detailedLabel) detailedLabel.hidden = !detailed;
  if (!detailed) {
    const topLabel = document.querySelector("#top-profile-btn .top-profile-label");
    if (topLabel) topLabel.textContent = "档案";
    const topProfile = $("#top-profile-btn");
    if (topProfile) topProfile.onclick = () => Account.requireLogin({ mode: "login", message: "登录后查看私人档案。" }).then(ok => { if (ok) openProfileLibrary({ includeCurrent: !!lastPayload }); });
    const rechart = $("#rechart-btn");
    if (rechart) rechart.onclick = () => { state.system === "liuyao" ? openCastModal() : openBirthModal(); };
    const railRechart = $("#rail-rechart-btn");
    if (railRechart) railRechart.onclick = () => { state.system === "liuyao" ? openCastModal() : openBirthModal(); };
  }
  const ncTitle = document.querySelector(".nc-title h2");
  if (ncTitle) ncTitle.textContent = detailed ? "命卦同参" : state.system === "liuyao" ? "卦 盘" : "命 盘";
  const stageTitle = document.querySelector(".stage-head h2");
  if (stageTitle) stageTitle.textContent = detailed ? "合参锚点" : "行 运";
  $$(".segmented").forEach(el => { el.hidden = state.system === "liuyao"; });
  const modeRow = document.querySelector(".nc-mode-row-m");
  if (modeRow) modeRow.hidden = state.system === "liuyao";
  renderBoardStrip();
  renderRailChrome();
  if (state.system === "liuyao") {
    renderLiuYaoTopbar();
    renderLiuYaoChart();
    renderTabs();
    renderThread();
    renderProfileFab();
    if (detailed) ensureDetailedBaziProfile();
    return;
  }
  renderTopbar();
  renderNatalChart();
  renderStage();
  renderTabs();
  renderThread();
  renderProfileFab();
}

function renderTopbar() {
  const p = lastPayload, c = p.chart, dm = c.day_master;
  renderSessionSwitcher("bazi");
  const rechart = $("#rechart-btn");
  if (rechart) rechart.textContent = "修改信息";
  const ask = $("#ask-chart-btn");
  if (ask) { ask.textContent = "解读此盘 →"; ask.onclick = () => closeChartDrawer(() => { switchTab("解读"); fillComposerQuestion(DEFAULT_Q.topic.本命); }); }
  const communityAsk = $("#ask-community-btn");
  if (communityAsk) { communityAsk.hidden = false; communityAsk.textContent = "社区求助"; communityAsk.onclick = openCommunityHelpDialog; }
  const topCommunityAsk = $("#top-community-btn");
  if (topCommunityAsk) topCommunityAsk.hidden = false;
  const trend = $("#open-trend-btn");
  if (trend) trend.hidden = false;
  const manual = isManualBaziPayload(p);
  const solar = (p.profile.solar || "").slice(0, 16);
  const solarLabel = solar ? `${solar}${p.profile.used_true_solar ? " 真太阳时" : ""}` : "";
  const manualApprox = manual && (p.warnings || []).some(w => String(w || "").includes("行运近似锚点"));
  const profileBits = [genderLabel(p.profile.gender), c.shengxiao ? "生肖" + c.shengxiao : "", manual ? `手动四柱 ${manualApprox ? "近似锚点" : "匹配"}` : (lastInput.location || "—"), calendarLabel, solarLabel].filter(Boolean);
  $("#dt-stamp").textContent = profileBits.join(" · ");
  $("#dt-pillars").innerHTML = renderPillarChips(c.pillars);
  $("#nc-daymaster").textContent = `日主${dm.stem}${dm.element}`;
  $("#dm-summary").textContent = "";
}
function genderLabel(g) { return g === "male" || g === "男" ? "男" : g === "female" || g === "女" ? "女" : "—"; }

/* ============================================================
   六爻盘渲染（完整盘面：自上而下六爻 / 纳甲六亲六神 / 世应动爻 / 变卦 / 伏神 / 点爻浮窗）
   ============================================================ */
const LY_POS_NAME = { 1: "初", 2: "二", 3: "三", 4: "四", 5: "五", 6: "上" };
// 工作区统一为浅色内容页，盘面与点爻浮窗共用纸面高对比配色。
function liuyaoElColor(wx) { return EL_PAPER[wx] || "#5C564A"; }
function liuyaoPaperColor(wx) { return EL_PAPER[wx] || "#5C564A"; }

function renderLiuYaoTopbar() {
  if (detailedWorkspaceActive()) {
    renderDetailedTopbar();
    return;
  }
  const p = lastPayload;
  const ben = p.ben_gua || {};
  renderSessionSwitcher("liuyao");
  const rechart = $("#rechart-btn");
  if (rechart) rechart.textContent = "重新起卦";
  $("#dt-stamp").textContent = `月建 ${p.month_jian || "—"} · 日辰 ${p.day_chen || "—"} · 旬空 ${p.xun_kong || "—"}`;
  const arrow = (p.dong_yao || []).length ? ` → ${(p.bian_gua || {}).name || ""}` : "";
  $("#dt-pillars").innerHTML = `<span class="dt-gua-chip">${esc((ben.name || "六爻") + arrow)}</span>`;
  $("#nc-daymaster").textContent = `月建${p.month_jian || "—"} · 日辰${p.day_chen || "—"}`;
  $("#dm-summary").textContent = "";
  const communityAsk = $("#ask-community-btn");
  if (communityAsk) { communityAsk.hidden = false; communityAsk.textContent = "社区求助"; communityAsk.onclick = openCommunityHelpDialog; }
  const topCommunityAsk = $("#top-community-btn");
  if (topCommunityAsk) topCommunityAsk.hidden = false;
}

function renderDetailedTopbar() {
  const p = lastPayload || {};
  const ben = p.ben_gua || {};
  const bian = (p.dong_yao || []).length ? ` → ${(p.bian_gua || {}).name || "变卦"}` : "";
  const question = liuyaoQuestionText();
  const label = $("#detailed-workspace-label");
  if (label) {
    label.hidden = false;
    const status = label.querySelector("em");
    if (status) status.textContent = `八字 × 卦象 · ${detailedCaseStatusText()}`;
  }
  const switcher = $("#session-switcher");
  if (switcher) switcher.hidden = true;
  $("#dt-stamp").textContent = question;
  $("#dt-pillars").innerHTML = `<span class="dt-detailed-chip">命盘 × ${esc((ben.name || "本卦") + bian)}</span>`;
  $("#nc-daymaster").textContent = "八字 × 卦象同参";
  $("#dm-summary").textContent = "";
  const communityAsk = $("#ask-community-btn");
  if (communityAsk) communityAsk.hidden = true;
  const topCommunityAsk = $("#top-community-btn");
  if (topCommunityAsk) topCommunityAsk.hidden = true;
  const rechart = $("#rechart-btn");
  if (rechart) {
    rechart.textContent = "另起一事";
    rechart.onclick = () => PersonalHome?.openDetailed();
  }
  const topLabel = document.querySelector("#top-profile-btn .top-profile-label");
  if (topLabel) topLabel.textContent = "事项";
  const topProfile = $("#top-profile-btn");
  if (topProfile) topProfile.onclick = openDetailedCaseOverview;
}

function liuyaoLineGlyph(item) {
  // 阳爻实、阴爻断；动爻标记
  const solid = item.yin_yang === "阳";
  const base = solid ? "▬▬▬▬▬" : "▬▬&nbsp;&nbsp;▬▬";
  let mark = "";
  if (item.moving) mark = item.old_young === "老阳" ? " ○" : " ×";
  return `<span class="ly-line ${solid ? "yang" : "yin"}">${base}</span><span class="ly-move">${mark}</span>`;
}

function renderLiuYaoChart() {
  if (detailedWorkspaceActive()) {
    renderDetailedEvidenceRail();
    return;
  }
  const p = lastPayload;
  const natalFacts = $("#natal-facts");
  natalFacts.innerHTML = "";
  natalFacts.hidden = true;
  $("#wuxing-bar").innerHTML = "";
  $("#wuxing-bar").hidden = true;
  $("#shensha-row").innerHTML = "";
  $("#shensha-row").hidden = true;
  $("#basic-hint").hidden = true;
  const rows = (p.yaos || []).slice().reverse().map(item => {
    const marks = [];
    if (item.shi) marks.push('<span class="ly-tag shi">世</span>');
    if (item.ying) marks.push('<span class="ly-tag ying">应</span>');
    if (item.kong) marks.push('<span class="ly-tag kong">空</span>');
    const fu = item.fu_shen
      ? `<span class="ly-fu">伏 ${esc(item.fu_shen.liu_qin)}${esc(item.fu_shen.najia)}</span>` : "";
    const bian = item.bian
      ? `<span class="ly-bian">→ ${esc(item.bian.liu_qin)}${esc(item.bian.najia)}</span>` : "";
    return `<button type="button" class="ly-row${item.moving ? " moving" : ""}" data-yao-pos="${item.pos}">
      <span class="ly-shen">${esc(item.liu_shen)}</span>
      <span class="ly-qin">${esc(item.liu_qin)}</span>
      <span class="ly-najia" style="color:${liuyaoElColor(item.wuxing)}">${esc(item.najia)}</span>
      <span class="ly-glyph">${liuyaoLineGlyph(item)}</span>
      <span class="ly-pos">${LY_POS_NAME[item.pos] || item.pos}</span>
      <span class="ly-marks">${marks.join("")}</span>
      ${fu}${bian}
    </button>`;
  }).join("");
  const ben = p.ben_gua || {}, bian = p.bian_gua || {};
  const hasBian = (p.dong_yao || []).length > 0;
  const dongText = liuyaoDongText(p);
  const focusTitle = hasBian
    ? `${esc(ben.name || "本卦")} <span>之</span> ${esc(bian.name || "变卦")}`
    : esc(ben.name || "本卦");
  const grid = $("#pillars-grid");
  grid.classList.remove("is-detailed");
  grid.classList.add("is-liuyao");
  grid.innerHTML =
    `<div class="liuyao-focus-card">
      <span class="corner tl"></span><span class="corner tr"></span><span class="corner bl"></span><span class="corner br"></span>
      <div class="lfc-k">本 卦${hasBian ? " → 变 卦" : ""}</div>
      <div class="lfc-title">${focusTitle}</div>
      <div class="lfc-meta">${esc(ben.palace || "—")}宫${esc(ben.palace_label || "")} · 动爻 ${esc(dongText)}</div>
    </div>
    <div class="liuyao-board">${rows}</div>
    <div class="liuyao-note">纳甲六亲依京房八宫 · 六神依日干起法</div>`;
  // 当前阶段卡 → 六爻关键摘要
  const dong = dongText;
  const stageRows = $("#stage-rows");
  stageRows.hidden = false;
  stageRows.classList.remove("stage-rows-horizontal");
  stageRows.style.removeProperty("--stage-count");
  const dayunTimeline = $("#dayun-timeline");
  dayunTimeline.innerHTML = "";
  dayunTimeline.hidden = true;
  stageRows.innerHTML =
    `<div class="ly-summary-row"><span>本卦</span><b>${esc(ben.name || "")}（${esc(ben.palace || "")}宫${esc(ben.palace_label || "")}）</b></div>` +
    `<div class="ly-summary-row"><span>变卦</span><b>${(p.dong_yao || []).length ? esc(bian.name || "") : "无（六爻安静）"}</b></div>` +
    `<div class="ly-summary-row"><span>世/应</span><b>${LY_POS_NAME[p.shi_yao] || "?"}爻 / ${LY_POS_NAME[p.ying_yao] || "?"}爻</b></div>` +
    `<div class="ly-summary-row"><span>动爻</span><b>${dong}</b></div>`;
  $("#advanced-stage").innerHTML = "";
  const trend = $("#open-trend-btn"); if (trend) trend.hidden = true;
  const ask = $("#ask-chart-btn");
  if (ask) { ask.textContent = "解读此卦 →"; ask.onclick = () => closeChartDrawer(() => { switchTab("断卦"); startThread("断卦"); }); }
  $("#pillars-grid").querySelectorAll("[data-yao-pos]").forEach(btn => {
    btn.onclick = () => {
      const pos = Number(btn.dataset.yaoPos);
      const item = (lastPayload.yaos || []).find(y => y.pos === pos);
      if (item) openPop(yaoPop(item));
    };
  });
}

function renderDetailedEvidenceRail() {
  const p = lastPayload || {};
  const bazi = detailedBaziFacts();
  const ben = p.ben_gua || {};
  const bian = p.bian_gua || {};
  const hasBian = (p.dong_yao || []).length > 0;
  const question = liuyaoQuestionText();
  const pillarChips = bazi.pillars
    ? bazi.pillars.split(/\s+/).map((pillar, index) => `<span${index === 2 ? ' class="day"' : ""}>${esc(pillar)}</span>`).join("")
    : '<em>正在读取默认命盘…</em>';
  const guaName = hasBian ? `${ben.name || "本卦"} → ${bian.name || "变卦"}` : (ben.name || "本卦");

  const natalFacts = $("#natal-facts");
  natalFacts.innerHTML = "";
  natalFacts.hidden = true;
  $("#wuxing-bar").innerHTML = "";
  $("#wuxing-bar").hidden = true;
  $("#shensha-row").innerHTML = "";
  $("#shensha-row").hidden = true;
  $("#basic-hint").hidden = true;

  const grid = $("#pillars-grid");
  grid.classList.remove("is-liuyao");
  grid.classList.add("is-detailed");
  grid.innerHTML =
    `<section class="detailed-question-card" aria-label="本次详断事项">
      <span>本次只断这一件事</span>
      <h3>${esc(question)}</h3>
      <p>问题、命盘、卦象和后续追问都收在同一事项中。</p>
    </section>
    <div class="detailed-sources" aria-label="复合详断依据">
      <section class="detailed-source bazi">
        <div class="detailed-source-head"><span>命</span><div><b>本人命盘</b><em>看你与当前阶段</em></div></div>
        <strong>${esc(bazi.name)}</strong>
        <div class="detailed-pillar-row">${pillarChips}</div>
        <p>${esc([bazi.dayMaster, bazi.phase].filter(Boolean).join(" · ") || "默认命盘已关联")}</p>
      </section>
      <div class="detailed-source-link" aria-hidden="true"><i></i><b>合参</b><i></i></div>
      <section class="detailed-source gua">
        <div class="detailed-source-head"><span>卦</span><div><b>本次卦象</b><em>看此事与应期</em></div></div>
        <strong>${esc(guaName)}</strong>
        <div class="detailed-gua-meta">
          <span>${esc(ben.palace || "—")}宫${esc(ben.palace_label || "")}</span>
          <span>动爻 ${esc(liuyaoDongText(p))}</span>
        </div>
        <p>${esc(p.month_jian || "—")}月建 · ${esc(p.day_chen || "—")}日辰 · 旬空 ${esc(p.xun_kong || "—")}</p>
      </section>
    </div>
    <div class="detailed-method-note"><b>复合口径</b><span>八字定人和阶段，卦象定这件事；最终结论统一收束，不把两套结果并排堆给你。</span></div>`;

  const stageTitle = document.querySelector(".stage-head h2");
  if (stageTitle) stageTitle.textContent = "合参锚点";
  const trend = $("#open-trend-btn");
  if (trend) trend.hidden = true;
  const stageRows = $("#stage-rows");
  stageRows.hidden = false;
  stageRows.classList.remove("stage-rows-horizontal");
  stageRows.style.removeProperty("--stage-count");
  stageRows.innerHTML =
    `<div class="detailed-anchor-row"><span>命</span><div><b>${esc(bazi.phase || bazi.dayMaster || "本人命盘")}</b><em>用于判断你在当前阶段的承接方式</em></div></div>
     <div class="detailed-anchor-row"><span>卦</span><div><b>${esc(guaName)}</b><em>${esc(p.month_jian || "—")}月建 · ${esc(p.day_chen || "—")}日辰 · 动爻 ${esc(liuyaoDongText(p))}</em></div></div>
     <div class="detailed-anchor-row result"><span>断</span><div><b data-detailed-status>${esc(detailedCaseStatusText())}</b><em>围绕同一事项继续追问，不另开八字或六爻会话</em></div></div>`;
  const dayunTimeline = $("#dayun-timeline");
  dayunTimeline.innerHTML = "";
  dayunTimeline.hidden = true;
  $("#advanced-stage").innerHTML = "";

  const ask = $("#ask-chart-btn");
  if (ask) {
    ask.textContent = "查看详断 →";
    ask.onclick = () => closeChartDrawer(() => {
      switchTab("断卦");
      if (!(state.threads.断卦 || []).length) startThread("断卦");
      $("#draft-input")?.focus({ preventScroll: true });
    });
  }
  const railRechart = $("#rail-rechart-btn");
  if (railRechart) {
    railRechart.textContent = "另起一事";
    railRechart.onclick = () => PersonalHome?.openDetailed();
  }
}

function yaoPop(item) {
  const facts = [
    { k: "纳甲", v: `${item.najia}（${item.wuxing}）` },
    { k: "六亲", v: item.liu_qin },
    { k: "六神", v: item.liu_shen },
    { k: "动静", v: item.moving ? `动 · ${item.old_young}` : "静" },
  ];
  if (item.shi) facts.push({ k: "世应", v: "世爻" });
  if (item.ying) facts.push({ k: "世应", v: "应爻" });
  if (item.kong) facts.push({ k: "旬空", v: "空亡" });
  if (item.fu_shen) facts.push({ k: "伏神", v: `${item.fu_shen.liu_qin}${item.fu_shen.najia}（${item.fu_shen.wuxing}）` });
  if (item.bian) facts.push({ k: "变爻", v: `${item.bian.liu_qin}${item.bian.najia}（${item.bian.wuxing}）` });
  const rels = [...(item.to_month || []).map(r => "月建" + r), ...(item.to_day || []).map(r => "日辰" + r)];
  const classic = `${LY_POS_NAME[item.pos] || item.pos}爻 ${item.najia}（${item.wuxing}），六亲为${item.liu_qin}，临${item.liu_shen}。`
    + (item.moving ? `此爻发动（${item.old_young}），动则有变。` : "此爻安静。")
    + (item.fu_shen ? `本爻之下伏${item.fu_shen.liu_qin}${item.fu_shen.najia}。` : "");
  return {
    gan: item.gan, zhi: item.zhi,
    ganColor: liuyaoPaperColor(item.wuxing), zhiColor: liuyaoPaperColor(item.wuxing),
    label: `${LY_POS_NAME[item.pos] || item.pos}爻 · ${item.liu_qin}`,
    godTag: item.liu_shen,
    tagsLabel: rels.length ? "与月建日辰" : null, tags: rels,
    facts, classic,
  };
}

/* ============================================================
   用户反馈
   ============================================================ */
function openFeedback() {
  $("#feedback-error").hidden = true;
  showModalMask($("#feedback-modal"), $("#feedback-message"));
  setTimeout(() => $("#feedback-message").focus(), 30);
}

function closeFeedback(afterClose = null) { return hideModalMask($("#feedback-modal"), afterClose); }

function setFeedbackRating(value) {
  feedbackRating = feedbackRating === value ? "" : value;
  $$("[data-feedback-rating]").forEach(b => b.classList.toggle("active", b.dataset.feedbackRating === feedbackRating));
}

async function submitFeedback(ev) {
  ev.preventDefault();
  const message = $("#feedback-message").value.trim();
  if (!message) {
    const er = $("#feedback-error");
    er.textContent = "请先填写反馈内容";
    er.hidden = false;
    $("#feedback-message").focus();
    return;
  }
  if (message.length > 4000) {
    const er = $("#feedback-error");
    er.textContent = "反馈内容最多 4000 个字";
    er.hidden = false;
    $("#feedback-message").focus();
    return;
  }
  const btn = $("#feedback-submit");
  btn.disabled = true;
  btn.textContent = "提交中…";
  $("#feedback-error").hidden = true;
  try {
    const r = await fetch("/api/feedback", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Xuanshu-Interaction": "same-origin-v1",
      },
      body: JSON.stringify({
        rating: feedbackRating,
        message,
        contact: $("#feedback-contact").value.trim(),
        page: `${state.screen}:${state.activeTab || ""}`,
        profile_id: activeProfileId,
        chart_id: activeChartId,
        session_id: sessionIdForTab(state.activeTab),
        input: lastInput,
      }),
    });
    if (!r.ok) throw new Error(await r.text());
    $("#feedback-message").value = "";
    $("#feedback-contact").value = "";
    setFeedbackRating("");
    await closeFeedback();
    toast("反馈已提交");
  } catch (e) {
    const er = $("#feedback-error");
    er.textContent = "提交失败：" + humanError(String(e.message || e));
    er.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = "提交";
  }
}

function renderNatalChart() {
  const p = lastPayload, c = p.chart;
  const grid = $("#pillars-grid");
  grid.classList.remove("is-liuyao", "is-detailed");
  $("#wuxing-bar").hidden = false;
  $("#shensha-row").hidden = false;
  $("#basic-hint").hidden = false;
  $("#basic-hint").innerHTML = "点任意一柱查看含义 · 想看藏干/神煞切到 <b>进阶</b>";
  // 命局速览：只展示 full_payload 已给出的原局事实，不在前端判断旺衰喜忌。
  const dm = c.day_master || {};
  const monthCommand = p.month_command || {};
  const roots = Array.isArray(p.roots) ? p.roots : [];
  const rootBranches = Array.from(new Set(roots.map(item => item.branch).filter(Boolean)));
  const factItems = [
    { label: "日主", value: [dm.stem, dm.yin_yang && dm.element ? `${dm.yin_yang}${dm.element}` : dm.element].filter(Boolean).join(" · ") || "—" },
    { label: "月令", value: [monthCommand.branch ? `${monthCommand.branch}月` : "", monthCommand.main_qi ? `${monthCommand.main_qi}本气` : ""].filter(Boolean).join(" · ") || "—" },
    { label: "根气", value: rootBranches.length ? `${rootBranches.join("、")} · ${roots.length}处` : "原局未见" },
    { label: "生肖", value: c.shengxiao || "—" },
    { label: "胎元", value: p.tai_yuan || "—" },
    { label: "旬空", value: p.xun_kong || "—" },
  ];
  const natalFacts = $("#natal-facts");
  natalFacts.hidden = false;
  natalFacts.innerHTML =
    `<div class="natal-facts-head"><span>命局速览</span><em>原局事实</em></div>` +
    `<div class="natal-facts-grid">${factItems.map(item =>
      `<div class="natal-fact"><span>${esc(item.label)}</span><b>${esc(item.value)}</b></div>`).join("")}</div>`;

  // 五行盈缺：五项始终完整展示，并区分四柱表层与计入藏干后的数量。
  const wx = p.wuxing_count || {};
  const wxWithHidden = p.wuxing_count_with_hidden || wx;
  const wxTotal = WUXING_ORDER.reduce((sum, el) => sum + (wx[el] ?? 0), 0);
  const wxHiddenTotal = WUXING_ORDER.reduce((sum, el) => sum + (wxWithHidden[el] ?? 0), 0);
  const wxMax = Math.max(1, ...WUXING_ORDER.map(el => wxWithHidden[el] ?? 0));
  const wxLabel = WUXING_ORDER.map(el => `${el}表层${wx[el] ?? 0}、含藏干${wxWithHidden[el] ?? 0}`).join("；");
  const wuxingBar = $("#wuxing-bar");
  wuxingBar.setAttribute("aria-label", `五行盈缺：${wxLabel}`);
  const wxItems = WUXING_ORDER.map(el => {
    const surface = wx[el] ?? 0;
    const withHidden = wxWithHidden[el] ?? surface;
    const surfaceWidth = Math.round((surface / wxMax) * 100);
    const hiddenWidth = Math.round((withHidden / wxMax) * 100);
    const stateLabel = surface ? "表层有" : withHidden ? "藏干见" : "未见";
    return `<div class="wuxing-item${withHidden ? "" : " empty"}" style="--wx-color:${EL_PAPER[el]}">
      <span class="wx-name"><i aria-hidden="true"></i>${el}</span>
      <span class="wx-track" aria-hidden="true"><i class="wx-hidden-fill" style="width:${hiddenWidth}%"></i><i class="wx-surface-fill" style="width:${surfaceWidth}%"></i></span>
      <span class="wx-count"><b>${surface}</b><i>/</i><em>${withHidden}</em></span>
      <span class="wx-state">${stateLabel}</span>
    </div>`;
  }).join("");
  wuxingBar.innerHTML =
    `<div class="wuxing-head"><span>五行盈缺</span><em>表层 ${wxTotal} · 含藏干 ${wxHiddenTotal}</em></div>` +
    `<div class="wx-complete-list">${wxItems}</div>` +
    `<div class="wx-note">左为表层，右为含藏干；数量仅示分布，不等于旺衰强弱</div>`;
  // 四柱
  const keys = ["year", "month", "day", "hour"];
  grid.innerHTML = "";
  keys.forEach(k => {
    const pil = c.pillars[k], det = p.pillars_detail?.[k] || {};
    const gan = pil[0], zhi = pil[1];
    const isDM = k === "day";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pillar" + (isDM ? " dm" : "");
    const hidden = (det.hidden || []).map(h =>
      `<div class="hrow"><span class="hs" style="color:${EL_PAPER[h.element] || "#5C564A"}">${h.stem}</span><span class="hg">${h.ten_god || ""}</span></div>`).join("");
    btn.innerHTML =
      `<div class="p-role">${PILLAR_ROLE[k].name}</div>
       <div class="p-gangod">${isDM ? "日元" : (det.stem_ten_god || "")}</div>
       <div class="p-gan" style="color:${EL_PAPER[det.stem_element] || "#5C564A"}">${gan}</div>
       <div class="p-zhi" style="color:${EL_PAPER[det.branch_element] || "#5C564A"}">${zhi}</div>
       <div class="p-elpair">${det.stem_element || "—"}·${det.branch_element || "—"}</div>
       <div class="p-adv">
         <div class="p-hidden">${hidden}</div>
         <div class="p-dnayin">${det.di_shi || ""} · ${det.na_yin || ""}</div>
       </div>`;
    btn.onclick = () => openPop(pillarPop(k, c.pillars[k], det, isDM));
    grid.appendChild(btn);
  });
  // 神煞（full_payload.shensha 是 {神煞名:[柱位...]} 字典；旬空单列）
  const ssObj = p.shensha || {};
  const chips = Object.entries(ssObj).map(([name, pos]) =>
    `<span class="shensha-chip">${esc(name)}·${esc((pos || []).join("/"))}</span>`);
  if (p.xun_kong) chips.push(`<span class="shensha-chip">旬空·${esc(p.xun_kong)}</span>`);
  $("#shensha-row").innerHTML = chips.join("") || `<span class="shensha-chip">无特殊神煞</span>`;
}

function dayunStep(gz) {
  return (lastPayload.da_yun?.list || []).find(s => s.ganzhi === gz) || null;
}

function dayunYearItems(step, p) {
  const currentYear = Number(p.liu_nian?.year || new Date().getFullYear());
  const years = Array.isArray(step?.display_years) ? step.display_years : [];
  return years.map(item => ({
    ...item,
    god: item.stem_ten_god || "",
    score: Number(item.display_trend_score ?? 60),
    current: item.current === true || Number(item.year) === currentYear,
  }));
}

function renderDayunTimeline(selectedGz = "", selectedYear = "") {
  const p = lastPayload;
  const timeline = $("#dayun-timeline");
  const steps = p.da_yun?.list || [];
  if (!steps.length) {
    timeline.innerHTML = "";
    timeline.hidden = true;
    return;
  }
  const currentGz = p.da_yun.current || "";
  const defaultGz = currentGz || p.da_yun.next || steps[0].ganzhi;
  const selectedStep = steps.find(step => step.ganzhi === selectedGz)
    || steps.find(step => step.ganzhi === timeline.dataset.selectedDayun)
    || steps.find(step => step.ganzhi === defaultGz)
    || steps[0];
  timeline.dataset.selectedDayun = selectedStep.ganzhi;
  const dir = p.da_yun.forward ? "顺排" : "逆排";
  const cards = steps.map(step => {
    const selected = step.ganzhi === selectedStep.ganzhi;
    const current = step.ganzhi === currentGz;
    const god = step.stem_ten_god || "";
    const ageRange = step.age_range || `${step.start_age ?? "?"}–${step.end_age ?? "?"}`;
    const yearRange = step.year_range || (step.start_year ? `${step.start_year}–${step.end_year ?? step.start_year + 9}` : "年份待定");
    return `<button type="button" class="dayun-step dayun-step-full${selected ? " selected" : ""}${current ? " current" : ""}" data-dayun="${esc(step.ganzhi)}"${selected ? ' data-dayun-selected="true"' : ""}${current ? ' data-dayun-current="true" aria-current="step"' : ""} aria-pressed="${selected ? "true" : "false"}" aria-label="${esc(`${step.ganzhi}大运，${god}，${ageRange}岁，${yearRange}${current ? "，当前大运" : ""}`)}">
      <span class="ds-age">${esc(ageRange)}岁</span>
      <span class="ds-gz" style="color:${EL_PAPER[step.stem_element] || "#5C564A"}">${esc(step.ganzhi)}</span>
      <span class="ds-god">${esc(god || "—")}</span>
      <span class="ds-years">${esc(yearRange)}</span>
      ${current ? '<span class="ds-current" aria-hidden="true"></span>' : ""}
    </button>`;
  }).join("");
  const years = dayunYearItems(selectedStep, p);
  const requestedYear = Number(selectedYear || timeline.dataset.selectedLiunian);
  const selectedYearItem = years.find(item => item.year === requestedYear)
    || years.find(item => item.current)
    || years[0]
    || null;
  const selectedYears = selectedStep.year_range
    || `${selectedStep.start_year ?? "?"}–${selectedStep.end_year ?? "?"}`;
  let yearSection = `<div class="liunian-timeline-head"><span>${esc(selectedStep.ganzhi)}运内流年</span><em>${esc(selectedYears)}</em></div>
    <div class="basic-hint">逐年事实暂时不可用，请刷新后重试。</div>`;
  if (selectedYearItem) {
    timeline.dataset.selectedLiunian = String(selectedYearItem.year);
    const yearCards = years.map(item => {
      const selected = item.year === selectedYearItem.year;
      return `<button type="button" class="liunian-year-card${selected ? " selected" : ""}${item.current ? " current" : ""}" data-liunian-year="${item.year}"${selected ? ' data-liunian-selected="true"' : ""}${item.current ? ' aria-current="date"' : ""} aria-pressed="${selected ? "true" : "false"}" aria-label="${esc(`${item.year}年${item.pillar}流年，${item.god}${item.current ? "，今年" : ""}`)}">
        <span class="ly-year">${item.year}</span>
        <span class="ly-gz" style="color:${EL_PAPER[item.stem_element] || "#5C564A"}">${esc(item.pillar)}</span>
        <span class="ly-god">${esc(item.god || "—")}</span>
        ${item.current ? '<span class="ly-current">今年</span>' : ""}
      </button>`;
    }).join("");
    const selectedYearIndex = years.findIndex(item => item.year === selectedYearItem.year) + 1;
    const currentMonth = selectedYearItem.current ? p.current_liu_yue : null;
    const yearContext = currentMonth
      ? `今年 · 当前流月 ${currentMonth.pillar} ${currentMonth.stem_ten_god || ""} · ${currentMonth.month_name || ""} · ${currentMonth.solar_term_range || ""}`
      : `${selectedStep.ganzhi}大运第 ${selectedYearIndex} 年`;
    yearSection = `<div class="liunian-timeline-head"><span>${esc(selectedStep.ganzhi)}运内流年</span><em>${esc(selectedYears)} · ${years.length} 年</em></div>
      <div class="liunian-strip sc-scroll" aria-label="第二层：${esc(selectedStep.ganzhi)}大运下的逐年流年">${yearCards}</div>
      <div class="liunian-inline-detail" role="status" aria-live="polite">
        <span class="lid-label">所选流年</span>
        <b><i>${selectedYearItem.year}</i><strong style="color:${EL_PAPER[selectedYearItem.stem_element] || "#5C564A"}">${esc(selectedYearItem.pillar)}</strong></b>
        <em>${esc(selectedYearItem.god || "—")} · ${esc(yearContext)}</em>
      </div>`;
  } else {
    delete timeline.dataset.selectedLiunian;
  }
  timeline.hidden = false;
  timeline.innerHTML =
    `<div class="dayun-timeline-head"><span>十年大运</span><em>${steps.length} 步 · ${dir} · ${p.da_yun.start_age ?? "?"} 岁起运</em></div>` +
    `<div class="dayun-strip dayun-strip-main sc-scroll" aria-label="第一层：十年大运">${cards}</div>` +
    yearSection;
  timeline.querySelectorAll("[data-dayun]").forEach(btn => {
    btn.onclick = () => {
      renderDayunTimeline(btn.dataset.dayun);
    };
  });
  timeline.querySelectorAll("[data-liunian-year]").forEach(btn => {
    btn.onclick = () => {
      renderDayunTimeline(selectedStep.ganzhi, btn.dataset.liunianYear);
    };
  });
  renderAdvancedStage();
  requestAnimationFrame(() => {
    centerActiveDayunTimeline();
    centerSelectedLiunianTimeline();
  });
}

function renderStage() {
  const p = lastPayload;
  const rows = $("#stage-rows");
  const timeline = $("#dayun-timeline");
  rows.classList.remove("stage-rows-horizontal");
  rows.style.removeProperty("--stage-count");
  rows.hidden = false;
  timeline.innerHTML = "";
  timeline.hidden = true;
  const paintRows = data => {
    rows.classList.add("stage-rows-horizontal");
    rows.style.setProperty("--stage-count", String(data.length));
    rows.innerHTML = "";
    data.forEach(d => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "stage-row" + (d.cur ? " cur" : "");
      b.innerHTML =
        `<span class="sr-top"><span class="sr-kicker">${esc(d.kicker)}</span><span class="sr-badge ${d.cur ? "cur" : "idle"}">${esc(d.badge)}</span></span>
         <span class="sr-gz" style="color:${EL_PAPER[d.stemElement] || "#5C564A"}">${esc(d.gz)}</span>
         <span class="sr-god">${esc(d.god)}</span>
         <span class="sr-range">${esc(d.range || "—")}</span>`;
      b.onclick = d.onClick;
      rows.appendChild(b);
    });
  };
  if (!p.da_yun) {
    if (isManualBaziPayload(p) && p.liu_nian?.pillar) {
      const cly = p.current_liu_yue;
      const lnGod = p.liu_nian.stem_ten_god || "";
      const data = [
        { kicker: "今年流年", gz: p.liu_nian.pillar, god: `${lnGod} · ${p.liu_nian.year} 年`,
          stemElement: p.liu_nian.stem_element, range: String(p.liu_nian.year), badge: "今年", cur: true, onClick: () => openPop(liunianPop()) },
      ];
      if (cly) data.push({ kicker: "当前流月", gz: cly.pillar, god: `${cly.stem_ten_god} · ${cly.month_name}`,
        stemElement: cly.stem_element, range: cly.solar_term_range || "", badge: "本月", cur: false, onClick: () => openPop(liuyuePop(cly)) });
      paintRows(data);
      $("#advanced-stage").innerHTML = `<div class="basic-hint" style="color:var(--ink-2)">请先填写性别，再按出生时间定大运 / 人生走势。<br>点右上「修改信息」补全。</div>`;
      return;
    }
    rows.innerHTML = `<div class="basic-hint" style="color:var(--ink-2)">请先填写性别，再定大运 / 流年 / 流月。<br>点右上「修改信息」补全。</div>`;
    $("#advanced-stage").innerHTML = "";
    return;
  }
  const curGz = p.da_yun.current || p.da_yun.next || p.da_yun.list?.[0]?.ganzhi;
  if (!curGz) {
    rows.innerHTML = `<div class="basic-hint" style="color:var(--ink-2)">暂时无法定位大运时间轴，请检查出生信息。</div>`;
    $("#advanced-stage").innerHTML = "";
    return;
  }
  rows.innerHTML = "";
  rows.hidden = true;
  renderDayunTimeline(curGz);
}

function renderAdvancedStage() {
  const p = lastPayload;
  const wrap = $("#advanced-stage");
  if (!p.da_yun) { wrap.innerHTML = ""; return; }
  const step = dayunStep($("#dayun-timeline")?.dataset.selectedDayun
    || p.da_yun.current || p.da_yun.next || p.da_yun.list?.[0]?.ganzhi);
  const cly = p.current_liu_yue;
  const rels = cly
    ? Array.from(new Set([...(cly.relations?.to_natal || []), ...(cly.relations?.to_da_yun || []), ...(cly.relations?.to_liu_nian || [])]))
    : [];
  const relChips = rels.length ? rels.map(r => `<span class="rel-chip">${esc(r)}</span>`).join("") : `<span class="rel-chip">本月无明显引动</span>`;

  const months = (p.liu_yue || []).map((m, i) =>
    `<button type="button" class="month-cell${m.is_current ? " cur" : ""}" data-month="${i}">
      <div class="mc-label">${esc(m.month_name)}</div>
      <div class="mc-gz" style="color:${m.is_current ? "var(--gold)" : "#5C564A"}">${m.pillar}</div>
      <div class="mc-god">${m.stem_ten_god}</div></button>`).join("");

  wrap.innerHTML =
    DayunMechanics.markup(step) +
    `<div class="adv-label">当前流月引动 <span>${esc(cly?.pillar || "")}${cly ? " ↔ 本命 / 大运 / 流年" : ""}</span></div>
     <div class="rel-chips">${relChips}</div>
     <div class="adv-label mt">${p.liu_nian?.year || ""} 十二流月 <span>点一个去问</span></div>
     <div class="month-grid">${months}</div>`;

  wrap.querySelectorAll("[data-month]").forEach(btn => {
    btn.onclick = () => openPop(liuyuePop(lastPayload.liu_yue[+btn.dataset.month]));
  });
}

/* ============================================================
   话题 Tab + 对话线
   ============================================================ */
function renderTabs() {
  const row = $("#tab-row");
  const liuyao = state.system === "liuyao";
  const detailed = detailedWorkspaceActive();
  const hasBaziConversation = !liuyao && (state.threads.解读 || []).length > 0;
  const kindButtons = hasBaziConversation ? `<div class="question-kinds" aria-label="切换问题种类">
    <span>换个方向</span>
    ${BAZI_STARTER_QUESTIONS.map(item => `<button type="button" data-fill-kind="${esc(item.question)}">${esc(item.label)}</button>`).join("")}
  </div>` : "";
  if (liuyao && !detailed) {
    const p = lastPayload || {};
    const ben = p.ben_gua?.name || "本卦";
    const bian = (p.dong_yao || []).length ? ` → ${p.bian_gua?.name || "变卦"}` : "";
    row.innerHTML = `<div class="liuyao-conversation-context" aria-label="本次所问与卦象">
      <span>所问</span>
      <b>${esc(liuyaoQuestionText())}</b>
      <em>${esc(ben + bian)}</em>
    </div>`;
  } else {
    row.innerHTML = `<div class="conversation-title">
      <b>${detailed ? "一事详断" : "命理解读"}</b>
      <span>${detailed ? "八字定人和阶段，卦象定此事；围绕同一件事继续追问" : "同一命盘，直接问你关心的事"}</span>
    </div>${kindButtons}`;
  }
  row.querySelectorAll("[data-fill-kind]").forEach(button => {
    button.onclick = () => fillComposerQuestion(button.dataset.fillKind);
  });
  const gloss = $("#gloss-tab-btn");
  if (gloss) {
    gloss.hidden = false;
    if (detailed) {
      gloss.textContent = "八字 × 卦象同参";
      gloss.title = "本页使用本人命盘与本次卦象复合判断";
      gloss.classList.add("question-chip");
      gloss.setAttribute("aria-disabled", "true");
      gloss.onclick = null;
    } else if (state.system === "liuyao") {
      gloss.hidden = true;
      gloss.classList.remove("question-chip");
      gloss.removeAttribute("aria-disabled");
      gloss.onclick = null;
    } else {
      gloss.textContent = "名词解释";
      gloss.title = "名词解释";
      gloss.classList.remove("question-chip");
      gloss.removeAttribute("aria-disabled");
      gloss.onclick = openGloss;
    }
  }
  const newCast = $("#new-cast-btn");
  if (newCast) {
    const liuyao = state.system === "liuyao";
    newCast.hidden = !liuyao;
    newCast.disabled = state.streaming;
    newCast.textContent = detailed ? "另起一事" : "开新卦";
    newCast.onclick = detailed
      ? () => PersonalHome?.openDetailed()
      : liuyao
        ? () => openCastModal({ clearQuestion: true, fresh: true })
        : null;
  }
}

/* ============================================================
   名词解释浮层（命理 + 卜筮 静态词条，绝不调 LLM）
   ============================================================ */
function glossSection(label, items) {
  return `<div class="gloss-section-label">${esc(label)}</div>` + items.map(g =>
    `<div class="gloss-item"><div class="gloss-head"><span class="gloss-term">${esc(g.term)}</span><span class="gloss-tag">${esc(g.tag)}</span></div><div class="gloss-def">${esc(g.def)}</div></div>`).join("");
}
function openGloss() {
  const card = $("#gloss-card");
  if (!card) return;
  card.innerHTML =
    `<div class="gloss-card-head">
      <div>
        <div class="gloss-card-src">典出《子平真诠》《渊海子平》《增删卜易》</div>
        <h2>名词解释</h2>
      </div>
      <button type="button" class="modal-close" data-gloss-close aria-label="关闭">×</button>
    </div>
    <div class="gloss-card-body sc-scroll">
      ${glossSection("命 理", GLOSSARY)}
      ${glossSection("卜 筮", GLOSSARY_BU)}
    </div>`;
  card.querySelector("[data-gloss-close]").onclick = closeGloss;
  showModalMask($("#gloss-modal"), card.querySelector("[data-gloss-close]"));
}
function closeGloss(afterClose = null) { return hideModalMask($("#gloss-modal"), afterClose); }

function liuyaoDongText(p = lastPayload) {
  return (p.dong_yao || []).map(n => (LY_POS_NAME[n] || n) + "爻").join("、") || "无";
}

function scenarioLabel(opts) {
  if (opts.scenario === "topic") return opts.topic || "命理解读";
  return { natal: "命盘概览", liu_nian: "流年", da_yun: "大运", liu_yue: "流月", lifeline: "主线", divination: "断卦" }[opts.scenario] || opts.scenario;
}
function scenarioTitle(opts) {
  if (opts.scenario === "topic") return opts.topic || "";
  return { natal: "命盘整体结构", liu_nian: "今年重点", da_yun: "十年阶段", liu_yue: "当前月份", lifeline: "长期主线", divination: "六爻断卦" }[opts.scenario] || "";
}

/* ============================================================
   古典文化解读浮窗（静态字典，绝不调 LLM）
   ============================================================ */
function pillarPop(key, pillar, det, isDM) {
  const gan = pillar[0], zhi = pillar[1];
  const role = PILLAR_ROLE[key];
  const god = det.stem_ten_god || "";
  const classic = isDM
    ? `日柱${role.gloss}。${gan}为日元，坐${zhi}（地势${det.di_shi || "—"}），纳音${det.na_yin || "—"}。命主元神所系，全盘以此为中心，论与它干支之生克旺衰。`
    : `${role.name}${role.gloss}。天干${gan}（${god}）——${GODPHRASE[god] || ""}；坐${zhi}，地势${det.di_shi || "—"}，纳音${det.na_yin || "—"}。`;
  return {
    gan, zhi, ganColor: EL_PAPER[det.stem_element] || "#5C564A", zhiColor: EL_PAPER[det.branch_element] || "#5C564A",
    label: isDM ? "日柱 · 命主元神" : role.name, godTag: isDM ? "日元" : god,
    tagsLabel: "地支藏干", tags: (det.hidden || []).map(h => `${h.stem} ${h.ten_god || ""}`.trim()),
    facts: [{ k: "天干十神", v: isDM ? "日元" : god }, { k: "地势", v: det.di_shi || "—" }, { k: "纳音", v: det.na_yin || "—" }],
    classic,
  };
}
function dayunPop(step, gz, god, isCur) {
  const facts = [{ k: "十神", v: god }];
  if (step && step.start_age != null) facts.push({ k: "起止", v: `${step.start_age}–${step.start_age + 10}岁 · ${step.start_year}起` });
  const classic = isCur
    ? `大运乃十年气运之纲。「${gz}」${god}临身——${GODPHRASE[god] || ""}。当下正行此运，外境与心志皆受其牵动；宜顺其气、借其势，最忌与之硬抗。`
    : `「${gz}」大运，${god}主事——${GODPHRASE[god] || ""}。十年之内，以此为气运底色。`;
  return { gan: gz[0], zhi: gz[1], ganColor: EL_PAPER[step?.stem_element] || "#5C564A", zhiColor: EL_PAPER[step?.branch_element] || "#5C564A",
    label: `大运 · ${step?.start_age ?? "?"}岁起`, godTag: god, tagsLabel: null, tags: [], facts, classic };
}
function liunianPop(ln = lastPayload.liu_nian) {
  const god = ln.stem_ten_god || "";
  const tags = (ln.branch_hidden_stems || []).map(h => `${h.stem} ${h.ten_god || ""}`.trim());
  return { gan: ln.pillar[0], zhi: ln.pillar[1], ganColor: EL_PAPER[ln.stem_element] || "#5C564A", zhiColor: EL_PAPER[ln.branch_element] || "#5C564A",
    label: `流年 · ${ln.year} ${ln.pillar}`, godTag: god,
    tagsLabel: tags.length ? "流年地支藏干" : null, tags,
    facts: [{ k: "十神", v: god }, { k: "流年", v: String(ln.year) }],
    classic: `流年为一岁之主。「${ln.pillar}」${god}当值——${GODPHRASE[god] || ""}。与本命、大运相互引动，主一岁之内吉凶起伏。` };
}
function liuyuePop(m) {
  const rels = [...(m.relations?.to_natal || []), ...(m.relations?.to_da_yun || []), ...(m.relations?.to_liu_nian || [])];
  return { gan: m.pillar[0], zhi: m.pillar[1], ganColor: EL_PAPER[m.stem_element] || "#5C564A", zhiColor: EL_PAPER[m.branch_element] || "#5C564A",
    label: `流月 · ${lastPayload.liu_nian?.year || ""} ${m.month_name} ${m.pillar}`, godTag: m.stem_ten_god,
    tagsLabel: rels.length ? "引动关系" : null, tags: rels,
    facts: [{ k: "十神", v: m.stem_ten_god }, { k: "节气", v: m.solar_term_range || "按节气分月" }],
    classic: `「${m.pillar}」之月，${m.stem_ten_god}当令——${GODPHRASE[m.stem_ten_god] || ""}。流月之气，须合流年同参。` };
}

function openPop(P) {
  const card = $("#pop-card");
  const isLy = state.system === "liuyao";
  const note = isLy
    ? "以上为卦盘事实释读，不消耗对话。需结合现实处境时，回到断卦对话继续问。"
    : "以上为古籍义理参考，不消耗对话。需结合现实处境时，在右侧话题继续问。";
  const tagsBlock = P.tagsLabel && P.tags && P.tags.length
    ? `<div class="pop-tags-block"><div class="pop-tags-label">${esc(P.tagsLabel)}</div><div class="pop-tags">${P.tags.map(t => `<span class="pop-tag">${esc(t)}</span>`).join("")}</div></div>` : "";
  card.innerHTML =
    `<div class="pop-head"><div class="wm">${isLy ? "卦" : "命"}</div>
      <div class="pop-head-row">
        <div class="pop-gz">
          <div class="big"><span style="color:${P.ganColor}">${esc(P.gan)}</span><span style="color:${P.zhiColor}">${esc(P.zhi)}</span></div>
          <div><div class="pop-label">${esc(P.label)}</div><div class="pop-godtag">${esc(P.godTag)}</div></div>
        </div>
        <button type="button" class="modal-close" data-pop-close aria-label="关闭">×</button>
      </div></div>
     <div class="pop-body sc-scroll">
       ${tagsBlock}
       <div class="pop-facts">${P.facts.map(f => `<div class="pop-fact"><div class="k">${esc(f.k)}</div><div class="v">${esc(f.v)}</div></div>`).join("")}</div>
       <div class="pop-classic-head"><span class="t">古典解读</span><span class="ln"></span></div>
       <div class="pop-classic">${esc(P.classic)}</div>
       <div class="pop-note"><span>${esc(note)}</span></div>
     </div>
     <div class="pop-foot">
       <button type="button" class="terms" data-pop-terms>${isLy ? "回到断卦" : "名词解释"}</button>
       <button type="button" class="ok" data-pop-close>知道了</button>
     </div>`;
  card.querySelectorAll("[data-pop-close]").forEach(b => b.onclick = closePop);
  card.querySelector("[data-pop-terms]").onclick = () => {
    closePop(() => {
      if (isLy) switchTab("断卦");
      else openGloss();
    });
  };
  showModalMask($("#pop-modal"), card.querySelector("[data-pop-close]"));
}
function closePop(afterClose = null) { return hideModalMask($("#pop-modal"), afterClose); }

/* ============================================================
   人生能量走势浮窗（启发式，示意）
   ============================================================ */
function pillarForYear(year) {
  const y = Number(year);
  if (!Number.isFinite(y)) return "";
  const gan = GAN_CHARS[((y - 4) % 10 + 10) % 10];
  const zhi = ZHI_CHARS[((y - 4) % 12 + 12) % 12];
  return gan + zhi;
}

function trendLineSvg(items, { labelKey = "gz", scoreKey = "score", id = "trendg", height = 118 } = {}) {
  const W = 820, H = height, padL = 24, padR = 24, padT = 18, padB = 24;
  const iw = W - padL - padR;
  const ih = H - padT - padB;
  const baseY = padT + ih;
  const n = Math.max(1, items.length);
  const pts = items.map((item, i) => {
    const score = Number(item[scoreKey] ?? 60);
    const x = +(padL + (n > 1 ? i * (iw / (n - 1)) : iw / 2)).toFixed(1);
    const y = +(padT + (1 - Math.max(20, Math.min(95, score)) / 100) * ih).toFixed(1);
    return { ...item, x, y, score };
  });
  const line = "M " + pts.map(item => `${item.x} ${item.y}`).join(" L ");
  const area = `M ${pts[0].x} ${baseY} L ` + pts.map(item => `${item.x} ${item.y}`).join(" L ") + ` L ${pts[pts.length - 1].x} ${baseY} Z`;
  return `<svg viewBox="0 0 ${W} ${H}" class="trend-line-svg" aria-hidden="true">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#D4AF5D" stop-opacity="0.28"></stop><stop offset="1" stop-color="#D4AF5D" stop-opacity="0"></stop></linearGradient></defs>
    <path d="${area}" fill="url(#${id})"></path>
    <path d="${line}" fill="none" stroke="#A8823F" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"></path>
    ${pts.map(item => `<circle cx="${item.x}" cy="${item.y}" r="${item.cur ? 5.8 : 3.4}" fill="${item.cur ? "#EFD597" : "#101017"}" stroke="${item.cur ? "#F6E7BD" : "#A8823F"}" stroke-width="1.7"></circle>`).join("")}
    ${pts.map(item => `<text x="${item.x}" y="${H - 7}" text-anchor="middle" font-size="10" fill="${item.cur ? "#F6E7BD" : "#6C665A"}" font-family="Space Mono, monospace">${esc(String(item[labelKey] || ""))}</text>`).join("")}
  </svg>`;
}

function openTrend() {
  const p = lastPayload;
  if (!p.da_yun || !(p.da_yun.list || []).length) {
    toast(isManualBaziPayload(p) ? "需要填写性别，才能按匹配时间定大运" : "需要先定大运（请填写性别）", "warn");
    return;
  }
  const steps = p.da_yun.list;
  const currentStep = steps.find(s => s.ganzhi === p.da_yun.current) || steps[0];
  const dayunItems = steps.map(s => {
    const god = s.stem_ten_god || "";
    return { ...s, god, score: Number(s.display_trend_score ?? 60), cur: s.ganzhi === currentStep.ganzhi };
  });
  const years = dayunYearItems(currentStep, p).map(item => ({
    ...item,
    yr: String(item.year),
    cur: item.current,
  }));
  const dayunDir = p.da_yun.forward ? "顺行" : "逆行";
  const startAge = p.da_yun.start_age ?? currentStep.start_age ?? "?";
  const yearTrend = years.length
    ? `<div class="trend-chart year-chart">${trendLineSvg(years, { labelKey: "yr", id: "trendg-year", height: 96 })}</div>
      <div class="trend-card-grid year-grid">
        ${years.map(item => `<button type="button" class="trend-year-card${item.cur ? " cur" : ""}" data-trend-year="${item.year}">
          <b>${esc(item.pillar)}</b><span>${esc(item.god || "—")}</span><em>${item.year}</em>
        </button>`).join("")}
      </div>`
    : `<div class="basic-hint">逐年趋势暂时不可用，请刷新后重试。</div>`;

  $("#trend-card").innerHTML =
    `<div class="trend-head"><div class="wm">运</div>
      <div class="trend-head-row">
        <div><div class="sub">${dayunDir} · ${startAge} 岁起运</div><div class="ttl">行 运 走 势</div></div>
        <button type="button" class="modal-close" data-trend-close aria-label="关闭">×</button>
      </div></div>
     <div class="trend-body sc-scroll">
      <div class="trend-section-title"><span>大运旺衰</span><em>示意指数 · 越高越顺</em></div>
      <div class="trend-chart">${trendLineSvg(dayunItems, { id: "trendg-dayun" })}</div>
      <div class="trend-card-grid dayun-grid">
        ${dayunItems.map(item => `<button type="button" class="trend-step-card${item.cur ? " cur" : ""}" data-trend-dayun="${esc(item.ganzhi)}">
          <b>${esc(item.ganzhi)}</b><span>${esc(item.god || "—")}</span><em>${esc(item.age_range || (String(item.start_age ?? "?") + "岁"))}</em><small>${esc(item.year_range || "")}</small>
        </button>`).join("")}
      </div>
      <div class="trend-section-title subline"><span>${esc(currentStep.ganzhi || "")} 运内流年</span><em>${esc(currentStep.year_range || "")}</em></div>
      ${yearTrend}
     </div>
     <div class="trend-foot">
      <div class="disc"><b>〔按〕</b>曲线只把十神倾向压成一个相对节律，非吉凶定论；真正判断仍以本命、大运、流年和现实问题合参。</div>
      <button type="button" class="close" data-trend-close>关闭</button>
     </div>`;
  $("#trend-card").querySelectorAll("[data-trend-close]").forEach(b => b.onclick = closeTrend);
  $("#trend-card").querySelectorAll("[data-trend-dayun]").forEach(btn => {
    btn.onclick = () => {
      const gz = btn.dataset.trendDayun;
      const s = dayunStep(gz);
      openPop(dayunPop(s, gz, s?.stem_ten_god || "", gz === currentStep.ganzhi));
    };
  });
  $("#trend-card").querySelectorAll("[data-trend-year]").forEach(btn => {
    btn.onclick = () => {
      const item = years.find(row => String(row.year) === btn.dataset.trendYear);
      if (!item) return;
      openPop(liunianPop({ ...item, stem_ten_god: item.god, branch_hidden_stems: [] }));
    };
  });
  showModalMask($("#trend-modal"), $("#trend-card").querySelector("[data-trend-close]"));
}
function closeTrend(afterClose = null) { return hideModalMask($("#trend-modal"), afterClose); }

function nativeSharePayload(title, url) {
  const shareTitle = String(title || "玄枢六爻卦帖").trim() || "玄枢六爻卦帖";
  return {
    title: shareTitle,
    text: `${shareTitle}\n${url}`,
  };
}

async function sharePublicPost(slug) {
  if (!slug) return;
  const target = await Account?.shareTarget(slug) || {
    url: `${location.origin}/?post=${encodeURIComponent(slug)}&ref=workbench_share#gua-square`,
    attributed: false,
  };
  const url = target.url;
  const shareData = nativeSharePayload(liuyaoQuestionText(), url);
  try {
    if (window.XuanxueShareCard?.open) {
      await window.XuanxueShareCard.open({
        slug,
        title: shareData.title,
        ref: "workbench_share",
        shareUrl: url,
        attributed: target.attributed,
      });
      return;
    }
    if (navigator.share) {
      await navigator.share(shareData);
      fetch("/api/community/share-events", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, channel: "native", ref: "workbench_share" }), keepalive: true,
      }).catch(() => {});
      return;
    }
    await navigator.clipboard.writeText(shareData.text);
    fetch("/api/community/share-events", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, channel: "copy", ref: "workbench_share" }), keepalive: true,
    }).catch(() => {});
    toast(target.attributed ? "邀请链接已复制，新用户激活后每日额度永久 +1" : "标题和链接已复制");
  } catch (error) {
    if (error?.name !== "AbortError") toast("分享失败，请打开卦帖后复制标题和链接", "warn");
  }
}

/* ---------- toast ---------- */
let toastTimer = null;
function toast(msg, kind) {
  const t = $("#toast");
  t.textContent = msg; t.className = "toast" + (kind ? " " + kind : ""); t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

/* ============================================================
   事件绑定
   ============================================================ */
function bind() {
  appHadAuthenticatedAccount = !!Account?.snapshot()?.authenticated;
  document.addEventListener("xuanshu:authchange", handleAccountAuthChange);
  document.addEventListener("xuanshu:openarchives", event => {
    event.preventDefault();
    openProfileLibrary({ includeCurrent: !!lastPayload });
  });
  document.addEventListener("xuanshu:opencommunity", event => {
    event.preventDefault();
    openHomeCommunity();
  });
  document.addEventListener("xuanshu:opencredits", event => {
    event.preventDefault();
    showScreen("credits", { historyMode: "push", focusPage: true });
  });
  document.addEventListener("xuanshu:startbazi", event => {
    event.preventDefault();
    openBirthModal();
  });
  document.addEventListener("xuanshu:startliuyao", event => {
    event.preventDefault();
    openCastModal({ clearQuestion: true, fresh: true });
  });
  document.addEventListener("xuanshu:showpersonalhome", event => {
    event.preventDefault();
    showScreen("landing", {
      historyMode: event.detail?.historyMode === "replace" ? "replace" : "push",
      focusPage: true,
      focusTarget: "#personal-workbench",
    });
    PersonalHome?.syncScreen("landing");
  });
  document.addEventListener("xuanshu:startdetailed", event => {
    event.preventDefault();
    if (!DETAILED_PUBLIC_ENTRY_ENABLED) return;
    openCastModal({
      clearQuestion: true,
      fresh: true,
      combined: true,
      historyMode: event.detail?.historyMode === "replace" ? "replace" : "push",
    });
  });
  $$("[data-home-community-nav]").forEach(link => {
    link.addEventListener("click", event => {
      event.preventDefault();
      openHomeCommunity();
    });
  });
  window.addEventListener("popstate", event => {
    if (window.XuanOverlayHistory?.handledPopState(event)) return;
    restoreHomeRouteFromLocation();
  });
  window.addEventListener("hashchange", restoreHomeRouteFromLocation);
  $$("[data-hero-nav]").forEach(b => {
    b.onclick = async () => {
      const target = b.dataset.heroNav || "landing";
      if (target === "bazi") {
        await openSystemWorkspace("bazi");
        return;
      }
      if (target === "liuyao") {
        await openSystemWorkspace("liuyao");
        return;
      }
      if (target === "detailed") {
        await openDetailedWorkspace();
        return;
      }
      if (target === "profile") {
        Account.requireLogin({ mode: "login", message: "登录后可跨设备查看私密问题与档案。" })
          .then(ok => { if (ok) openProfileLibrary({ includeCurrent: !!lastPayload }); });
        return;
      }
      if (target === "credits") {
        Account.requireLogin({ mode: "login", message: "登录后管理积分。" })
          .then(ok => { if (ok) showScreen("credits", { historyMode: "push", focusPage: true }); });
        return;
      }
      showScreen("landing", { historyMode: "push", focusPage: true });
    };
  });
  $("#birth-form").addEventListener("submit", submitBirth);
  $("#birth-form").addEventListener("input", clearBirthError);
  $("#f-input-mode").addEventListener("change", syncBirthInputMode);
  const birthModeButtons = $$("[data-input-mode-btn]");
  birthModeButtons.forEach(btn => {
    btn.onclick = () => setBirthInputMode(btn.dataset.inputModeBtn || "birth_time");
  });
  bindHorizontalTabKeys(birthModeButtons, btn => setBirthInputMode(btn.dataset.inputModeBtn || "birth_time"));
  $$("[data-pillar-input]").forEach(input => {
    input.addEventListener("pointerdown", e => {
      if (!usePillarPickerOnly()) return;
      e.preventDefault();
      openPillarPicker(input.dataset.pillarInput);
    });
    input.addEventListener("focus", () => {
      if (suppressPillarFocus) return;
      const key = input.dataset.pillarInput;
      requestAnimationFrame(() => {
        if (!suppressPillarFocus && document.activeElement === input && birthInputMode() === "manual_pillars") openPillarPicker(key);
      });
    });
    input.addEventListener("click", e => {
      if (usePillarPickerOnly()) e.preventDefault();
      openPillarPicker(input.dataset.pillarInput);
    });
    input.addEventListener("input", () => {
      if (input.dataset.pillarInput === "year") renderJiaziCandidates();
      if (activePillarKey === input.dataset.pillarInput) {
        const stem = input.value.trim()[0] || "";
        activePillarStem = stem && GAN_CHARS.includes(stem) ? stem : "";
        renderPillarPicker();
      }
    });
  });
  $("#f-calendar").addEventListener("change", syncLeapVisibility);
  initLocationPicker();
  syncBirthInputMode();

  // 六爻起卦
  if ($("#cast-close-x")) $("#cast-close-x").onclick = closeCastModal;
  if ($("#cast-form")) $("#cast-form").addEventListener("submit", submitCast);
  initCastModal();
  setupCommunityHelpDialog();

  $("#home-btn").onclick = () => {
    showScreen("landing", { historyMode: "push", focusPage: true });
  };
  $("#session-bazi-btn").onclick = async () => {
    await openSystemWorkspace("bazi");
  };
  $("#session-liuyao-btn").onclick = async () => {
    await openSystemWorkspace("liuyao");
  };
  $("#rechart-btn").onclick = () => { state.system === "liuyao" ? openCastModal() : openBirthModal(); };
  $("#top-chart-btn").onclick = openChartDrawer;
  $$("[data-mode-btn]").forEach(b => { b.onclick = () => setMode(b.dataset.modeBtn || "basic"); });
  $("#profile-fab").onclick = () => Account.requireLogin({ mode: "login", message: "登录后查看私人档案。" }).then(ok => { if (ok) openProfileLibrary({ includeCurrent: !!lastPayload }); });
  $("#top-profile-btn").onclick = () => Account.requireLogin({ mode: "login", message: "登录后查看私人档案。" }).then(ok => { if (ok) openProfileLibrary({ includeCurrent: !!lastPayload }); });
  if ($("#hero-feedback-btn")) $("#hero-feedback-btn").onclick = openFeedback;
  $$("[data-feedback-nav]").forEach(button => { button.onclick = openFeedback; });
  if ($("#hero-profile-btn")) $("#hero-profile-btn").onclick = () => Account.requireLogin({ mode: "login", message: "登录后可查看私密问题与档案。" }).then(ok => { if (ok) openProfileLibrary({ includeCurrent: !!lastPayload }); });
  $("#ask-chart-btn").onclick = () => { switchTab("解读"); fillComposerQuestion(DEFAULT_Q.topic.本命); };
  $("#ask-community-btn").onclick = openCommunityHelpDialog;
  $("#open-trend-btn").onclick = openTrend;

  // 手机版：盘条「看盘」抽屉
  if ($("#open-chart-btn")) $("#open-chart-btn").onclick = openChartDrawer;
  if ($("#top-community-btn")) $("#top-community-btn").onclick = openCommunityHelpDialog;
  if ($("#chart-rail-close")) $("#chart-rail-close").onclick = closeChartDrawer;
  if ($("#chart-mask")) $("#chart-mask").onclick = closeChartDrawer;
  if ($("#rail-rechart-btn")) $("#rail-rechart-btn").onclick = () => { state.system === "liuyao" ? openCastModal() : openBirthModal(); };
  if ($("#rail-gloss-btn")) $("#rail-gloss-btn").onclick = () => { if (state.system !== "liuyao") openGloss(); };

  $("#send-btn").onclick = sendDraft;
  $("#new-session-btn").onclick = () => startNewSession(state.activeTab);
  $("#chat-thread").addEventListener("scroll", e => updateThreadScrollLock(e.currentTarget, state.activeTab), { passive: true });
  $("#draft-input").addEventListener("keydown", e => {
    if (e.key === "Enter") {
      if (e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      sendDraft();
    }
  });
  $("#risk-ack-input").addEventListener("change", e => {
    if (!e.target.checked) return;
    markRiskAccepted(state.activeTab);
    renderThread();
  });

  $("#pop-modal").onclick = e => { if (e.target === $("#pop-modal")) closePop(); };
  $("#trend-modal").onclick = e => { if (e.target === $("#trend-modal")) closeTrend(); };
  $("#gloss-modal").onclick = e => { if (e.target === $("#gloss-modal")) closeGloss(); };
  $("#profile-modal").onclick = e => { if (e.target === $("#profile-modal")) closeProfileModal(); };
  $("#feedback-fab").onclick = openFeedback;
  $("#feedback-close").onclick = closeFeedback;
  $("#feedback-modal").onclick = e => { if (e.target === $("#feedback-modal")) closeFeedback(); };
  $("#feedback-form").addEventListener("submit", submitFeedback);
  $$("[data-feedback-rating]").forEach(b => b.onclick = () => setFeedbackRating(b.dataset.feedbackRating || ""));
  document.addEventListener("keydown", e => {
    if (e.key === "Tab" && (trapModalFocus(e) || trapChartDrawerFocus(e))) return;
    if (e.key === "Escape") {
      closePillarPicker();
      if (closeTopModal()) e.preventDefault();
      else if (state.screen === "birth") { closeBirthModal(); e.preventDefault(); }
      else if (state.screen === "cast") { closeCastModal(); e.preventDefault(); }
      else closeChartDrawer();
    }
  });

}

async function openPersonalCase(caseId, { resumeResult = false } = {}) {
  try {
    const response = await fetch(`/api/personal-home/cases/${encodeURIComponent(caseId)}`, {
      headers: { Accept: "application/json" },
      credentials: "same-origin",
    });
    if (!response.ok) throw new Error(await response.text());
    const item = (await response.json()).item;
    if (!item?.id) throw new Error("事项不存在");
    setActivePersonalCase(item);

    const restoreCaseResult = () => {
      const saved = activeHistory.find(row => String(row.task_id || "") === String(item.interpret_task_id || ""))
        || activeHistory[0];
      if (saved?.id) {
        restoreHistory(Number(saved.id));
        toast(item.mode === "combined" ? "已打开这件事的详断结论" : "已打开这件事的最近一次解读");
        return true;
      }
      return false;
    };

    if (item.mode === "combined" && !item.liuyao_profile_id) {
      showScreen("landing");
      openCastModal({ clearQuestion: true, fresh: true, historyMode: "replace", preservePersonalCase: true });
      const question = $("#cast-question");
      if (question) question.value = item.question || "";
      syncCastEntryMode();
      syncCastUI();
      toast("本人命盘已带入，请完成私密起卦。");
      requestAnimationFrame(() => question?.focus());
      return true;
    }

    const profileId = Number(item.mode === "combined" ? item.liuyao_profile_id : item.bazi_profile_id);
    if (!profileId) {
      toast("关联命盘已不存在，请回到个人主页重新选择", "warn");
      window.location.assign("/");
      return true;
    }
    const resumedConversation = validSessionId(item.session_id)
      ? await openSavedProfile(profileId, {
        preservePersonalCase: true,
        resumeSessionId: item.session_id,
      })
      : false;
    if (!resumedConversation) {
      await openSavedProfile(profileId, { preservePersonalCase: true });
    } else {
      toast(item.mode === "combined" ? "已恢复这件事的完整详断对话" : "已恢复这件事的完整对话");
      return true;
    }
    if (resumeResult || item.result?.answer || item.status === "completed") {
      if (!restoreCaseResult()) toast("事项已打开，结论仍在同步中", "warn");
      return true;
    }
    if (item.status === "generating") {
      toast(item.mode === "combined" ? "一事详断仍在生成，已恢复进度" : "解读仍在生成，已恢复进度");
      return true;
    }
    const draft = $("#draft-input");
    if (draft) draft.value = item.question || "";
    toast(item.mode === "combined"
      ? "卦档已恢复。确认声明后继续详断。"
      : "默认命盘已恢复，近况已填入输入框。");
    requestAnimationFrame(() => draft?.focus());
    return true;
  } catch (reason) {
    toast("打开事项失败：" + humanError(String(reason?.message || reason)), "warn");
    window.location.assign("/");
    return true;
  }
}

async function init() {
  loadSiteStats();
  setupHomeCommunityFeed();
  setupSidebarToggle();
  const query = new URLSearchParams(location.search);
  const start = query.get("start");
  const communityHelpRequested = query.get("community") === "help";
  pendingCommunityHelp = communityHelpRequested && start === "bazi";
  const detailedEntryRequested = DETAILED_PUBLIC_ENTRY_ENABLED
    && start === "liuyao"
    && query.get("flow") === "detailed";
  const directEntryRequested = start === "liuyao" || start === "bazi";
  // 只有从工作台本身刷新时才恢复上次盘面。
  // 首页和直接访问 `/` 即使存在恢复 Cookie，也必须停留在首页。
  const dashboardRefreshRequested = currentHomeRoute()?.screen === "dash";
  const communityRequested = !query.get("view") && start !== "liuyao" && start !== "bazi" && location.hash === HOME_COMMUNITY_HASH;
  const archivesRequested = query.get("view") === "archives";
  const creditsRequested = query.get("view") === "credits";
  const routeSystem = currentHomeRoute()?.system;
  const resumeState = dashboardRefreshRequested ? readResumeCookie() : null;
  const resumeSystem = resumeState?.system || "";
  const dashboardNavSystem = routeSystem === "bazi" || routeSystem === "liuyao" ? routeSystem : resumeSystem;
  const personalCaseId = query.get("personal_case") || String(resumeState?.personal_case_id || "");
  bind();
  if (communityHelpRequested && start === "liuyao") {
    const helpVisibility = document.querySelector('input[name="cast-visibility"][value="help"]');
    if (helpVisibility) helpVisibility.checked = true;
    syncCastUI();
  }
  syncLayout();
  setupMobileViewportGuards();
  applyBigText();
  setMode("basic");
  if (detailedEntryRequested) {
    pendingCombinedEntry = true;
    syncCastEntryMode();
  }
  // DIRECT ENTRY FIRST PAINT · 刷新排盘/起卦地址时，先画目标页，不等账户请求后再从首页跳转。
  if (directEntryRequested) {
    showScreen(start === "bazi" ? "birth" : "cast", { preserveEntryLocation: true });
  } else if (creditsRequested) {
    showScreen("credits", { preserveEntryLocation: true });
  } else if (archivesRequested) {
    showScreen("archives", { preserveEntryLocation: true });
  } else {
    showScreen("landing", { preserveEntryLocation: true });
  }
  if (creditsRequested) setPrimaryNavCurrent("credits");
  else if (archivesRequested) setPrimaryNavCurrent("profile");
  else if (communityRequested) setPrimaryNavCurrent("community");
  else if (personalCaseId) setPrimaryNavCurrent("detailed");
  else if (dashboardRefreshRequested && (dashboardNavSystem === "bazi" || dashboardNavSystem === "liuyao")) setPrimaryNavCurrent(dashboardNavSystem);
  document.documentElement.removeAttribute("data-entry-start");
  // HOME COMMUNITY RETURN · 详情返回先落到广场，账户状态并行就绪（design-145）
  if (communityRequested) openHomeCommunity({ behavior: "auto", settle: true, historyMode: "replace", refresh: false });
  const accountReady = Account?.ready();
  const accountState = await accountReady;
  let resumedWorkspace = false;
  if (accountState?.authenticated) {
    try { await refreshAccountProfileIndex(); } catch (_) {}
    if (personalCaseId) {
      const opened = await openPersonalCase(personalCaseId, { resumeResult: query.get("resume_case") === "1" });
      if (opened) return;
    }
    if (dashboardRefreshRequested && !communityRequested && start !== "liuyao" && start !== "bazi") {
      resumedWorkspace = await restoreResumeFromCookie({
        expectedSystem: dashboardNavSystem,
        requireRecent: true,
      });
    }
    if (!resumedWorkspace && !communityRequested && start !== "liuyao" && start !== "bazi" && !query.get("view")) {
      PersonalHome?.syncScreen("landing");
      PersonalHome?.load().catch(() => {});
    }
  }
  else {
    clearCookie(RESUME_COOKIE);
    if (personalCaseId) {
      Account.requireLogin({ mode: "login", message: "私人事项，登录后继续。" })
        .then(ok => { if (ok) window.location.reload(); });
      return;
    }
  }
  renderProfileFab();
  if (dashboardRefreshRequested && !resumedWorkspace && !archivesRequested && !creditsRequested) setPrimaryNavCurrent("landing");
  if (communityRequested) return;
  if (detailedEntryRequested) {
    if (accountState?.authenticated) {
      const opened = await PersonalHome?.openDetailed({ historyMode: "replace" });
      if (!opened) {
        clearPersonalCaseContext();
        showScreen("landing", { historyMode: "replace", focusPage: true });
      }
    } else {
      Account.requireLogin({ mode: "login", message: "登录后使用命盘与六爻详断。" })
        .then(ok => { if (ok) window.location.reload(); });
    }
    return;
  }
  if (archivesRequested) {
    if (accountState?.authenticated) await openProfileLibrary({ includeCurrent: !!lastPayload, startup: true });
    else Account.requireLogin({ mode: "login", message: "登录后查看跨设备档案。" })
      .then(ok => {
        if (ok) openProfileLibrary({ includeCurrent: !!lastPayload, startup: true });
        else renderProfileSignedOut({ preserveEntryLocation: true, startup: true });
      });
    return;
  }
  if (creditsRequested) {
    if (accountState?.authenticated) CreditLedger?.activate();
    else Account.requireLogin({ mode: "login", message: "登录后管理积分。" })
      .then(ok => { if (ok) showScreen("credits", { historyMode: "replace", focusPage: true }); });
    return;
  }
  if (resumedWorkspace) {
    enterDashboard({ historyMode: "replace" });
    return;
  }
  if (start === "liuyao" || start === "bazi") {
    if (start === "liuyao") openCastModal({ clearQuestion: true, fresh: true, historyMode: "replace" });
    else if (!await openBirthModal({ historyMode: "replace" })) {
      showScreen("landing", { historyMode: "replace" });
    }
  }
}
