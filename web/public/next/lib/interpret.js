// 解读任务引擎：发起、流式接收（SSE 事件为完整任务快照）、断线轮询、停止、恢复。
// 只维护消息数据并通过 onChange 通知视图局部更新，不直接操作页面。
import { api, get, post, ApiError } from "./api.js?v=n12";
import { newRequestId, isSessionId } from "./ids.js?v=n12";
import { followupsFor, scenarioLabel } from "./copy.js?v=n12";
import { refreshSession } from "./store.js?v=n12";

const TERMINAL = new Set(["done", "failed", "cancelled"]);
const INPUT_KEYS = [
  "system", "input_mode", "calendar", "year", "month", "day", "hour", "minute", "is_leap_month", "gender", "location",
  "longitude", "tz_offset", "timezone", "use_true_solar", "day_boundary", "as_of", "manual_birth_year", "pillars",
  "year_pillar", "month_pillar", "day_pillar", "hour_pillar", "visibility", "public_consent", "public_consent_version",
];

let localId = 0;

export function humanizeError(raw, fallback = "解读没有完成，请稍后重试") {
  const text = String(raw || "").trim();
  if (!text) return fallback;
  if (/Internal Server Error|Bad Gateway|Service Unavailable|Gateway Timeout|HTTP\s*5\d\d/i.test(text)) return "服务暂时不可用，请稍后重试；已填写的信息不会丢失。";
  if (/Failed to fetch|NetworkError|Network request failed|Load failed/i.test(text)) return "网络连接不稳定，请检查网络后重试；已填写的信息不会丢失。";
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

export class Conversation {
  constructor({ system, sessionId, chartId = null, profileId = null, input = null, onChange, requireReauth }) {
    this.system = system;
    this.sessionId = sessionId;
    this.chartId = chartId;
    this.profileId = profileId;
    this.input = input || {};
    this.onChange = onChange || (() => {});
    this.requireReauth = requireReauth || (async () => false);
    this.messages = [];
    this.live = new Map();
    this.destroyed = false;
  }

  get busy() {
    return this.messages.some(message => message.kind === "ai" && message.streaming);
  }

  get liuyao() {
    return this.system === "liuyao";
  }

  askedQuestions() {
    return this.messages.filter(message => message.kind === "user").map(message => message.text);
  }

  emit(message, change) {
    if (!this.destroyed) this.onChange(message, change);
  }

  /* ---------- 恢复 ---------- */
  restore(serverMessages = []) {
    this.messages = [];
    let lastQuestion = "";
    serverMessages.forEach(item => {
      if (item.role === "user") {
        lastQuestion = String(item.content || "");
        this.messages.push({ kind: "user", text: lastQuestion, id: `u${++localId}` });
      } else if (item.role === "assistant") {
        const message = this.newAi({
          question: lastQuestion,
          scenario: item.scenario,
          topic: item.topic,
          taskId: item.task_id || "",
          messageId: item.id,
          status: "done",
          body: String(item.content || ""),
          publicPost: item.public_post || null,
          feedback: item.feedback_reaction || "",
          createdAt: item.created_at,
        });
        message.streaming = false;
        message.fullBody = message.body;
        this.messages.push(message);
      }
    });
    this.refreshFollowups();
  }

  attachTask(task) {
    if (!task || !task.task_id || this.messages.some(message => message.taskId === task.task_id)) return null;
    if (task.status === "done") return null;
    const question = String(task.question || "");
    const last = this.messages[this.messages.length - 1];
    if (question && !(last && last.kind === "user" && last.text === question)) {
      this.messages.push({ kind: "user", text: question, id: `u${++localId}` });
    }
    const message = this.newAi({ question, scenario: task.scenario, topic: task.topic, taskId: task.task_id, clientRequestId: task.client_request_id || "" });
    this.messages.push(message);
    this.emit(message, "new");
    this.applyTask(message, task);
    // 重新接上时，已经生成的部分直接完整显示，不再从头打字。
    if (message.streaming && message.fullBody && !message.body) {
      message.body = message.fullBody;
      this.emit(message, "text");
    }
    if (!TERMINAL.has(task.status)) this.follow(message, task.streamable !== false);
    return message;
  }

  newAi(fields = {}) {
    return {
      kind: "ai",
      id: `a${++localId}`,
      taskId: "",
      clientRequestId: "",
      messageId: null,
      status: "waiting",
      stage: "analysis",
      body: "",
      fullBody: "",
      streaming: true,
      streamable: false,
      serverDone: false,
      error: "",
      stopped: false,
      authLost: false,              // 发起时登录失效且没有重新登录：问题由视图退回输入框
      branch: null,
      credits: null,
      publicPost: null,
      feedback: "",
      followups: [],
      question: "",
      scenario: this.liuyao ? "divination" : "topic",
      topic: "",
      startedAt: Date.now(),
      completedAt: 0,
      ...fields,
    };
  }

  /* ---------- 发起 ---------- */
  buildBody(question, { topic = "", branch = null, clientRequestId }) {
    const body = {};
    INPUT_KEYS.forEach(key => {
      if (this.input && this.input[key] !== undefined && this.input[key] !== null && this.input[key] !== "") body[key] = this.input[key];
    });
    body.system = this.system;
    body.scenario = this.liuyao ? "divination" : "topic";
    body.question = question;
    if (!this.liuyao && topic) body.topic = topic;
    if (this.chartId) body.chart_id = this.chartId;
    if (this.profileId) body.profile_id = this.profileId;
    body.session_id = this.sessionId;
    body.client_request_id = clientRequestId;
    if (branch) {
      if (branch.fromTaskId) body.branch_from_task_id = branch.fromTaskId;
      if (branch.fromClientRequestId) body.branch_from_client_request_id = branch.fromClientRequestId;
      body.branch_reason = branch.reason || "edit_after_cancel";
    }
    return body;
  }

  async ask(question, { topic = "", showQuestion = true, branch = null } = {}) {
    if (this.busy) return null;
    const text = String(question || "").trim();
    if (!text) return null;
    if (showQuestion) {
      const user = { kind: "user", text, id: `u${++localId}` };
      this.messages.push(user);
      this.emit(user, "new");
    }
    const clientRequestId = newRequestId();
    // 记下分叉信息：登录失效、问题退回输入框时，重发仍按原来的分叉点继续。
    const message = this.newAi({ question: text, topic, clientRequestId, branch });
    this.messages.push(message);
    this.emit(message, "new");
    const body = this.buildBody(text, { topic, branch, clientRequestId });
    await this.send(message, body);
    return message;
  }

  // reauthed：这一轮已经重新登录过一次。之后再收到 401 就停下报错，不再弹登录、不再重发。
  async send(message, body, { reauthed = false } = {}) {
    const controller = new AbortController();
    this.live.set(message.id, { controller });
    let task;
    try {
      task = await api("/api/interpret", { method: "POST", body, signal: controller.signal });
    } catch (error) {
      if (error && error.name === "AbortError") return;
      if (message.stopped || this.destroyed || !message.streaming) return;
      if (error instanceof ApiError && error.status === 401) return this.resend(message, body, reauthed);
      return this.fail(message, humanizeError(error && error.message));
    }
    if (message.stopped || this.destroyed) return;
    if (!task || !task.task_id) return this.fail(message, "后端没有返回解读任务 ID");
    this.applyTask(message, task);
    if (!TERMINAL.has(task.status)) this.follow(message, true);
  }

  // 发起时 401：先向服务端确认登录状态（必要时弹出登录），成功后用同一请求体（同一 client_request_id）
  // 只重发一次；关掉登录面板则保留问题、不再重试。
  async resend(message, body, reauthed) {
    if (reauthed) return this.fail(message, "登录状态没有生效，问题已保留；请刷新页面后再试。");
    message.waitNote = "登录已失效，重新登录后继续。";
    this.emit(message, "status");
    let ok = false;
    try { ok = !!(await this.requireReauth()); } catch (_) { ok = false; }
    if (message.stopped || this.destroyed || !message.streaming) return;
    if (!ok) {
      message.authLost = true;
      return this.fail(message, "登录已失效，问题已保留。");
    }
    message.waitNote = "";
    this.emit(message, "status");
    return this.send(message, body, { reauthed: true });
  }

  /* ---------- 跟随任务 ---------- */
  follow(message, preferStream) {
    const entry = this.live.get(message.id) || {};
    this.live.set(message.id, entry);
    if (preferStream && typeof window.EventSource === "function") {
      const source = new EventSource(`/api/interpret/tasks/${encodeURIComponent(message.taskId)}/events`);
      entry.source = source;
      source.addEventListener("task", event => {
        let snapshot = null;
        try { snapshot = JSON.parse(event.data); } catch (_) { return; }
        entry.failures = 0;
        this.applyTask(message, snapshot);
        if (TERMINAL.has(snapshot.status)) this.closeLive(message);
      });
      source.onerror = () => {
        if (!message.streaming) { this.closeLive(message); return; }
        source.close();
        entry.source = null;
        this.poll(message);
      };
    } else {
      this.poll(message);
    }
  }

  poll(message, delay) {
    const entry = this.live.get(message.id) || {};
    this.live.set(message.id, entry);
    clearTimeout(entry.timer);
    const wait = delay ?? (message.streamable ? 1000 : 5000);
    entry.timer = setTimeout(async () => {
      if (!message.streaming || this.destroyed) return;
      try {
        const snapshot = await get(`/api/interpret/tasks/${encodeURIComponent(message.taskId)}`, { cache: "no-store" });
        entry.failures = 0;
        message.waitNote = "";
        this.applyTask(message, snapshot);
        if (!TERMINAL.has(snapshot.status)) this.poll(message);
      } catch (error) {
        if (!message.streaming || this.destroyed) return;
        if (error instanceof ApiError && error.status === 404) return this.fail(message, "这次解读任务已经不存在了，请重新提问。");
        if (error instanceof ApiError && error.status === 401) return this.pollReauth(message, entry);
        entry.failures = (entry.failures || 0) + 1;
        message.waitNote = "网络中断，正在重试；解读仍在继续。";
        this.emit(message, "status");
        this.poll(message, Math.min(10000, 1000 * 2 ** Math.min(entry.failures, 3)));
      }
    }, wait);
  }

  // 跟随中 401：服务端任务仍在继续。每条回答最多重新登录一次后接着查询；再次 401 或放弃登录就停下，
  // 回到档案时会重新接上。
  async pollReauth(message, entry) {
    if (entry.reauthed) return this.fail(message, "登录已失效，重新登录后可从档案继续查看。");
    entry.reauthed = true;
    message.waitNote = "登录已失效，重新登录后继续。";
    this.emit(message, "status");
    let ok = false;
    try { ok = !!(await this.requireReauth()); } catch (_) { ok = false; }
    if (!message.streaming || this.destroyed) return;
    if (!ok) return this.fail(message, "登录已失效，重新登录后可从档案继续查看。");
    message.waitNote = "";
    this.emit(message, "status");
    this.poll(message, 0);
  }

  closeLive(message) {
    const entry = this.live.get(message.id);
    if (!entry) return;
    entry.source?.close();
    clearTimeout(entry.timer);
    this.live.delete(message.id);
  }

  applyTask(message, task) {
    if (!message.streaming || !task) return;
    if (task.task_id) message.taskId = task.task_id;
    if (task.client_request_id) message.clientRequestId = task.client_request_id;
    if (task.public_post !== undefined) message.publicPost = task.public_post;
    if (task.chart_id) this.chartId = task.chart_id;
    if (task.profile_id) this.profileId = task.profile_id;
    if (isSessionId(task.session_id)) this.sessionId = task.session_id;
    if (task.streamable) message.streamable = true;
    if (task.credits) message.credits = task.credits;
    message.stage = task.stage || message.stage;
    const status = task.status;
    if (status === "done") {
      message.serverDone = true;
      this.setAnswer(message, String(task.answer || message.fullBody || ""));
      this.finish(message, "done");
    } else if (status === "failed") {
      if (task.answer) this.setAnswer(message, String(task.answer));
      this.fail(message, humanizeError(task.error, "解读任务失败"));
    } else if (status === "cancelled") {
      if (task.answer) this.setAnswer(message, String(task.answer));
      message.stopped = true;
      this.finish(message, "stopped");
    } else {
      if (message.streamable && typeof task.answer === "string") this.setAnswer(message, task.answer);
      message.status = message.fullBody ? "streaming" : "waiting";
      this.emit(message, "status");
    }
  }

  // 快照是完整答案：服务端可能改写或清空之前的文字，按公共前缀回退后再继续显示。
  setAnswer(message, next) {
    if (next === message.fullBody) return;
    let prefix = 0;
    const previous = message.fullBody;
    const max = Math.min(previous.length, next.length);
    while (prefix < max && previous[prefix] === next[prefix]) prefix += 1;
    if (message.body.length > prefix) message.body = message.body.slice(0, prefix);
    message.fullBody = next;
    if (!next) {
      message.body = "";
      message.status = "waiting";
    }
    this.emit(message, "text");
  }

  finish(message, status) {
    message.streaming = false;
    message.status = status;
    message.body = message.fullBody || message.body;
    message.completedAt = Date.now();
    this.closeLive(message);
    if (status === "done") {
      message.followups = followupsFor({
        liuyao: this.liuyao,
        question: message.question,
        answer: message.body,
        asked: this.askedQuestions(),
        turn: this.messages.filter(item => item.kind === "user").length,
      });
      refreshSession().catch(() => {});
    }
    this.emit(message, status);
  }

  fail(message, error) {
    message.error = error;
    message.streaming = false;
    message.status = "failed";
    message.body = message.fullBody || message.body;
    message.completedAt = Date.now();
    this.closeLive(message);
    this.emit(message, "failed");
  }

  /* ---------- 停止 ---------- */
  async stop() {
    const message = this.messages.find(item => item.kind === "ai" && item.streaming);
    if (!message) return;
    const entry = this.live.get(message.id);
    entry?.controller?.abort();
    const payload = {};
    if (message.taskId) payload.task_id = message.taskId;
    if (message.clientRequestId) payload.client_request_id = message.clientRequestId;
    message.stopped = true;
    this.finish(message, "stopped");
    try {
      const task = await post("/api/interpret/cancel", payload);
      if (task && task.task_id) message.taskId = task.task_id;
    } catch (_) {}
  }

  // 移除一问一答（重试、编辑时使用）。
  removePair(message) {
    const index = this.messages.indexOf(message);
    if (index < 0) return;
    const start = index > 0 && this.messages[index - 1].kind === "user" ? index - 1 : index;
    this.messages.splice(start, index - start + 1);
  }

  refreshFollowups() {
    const asked = this.askedQuestions();
    let turn = 0;
    this.messages.forEach(message => {
      if (message.kind === "user") turn += 1;
      if (message.kind === "ai" && message.status === "done") {
        message.followups = followupsFor({ liuyao: this.liuyao, question: message.question, answer: message.body, asked, turn });
      }
    });
    // 只在最后一条回答下展示追问建议。
    const lastAi = [...this.messages].reverse().find(message => message.kind === "ai");
    this.messages.forEach(message => { if (message.kind === "ai" && message !== lastAi) message.followups = []; });
  }

  async sendFeedback(message, reaction) {
    const body = { reaction, session_id: this.sessionId };
    if (this.chartId) body.chart_id = this.chartId;
    if (message.messageId) body.message_id = message.messageId;
    else if (message.taskId) body.task_id = message.taskId;
    else throw new Error("未找到回复记录");
    const result = await post("/api/chat-message-feedback", body);
    if (result && result.message_id) message.messageId = result.message_id;
    message.feedback = reaction;
    return result;
  }

  label(message) {
    return scenarioLabel(message.scenario, message.topic);
  }

  // 离开页面：只停止本地跟随，服务端任务继续，回到档案时会重新接上。
  // 网络恢复时立即重试中断的轮询，不必等退避计时结束。
  reconnect() {
    if (this.destroyed) return;
    this.messages.forEach(message => {
      const entry = this.live.get(message.id);
      if (message.streaming && message.taskId && entry?.failures) this.poll(message, 0);
    });
  }

  destroy() {
    this.destroyed = true;
    [...this.live.keys()].forEach(id => {
      const entry = this.live.get(id);
      entry?.source?.close();
      clearTimeout(entry?.timer);
    });
    this.live.clear();
  }
}
