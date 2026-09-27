// 哈希路由：静态托管下无需服务端改写；浏览器前进后退时恢复原滚动位置。
const scrollMemory = new Map();
let routes = [];
let onChange = () => {};
let intentional = false;
let depth = 0;
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

export function navigate(to, { replace = false } = {}) {
  const target = to.startsWith("#") ? to : `#${to}`;
  if (target === location.hash) {
    handle();
    return;
  }
  scrollMemory.set(location.hash || "#/", window.scrollY);
  intentional = true;
  if (replace) {
    history.replaceState(history.state, "", target);
    handle();
  } else {
    depth += 1;
    location.hash = target;
  }
}

export function back(fallback = "/") {
  if (depth > 0) {
    depth -= 1;
    history.back();
  } else {
    navigate(fallback, { replace: true });
  }
}

export function currentRoute() {
  return current;
}

function handle() {
  const next = parse();
  const restoring = !intentional;
  intentional = false;
  const previous = current;
  current = next;
  onChange(next, previous, {
    restoreScroll: restoring ? scrollMemory.get(location.hash || "#/") : undefined,
  });
}

export function startRouter() {
  window.addEventListener("hashchange", () => {
    if (!intentional && depth > 0) depth -= 1;
    handle();
  });
  window.addEventListener("scroll", () => {
    if (current) scrollMemory.set(location.hash || "#/", window.scrollY);
  }, { passive: true });
  if (!location.hash) history.replaceState(history.state, "", "#/");
  handle();
}
