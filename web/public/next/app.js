// 玄枢 Web 入口：页面外壳、路由、账户会话与主题。
// 只依赖公开接口；旧版地址（?post=、?start=、?view=、支付返回等）在启动时映射到对应页面。
import { h, $, on, reducedMotion } from "./lib/dom.js?v=n2";
import { icon, brandMark } from "./lib/icons.js?v=n2";
import { defineRoutes, startRouter, navigate, back, currentRoute, parse } from "./lib/router.js?v=n2";
import { session, inbox, refreshSession, logout, displayName, local } from "./lib/store.js?v=n2";
import { get } from "./lib/api.js?v=n2";
import { openMenu, closeMenus, closeAllSheets } from "./ui/overlay.js?v=n2";
import { toast } from "./ui/toast.js?v=n2";
import { openAuth } from "./views/auth.js?v=n2";
import * as FeedView from "./views/feed.js?v=n2";
import * as PostView from "./views/post.js?v=n2";
import * as AskView from "./views/ask.js?v=n2";
import * as ReadingView from "./views/reading.js?v=n2";
import * as TodayView from "./views/today.js?v=n2";
import * as InboxView from "./views/inbox.js?v=n2";
import * as MeView from "./views/me.js?v=n2";
import { openFeedback } from "./views/feedback.js?v=n2";
import { routeFromLegacy } from "./lib/legacy.js?v=n2";

const THEME_KEY = "xz-next-theme";

/* ---------- 主题 ---------- */
const systemDark = window.matchMedia?.("(prefers-color-scheme: dark)");

export function themePreference() {
  const value = local.get(THEME_KEY, "auto");
  return value === "light" || value === "dark" ? value : "auto";
}

function applyTheme() {
  const pref = themePreference();
  const dark = pref === "dark" || (pref === "auto" && !!systemDark?.matches);
  document.documentElement.dataset.scheme = dark ? "dark" : "light";
  document.documentElement.dataset.schemePref = pref;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", dark ? "#1A1A1C" : "#FFFFFF");
}

export function setTheme(pref) {
  local.set(THEME_KEY, pref);
  applyTheme();
}
systemDark?.addEventListener?.("change", applyTheme);

/* ---------- 登录门槛 ---------- */
// force：服务端已返回 401 时先向服务器确认登录状态，避免本地仍以为已登录而反复重试。
// mode：打开登录面板时默认停在哪个方式（如 "register"）。
let reauthing = false;

export async function requireAuth(reason, { mode = "", force = false } = {}) {
  // 重新登录的过程中会话会先变为未登录；这时留在原页面等用户登录，不当作会话失效处理。
  reauthing = true;
  try {
    if (force) {
      try { await refreshSession({ force: true }); } catch (_) {}
    }
    if (session.get().authenticated) return true;
    return await openAuth(mode ? { reason, mode } : { reason });
  } finally {
    reauthing = false;
  }
}

/* ---------- 外壳 ---------- */
const NAV = [
  { key: "plaza", label: "广场", href: "#/", glyph: "plaza", match: path => path === "/" || path.startsWith("/post") },
  { key: "today", label: "今日", href: "#/today", glyph: "sun", match: path => path.startsWith("/today") },
  { key: "mine", label: "我的盘", href: "#/me/archives", glyph: "book", match: path => path.startsWith("/me/archives") || path.startsWith("/reading") },
];

const shell = {};

