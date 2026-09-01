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
    creditWallet: null,
    archiveSummary: null,
  };
  let dialog = null;
  let body = null;
  let pendingLogin = [];
  let initialLoad = null;
  let cooldownTimer = null;
  let accountScrollPosition = null;
  let checkoutPollToken = 0;
  let creditHistoryRequestToken = 0;
  let checkoutChannel = null;
  const codeCooldownUntil = { register: 0, login: 0 };
  const ACCOUNT_OVERLAY_ID = "account-dialog";
  const CHECKOUT_CONTEXT_KEY = "xuanshu-checkout-context-v1";
  const CHECKOUT_CHANNEL_NAME = "xuanshu-checkout-events-v1";

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
    state.creditWallet = state.authenticated ? payload.credit_wallet : null;
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
      creditWallet: state.creditWallet ? {
        ...state.creditWallet,
        packs: Array.isArray(state.creditWallet.packs)
          ? state.creditWallet.packs.map(pack => ({ ...pack }))
          : [],
      } : null,
      archiveSummary: state.archiveSummary ? { ...state.archiveSummary } : null,
    };
  }

  async function refresh(options = {}) {
    const restoreFocus = options?.restoreFocus === true;
    const rerender = options?.render !== false;
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
    if (dialog?.open && rerender) {
      if (refreshFailed && state.authenticated) {
        renderAccount("账户数据未更新，显示上次结果。", "warn");
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
        const wallet = state.creditWallet;
        const archives = Number(state.archiveSummary?.total || 0);
        const active = Number(state.archiveSummary?.active || 0);
        button.title = [
          archives ? `${archives} 份云端档案` : "暂无云端档案",
          active ? `${active} 份档案正在生成` : "",
          quota ? `今日免费积分 ${quota.remaining}/${quota.total}` : "",
          wallet ? `账户积分 ${Number(wallet.balance || 0)}` : "",
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
      <div class="account-dialog-brand"><i>玄</i><span><b>玄枢账户</b></span></div>
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
    if (state.authenticated) {
      if (mode === "credits") renderCreditHistory("activity", 1, "all");
      else renderAccount(message, mode === "topup" ? "warn" : message ? "success" : "");
    }
    else renderAuth(mode === "register" ? "register" : "login_password", message);
    if (!dialog.open) dialog.showModal();
    lockPageScroll();
    if (state.authenticated && mode === "topup") {
      requestAnimationFrame(() => {
        const target = body.querySelector("[data-account-wallet]");
        target?.scrollIntoView({ block: "center", inline: "nearest" });
        target?.querySelector("[data-credit-topup]:not(:disabled)")?.focus({ preventScroll: true });
      });
    }
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
    const usesCode = isRegister || isCodeLogin;
    const privacyNote = isRegister
      ? "邮箱不会在社区展示。"
      : isCodeLogin
        ? "验证码 10 分钟内有效。"
        : "老账号首次登录请使用验证码。";
    body.innerHTML = `
      <div class="account-auth-head">
        <h2 id="account-dialog-title">${isRegister ? "创建账户" : "登录玄枢"}</h2>
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
            <label for="account-registration-code-input"><span>邀请码</span></label>
            <span class="account-registration-code-field">
              <input id="account-registration-code-input" type="text" name="invite_code" autocomplete="off" autocapitalize="characters" pattern="XS-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}" maxlength="12" required placeholder="XS-XXXX-XXXX">
              <button type="button" data-registration-code-reveal aria-expanded="false" aria-controls="account-registration-code-popover">领取邀请码</button>
            </span>
            <aside id="account-registration-code-popover" class="account-registration-code-popover" data-registration-code-popover role="status" aria-live="polite" hidden>
              <span>当前可用邀请码</span>
              <strong data-registration-code-value></strong>
              <em data-registration-code-remaining></em>
            </aside>
          </div>
          <div class="account-code-group"><label for="account-code-input"><span>邮箱验证码</span></label><span class="account-code-field"><input id="account-code-input" type="text" name="code" autocomplete="one-time-code" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" required placeholder="6 位验证码"><button type="button" data-code-send>发送验证码</button></span></div>
          <p class="account-code-status" data-code-status role="status" aria-live="polite" hidden></p>` : usesCode ? `
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
        ${isRegister ? `<p class="account-form-hint">领取邀请码并验证邮箱，注册后赠送积分。</p>` : ""}
        <p class="account-form-error" data-auth-error role="alert" aria-live="assertive" hidden></p>
        <button type="submit" class="account-submit">${isRegister ? "注册" : isCodeLogin ? "验证码登录" : "密码登录"}</button>
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
      popover.querySelector("[data-registration-code-remaining]").textContent = `本批剩 ${Number(payload.remaining || 0)} 个，注册后核销`;
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
    submit.textContent = isRegister ? "正在注册…" : "正在登录…";
    try {
      const endpoint = isRegister ? "register" : "login";
      const requestBody = isRegister
        ? { email, password, code, invite_code: inviteCode }
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
      const welcomeCredits = Number(state.creditWallet?.welcome_credits || 0);
      const walletBalance = Number(state.creditWallet?.balance || 0);
      const successMessage = isRegister
        ? `邮箱已验证，账户已创建，${welcomeCredits} 积分已到账。`
        : isCodeLogin
          ? `邮箱验证完成，已登录。账户积分余额 ${walletBalance} 分。`
          : "已登录。";
      renderAccount(successMessage, "success");
      if (shouldResume) {
        await close();
        resolvePending(true);
      } else {
        resolvePending(true);
        requestAnimationFrame(() => body.querySelector("[data-account-archives], [data-account-start-bazi]")?.focus({ preventScroll: true }));
      }
    } catch (reason) {
      if (!isRegister && !isCodeLogin && String(reason?.message || "").includes("邮箱验证")) {
        renderAuth("login_code", reason.message, email);
        return;
      }
      error.textContent = reason?.message || "操作失败，请稍后再试";
      error.hidden = false;
      submit.disabled = false;
      submit.textContent = isRegister ? "注册" : isCodeLogin ? "验证码登录" : "密码登录";
    }
  }

  function quotaComposition(quota) {
    if (!quota) return "";
    return `每日 ${quota.base} 分${Number(quota.referral_bonus || 0) ? ` + 邀请加成 ${quota.referral_bonus} 分` : ""}`;
  }

  function packEstimate(pack) {
    return String(pack?.usage_estimate || "按每次回答的实际消耗结算");
  }

  function renderAccount(message = "", tone = "") {
    if (!state.authenticated) {
      renderAuth("login_password", message);
      return;
    }
    const quota = state.privateQuota || {};
    const wallet = state.creditWallet || {};
    const packs = Array.isArray(wallet.packs) ? wallet.packs : [];
    const archives = state.archiveSummary || {};
    const archiveTotal = Number(archives.total || 0);
    body.innerHTML = `
      <div class="account-home-head">
        <h2 id="account-dialog-title">${escapeHtml(state.user?.email || "")}</h2>
        ${message ? `<p class="account-context-note ${escapeHtml(tone)}">${escapeHtml(message)}</p>` : ""}
      </div>
      <a class="account-personal-home-link" href="/">
        <span><b>打开观象台</b><em>查看今日与本月提示</em></span><i>→</i>
      </a>
      <section class="account-archive-card${archiveTotal ? "" : " empty"}" aria-label="云端档案">
        <div class="account-archive-copy">
          <span>云端档案</span>
          <strong><b>${archiveTotal}</b><i>份</i></strong>
          <em>可跨设备查看</em>
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
      <section class="account-quota-card" aria-label="今日免费积分">
        <div class="account-quota-main">
          <span>今日免费积分</span>
          <strong><b>${Number(quota.remaining || 0)}</b><i>/ ${Number(quota.total || 0)}</i></strong>
          <em>北京时间 0 点刷新 · 当日有效</em>
        </div>
        <div class="account-quota-detail">
          <span><b>积分来源</b><em>${quotaComposition(quota)}</em></span>
          <span><b>今日结算</b><em>已用 ${Number(quota.used || 0)} 分</em></span>
        </div>
      </section>
      <section class="account-wallet-card" data-account-wallet aria-label="玄枢算力积分余额">
        <div class="account-wallet-balance">
          <span>账户积分</span>
          <strong><b>${Number(wallet.balance || 0)}</b><i>分</i></strong>
          <em>长期有效 · 完整回答后结算</em>
        </div>
        <div class="account-wallet-packs">
          ${packs.map(pack => `
            <button type="button" data-credit-topup="${escapeHtml(pack.sku)}"${Number(pack.credits || 0) >= 660 ? ' class="featured"' : ""} ${wallet.topup_enabled && pack.available ? "" : "disabled"}>
              ${Number(pack.credits || 0) >= 660 ? '<small>多 60 分</small>' : ""}
              <span><b>${Number(pack.credits || 0)} 分 · $${(Number(pack.unit_amount || 0) / 100).toFixed(0)}</b><em>${packEstimate(pack)}</em></span>
              <i>${wallet.topup_enabled && pack.available ? "选择" : "暂未开放"}</i>
            </button>`).join("")}
        </div>
        <p>余额不足也会完成本次回答，最多扣到 0。</p>
        <button type="button" class="account-wallet-history" data-credit-history>
          <span><b>积分明细</b><em>获得与消耗记录</em></span><i>查看 →</i>
        </button>
      </section>
      <section class="account-referral-card">
        <div><span>分享带来的每日加成</span><strong>+${Number(quota.referral_bonus || 0)}</strong></div>
        <p>邀请新用户完成首次提问，每日积分 +${Number(quota.base || 10)}。</p>
        <div class="account-referral-stats">
          <span><b>${Number(quota.pending_referrals || 0)}</b><em>待完成首问</em></span>
          <span><b>${Number(quota.qualified_referrals || 0)}</b><em>已生效邀请</em></span>
          <span><b>${Number(quota.max_total || 100)}</b><em>每日最高积分</em></span>
        </div>
        <a href="/#gua-square" data-account-community>去社区分享 <span>→</span></a>
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
    body.querySelectorAll("[data-credit-topup]").forEach(button => {
      button.addEventListener("click", () => renderCheckoutReview(button.dataset.creditTopup));
    });
    body.querySelector("[data-credit-history]")?.addEventListener("click", () => {
      close(() => {
        const openEvent = new CustomEvent("xuanshu:opencredits", { cancelable: true });
        if (document.dispatchEvent(openEvent)) window.location.assign("/?view=credits");
      });
    });
    body.querySelector("[data-account-refresh]").addEventListener("click", () => refresh({ restoreFocus: true }));
    body.querySelector("[data-account-logout]").addEventListener("click", logout);
  }

  function creditDate(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    const [day, time = ""] = text.replace("T", " ").split(" ");
    return `${day} ${time.slice(0, 5)}`.trim();
  }

  function signedCredits(value) {
    const amount = Number(value || 0);
    if (amount > 0) return `+${amount}`;
    return String(amount);
  }

  function creditHistoryShell(tab) {
    return `
      <div class="credit-history-head">
        <button type="button" data-credit-back>← 返回账户</button>
        <span>积分中心</span>
        <h2 id="account-dialog-title" tabindex="-1">积分明细</h2>
        <p>账户积分长期有效；免费积分每日刷新；完整回答后结算。</p>
      </div>
      <div class="credit-history-tabs" role="tablist" aria-label="积分记录类型">
        <button type="button" role="tab" data-credit-tab="activity" aria-selected="${tab === "activity"}">积分流水</button>
        <button type="button" role="tab" data-credit-tab="orders" aria-selected="${tab === "orders"}">充值记录</button>
      </div>
      <div class="credit-history-content" data-credit-history-content aria-live="polite">
        <div class="credit-history-loading" role="status"><span></span><b>正在读取明细…</b></div>
      </div>`;
  }

  function bindCreditHistoryFrame(tab) {
    body.querySelector("[data-credit-back]")?.addEventListener("click", () => renderAccount());
    body.querySelectorAll("[data-credit-tab]").forEach(button => {
      button.addEventListener("click", () => {
        const nextTab = button.dataset.creditTab || "activity";
        if (nextTab !== tab) renderCreditHistory(nextTab, 1, "all");
      });
    });
  }

  function creditPagination(payload, { tab, filter }) {
    const pagination = payload?.pagination || {};
    if (Number(pagination.page_count || 1) <= 1) return "";
    return `
      <nav class="credit-history-pages" aria-label="明细翻页">
        <button type="button" data-credit-page="${Number(pagination.page || 1) - 1}" ${Number(pagination.page || 1) <= 1 ? "disabled" : ""}>上一页</button>
        <span>第 ${Number(pagination.page || 1)} / ${Number(pagination.page_count || 1)} 页 · 共 ${Number(pagination.total || 0)} 条</span>
        <button type="button" data-credit-page="${Number(pagination.page || 1) + 1}" ${Number(pagination.page || 1) >= Number(pagination.page_count || 1) ? "disabled" : ""}>下一页</button>
      </nav>`;
  }

  function activityRow(item) {
    const amount = Number(item?.amount || 0);
    const isCredit = amount > 0;
    const detail = [];
    if (String(item?.entry_type || "") === "answer_usage") {
      if (Number(item.required_credits || 0) !== Math.abs(amount)) {
        detail.push(`本次计价 ${Number(item.required_credits || 0)} 分`);
      }
      detail.push(`今日免费剩余 ${Number(item.daily_remaining || 0)} 分`);
    }
    detail.push(`账户余额 ${Number(item?.balance_after || 0)} 分`);
    return `
      <li class="credit-history-row ${isCredit ? "income" : "expense"}">
        <span class="credit-history-icon" aria-hidden="true">${isCredit ? "+" : "−"}</span>
        <span class="credit-history-copy">
          <b>${escapeHtml(item?.title || "积分变动")}</b>
          <em>${escapeHtml(item?.description || "积分余额已更新")}</em>
          <small>${escapeHtml(detail.join(" · "))}</small>
        </span>
        <span class="credit-history-value"><b>${signedCredits(amount)}</b><em>${escapeHtml(creditDate(item?.created_at))}</em></span>
      </li>`;
  }

  function renderActivityHistory(payload, filter) {
    const summary = payload?.summary || {};
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const filters = [["all", "全部"], ["credit", "获得"], ["usage", "消耗"]];
    return `
      <section class="credit-history-summary" aria-label="积分汇总">
        <span><em>账户余额</em><b>${Number(summary.account_balance || 0)}</b><small>长期有效</small></span>
        <span><em>累计获得</em><b>${Number(summary.lifetime_credited || 0)}</b><small>赠送与充值</small></span>
        <span><em>累计回答</em><b>${Number(summary.answer_count || 0)}</b><small>完整结算</small></span>
      </section>
      <div class="credit-history-filters" role="group" aria-label="筛选积分流水">
        ${filters.map(([value, label]) => `<button type="button" data-credit-filter="${value}" aria-pressed="${filter === value}">${label}</button>`).join("")}
      </div>
      ${items.length ? `<ol class="credit-history-list">${items.map(activityRow).join("")}</ol>` : `
        <div class="credit-history-empty"><b>暂无${filter === "credit" ? "获得" : filter === "usage" ? "消耗" : "积分"}记录</b><span>注册、充值或完整 AI 回答后自动记录。</span></div>`}
      ${creditPagination(payload, { tab: "activity", filter })}`;
  }

  function orderRow(item) {
    const labels = { paid: "已到账", pending: "待支付", expired: "已失效" };
    const status = String(item?.status || "pending");
    const currency = String(item?.currency || "usd").toUpperCase();
    return `
      <li class="credit-order-row ${escapeHtml(status)}">
        <span><b>${Number(item?.credits || 0)} 积分</b><em>${currency} ${(Number(item?.amount_total || 0) / 100).toFixed(2)}</em></span>
        <span><b>${escapeHtml(labels[status] || "处理中")}</b><em>${escapeHtml(creditDate(item?.paid_at || item?.expired_at || item?.created_at))}</em></span>
      </li>`;
  }

  function renderOrderHistory(payload, filter) {
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const filters = [["all", "全部"], ["paid", "已到账"], ["pending", "待支付"], ["expired", "已失效"]];
    return `
      <div class="credit-history-filters" role="group" aria-label="筛选充值记录">
        ${filters.map(([value, label]) => `<button type="button" data-credit-filter="${value}" aria-pressed="${filter === value}">${label}</button>`).join("")}
      </div>
      ${items.length ? `<ol class="credit-order-list">${items.map(orderRow).join("")}</ol>` : `
        <div class="credit-history-empty"><b>暂无符合条件的充值记录</b><span>仅显示 Stripe 签名确认到账的订单。</span></div>`}
      ${creditPagination(payload, { tab: "orders", filter })}`;
  }

  async function renderCreditHistory(tab = "activity", page = 1, filter = "all") {
    if (!state.authenticated) {
      renderAuth("login_password", "登录后查看积分明细。");
      return;
    }
    const requestToken = ++creditHistoryRequestToken;
    const normalizedTab = tab === "orders" ? "orders" : "activity";
    body.innerHTML = creditHistoryShell(normalizedTab);
    bindCreditHistoryFrame(normalizedTab);
    requestAnimationFrame(() => body.querySelector("#account-dialog-title")?.focus({ preventScroll: true }));
    try {
      const parameter = normalizedTab === "orders" ? "status" : "kind";
      const response = await fetch(`/api/billing/${normalizedTab}?page=${Math.max(1, Number(page || 1))}&${parameter}=${encodeURIComponent(filter)}`, {
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        cache: "no-store",
      });
      const payload = await readJson(response);
      if (requestToken !== creditHistoryRequestToken) return;
      const content = body.querySelector("[data-credit-history-content]");
      if (!content) return;
      content.innerHTML = normalizedTab === "orders"
        ? renderOrderHistory(payload, filter)
        : renderActivityHistory(payload, filter);
      content.querySelectorAll("[data-credit-filter]").forEach(button => {
        button.addEventListener("click", () => renderCreditHistory(normalizedTab, 1, button.dataset.creditFilter || "all"));
      });
      content.querySelectorAll("[data-credit-page]").forEach(button => {
        button.addEventListener("click", () => renderCreditHistory(normalizedTab, Number(button.dataset.creditPage || 1), filter));
      });
    } catch (reason) {
      if (requestToken !== creditHistoryRequestToken) return;
      const content = body.querySelector("[data-credit-history-content]");
      if (!content) return;
      content.innerHTML = `<div class="credit-history-empty error"><b>积分明细加载失败</b><span>${escapeHtml(reason?.message || "请稍后再试")}</span><button type="button" data-credit-retry>重新加载</button></div>`;
      content.querySelector("[data-credit-retry]")?.addEventListener("click", () => renderCreditHistory(normalizedTab, page, filter));
    }
  }

  function creditPack(sku) {
    return (state.creditWallet?.packs || []).find(pack => pack.sku === String(sku || "")) || null;
  }

  function cleanReturnUrl(value = location.href) {
    try {
      const url = new URL(value, location.origin);
      if (url.origin !== location.origin) return "/";
      url.searchParams.delete("checkout");
      url.searchParams.delete("session_id");
      url.searchParams.delete("order_id");
      return `${url.pathname}${url.search}${url.hash}` || "/";
    } catch (_) {
      return "/";
    }
  }

  function readCheckoutContext() {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(CHECKOUT_CONTEXT_KEY) || "null");
      if (!parsed || typeof parsed !== "object") return null;
      if (Date.now() - Number(parsed.started_at || 0) > 24 * 60 * 60 * 1000) {
        sessionStorage.removeItem(CHECKOUT_CONTEXT_KEY);
        return null;
      }
      return {
        order_id: String(parsed.order_id || ""),
        checkout_session_id: String(parsed.checkout_session_id || ""),
        sku: String(parsed.sku || ""),
        credits: Math.max(0, Number(parsed.credits || 0)),
        amount_total: Math.max(0, Number(parsed.amount_total || 0)),
        return_url: cleanReturnUrl(parsed.return_url || "/"),
        started_at: Number(parsed.started_at || Date.now()),
      };
    } catch (_) {
      return null;
    }
  }

  function writeCheckoutContext(value) {
    try {
      sessionStorage.setItem(CHECKOUT_CONTEXT_KEY, JSON.stringify(value));
    } catch (_) {}
  }

  function clearCheckoutContext() {
    try { sessionStorage.removeItem(CHECKOUT_CONTEXT_KEY); } catch (_) {}
  }

  function publishCheckoutEvent(detail) {
    try { checkoutChannel?.postMessage(detail); } catch (_) {}
  }

  function initCheckoutChannel() {
    if (checkoutChannel || typeof BroadcastChannel !== "function") return;
    try {
      checkoutChannel = new BroadcastChannel(CHECKOUT_CHANNEL_NAME);
      checkoutChannel.addEventListener("message", event => {
        const detail = event?.data;
        const context = readCheckoutContext();
        if (!detail || !context || (detail.order_id && detail.order_id !== context.order_id)) return;
        if (detail.type === "cancelled") {
          checkoutPollToken += 1;
          if (!dialog?.open) open("account");
          renderCheckoutStatus("cancelled", context);
          clearCheckoutContext();
        } else if (detail.type === "returned" && detail.session_id === context.checkout_session_id) {
          if (!dialog?.open) open("account");
          pollCheckoutStatus(detail.session_id, context, { attempts: 24, intervalMs: 1250 });
        }
      });
    } catch (_) {
      checkoutChannel = null;
    }
  }

  function focusCheckoutTitle() {
    requestAnimationFrame(() => body.querySelector("#account-dialog-title")?.focus({ preventScroll: true }));
  }

  function checkoutSteps(active = "confirm") {
    const steps = [
      ["confirm", "确认套餐"],
      ["pay", "Stripe 付款"],
      ["credit", "自动到账"],
    ];
    const activeIndex = Math.max(0, steps.findIndex(([key]) => key === active));
    return `<ol class="checkout-steps" aria-label="充值进度">${steps.map(([key, label], index) => `
      <li class="${index < activeIndex ? "done" : index === activeIndex ? "active" : ""}"${index === activeIndex ? ' aria-current="step"' : ""}>
        <b>${index + 1}</b><span>${label}</span>
      </li>`).join("")}</ol>`;
  }

  function renderCheckoutReview(sku, message = "") {
    checkoutPollToken += 1;
    const pack = creditPack(sku);
    if (!pack || !pack.available || !state.creditWallet?.topup_enabled) {
      renderAccount("积分包暂不可购买。", "error");
      return;
    }
    const dollars = (Number(pack.unit_amount || 0) / 100).toFixed(0);
    body.innerHTML = `
      <div class="checkout-head">
        <button type="button" data-checkout-back>返回账户</button>
        <span>积分充值</span>
        <h2 id="account-dialog-title" tabindex="-1">确认充值套餐</h2>
        <p>确认后前往 Stripe 付款。</p>
      </div>
      ${checkoutSteps("confirm")}
      ${message ? `<p class="account-context-note error" role="alert">${escapeHtml(message)}</p>` : ""}
      <section class="checkout-summary" aria-label="订单摘要">
        <div class="checkout-summary-main">
          <span>本次到账</span>
          <strong>${Number(pack.credits || 0)}<i>积分</i></strong>
          <em>${escapeHtml(packEstimate(pack))}</em>
        </div>
        <div class="checkout-summary-price">
          <span>应付金额</span>
          <strong>$${dollars}<i>USD</i></strong>
          <em>一次性付款</em>
        </div>
      </section>
      <p class="checkout-fx-note">支付由 Stripe 处理，成功后自动到账；以美元结算。</p>
      <div class="checkout-actions">
        <button type="button" class="primary" data-checkout-confirm>前往 Stripe 付款 · $${dollars}</button>
        <button type="button" data-checkout-back>更换套餐</button>
      </div>`;
    body.querySelectorAll("[data-checkout-back]").forEach(button => {
      button.addEventListener("click", () => {
        renderAccount();
        requestAnimationFrame(() => body.querySelector(`[data-credit-topup="${CSS.escape(pack.sku)}"]`)?.focus({ preventScroll: true }));
      });
    });
    body.querySelector("[data-checkout-confirm]")?.addEventListener("click", () => startCreditCheckout(pack.sku));
    focusCheckoutTitle();
  }

  async function startCreditCheckout(sku) {
    const pack = creditPack(sku);
    const button = body.querySelector("[data-checkout-confirm]");
    if (!pack || !button || button.disabled) return;
    button.disabled = true;
    button.textContent = "正在打开 Stripe…";
    body.setAttribute("aria-busy", "true");
    let checkoutTab = null;
    try { checkoutTab = window.open("about:blank", "xuanshu-stripe-checkout"); } catch (_) {}
    const suffix = globalThis.crypto?.randomUUID?.()
      || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    try {
      const response = await fetch("/api/billing/checkout-sessions", {
        method: "POST",
        headers: csrfHeaders({
          "Content-Type": "application/json",
          Accept: "application/json",
          "Idempotency-Key": `credit-${suffix}`,
        }),
        credentials: "same-origin",
        body: JSON.stringify({ sku }),
      });
      const payload = await readJson(response);
      if (!payload.url || !payload.checkout_session_id) throw new Error("Stripe 未返回结账地址");
      const context = {
        order_id: payload.order_id,
        checkout_session_id: payload.checkout_session_id,
        sku: pack.sku,
        credits: Number(pack.credits || 0),
        amount_total: Number(pack.unit_amount || 0),
        return_url: cleanReturnUrl(),
        started_at: Date.now(),
      };
      writeCheckoutContext(context);
      if (checkoutTab && !checkoutTab.closed) {
        try {
          checkoutTab.sessionStorage.setItem(CHECKOUT_CONTEXT_KEY, JSON.stringify(context));
          checkoutTab.opener = null;
          checkoutTab.location.replace(payload.url);
          body.removeAttribute("aria-busy");
          pollCheckoutStatus(payload.checkout_session_id, context, {
            initialKind: "paying",
            checkoutUrl: payload.url,
            attempts: 90,
            intervalMs: 1500,
          });
          return;
        } catch (_) {
          try { checkoutTab.close(); } catch (_) {}
        }
      }
      window.location.assign(payload.url);
    } catch (reason) {
      try { checkoutTab?.close(); } catch (_) {}
      body.removeAttribute("aria-busy");
      renderCheckoutReview(pack.sku, reason?.message || "暂时无法打开 Stripe 结账页");
    }
  }

  function checkoutDisplayData(context = null, status = null) {
    const sku = String(status?.sku || context?.sku || "");
    const pack = creditPack(sku);
    return {
      sku,
      credits: Number(status?.credits || context?.credits || pack?.credits || 0),
      amount_total: Number(status?.amount_total || context?.amount_total || pack?.unit_amount || 0),
      return_url: cleanReturnUrl(context?.return_url || "/"),
    };
  }

  function renderCheckoutStatus(kind, context = null, status = null) {
    const display = checkoutDisplayData(context, status);
    const dollars = (display.amount_total / 100).toFixed(0);
    const balance = Number(status?.wallet?.balance ?? state.creditWallet?.balance ?? 0);
    const content = {
      pending: {
        eyebrow: "到账核验",
        title: "正在确认到账",
        description: "等待 Stripe 确认，请勿重复付款。",
      },
      paying: {
        eyebrow: "Stripe 安全付款",
        title: "Stripe 付款页已打开",
        description: "付款后自动更新。",
      },
      delayed: {
        eyebrow: "到账核验",
        title: "还在确认中",
        description: "通知可能稍慢，请勿重复付款。",
      },
      paid: {
        eyebrow: "充值完成",
        title: `${display.credits} 积分已到账`,
        description: "",
      },
      cancelled: {
        eyebrow: "付款已取消",
        title: "没有产生本次充值",
        description: "没有扣款或增加积分。",
      },
      expired: {
        eyebrow: "付款链接已过期",
        title: "请重新选择套餐",
        description: "链接已失效，不会扣款。",
      },
      error: {
        eyebrow: "暂时无法核验",
        title: "到账状态没有更新",
        description: "请勿重复付款，可重新检查。",
      },
    }[kind] || {};
    const progressStep = kind === "paid" ? "credit" : kind === "pending" || kind === "delayed" ? "credit" : "pay";
    const showOrder = display.credits > 0 && display.amount_total > 0;
    const checkoutChildTab = window.name === "xuanshu-stripe-checkout";
    body.innerHTML = `
      <div class="checkout-status-head" aria-live="polite">
        <span>${escapeHtml(content.eyebrow || "充值状态")}</span>
        <h2 id="account-dialog-title" tabindex="-1">${escapeHtml(content.title || "充值状态")}</h2>
        ${content.description ? `<p>${escapeHtml(content.description)}</p>` : ""}
        ${kind === "pending" ? '<div class="checkout-status-progress" role="progressbar" aria-label="正在核验 Stripe 付款结果"><i aria-hidden="true"></i></div>' : ""}
      </div>
      ${checkoutSteps(progressStep)}
      ${showOrder ? `<section class="checkout-status-order${kind === "paid" ? "" : " compact"}" aria-label="本次充值">
        <span><b>${display.credits} 积分</b><em>本次套餐</em></span>
        <span><b>$${dollars} USD</b><em>一次性付款</em></span>
        ${kind === "paid" ? `<span><b>${balance} 分</b><em>账户积分余额</em></span>` : ""}
      </section>` : ""}
      <div class="checkout-actions">
        ${kind === "paid" ? `<button type="button" class="primary" data-checkout-resume>${checkoutChildTab ? "关闭并返回" : "继续使用"}</button><button type="button" data-checkout-account>账户余额</button>` : ""}
        ${kind === "paying" ? '<button type="button" class="primary" data-checkout-reopen>打开 Stripe 付款页</button><button type="button" data-checkout-account>返回账户</button>' : ""}
        ${kind === "pending" ? '<button type="button" data-checkout-account>回到账户</button>' : ""}
        ${kind === "delayed" || kind === "error" ? '<button type="button" class="primary" data-checkout-refresh>刷新状态</button><button type="button" data-checkout-account>账户余额</button>' : ""}
        ${kind === "cancelled" || kind === "expired" ? `${display.sku ? '<button type="button" class="primary" data-checkout-retry>重新付款</button>' : ""}${checkoutChildTab ? '<button type="button" data-checkout-resume>关闭并返回</button>' : '<button type="button" data-checkout-account>返回账户</button>'}` : ""}
      </div>`;
    body.querySelector("[data-checkout-account]")?.addEventListener("click", () => {
      renderAccount(kind === "paid" ? "积分已到账。" : "稍后刷新余额。", kind === "paid" ? "success" : "");
      requestAnimationFrame(() => body.querySelector("[data-account-wallet]")?.scrollIntoView({ block: "center" }));
    });
    body.querySelector("[data-checkout-resume]")?.addEventListener("click", () => {
      if (checkoutChildTab) {
        window.close();
        return;
      }
      const target = display.return_url;
      close(() => {
        const current = cleanReturnUrl();
        if (target && target !== current) window.location.assign(target);
      });
    });
    body.querySelector("[data-checkout-reopen]")?.addEventListener("click", () => {
      const url = String(status?.checkout_url || "");
      if (!url) {
        renderCheckoutStatus("delayed", context, status);
        return;
      }
      const reopened = window.open("about:blank", "xuanshu-stripe-checkout");
      if (!reopened) {
        renderCheckoutStatus("error", context, status);
        return;
      }
      try {
        if (context) reopened.sessionStorage.setItem(CHECKOUT_CONTEXT_KEY, JSON.stringify(context));
        reopened.opener = null;
        reopened.location.replace(url);
      } catch (_) {
        try { reopened.close(); } catch (_) {}
        renderCheckoutStatus("error", context, status);
      }
    });
    body.querySelector("[data-checkout-retry]")?.addEventListener("click", () => renderCheckoutReview(display.sku));
    body.querySelector("[data-checkout-refresh]")?.addEventListener("click", () => {
      const sessionId = String(status?.checkout_session_id || context?.checkout_session_id || "");
      if (sessionId) pollCheckoutStatus(sessionId, context, true);
      else renderAccount("没有找到这笔充值，请到账户确认余额。", "error");
    });
    focusCheckoutTitle();
  }

  async function pollCheckoutStatus(sessionId, context = null, options = {}) {
    const token = ++checkoutPollToken;
    const manual = options === true || options?.manual === true;
    const attempts = Number(options?.attempts || (manual ? 8 : 12));
    const intervalMs = Number(options?.intervalMs || 1250);
    const initialKind = String(options?.initialKind || "pending");
    renderCheckoutStatus(initialKind, context, {
      checkout_session_id: sessionId,
      checkout_url: String(options?.checkoutUrl || ""),
    });
    let lastStatus = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (token !== checkoutPollToken) return;
      if (attempt) await new Promise(resolve => setTimeout(resolve, intervalMs));
      try {
        const response = await fetch(`/api/billing/checkout-sessions/${encodeURIComponent(sessionId)}`, {
          headers: { Accept: "application/json" },
          credentials: "same-origin",
        });
        lastStatus = await readJson(response);
        if (lastStatus.status === "paid") {
          await refresh({ render: false }).catch(() => {});
          renderCheckoutStatus("paid", context, lastStatus);
          clearCheckoutContext();
          return;
        }
        if (lastStatus.status === "expired") {
          renderCheckoutStatus("expired", context, lastStatus);
          clearCheckoutContext();
          return;
        }
      } catch (_) {
        if (attempt === attempts - 1) {
          renderCheckoutStatus("error", context, lastStatus || { checkout_session_id: sessionId });
          return;
        }
      }
    }
    renderCheckoutStatus("delayed", context, lastStatus || { checkout_session_id: sessionId });
  }

  function clearCheckoutQuery() {
    const url = new URL(location.href);
    url.searchParams.delete("checkout");
    url.searchParams.delete("session_id");
    url.searchParams.delete("order_id");
    history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function handleCheckoutReturn() {
    const params = new URLSearchParams(location.search);
    const checkout = params.get("checkout");
    if (checkout !== "success" && checkout !== "cancelled") return;
    const sessionId = String(params.get("session_id") || "");
    const orderId = String(params.get("order_id") || "");
    const stored = readCheckoutContext();
    const context = stored && (!orderId || !stored.order_id || stored.order_id === orderId) ? stored : null;
    clearCheckoutQuery();
    if (checkout === "cancelled") {
      publishCheckoutEvent({ type: "cancelled", order_id: orderId || context?.order_id || "" });
    } else if (sessionId) {
      publishCheckoutEvent({ type: "returned", order_id: context?.order_id || "", session_id: sessionId });
    }
    ready().then(() => {
      if (!state.authenticated) {
        open("login", "登录后查看充值状态。");
        return;
      }
      open("account");
      if (checkout === "cancelled") {
        renderCheckoutStatus("cancelled", context);
        clearCheckoutContext();
        return;
      }
      if (!sessionId) {
        renderCheckoutStatus("error", context);
        return;
      }
      pollCheckoutStatus(sessionId, context);
    });
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
      renderAuth("login_password", "已退出。");
    } catch (reason) {
      renderAccount(reason?.message || "退出失败，请稍后再试", "error");
    }
  }

  async function requireLogin(options = {}) {
    await ready();
    if (state.authenticated) return true;
    open(options.mode || "register", options.message || "请先登录。");
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
        <span><b>朋友分享了一条真实卦帖</b><em>注册后领取每日免费积分。</em></span>
        <button type="button" data-invite-register>注册</button>`;
      document.body.append(prompt);
      prompt.querySelector("[data-invite-dismiss]").addEventListener("click", () => prompt.remove());
      prompt.querySelector("[data-invite-register]").addEventListener("click", () => open("register", "首次有效提问会为分享者增加每日积分。"));
    });
  }

  function init() {
    bindAccountButtons();
    initCheckoutChannel();
    ready();
    showInvitePrompt();
    handleCheckoutReturn();
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
