// 哈希路由：静态托管下无需服务端改写；浏览器前进后退时恢复原滚动位置。
// 每条历史记录在 history.state 里带一个序号：新打开的页面记新序号（不恢复滚动），
// 前进后退回到已有序号时恢复它离开时的位置；站内「返回」只在前面还有本站页面时才后退。
const scrollMemory = new Map();
let routes = [];
let onChange = () => {};
let index = -1;
let current = null;

function compile(pattern) {
  const keys = [];
  const source = pattern
    .replace(/\/+$/, "")
    .replace(/:([a-zA-Z_]+)/g, (_, key) => { keys.push(key); return "([^/]+)"; });
  return { regex: new RegExp(`^${source || ""}/?$`), keys };
}

export function defineRoutes(table, handler) {
  routes = table.map(route => ({ ...route, ...compile(route.path) }));
  onChange = handler;
}

export function parse(hash = location.hash) {
  const raw = decodeURI(String(hash || "").replace(/^#/, "")) || "/";
  const [pathPart, queryPart = ""] = raw.split("?");
  const path = pathPart.startsWith("/") ? pathPart : `/${pathPart}`;
  const query = new URLSearchParams(queryPart);
  for (const route of routes) {
    const match = route.regex.exec(path);
    if (!match) continue;
    const params = {};
    route.keys.forEach((key, index) => { params[key] = decodeURIComponent(match[index + 1]); });
    return { route, path, params, query, href: `#${path}${queryPart ? `?${queryPart}` : ""}` };
  }
  return { route: null, path, params: {}, query, href: `#${path}` };
}

export function href(path, params) {
  const search = params ? new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "")).toString() : "";
  return `#${path}${search ? `?${search}` : ""}`;
}

// 浮层关闭时会先后退掉自己的那条历史记录；这期间发起的跳转要等后退完成，否则会被这次后退撤销。
let historyHold = null;

export function holdNavigation(promise) {
  const current = Promise.resolve(promise).catch(() => {});
  historyHold = current;
  current.then(() => { if (historyHold === current) historyHold = null; });
}

export function navigate(to, { replace = false } = {}) {
  if (historyHold) {
    historyHold.then(() => navigate(to, { replace }));
    return;
  }
  const target = to.startsWith("#") ? to : `#${to}`;
  if (target === location.hash) {
    handle();
    return;
  }
  scrollMemory.set(index, window.scrollY);
  if (replace) {
    history.replaceState(history.state, "", target);
    handle();
  } else {
    location.hash = target;
  }
}

export function back(fallback = "/") {
  if (historyHold) {
    historyHold.then(() => back(fallback));
    return;
  }
  if (index > 0) history.back();
  else navigate(fallback, { replace: true });
}

export function currentRoute() {
  return current;
}

function handle() {
  const next = parse();
  const state = history.state;
  let restoreScroll;
  if (state && typeof state.xzIndex === "number") {
    // 已有的记录：前进/后退回来时恢复位置；原地替换或刷新时不动。
    if (state.xzIndex !== index) restoreScroll = scrollMemory.get(state.xzIndex);
    index = state.xzIndex;
  } else {
    // 新打开的记录（链接点击或 navigate）：接着上一条编号。
    index += 1;
    history.replaceState({ ...(state && typeof state === "object" ? state : {}), xzIndex: index }, "");
  }
  const previous = current;
  current = next;
  onChange(next, previous, { restoreScroll });
}

export function startRouter() {
  // 由路由自己恢复滚动，避免浏览器的自动恢复覆盖记下的位置。
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  window.addEventListener("hashchange", handle);
  window.addEventListener("scroll", () => {
    if (current) scrollMemory.set(index, window.scrollY);
  }, { passive: true });
  if (!location.hash) history.replaceState(history.state, "", "#/");
  handle();
}
