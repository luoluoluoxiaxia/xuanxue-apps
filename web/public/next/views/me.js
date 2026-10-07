// 我的：个人主页、我的盘（档案）、积分与充值、设置——四个标签页共用一个外壳。
// 账户、额度、档案与充值状态都以服务端返回为准；这里只负责展示与提交。
import { h, reducedMotion } from "../lib/dom.js?v=n18";
import { icon } from "../lib/icons.js?v=n18";
import { get, post, put, patch, del, query } from "../lib/api.js?v=n18";
import { session, inbox, applyAccount, refreshSession } from "../lib/store.js?v=n18";
import { relativeTime, fullTime, shortDate, money, plainExcerpt } from "../lib/format.js?v=n18";
import { stateView, spinnerLine } from "../ui/bits.js?v=n18";
import { pillarsToken } from "../ui/gua.js?v=n18";
import { openSheet, confirmDialog, openMenu } from "../ui/overlay.js?v=n18";
import { toast } from "../ui/toast.js?v=n18";
import { copyText } from "../lib/share.js?v=n18";
import { openFeedback } from "./feedback.js?v=n18";

const TABS = [
  { key: "", label: "主页", href: "#/me", glyph: "user", title: "我的" },
  { key: "archives", label: "我的盘", href: "#/me/archives", glyph: "book", title: "我的盘" },
  { key: "credits", label: "积分", href: "#/me/credits", glyph: "coins", title: "积分" },
  { key: "settings", label: "设置", href: "#/me/settings", glyph: "sliders", title: "设置" },
];
const MAIL = "luoluoluoxiaxia@gmail.com";
const DISCLAIMER = "AI 解读仅供传统文化研究与娱乐参考，不替代医疗、法律、投资等专业意见。";

let uidSeed = 0;
const uid = prefix => `${prefix}-${(uidSeed += 1).toString(36)}`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
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

// 眉题（档案 / 积分 / 设置）与上方标签重复，页头只放标题。
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
      h("button", { type: "button", class: "btn btn-primary", onClick: () => ctx.openAuth({ reason }) }, icon("user"), "登录"),
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
    message: "退出后，需要重新登录才能查看档案、积分与消息。",
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
      stat("卦档", archive?.liuyao, "#/me/archives?tab=liuyao"),
      stat("解读", archive?.history_count, "#/me/archives"));
    const active = Number(archive?.active) || 0;
    note.hidden = !active;
    note.replaceChildren(h("span", { class: "me-pulse", "aria-hidden": "true" }), `${active} 份档案正在生成解读`);
  }
  return { node, update };
}

function quotaMeter(quota) {
  const remaining = Math.max(0, Number(quota?.remaining) || 0);
  const total = Math.max(0, Number(quota?.total) || 0);
  const ratio = total > 0 ? Math.min(100, (remaining / total) * 100) : 0;
  return h("div", { class: "me-quota" },
    h("div", { class: "me-quota-head" },
      h("span", null, "今日免费积分"),
      h("b", { class: "tnum" }, quota ? `${remaining} / ${total}` : "—")),
    h("div", {
      class: "me-meter",
      role: "progressbar",
      "aria-label": "今日免费积分剩余",
      "aria-valuemin": "0",
      "aria-valuemax": String(total),
      "aria-valuenow": String(remaining),
    }, h("i", { style: { width: `${ratio}%` } })),
    h("span", { class: "me-quota-note" }, "北京时间 0 点刷新"));
}

function walletCard() {
  const node = h("section", { class: "me-wallet", "aria-labelledby": "me-wallet-title" });
  function update(state) {
    node.replaceChildren(
      h("div", { class: "me-wallet-head" },
        h("h2", { id: "me-wallet-title" }, "积分"),
        h("a", { class: "btn btn-primary btn-sm", href: "#/me/credits?topup=1" }, icon("plus"), "充值")),
      h("div", { class: "me-wallet-body" },
        h("div", { class: "me-wallet-balance" },
          h("span", null, "当前余额"),
          h("p", null, h("b", { class: "tnum" }, number(state.wallet?.balance)), h("em", null, "分"))),
        quotaMeter(state.quota)));
  }
  return { node, update };
}

// 我的盘、积分、设置都在上方标签里；消息（手机底栏已不单列）和意见反馈放在这里。
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
        h("span", { class: "skel", style: { height: "64px", borderRadius: "14px" } })),
      h("section", { class: "me-wallet is-skeleton" }, h("span", { class: "skel", style: { height: "132px", borderRadius: "14px" } }))),
    h("div", { class: "me-col" },
      h("section", { class: "me-links is-skeleton" },
        h("span", { class: "skel", style: { height: "48px", borderRadius: "12px" } }))));
}

