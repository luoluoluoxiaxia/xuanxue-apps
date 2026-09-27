// 解读工作台：同一张盘上的一段对话。桌面左对话右命盘；手机顶部命盘速览，点开看完整盘面。
import { h, autoGrow, reducedMotion, submitOnEnter, coarsePointer } from "../lib/dom.js?v=n1";
import { icon } from "../lib/icons.js?v=n1";
import { get, post } from "../lib/api.js?v=n1";
import { session, local } from "../lib/store.js?v=n1";
import { newSessionId, isSessionId } from "../lib/ids.js?v=n1";
import { resolveLiuyaoSession, readingDraftKey } from "../lib/sessions.js?v=n1";
import { Conversation, humanizeError } from "../lib/interpret.js?v=n1";
import { BAZI_STARTERS, LIUYAO_DEFAULT_QUESTION, RISK_ACK_KEY, RISK_ACK_TEXT, waitingLine, CN_NUM, LY_POS } from "../lib/copy.js?v=n1";
import { takeHandoff } from "../lib/handoff.js?v=n1";
import { relativeTime, plainExcerpt } from "../lib/format.js?v=n1";
import { errorView, stateView } from "../ui/bits.js?v=n1";
import { openSheet } from "../ui/overlay.js?v=n1";
import { toast } from "../ui/toast.js?v=n1";
import { baziPanel, baziStrip } from "../ui/chart-bazi.js?v=n1";
import { liuyaoPanel, liuyaoStrip, liuyaoTitle } from "../ui/chart-liuyao.js?v=n1";
import { copyText, sharePost } from "../lib/share.js?v=n1";
import { openShareSheet } from "../ui/share-sheet.js?v=n1";
import { openFeedback } from "./feedback.js?v=n1";

const REAUTH_REASON = "登录已失效；重新登录后自动继续。";
// 从解读页分享卦帖时记录的来源。
const SHARE_REF = "workbench_share";

const riskAccepted = () => local.get(RISK_ACK_KEY, "") === "1";

function elapsedText(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  return `${Math.floor(seconds / 60)} 分 ${String(seconds % 60).padStart(2, "0")} 秒`;
}

// 光标放进最后一个段落/列表项里，紧跟正在输出的文字。
function withCaret(container) {
  const caret = document.createElement("span");
  caret.className = "caret";
  caret.setAttribute("aria-hidden", "true");
  let target = container.lastElementChild;
  while (target && /^(UL|OL|DETAILS|DIV|SECTION)$/.test(target.tagName) && target.lastElementChild) target = target.lastElementChild;
  (target && /^(P|LI|H2|H3|H4|SUMMARY)$/.test(target.tagName) ? target : container).append(caret);
}

