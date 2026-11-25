// 我的：个人主页、我的盘（档案）与设置。
import { h } from "../lib/dom.js?v=n47";
import { icon } from "../lib/icons.js?v=n47";
import { get, put, patch, del, query } from "../lib/api.js?v=n47";
import { session, inbox, applyAccount, refreshSession } from "../lib/store.js?v=n47";
import { relativeTime, fullTime, shortDate, money, plainExcerpt } from "../lib/format.js?v=n47";
import { stateView, spinnerLine } from "../ui/bits.js?v=n47";
import { pillarsToken } from "../ui/gua.js?v=n47";
import { openSheet, confirmDialog, openMenu } from "../ui/overlay.js?v=n47";
import { toast } from "../ui/toast.js?v=n47";
import { copyText } from "../lib/share.js?v=n47";
import { openFeedback } from "./feedback.js?v=n47";
import { removePost } from "./feed.js?v=n47";

const TABS = [
  { key: "", label: "主页", href: "#/me", glyph: "user", title: "我的" },
  { key: "archives", label: "我的盘", href: "#/me/archives", glyph: "layers", title: "我的盘" },
  { key: "settings", label: "设置", href: "#/me/settings", glyph: "sliders", title: "设置" },
];
const MAIL = "luoluoluoxiaxia@gmail.com";
const DISCLAIMER = "AI 解读仅供传统文化研究与娱乐参考，不替代医疗、法律、投资等专业意见。";

let uidSeed = 0;
const uid = prefix => `${prefix}-${(uidSeed += 1).toString(36)}`;
const number = value => (Number(value) || 0).toLocaleString("zh-CN");

// 按钮进入「处理中」：不用 disabled（焦点会丢到页面顶端），用 aria-busy 并忽略重复点击。
function setBusy(button, text) {
  if (!button || button.getAttribute("aria-busy") === "true") return false;
  button.setAttribute("aria-busy", "true");
  button.classList.add("is-busy");
  button.replaceChildren(h("span", { class: "spinner", "aria-hidden": "true" }), text);
  return true;
}

function setIdle(button, ...content) {
  if (!button) return;
  button.removeAttribute("aria-busy");
  button.classList.remove("is-busy");
  button.replaceChildren(...content);
}

/* ==========================================================================
   通用
   ========================================================================== */
function maskEmail(email) {
  const text = String(email || "").trim();
  const at = text.lastIndexOf("@");
  if (at < 1) return text;
  const chars = Array.from(text.slice(0, at));
  const head = chars.slice(0, chars.length > 4 ? 2 : 1).join("");
  const tail = chars.length > 4 ? chars[chars.length - 1] : "";
  return `${head}***${tail}${text.slice(at)}`;
}

// 带时区的时间换算成北京时间；不带时区的字符串按原样截取。
function stamp(value) {
  const text = String(value || "").trim();
  if (!text) return "时间未记录";
  if (/(?:Z|[+-]\d\d:?\d\d)$/i.test(text)) {
    const formatted = fullTime(text);
    if (formatted) return formatted;
  }
  return text.replace("T", " ").replace(/Z$/i, "").slice(0, 16);
}

function tabStrip(active) {
  return h("nav", { class: "me-tabs", "aria-label": "我的" },
    TABS.map(tab => h("a", {
      class: "me-tab",
      href: tab.href,
      "aria-current": tab.key === active ? "page" : null,
    }, icon(tab.glyph), h("span", null, tab.label))));
}

function pageHead({ title, sub = "", actions = null }) {
  return h("header", { class: "me-head" },
    h("div", { class: "me-head-copy" },
      h("h1", { class: "me-title" }, title),
      sub ? h("p", { class: "me-sub" }, sub) : null),
    actions ? h("div", { class: "me-head-actions" }, actions) : null);
}

function loginCard(ctx, { title, text, reason }) {
  return h("section", { class: "me-login" },
    h("h2", { class: "me-login-title" }, title),
    h("p", { class: "me-login-text" }, text),
    h("div", { class: "me-login-actions" },
      h("button", { type: "button", class: "btn btn-primary", onClick: () => ctx.openAuth({ reason, mode: "login_password" }) }, icon("user"), "登录"),
      h("button", { type: "button", class: "btn btn-soft", onClick: () => ctx.openAuth({ reason, mode: "register" }) }, "注册新账号")));
}

function retryState({ title, text, onRetry, label = "重新加载" }) {
  return stateView({
    tone: "error",
    title,
    text,
    actions: [h("button", { type: "button", class: "btn btn-soft", onClick: onRetry }, icon("refresh"), label)],
  });
}


async function confirmLogout(ctx) {
  const ok = await confirmDialog({
    title: "退出登录？",
    message: "退出后，需要重新登录才能查看我的盘与消息。",
    confirmText: "退出登录",
    danger: true,
  });
  if (ok) ctx.logout();
}