function buildShell() {
  const app = document.getElementById("app");
  const bell = h("a", { class: "icon-btn", href: "#/inbox", "aria-label": "消息" }, icon("bell"), h("span", { class: "badge", hidden: true, "data-inbox-badge": "" }));
  const accountSlot = h("div", { class: "topbar-account" });
  const topbar = h("header", { class: "topbar" },
    h("div", { class: "topbar-inner" },
      h("button", { type: "button", class: "icon-btn topbar-back", "aria-label": "返回", onClick: () => back("/") }, icon("back")),
      h("a", { class: "brand", href: "#/", "aria-label": "玄枢首页" }, brandMark(), h("span", { class: "brand-name" }, "玄枢")),
      h("nav", { class: "nav-tabs", "aria-label": "主导航" },
        NAV.map(item => h("a", { class: "nav-tab", href: item.href, "data-nav": item.key }, item.label))),
      h("div", { class: "topbar-actions" },
        h("a", { class: "btn btn-primary btn-ask", href: "#/ask" }, icon("plus"), "提问"),
        bell,
        accountSlot)));
  const main = h("main", { id: "main", class: "main", tabindex: "-1" });
  const tabBadge = h("span", { class: "badge", hidden: true, "data-inbox-badge": "" });
  const tabbar = h("nav", { class: "tabbar", "aria-label": "底部导航" },
    h("a", { class: "tab", href: "#/", "data-tab": "plaza" }, icon("plaza"), h("span", null, "广场")),
    h("a", { class: "tab", href: "#/today", "data-tab": "today" }, icon("sun"), h("span", null, "今日")),
    h("a", { class: "tab tab-ask", href: "#/ask", "aria-label": "提问" }, icon("plus")),
    h("a", { class: "tab", href: "#/inbox", "data-tab": "inbox" }, icon("bell"), h("span", null, "消息"), tabBadge),
    h("a", { class: "tab", href: "#/me", "data-tab": "me" }, icon("user"), h("span", null, "我")));
  const skip = h("a", { class: "skip-link", href: "#main", onClick: event => { event.preventDefault(); main.focus(); } }, "跳到主要内容");
  const netBanner = h("div", { class: "net-banner", role: "status", hidden: true }, icon("alert"), h("span", null, "网络已断开，恢复后会自动重试"));
  app.replaceChildren(skip, topbar, netBanner, main, tabbar);
  app.dataset.state = "ready";
  Object.assign(shell, { app, topbar, main, tabbar, accountSlot, netBanner });
  // 再点一次当前所在的导航：先回到顶部；已在顶部时刷新当前页。
  topbar.addEventListener("click", onNavTap);
  tabbar.addEventListener("click", onNavTap);
}

