(function (global) {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const RISK_ACK_TEXT = "我已知晓：命理解读只作参考，不替代医疗、法律、投资等专业判断。";
  const RISK_ACK_STORAGE_KEY = "xz-risk-ack-v1";
  const RESUME_COOKIE = "xz_resume";
  const RESUME_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

  function bindHorizontalTabKeys(buttons, activate) {
    buttons.forEach((button, index) => {
      button.addEventListener("keydown", event => {
        let next = index;
        if (event.key === "ArrowRight") next = (index + 1) % buttons.length;
        else if (event.key === "ArrowLeft") next = (index - 1 + buttons.length) % buttons.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = buttons.length - 1;
        else return;
        event.preventDefault();
        activate(buttons[next]);
        buttons[next].focus();
      });
    });
  }

  function storedRiskAccepted() {
    try {
      return localStorage.getItem(RISK_ACK_STORAGE_KEY) === "1";
    } catch (_) {
      return false;
    }
  }

  function normalizedRiskAcceptance(value = {}) {
    const acceptedHere = Object.values(value || {}).some(Boolean);
    return storedRiskAccepted() || acceptedHere ? { __all__: true } : {};
  }

  function createOpaqueId(prefix) {
    if (!global.crypto?.getRandomValues) throw new Error("Secure random unavailable");
    const bytes = new Uint8Array(8);
    global.crypto.getRandomValues(bytes);
    return prefix + Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  }

  function createSessionId() {
    return createOpaqueId("s_");
  }

  function createClientRequestId() {
    return createOpaqueId("r_");
  }

  function validSessionId(value) {
    return /^s_[0-9a-f]{16}$/.test(String(value || ""));
  }

  function readCookie(name) {
    const prefix = `${name}=`;
    return (document.cookie || "")
      .split(";")
      .map(part => part.trim())
      .find(part => part.startsWith(prefix))
      ?.slice(prefix.length) || "";
  }

  function writeCookie(name, value, maxAge = RESUME_COOKIE_MAX_AGE) {
    const secure = global.location?.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; SameSite=Lax${secure}`;
  }

  function clearCookie(name) {
    const secure = global.location?.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax${secure}`;
  }

  global.XuanxueCore = Object.freeze({
    $,
    $$,
    RESUME_COOKIE,
    RISK_ACK_TEXT,
    bindHorizontalTabKeys,
    clearCookie,
    createClientRequestId,
    createSessionId,
    normalizedRiskAcceptance,
    readCookie,
    validSessionId,
    writeCookie,
  });
})(window);