/* ---------- 社区昵称 ---------- */
function nicknameEditor(ctx, { variant = "row" } = {}) {
  const id = uid("me-nick");
  const hero = variant === "hero";
  const HINT = "2–20 个字符，留空改为匿名昵称";
  const nameNode = h(hero ? "h1" : "b", { class: hero ? "me-name" : "me-nick-name" });
  const hint = h("span", { class: "me-nick-hint" });
  const editButton = hero
    ? h("button", { type: "button", class: "icon-btn me-nick-edit", "aria-label": "编辑社区昵称", "aria-expanded": "false", "aria-controls": `${id}-form` }, icon("edit"))
    : h("button", { type: "button", class: "btn btn-sm", "aria-expanded": "false", "aria-controls": `${id}-form` }, icon("edit"), "编辑");
  const input = h("input", {
    class: "input",
    id: `${id}-input`,
    name: "nickname",
    maxlength: 20,
    autocomplete: "nickname",
    enterkeyhint: "done",
    placeholder: "输入昵称",
    "aria-describedby": `${id}-status`,
  });
  const save = h("button", { type: "submit", class: "btn btn-primary" }, "保存");
  const cancel = h("button", { type: "button", class: "btn btn-ghost" }, "取消");
  const status = h("p", { class: "me-nick-status", id: `${id}-status`, role: "status" });
  const view = hero
    ? h("div", { class: "me-nick-view is-hero" }, nameNode, editButton)
    : h("div", { class: "me-nick-view" },
      h("div", { class: "me-nick-copy" }, h("span", { class: "me-nick-label" }, "社区昵称"), nameNode, hint),
      editButton);
  const form = h("form", { class: ["me-nick-form", hero && "is-hero"], id: `${id}-form`, hidden: true, novalidate: true },
    h("label", { class: hero ? "sr-only" : "field-label", for: `${id}-input` }, "社区昵称"),
    h("div", { class: "me-nick-row" }, input, h("div", { class: "me-nick-buttons" }, save, cancel)),
    status);
  const node = h("div", { class: ["me-nick", `is-${variant}`] }, view, form);
  let editing = false;
  let saving = false;
  const currentNickname = () => String(session.get().user?.nickname || "").trim();

  function update() {
    if (editing) return;
    const nickname = currentNickname();
    nameNode.textContent = nickname || (hero ? "未设置昵称" : "匿名昵称");
    nameNode.classList.toggle("is-anon", !nickname);
    hint.textContent = nickname ? "发帖和回复时显示" : "未设置时，社区里显示匿名编号";
  }
  function setStatus(text, tone = "") {
    status.textContent = text;
    status.dataset.tone = tone;
    if (tone === "error") input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
  }
  function enter() {
    editing = true;
    input.value = currentNickname();
    setStatus(HINT);
    view.hidden = true;
    form.hidden = false;
    editButton.setAttribute("aria-expanded", "true");
    requestAnimationFrame(() => {
      input.focus({ preventScroll: true });
      input.select();
    });
  }
  function leave({ focus = true } = {}) {
    editing = false;
    form.hidden = true;
    view.hidden = false;
    editButton.setAttribute("aria-expanded", "false");
    update();
    if (focus) requestAnimationFrame(() => editButton.focus({ preventScroll: true }));
  }
  editButton.addEventListener("click", enter);
  cancel.addEventListener("click", () => leave());
  form.addEventListener("keydown", event => {
    if (event.key !== "Escape" || saving) return;
    event.preventDefault();
    event.stopPropagation();
    leave();
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (saving) return;
    const nickname = input.value.trim();
    const length = Array.from(nickname).length;
    if (length === 1 || length > 20) {
      setStatus("昵称需要 2–20 个字符；留空则改为匿名昵称。", "error");
      input.focus();
      return;
    }
    if (nickname === currentNickname()) {
      leave();
      return;
    }
    saving = true;
    setBusy(save, "保存中…");
    cancel.disabled = true;
    setStatus("");
    try {
      const payload = await put("/api/account/profile", { nickname });
      applyAccount(payload);
      const saved = currentNickname();
      toast(saved ? "昵称已保存" : "已恢复匿名昵称", { type: "ok" });
      saving = false;
      if (ctx.isCurrent()) leave();
    } catch (error) {
      if (error?.status === 401) refreshSession().catch(() => {});
      setStatus(error?.message || "昵称保存失败", "error");
      // 保存失败：焦点回到输入框并选中，直接改就行。
      input.focus();
      input.select();
    } finally {
      saving = false;
      setIdle(save, "保存");
      cancel.disabled = false;
    }
  });
  update();
  return { node, update };
}

/* ==========================================================================
   主页（概览）
   ========================================================================== */
function profileCard(ctx) {
  const nick = nicknameEditor(ctx, { variant: "hero" });
  const email = h("span", { class: "me-email" });
  const since = h("span", { class: "me-since" });
  const stats = h("div", { class: "me-stats" });
  const note = h("p", { class: "me-active-note", hidden: true });
  const node = h("section", { class: "me-profile", "aria-label": "个人资料" },
    h("div", { class: "me-profile-top" },
      h("div", { class: "me-profile-id" }, nick.node, h("p", { class: "me-profile-meta" }, email, since))),
    stats,
    note);
  const stat = (label, value, href) => h("a", { class: "me-stat", href },
    h("b", { class: "tnum" }, value === undefined || value === null ? "—" : number(value)),
    h("span", null, label));
  function update(state) {
    const user = state.user || {};
    nick.update();
    email.textContent = maskEmail(user.email);
    since.textContent = user.created_at ? `${shortDate(user.created_at)}加入` : "";
    since.hidden = !user.created_at;
    const archive = state.archive || null;
    stats.replaceChildren(
      stat("命盘", archive?.bazi, "#/me/archives?tab=bazi"),
      stat("卦盘", archive?.liuyao, "#/me/archives?tab=liuyao"),
      stat("解读", archive?.history_count, "#/me/archives"));
    const active = Number(archive?.active) || 0;
    note.hidden = !active;
    note.replaceChildren(h("span", { class: "me-pulse", "aria-hidden": "true" }), `${active} 张盘正在生成解读`);
  }
  return { node, update };
}

function inboxLink(ctx) {
  const meta = h("span", { class: "me-link-meta" });
  const link = h("a", { class: "me-link", href: "#/inbox" },
    h("span", { class: "me-link-copy" }, h("b", null, "消息"), h("span", null, "点赞、评论与采纳")),
    meta,
    h("span", { class: "me-link-go", "aria-hidden": "true" }, icon("chevronRight")));
  const paint = ({ unread }) => {
    const n = Number(unread) || 0;
    meta.replaceChildren(n ? h("span", { class: "badge me-link-badge", "aria-hidden": "true" }, n > 99 ? "99+" : String(n)) : "");
    link.setAttribute("aria-label", n ? `消息，${n} 条未读` : "消息");
  };
  paint(inbox.get());
  ctx.subscribe(inbox, paint);
  return link;
}

function linksCard(ctx, authenticated) {
  const feedback = h("button", { class: "me-link", type: "button" },
    h("span", { class: "me-link-copy" }, h("b", null, "意见反馈"), h("span", null, "断得准不准，直说无妨")),
    h("span", { class: "me-link-go", "aria-hidden": "true" }, icon("chevronRight")));
  feedback.addEventListener("click", () => openFeedback());
  const roadmap = h("a", { class: "me-link", href: "#/roadmap" },
    h("span", { class: "me-link-copy" }, h("b", null, "路线图"), h("span", null, "古书、案例与工具，接下来怎样串起来")),
    h("span", { class: "me-link-go", "aria-hidden": "true" }, icon("chevronRight")));
  return h("div", { class: "me-links" }, authenticated ? inboxLink(ctx) : null, roadmap, feedback);
}

function overviewSkeleton() {
  return h("div", { class: "me-overview", "aria-hidden": "true" },
    h("div", { class: "me-col" },
      h("section", { class: "me-profile is-skeleton" },
        h("div", { class: "me-profile-top" },
          h("div", { class: "me-profile-id" },
            h("span", { class: "skel skel-title", style: { width: "140px", height: "26px" } }),
            h("span", { class: "skel skel-line", style: { width: "200px", marginTop: "12px" } }))),
        h("span", { class: "skel", style: { height: "64px", borderRadius: "14px" } }))),
    h("div", { class: "me-col" },
      h("section", { class: "me-links is-skeleton" },
        h("span", { class: "skel", style: { height: "48px", borderRadius: "12px" } }))));
}