function onNavTap(event) {
  const link = event.target instanceof Element ? event.target.closest('a[href^="#/"]') : null;
  if (!link || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const current = location.hash && location.hash !== "#" ? location.hash : "#/";
  if (link.getAttribute("href") !== current) return;
  event.preventDefault();
  if (window.scrollY > 8) {
    window.scrollTo({ top: 0, behavior: reducedMotion() ? "auto" : "smooth" });
    return;
  }
  if (refreshHandlers.length) refreshHandlers.forEach(fn => { try { fn(); } catch (_) {} });
  else renderRoute(currentRoute(), currentRoute(), {});
}

/* ---------- 网络状态 ---------- */
function syncNetwork(recovered = false) {
  const offline = navigator.onLine === false;
  if (shell.netBanner) shell.netBanner.hidden = !offline;
  document.documentElement.classList.toggle("is-offline", offline);
  if (recovered && !offline) toast("网络已恢复", { type: "ok" });
}
window.addEventListener("offline", () => syncNetwork());
window.addEventListener("online", () => syncNetwork(true));

/* ---------- 输入时收起底栏 ---------- */
// 手机键盘弹出时底栏会浮在键盘上方挡住输入框；输入期间给根元素加 is-typing 并隐藏底栏。
const TEXT_FIELD = 'textarea, select, [contenteditable="true"], input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="range"])';
document.addEventListener("focusin", event => {
  if (!(event.target instanceof Element) || !event.target.matches(TEXT_FIELD)) return;
  document.documentElement.classList.add("is-typing");
  if (shell.tabbar) shell.tabbar.hidden = true;
});
document.addEventListener("focusout", () => {
  setTimeout(() => {
    const focused = document.activeElement;
    if (focused instanceof Element && focused.matches(TEXT_FIELD)) return;
    document.documentElement.classList.remove("is-typing");
    if (shell.tabbar) shell.tabbar.hidden = false;
  }, 80);
});

function renderAccountSlot() {
  const state = session.get();
  const slot = shell.accountSlot;
  if (!slot) return;
  if (!state.ready) {
    slot.replaceChildren(h("span", { class: "skel", style: { width: "72px", height: "34px", borderRadius: "999px" } }));
    return;
  }
  if (!state.authenticated) {
    slot.replaceChildren(h("button", { type: "button", class: "btn btn-ghost topbar-login", "aria-label": "登录或注册", onClick: () => openAuth() }, icon("user"), h("span", { class: "topbar-login-label" }, "登录")));
    return;
  }
  const name = displayName(state.user);
  // 直接写昵称：不把名字缩成一个字再套圆圈。
  const button = h("button", { type: "button", class: "btn btn-ghost topbar-account", "aria-haspopup": "menu", "aria-expanded": "false", "aria-label": `${name}的账户菜单`, title: name },
    h("span", { class: "topbar-account-name" }, name), icon("chevronDown", "icon-sm"));
  button.addEventListener("click", () => openAccountMenu(button));
  slot.replaceChildren(button);
}

export function openAccountMenu(anchor) {
  const state = session.get();
  const name = displayName(state.user);
  const balance = state.wallet ? `${state.wallet.balance ?? 0} 分` : "";
  const pref = themePreference();
  const nextTheme = pref === "auto" ? "light" : pref === "light" ? "dark" : "auto";
  const themeLabel = { auto: "跟随系统", light: "浅色", dark: "深色" };
  openMenu(anchor, [
    { label: "我的主页", icon: "user", href: "#/me" },
    { label: "我的盘", icon: "book", href: "#/me/archives" },
    { label: "积分", icon: "coins", href: "#/me/credits", meta: balance },
    "sep",
    { label: "外观", icon: pref === "dark" ? "moon" : pref === "light" ? "sun" : "monitor", meta: themeLabel[pref], onSelect: () => { setTheme(nextTheme); toast(`外观：${themeLabel[nextTheme]}`); } },
    { label: "意见反馈", icon: "message", onSelect: () => openFeedback() },
    "sep",
    { label: "退出登录", icon: "logout", onSelect: doLogout },
  ], {
    head: h("div", { class: "menu-head" }, h("div", null, h("b", null, name), h("span", null, state.user?.email || ""))),
  });
}

let loggingOut = false;

export async function doLogout() {
  loggingOut = true;
  try {
    await logout();
    toast("已退出登录");
    const path = currentRoute()?.path || "/";
    if (/^\/(me|reading|inbox)/.test(path)) navigate("/", { replace: true });
    else renderRoute(currentRoute(), null, {});
  } catch (error) {
    toast(error.message || "退出没有成功，请稍后再试", { type: "error" });
  } finally {
    loggingOut = false;
  }
}

// 会话自己结束（过期、在其他标签页退出）：离开只属于本人的页面，并提示重新登录。
function onSessionEnded() {
  if (loggingOut || reauthing) return;
  const path = currentRoute()?.path || "/";
  if (/^\/(me|reading|inbox)/.test(path)) navigate("/", { replace: true });
  toast("登录已失效，请重新登录", { type: "error", action: { label: "登录", onClick: () => openAuth() } });
}

/* ---------- 邀请提示 ---------- */
// 通过好友分享链接（?ref=invite）进来的游客：提示注册领取每日免费积分；登录后自动收起。
const INVITE_DISMISS_KEY = "xz-invite-dismissed";
let inviteCard = null;

function showInvitePrompt() {
  const ref = new URLSearchParams(location.search).get("ref");
  if (ref !== "invite" || session.get().authenticated || inviteCard) return;
  try { if (sessionStorage.getItem(INVITE_DISMISS_KEY) === "1") return; } catch (_) {}
  const close = () => {
    try { sessionStorage.setItem(INVITE_DISMISS_KEY, "1"); } catch (_) {}
    inviteCard?.remove();
    inviteCard = null;
  };
  inviteCard = h("aside", { class: "float-card invite-card", "aria-label": "好友邀请" },
    h("div", { class: "invite-top" },
      h("span", { class: "invite-mark", "aria-hidden": "true" }, icon("users")),
      h("div", null, h("h2", null, "朋友分享了一条真实卦帖"), h("p", null, "注册后领取每日免费积分，也能和卦友一起讨论。"))),
    h("div", { class: "float-actions" },
      h("button", { type: "button", class: "btn btn-ghost btn-sm", onClick: close }, "稍后"),
      h("button", { type: "button", class: "btn btn-primary btn-sm", onClick: () => openAuth({ mode: "register", reason: "首次有效提问会为分享者增加每日积分。" }) }, "注册")));
  document.body.append(inviteCard);
}

function syncNav(path) {
  shell.topbar.querySelectorAll("[data-nav]").forEach(link => {
    const item = NAV.find(entry => entry.key === link.dataset.nav);
    if (item && item.match(path)) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  const tabKey = path === "/" || path.startsWith("/post") ? "plaza"
    : path.startsWith("/today") ? "today"
      : path.startsWith("/inbox") ? "inbox"
        : path.startsWith("/me") || path.startsWith("/reading") ? "me" : "";
  shell.tabbar.querySelectorAll("[data-tab]").forEach(link => {
    if (link.dataset.tab === tabKey) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  shell.app.dataset.route = path.split("/")[1] || "plaza";
  // 底栏一级页面之外都算子页面：手机顶栏显示返回键。
  shell.app.dataset.depth = ["/", "/today", "/inbox", "/me"].includes(path) ? "root" : "sub";
}

/* ---------- 消息数 ---------- */
let inboxTimer = null;

export async function refreshInbox() {
  if (!session.get().authenticated) {
    inbox.set({ unread: 0, loaded: false });
    return;
  }
  try {
    const data = await get("/api/community/notifications?limit=1");
    const summary = data?.summary || {};
    inbox.set({ unread: Number(summary.unread_count ?? summary.unread ?? 0) || 0, loaded: true });
  } catch (_) {}
}

function syncInboxBadge({ unread }) {
  document.querySelectorAll("[data-inbox-badge]").forEach(badge => {
    badge.hidden = !unread;
    badge.textContent = unread > 99 ? "99+" : String(unread || "");
  });
  applyTitle();
}

/* ---------- 标签页标题 ---------- */
let baseTitle = "玄枢 · 免费八字排盘与六爻起卦 AI 解读";
let attentionLabel = "";

function applyTitle() {
  const unread = inbox.get().unread || 0;
  const prefix = attentionLabel ? `【${attentionLabel}】` : unread ? `(${unread > 99 ? "99+" : unread}) ` : "";
  document.title = prefix + baseTitle;
}

// 页面在后台时（例如解读完成），在标签页标题上提示一次，回到页面后自动清除。
export function attention(label) {
  if (document.visibilityState === "visible" || !label) return;
  attentionLabel = label;
  applyTitle();
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && attentionLabel) {
    attentionLabel = "";
    applyTitle();
  }
});

function scheduleInbox() {
  clearInterval(inboxTimer);
  if (!session.get().authenticated) return;
  inboxTimer = setInterval(() => {
    if (document.visibilityState === "visible") refreshInbox();
  }, 60 * 1000);
}

/* ---------- 路由渲染 ---------- */
let active = null;
let renderToken = 0;
const activeCleanups = [];
const refreshHandlers = [];

const ctxBase = {
  navigate,
  back,
  requireAuth,
  openAuth,
  session,
  toast,
  refreshInbox,
  setTheme,
  themePreference,
  logout: () => doLogout(),
  attention,
  setTitle(title) {
    baseTitle = title ? `${title} · 玄枢` : "玄枢 · 免费八字排盘与六爻起卦 AI 解读";
    applyTitle();
  },
};

function renderRoute(match, previous, { restoreScroll } = {}) {
  if (!match) return;
  closeMenus();
  closeAllSheets();
  const token = ++renderToken;
  try { active?.destroy?.(); } catch (_) {}
  try { activeCleanups.splice(0).forEach(fn => fn()); } catch (_) {}
  active = null;
  refreshHandlers.length = 0;
  const view = match.route?.view || FeedView;
  const ctx = {
    ...ctxBase,
    params: match.params,
    query: match.query,
    path: match.path,
    isCurrent: () => token === renderToken,
    // 视图内订阅：离开页面时自动退订。
    subscribe(store, listener, options) {
      const stop = store.subscribe(state => { if (token === renderToken) listener(state); }, options);
      activeCleanups.push(stop);
      return stop;
    },
    cleanup(fn) { activeCleanups.push(fn); },
    // 用户再次点当前导航且已在顶部时调用（例如重新拉取最新内容）。
    onRefresh(fn) { if (token === renderToken) refreshHandlers.push(fn); },
  };
  syncNav(match.path);
  const result = view.render(ctx) || {};
  active = result;
  const node = result.node || h("div");
  node.classList.add("view");
  shell.main.replaceChildren(node);
  shell.app.dataset.layout = result.layout || "page";
  document.body.dataset.layout = result.layout || "page";
  ctxBase.setTitle(result.title || "");
  if (typeof restoreScroll === "number") {
    requestAnimationFrame(() => window.scrollTo(0, restoreScroll));
    result.onRestore?.(restoreScroll);
  } else {
    window.scrollTo(0, 0);
    if (previous) shell.main.focus({ preventScroll: true });
  }
}

const ROUTES = [
  { path: "/", view: FeedView },
  { path: "/post/:slug", view: PostView },
  { path: "/ask", view: AskView },
  { path: "/ask/:system", view: AskView },
  { path: "/reading/:id", view: ReadingView },
  { path: "/today", view: TodayView },
  { path: "/inbox", view: InboxView },
  { path: "/me", view: MeView },
  { path: "/me/:tab", view: MeView },
];

/* ---------- 启动 ---------- */
function boot() {
  applyTheme();
  const legacy = routeFromLegacy(location.search);
  if (legacy) {
    history.replaceState(history.state, "", `${location.pathname}${legacy}`);
  }
  buildShell();
  syncNetwork();
  renderAccountSlot();
  session.subscribe(state => {
    renderAccountSlot();
    scheduleInbox();
  });
  inbox.subscribe(syncInboxBadge);
  document.addEventListener("xz:authchange", event => {
    refreshInbox();
    if (event.detail?.authenticated) {
      inviteCard?.remove();
      inviteCard = null;
    } else {
      onSessionEnded();
    }
  });
  let lastCheck = Date.now();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !session.get().authenticated) return;
    refreshInbox();
    if (Date.now() - lastCheck > 60 * 1000) {
      lastCheck = Date.now();
      refreshSession().catch(() => {});
    }
  });
  on(document, "click", "[data-open-auth]", event => { event.preventDefault(); openAuth(); });
  on(document, "click", "[data-open-feedback]", event => { event.preventDefault(); openFeedback(); });
  defineRoutes(ROUTES, renderRoute);
  refreshSession()
    .then(() => { refreshInbox(); showInvitePrompt(); })
    .catch(() => toast("暂时连不上服务器，部分内容可能无法加载", { type: "error" }))
    .finally(() => startRouterOnce());
  // 会话请求慢时也先把页面渲染出来，账户状态回来后再刷新相关区域。
  setTimeout(startRouterOnce, 350);
}

let started = false;
function startRouterOnce() {
  if (started) return;
  started = true;
  startRouter();
}

boot();
