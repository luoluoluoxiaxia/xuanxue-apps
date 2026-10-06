// 极简状态容器与账户会话：账户、额度与消息数都以服务端返回为准，客户端只缓存展示。
import { get, post, setCsrfToken } from "./api.js?v=n13";

export function createStore(initial) {
  let state = initial;
  const listeners = new Set();
  return {
    get: () => state,
    set(patch) {
      state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
      listeners.forEach(listener => listener(state));
    },
    subscribe(listener, { immediate = false } = {}) {
      listeners.add(listener);
      if (immediate) listener(state);
      return () => listeners.delete(listener);
    },
  };
}

export const session = createStore({
  ready: false,
  authenticated: false,
  user: null,
  wallet: null,
  quota: null,
  archive: null,
});

export const inbox = createStore({ unread: 0, loaded: false });

let refreshing = null;

export function applyAccount(payload) {
  const data = payload || {};
  const authenticated = !!data.authenticated;
  setCsrfToken(authenticated ? data.csrf_token : "");
  const previous = session.get();
  session.set({
    ready: true,
    authenticated,
    user: authenticated ? data.user || null : null,
    wallet: authenticated ? data.credit_wallet || null : null,
    quota: authenticated ? data.private_quota || null : null,
    archive: authenticated ? data.archive_summary || null : null,
  });
  if (previous.ready && previous.authenticated && !authenticated) clearPrivateDrafts();
  if (previous.ready && previous.authenticated !== authenticated) {
    document.dispatchEvent(new CustomEvent("xz:authchange", { detail: { authenticated } }));
  }
  if (!authenticated) inbox.set({ unread: 0, loaded: false });
  return session.get();
}

// force：服务端刚返回 401 时，进行中的旧请求可能还带着「已登录」，等它结束后再重新拉一次。
export function refreshSession({ force = false } = {}) {
  if (force && refreshing) return refreshing.catch(() => {}).then(() => refreshSession());
  if (!refreshing) {
    refreshing = get("/api/auth/me")
      .then(applyAccount)
      .catch(error => {
        if (!session.get().ready) session.set({ ready: true, authenticated: false });
        throw error;
      })
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

export async function logout() {
  try {
    await post("/api/auth/logout", {});
  } finally {
    applyAccount({ authenticated: false });
    clearPrivateDrafts();
  }
}

// 退出登录时清掉只属于当前账户的本机草稿，设备偏好（主题、界面版本）保留。
export function clearPrivateDrafts() {
  try {
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith("xz-next-draft:")) localStorage.removeItem(key);
    });
  } catch (_) {}
}

export function displayName(user) {
  const nickname = String(user?.nickname || "").trim();
  if (nickname) return nickname;
  const email = String(user?.email || "");
  return email ? email.split("@")[0] : "卦友";
}

export const local = {
  get(key, fallback = "") {
    try { const value = localStorage.getItem(key); return value === null ? fallback : value; } catch (_) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, String(value)); } catch (_) {}
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch (_) {}
  },
  json(key, fallback = null) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch (_) { return fallback; }
  },
  setJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
  },
};