function overviewView(ctx, body) {
  let lastKey = null;
  let profile = null;
  function paint() {
    const state = session.get();
    const key = !state.ready ? "loading" : state.authenticated ? `user:${state.user?.id || ""}` : "anon";
    if (key !== lastKey) {
      lastKey = key;
      profile = null;
      if (key === "loading") {
        body.replaceChildren(overviewSkeleton());
        return;
      }
      if (key === "anon") {
        body.replaceChildren(
          pageHead({ title: "我的" }),
          h("div", { class: "me-overview" },
            h("div", { class: "me-col" },
              loginCard(ctx, {
                title: "登录后查看你的主页",
                text: "命盘、卦盘与消息都在这里，只对你本人可见。",
                reason: "登录后查看你的命盘、卦盘与消息。",
              })),
            h("div", { class: "me-col" }, linksCard(ctx, false), overviewFoot(ctx, false))));
        return;
      }
      profile = profileCard(ctx);
      body.replaceChildren(h("div", { class: "me-overview" },
        h("div", { class: "me-col" }, profile.node),
        h("div", { class: "me-col" }, linksCard(ctx, true), overviewFoot(ctx, true))));
    }
    if (state.authenticated) profile?.update(state);
  }
  paint();
  ctx.subscribe(session, paint);
  // 已在顶部时再点一次底栏「我」：重新读取个人资料与档案数。
  let refreshing = false;
  ctx.onRefresh(async () => {
    if (refreshing || !session.get().authenticated) return;
    refreshing = true;
    const visible = () => { const s = session.get(); return JSON.stringify([s.archive, s.user?.nickname]); };
    const before = visible();
    body.classList.add("is-refreshing");
    try {
      await refreshSession();
      if (ctx.isCurrent()) toast(visible() === before ? "已是最新" : "已更新", { type: "ok" });
    } catch (error) {
      if (ctx.isCurrent()) toast(error?.message || "刷新失败，请稍后再试", { type: "error" });
    } finally {
      refreshing = false;
      body.classList.remove("is-refreshing");
    }
  });
}

function overviewFoot(ctx, authenticated) {
  return h("footer", { class: "me-foot" },
    h("p", { class: "me-disclaimer" }, icon("info", "icon-sm"), h("span", null, DISCLAIMER)),
    authenticated ? h("button", { type: "button", class: "btn btn-ghost btn-sm me-logout", onClick: () => confirmLogout(ctx) }, icon("logout"), "退出登录") : null);
}

/* ==========================================================================
   我的盘（档案）
   ========================================================================== */
const TASK_STATE = {
  pending: { label: "解读进行中", tone: "active" },
  running: { label: "解读进行中", tone: "active" },
  failed: { label: "上次解读未完成", tone: "failed" },
  cancelled: { label: "上次解读已停止", tone: "stopped" },
};
const CONVERSATION_STATE = {
  pending: { label: "正在解读", tone: "active" },
  running: { label: "正在解读", tone: "active" },
  failed: { label: "上次未完成", tone: "failed" },
  cancelled: { label: "已停止", tone: "stopped" },
};
const SESSION_PATTERN = /^s_[0-9a-f]{16}$/;
const NAME_MAX = 30;

// 离开再回来（例如从解读页返回）时停留在上次的标签。
let archiveTab = "bazi";
// 上次读到的档案列表（只在内存里，按账户区分）：从解读页返回时先秒开并回到原位置，再静默刷新。
let archiveCache = null;
const ARCHIVE_TTL = 10 * 60 * 1000;
if (typeof document !== "undefined") document.addEventListener("xz:authchange", () => { archiveCache = null; });

const systemOf = profile => ((profile?.system || profile?.summary?.system) === "liuyao" ? "liuyao" : "bazi");

function guaLine(summary) {
  const ben = String(summary?.ben_gua?.name || "").trim();
  const bian = String(summary?.bian_gua?.name || "").trim();
  if (!ben) return null;
  const changed = bian && bian !== ben;
  return h("div", { class: "arc-gua" },
    icon("gua", "icon-sm"),
    h("b", null, ben),
    changed ? h("span", { class: "arc-gua-arrow", "aria-hidden": "true" }, "→") : null,
    changed ? h("span", { class: "sr-only" }, "变为") : null,
    changed ? h("b", null, bian) : null);
}

