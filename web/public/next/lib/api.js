// 同域接口：HttpOnly Cookie 会话 + X-XuanShu-CSRF 令牌；
// 点赞、浏览、关注、采纳与反馈等互动额外携带同域互动证明头。
let csrfToken = "";

export function setCsrfToken(token) {
  csrfToken = String(token || "");
}

export class ApiError extends Error {
  constructor(status, message, body = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
  get isAuth() { return this.status === 401; }
  get isNetwork() { return this.status === 0; }
}

const FALLBACK = {
  400: "请求内容有误，请检查后重试",
  401: "请先登录后再继续",
  402: "积分不足，充值后可继续",
  403: "没有权限进行这个操作",
  404: "内容不存在，可能已被删除",
  409: "状态已经变化，请刷新后重试",
  413: "内容太长了，请精简后再提交",
  422: "填写的信息不完整或格式不对",
  429: "操作太频繁，请稍后再试",
};

function messageFrom(status, body) {
  const detail = body && body.detail;
  if (typeof detail === "string" && detail.trim()) return detail.trim();
  if (Array.isArray(detail) && detail.length) {
    const first = detail[0];
    if (first && typeof first.msg === "string" && /[一-鿿]/.test(first.msg)) return first.msg;
    return FALLBACK[422];
  }
  if (body && typeof body.message === "string" && body.message.trim()) return body.message.trim();
  if (FALLBACK[status]) return FALLBACK[status];
  if (status >= 500) return "服务暂时不可用，请稍后再试";
  return "请求没有成功，请稍后再试";
}

export async function api(path, options = {}) {
  const { method = "GET", body, signal, interaction = false, keepalive = false, headers = {}, cache } = options;
  const init = {
    method,
    credentials: "same-origin",
    headers: { Accept: "application/json", ...headers },
    signal,
    keepalive,
  };
  if (cache) init.cache = cache;
  if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  if (method !== "GET" && csrfToken) init.headers["X-XuanShu-CSRF"] = csrfToken;
  if (interaction) init.headers["X-Xuanshu-Interaction"] = "same-origin-v1";

  let response;
  try {
    response = await fetch(path, init);
  } catch (error) {
    if (error && error.name === "AbortError") throw error;
    throw new ApiError(0, "网络连接不稳定，请检查网络后重试");
  }
  let data = null;
  let text;
  try {
    text = await response.text();
  } catch (error) {
    // Reading a streamed response can be cancelled after its headers arrive.
    // Preserve cancellation so a stale 401 cannot invalidate a newer session.
    if (error?.name === "AbortError") throw error;
    throw new ApiError(0, "网络连接不稳定，请检查网络后重试");
  }
  if (text) {
    try { data = JSON.parse(text); } catch (_) { data = null; }
  }
  if (!response.ok) throw new ApiError(response.status, messageFrom(response.status, data), data);
  return data;
}

export const get = (path, options) => api(path, { ...options, method: "GET" });
export const post = (path, body, options) => api(path, { ...options, method: "POST", body });
export const put = (path, body, options) => api(path, { ...options, method: "PUT", body });
export const patch = (path, body, options) => api(path, { ...options, method: "PATCH", body });
export const del = (path, options) => api(path, { ...options, method: "DELETE" });

export function query(params) {
  const search = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    search.set(key, String(value));
  });
  const text = search.toString();
  return text ? `?${text}` : "";
}

// 短时读缓存：悬停或按下卡片时预取详情，打开时先用缓存秒开，再由页面自行刷新。
const memo = new Map();

export function cachedGet(path, { ttl = 30000 } = {}) {
  const hit = memo.get(path);
  if (hit && Date.now() - hit.at < ttl) return hit.promise;
  const entry = { at: Date.now() };
  entry.promise = get(path, { cache: "no-store" }).then(value => {
    entry.value = value;
    return value;
  }, error => {
    if (memo.get(path) === entry) memo.delete(path);
    throw error;
  });
  memo.set(path, entry);
  return entry.promise;
}

export function prefetch(path, options) {
  cachedGet(path, options).catch(() => {});
}

// 同步取出仍有效且已完成的缓存（没有则返回 undefined）。
export function peekCached(path, { ttl = 30000 } = {}) {
  const hit = memo.get(path);
  if (!hit || Date.now() - hit.at >= ttl || !("value" in hit)) return undefined;
  return hit.value;
}

export function invalidateCached(prefix) {
  for (const key of memo.keys()) if (key.startsWith(prefix)) memo.delete(key);
}

// 登录状态变化后，缓存里的个人字段（是否点赞等）不再可信。
if (typeof document !== "undefined") document.addEventListener?.("xz:authchange", () => memo.clear());
