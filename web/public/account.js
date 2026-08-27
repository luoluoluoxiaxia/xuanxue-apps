// OVERLAY HISTORY · 弹窗先响应浏览器返回，再离开当前页面（account-14）
(() => {
  "use strict";

  if (window.XuanOverlayHistory) return;

  const STATE_KEY = "xuanshuOverlay";
  const handlers = new Map();
  const pendingClose = new Map();
  const closingTokens = new Set();
  const handledPopEvents = new WeakSet();
  let sequence = 0;
  let currentEntry = null;

  function stateEntry(state = history.state) {
    const value = state && typeof state === "object" ? state[STATE_KEY] : null;
    if (!value || typeof value !== "object") return null;
    const id = String(value.id || "").trim();
    const token = String(value.token || "").trim();
    if (!id || !token) return null;
    return {
      id,
      token,
      payload: value.payload && typeof value.payload === "object" ? value.payload : {},
    };
  }

  function stateWithoutOverlay(state = history.state) {
    const next = state && typeof state === "object" ? { ...state } : {};
    delete next[STATE_KEY];
    return next;
  }

  function safePayload(payload) {
    if (!payload || typeof payload !== "object") return {};
    try {
      return JSON.parse(JSON.stringify(payload));
    } catch (_) {
      return {};
    }
  }

  function callHandler(kind, entry, runtimePayload = null, fromHistory = false) {
    const handler = handlers.get(entry?.id);
    if (!handler || typeof handler[kind] !== "function") return undefined;
    if (kind === "close" && typeof handler.isOpen === "function" && !handler.isOpen()) return undefined;
    if (kind === "open" && fromHistory && typeof handler.isOpen === "function" && handler.isOpen()) return undefined;
    try {
      const result = handler[kind](runtimePayload || entry.payload || {}, { fromHistory, entry });
      if (result && typeof result.catch === "function") result.catch(() => {});
      return result;
    } catch (_) {
      return undefined;
    }
  }

  function settlePending(token) {
    if (!token) return;
    const callbacks = pendingClose.get(token) || [];
    pendingClose.delete(token);
    callbacks.forEach(callback => {
      try { callback(); } catch (_) {}
    });
  }

  function finishCloseFallback(entry) {
    const active = stateEntry();
    if (!entry || active?.token !== entry.token) return;
    try {
      history.replaceState(stateWithoutOverlay(), "", location.href);
    } catch (_) {}
    currentEntry = null;
    closingTokens.delete(entry.token);
    callHandler("close", entry, null, true);
    settlePending(entry.token);
  }

  function register(id, handler) {
    const key = String(id || "").trim();
    if (!key || !handler) return () => {};
    handlers.set(key, handler);
    return () => {
      if (handlers.get(key) === handler) handlers.delete(key);
    };
  }

  function open(id, payload = {}, runtimePayload = payload) {
    const key = String(id || "").trim();
    if (!key) return undefined;
    const active = stateEntry();
    if (active?.id === key && currentEntry?.token === active.token) {
      return callHandler("open", active, runtimePayload, false);
    }
    const entry = {
      id: key,
      token: `${Date.now().toString(36)}-${(++sequence).toString(36)}`,
      payload: safePayload(payload),
    };
    try {
      history.pushState({
        ...(history.state && typeof history.state === "object" ? history.state : {}),
        [STATE_KEY]: entry,
      }, "", location.href);
      currentEntry = entry;
    } catch (_) {
      currentEntry = null;
    }
    return callHandler("open", entry, runtimePayload, false);
  }

  function requestClose(id, afterClose = null) {
    const key = String(id || "").trim();
    const active = stateEntry();
    const entry = active?.id === key ? active : currentEntry?.id === key ? currentEntry : null;
    if (!entry) {
      callHandler("close", { id: key, token: "", payload: {} }, null, false);
      return Promise.resolve().then(() => {
        if (typeof afterClose === "function") return afterClose();
        return true;
      });
    }
    return new Promise(resolve => {
      const callbacks = pendingClose.get(entry.token) || [];
      callbacks.push(() => {
        Promise.resolve(typeof afterClose === "function" ? afterClose() : true)
          .then(resolve, () => resolve(false));
      });
      pendingClose.set(entry.token, callbacks);
      if (closingTokens.has(entry.token)) return;
      closingTokens.add(entry.token);
      try {
        history.back();
        window.setTimeout(() => finishCloseFallback(entry), 500);
      } catch (_) {
        finishCloseFallback(entry);
      }
    });
  }

  window.addEventListener("popstate", event => {
    const previous = currentEntry;
    const next = stateEntry(event.state);
    const changed = (previous?.token || "") !== (next?.token || "");
    currentEntry = next;
    if (!changed) return;
    if (previous || next) handledPopEvents.add(event);
    if (previous && previous.token !== next?.token) {
      callHandler("close", previous, null, true);
      closingTokens.delete(previous.token);
      settlePending(previous.token);
    }
    if (next && next.token !== previous?.token) callHandler("open", next, next.payload, true);
  });

  // Reloading a transient overlay entry should land on the underlying page, not a blank dialog shell.
  try {
    if (stateEntry()) history.replaceState(stateWithoutOverlay(), "", location.href);
  } catch (_) {}

  window.XuanOverlayHistory = Object.freeze({
    register,
    open,
    requestClose,
    currentId: () => stateEntry()?.id || currentEntry?.id || "",
    isCurrent: id => (stateEntry()?.id || currentEntry?.id || "") === String(id || ""),
    handledPopState: event => handledPopEvents.has(event),
  });
})();