function answerPreview(value, limit = 150) {
  return plainExcerpt(String(value || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[>*_`~|]+/g, " "), limit);
}

function archiveSkeleton() {
  return h("div", { class: "arc-grid", "aria-hidden": "true" },
    [0, 1, 2, 3].map(() => h("article", { class: "arc-card is-skeleton" },
      h("span", { class: "skel skel-title", style: { width: "40%" } }),
      h("span", { class: "skel", style: { height: "44px", width: "62%", borderRadius: "12px" } }),
      h("span", { class: "skel skel-line", style: { width: "48%" } }),
      h("div", { class: "arc-actions" }, h("span", { class: "skel", style: { width: "96px", height: "32px", borderRadius: "999px" } }), h("span", { class: "skel", style: { width: "84px", height: "32px", borderRadius: "999px" } })))));
}

function openConversations(ctx, profile) {
  const name = String(profile.name || "").trim() || "未命名命盘";
  const pillars = profile.summary && typeof profile.summary === "object" ? profile.summary.pillars : null;
  const content = h("div", { class: "arc-conv" });
  const sheet = openSheet({ title: "对话记录", body: content, wide: true, className: "sheet-conv" });
  const base = `/reading/${encodeURIComponent(profile.id)}`;

  const conversationCard = (item, index) => {
    const state = CONVERSATION_STATE[item?.status] || { label: "可继续", tone: "done" };
    const title = String(item?.first_question || item?.last_question || "").trim() || "本命解读";
    const last = String(item?.last_question || "").trim();
    const preview = answerPreview(item?.last_answer);
    const sessionId = String(item?.session_id || "");
    const valid = SESSION_PATTERN.test(sessionId);
    return h("article", { class: ["arc-conv-card", index === 0 && "is-latest"] },
      h("header", { class: "arc-conv-card-head" },
        h("span", { class: ["chip", index === 0 ? "chip-liuyao" : ""] }, index === 0 ? "最近对话" : "历史对话"),
        h("span", { class: ["chip", "arc-task", `is-${state.tone}`] }, state.tone === "active" ? h("span", { class: "arc-pulse", "aria-hidden": "true" }) : null, state.label),
        item?.updated_at ? h("time", { datetime: item.updated_at, title: fullTime(item.updated_at) }, relativeTime(item.updated_at)) : null),
      h("h4", { class: "arc-conv-title" }, title),
      last && last !== title ? h("p", { class: "arc-conv-last" }, h("span", null, "最近追问："), last) : null,
      preview ? h("p", { class: "arc-conv-preview" }, preview) : null,
      h("footer", { class: "arc-conv-foot" },
        h("span", { class: "tnum" }, `${Number(item?.turn_count) || 0} 个问题 · ${Number(item?.message_count) || 0} 条消息`),
        valid
          ? h("a", { class: ["btn", "btn-sm", index === 0 && "btn-primary"], href: `#${base}?session=${encodeURIComponent(sessionId)}` }, "查看并继续", icon("arrowRight"))
          : h("span", { class: "arc-conv-invalid" }, "暂时无法恢复")));
  };

  const paint = list => {
    const latest = list.find(item => SESSION_PATTERN.test(String(item?.session_id || ""))) || null;
    content.replaceChildren(
      h("section", { class: "arc-conv-hero" },
        h("div", { class: "arc-badges" },
          h("span", { class: "chip chip-bazi" }, icon("pillars"), "八字命盘"),
          profile.is_default ? h("span", { class: "chip chip-gold" }, icon("sun"), "默认命盘") : null),
        h("h3", { class: "arc-conv-name" }, name),
        pillars ? pillarsToken({ pillars }) : null,
        h("div", { class: "arc-conv-actions" },
          latest ? h("a", { class: "btn btn-primary", href: `#${base}?session=${encodeURIComponent(latest.session_id)}` }, icon("reply"), "恢复上次对话") : null,
          h("a", { class: ["btn", !latest && "btn-primary"], href: `#${base}?fresh=1` }, icon("plus"), "开启新对话")),
        h("p", { class: "arc-conv-note" }, "新对话会沿用这份命盘，但不会带入旧对话内容。")),
      h("div", { class: "arc-conv-head" },
        h("div", null, h("b", null, "对话历史"), h("span", null, "按完整会话整理")),
        h("em", { class: "tnum" }, `${list.length} 次对话`)),
      list.length
        ? h("div", { class: "arc-conv-list" }, list.map(conversationCard))
        : h("div", { class: "arc-conv-empty" }, icon("comment"), h("p", null, "暂无对话，开始首次解读。")));
  };

  const load = async () => {
    content.replaceChildren(spinnerLine("正在整理这张命盘…"));
    try {
      const list = await get(`/api/profiles/${encodeURIComponent(profile.id)}/conversations`, { cache: "no-store" });
      if (!content.isConnected || !ctx.isCurrent()) return;
      paint(Array.isArray(list) ? list : []);
    } catch (error) {
      if (!content.isConnected || !ctx.isCurrent()) return;
      if (error?.status === 401) refreshSession().catch(() => {});
      content.replaceChildren(retryState({
        title: "我的盘加载失败，对话记录不受影响。",
        text: error?.message || "",
        onRetry: load,
      }));
    }
  };
  load();
  return sheet;
}