function overviewView(ctx, body) {
  let lastKey = null;
  let profile = null;
  let wallet = null;
  function paint() {
    const state = session.get();
    const key = !state.ready ? "loading" : state.authenticated ? `user:${state.user?.id || ""}` : "anon";
    if (key !== lastKey) {
      lastKey = key;
      profile = null;
      wallet = null;
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
                text: "命盘、卦档、积分与消息都在这里，只对你本人可见。",
                reason: "登录后查看你的命盘、积分与消息。",
              })),
            h("div", { class: "me-col" }, linksCard(ctx, false), overviewFoot(ctx, false))));
        return;
      }
      profile = profileCard(ctx);
      wallet = walletCard();
      body.replaceChildren(h("div", { class: "me-overview" },
        h("div", { class: "me-col" }, profile.node, wallet.node),
        h("div", { class: "me-col" }, linksCard(ctx, true), overviewFoot(ctx, true))));
    }
    if (state.authenticated) {
      profile?.update(state);
      wallet?.update(state);
    }
  }
  paint();
  ctx.subscribe(session, paint);
  // 已在顶部时再点一次底栏「我」：重新读取余额、免费积分与档案数。
  let refreshing = false;
  ctx.onRefresh(async () => {
    if (refreshing || !session.get().authenticated) return;
    refreshing = true;
    const visible = () => { const s = session.get(); return JSON.stringify([s.wallet, s.quota, s.archive, s.user?.nickname]); };
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
    content.replaceChildren(spinnerLine("正在整理这份八字档案…"));
    try {
      const list = await get(`/api/profiles/${encodeURIComponent(profile.id)}/conversations`, { cache: "no-store" });
      if (!content.isConnected || !ctx.isCurrent()) return;
      paint(Array.isArray(list) ? list : []);
    } catch (error) {
      if (!content.isConnected || !ctx.isCurrent()) return;
      if (error?.status === 401) refreshSession().catch(() => {});
      content.replaceChildren(retryState({
        title: "档案加载失败，对话记录不受影响。",
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
  const head = pageHead({ title: "我的盘", sub: "八字命盘与六爻卦档都自动保存在这里，只对你本人可见。" });
  const tabsNode = h("div", { class: "seg arc-tabs", role: "tablist", "aria-label": "档案类型" });
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
    const unit = isLy ? "卦档" : "命盘";
    const history = Number(profile.history_count) || 0;
    // 解读还在进行时，先提醒：删除会连同进行中的解读一起中断。
    const running = profile.task_status === "pending" || profile.task_status === "running";
    const ok = await confirmDialog({
      title: `确定永久删除这份${unit}？`,
      message: (running ? "这份档案还有一条解读正在进行，删除后会一并中断。" : "")
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
      toast("档案已永久删除", { type: "ok" });
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
        h("label", { class: "field-label", for: id }, isLy ? "卦档名称" : "命盘名称"),
        input,
        h("span", { class: "field-hint" }, `最多 ${NAME_MAX} 个字，方便你在档案里区分。`),
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
    const slug = String(profile.public_post?.slug || "").trim();
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
      isLy || isPublic ? h("span", { class: ["chip", isPublic ? "chip-liuyao" : "chip-outline"] }, icon(isPublic ? "globe" : "lock"), isPublic ? "公开" : "私密") : null,
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
        h("a", { class: "btn btn-primary btn-sm", href: openHref }, icon(isLy ? "gua" : "pillars"), isLy ? "打开卦档" : "打开命盘"),
        !isLy ? h("button", { type: "button", class: "btn btn-sm", onClick: () => openConversations(ctx, profile) }, icon("comment"), "对话记录") : null,
        defaultButton,
        isPublic
          ? slug
            ? h("a", { class: "btn btn-sm btn-ghost", href: `#/post/${encodeURIComponent(slug)}` }, icon("globe"), "查看公开卦帖")
            : h("span", { class: "arc-retained" }, "公开档案随卦帖保留")
          : null));
  }

  function paintList() {
    listNode.setAttribute("aria-busy", "false");
    const items = (state.profiles || []).filter(profile => systemOf(profile) === archiveTab);
    if (!items.length) {
      const isBazi = archiveTab === "bazi";
      listNode.replaceChildren(h("div", { class: "arc-empty" }, stateView({
        glyph: isBazi ? "pillars" : "gua",
        title: isBazi ? "暂无八字档案" : "暂无六爻档案",
        text: isBazi ? "排一张八字，命盘会自动存进这里，随时回来继续追问。" : "起一卦，卦档会自动存进这里，之后可以回看与追问。",
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
      listNode.replaceChildren(h("p", { class: "sr-only", role: "status" }, "正在读取档案…"), archiveSkeleton());
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
        toast(`读取档案失败：${error?.message || "请稍后再试"}`, { type: "error" });
        return;
      }
      listNode.setAttribute("aria-busy", "false");
      listNode.replaceChildren(retryState({
        title: "档案加载失败，已保存内容不受影响。",
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
        title: "登录后查看档案",
        text: "八字命盘与六爻卦档都自动保存在这里，只对你本人可见。",
        reason: "登录后查看私人档案。",
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

/* ==========================================================================
   积分与充值
   ========================================================================== */
const CHECKOUT_CONTEXT_KEY = "xuanshu-checkout-context-v1";
const CHECKOUT_CHANNEL_NAME = "xuanshu-checkout-events-v1";
const CHECKOUT_WINDOW_NAME = "xuanshu-stripe-checkout";
const CHECKOUT_TTL_MS = 24 * 60 * 60 * 1000;
const CHECKOUT_PARAMS = ["checkout", "session_id", "checkout_session_id", "order_id"];
const LEDGER_FILTERS = [["all", "全部"], ["usage", "消耗"], ["credit", "获得"], ["orders", "充值"]];
const ENTRY_LABEL = { answer_usage: "AI 回答", checkout_purchase: "充值", welcome_bonus: "注册赠送", admin_credit: "积分补发", admin_debit: "积分调整" };
const ORDER_STATUS = { paid: ["已到账", "ok"], pending: ["待支付", "gold"], expired: ["已失效", "muted"] };
const EMPTY_LEDGER = { all: "本月暂无积分记录", usage: "本月暂无消耗", credit: "本月暂无获得记录", orders: "本月暂无充值记录" };
const STATUS_COPY = {
  pending: { eyebrow: "到账核验", title: "正在确认到账", text: "等待 Stripe 确认，请勿重复付款。", step: "credit", tone: "busy" },
  paying: { eyebrow: "Stripe 安全付款", title: "Stripe 付款页已打开", text: "付款后自动更新。", step: "pay", tone: "busy" },
  delayed: { eyebrow: "到账核验", title: "还在确认中", text: "通知可能稍慢，请勿重复付款。", step: "credit", tone: "wait" },
  paid: { eyebrow: "充值完成", title: "积分已到账", text: "", step: "done", tone: "ok" },
  cancelled: { eyebrow: "付款已取消", title: "没有产生本次充值", text: "没有扣款或增加积分。", step: "pay", tone: "muted" },
  expired: { eyebrow: "付款链接已过期", title: "请重新选择套餐", text: "链接已失效，不会扣款。", step: "pay", tone: "muted" },
  error: { eyebrow: "暂时无法核验", title: "到账状态没有更新", text: "请勿重复付款，可重新检查。", step: "pay", tone: "error" },
};

const monthFormat = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit" });

function monthOf(date) {
  const parts = {};
  try { monthFormat.formatToParts(date).forEach(part => { parts[part.type] = part.value; }); } catch (_) {}
  return /^\d{4}$/.test(parts.year || "") && /^\d{2}$/.test(parts.month || "") ? `${parts.year}-${parts.month}` : "";
}

const beijingMonth = () => monthOf(new Date());
const validMonth = value => /^\d{4}-(?:0[1-9]|1[0-2])$/.test(String(value || "").trim());

function monthLabel(value) {
  const [year = "", month = ""] = String(value || "").split("-");
  return `${Number(year)} 年 ${Number(month)} 月`;
}

function shiftMonth(value, delta) {
  const [year, month] = value.split("-").map(Number);
  const index = year * 12 + (month - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

function monthRange(min, max) {
  const list = [];
  let cursor = max;
  while (cursor >= min && list.length < 120) {
    list.push(cursor);
    cursor = shiftMonth(cursor, -1);
  }
  return list.length ? list : [max];
}

function ledgerTime(value) {
  const text = stamp(value);
  return /^\d{4}-/.test(text) ? text.slice(5) : text;
}

const signed = value => (value > 0 ? `+${value}` : String(value));

function splitEstimate(value) {
  const text = String(value || "").trim() || "按每次回答的实际消耗结算";
  const match = /\s*[·•]\s*(赠\s*\d+\s*分)\s*$/.exec(text);
  if (!match) return { main: text, bonus: "" };
  return { main: text.slice(0, match.index).trim() || "按每次回答的实际消耗结算", bonus: match[1].replace(/\s+/g, " ") };
}

function readCheckoutContext() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(CHECKOUT_CONTEXT_KEY) || "null");
    if (!parsed || typeof parsed !== "object") return null;
    if (Date.now() - Number(parsed.started_at || 0) > CHECKOUT_TTL_MS) {
      sessionStorage.removeItem(CHECKOUT_CONTEXT_KEY);
      return null;
    }
    return {
      order_id: String(parsed.order_id || ""),
      checkout_session_id: String(parsed.checkout_session_id || ""),
      sku: String(parsed.sku || ""),
      credits: Math.max(0, Number(parsed.credits) || 0),
      amount_total: Math.max(0, Number(parsed.amount_total) || 0),
      return_url: String(parsed.return_url || ""),
      started_at: Number(parsed.started_at) || Date.now(),
    };
  } catch (_) {
    return null;
  }
}

function writeCheckoutContext(value) {
  try { sessionStorage.setItem(CHECKOUT_CONTEXT_KEY, JSON.stringify(value)); } catch (_) {}
}

function clearCheckoutContext() {
  try { sessionStorage.removeItem(CHECKOUT_CONTEXT_KEY); } catch (_) {}
}

// 当前地址去掉结账回跳参数后的样子（哈希路由里的参数也一并去掉）。
function cleanLocation({ keepHashQuery = true } = {}) {
  const search = new URLSearchParams(location.search);
  CHECKOUT_PARAMS.forEach(key => search.delete(key));
  const [hashPath, hashQuery = ""] = location.hash.replace(/^#/, "").split("?");
  const hashParams = new URLSearchParams(keepHashQuery ? hashQuery : "");
  [...CHECKOUT_PARAMS, "topup"].forEach(key => hashParams.delete(key));
  const searchText = search.toString();
  const hashText = hashParams.toString();
  return `${location.pathname}${searchText ? `?${searchText}` : ""}#${hashPath || "/me/credits"}${hashText ? `?${hashText}` : ""}`;
}

function newIdempotencyKey() {
  try {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") return `credit-${globalThis.crypto.randomUUID()}`;
  } catch (_) {}
  return `credit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function checkoutSteps(active) {
  const list = [["confirm", "确认套餐"], ["pay", "Stripe 付款"], ["credit", "自动到账"]];
  const index = active === "done" ? list.length : Math.max(0, list.findIndex(([key]) => key === active));
  return h("ol", { class: "cr-steps", "aria-label": "充值进度" }, list.map(([, label], i) => h("li", {
    class: [i < index && "is-done", i === index && "is-active"],
    "aria-current": i === index ? "step" : null,
  },
  h("span", null, label),
  i < index ? h("span", { class: "sr-only" }, "（已完成）") : null)));
}

function quotaBlock(quota) {
  const remaining = Math.max(0, Number(quota?.remaining) || 0);
  const total = Math.max(0, Number(quota?.total) || 0);
  const ratio = total > 0 ? Math.min(100, (remaining / total) * 100) : 0;
  return h("div", { class: "cr-quota" },
    h("div", { class: "cr-quota-head" },
      h("span", { class: "cr-label" }, icon("sun", "icon-sm"), "今日免费积分"),
      h("span", { class: "cr-quota-reset" }, "北京时间 0 点刷新")),
    h("p", { class: "cr-quota-value" },
      h("b", { class: "tnum" }, quota ? String(remaining) : "—"),
      quota ? h("span", { class: "tnum" }, `/ ${total}`) : null),
    h("div", {
      class: "me-meter",
      role: "progressbar",
      "aria-label": "今日免费积分剩余",
      "aria-valuemin": "0",
      "aria-valuemax": String(total),
      "aria-valuenow": String(remaining),
    }, h("i", { style: { width: `${ratio}%` } })),
    h("dl", { class: "cr-quota-meta" },
      h("div", null, h("dt", null, "每日基础"), h("dd", { class: "tnum" }, `${Number(quota?.base) || 0} 分`)),
      h("div", null, h("dt", null, "邀请加成"), h("dd", { class: "tnum" }, `+${Number(quota?.referral_bonus) || 0} 分`)),
      h("div", null, h("dt", null, "今日已用"), h("dd", { class: "tnum" }, `${Number(quota?.used) || 0} 分`))));
}

// 明细里大多是同一类记录（AI 回答）：每行先写这一笔是什么，类型、时间和免费额度放进小字，
// 不再一行行重复同一个粗标题。
function activityRow(item) {
  const amount = Number(item?.amount) || 0;
  const type = String(item?.entry_type || "");
  const label = ENTRY_LABEL[type] || String(item?.title || "").trim() || "积分变动";
  const description = String(item?.description || "").trim();
  const lead = description || label;
  const free = type === "answer_usage" ? Number(item?.daily_free_spent) || 0 : 0;
  const direction = amount > 0 ? "plus" : amount < 0 ? "minus" : "zero";
  return h("li", { class: "cr-row" },
    h("span", { class: "cr-row-main" },
      h("span", { class: "cr-row-lead", title: lead }, lead),
      h("span", { class: "cr-row-meta" },
        description ? h("span", null, label) : null,
        h("time", { datetime: item?.created_at || "" }, ledgerTime(item?.created_at)),
        // 始终写出免费额度用了几分：变动金额可能只算账户扣款（整笔由免费额度抵扣时为 0）。
        free > 0 ? h("span", null, `免费额度 ${free} 分`) : null)),
    h("span", { class: "cr-row-side" },
      h("b", { class: ["cr-change", `is-${direction}`, "tnum"] }, signed(amount), h("span", { class: "sr-only" }, " 分")),
      h("span", { class: "cr-after tnum" }, `余额 ${number(item?.balance_after)}`)));
}

function orderRow(item) {
  const status = String(item?.status || "pending");
  const [statusLabel, tone] = ORDER_STATUS[status] || ["处理中", "muted"];
  const currency = String(item?.currency || "usd").toUpperCase();
  const credits = Number(item?.credits) || 0;
  const change = status === "paid" ? credits : 0;
  const when = item?.paid_at || item?.expired_at || item?.created_at;
  return h("li", { class: "cr-row" },
    // 「充值」标签页里每行都是充值：先写金额和积分，状态跟在后面。
    h("span", { class: "cr-row-main" },
      h("span", { class: "cr-row-title" }, `${currency} ${((Number(item?.amount_total) || 0) / 100).toFixed(2)} · ${credits} 分`, h("span", { class: "sr-only" }, " · "), h("span", { class: ["chip", "cr-order-chip", `is-${tone}`] }, statusLabel)),
      h("span", { class: "cr-row-meta" }, h("time", { datetime: when || "" }, ledgerTime(when)))),
    h("span", { class: "cr-row-side" },
      h("b", { class: ["cr-change", change > 0 ? "is-plus" : "is-zero", "tnum"] }, signed(change), h("span", { class: "sr-only" }, " 分")),
      h("span", { class: "cr-after" }, "—")));
}

function ledgerSkeleton() {
  return h("ul", { class: "cr-list", "aria-hidden": "true" },
    [0, 1, 2, 3, 4].map(index => h("li", { class: "cr-row is-skeleton" },
      h("span", { class: "skel", style: { width: "40px", height: "40px", borderRadius: "12px" } }),
      h("span", { class: "cr-row-main" },
        h("span", { class: "skel skel-line", style: { width: `${[36, 28, 40, 32, 30][index]}%` } }),
        h("span", { class: "skel skel-line", style: { width: `${[72, 58, 80, 64, 70][index]}%`, marginTop: "8px" } })),
      h("span", { class: "skel skel-line", style: { width: "44px" } }))));
}

function creditsSkeleton() {
  return h("div", { class: "cr-skeleton", "aria-hidden": "true" },
    h("div", { class: "cr-top" },
      h("div", { class: "cr-balance is-skeleton" }, h("span", { class: "skel", style: { height: "150px", borderRadius: "16px" } })),
      h("div", { class: "cr-quota is-skeleton" }, h("span", { class: "skel", style: { height: "150px", borderRadius: "16px" } }))),
    h("div", { class: "cr-packs" }, [0, 1, 2].map(() => h("span", { class: "skel", style: { height: "128px", borderRadius: "18px" } }))));
}

function creditsView(ctx, body) {
  const head = pageHead({ title: "积分与充值" });
  const summaryNode = h("div", { class: "cr-summary-slot" });
  const packsNode = h("section", { class: "cr-packs-section", id: "cr-packs", "aria-labelledby": "cr-packs-title", tabindex: "-1" });
  const ledgerTitleSub = h("p", { class: "cr-ledger-sub" });
  const filterNode = h("div", { class: "seg cr-filter", role: "tablist", "aria-label": "明细类型" });
  const monthNode = h("div", { class: "cr-month" });
  const listNode = h("div", { class: "cr-rows" });
  // 读屏只播报一句结果，而不是把整张列表重读一遍。
  const ledgerStatus = h("p", { class: "sr-only", role: "status" });
  const pagerNode = h("nav", { class: "cr-pager", "aria-label": "明细分页", hidden: true });
  const ledgerNode = h("section", { class: "cr-ledger", id: "cr-ledger", "aria-labelledby": "cr-ledger-title", tabindex: "-1" },
    h("header", { class: "cr-ledger-head" },
      h("div", null, h("h2", { id: "cr-ledger-title" }, "积分明细"), ledgerTitleSub),
      monthNode),
    filterNode,
    ledgerStatus,
    listNode,
    pagerNode);

  const filterFromQuery = ctx.query.get("kind");
  const ledger = {
    filter: LEDGER_FILTERS.some(([key]) => key === filterFromQuery) ? filterFromQuery : "all",
    month: validMonth(ctx.query.get("month")) ? ctx.query.get("month") : beijingMonth(),
    page: 1,
    requestId: 0,
  };
  if (ledger.month > beijingMonth()) ledger.month = beijingMonth();
  let wantsTopup = ctx.query.get("topup") === "1";
  let latestWallet = null;
  let lastWalletRef;
  let lastKey = null;
  let authPrompted = false;
  const checkout = { sheet: null, token: 0, url: "", dismissed: false, last: null };
  let ledgerFailed = false;

  const currentWallet = () => latestWallet || session.get().wallet || null;
  const currentPacks = () => (Array.isArray(currentWallet()?.packs) ? currentWallet().packs : []);

  /* ---------- 结账事件：跨标签页 ---------- */
  let channel = null;
  try {
    channel = typeof BroadcastChannel === "function" ? new BroadcastChannel(CHECKOUT_CHANNEL_NAME) : null;
  } catch (_) {
    channel = null;
  }
  const publish = detail => {
    try { channel?.postMessage(detail); } catch (_) {}
  };
  channel?.addEventListener("message", event => {
    if (!ctx.isCurrent() || !session.get().authenticated) return;
    const detail = event?.data;
    const context = readCheckoutContext();
    if (!detail || !context || (detail.order_id && detail.order_id !== context.order_id)) return;
    if (detail.type === "cancelled") {
      checkout.token += 1;
      checkout.dismissed = false;
      renderStatus("cancelled", context, null);
      clearCheckoutContext();
    } else if (detail.type === "returned" && detail.session_id === context.checkout_session_id) {
      poll(detail.session_id, context, { attempts: 24, intervalMs: 1250 });
    }
  });
  ctx.cleanup(() => {
    checkout.token += 1;
    try { channel?.close(); } catch (_) {}
  });

  /* ---------- 支付回跳：?checkout=success|cancelled&session_id=…&order_id=… ---------- */
  const searchParams = new URLSearchParams(location.search);
  const pick = key => ctx.query.get(key) || searchParams.get(key) || "";
  let pendingReturn = null;
  const checkoutKind = pick("checkout");
  if (checkoutKind === "success" || checkoutKind === "cancelled") {
    const sessionId = pick("session_id") || pick("checkout_session_id");
    const orderId = pick("order_id");
    const stored = readCheckoutContext();
    const context = stored && (!orderId || !stored.order_id || stored.order_id === orderId) ? stored : null;
    try { history.replaceState(history.state, "", cleanLocation()); } catch (_) {}
    if (checkoutKind === "cancelled") publish({ type: "cancelled", order_id: orderId || context?.order_id || "" });
    else if (sessionId) publish({ type: "returned", order_id: context?.order_id || "", session_id: sessionId });
    pendingReturn = { kind: checkoutKind, sessionId, orderId, context };
  }

  function handleReturn() {
    const info = pendingReturn;
    pendingReturn = null;
    if (!info) return;
    checkout.dismissed = false;
    if (info.kind === "cancelled") {
      checkout.token += 1;
      renderStatus("cancelled", info.context, null);
      clearCheckoutContext();
      return;
    }
    if (!info.sessionId) {
      renderStatus("error", info.context, null);
      return;
    }
    poll(info.sessionId, info.context);
  }

  // 本标签页曾经发起过结账、但回跳发生在别处：回到积分页时静默核验一次。
  async function quietResume() {
    const context = readCheckoutContext();
    if (!context?.checkout_session_id) return;
    try {
      const status = await get(`/api/billing/checkout-sessions/${encodeURIComponent(context.checkout_session_id)}`, { cache: "no-store" });
      if (!ctx.isCurrent() || !session.get().authenticated) return;
      if (status?.status === "paid") {
        clearCheckoutContext();
        await refreshSession().catch(() => {});
        if (!ctx.isCurrent()) return;
        checkout.dismissed = false;
        renderStatus("paid", context, status);
        loadLedger();
      } else if (status?.status === "expired") {
        clearCheckoutContext();
      }
    } catch (_) {}
  }

  /* ---------- 结账面板 ---------- */
  function checkoutSheet(title) {
    if (!checkout.sheet) {
      const sheet = openSheet({
        title,
        body: h("div"),
        footer: h("span"),
        className: "sheet-checkout",
        onClose: () => {
          if (checkout.sheet === sheet) {
            checkout.sheet = null;
            checkout.dismissed = true;
          }
        },
      });
      checkout.sheet = sheet;
    }
    const heading = checkout.sheet.panel.querySelector(".sheet-head h2");
    if (heading) heading.textContent = title;
    return checkout.sheet;
  }

  function openReview(sku, message = "") {
    checkout.token += 1;
    checkout.dismissed = false;
    const wallet = currentWallet();
    const pack = currentPacks().find(item => item.sku === sku) || null;
    if (!pack || !pack.available || !wallet?.topup_enabled) {
      checkout.sheet?.close("unavailable");
      toast("这个套餐暂未开放，请换一个试试", { type: "error" });
      focusPacks();
      return;
    }
    const sheet = checkoutSheet("确认充值套餐");
    const price = money(pack.unit_amount, pack.currency);
    const currency = String(pack.currency || "").toUpperCase();
    const errorNode = h("p", { class: "cr-error", role: "alert", hidden: !message }, message);
    const pay = h("button", { type: "button", class: "btn btn-primary cr-pay" }, icon("external"), `前往 Stripe 付款 · ${price}`);
    const change = h("button", { type: "button", class: "btn btn-ghost" }, "更换套餐");
    sheet.body.replaceChildren(h("div", { class: "cr-review" },
      h("p", { class: "cr-review-lead" }, "确认后前往 Stripe 付款。"),
      checkoutSteps("confirm"),
      errorNode,
      h("section", { class: "cr-summary", "aria-label": "订单摘要" },
        h("div", { class: "cr-summary-main" },
          h("span", null, "本次到账"),
          h("strong", { class: "tnum" }, String(Number(pack.credits) || 0), h("i", null, "积分")),
          h("em", null, String(pack.usage_estimate || "").trim() || "按每次回答的实际消耗结算")),
        h("div", { class: "cr-summary-price" },
          h("span", null, "应付金额"),
          h("strong", { class: "tnum" }, price, h("i", null, currency)),
          h("em", null, "一次性付款"))),
      h("p", { class: "cr-note" }, icon("lock", "icon-sm"), currency === "USD" ? "支付由 Stripe 处理，成功后自动到账；以美元结算。" : "支付由 Stripe 处理，成功后自动到账。")));
    sheet.footer.replaceChildren(change, pay);
    change.addEventListener("click", () => {
      sheet.close("change");
      focusPacks();
    });
    pay.addEventListener("click", () => startCheckout(pack, pay, errorNode));
    // 打开结账失败后回到这里：焦点放在付款按钮上，回车即可重试。
    if (message) requestAnimationFrame(() => { if (pay.isConnected) pay.focus({ preventScroll: true }); });
  }

  // 必须在点击事件里同步打开空白标签页，避免被浏览器拦截弹窗。
  function startCheckout(pack, button, errorNode) {
    if (button.getAttribute("aria-busy") === "true") return;
    let tab = null;
    try { tab = window.open("about:blank", CHECKOUT_WINDOW_NAME); } catch (_) { tab = null; }
    setBusy(button, "正在打开 Stripe…");
    errorNode.hidden = true;
    checkout.sheet?.body.setAttribute("aria-busy", "true");
    post("/api/billing/checkout-sessions", { sku: pack.sku }, { headers: { "Idempotency-Key": newIdempotencyKey() } })
      .then(payload => {
        if (!payload?.url || !payload?.checkout_session_id) throw new Error("Stripe 未返回结账地址");
        const context = {
          order_id: String(payload.order_id || ""),
          checkout_session_id: String(payload.checkout_session_id),
          sku: pack.sku,
          credits: Number(pack.credits) || 0,
          amount_total: Number(pack.unit_amount) || 0,
          return_url: cleanLocation({ keepHashQuery: false }),
          started_at: Date.now(),
        };
        writeCheckoutContext(context);
        checkout.url = String(payload.url);
        if (tab && !tab.closed) {
          try {
            tab.sessionStorage.setItem(CHECKOUT_CONTEXT_KEY, JSON.stringify(context));
            tab.opener = null;
            tab.location.replace(payload.url);
            checkout.sheet?.body.removeAttribute("aria-busy");
            if (ctx.isCurrent()) poll(payload.checkout_session_id, context, { initialKind: "paying", attempts: 90, intervalMs: 1500 });
            return;
          } catch (_) {
            try { tab.close(); } catch (_) {}
          }
        }
        if (ctx.isCurrent()) window.location.assign(payload.url);
      })
      .catch(error => {
        try { tab?.close(); } catch (_) {}
        if (!ctx.isCurrent()) return;
        if (error?.status === 401) refreshSession().catch(() => {});
        checkout.sheet?.body.removeAttribute("aria-busy");
        openReview(pack.sku, error?.message || "暂时无法打开 Stripe 结账页");
      });
  }

  function checkoutDisplay(context, status) {
    const sku = String(status?.sku || context?.sku || "");
    const pack = currentPacks().find(item => item.sku === sku) || null;
    return {
      sku,
      credits: Number(status?.credits || context?.credits || pack?.credits || 0),
      amount: Number(status?.amount_total || context?.amount_total || pack?.unit_amount || 0),
      currency: String(status?.currency || pack?.currency || "usd"),
      returnUrl: String(context?.return_url || ""),
    };
  }

  function closeChildTab() {
    try { window.close(); } catch (_) {}
    setTimeout(() => {
      if (window.closed) return;
      checkout.sheet?.close("close");
      toast("这个标签页可以直接关闭了，回到原来的页面继续使用", { duration: 4200 });
    }, 350);
  }

  function continueUsing(display) {
    checkout.sheet?.close("continue");
    if (!display.returnUrl) return;
    try {
      const target = new URL(display.returnUrl, location.origin);
      if (target.pathname === location.pathname && target.hash && target.hash !== location.hash) ctx.navigate(target.hash.slice(1));
    } catch (_) {}
  }

  function reopenStripe(context, status) {
    const url = checkout.url;
    if (!url) {
      renderStatus("delayed", context, status);
      return;
    }
    let tab = null;
    try { tab = window.open("about:blank", CHECKOUT_WINDOW_NAME); } catch (_) { tab = null; }
    if (!tab) {
      renderStatus("error", context, status);
      return;
    }
    try {
      if (context) tab.sessionStorage.setItem(CHECKOUT_CONTEXT_KEY, JSON.stringify(context));
      tab.opener = null;
      tab.location.replace(url);
    } catch (_) {
      try { tab.close(); } catch (_) {}
      renderStatus("error", context, status);
    }
  }

  function statusActions(kind, context, status, display) {
    const childTab = window.name === CHECKOUT_WINDOW_NAME;
    const sessionId = String(status?.checkout_session_id || context?.checkout_session_id || "");
    const ledgerButton = () => h("button", {
      type: "button",
      class: "btn btn-ghost",
      onClick: () => {
        checkout.sheet?.close("ledger");
        focusLedger();
      },
    }, "查看积分明细");
    if (kind === "paid") {
      return [ledgerButton(), h("button", { type: "button", class: "btn btn-primary", onClick: () => (childTab ? closeChildTab() : continueUsing(display)) }, childTab ? "关闭并返回" : "继续使用")];
    }
    if (kind === "paying") {
      return [ledgerButton(), h("button", { type: "button", class: "btn btn-primary", onClick: () => reopenStripe(context, status) }, icon("external"), "打开 Stripe 付款页")];
    }
    if (kind === "delayed" || kind === "error") {
      return [ledgerButton(), h("button", {
        type: "button",
        class: "btn btn-primary",
        onClick: () => (sessionId ? poll(sessionId, context, { attempts: 8, intervalMs: 1250 }) : renderStatus("error", context, status)),
      }, icon("refresh"), "刷新状态")];
    }
    if (kind === "cancelled" || kind === "expired") {
      return [
        childTab ? h("button", { type: "button", class: "btn btn-ghost", onClick: closeChildTab }, "关闭并返回") : ledgerButton(),
        display.sku ? h("button", { type: "button", class: "btn btn-primary", onClick: () => openReview(display.sku) }, "重新付款") : null,
      ].filter(Boolean);
    }
    return [ledgerButton()];
  }

  function renderStatus(kind, context, status) {
    const copy = STATUS_COPY[kind] || STATUS_COPY.error;
    const display = checkoutDisplay(context, status);
    checkout.last = { kind, context, status };
    if (!checkout.sheet && checkout.dismissed) {
      // 面板被关掉后仍在后台核验：到账时轻提示一下即可。
      if (kind === "paid") toast(`${display.credits ? `${display.credits} 积分` : "充值积分"}已到账`, { type: "ok" });
      return;
    }
    const sheet = checkoutSheet("充值状态");
    const title = kind === "paid" && display.credits ? `${display.credits} 积分已到账` : copy.title;
    const heading = h("h3", { class: "cr-status-title", tabindex: "-1" }, title);
    const balance = Number(status?.wallet?.balance ?? session.get().wallet?.balance ?? 0);
    const price = display.amount ? money(display.amount, display.currency) : "";
    sheet.body.removeAttribute("aria-busy");
    sheet.body.replaceChildren(h("div", { class: ["cr-status", `is-${copy.tone}`] },
      h("div", { class: "cr-status-top", "aria-live": "polite" },
        h("span", { class: "cr-status-eyebrow" }, copy.eyebrow),
        heading,
        copy.text ? h("p", { class: "cr-status-text" }, copy.text) : null,
        kind === "pending" ? h("div", { class: "cr-progress", role: "progressbar", "aria-label": "正在核验 Stripe 付款结果" }, h("i")) : null),
      checkoutSteps(copy.step),
      display.credits > 0 && display.amount > 0 ? h("dl", { class: ["cr-order", kind !== "paid" && "is-compact"] },
        h("div", null, h("dt", null, "本次套餐"), h("dd", { class: "tnum" }, `${display.credits} 积分`)),
        h("div", null, h("dt", null, "一次性付款"), h("dd", { class: "tnum" }, `${price} ${display.currency.toUpperCase()}`)),
        kind === "paid" ? h("div", null, h("dt", null, "账户积分余额"), h("dd", { class: "tnum" }, `${number(balance)} 分`)) : null) : null));
    sheet.footer.replaceChildren(...statusActions(kind, context, status, display));
    // 进行中的状态不抢焦点；但原来聚焦的按钮被替换掉时，把焦点放到标题上，避免跑出对话框。
    const focusLost = !sheet.panel.contains(document.activeElement);
    if ((kind !== "paying" && kind !== "pending") || focusLost) requestAnimationFrame(() => heading.focus({ preventScroll: true }));
  }

  async function poll(sessionId, context, { initialKind = "pending", attempts = 12, intervalMs = 1250 } = {}) {
    const token = ++checkout.token;
    checkout.dismissed = false;
    renderStatus(initialKind, context, { checkout_session_id: sessionId });
    const live = () => token === checkout.token && ctx.isCurrent();
    let last = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (!live()) return;
      if (attempt) await sleep(intervalMs);
      if (!live()) return;
      try {
        last = await get(`/api/billing/checkout-sessions/${encodeURIComponent(sessionId)}`, { cache: "no-store" });
        if (!live()) return;
        if (last?.status === "paid") {
          await refreshSession().catch(() => {});
          if (!live()) return;
          clearCheckoutContext();
          renderStatus("paid", context, last);
          loadLedger();
          return;
        }
        if (last?.status === "expired") {
          clearCheckoutContext();
          renderStatus("expired", context, last);
          return;
        }
      } catch (_) {
        if (attempt === attempts - 1) {
          if (live()) renderStatus("error", context, last || { checkout_session_id: sessionId });
          return;
        }
      }
    }
    if (live()) renderStatus("delayed", context, last || { checkout_session_id: sessionId });
  }

  /* ---------- 余额与套餐 ---------- */
  // 减少动态效果时直接跳转，不做平滑滚动。
  const scrollBehavior = () => (reducedMotion() ? "auto" : "smooth");

  function focusPacks({ smooth = !reducedMotion() } = {}) {
    packsNode.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
    const first = packsNode.querySelector(".cr-pack:not([disabled])");
    setTimeout(() => (first || packsNode).focus({ preventScroll: true }), smooth ? 360 : 0);
  }

  function focusLedger() {
    ledgerNode.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
    setTimeout(() => ledgerNode.focus({ preventScroll: true }), reducedMotion() ? 0 : 360);
  }

  function paintSummary() {
    const state = session.get();
    const wallet = currentWallet();
    summaryNode.replaceChildren(h("section", { class: "cr-top", "aria-label": "积分概览" },
      h("div", { class: "cr-balance" },
        h("span", { class: "cr-label" }, icon("coins", "icon-sm"), "当前余额"),
        h("p", { class: "cr-balance-value" }, h("b", { class: "tnum" }, number(wallet?.balance)), h("span", null, "分")),
        h("p", { class: "cr-guarantee" }, icon("check", "icon-sm"), "回答始终完整送达，余额最低为 0。"),
        h("button", { type: "button", class: "btn cr-topup", onClick: () => focusPacks() }, icon("plus"), "充值")),
      quotaBlock(state.quota)));
  }

  function paintPacks() {
    const wallet = currentWallet();
    const packs = currentPacks();
    const enabled = !!wallet?.topup_enabled;
    const packButton = pack => {
      const available = enabled && !!pack?.available;
      const credits = Math.max(0, Number(pack?.credits) || 0);
      const price = money(pack?.unit_amount, pack?.currency);
      const { main, bonus } = splitEstimate(pack?.usage_estimate);
      return h("button", {
        type: "button",
        class: ["cr-pack", bonus && available && "has-bonus"],
        disabled: !available,
        "aria-label": `${credits} 积分，${price}，${available ? main : "暂未开放"}${bonus && available ? `，${bonus}` : ""}`,
        onClick: () => openReview(pack.sku),
      },
      h("span", { class: "cr-pack-top" },
        h("span", { class: "cr-pack-credits" }, h("b", { class: "tnum" }, String(credits)), h("span", null, "积分")),
        bonus && available ? h("span", { class: "cr-pack-bonus" }, bonus) : null),
      h("span", { class: "cr-pack-price tnum" }, price),
      h("span", { class: "cr-pack-est" }, available ? main : "暂未开放"),
      available ? h("span", { class: "cr-pack-go", "aria-hidden": "true" }, icon("arrowRight")) : null);
    };
    packsNode.replaceChildren(
      h("div", { class: "cr-section-head" },
        h("h2", { id: "cr-packs-title" }, "积分充值"),
        h("p", null, "一次性付款 · 积分长期有效 · Stripe 安全结账")),
      packs.length
        ? h("div", { class: "cr-packs" }, packs.map(packButton))
        : h("div", { class: "cr-packs-empty" }, icon("info"), h("span", null, "充值暂未开放")));
  }

  /* ---------- 明细 ---------- */
  function minMonth() {
    const created = session.get().user?.created_at;
    const date = created ? new Date(created) : null;
    const fromAccount = date && !Number.isNaN(date.getTime()) ? monthOf(date) : "";
    return fromAccount || shiftMonth(beijingMonth(), -23);
  }

  function syncLedgerUrl() {
    if (!ctx.isCurrent()) return;
    const params = new URLSearchParams();
    if (ledger.month !== beijingMonth()) params.set("month", ledger.month);
    if (ledger.filter !== "all") params.set("kind", ledger.filter);
    const text = params.toString();
    try { history.replaceState(history.state, "", `${location.pathname}${location.search}#/me/credits${text ? `?${text}` : ""}`); } catch (_) {}
  }

  function paintMonth() {
    const focused = monthNode.contains(document.activeElement) ? document.activeElement.dataset.control : "";
    const max = beijingMonth();
    const min = minMonth() <= max ? minMonth() : max;
    const options = monthRange(min, max);
    if (!options.includes(ledger.month)) options.push(ledger.month);
    const select = h("select", { class: "select cr-month-select", "aria-label": "选择月份", "data-control": "select" },
      options.map(value => h("option", { value }, monthLabel(value))));
    select.value = ledger.month;
    select.addEventListener("change", () => setMonth(select.value));
    const earliest = options[options.length - 1];
    monthNode.replaceChildren(
      h("button", { type: "button", class: "icon-btn cr-month-step", "aria-label": "上个月", "data-control": "prev", disabled: ledger.month <= earliest, onClick: () => setMonth(shiftMonth(ledger.month, -1)) }, icon("back")),
      select,
      h("button", { type: "button", class: "icon-btn cr-month-step", "aria-label": "下个月", "data-control": "next", disabled: ledger.month >= max, onClick: () => setMonth(shiftMonth(ledger.month, 1)) }, icon("chevronRight")));
    ledgerTitleSub.textContent = monthLabel(ledger.month);
    if (focused) {
      const target = monthNode.querySelector(`[data-control="${focused}"]`);
      (target && !target.disabled ? target : select).focus({ preventScroll: true });
    }
  }

  function setMonth(value) {
    const max = beijingMonth();
    const next = validMonth(value) ? (value > max ? max : value) : max;
    if (next === ledger.month) return;
    ledger.month = next;
    ledger.page = 1;
    syncLedgerUrl();
    paintMonth();
    loadLedger();
  }

  function paintFilter() {
    const hadFocus = filterNode.contains(document.activeElement);
    filterNode.replaceChildren(...LEDGER_FILTERS.map(([key, label]) => h("button", {
      type: "button",
      role: "tab",
      "aria-selected": String(ledger.filter === key),
      tabindex: ledger.filter === key ? "0" : "-1",
      "data-filter": key,
      onClick: () => setFilter(key),
    }, label)));
    if (hadFocus) filterNode.querySelector(`[data-filter="${ledger.filter}"]`)?.focus({ preventScroll: true });
  }

  function setFilter(key) {
    if (ledger.filter === key) return;
    ledger.filter = key;
    ledger.page = 1;
    syncLedgerUrl();
    paintFilter();
    loadLedger();
  }

  filterNode.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = LEDGER_FILTERS.findIndex(([key]) => key === ledger.filter);
    const next = event.key === "Home" ? 0
      : event.key === "End" ? LEDGER_FILTERS.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + LEDGER_FILTERS.length) % LEDGER_FILTERS.length;
    setFilter(LEDGER_FILTERS[next][0]);
    filterNode.querySelector(`[data-filter="${LEDGER_FILTERS[next][0]}"]`)?.focus();
  });

  function paintPager(pagination) {
    const page = Math.max(1, Number(pagination?.page) || 1);
    const pageCount = Math.max(1, Number(pagination?.page_count) || 1);
    if (pageCount <= 1 && page <= 1) {
      pagerNode.hidden = true;
      pagerNode.replaceChildren();
      return;
    }
    const go = target => {
      ledger.page = target;
      ledger.focusPager = pagerNode.contains(document.activeElement);
      loadLedger();
      ledgerNode.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
    };
    pagerNode.hidden = false;
    pagerNode.replaceChildren(
      h("button", { type: "button", class: "btn btn-sm btn-ghost", disabled: page <= 1, onClick: () => go(page - 1) }, icon("back"), "上一页"),
      h("span", { class: "cr-pager-info tnum", "aria-live": "polite" }, `第 ${page} / ${pageCount} 页`),
      h("button", { type: "button", class: "btn btn-sm btn-ghost", disabled: page >= pageCount, onClick: () => go(page + 1) }, "下一页", icon("chevronRight")));
  }

  // 换内容前把明细卡片撑到当前视口底部：新内容更短时，浏览器不会把页面往上拽，筛选栏停在原处。
  function holdLedger() {
    const reach = Math.floor(window.innerHeight - ledgerNode.getBoundingClientRect().top);
    ledgerNode.style.minHeight = reach > 0 && window.scrollY > 0 ? `${reach}px` : "";
  }

  async function loadLedger() {
    const requestId = ++ledger.requestId;
    const isOrders = ledger.filter === "orders";
    listNode.setAttribute("aria-busy", "true");
    ledgerStatus.textContent = "正在读取明细…";
    if (listNode.firstElementChild && !listNode.querySelector(".is-skeleton")) {
      // 切换类型 / 月份 / 翻页：旧内容先变淡留在原处，新数据回来再替换，高度不塌、页面不跳。
      listNode.classList.add("is-loading");
      pagerNode.classList.add("is-loading");
    } else {
      listNode.replaceChildren(ledgerSkeleton());
      pagerNode.hidden = true;
    }
    ledgerTitleSub.textContent = monthLabel(ledger.month);
    const settle = () => {
      listNode.classList.remove("is-loading");
      pagerNode.classList.remove("is-loading");
      listNode.setAttribute("aria-busy", "false");
    };
    try {
      const path = isOrders
        ? `/api/billing/orders${query({ page: ledger.page, month: ledger.month, status: "all" })}`
        : `/api/billing/activity${query({ page: ledger.page, month: ledger.month, kind: ledger.filter })}`;
      const data = await get(path, { cache: "no-store" });
      if (!ctx.isCurrent() || requestId !== ledger.requestId) return;
      if (!isOrders && data?.wallet && typeof data.wallet === "object") {
        latestWallet = data.wallet;
        paintSummary();
        paintPacks();
      }
      const items = Array.isArray(data?.items) ? data.items : [];
      ledgerFailed = false;
      holdLedger();
      settle();
      const total = Number(data?.pagination?.total);
      ledgerTitleSub.textContent = Number.isFinite(total) && items.length ? `${monthLabel(ledger.month)} · 共 ${total} 条` : monthLabel(ledger.month);
      const filterLabel = (LEDGER_FILTERS.find(([key]) => key === ledger.filter) || LEDGER_FILTERS[0])[1];
      ledgerStatus.textContent = items.length
        ? `${monthLabel(ledger.month)}「${filterLabel}」明细，${Number.isFinite(total) ? `共 ${total} 条` : `${items.length} 条`}`
        : EMPTY_LEDGER[ledger.filter] || EMPTY_LEDGER.all;
      if (!items.length) {
        listNode.replaceChildren(h("div", { class: "cr-empty" },
          h("b", null, EMPTY_LEDGER[ledger.filter] || EMPTY_LEDGER.all),
          h("span", null, "有新的积分变动后会显示在这里。")));
      } else {
        listNode.replaceChildren(h("ul", { class: "cr-list" }, items.map(item => (isOrders ? orderRow(item) : activityRow(item)))));
      }
      paintPager(data?.pagination);
      if (ledger.focusPager) {
        ledger.focusPager = false;
        ledgerNode.focus({ preventScroll: true });
      }
    } catch (error) {
      if (!ctx.isCurrent() || requestId !== ledger.requestId) return;
      if (error?.status === 401) refreshSession().catch(() => {});
      ledgerFailed = true;
      holdLedger();
      settle();
      ledgerStatus.textContent = "";
      listNode.replaceChildren(retryState({ title: "积分记录加载失败", text: error?.message || "请稍后再试", onRetry: () => loadLedger() }));
      pagerNode.hidden = true;
    }
  }

  /* ---------- 登录状态 ---------- */
  function sync() {
    const state = session.get();
    const key = !state.ready ? "loading" : state.authenticated ? `user:${state.user?.id || ""}` : "anon";
    if (state.wallet !== lastWalletRef) {
      lastWalletRef = state.wallet;
      latestWallet = null;
    }
    if (key !== lastKey) {
      lastKey = key;
      ledger.requestId += 1;
      if (key === "loading") {
        body.replaceChildren(head, creditsSkeleton());
        return;
      }
      if (key === "anon") {
        checkout.token += 1;
        checkout.sheet?.close("logout");
        const reason = pendingReturn ? "登录后查看充值状态。" : "登录后管理积分。";
        body.replaceChildren(head, loginCard(ctx, {
          title: pendingReturn ? "登录后查看充值状态" : "登录后管理积分",
          text: "积分余额、充值与流水只对本人可见。",
          reason,
        }));
        if (pendingReturn && !authPrompted) {
          authPrompted = true;
          ctx.openAuth({ reason });
        }
        return;
      }
      body.replaceChildren(head, summaryNode, packsNode, ledgerNode);
      paintSummary();
      paintPacks();
      paintFilter();
      paintMonth();
      loadLedger();
      if (pendingReturn) setTimeout(() => { if (ctx.isCurrent()) handleReturn(); }, 60);
      else quietResume();
      if (wantsTopup) {
        wantsTopup = false;
        syncLedgerUrl();
        requestAnimationFrame(() => focusPacks({ smooth: false }));
      }
      return;
    }
    if (state.authenticated) {
      paintSummary();
      paintPacks();
    }
  }
  // 断线恢复：网络恢复后重试失败的明细加载；到账核验因网络中断时自动重新核验。
  const recover = () => {
    if (!ctx.isCurrent() || !session.get().authenticated) return;
    if (ledgerFailed) loadLedger();
    const last = checkout.last;
    const sessionId = String(last?.status?.checkout_session_id || last?.context?.checkout_session_id || "");
    if (last?.kind === "error" && sessionId && checkout.sheet) poll(sessionId, last.context, { attempts: 8, intervalMs: 1250 });
  };
  window.addEventListener("online", recover);
  ctx.cleanup(() => window.removeEventListener("online", recover));

  sync();
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
        text: "设置社区昵称，查看档案、积分与消息。",
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
  const tab = TABS.find(item => item.key === requested) || TABS[0];
  const body = h("div", { class: "me-body" });
  const node = h("div", { class: ["me-page", `is-${tab.key || "home"}`] }, tabStrip(tab.key), body);
  const views = { "": overviewView, archives: archivesView, credits: creditsView, settings: settingsView };
  views[tab.key](ctx, body);
  return { node, title: tab.title };
}