// 复制成纯文本：去掉标题井号与加粗星号，保留段落和列表的换行，贴到聊天或备忘录里仍然好读。
function plainAnswer(markdown) {
  return String(markdown || "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// 流式输出到一半时，还没闭合的 **、只有井号或列表符号的半行先不显示，免得符号一闪而过。
function tidyStreaming(text) {
  let value = String(text || "").replace(/(^|\n)[ \t]*(#{1,6}|[-*]|\d+[.)])?[ \t]*$/, "$1");
  if ((value.match(/\*\*/g) || []).length % 2) value = value.replace(/\*\*(?![\s\S]*\*\*)/, "");
  return value;
}

function renderMarkdown(text) {
  const renderer = window.XuanxueChatRenderer;
  return renderer && typeof renderer.renderBody === "function" ? renderer.renderBody(text) : String(text || "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

export function render(ctx) {
  const id = ctx.params.id;
  const root = h("div", { class: "reading" });
  const loading = h("div", { class: "reading-loading" },
    h("span", { class: "skel skel-line", style: { width: "180px" } }),
    h("span", { class: "skel", style: { height: "140px", borderRadius: "18px" } }),
    h("span", { class: "skel skel-line", style: { width: "70%" } }),
    h("span", { class: "skel skel-line", style: { width: "52%" } }));
  root.append(loading);

  const state = {
    system: "bazi",
    name: "",
    payload: null,
    input: {},
    profileId: Number(id) || null,
    chartId: null,
    visibility: "private",
    publicPost: null,
    conversation: null,
    pendingBranch: null,
    autoStart: false,
    openHelp: false,          // 排盘后直接向社区求助（旧地址 ?start=bazi&community=help）
    question: "",
    lastConversation: null,   // 八字：同一张盘上最近的一段对话，空白页里给出「接着上次聊」
  };
  let nodes = {};
  let ticker = 0;
  let tick = 0;

  // 断线恢复：网络恢复后重新打开没载入的档案，或立即接上仍在进行的解读。
  let loadFailed = false;
  // 打开档案时登录失效：向服务端确认并登录后只自动重试一次。
  let authRetried = false;
  // 未登录挡板：在别处登录后自动载入。
  let lockedOut = false;
  ctx.subscribe(session, s => {
    if (!lockedOut || !s.authenticated) return;
    lockedOut = false;
    root.replaceChildren(loading);
    load();
  });
  const onOnline = () => {
    if (!ctx.isCurrent()) return;
    if (loadFailed) {
      loadFailed = false;
      root.replaceChildren(loading);
      load();
    } else {
      state.conversation?.reconnect();
    }
  };
  window.addEventListener("online", onOnline);
  ctx.cleanup(() => {
    clearInterval(ticker);
    window.removeEventListener("online", onOnline);
    state.conversation?.destroy();
  });

  /* ---------- 载入 ---------- */
  async function load() {
    const fresh = takeHandoff(id);
    try {
      if (fresh) {
        Object.assign(state, {
          system: fresh.system,
          name: fresh.name || "",
          payload: fresh.payload,
          input: fresh.input || {},
          chartId: fresh.payload?.chart_id || null,
          visibility: fresh.payload?.visibility || fresh.input?.visibility || "private",
          autoStart: !!fresh.autoStart,
          openHelp: !!fresh.openHelp,
          question: fresh.question || "",
        });
        setup(fresh.sessionId || newSessionId(), []);
        return;
      }
      if (!session.get().ready) await new Promise(resolve => { const stop = session.subscribe(s => { if (s.ready) { stop(); resolve(); } }); });
      if (!session.get().authenticated) {
        const ok = await ctx.requireAuth("登录后查看私人档案。");
        if (!ok) {
          if (ctx.isCurrent()) showLockedOut();
          return;
        }
      }
      const detail = await get(`/api/profiles/${encodeURIComponent(id)}`, { cache: "no-store" });
      if (!ctx.isCurrent()) return;
      const payload = detail?.payload || {};
      Object.assign(state, {
        system: detail.system || payload.system || detail.input?.system || "bazi",
        name: detail.name || "",
        payload,
        input: detail.input || {},
        chartId: detail.chart_id || payload.chart_id || null,
        profileId: detail.id || state.profileId,
        visibility: detail.visibility || payload.visibility || "private",
        publicPost: detail.public_post || null,
        question: payload.question || detail.input?.question || "",
      });
      const wanted = ctx.query.get("session");
      const freshConversation = ctx.query.get("fresh") === "1";
      let sessionId = isSessionId(wanted) ? wanted : "";
      if (!sessionId && state.system === "liuyao") {
        // 有历史却找不到会话时会报错，而不是打开空对话，避免重复发起付费解读。
        sessionId = await resolveLiuyaoSession(detail, {
          fresh: freshConversation,
          fetchTask: taskId => get(`/api/interpret/tasks/${encodeURIComponent(taskId)}`),
          fetchConversations: () => get(`/api/profiles/${encodeURIComponent(id)}/conversations`, { cache: "no-store" }),
        });
        if (!ctx.isCurrent()) return;
      }
      if (sessionId) {
        const batch = await post("/api/resume", { items: [{ key: state.system === "liuyao" ? "断卦" : "解读", chart_id: state.chartId, session_id: sessionId, profile_id: state.profileId, limit: 200 }] });
        if (!ctx.isCurrent()) return;
        const item = batch?.items?.[0];
        if (!item || !item.ok) throw new Error(item?.error || "这段对话暂时无法恢复");
        if (item.input) state.input = item.input;
        if (item.payload) state.payload = item.payload;
        if (item.chart_id) state.chartId = item.chart_id;
        setup(sessionId, item.messages || [], item.active_task ? [item.active_task] : [], { opened: "resumed" });
      } else {
        const active = freshConversation ? [] : (detail.active_tasks || []).slice().sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
        setup(newSessionId(), [], active, { opened: freshConversation ? "fresh" : "archive" });
      }
    } catch (error) {
      if (!ctx.isCurrent()) return;
      // 登录失效（本地仍以为已登录）：先向服务端确认，需要时弹出登录，成功后只自动重试一次，不会循环。
      if (error?.status === 401 && !authRetried) {
        authRetried = true;
        const ok = await ctx.requireAuth("登录已失效，重新登录后继续查看。", { force: true });
        if (!ctx.isCurrent()) return;
        if (ok) {
          root.replaceChildren(loading);
          load();
        } else {
          showLockedOut();
        }
        return;
      }
      loadFailed = !!(error?.isNetwork || error?.status >= 500);
      const gone = error?.status === 404;
      // 404 重试没有意义，直接给回到「我的盘」的路；手机上页内返回链接是隐藏的，这里也要有出口。
      root.replaceChildren(
        h("a", { class: "back-link", href: "#/me/archives" }, icon("back"), "我的盘"),
        stateView({
          tone: "error",
          title: gone ? "这份档案不存在或已删除" : "档案没能打开",
          text: error?.message || "网络或服务暂时不可用",
          actions: [
            gone ? null : h("button", { type: "button", class: "btn btn-soft", onClick: () => { loadFailed = false; root.replaceChildren(loading); load(); } }, icon("refresh"), "重试"),
            h("a", { class: ["btn", gone ? "btn-primary" : "btn-ghost"], href: "#/me/archives" }, "回到我的盘"),
          ].filter(Boolean),
        }));
    }
  }

  function showLockedOut() {
    lockedOut = true;
    root.replaceChildren(stateView({
      glyph: "lock",
      title: "登录后查看这份档案",
      text: "命盘、卦档与对话只对本人可见。",
      actions: [h("button", { type: "button", class: "btn btn-primary", onClick: async () => {
        const ok = await ctx.requireAuth("登录后查看私人档案。");
        if (ok && ctx.isCurrent() && lockedOut) {
          lockedOut = false;
          root.replaceChildren(loading);
          load();
        }
      } }, "登录 / 注册")],
    }));
  }

  /* ---------- 工作台 ---------- */
  // opened：从档案打开的方式——resumed 接上某段对话、fresh 新对话、archive 直接打开档案；刚排好的盘为空。
  function setup(sessionId, serverMessages, activeTasks = [], { opened = "" } = {}) {
    const conversation = new Conversation({
      system: state.system,
      sessionId,
      chartId: state.chartId,
      profileId: state.profileId,
      input: state.input,
      onChange: (message, change) => onMessageChange(message, change),
      // force：服务端已返回 401，先向服务端确认登录状态，本地仍显示已登录时也会弹出登录。
      requireReauth: () => ctx.requireAuth(REAUTH_REASON, { force: true }),
    });
    state.conversation = conversation;
    conversation.restore(serverMessages);
    buildLayout();
    renderThread();
    activeTasks.forEach(task => conversation.attachTask(task));
    syncComposer();
    ticker = setInterval(onTick, 1000);
    if (state.autoStart && state.system === "liuyao") {
      if (riskAccepted()) startFirst();
      else {
        toast("卦已成，确认参考声明后将自动开始解读");
        state.pendingStart = true;
        requestAnimationFrame(() => nodes.thread.querySelector("[data-risk-ack]")?.focus());
      }
    }
    const liuyao = state.system === "liuyao";
    const running = activeTasks.some(task => task.status === "pending" || task.status === "running");
    if (serverMessages.length || activeTasks.length) {
      requestAnimationFrame(() => scrollToBottom(false));
    } else if (!liuyao && state.profileId) {
      loadLastConversation();
    }
    // 从档案打开时说明打开的是哪段对话、上次的解读停在哪里。
    if (opened === "resumed" && (serverMessages.length || activeTasks.length)) {
      toast(running ? "已恢复上次对话，解读继续" : `已恢复这段${liuyao ? "六爻" : "八字"}对话，继续追问`);
    } else if (opened === "fresh") {
      toast(`已用这份${liuyao ? "卦档" : "八字"}开启新对话`);
    } else if (opened === "archive" && activeTasks.length) {
      const statuses = activeTasks.map(task => task.status);
      if (running) toast("档案已打开，解读正在继续");
      else if (statuses.includes("failed")) toast("档案已打开，可重试上次解读");
      else if (statuses.includes("cancelled")) toast("档案已打开，上次解读已停止");
    }
    // 排好盘后直接向社区求助：刚排好的盘由交接带来标记；选已有命盘时带 help=1。
    const helpQuery = ctx.query.get("help") === "1";
    if ((state.openHelp || helpQuery) && state.profileId) {
      state.openHelp = false;
      if (helpQuery) {
        // 去掉 help=1，刷新或返回时不再自动弹出。
        const params = new URLSearchParams(ctx.query);
        params.delete("help");
        const search = params.toString();
        replaceUrl(`#/reading/${encodeURIComponent(id)}${search ? `?${search}` : ""}`);
      }
      requestAnimationFrame(() => { if (ctx.isCurrent()) openHelp(); });
    }
  }

  // 从「我的盘」打开八字盘时是一段新对话；上次聊到哪里，在空白页里给一个接着聊的入口。
  async function loadLastConversation() {
    try {
      const items = await get(`/api/profiles/${encodeURIComponent(state.profileId)}/conversations`, { cache: "no-store" });
      if (!ctx.isCurrent()) return;
      const rows = (Array.isArray(items) ? items : (items?.items || []))
        .filter(item => isSessionId(item?.session_id) && item.session_id !== state.conversation?.sessionId)
        .sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
      state.lastConversation = rows[0] || null;
      nodes.thread?.querySelector(".rd-resume-slot")?.replaceChildren(...[resumeLink()].filter(Boolean));
    } catch (_) {}
  }

  function resumeLink() {
    const item = state.lastConversation;
    if (!item || item.session_id === state.conversation?.sessionId) return null;
    const running = item.status === "pending" || item.status === "running";
    return h("a", { class: "rd-resume", href: `#/reading/${encodeURIComponent(state.profileId)}?session=${encodeURIComponent(item.session_id)}` },
      h("span", { class: "rd-resume-icon", "aria-hidden": "true" }, icon("clock", "icon-sm")),
      h("span", { class: "rd-resume-copy" },
        h("small", null, running ? "上次的解读还在进行" : `接着上次聊 · ${relativeTime(item.updated_at)}`),
        h("b", null, item.last_question || item.first_question || "本命解读")),
      h("span", { class: "rd-resume-go" }, "继续", icon("chevronRight", "icon-sm")));
  }

  function buildLayout() {
    const liuyao = state.system === "liuyao";
    const panel = liuyao ? liuyaoPanel(state.payload) : baziPanel(state.payload, { name: state.name, input: state.input });
    const title = liuyao ? liuyaoTitle(state.payload) : (state.name || state.payload?.profile_name || "我的命盘");
    // 解读进行中不能重新起卦 / 开新对话；按钮在 syncComposer 里随忙碌状态切换。
    const restart = liuyao
      ? h("button", { type: "button", class: "btn btn-sm btn-ghost", onClick: () => {
        if (state.conversation?.busy) { toast("请先等待当前解读完成，或停止后再重新起卦"); return; }
        ctx.navigate("/ask/liuyao");
      } }, icon("refresh"), h("span", { class: "rd-action-label" }, "重新起卦"))
      : h("button", { type: "button", class: "btn btn-sm btn-ghost", onClick: newConversation }, icon("plus"), h("span", { class: "rd-action-label" }, "新对话"));
    const helpSlot = h("span", { class: "rd-help-slot" });
    const headActions = h("div", { class: "rd-actions" },
      restart,
      !liuyao ? h("button", { type: "button", class: "btn btn-sm btn-ghost", onClick: openConversations }, icon("clock"), h("span", { class: "rd-action-label" }, "对话记录")) : null,
      !liuyao ? h("button", { type: "button", class: "btn btn-sm btn-ghost", onClick: () => {
        if (state.conversation?.busy) { toast("请先停止当前解读，再修改出生信息"); return; }
        ctx.navigate(`/ask/bazi?edit=${encodeURIComponent(state.profileId)}`);
      } }, icon("edit"), h("span", { class: "rd-action-label" }, "修改信息")) : null,
      helpSlot);
    const isPublic = state.visibility === "public";
    const strip = h("button", { type: "button", class: "rd-strip", onClick: openChartSheet, "aria-label": "查看完整盘面" },
      liuyao ? liuyaoStrip(state.payload) : baziStrip(state.payload),
      h("span", { class: "rd-strip-go" }, "看盘", icon("chevronDown", "icon-sm")));
    const thread = h("div", { class: "thread" });
    // 流式文字不逐字播报，只在关键状态变化时提示读屏用户。
    const live = h("p", { class: "sr-only", role: "status", "aria-live": "polite" });
    const composer = buildComposer();
    const jump = h("button", { type: "button", class: "jump-latest", hidden: true, onClick: () => scrollToBottom(true) }, icon("arrowUp", "icon-sm"), "回到最新");
    const conversationCol = h("section", { class: "rd-main", "aria-label": "对话" },
      h("header", { class: "rd-head" },
        h("a", { class: "back-link", href: "#/me/archives" }, icon("back"), "我的盘"),
        h("div", { class: "rd-title" },
          h("span", { class: ["chip", liuyao ? "chip-liuyao" : "chip-bazi"] }, liuyao ? "六爻" : "八字"),
          // 六爻卦档分公开 / 私密：公开的首轮解答会发布到广场。
          liuyao ? h("span", { class: ["chip", "chip-outline", "rd-vis"], title: isPublic ? "公开卦：首轮解答发布到广场" : "私密卦：仅自己可见" }, icon(isPublic ? "globe" : "lock"), isPublic ? "公开" : "私密") : null,
          h("h1", null, title),
          liuyao && state.question ? h("p", { class: "rd-question" }, `所问：${state.question}`) : null),
        headActions),
      strip,
      thread,
      live,
      jump,
      composer.node);
    const side = h("aside", { class: "rd-side", "aria-label": liuyao ? "卦盘" : "命盘" }, panel);
    root.replaceChildren(h("div", { class: ["rd-layout", liuyao ? "is-liuyao" : "is-bazi"] }, conversationCol, side));
    nodes = { thread, composer, jump, panel, side, live, restart, helpSlot };
    syncHelpAction();
    window.addEventListener("scroll", syncJump, { passive: true });
    ctx.cleanup(() => window.removeEventListener("scroll", syncJump));
    // 输入框高度会变（多行、参考声明）：「回到最新」和轻提示始终浮在它上方。
    if ("ResizeObserver" in window) {
      const rootStyle = document.documentElement.style;
      const observer = new ResizeObserver(() => rootStyle.setProperty("--rd-composer-h", `${Math.round(composer.node.offsetHeight)}px`));
      observer.observe(composer.node);
      ctx.cleanup(() => { observer.disconnect(); rootStyle.removeProperty("--rd-composer-h"); });
    }
    // 首屏交接时这段代码在 render 返回前执行，外壳随后会写入默认标题；推迟一拍再写盘名。
    Promise.resolve().then(() => { if (ctx.isCurrent()) ctx.setTitle(title); });
  }

  // 已有发布到广场的卦帖（公开卦的首轮解答、已发布的求助帖）时，头部显示「查看卦帖」，否则「向社区求助」。
  function publishedPost() {
    const post = state.publicPost;
    if (!post?.slug) return null;
    return state.visibility === "public" || post.status === "published" ? post : null;
  }

  function syncHelpAction() {
    const slot = nodes.helpSlot;
    if (!slot) return;
    const post = publishedPost();
    const key = post ? `post:${post.slug}` : "help";
    if (slot.dataset.key === key) return;
    slot.dataset.key = key;
    slot.replaceChildren(post
      ? h("a", { class: "btn btn-sm btn-ghost", href: `#/post/${encodeURIComponent(post.slug)}` }, icon("globe"), h("span", { class: "rd-action-label" }, "查看卦帖"))
      : h("button", { type: "button", class: "btn btn-sm btn-soft", onClick: openHelp }, icon("hand"), h("span", { class: "rd-action-label" }, "向社区求助")));
  }

  // 本次对话里公开解答刚发布：记下卦帖，头部随之切换。
  function notePublished(message) {
    const post = message?.publicPost;
    if (!post?.slug || post.status !== "published" || state.publicPost?.slug === post.slug) return;
    state.publicPost = post;
    syncHelpAction();
  }

  function openChartSheet() {
    const liuyao = state.system === "liuyao";
    openSheet({
      title: liuyao ? "卦盘" : "命盘",
      body: liuyao ? liuyaoPanel(state.payload) : baziPanel(state.payload, { name: state.name, input: state.input }),
      wide: true,
      className: "sheet-chart",
    });
  }

  /* ---------- 对话渲染 ---------- */
  function renderThread() {
    const conversation = state.conversation;
    const thread = nodes.thread;
    if (!conversation.messages.length) {
      thread.replaceChildren(emptyState());
      return;
    }
    thread.replaceChildren(...conversation.messages.map(message => messageNode(message)));
  }

  function emptyState() {
    const liuyao = state.system === "liuyao";
    const ack = riskAccepted() ? null : riskAckControl(() => {
      renderThread();
      syncComposer();
      if (state.pendingStart) {
        state.pendingStart = false;
        startFirst();
      }
    });
    if (liuyao) {
      const payload = state.payload || {};
      const moving = Array.isArray(payload.dong_yao) ? payload.dong_yao : [];
      const start = h("button", { type: "button", class: "btn btn-primary", disabled: !riskAccepted(), onClick: () => startFirst() }, icon("sparkle"), "开始解读");
      return h("div", { class: "thread-empty" },
        h("p", { class: "kicker" }, "断卦"),
        h("h2", null, "一卦已成，开始断卦"),
        h("p", null, `${liuyaoTitle(payload)} · 世${LY_POS[(payload.shi_yao || 1) - 1]}爻 应${LY_POS[(payload.ying_yao || 1) - 1]}爻 · 动爻${CN_NUM[moving.length] || moving.length}处。开始解读，或直接追问。`),
        ack,
        h("div", { class: "thread-empty-actions" },
          start,
          h("button", { type: "button", class: "btn", onClick: () => fillComposer(state.question || LIUYAO_DEFAULT_QUESTION) }, "填入所问事项")));
    }
    return h("div", { class: "thread-empty" },
      h("div", { class: "rd-resume-slot" }, resumeLink()),
      h("p", { class: "kicker" }, "同一命盘 · 一段对话"),
      h("h2", null, "你想先问哪件事？"),
      h("p", null, "从一个问题开始，之后在同一段对话里继续追问。"),
      ack,
      h("div", { class: "starters", role: "group", "aria-label": "常见问题" },
        BAZI_STARTERS.map(([label, question]) => h("button", { type: "button", class: "starter", onClick: () => fillComposer(question) }, h("b", null, label), h("span", null, question)))),
      h("p", { class: "starter-note" }, "点一下只会填入输入框，可以先改再发。"));
  }

  function riskAckControl(onAccept) {
    const box = h("input", { type: "checkbox", "data-risk-ack": "" });
    box.addEventListener("change", () => {
      if (!box.checked) return;
      local.set(RISK_ACK_KEY, "1");
      onAccept?.();
    });
    return h("label", { class: "check risk-ack" }, box, h("span", null, RISK_ACK_TEXT));
  }

  function messageNode(message) {
    if (message.kind === "user") {
      return h("div", { class: "msg msg-user", "data-msg": message.id }, h("div", { class: "bubble" }, message.text));
    }
    const node = h("article", { class: "msg msg-ai", "data-msg": message.id, "aria-label": `解读：${message.question || ""}` });
    paintAi(node, message);
    return node;
  }

  function paintAi(node, message) {
    const conversation = state.conversation;
    const label = conversation.label(message);
    const head = h("header", { class: "ai-head" },
      h("span", { class: "ai-mark", "aria-hidden": "true" }, "玄"),
      h("span", { class: "ai-label" }, `推演 · ${label}`),
      h("span", { class: "ai-elapsed tnum", "data-elapsed": "" }, elapsedLabel(message)));
    const body = h("div", { class: "ai-body prose" });
    const children = [head];
    if (message.status === "failed") {
      if (message.body) {
        body.innerHTML = renderMarkdown(message.body);
        children.push(h("section", { class: "ai-partial" }, h("p", { class: "ai-partial-label" }, "失败前已生成的内容"), body));
      }
      children.push(h("div", { class: "ai-error", role: "alert" },
        h("b", null, message.body ? "解读中断，现有内容已保留" : "这次解读没有完成"),
        h("p", null, message.error || "解读没有完成"),
        h("div", { class: "ai-error-actions" },
          message.question ? h("button", { type: "button", class: "btn btn-sm btn-primary", onClick: () => retry(message) }, icon("refresh"), "重新解读") : null,
          message.question ? h("button", { type: "button", class: "btn btn-sm", onClick: () => editQuestion(message) }, icon("edit"), "编辑问题") : null,
          h("button", { type: "button", class: "btn btn-sm btn-ghost", onClick: () => sendFeedback(message) }, icon("message"), "反馈问题"))));
    } else {
      const waiting = message.streaming && !message.body;
      if (waiting) {
        children.push(h("div", { class: "ai-waiting" },
          h("span", { class: "ai-pulse", "aria-hidden": "true" }, h("i"), h("i"), h("i")),
          h("span", { "data-wait": "" }, message.waitNote || waitingLine(message.stage, { liuyao: state.system === "liuyao", tick }))),
        h("div", { class: "ai-skeleton", "aria-hidden": "true" }, h("span"), h("span"), h("span")));
      } else {
        body.innerHTML = renderMarkdown(message.streaming ? tidyStreaming(message.body) : message.body);
        if (message.streaming) withCaret(body);
        children.push(body);
        if (message.streaming) children.push(h("p", { class: "ai-stream-status", "data-wait": "" }, message.waitNote || waitingLine(message.stage, { liuyao: state.system === "liuyao", tick })));
      }
      if (message.stopped) {
        children.push(h("div", { class: "ai-stopped" },
          h("span", null, "已停止生成。"),
          message.question ? h("button", { type: "button", class: "link-btn", onClick: () => editStopped(message) }, "编辑刚才的问题") : null));
      }
      if (message.publicPost) {
        if (message.publicPost.status === "published") {
          children.push(h("div", { class: "ai-public" },
            icon("globe", "icon-sm"),
            h("span", null, "已发布到社区"),
            h("a", { class: "link-btn", href: `#/post/${encodeURIComponent(message.publicPost.slug)}` }, "查看卦帖"),
            h("button", { type: "button", class: "link-btn", onClick: event => sharePublished(message, event.currentTarget) }, "分享")));
        } else if (message.streaming) {
          children.push(h("div", { class: "ai-public is-pending" }, icon("globe", "icon-sm"), h("span", null, "完成后公开发布")));
        }
      }
      if (message.status === "done") {
        const credits = message.credits;
        if (credits && Number(credits.required_credits) > 0) {
          children.push(h("p", { class: "ai-credits" }, credits.platform_covered > 0
            ? "本次回答已完整送达 · 积分扣至 0，不足部分免扣。"
            : `本次消耗 ${credits.required_credits} 分 · ${credits.daily_free_spent || credits.paid_spent ? `今日免费 ${credits.daily_free_spent} + 充值积分 ${credits.paid_spent}` : "未扣充值积分"} · 今日免费剩余 ${credits.daily_remaining} 分 · 充值剩余 ${credits.paid_balance_after} 分`));
        }
        children.push(h("div", { class: "ai-tools" },
          feedbackButton(message, "like"),
          feedbackButton(message, "dislike"),
          copyButton(message),
          h("button", { type: "button", class: "ai-tool", "aria-label": "反馈这条解读", title: "反馈这条解读", onClick: () => sendFeedback(message) }, icon("message"))));
        if (message.followups && message.followups.length) {
          // 追问建议只填进输入框，由用户确认（可先修改）后再发送，避免误点直接发起一次解读。
          children.push(h("div", { class: "followups-wrap" },
            h("p", { class: "followups-hint", id: `followups-hint-${message.id}` }, "点选后填入输入框，可修改后再发送"),
            h("div", { class: "followups" }, message.followups.map(text => h("button", {
              type: "button",
              class: "followup",
              "aria-describedby": `followups-hint-${message.id}`,
              onClick: () => useFollowup(text),
            }, icon("reply", "icon-sm"), text)))));
        }
      }
    }
    node.classList.toggle("is-streaming", !!message.streaming);
    node.classList.toggle("is-failed", message.status === "failed");
    node.replaceChildren(...children);
  }

  function copyButton(message) {
    const button = h("button", { type: "button", class: "ai-tool", "aria-label": "复制回答", title: "复制回答" }, icon("copy"));
    let timer = 0;
    button.addEventListener("click", async () => {
      const ok = await copyText(plainAnswer(message.body));
      toast(ok ? "已复制回答" : "复制没有成功，可以长按选中文字复制", { type: ok ? "ok" : "error" });
      if (!ok) return;
      // 图标短暂变成对勾，确认已经复制。
      clearTimeout(timer);
      button.classList.add("is-done");
      button.replaceChildren(icon("check"));
      timer = setTimeout(() => { button.classList.remove("is-done"); button.replaceChildren(icon("copy")); }, 1600);
    });
    return button;
  }

  // 意见反馈带上档案、盘、对话与任务编号，方便定位是哪一次解读（不带出生信息）。
  function sendFeedback(message) {
    const conversation = state.conversation;
    openFeedback({
      profileId: state.profileId,
      chartId: conversation?.chartId || state.chartId,
      sessionId: conversation?.sessionId || "",
      taskId: message?.taskId || "",
    });
  }

  // 分享已发布的卦帖：AI 公开卦帖用分享面板（长图 + 复制链接），取不到帖子详情时退回复制标题和链接。
  let sharing = false;
  async function sharePublished(message, button) {
    const slug = message.publicPost?.slug;
    if (!slug || sharing || document.querySelector(".sheet-share")) return;
    sharing = true;
    button?.setAttribute("aria-busy", "true");
    try {
      const detail = await get(`/api/community/posts/${encodeURIComponent(slug)}`, { cache: "no-store" }).catch(() => null);
      if (!ctx.isCurrent()) return;
      if (detail?.slug && detail.post_kind === "ai" && detail.system === "liuyao" && detail.answer && detail.oracle) {
        openShareSheet(detail, { ref: SHARE_REF });
        return;
      }
      const result = await sharePost({ slug, title: detail?.question || state.question || message.question, ref: SHARE_REF });
      if (!result.silent && result.message) toast(result.message, { type: result.ok ? "ok" : "error" });
    } finally {
      sharing = false;
      button?.removeAttribute("aria-busy");
    }
  }

  function feedbackButton(message, reaction) {
    const pressed = message.feedback === reaction;
    const button = h("button", {
      type: "button",
      class: ["ai-tool", pressed && "is-on"],
      "aria-pressed": String(pressed),
      "aria-label": reaction === "like" ? "有帮助" : "没帮助",
      title: reaction === "like" ? "有帮助" : "没帮助",
    }, icon(reaction === "like" ? "thumbUp" : "thumbDown"));
    button.addEventListener("click", async () => {
      if (message._feedbackBusy || message.feedback === reaction) return;
      message._feedbackBusy = true;
      const previous = message.feedback;
      message.feedback = reaction;
      repaint(message);
      try {
        await state.conversation.sendFeedback(message, reaction);
        toast("感谢反馈，已记录", { type: "ok" });
      } catch (error) {
        message.feedback = previous;
        repaint(message);
        toast(error.message || "反馈没有记录成功", { type: "error" });
      } finally {
        message._feedbackBusy = false;
      }
    });
    return button;
  }

  function elapsedLabel(message) {
    const end = message.completedAt || Date.now();
    const text = elapsedText(end - message.startedAt);
    if (!message.startedAt || (!message.streaming && !message.completedAt)) return "";
    if (message.streaming) return message.body ? `已用 ${text}` : `已等 ${text}`;
    return message.completedAt ? `总用时 ${text}` : "";
  }

  function nodeFor(message) {
    return nodes.thread?.querySelector(`[data-msg="${message.id}"]`);
  }

  function repaint(message) {
    const node = nodeFor(message);
    if (node) paintAi(node, message);
  }

  /* ---------- 打字机：只更新当前这条回答 ---------- */
  function pump(message) {
    if (message._raf) return;
    let lastPaint = 0;
    const step = now => {
      message._raf = 0;
      const target = message.fullBody || "";
      if (!message.streaming) return;
      if (message.body.length < target.length) {
        const last = message._last || now;
        // 至少每秒约 50 字；积压越多打得越快，约一秒半追平，结束时不会整段突然跳出来。
        const perMs = Math.max(0.05, (target.length - message.body.length) / 1500);
        const chars = Math.max(1, Math.round(Math.min(250, now - last) * perMs));
        message._last = now;
        message.body = target.slice(0, message.body.length + chars);
        if (now - lastPaint > 60 || message.body.length >= target.length) {
          lastPaint = now;
          paintStreaming(message);
        }
        message._raf = requestAnimationFrame(step);
      } else {
        message._last = 0;
        paintStreaming(message);
      }
    };
    message._raf = requestAnimationFrame(step);
  }

  function paintStreaming(message) {
    const node = nodeFor(message);
    if (!node) return;
    const nearBottom = isNearBottom();
    const body = node.querySelector(".ai-body");
    if (!body) {
      paintAi(node, message);
    } else {
      const openDetails = body.querySelector("details.ai-reasoning")?.open;
      body.innerHTML = renderMarkdown(tidyStreaming(message.body));
      withCaret(body);
      if (openDetails) body.querySelector("details.ai-reasoning")?.setAttribute("open", "");
    }
    if (nearBottom) scrollToBottom(false);
    else syncJump();
  }

  function onMessageChange(message, change) {
    if (!ctx.isCurrent() || !nodes.thread) return;
    if (change === "new") {
      if (message.kind === "ai" && nodes.live) nodes.live.textContent = "正在解读，请稍候";
      if (nodes.thread.querySelector(".thread-empty")) nodes.thread.replaceChildren();
      nodes.thread.append(messageNode(message));
      scrollToBottom(true);
      syncComposer();
      return;
    }
    if (message.kind !== "ai") return;
    if (change === "text") {
      if (!message.fullBody) { repaint(message); return; }
      if (!nodeFor(message)?.querySelector(".ai-body")) repaint(message);
      pump(message);
      return;
    }
    if (change === "status") {
      notePublished(message);
      const wait = nodeFor(message)?.querySelector("[data-wait]");
      if (wait) wait.textContent = message.waitNote || waitingLine(message.stage, { liuyao: state.system === "liuyao", tick });
      else repaint(message);
      return;
    }
    // done / failed / stopped
    notePublished(message);
    if (change === "failed" && message.authLost && returnQuestion(message)) return;
    if (nodes.live) nodes.live.textContent = change === "done" ? "解读完成" : change === "failed" ? "这次解读没有完成" : "已停止生成";
    // 页面在后台时，在标签页标题上提示一次。
    if (change === "done") ctx.attention("解读完成");
    else if (change === "failed") ctx.attention("解读中断");
    if (message._raf) cancelAnimationFrame(message._raf);
    message._raf = 0;
    const nearBottom = isNearBottom();
    repaint(message);
    // 旧回答下的追问建议收起，只保留最新一条。
    state.conversation.messages.forEach(item => {
      if (item.kind === "ai" && item !== message && item.followups?.length) {
        item.followups = [];
        repaint(item);
      }
    });
    syncComposer();
    syncUrl();
    if (nearBottom) scrollToBottom(false);
    else syncJump();
    if (change === "done") {
      const node = nodeFor(message);
      if (node && (document.activeElement === document.body || nodes.composer.node.contains(document.activeElement))) {
        node.setAttribute("tabindex", "-1");
      }
    }
  }

  function onTick() {
    tick += 1;
    const conversation = state.conversation;
    if (!conversation || !nodes.thread) return;
    conversation.messages.forEach(message => {
      if (message.kind !== "ai" || !message.streaming) return;
      const node = nodeFor(message);
      if (!node) return;
      const elapsed = node.querySelector("[data-elapsed]");
      if (elapsed) elapsed.textContent = elapsedLabel(message);
      if (tick % 5 === 0 && !message.waitNote) {
        const wait = node.querySelector("[data-wait]");
        if (wait) wait.textContent = waitingLine(message.stage, { liuyao: state.system === "liuyao", tick });
      }
    });
  }

  function distanceFromBottom() {
    return document.documentElement.scrollHeight - window.scrollY - window.innerHeight;
  }

  // 在底部附近才跟随新内容；用户往上翻时不打扰，只亮出「回到最新」。
  function isNearBottom() {
    return distanceFromBottom() < 160;
  }

  // 生成中只要离开了底部就提示；平时翻得较远才出现，避免上下轻微滑动时来回闪。
  function syncJump() {
    if (!nodes.jump) return;
    nodes.jump.hidden = distanceFromBottom() < (state.conversation?.busy ? 160 : 360);
  }

  function scrollToBottom(smooth) {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: smooth && !reducedMotion() ? "smooth" : "auto" });
    if (nodes.jump) nodes.jump.hidden = true;
  }

  /* ---------- 输入框 ---------- */
  // 这段对话是否已在服务端落地（发出过问题）；落地前的草稿记在「新对话」名下。
  function conversationStarted() {
    return !!state.conversation?.messages.some(message => message.kind === "ai" && (message.taskId || message.messageId || message.stopped));
  }

  function buildComposer() {
    const liuyao = state.system === "liuyao";
    const currentDraftKey = () => readingDraftKey(id, state.conversation?.sessionId, { started: conversationStarted() });
    const placeholder = liuyao ? "就此卦追问：应期？对方心思？" : "问：今年适合换工作吗？";
    const textarea = h("textarea", {
      class: "rd-input",
      rows: 1,
      maxlength: 2000,
      placeholder,
      "aria-label": "输入问题",
    });
    textarea.value = local.get(currentDraftKey(), "");
    textarea.addEventListener("input", () => {
      if (textarea.value.trim()) local.set(currentDraftKey(), textarea.value);
      else local.remove(currentDraftKey());
    });
    const fit = autoGrow(textarea, 180);
    const send = h("button", { type: "submit", class: "rd-send", "aria-label": "发送" }, icon("send"));
    const ackSlot = h("div", { class: "rd-ack" });
    const topics = !liuyao ? h("button", { type: "button", class: "rd-topic", "aria-label": "换个方向", onClick: event => openTopics(event.currentTarget) }, icon("compass", "icon-sm"), h("span", null, "换个方向")) : null;
    const form = h("form", { class: "rd-composer" },
      ackSlot,
      h("div", { class: "rd-box" },
        topics,
        textarea,
        send));
    const sendDraft = () => {
      const text = textarea.value.trim();
      if (!text) { textarea.focus(); return; }
      ask(text, {
        // 一受理就清空：生成过程中接着写的下一句不会被冲掉。手机上收起键盘，留出位置看回答。
        onAccepted: () => {
          if (textarea.value.trim() === text) {
            textarea.value = "";
            clearDrafts();
            fit();
          }
          if (coarsePointer()) textarea.blur();
        },
      });
    };
    form.addEventListener("submit", event => {
      event.preventDefault();
      // 生成中这个按钮是「停止」。
      if (state.conversation?.busy) {
        state.conversation.stop();
        return;
      }
      sendDraft();
    });
    // 回车发送、Shift+回车换行，手机键盘的回车键显示「发送」；输入法选词时的回车不会发送。
    submitOnEnter(textarea, () => {
      // 生成中可以先写下一句，但回车不会打断正在进行的解读。
      if (state.conversation?.busy) { toast("这条解读完成后再发送；想中止请点「停止」"); return; }
      sendDraft();
    });
    // 发出后清掉这份草稿：落地前记在「新对话」名下的那份也一并清除。
    function clearDrafts() {
      local.remove(readingDraftKey(id, state.conversation?.sessionId, { started: false }));
      local.remove(currentDraftKey());
    }
    return { node: form, textarea, send, ackSlot, fit, placeholder, clearDrafts, get draftKey() { return currentDraftKey(); } };
  }

  function openTopics(anchor) {
    const sheet = openSheet({
      title: "换个方向",
      body: h("div", { class: "starters is-sheet" }, BAZI_STARTERS.map(([label, question]) => h("button", {
        type: "button",
        class: "starter",
        onClick: () => { sheet.close(); fillComposer(question); },
      }, h("b", null, label), h("span", null, question)))),
    });
  }

  function syncComposer() {
    const composer = nodes.composer;
    if (!composer) return;
    const busy = !!state.conversation?.busy;
    // 生成中输入框不锁：可以先写下一个问题；发送键变成带字的「停止」。
    composer.textarea.placeholder = busy ? "解读进行中，可以先写下一个问题" : composer.placeholder;
    composer.send.classList.toggle("is-stop", busy);
    composer.send.setAttribute("aria-label", busy ? "停止生成" : "发送");
    composer.send.replaceChildren(...[icon(busy ? "stop" : "send", busy ? "icon-fill" : ""), busy && h("span", { class: "rd-send-label", "aria-hidden": "true" }, "停止")].filter(Boolean));
    const needsAck = !riskAccepted() && state.conversation?.messages.length;
    composer.ackSlot.replaceChildren(...(needsAck ? [riskAckControl(syncComposer)] : []));
    // 解读进行中：「重新起卦」「新对话」不可用（先等完成或停止）。
    if (nodes.restart) {
      nodes.restart.disabled = busy;
      if (busy) nodes.restart.setAttribute("title", "解读进行中，完成或停止后可用");
      else nodes.restart.removeAttribute("title");
    }
  }

  function fillComposer(text) {
    const composer = nodes.composer;
    composer.textarea.value = text;
    local.set(composer.draftKey, text);
    composer.fit();
    composer.textarea.focus();
    composer.textarea.setSelectionRange(text.length, text.length);
  }

  // 点选追问建议：填入输入框并闪一下提示位置；原来写了别的内容时可以撤销替换。
  function useFollowup(text) {
    const composer = nodes.composer;
    if (!composer) return;
    const previous = composer.textarea.value;
    fillComposer(text);
    const box = composer.node.querySelector(".rd-box");
    if (box && !reducedMotion()) {
      box.classList.remove("is-filled");
      void box.offsetWidth;
      box.classList.add("is-filled");
      setTimeout(() => box.classList.remove("is-filled"), 800);
    }
    if (previous.trim() && previous.trim() !== text) {
      toast("已替换输入框里原来的内容", { action: { label: "撤销", onClick: () => fillComposer(previous) } });
    }
  }

  // 改地址但不新增历史记录。面板（登录、看盘等）打开时占着一条历史记录，关面板会后退掉它；这时改地址会被
  // 那次后退撤销并触发整页重载，所以等面板关掉、回到页面自己的那条记录后再改（期间只保留最后一次要改的地址）。
  let pendingUrl = "";
  function replaceUrl(target) {
    if (history.state?.xzOverlay) {
      const waiting = !!pendingUrl;
      pendingUrl = target;
      if (waiting) return;
      const later = () => {
        window.removeEventListener("popstate", later);
        setTimeout(() => {
          const next = pendingUrl;
          pendingUrl = "";
          if (ctx.isCurrent() && next) replaceUrl(next);
        }, 0);
      };
      window.addEventListener("popstate", later);
      ctx.cleanup(() => window.removeEventListener("popstate", later));
      return;
    }
    if (location.hash !== target) history.replaceState(history.state, "", target);
  }

  // 地址记下当前对话，刷新后接着这段对话。服务端还没有这段对话的任何回答（例如登录失效、请求没发出去）时不改。
  function syncUrl() {
    const sid = state.conversation?.sessionId;
    if (!isSessionId(sid) || !state.conversation.messages.some(message => message.kind === "ai" && (message.taskId || message.messageId || message.stopped))) return;
    replaceUrl(`#/reading/${encodeURIComponent(id)}?session=${sid}`);
  }

  /* ---------- 发起前检查 ---------- */
  async function preflight() {
    if (state.conversation?.busy) {
      toast("请先等待当前解读完成");
      return false;
    }
    if (navigator.onLine === false) {
      toast("网络已断开，恢复后再发送；问题会留在输入框里", { type: "error" });
      return false;
    }
    if (state.system === "liuyao" && state.input?.visibility && state.input.visibility !== "private"
      && (!state.input.public_consent || state.input.public_consent_version !== "liuyao-public-v2")) {
      toast("这份旧卦没有公开授权，请重新起卦", { type: "error" });
      return false;
    }
    if (!riskAccepted()) {
      toast("请先勾选参考声明");
      (nodes.thread.querySelector("[data-risk-ack]") || nodes.composer.ackSlot.querySelector("input"))?.focus();
      return false;
    }
    const quota = session.get().quota;
    if (quota && quota.can_start_answer === false) {
      creditsExhausted();
      return false;
    }
    if (!session.get().authenticated) {
      // 解读前的登录默认停在「注册」。
      const ok = await ctx.requireAuth(state.system === "liuyao" && state.visibility === "private" ? "私人问题，登录后继续解读。" : "登录后使用每日免费积分解读。", { mode: "register" });
      if (!ok) return false;
      const again = session.get().quota;
      if (again && again.can_start_answer === false) {
        creditsExhausted();
        return false;
      }
    }
    return true;
  }

  // 积分用完：「去充值」直接打开积分页的充值档位。
  function creditsExhausted() {
    toast("今日免费积分与充值积分已用完；明日刷新，或充值后继续", { type: "error", action: { label: "去充值", onClick: () => ctx.navigate("/me/credits?topup=1") } });
  }

  async function ask(text, { onAccepted, ...options } = {}) {
    if (!(await preflight())) return false;
    onAccepted?.();
    await begin(text, options);
    return true;
  }

  async function begin(text, options = {}) {
    const branch = state.pendingBranch;
    state.pendingBranch = null;
    await state.conversation.ask(text, { ...options, branch });
    syncUrl();
  }

  async function startFirst() {
    if (state.conversation.messages.length) return;
    if (!(await preflight())) return;
    const question = state.question || LIUYAO_DEFAULT_QUESTION;
    // 输入框里放着的正是这一问（登录失效时退回的）：开始解读后就不再留着。
    const composer = nodes.composer;
    if (composer && composer.textarea.value.trim() === question) {
      composer.textarea.value = "";
      local.remove(composer.draftKey);
      composer.fit();
    }
    await state.conversation.ask(question, { showQuestion: false });
    syncUrl();
  }

  // 先过检查再移除失败的这一轮：断网或额度不足时，失败记录和问题都还在。
  async function retry(message) {
    if (!(await preflight())) return;
    const question = message.question;
    state.conversation.removePair(message);
    renderThread();
    await begin(question);
  }

  // 发起时登录失效、又关掉了登录：这一问没有发出去。撤下这一轮，把问题放回输入框（分叉信息一并保留）；
  // 输入框里已经写了别的内容时不覆盖，保留失败记录，问题仍可用「编辑问题」取回。
  function returnQuestion(message) {
    const composer = nodes.composer;
    const text = String(message.question || "");
    const draft = composer?.textarea.value.trim() || "";
    if (!composer || !text || (draft && draft !== text)) return false;
    state.conversation.removePair(message);
    if (message.branch) state.pendingBranch = message.branch;
    renderThread();
    composer.textarea.value = text;
    local.set(composer.draftKey, text);
    composer.fit();
    syncComposer();
    toast("登录已失效，问题已保留。", {
      type: "error",
      action: { label: "登录", onClick: () => ctx.requireAuth("问题已保留在输入框，登录后点发送继续。", { force: true }) },
    });
    return true;
  }

  function editQuestion(message) {
    state.conversation.removePair(message);
    renderThread();
    fillComposer(message.question || "");
    toast("问题已放回输入框");
  }

  function editStopped(message) {
    state.pendingBranch = { fromTaskId: message.taskId, fromClientRequestId: message.clientRequestId, reason: "edit_after_cancel" };
    state.conversation.removePair(message);
    renderThread();
    fillComposer(message.question || "");
    toast("已回到停止点，可编辑后重发");
  }

  // 新页面打开后会提示「已用这份八字开启新对话」。
  function newConversation() {
    if (state.conversation?.busy) { toast("请先等待当前解读完成"); return; }
    ctx.navigate(`/reading/${encodeURIComponent(id)}?fresh=1`, { replace: true });
  }

  async function openConversations() {
    const list = h("div", { class: "conv-list" }, h("div", { class: "spinner-line" }, h("span", { class: "spinner" }), "正在读取对话记录…"));
    const sheet = openSheet({
      title: "对话记录",
      body: list,
      footer: [h("button", { type: "button", class: "btn btn-primary", onClick: () => { sheet.close(); newConversation(); } }, icon("plus"), "开启新对话")],
    });
    try {
      const items = await get(`/api/profiles/${encodeURIComponent(state.profileId)}/conversations`, { cache: "no-store" });
      const rows = Array.isArray(items) ? items : (items?.items || []);
      if (!rows.length) {
        list.replaceChildren(h("p", { class: "muted" }, "暂无对话，开始首次解读。"));
        return;
      }
      list.replaceChildren(...rows.map((item, index) => h("a", {
        class: ["conv-item", item.session_id === state.conversation.sessionId && "is-current"],
        href: `#/reading/${encodeURIComponent(state.profileId)}?session=${encodeURIComponent(item.session_id)}`,
        onClick: () => sheet.close(),
      },
      h("span", { class: "conv-top" },
        h("b", null, item.first_question || item.last_question || "本命解读"),
        h("span", { class: "chip" }, item.status === "pending" || item.status === "running" ? "正在解读" : item.status === "failed" ? "上次未完成" : item.status === "cancelled" ? "已停止" : (index === 0 ? "最近对话" : "可继续"))),
      item.last_question && item.last_question !== item.first_question ? h("span", { class: "conv-sub" }, `最近追问：${item.last_question}`) : null,
      item.last_answer ? h("span", { class: "conv-preview" }, plainExcerpt(item.last_answer, 110)) : null,
      h("span", { class: "conv-meta" }, `${item.turn_count || 0} 个问题 · ${item.message_count || 0} 条消息 · ${relativeTime(item.updated_at)}`))));
    } catch (error) {
      list.replaceChildren(errorView(error, () => { sheet.close(); openConversations(); }));
    }
  }

  function openHelp() {
    const liuyao = state.system === "liuyao";
    if (!state.profileId) { toast("请先完成排盘或起卦，再向社区求助"); return; }
    const question = h("textarea", { class: "textarea", minlength: 8, maxlength: 2000, required: true, rows: 4 });
    question.value = liuyao ? (state.question || "") : "请大家帮我看看这个命盘，重点想了解：";
    if (liuyao) question.readOnly = true;
    const consent = h("input", { type: "checkbox", required: true });
    const status = h("p", { class: "help-status", role: "status" });
    const submit = h("button", { type: "button", class: "btn btn-primary" }, icon("hand"), "发布求助");
    const sheet = openSheet({
      title: "向社区求助",
      body: h("div", { class: "help-form" },
        h("p", { class: "help-lead" }, h("span", { class: "chip chip-help" }, "不走 AI · 不扣积分"), liuyao
          ? "将公开当前卦象、所问和社区昵称；邮箱不会展示。求助内容需与起卦时所问一致。"
          : "将公开四柱、日主、五行数量和社区昵称；出生日期、时刻、地点与邮箱不会展示。"),
        h("label", { class: "field" }, h("span", { class: "field-label" }, "希望大家帮你看什么"), question, h("span", { class: "field-hint" }, "8–2000 字")),
        h("label", { class: "check" }, consent, h("span", null, "我确认内容不含姓名、电话、邮箱、住址或证件号，并同意将脱敏盘面和问题公开到社区。")),
        status),
      footer: [h("button", { type: "button", class: "btn btn-ghost", onClick: () => sheet.close() }, "取消"), submit],
    });
    submit.addEventListener("click", async () => {
      const text = question.value.trim();
      if (text.length < 8) { status.textContent = "请至少写 8 个字，说清楚想请大家看什么。"; question.focus(); return; }
      if (!consent.checked) { status.textContent = "请先勾选隐私确认。"; consent.focus(); return; }
      const ok = await ctx.requireAuth("登录并验证邮箱后可免费求助，不调用 AI，不扣积分。", { mode: "register" });
      if (!ok) return;
      submit.disabled = true;
      submit.textContent = "正在发布…";
      status.textContent = "正在检查隐私并生成公开帖子…";
      try {
        const result = await post("/api/community/help-posts", { profile_id: Number(state.profileId), question: text, consent_version: "community-help-v1" }, { interaction: true });
        sheet.close();
        toast(result?.already_exists ? "这条求助已经发布过了" : "求助已发布，卦友回答后会提醒你", { type: "ok" });
        if (result?.post?.slug) ctx.navigate(`/post/${encodeURIComponent(result.post.slug)}`);
      } catch (error) {
        status.textContent = humanizeError(error.message, "求助发布失败，请稍后再试");
        submit.disabled = false;
        submit.replaceChildren(icon("hand"), "发布求助");
      }
    });
  }

  load();
  return { node: root, title: "解读", layout: "reading" };
}