function archivesView(ctx, body) {
  const requested = ctx.query.get("tab");
  if (requested === "bazi" || requested === "liuyao") archiveTab = requested;
  const state = { profiles: null, requestId: 0, failed: false };
  const head = pageHead({ title: "我的盘", sub: "八字命盘与六爻卦盘都自动保存在这里，只对你本人可见。" });
  const tabsNode = h("div", { class: "seg arc-tabs", role: "tablist", "aria-label": "盘的类型" });
  const createSlot = h("div", { class: "arc-create" });
  const listNode = h("div", { class: "arc-list", id: "arc-panel", role: "tabpanel", "aria-live": "polite" });
  const toolbar = h("div", { class: "arc-toolbar" }, tabsNode, createSlot);
  let lastKey = null;

  const counts = () => {
    const list = state.profiles || [];
    const bazi = list.filter(profile => systemOf(profile) === "bazi").length;
    return { bazi, liuyao: list.length - bazi };
  };

  function syncUrl() {
    if (!ctx.isCurrent()) return;
    try {
      history.replaceState(history.state, "", `${location.pathname}${location.search}#/me/archives${archiveTab === "liuyao" ? "?tab=liuyao" : ""}`);
    } catch (_) {}
  }

  function setTab(key) {
    if (archiveTab === key) return;
    archiveTab = key;
    syncUrl();
    paintTabs();
    paintList();
  }

  function paintTabs() {
    const hadFocus = tabsNode.contains(document.activeElement);
    const total = state.profiles ? counts() : null;
    tabsNode.replaceChildren(...[["bazi", "八字", "pillars"], ["liuyao", "六爻", "gua"]].map(([key, label, glyph]) => h("button", {
      type: "button",
      role: "tab",
      id: `arc-tab-${key}`,
      "aria-controls": "arc-panel",
      "aria-selected": String(archiveTab === key),
      tabindex: archiveTab === key ? "0" : "-1",
      "data-tab": key,
      onClick: () => setTab(key),
    }, icon(glyph, "icon-sm"), h("span", null, label), total ? h("span", { class: "arc-tab-count tnum" }, String(total[key])) : null)));
    listNode.setAttribute("aria-labelledby", `arc-tab-${archiveTab}`);
    if (hadFocus) tabsNode.querySelector(`[data-tab="${archiveTab}"]`)?.focus({ preventScroll: true });
    createSlot.replaceChildren(archiveTab === "bazi"
      ? h("a", { class: "btn btn-soft btn-sm", href: "#/ask/bazi" }, icon("plus"), "新排八字")
      : h("a", { class: "btn btn-soft btn-sm", href: "#/ask/liuyao" }, icon("plus"), "新起一卦"));
  }

  tabsNode.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? "bazi" : event.key === "End" ? "liuyao" : archiveTab === "bazi" ? "liuyao" : "bazi";
    setTab(next);
    tabsNode.querySelector(`[data-tab="${next}"]`)?.focus();
  });

  // 卡片重绘后把焦点还给同一张卡片（键盘操作不丢位置）。
  function focusCard(id, selector = ".arc-actions .btn-primary") {
    const card = listNode.querySelector(`.arc-card[data-id="${Number(id)}"]`);
    (card?.querySelector(selector) || card?.querySelector("a, button") || tabsNode.querySelector('[aria-selected="true"]'))?.focus({ preventScroll: true });
  }

  function setCardBusy(card, text) {
    if (!card) return;
    card.classList.add("is-busy");
    card.setAttribute("aria-busy", "true");
    card.querySelectorAll("button, a").forEach(node => {
      node.setAttribute("aria-disabled", "true");
      if (node.tagName === "BUTTON") node.disabled = true;
    });
    card.append(h("div", { class: "arc-busy", role: "status" }, h("span", { class: "spinner", "aria-hidden": "true" }), text));
  }

  function clearCardBusy(card) {
    if (!card) return;
    card.classList.remove("is-busy");
    card.removeAttribute("aria-busy");
    card.querySelector(".arc-busy")?.remove();
    card.querySelectorAll("button, a").forEach(node => {
      node.removeAttribute("aria-disabled");
      if (node.tagName === "BUTTON") node.disabled = false;
    });
  }

  async function setDefault(profile, button) {
    if (button && !setBusy(button, "设置中…")) return;
    try {
      await put("/api/personal-home/default-profile", { profile_id: Number(profile.id) });
      // 观象台依据的命盘变了：让「今日」下次进入时重新读取。
      document.dispatchEvent(new CustomEvent("xz:personal-home-changed"));
      if (!ctx.isCurrent()) return;
      (state.profiles || []).forEach(item => {
        if (systemOf(item) === "bazi") item.is_default = Number(item.id) === Number(profile.id);
      });
      const hadFocus = listNode.contains(document.activeElement);
      paintList();
      if (hadFocus) focusCard(profile.id);
      toast("已设为默认命盘，今日内容会按它重新准备", { type: "ok" });
      load({ quiet: true });
    } catch (error) {
      if (!ctx.isCurrent()) return;
      if (error?.status === 401) refreshSession().catch(() => {});
      setIdle(button, icon("sun"), "设为默认");
      toast(`设置失败：${error?.message || "请稍后再试"}`, { type: "error" });
    }
  }

  // 从卡片菜单打开的面板关掉后，焦点回到这张卡片的「更多」按钮（菜单项已不在页面上）。
  function focusMore(profile) {
    requestAnimationFrame(() => listNode.querySelector(`.arc-card[data-id="${Number(profile.id)}"] .arc-more`)?.focus({ preventScroll: true }));
  }

  async function removeProfile(profile) {
    const isLy = systemOf(profile) === "liuyao";
    const unit = isLy ? "卦盘" : "命盘";
    const history = Number(profile.history_count) || 0;
    // 解读还在进行时，先提醒：删除会连同进行中的解读一起中断。
    const running = profile.task_status === "pending" || profile.task_status === "running";
    const ok = await confirmDialog({
      title: `确定永久删除这份${unit}？`,
      message: (running ? "这张盘还有一条解读正在进行，删除后会一并中断。" : "")
        + (history ? `同时删除 ${history} 条历史解读，且无法恢复。` : `这份${unit}将从账户中移除，删除后无法恢复。`),
      confirmText: "永久删除",
      cancelText: "取消",
      danger: true,
    });
    if (!ctx.isCurrent()) return;
    if (!ok) {
      focusMore(profile);
      return;
    }
    const card = listNode.querySelector(`.arc-card[data-id="${Number(profile.id)}"]`);
    setCardBusy(card, "正在删除…");
    try {
      await del(`/api/profiles/${encodeURIComponent(profile.id)}`);
      if (!ctx.isCurrent()) return;
      state.profiles = (state.profiles || []).filter(item => Number(item.id) !== Number(profile.id));
      rememberProfiles();
      paintTabs();
      paintList();
      (listNode.querySelector(".arc-card .arc-actions .btn-primary") || tabsNode.querySelector('[aria-selected="true"]'))?.focus({ preventScroll: true });
      toast("已永久删除", { type: "ok" });
      refreshSession().catch(() => {});
      load({ quiet: true });
    } catch (error) {
      if (!ctx.isCurrent()) return;
      clearCardBusy(card);
      if (error?.status === 401) refreshSession().catch(() => {});
      toast(`删除失败：${error?.message || "请稍后再试"}`, { type: "error" });
      focusMore(profile);
    }
  }

  const deletingPosts = new Set();
  async function removePublicPost(profile) {
    const slug = profile.public_post?.slug;
    if (!slug || deletingPosts.has(slug)) return;
    deletingPosts.add(slug);
    let card;
    try {
      const ok = await confirmDialog({
        title: "确定删除这条公开帖子？",
        message: "删除后将从广场移除，公开链接和评论也将无法访问，且不能恢复。这张盘和解读记录会保留。",
        confirmText: "删除公开帖子",
        danger: true,
      });
      if (!ctx.isCurrent()) return;
      if (!ok) {
        focusMore(profile);
        return;
      }
      card = listNode.querySelector(`.arc-card[data-id="${Number(profile.id)}"]`);
      setCardBusy(card, "正在删除公开帖子…");
      await del(`/api/community/posts/${encodeURIComponent(slug)}`, { interaction: true });
      removePost(slug);
      if (!ctx.isCurrent()) return;
      // Ignore an older profile request that may still contain the public link.
      state.requestId += 1;
      state.profiles = (state.profiles || []).map(item => item.public_post?.slug === slug
        ? { ...item, public_post: { ...item.public_post, status: "deleted", url: "" } }
        : item);
      rememberProfiles();
      paintTabs();
      paintList();
      focusMore(profile);
      toast("公开帖子已删除，盘和解读记录已保留", { type: "ok" });
      refreshSession().catch(() => {});
    } catch (error) {
      if (!ctx.isCurrent()) return;
      clearCardBusy(card);
      if (error?.status === 401) refreshSession().catch(() => {});
      toast(`删除失败：${error?.message || "请稍后再试"}`, { type: "error" });
      focusMore(profile);
    } finally {
      deletingPosts.delete(slug);
    }
  }

  function renameProfile(profile) {
    const isLy = systemOf(profile) === "liuyao";
    const id = uid("arc-rename");
    const input = h("input", {
      class: "input",
      id,
      name: "name",
      maxlength: NAME_MAX,
      required: true,
      autocomplete: "off",
      enterkeyhint: "done",
      autofocus: true,
      "aria-describedby": `${id}-error`,
      value: String(profile.name || ""),
      placeholder: isLy ? "例如：跳槽 offer" : "例如：本人",
    });
    const error = h("p", { class: "field-error", id: `${id}-error`, role: "alert", hidden: true });
    const form = h("form", { class: "arc-rename", id: `${id}-form`, novalidate: true },
      h("div", { class: "field" },
        h("label", { class: "field-label", for: id }, isLy ? "卦盘名称" : "命盘名称"),
        input,
        h("span", { class: "field-hint" }, `最多 ${NAME_MAX} 个字，方便你在「我的盘」里区分。`),
        error));
    const cancel = h("button", { type: "button", class: "btn btn-ghost" }, "取消");
    const save = h("button", { type: "submit", class: "btn btn-primary", form: `${id}-form` }, "保存");
    const sheet = openSheet({
      title: "重命名",
      body: form,
      footer: [cancel, save],
      className: "sheet-rename",
      onClose: reason => { if (reason !== "done" && ctx.isCurrent()) focusMore(profile); },
    });
    // 打开时选中原名：直接输入即可替换。
    requestAnimationFrame(() => { if (document.activeElement === input) input.select(); });
    cancel.addEventListener("click", () => sheet.close("cancel"));
    input.addEventListener("input", () => { error.hidden = true; error.textContent = ""; input.removeAttribute("aria-invalid"); });
    let saving = false;
    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (saving) return;
      const name = input.value.trim();
      if (!name) {
        error.textContent = "名称不能为空";
        error.hidden = false;
        input.setAttribute("aria-invalid", "true");
        input.focus();
        return;
      }
      if (name === String(profile.name || "").trim()) {
        sheet.close("same");
        return;
      }
      saving = true;
      setBusy(save, "保存中…");
      cancel.disabled = true;
      try {
        await patch(`/api/profiles/${encodeURIComponent(profile.id)}/name`, { name });
        profile.name = name;
        sheet.close("done");
        if (ctx.isCurrent()) {
          paintList();
          focusCard(profile.id, ".arc-more");
          load({ quiet: true });
        }
        toast("已重命名", { type: "ok" });
      } catch (reason) {
        if (reason?.status === 401) refreshSession().catch(() => {});
        error.textContent = reason?.message || "重命名失败";
        error.hidden = false;
        input.setAttribute("aria-invalid", "true");
        setIdle(save, "保存");
        cancel.disabled = false;
        input.focus();
        input.select();
      } finally {
        saving = false;
      }
    });
  }

  function archiveCard(profile) {
    const isLy = systemOf(profile) === "liuyao";
    const summary = profile.summary && typeof profile.summary === "object" ? profile.summary : {};
    const name = String(profile.name || "").trim() || (isLy ? "未命名卦盘" : "未命名命盘");
    const isPublic = profile.visibility === "public";
    const postDeleted = profile.public_post?.status === "deleted";
    const slug = String(profile.public_post?.slug || "").trim();
    const canDeletePost = slug && ["published", "hidden"].includes(profile.public_post?.status);
    const task = TASK_STATE[profile.task_status];
    const history = Number(profile.history_count) || 0;
    const question = isLy ? String(summary.question || "").trim() : "";
    const visual = isLy ? guaLine(summary) : (summary.pillars && typeof summary.pillars === "object" ? pillarsToken({ pillars: summary.pillars }) : null);
    const openHref = `#/reading/${encodeURIComponent(profile.id)}`;

    const moreButton = h("button", {
      type: "button",
      class: "icon-btn arc-more",
      "aria-label": `更多操作：${name}`,
      "aria-haspopup": "menu",
      "aria-expanded": "false",
    }, icon("more"));
    moreButton.addEventListener("click", () => openMenu(moreButton, [
      { label: "重命名", icon: "edit", onSelect: () => renameProfile(profile) },
      canDeletePost ? "sep" : null,
      canDeletePost ? { label: "删除公开帖子", icon: "trash", onSelect: () => removePublicPost(profile) } : null,
      isPublic ? null : "sep",
      isPublic ? null : { label: "永久删除", icon: "trash", onSelect: () => removeProfile(profile) },
    ], { align: "end" }));

    const defaultButton = !isLy && !profile.is_default
      ? h("button", { type: "button", class: "btn btn-sm btn-soft" }, icon("sun"), "设为默认")
      : null;
    defaultButton?.addEventListener("click", () => setDefault(profile, defaultButton));

    // 没有标签时不留空行：「更多」按钮始终跟名字同一行。
    const badges = [
      !isLy && profile.is_default ? h("span", { class: "chip chip-gold" }, icon("sun"), "默认命盘") : null,
      isLy || isPublic || postDeleted ? h("span", { class: ["chip", isPublic && !postDeleted ? "chip-liuyao" : "chip-outline"] }, icon(isPublic && !postDeleted ? "globe" : "lock"), postDeleted ? "帖子已删除" : isPublic ? "公开" : "私密") : null,
      task ? h("span", { class: ["chip", "arc-task", `is-${task.tone}`] }, task.tone === "active" ? h("span", { class: "arc-pulse", "aria-hidden": "true" }) : null, task.label) : null,
    ].filter(Boolean);

    return h("article", { class: ["arc-card", isLy ? "is-liuyao" : "is-bazi", profile.is_default && !isLy && "is-default"], "data-id": Number(profile.id) },
      badges.length ? h("div", { class: "arc-badges" }, badges) : null,
      h("header", { class: "arc-card-head" },
        h("h3", { class: "arc-name" }, name),
        moreButton),
      visual,
      question && question !== name ? h("p", { class: "arc-question" }, question) : null,
      !visual && !question ? h("p", { class: "arc-question" }, isLy ? "六爻卦盘" : "四柱命盘") : null,
      h("p", { class: "arc-meta" },
        icon("clock", "icon-sm"),
        h("time", { datetime: profile.created_at || "" }, stamp(profile.created_at)),
        h("span", { "aria-hidden": "true" }, "·"),
        h("span", { class: "tnum" }, `${history} 条解读`)),
      h("div", { class: "arc-actions" },
        h("a", { class: "btn btn-primary btn-sm", href: openHref }, icon(isLy ? "gua" : "pillars"), isLy ? "打开卦盘" : "打开命盘"),
        !isLy ? h("button", { type: "button", class: "btn btn-sm", onClick: () => openConversations(ctx, profile) }, icon("comment"), "对话记录") : null,
        defaultButton,
        isPublic || postDeleted
          ? postDeleted
            ? h("span", { class: "arc-retained" }, "公开帖子已删除，盘已保留")
            : slug
            ? h("a", { class: "btn btn-sm btn-ghost", href: `#/post/${encodeURIComponent(slug)}` }, icon("globe"), "查看公开卦帖")
            : h("span", { class: "arc-retained" }, "公开的盘随卦帖保留")
          : null));
  }

  function paintList() {
    listNode.setAttribute("aria-busy", "false");
    const items = (state.profiles || []).filter(profile => systemOf(profile) === archiveTab);
    if (!items.length) {
      const isBazi = archiveTab === "bazi";
      listNode.replaceChildren(h("div", { class: "arc-empty" }, stateView({
        glyph: isBazi ? "pillars" : "gua",
        title: isBazi ? "还没有八字命盘" : "还没有六爻卦盘",
        text: isBazi ? "排一张八字，命盘会自动存进这里，随时回来继续追问。" : "起一卦，卦盘会自动存进这里，之后可以回看与追问。",
        actions: [h("a", { class: "btn btn-primary", href: isBazi ? "#/ask/bazi" : "#/ask/liuyao" }, icon(isBazi ? "pillars" : "gua"), isBazi ? "去排八字" : "去起六爻")],
      })));
      return;
    }
    listNode.replaceChildren(h("div", { class: "arc-grid" }, items.map(archiveCard)));
  }

  function rememberProfiles() {
    const user = session.get().user?.id;
    if (user && state.profiles) archiveCache = { user, list: state.profiles, at: Date.now() };
  }

  // 列表重绘时保持键盘焦点在同一张卡片的同一个按钮上。
  function repaintKeepingFocus() {
    const active = listNode.contains(document.activeElement) ? document.activeElement : null;
    const cardId = active?.closest(".arc-card")?.dataset.id;
    const selector = active?.classList.contains("arc-more") ? ".arc-more" : ".arc-actions .btn-primary";
    paintTabs();
    paintList();
    if (cardId) focusCard(cardId, selector);
  }

  async function load({ quiet = false, announce = false } = {}) {
    const requestId = ++state.requestId;
    if (!state.profiles) {
      listNode.setAttribute("aria-busy", "true");
      listNode.replaceChildren(h("p", { class: "sr-only", role: "status" }, "正在读取我的盘…"), archiveSkeleton());
    }
    const before = announce ? JSON.stringify(state.profiles) : "";
    if (announce) listNode.classList.add("is-refreshing");
    try {
      const data = await get("/api/profiles", { cache: "no-store" });
      if (!ctx.isCurrent() || requestId !== state.requestId) return;
      state.profiles = Array.isArray(data) ? data : [];
      state.failed = false;
      rememberProfiles();
      repaintKeepingFocus();
      if (announce) toast(JSON.stringify(state.profiles) === before ? "已是最新" : "已更新", { type: "ok" });
    } catch (error) {
      if (!ctx.isCurrent() || requestId !== state.requestId) return;
      if (error?.status === 401) refreshSession().catch(() => {});
      state.failed = !state.profiles;
      if (quiet && state.profiles) {
        toast(`读取我的盘失败：${error?.message || "请稍后再试"}`, { type: "error" });
        return;
      }
      listNode.setAttribute("aria-busy", "false");
      listNode.replaceChildren(retryState({
        title: "我的盘加载失败，已保存内容不受影响。",
        text: error?.message || "",
        onRetry: () => {
          state.profiles = null;
          load();
        },
      }));
    } finally {
      if (requestId === state.requestId) listNode.classList.remove("is-refreshing");
    }
  }

  function sync() {
    const current = session.get();
    const key = !current.ready ? "loading" : current.authenticated ? `user:${current.user?.id || ""}` : "anon";
    if (key === lastKey) return;
    lastKey = key;
    state.requestId += 1;
    state.profiles = null;
    if (key === "loading") {
      body.replaceChildren(head, h("div", { class: "arc-list" }, archiveSkeleton()));
      return;
    }
    if (key === "anon") {
      body.replaceChildren(pageHead({ title: "我的盘" }), loginCard(ctx, {
        title: "登录后查看我的盘",
        text: "八字命盘与六爻卦盘都自动保存在这里，只对你本人可见。",
        reason: "登录后查看你的盘。",
      }));
      return;
    }
    body.replaceChildren(head, toolbar, listNode);
    const saved = archiveCache;
    if (saved && saved.user === current.user?.id && Date.now() - saved.at < ARCHIVE_TTL) {
      // 从解读页返回：先用上次的列表（滚动位置可以立即恢复），再静默刷新。
      state.profiles = saved.list;
      paintTabs();
      paintList();
      load({ quiet: true });
      return;
    }
    paintTabs();
    load();
  }
  const recover = () => {
    if (ctx.isCurrent() && session.get().authenticated && state.failed) load();
  };
  window.addEventListener("online", recover);
  ctx.cleanup(() => window.removeEventListener("online", recover));
  // 已在顶部时再点一次「我的盘」：重新读取档案。
  ctx.onRefresh(() => {
    if (!session.get().authenticated) return;
    if (state.profiles) load({ quiet: true, announce: true });
    else load();
  });
  sync();
  ctx.subscribe(session, sync);
}