(() => {
  "use strict";

  const state = {
    loaded: false,
    authenticated: false,
    user: null,
    csrfToken: "",
    privateQuota: null,
    archiveSummary: null,
  };
  let dialog = null;
  let body = null;
  let pendingLogin = [];
  let initialLoad = null;
  let cooldownTimer = null;
  let accountScrollPosition = null;
  const codeCooldownUntil = { register: 0, login: 0 };
  const ACCOUNT_OVERLAY_ID = "account-dialog";

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function errorMessage(payload, fallback = "请求失败，请稍后再试") {
    const detail = payload?.detail;
    if (typeof detail === "string") return detail;
    if (detail && typeof detail.message === "string") return detail.message;
    return fallback;
  }

  async function readJson(response) {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(errorMessage(payload));
    return payload;
  }

  function apply(payload) {
    state.loaded = true;
    state.authenticated = !!payload?.authenticated;
    state.user = state.authenticated ? payload.user : null;
    state.csrfToken = state.authenticated ? String(payload.csrf_token || "") : "";
    state.privateQuota = state.authenticated ? payload.private_quota : null;
    state.archiveSummary = state.authenticated ? payload.archive_summary : null;
    if (state.authenticated) document.querySelector("[data-invite-prompt]")?.remove();
    syncButtons();
    document.dispatchEvent(new CustomEvent("xuanshu:authchange", { detail: snapshot() }));
  }

  function snapshot() {
    return {
      loaded: state.loaded,
      authenticated: state.authenticated,
      user: state.user ? { ...state.user } : null,
      csrfToken: state.csrfToken,
      privateQuota: state.privateQuota ? { ...state.privateQuota } : null,
      archiveSummary: state.archiveSummary ? { ...state.archiveSummary } : null,
    };
  }

  async function refresh(options = {}) {
    const restoreFocus = options?.restoreFocus === true;
    let refreshFailed = false;
    try {
      const response = await fetch("/api/auth/me", {
        headers: { Accept: "application/json" },
        credentials: "same-origin",
      });
      apply(await readJson(response));
    } catch (_) {
      // ACCOUNT REFRESH RESILIENCE · 网络波动不应把已登录账户误判为退出（account-13）
      refreshFailed = true;
      if (!state.loaded) apply({ authenticated: false });
    }
    if (dialog?.open) {
      if (refreshFailed && state.authenticated) {
        renderAccount("暂时无法更新账户数据，当前显示上次同步结果。", "warn");
      } else {
        renderAccount();
      }
      if (restoreFocus) {
        requestAnimationFrame(() => body.querySelector("[data-account-refresh]")?.focus({ preventScroll: true }));
      }
    }
    return snapshot();
  }

  function ready() {
    if (!initialLoad) initialLoad = refresh();
    return initialLoad;
  }

  function csrfHeaders(extra = {}) {
    const headers = { ...extra };
    if (state.csrfToken) headers["X-XuanShu-CSRF"] = state.csrfToken;
    return headers;
  }

  function syncButtons() {
    document.querySelectorAll("[data-account-button]").forEach(button => {
      const label = button.querySelector("[data-account-label]") || button;
      if (state.authenticated) {
        const name = String(state.user?.email || "账户").split("@", 1)[0];
        label.textContent = name.length > 12 ? `${name.slice(0, 10)}…` : name;
        button.dataset.authenticated = "true";
        const quota = state.privateQuota;
        const archives = Number(state.archiveSummary?.total || 0);
        const active = Number(state.archiveSummary?.active || 0);
        button.title = [
          archives ? `${archives} 份云端档案` : "暂无云端档案",
          active ? `${active} 份档案正在生成` : "",
          quota ? `今日私密剩余 ${quota.remaining}/${quota.total}` : "",
        ].filter(Boolean).join(" · ");
      } else {
        label.textContent = "登录 / 注册";
        button.dataset.authenticated = "false";
        button.title = "登录或注册账户";
      }
    });
    document.querySelectorAll("[data-account-profile-button]").forEach(button => {
      const label = button.querySelector("[data-account-profile-label]") || button;
      label.textContent = state.authenticated ? "我的档案" : "登录 / 注册";
      button.dataset.authenticated = state.authenticated ? "true" : "false";
      button.title = state.authenticated ? "我的档案" : "登录 / 注册";
    });
  }

  function ensureDialog() {
    if (dialog?.isConnected) return dialog;
    dialog = document.createElement("dialog");
    dialog.className = "account-dialog";
    dialog.setAttribute("aria-labelledby", "account-dialog-title");
    dialog.innerHTML = `
      <button type="button" class="account-dialog-close" data-account-close aria-label="关闭">×</button>
      <div class="account-dialog-brand"><i>玄</i><span><b>玄枢账户</b><em>公开免费 · 私密有额</em></span></div>
      <div class="account-dialog-body" data-account-body></div>`;
    document.body.append(dialog);
    body = dialog.querySelector("[data-account-body]");
    dialog.querySelector("[data-account-close]").addEventListener("click", close);
    dialog.addEventListener("click", event => {
      if (event.target === dialog) close();
    });
    dialog.addEventListener("cancel", event => {
      event.preventDefault();
      close();
    });
    window.XuanOverlayHistory?.register(ACCOUNT_OVERLAY_ID, {
      isOpen: () => !!dialog?.open,
      open: options => openNow(options?.mode || "login", options?.message || ""),
      close: closeNow,
    });
    return dialog;
  }

  function resolvePending(value) {
    const resolvers = pendingLogin.slice();
    pendingLogin = [];
    resolvers.forEach(resolve => resolve(value));
  }

  function lockPageScroll() {
    if (accountScrollPosition) return;
    accountScrollPosition = { left: window.scrollX, top: window.scrollY };
    const root = document.documentElement;
    root.style.setProperty("--account-scroll-y", `${accountScrollPosition.top}px`);
    root.classList.add("account-dialog-open");
    document.body.classList.add("account-dialog-open");
  }

  function unlockPageScroll() {
    if (!accountScrollPosition) return;
    const restore = accountScrollPosition;
    accountScrollPosition = null;
    const root = document.documentElement;
    root.classList.remove("account-dialog-open");
    document.body.classList.remove("account-dialog-open");
    root.style.removeProperty("--account-scroll-y");
    window.scrollTo(restore.left, restore.top);
  }

  function closeNow() {
    if (dialog?.open) dialog.close();
    unlockPageScroll();
    if (!state.authenticated) resolvePending(false);
  }

  function close(afterClose = null) {
    if (window.XuanOverlayHistory) {
      return window.XuanOverlayHistory.requestClose(ACCOUNT_OVERLAY_ID, afterClose);
    }
    closeNow();
    return Promise.resolve(typeof afterClose === "function" ? afterClose() : true);
  }

  function openNow(mode = "login", message = "") {
    ensureDialog();
    if (state.authenticated) renderAccount();
    else renderAuth(mode === "register" ? "register" : "login_password", message);
    if (!dialog.open) dialog.showModal();
    lockPageScroll();
  }

  function open(mode = "login", message = "") {
    ensureDialog();
    if (window.XuanOverlayHistory) {
      return window.XuanOverlayHistory.open(
        ACCOUNT_OVERLAY_ID,
        { mode, message },
        { mode, message },
      );
    }
    return openNow(mode, message);
  }

  function codePurpose(mode) {
    return mode === "register" ? "register" : "login";
  }

  function syncCodeButton(form) {
    const button = form?.querySelector("[data-code-send]");
    if (!button) return;
    const purpose = codePurpose(form.dataset.mode || "");
    const seconds = Math.max(0, Math.ceil((codeCooldownUntil[purpose] - Date.now()) / 1000));
    button.disabled = seconds > 0;
    button.textContent = seconds > 0 ? `${seconds} 秒后重发` : "发送验证码";
    if (cooldownTimer) {
      clearInterval(cooldownTimer);
      cooldownTimer = null;
    }
    if (seconds > 0) {
      cooldownTimer = setInterval(() => {
        if (!form.isConnected) {
          clearInterval(cooldownTimer);
          cooldownTimer = null;
          return;
        }
        const left = Math.max(0, Math.ceil((codeCooldownUntil[purpose] - Date.now()) / 1000));
        button.disabled = left > 0;
        button.textContent = left > 0 ? `${left} 秒后重发` : "发送验证码";
        if (!left) {
          clearInterval(cooldownTimer);
          cooldownTimer = null;
        }
      }, 1000);
    }
  }

  function renderAuth(mode, message = "", emailValue = "") {
    const isRegister = mode === "register";
    const isCodeLogin = mode === "login_code";
    const usesCode = isCodeLogin;
    const privacyNote = isRegister
      ? "邀请码只在成功注册时核销，一码一用；公开卦帖不会展示邮箱。"
      : isCodeLogin
        ? "验证码 10 分钟内有效且只能使用一次；若收件箱里没有，请检查垃圾箱。公开卦帖不会展示邮箱。"
        : "忘记密码或暂时不方便输入？可切换验证码登录。公开卦帖不会展示邮箱。";
    body.innerHTML = `
      <div class="account-auth-head">
        <span>账户让你的私密问题与邀请奖励长期保留</span>
        <h2 id="account-dialog-title">${isRegister ? "创建账户" : "欢迎回来"}</h2>
        ${message ? `<p class="account-context-note">${escapeHtml(message)}</p>` : ""}
      </div>
      <div class="account-tabs" role="tablist" aria-label="登录或注册">
        <button type="button" id="account-login-tab" role="tab" data-auth-mode="login_password" aria-controls="account-auth-panel" aria-selected="${!isRegister}" tabindex="${isRegister ? -1 : 0}">登录</button>
        <button type="button" id="account-register-tab" role="tab" data-auth-mode="register" aria-controls="account-auth-panel" aria-selected="${isRegister}" tabindex="${isRegister ? 0 : -1}">注册</button>
      </div>
      ${isRegister ? "" : `
        <div class="account-login-methods" role="group" aria-label="登录方式">
          <button type="button" data-login-method="login_password" aria-pressed="${!isCodeLogin}">密码登录</button>
          <button type="button" data-login-method="login_code" aria-pressed="${isCodeLogin}">验证码登录</button>
        </div>`}
      <form id="account-auth-panel" class="account-auth-form" role="tabpanel" aria-labelledby="${isRegister ? "account-register-tab" : "account-login-tab"}" data-auth-form data-mode="${mode}">
        <label><span>邮箱</span><input type="email" name="email" autocomplete="email" required placeholder="name@example.com" value="${escapeHtml(emailValue)}"></label>
        ${isRegister ? `
          <div class="account-registration-code-group">
            <label for="account-registration-code-input"><span>一次性邀请码</span></label>
            <span class="account-registration-code-field">
              <input id="account-registration-code-input" type="text" name="invite_code" autocomplete="off" autocapitalize="characters" pattern="XS-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}" maxlength="12" required placeholder="XS-XXXX-XXXX">
              <button type="button" data-registration-code-reveal aria-expanded="false" aria-controls="account-registration-code-popover">领取邀请码</button>
            </span>
            <aside id="account-registration-code-popover" class="account-registration-code-popover" data-registration-code-popover role="status" aria-live="polite" hidden>
              <span>当前可用邀请码</span>
              <strong data-registration-code-value></strong>
              <em data-registration-code-remaining></em>
            </aside>
          </div>` : usesCode ? `
          <div class="account-code-group"><label for="account-code-input"><span>邮箱验证码</span></label><span class="account-code-field"><input id="account-code-input" type="text" name="code" autocomplete="one-time-code" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" required placeholder="6 位验证码"><button type="button" data-code-send>发送验证码</button></span></div>
          <p class="account-code-status" data-code-status role="status" aria-live="polite" hidden></p>` : ""}
        ${isCodeLogin ? "" : `
          <div class="account-password-group">
            <label for="account-password-input"><span>密码</span></label>
            <span class="account-password-field">
              <input id="account-password-input" type="password" name="password" autocomplete="${isRegister ? "new-password" : "current-password"}" minlength="8" maxlength="128" required placeholder="至少 8 位">
              <button type="button" data-password-toggle aria-controls="account-password-input" aria-pressed="false" aria-label="显示密码">显示</button>
            </span>
          </div>`}
        ${isRegister ? `<p class="account-form-hint">邮件恢复前，点“领取邀请码”即可注册。公开提问不限次数；私密提问每日有专属额度。</p>` : ""}
        <p class="account-form-error" data-auth-error role="alert" aria-live="assertive" hidden></p>
        <button type="submit" class="account-submit">${isRegister ? "注册并继续" : isCodeLogin ? "验证码登录" : "密码登录"}</button>
      </form>
      <p class="account-privacy-note">${privacyNote}</p>`;
    body.querySelectorAll("[data-auth-mode]").forEach(button => {
      button.addEventListener("click", () => {
        const email = body.querySelector('input[name="email"]')?.value || "";
        renderAuth(button.dataset.authMode || "login_password", message, email);
      });
    });
    body.querySelector("[role=tablist]")?.addEventListener("keydown", event => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      const tabs = Array.from(event.currentTarget.querySelectorAll('[role=tab]'));
      const current = Math.max(0, tabs.indexOf(document.activeElement));
      const next = event.key === 'ArrowRight'
        ? tabs[(current + 1) % tabs.length]
        : tabs[(current - 1 + tabs.length) % tabs.length];
      const nextMode = next?.dataset.authMode || "login_password";
      next?.click();
      requestAnimationFrame(() => body.querySelector(`[data-auth-mode="${nextMode}"]`)?.focus());
    });
    body.querySelectorAll("[data-login-method]").forEach(button => {
      button.addEventListener("click", () => {
        const email = body.querySelector('input[name="email"]')?.value || "";
        renderAuth(button.dataset.loginMethod || "login_password", message, email);
      });
    });
    const form = body.querySelector("[data-auth-form]");
    form.addEventListener("submit", submitAuth);
    form.querySelector("[data-code-send]")?.addEventListener("click", sendVerificationCode);
    form.querySelector("[data-registration-code-reveal]")?.addEventListener("click", revealRegistrationCode);
    form.elements.invite_code?.addEventListener("input", event => {
      event.currentTarget.value = event.currentTarget.value.toUpperCase();
    });
    form.querySelector("[data-password-toggle]")?.addEventListener("click", event => {
      const button = event.currentTarget;
      const input = form.elements.password;
      if (!input) return;
      const visible = input.type === "password";
      input.type = visible ? "text" : "password";
      button.textContent = visible ? "隐藏" : "显示";
      button.setAttribute("aria-pressed", visible ? "true" : "false");
      button.setAttribute("aria-label", visible ? "隐藏密码" : "显示密码");
      input.focus({ preventScroll: true });
    });
    syncCodeButton(form);
    requestAnimationFrame(() => body.querySelector('input[name="email"]')?.focus());
  }

  async function sendVerificationCode(event) {
    const button = event.currentTarget;
    const form = button.closest("form");
    const emailInput = form.elements.email;
    const error = form.querySelector("[data-auth-error]");
    const status = form.querySelector("[data-code-status]");
    if (!emailInput.reportValidity()) return;
    error.hidden = true;
    status.hidden = true;
    button.disabled = true;
    button.textContent = "正在发送…";
    const purpose = codePurpose(form.dataset.mode || "");
    try {
      const response = await fetch("/api/auth/code", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email: emailInput.value.trim(), purpose }),
      });
      const payload = await readJson(response);
      const retryAfter = Math.max(10, Number(payload.retry_after || 60));
      codeCooldownUntil[purpose] = Date.now() + retryAfter * 1000;
      status.textContent = payload.message || "验证码已发送；若收件箱里没有，请检查垃圾箱。";
      status.hidden = false;
      syncCodeButton(form);
      form.elements.code?.focus();
    } catch (reason) {
      error.textContent = reason?.message || "验证码发送失败，请稍后再试";
      error.hidden = false;
      button.disabled = false;
      button.textContent = "发送验证码";
    }
  }

  async function revealRegistrationCode(event) {
    const button = event.currentTarget;
    const form = button.closest("form");
    const error = form.querySelector("[data-auth-error]");
    const popover = form.querySelector("[data-registration-code-popover]");
    error.hidden = true;
    button.disabled = true;
    button.textContent = "正在领取…";
    try {
      const response = await fetch("/api/auth/invite-code", {
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        cache: "no-store",
      });
      const payload = await readJson(response);
      const code = String(payload.code || "");
      form.elements.invite_code.value = code;
      popover.querySelector("[data-registration-code-value]").textContent = code;
      popover.querySelector("[data-registration-code-remaining]").textContent = `本批还剩 ${Number(payload.remaining || 0)} 个可用码，提交注册后才会核销`;
      popover.hidden = false;
      button.setAttribute("aria-expanded", "true");
      button.textContent = "换一个";
      form.elements.invite_code.focus();
      form.elements.invite_code.select();
    } catch (reason) {
      error.textContent = reason?.message || "邀请码领取失败，请稍后再试";
      error.hidden = false;
      button.textContent = "重新领取";
    } finally {
      button.disabled = false;
    }
  }

  async function submitAuth(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const mode = form.dataset.mode || "login_password";
    const isRegister = mode === "register";
    const isCodeLogin = mode === "login_code";
    const submit = form.querySelector(".account-submit");
    const error = form.querySelector("[data-auth-error]");
    const email = form.elements.email.value.trim();
    const password = form.elements.password?.value || "";
    const code = form.elements.code?.value.trim() || "";
    const inviteCode = form.elements.invite_code?.value.trim() || "";
    error.hidden = true;
    submit.disabled = true;
    submit.textContent = isRegister ? "正在创建账户…" : "正在登录…";
    try {
      const endpoint = isRegister ? "register" : "login";
      const requestBody = isRegister
        ? { email, password, invite_code: inviteCode }
        : isCodeLogin
          ? { email, code, method: "code" }
          : { email, password, method: "password" };
      const response = await fetch(`/api/auth/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(requestBody),
      });
      const payload = await readJson(response);
      const shouldResume = pendingLogin.length > 0;
      apply(payload);
      renderAccount(isRegister ? "账户已创建，邀请码已经核销。" : "已登录。", "success");
      if (shouldResume) {
        await close();
        resolvePending(true);
      } else {
        resolvePending(true);
        requestAnimationFrame(() => body.querySelector("[data-account-archives], [data-account-start-bazi]")?.focus({ preventScroll: true }));
      }
    } catch (reason) {
      error.textContent = reason?.message || "操作失败，请稍后再试";
      error.hidden = false;
      submit.disabled = false;
      submit.textContent = isRegister ? "注册并继续" : isCodeLogin ? "验证码登录" : "密码登录";
    }
  }

  function quotaComposition(quota) {
    if (!quota) return "";
    return `基础 ${quota.base} + 有效邀请 ${quota.referral_bonus}`;
  }

  function renderAccount(message = "", tone = "") {
    if (!state.authenticated) {
      renderAuth("login_password", message);
      return;
    }
    const quota = state.privateQuota || {};
    const archives = state.archiveSummary || {};
    const archiveTotal = Number(archives.total || 0);
    body.innerHTML = `
      <div class="account-home-head">
        <span>我的账户</span>
        <h2 id="account-dialog-title">${escapeHtml(state.user?.email || "")}</h2>
        ${message ? `<p class="account-context-note ${escapeHtml(tone)}">${escapeHtml(message)}</p>` : ""}
      </div>
      <a class="account-personal-home-link" href="/">
        <span><b>打开观象台</b><em>本月宜忌 · 穿搭 · 一事详断</em></span><i>→</i>
      </a>
      <section class="account-archive-card${archiveTotal ? "" : " empty"}" aria-label="云端档案">
        <div class="account-archive-copy">
          <span>云端档案</span>
          <strong><b>${archiveTotal}</b><i>份</i></strong>
          <em>换设备登录后也能继续查看</em>
        </div>
        <div class="account-archive-detail">
          <span>${Number(archives.bazi || 0)} 份八字</span>
          <span>${Number(archives.liuyao || 0)} 份六爻</span>
          <span>${Number(archives.history_count || 0)} 条解读</span>
          ${Number(archives.active || 0) ? `<span class="active">${Number(archives.active)} 份正在生成</span>` : ""}
        </div>
        ${archiveTotal
          ? '<button type="button" data-account-archives>查看全部档案 <span>→</span></button>'
          : `<div class="account-archive-entry-actions" aria-label="开始第一份档案">
              <button type="button" data-account-start-bazi>排八字 <span>→</span></button>
              <button type="button" data-account-start-liuyao>起六爻 <span>→</span></button>
            </div>`}
      </section>
      <section class="account-quota-card" aria-label="今日私密提问额度">
        <div class="account-quota-main">
          <span>今日私密提问</span>
          <strong><b>${Number(quota.remaining || 0)}</b><i>/ ${Number(quota.total || 0)}</i></strong>
          <em>北京时间 0 点重置</em>
        </div>
        <div class="account-quota-detail">
          <span><b>每日总上限</b><em>${quotaComposition(quota)}</em></span>
          <span><b>今日已用</b><em>${Number(quota.used || 0)} 次${Number(quota.reserved || 0) ? ` · 生成中 ${Number(quota.reserved)} 次` : ""}</em></span>
        </div>
      </section>
      <section class="account-referral-card">
        <div><span>分享带来的每日加成</span><strong>+${Number(quota.referral_bonus || 0)}</strong></div>
        <p>登录后分享站内任意公开问题。新用户经你的链接注册并完成首次提问，你的每日私密总上限永久 +1。</p>
        <div class="account-referral-stats">
          <span><b>${Number(quota.pending_referrals || 0)}</b><em>待完成首问</em></span>
          <span><b>${Number(quota.qualified_referrals || 0)}</b><em>已生效邀请</em></span>
          <span><b>${Number(quota.max_total || 10)}</b><em>每日最高</em></span>
        </div>
        <a href="/#gua-square" data-account-community>去卦帖广场分享任意问题 <span>→</span></a>
      </section>
      <div class="account-home-actions">
        <button type="button" data-account-refresh>刷新账户数据</button>
        <button type="button" class="account-logout" data-account-logout>退出登录</button>
      </div>`;
    body.querySelector("[data-account-archives]")?.addEventListener("click", () => {
      close(() => {
        const openEvent = new CustomEvent("xuanshu:openarchives", { cancelable: true });
        if (document.dispatchEvent(openEvent)) window.location.assign("/?view=archives");
      });
    });
    body.querySelector("[data-account-start-bazi]")?.addEventListener("click", () => {
      close(() => {
        const openEvent = new CustomEvent("xuanshu:startbazi", { cancelable: true });
        if (document.dispatchEvent(openEvent)) window.location.assign("/?start=bazi");
      });
    });
    body.querySelector("[data-account-start-liuyao]")?.addEventListener("click", () => {
      close(() => {
        const openEvent = new CustomEvent("xuanshu:startliuyao", { cancelable: true });
        if (document.dispatchEvent(openEvent)) window.location.assign("/?start=liuyao");
      });
    });
    body.querySelector("[data-account-community]").addEventListener("click", event => {
      event.preventDefault();
      close(() => {
        const openEvent = new CustomEvent("xuanshu:opencommunity", { cancelable: true });
        if (document.dispatchEvent(openEvent)) window.location.assign("/#gua-square");
      });
    });
    body.querySelector("[data-account-refresh]").addEventListener("click", () => refresh({ restoreFocus: true }));
    body.querySelector("[data-account-logout]").addEventListener("click", logout);
  }

  async function logout() {
    const button = body.querySelector("[data-account-logout]");
    if (button) button.disabled = true;
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        headers: csrfHeaders({ Accept: "application/json" }),
        credentials: "same-origin",
      });
      await readJson(response);
      apply({ authenticated: false });
      renderAuth("login_password", "已经安全退出账户。需要时可以重新登录。");
    } catch (reason) {
      renderAccount(reason?.message || "退出失败，请稍后再试", "error");
    }
  }

  async function requireLogin(options = {}) {
    await ready();
    if (state.authenticated) return true;
    open(options.mode || "register", options.message || "请先登录或注册后继续。 ");
    return new Promise(resolve => pendingLogin.push(resolve));
  }

  async function shareTarget(slug) {
    const canonical = `${location.origin}/gua/${encodeURIComponent(slug)}?ref=post_share`;
    await ready();
    if (!state.authenticated) return { url: canonical, attributed: false };
    try {
      const response = await fetch("/api/referrals/share-link", {
        method: "POST",
        headers: csrfHeaders({ "Content-Type": "application/json", Accept: "application/json" }),
        credentials: "same-origin",
        body: JSON.stringify({ slug }),
      });
      const payload = await readJson(response);
      return { url: payload.share_url || canonical, attributed: !!payload.attributed };
    } catch (_) {
      return { url: canonical, attributed: false };
    }
  }

  function bindAccountButtons(root = document) {
    root.querySelectorAll("[data-account-button]").forEach(button => {
      if (button.dataset.accountBound === "true") return;
      button.dataset.accountBound = "true";
      button.addEventListener("click", () => open(state.authenticated ? "account" : "login"));
    });
    syncButtons();
  }

  function showInvitePrompt() {
    if (new URLSearchParams(location.search).get("ref") !== "invite") return;
    ready().then(() => {
      if (state.authenticated || document.querySelector("[data-invite-prompt]")) return;
      const prompt = document.createElement("aside");
      prompt.className = "account-invite-prompt";
      prompt.dataset.invitePrompt = "";
      prompt.innerHTML = `
        <button type="button" data-invite-dismiss aria-label="关闭">×</button>
        <span><b>朋友分享了一条真实卦帖</b><em>注册后可免费公开提问，私密提问每日有专属额度。</em></span>
        <button type="button" data-invite-register>注册后提问</button>`;
      document.body.append(prompt);
      prompt.querySelector("[data-invite-dismiss]").addEventListener("click", () => prompt.remove());
      prompt.querySelector("[data-invite-register]").addEventListener("click", () => open("register", "完成注册后，你的首次有效提问会为分享者增加每日私密额度。"));
    });
  }

  function init() {
    bindAccountButtons();
    ready();
    showInvitePrompt();
    document.addEventListener("click", event => {
      const button = event.target.closest?.("[data-account-button]");
      if (button) bindAccountButtons(document);
    });
  }

  window.XuanxueAccount = Object.freeze({
    ready,
    refresh,
    snapshot,
    csrfHeaders,
    requireLogin,
    shareTarget,
    open,
    close,
    bindAccountButtons,
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