/* ---------- 旧版支付回跳和历史订单 ---------- */
const PAYMENT_STATUS = { paid: "已付款", pending: "待确认", expired: "已失效" };

function paymentHistoryView(ctx, body) {
  const head = pageHead({ title: "历史订单" });
  const content = h("div", { class: "me-body", "aria-live": "polite" });
  body.replaceChildren(head, content);
  const returnStatus = ctx.query.get("checkout");
  const sessionId = ctx.query.get("session_id") || ctx.query.get("checkout_session_id");
  const cancelled = returnStatus === "cancelled";
  const month = ctx.query.get("month");
  let page = 1;
  let requestId = 0;

  function showOrder(order) {
    return h("div", { class: "set-row" },
      h("div", { class: "set-row-copy" },
        h("b", null, money(order.amount_total, order.currency)),
        order.created_at ? h("time", { datetime: order.created_at }, stamp(order.created_at)) : null),
      h("span", { class: "set-row-control" }, PAYMENT_STATUS[order.status] || "状态未知"));
  }

  async function load() {
    const id = ++requestId;
    const current = () => id === requestId && ctx.isCurrent();
    content.replaceChildren(spinnerLine("正在查询订单…"));
    try {
      if (returnStatus === "success" && sessionId) {
        const order = await get(`/api/billing/checkout-sessions/${encodeURIComponent(sessionId)}`, { cache: "no-store" });
        if (!current()) return;
        const refresh = order.status === "pending"
          ? h("button", { type: "button", class: "btn btn-soft", onClick: load }, icon("refresh"), "刷新状态")
          : null;
        content.replaceChildren(h("section", { class: "set-card" }, showOrder(order), refresh));
        return;
      }
      const history = await get(`/api/billing/orders${query({ page, month })}`, { cache: "no-store" });
      if (!current()) return;
      const orders = history.items || [];
      const total = history.pagination?.page_count || 1;
      const turnPage = (label, target, disabled) => h("button", {
        type: "button", class: "btn btn-soft btn-sm", disabled,
        onClick: () => { page = target; load(); },
      }, label);
      content.replaceChildren(h("section", { class: "set-card" },
        cancelled ? h("p", { role: "status" }, "已离开 Stripe 付款页。") : null,
        orders.length ? orders.map(showOrder) : h("p", null, "没有历史订单。"),
        total > 1 ? h("div", { class: "set-row" }, turnPage("上一页", page - 1, page <= 1), turnPage("下一页", page + 1, page >= total)) : null));
    } catch (error) {
      if (current()) content.replaceChildren(retryState({ title: "暂时无法查询订单", text: error.message, onRetry: load }));
    }
  }

  let accountKey;
  function sync(state) {
    const key = state.ready ? state.user?.id || "" : null;
    if (accountKey === key) return;
    accountKey = key;
    requestId += 1;
    page = 1;
    if (!state.ready) content.replaceChildren(spinnerLine("正在读取登录状态…"));
    else if (state.authenticated) load();
    else content.replaceChildren(loginCard(ctx, {
      title: "登录后查看历史订单",
      text: "订单信息只对付款账户可见。",
      reason: "登录后查看历史订单。",
    }));
  }
  sync(session.get());
  ctx.subscribe(session, sync);
}

/* ==========================================================================
   设置
   ========================================================================== */
function settingSection(title, rows) {
  const titleId = uid("set");
  return h("section", { class: "set-card", "aria-labelledby": titleId },
    h("h2", { class: "set-title", id: titleId }, title),
    h("div", { class: "set-rows" }, rows));
}

function settingRow({ label, text = "", control = null, className = "" }) {
  return h("div", { class: ["set-row", className] },
    h("div", { class: "set-row-copy" }, h("b", null, label), text ? h("span", null, text) : null),
    control ? h("div", { class: "set-row-control" }, control) : null);
}

function appearanceSection(ctx) {
  const options = [["light", "浅色", "sun"], ["dark", "深色", "moon"], ["auto", "跟随系统", "monitor"]];
  const buttons = options.map(([key, label, glyph]) => h("button", {
    type: "button",
    "aria-pressed": String(ctx.themePreference() === key),
    "data-pref": key,
  }, icon(glyph, "icon-sm"), label));
  const sync = () => {
    const current = ctx.themePreference();
    buttons.forEach(node => node.setAttribute("aria-pressed", String(node.dataset.pref === current)));
  };
  buttons.forEach(button => button.addEventListener("click", () => {
    ctx.setTheme(button.dataset.pref);
    sync();
  }));
  // 外观也可能在顶栏开关里被切换：跟着根节点上的偏好标记同步。
  if (typeof MutationObserver === "function") {
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-scheme-pref"] });
    ctx.cleanup(() => observer.disconnect());
  }
  // 分组已叫「外观」，这一行只说具体设置；三个选项自己能看懂，不再解释「跟随系统」。
  return settingSection("外观", [settingRow({
    label: "深浅色",
    control: h("div", { class: "seg set-theme", role: "group", "aria-label": "深浅色" }, buttons),
    className: "is-stack",
  })]);
}

function accountSection(ctx, state, nick) {
  const logout = h("button", { type: "button", class: "btn btn-danger btn-sm", onClick: () => confirmLogout(ctx), "aria-label": "退出登录" }, icon("logout"), "退出");
  return settingSection("账户", [
    h("div", { class: "set-row is-nick" }, nick.node),
    settingRow({ label: "登录邮箱", text: maskEmail(state.user?.email) || "—" }),
    // 注册时可以不设密码：这里验证邮箱后设置或修改，不需要旧密码。
    settingRow({ label: "登录密码", text: "验证邮箱后设置或修改；不设也能用验证码登录。", control: h("button", { type: "button", class: "btn btn-sm", onClick: () => ctx.openAuth({ mode: "reset_password", reason: "验证邮箱后设置新的登录密码。" }) }, "设置密码") }),
    settingRow({ label: "退出登录", text: "在这台设备上退出当前账户。", control: logout }),
  ]);
}

function helpSection() {
  const copy = h("button", { type: "button", class: "btn btn-sm btn-ghost", "aria-label": "复制邮箱地址" }, icon("copy"), "复制");
  copy.addEventListener("click", async () => {
    const ok = await copyText(MAIL);
    toast(ok ? "邮箱地址已复制" : "复制失败，请手动选择邮箱地址", { type: ok ? "ok" : "error" });
  });
  return settingSection("帮助与反馈", [
    // 「断得准不准……直说无妨」由反馈面板开头说，这一行只放入口。
    settingRow({
      label: "意见反馈",
      control: h("button", { type: "button", class: "btn btn-soft btn-sm", onClick: () => openFeedback() }, "写反馈"),
    }),
    settingRow({
      label: "邮件联系",
      text: h("span", { class: "set-mail" }, MAIL),
      control: copy,
    }),
  ]);
}

function settingsView(ctx, body) {
  let lastKey = null;
  let nick = null;
  function paint() {
    const state = session.get();
    const key = !state.ready ? "loading" : state.authenticated ? `user:${state.user?.id || ""}` : "anon";
    if (key === lastKey) {
      nick?.update();
      return;
    }
    lastKey = key;
    nick = null;
    const sections = [pageHead({ title: "设置" }), appearanceSection(ctx)];
    if (key === "loading") {
      sections.push(h("section", { class: "set-card is-skeleton", "aria-hidden": "true" },
        h("span", { class: "skel skel-line", style: { width: "64px" } }),
        h("span", { class: "skel", style: { height: "56px", borderRadius: "12px", marginTop: "14px" } }),
        h("span", { class: "skel", style: { height: "56px", borderRadius: "12px", marginTop: "10px" } })));
    } else if (key === "anon") {
      sections.push(loginCard(ctx, {
        title: "登录后管理账户",
        text: "设置社区昵称，查看我的盘与消息。",
        reason: "登录后管理你的账户。",
      }));
    } else {
      nick = nicknameEditor(ctx, { variant: "row" });
      sections.push(accountSection(ctx, state, nick));
    }
    sections.push(helpSection(), h("p", { class: "me-disclaimer" }, icon("info", "icon-sm"), h("span", null, DISCLAIMER)));
    body.replaceChildren(...sections);
  }
  paint();
  ctx.subscribe(session, paint);
}

/* ==========================================================================
   入口
   ========================================================================== */
export function render(ctx) {
  const requested = ctx.params.tab || "";
  const legacyPayment = requested === "credits";
  const tab = legacyPayment ? { key: requested, title: "历史订单" } : TABS.find(item => item.key === requested) || TABS[0];
  const body = h("div", { class: "me-body" });
  const node = h("div", { class: ["me-page", `is-${tab.key || "home"}`] }, tabStrip(tab.key), body);
  const views = { "": overviewView, archives: archivesView, credits: paymentHistoryView, settings: settingsView };
  views[tab.key](ctx, body);
  return { node, title: tab.title };
}
