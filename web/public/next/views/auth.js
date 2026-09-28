// 登录 / 注册 / 重设密码面板。账户由服务端决定，这里只提交表单并应用返回的账户状态。
// 交互：字段就地校验（中文提示，聚焦第一个有误的字段）；回车依次前进到下一个待填项；
// 验证码可整段粘贴；提交中按钮保持焦点；面板在请求途中被关掉时，等请求结束再回报结果。
import { h, svg } from "../lib/dom.js?v=n6";
import { icon, brandMark } from "../lib/icons.js?v=n6";
import { post } from "../lib/api.js?v=n6";
import { applyAccount } from "../lib/store.js?v=n6";
import { openSheet } from "../ui/overlay.js?v=n6";
import { toast } from "../ui/toast.js?v=n6";

const MODES = {
  login_password: { title: "登录玄枢", submit: "密码登录", busy: "正在登录…", done: "已登录", note: "密码无法登录时，可以验证邮箱后重设密码。" },
  login_code: { title: "登录玄枢", submit: "验证码登录", busy: "正在登录…", done: "邮箱验证完成，已登录", note: "验证码 10 分钟内有效。" },
  register: { title: "创建账户", submit: "注册", busy: "正在注册…", done: "邮箱已验证，账户已创建", note: "邮箱不会在社区展示。" },
  reset_password: { title: "重设密码", submit: "重设密码并登录", busy: "正在重设…", done: "密码已重设，已登录", note: "验证码 10 分钟内有效；重设后可使用新密码登录。" },
};
const PURPOSE = { register: "register", reset_password: "password_reset", login_code: "login", login_password: "login" };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_LENGTH = 6;
const PASSWORD_MIN = 8;
const EYE_OFF = '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="2.8"/><path d="M4.5 19.5 19.5 4.5"/>';
const cooldown = {};
const sent = {};
// 本次打开页面期间记住输入过的邮箱（只在内存里）：误关面板后重新打开不用重填。
let rememberedEmail = "";
let open = null;

// 中文输入法常打出全角字符：邮箱与验证码统一转成半角。
const halfWidth = text => String(text || "")
  .replace(/[！-～]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
  .replace(/　/g, " ");
// 从「验证码：123456，10 分钟内有效」这类整段文字里取出 6 位数字。
const codeFrom = text => {
  const normalized = halfWidth(text);
  const run = /(?:^|\D)(\d{6})(?!\d)/.exec(normalized);
  return run ? run[1] : normalized.replace(/\D/g, "").slice(0, CODE_LENGTH);
};
const isEnter = event => event.key === "Enter" && !event.isComposing && event.keyCode !== 229;
const charCount = text => Array.from(String(text || "")).length;

function setBusy(button, text) {
  button.setAttribute("aria-busy", "true");
  button.classList.add("is-busy");
  button.replaceChildren(h("span", { class: "spinner", "aria-hidden": "true" }), text);
}

function setIdle(button, ...content) {
  button.removeAttribute("aria-busy");
  button.classList.remove("is-busy");
  button.replaceChildren(...content);
}

export function openAuth({ reason = "", mode = "login_password" } = {}) {
  if (open) return open.promise;
  let resolveResult;
  const promise = new Promise(resolve => { resolveResult = resolve; });
  let succeeded = false;
  let closed = false;
  let inflight = null;
  let renders = 0;
  let stopTimer = () => {};
  const state = { mode: MODES[mode] ? mode : "login_password", email: rememberedEmail };
  const content = h("div", { class: "auth" });
  const sheet = openSheet({
    title: "",
    label: "登录或注册",
    body: content,
    className: "sheet-auth",
    onClose: () => {
      closed = true;
      open = null;
      stopTimer();
      // 请求还在途中：等它结束再回报，已经登录成功就不会被当成「取消」。
      Promise.resolve(inflight).catch(() => {}).finally(() => resolveResult(succeeded));
    },
  });
  open = { promise, sheet };

  function render({ message = "", tone = "", focus = "auto" } = {}) {
    stopTimer();
    const token = ++renders;
    const live = () => !closed && token === renders;
    const config = MODES[state.mode];
    const isRegister = state.mode === "register";
    const isReset = state.mode === "reset_password";
    const usesCode = state.mode !== "login_password";
    const usesPassword = state.mode !== "login_code";
    const newPassword = isRegister || isReset;
    const purpose = PURPOSE[state.mode];
    const uid = `auth-${Math.random().toString(36).slice(2, 8)}`;
    const fields = {};
    let busy = false;
    let sending = false;

    const alert = h("div", { class: "auth-error", role: "alert", hidden: true });
    const status = h("div", { class: "auth-status", role: "status", hidden: true });
    const showAlert = (text, action = null) => {
      status.hidden = true;
      alert.replaceChildren(...[icon("alert", "icon-sm"), h("span", null, text),
        action ? h("button", { type: "button", class: "link-btn", onClick: action.onClick }, action.label) : null].filter(Boolean));
      alert.hidden = false;
    };
    const showStatus = text => {
      alert.hidden = true;
      status.replaceChildren(icon("check", "icon-sm"), h("span", null, text));
      status.hidden = false;
    };

    const email = h("input", {
      class: "input", type: "email", name: "email", required: true, value: state.email,
      autocomplete: "username", inputmode: "email", enterkeyhint: "next",
      autocapitalize: "off", autocorrect: "off", spellcheck: "false",
      placeholder: "name@example.com",
    });
    const readEmail = () => halfWidth(email.value).trim();
    const password = usesPassword ? h("input", {
      class: "input", type: "password", name: "password", required: true, maxlength: 128,
      autocomplete: newPassword ? "new-password" : "current-password", enterkeyhint: "go",
      placeholder: newPassword ? `至少 ${PASSWORD_MIN} 位` : "输入密码",
    }) : null;
    const reveal = password ? h("button", { type: "button", class: "auth-reveal", "aria-label": "显示密码", "aria-pressed": "false" }, icon("eye")) : null;
    const code = usesCode ? h("input", {
      class: "input auth-code", type: "text", name: "code", required: true, maxlength: CODE_LENGTH,
      autocomplete: "one-time-code", inputmode: "numeric", enterkeyhint: state.mode === "login_code" ? "go" : "next",
      autocapitalize: "off", autocorrect: "off", spellcheck: "false",
      placeholder: `${CODE_LENGTH} 位数字`,
    }) : null;
    const sendCode = usesCode ? h("button", { type: "button", class: "btn btn-soft auth-code-btn" }, "发送验证码") : null;
    const submit = h("button", { type: "submit", class: "btn btn-primary btn-lg btn-block" }, config.submit);

    // 每个字段：可见标签、就地错误提示（aria-describedby 关联），输入时清除。
    const field = (key, label, input, control = input) => {
      input.id = `${uid}-${key}`;
      const error = h("p", { class: "field-error auth-field-error", id: `${uid}-${key}-error`, hidden: true });
      input.setAttribute("aria-describedby", error.id);
      fields[key] = { input, error };
      return h("div", { class: "field" }, h("label", { class: "field-label", for: input.id }, label), control, error);
    };
    const showFieldError = (key, text) => {
      const entry = fields[key];
      if (!entry) return;
      entry.error.replaceChildren(icon("alert", "icon-sm"), h("span", null, text));
      entry.error.hidden = false;
      entry.input.setAttribute("aria-invalid", "true");
    };
    const clearFieldError = key => {
      const entry = fields[key];
      if (!entry || entry.error.hidden) return;
      // 被 aria-describedby 引用的隐藏元素仍会被读出：隐藏时一并清空文字。
      entry.error.hidden = true;
      entry.error.replaceChildren();
      entry.input.removeAttribute("aria-invalid");
    };

    function problems() {
      const list = [];
      const value = readEmail();
      if (!value) list.push(["email", "请填写邮箱"]);
      else if (!EMAIL_RE.test(value)) list.push(["email", "邮箱格式不对，请检查一下"]);
      if (usesCode && code.value.length !== CODE_LENGTH) {
        list.push(["code", code.value ? `验证码是 ${CODE_LENGTH} 位数字` : sent[purpose] ? `请填写邮件里的 ${CODE_LENGTH} 位验证码` : "请先发送验证码，再填写邮件里的数字"]);
      }
      if (usesPassword) {
        if (!password.value) list.push(["password", newPassword ? "请设置密码" : "请输入密码"]);
        else if (newPassword && charCount(password.value) < PASSWORD_MIN) list.push(["password", `密码至少 ${PASSWORD_MIN} 位`]);
      }
      return list;
    }

    const canSend = () => (cooldown[purpose] || 0) <= Date.now();
    const requestSubmit = () => (form.requestSubmit ? form.requestSubmit() : submit.click());

    /* ---------- 验证码 ---------- */
    const syncCode = () => {
      if (!sendCode || sending) return;
      const left = Math.ceil(((cooldown[purpose] || 0) - Date.now()) / 1000);
      if (left > 0) {
        sendCode.disabled = true;
        sendCode.textContent = `${left} 秒后可重发`;
      } else {
        sendCode.disabled = false;
        sendCode.textContent = sent[purpose] ? "重新发送" : "发送验证码";
        stopTimer();
      }
    };
    const startTimer = () => {
      stopTimer();
      const timer = setInterval(() => (live() ? syncCode() : clearInterval(timer)), 1000);
      stopTimer = () => clearInterval(timer);
    };

    async function sendCodeNow() {
      if (sending || !canSend() || !sendCode) return;
      const value = readEmail();
      if (!value || !EMAIL_RE.test(value)) {
        showFieldError("email", value ? "邮箱格式不对，请检查一下" : "先填写邮箱，再发送验证码");
        email.focus();
        return;
      }
      if (value !== email.value) email.value = value;
      sending = true;
      setBusy(sendCode, "正在发送…");
      alert.hidden = true;
      try {
        const payload = await post("/api/auth/code", { email: value, purpose });
        cooldown[purpose] = Date.now() + Math.max(10, Number(payload?.retry_after || 60)) * 1000;
        sent[purpose] = true;
        if (!live()) return;
        showStatus(payload?.message || "验证码已发送；如果收件箱里没有，请看看垃圾邮件。");
        clearFieldError("code");
        code.focus();
      } catch (reason) {
        if (!live()) return;
        showAlert(reason?.message || "验证码发送失败，请稍后再试");
      } finally {
        sending = false;
        if (live()) {
          setIdle(sendCode, "发送验证码");
          syncCode();
          if (!canSend()) startTimer();
        }
      }
    }

    sendCode?.addEventListener("click", sendCodeNow);
    code?.addEventListener("paste", event => {
      const text = event.clipboardData?.getData("text") || "";
      if (!text) return;
      event.preventDefault();
      code.value = codeFrom(text);
      code.dispatchEvent(new Event("input", { bubbles: true }));
    });
    let codeLength = 0;
    code?.addEventListener("input", () => {
      const digits = codeFrom(code.value);
      if (digits !== code.value) code.value = digits;
      clearFieldError("code");
      // 填满 6 位：验证码登录直接提交；注册 / 重设则前往密码。
      if (digits.length === CODE_LENGTH && codeLength < CODE_LENGTH) {
        if (state.mode === "login_code" && EMAIL_RE.test(readEmail())) requestSubmit();
        else if (password && !password.value) password.focus();
      }
      codeLength = digits.length;
    });

    /* ---------- 回车：前进到下一个待填项 ---------- */
    const ORDER = ["email", "code", "password"];
    // 还没发过验证码时，回车就是「发送验证码」；发过之后只移动焦点，不重复发送。
    const firstSend = () => !sent[purpose] && canSend();
    function advanceFrom(key) {
      const list = problems();
      const own = list.find(([name]) => name === key);
      if (key === "email") {
        if (own) { showFieldError("email", own[1]); return; }
        if (usesCode && code.value.length !== CODE_LENGTH) {
          if (firstSend()) sendCodeNow();
          else code.focus();
          return;
        }
      }
      if (key === "code") {
        if (!code.value && firstSend()) { sendCodeNow(); return; }
        if (own) { showFieldError("code", own[1]); return; }
      }
      const next = list.find(([name]) => ORDER.indexOf(name) > ORDER.indexOf(key));
      if (next) fields[next[0]].input.focus();
      else requestSubmit();
    }
    email.addEventListener("keydown", event => {
      if (!isEnter(event)) return;
      event.preventDefault();
      advanceFrom("email");
    });
    code?.addEventListener("keydown", event => {
      if (!isEnter(event)) return;
      event.preventDefault();
      advanceFrom("code");
    });

    email.addEventListener("input", () => {
      state.email = email.value;
      rememberedEmail = email.value.trim();
      clearFieldError("email");
    });
    email.addEventListener("blur", () => {
      const value = readEmail();
      if (value !== email.value) {
        email.value = value;
        state.email = value;
        rememberedEmail = value;
      }
    });
    password?.addEventListener("input", () => clearFieldError("password"));
    // 显示 / 隐藏密码：按下时不抢走输入框焦点，手机键盘不会收起。
    reveal?.addEventListener("mousedown", event => event.preventDefault());
    reveal?.addEventListener("click", () => {
      const show = password.type === "password";
      password.type = show ? "text" : "password";
      reveal.setAttribute("aria-pressed", String(show));
      reveal.classList.toggle("is-on", show);
      reveal.replaceChildren(show ? svg(`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${EYE_OFF}</svg>`) : icon("eye"));
    });

    const form = h("form", { class: "auth-form", novalidate: true },
      field("email", "邮箱", email),
      usesCode ? field("code", "邮箱验证码", code, h("div", { class: "auth-code-row" }, code, sendCode)) : null,
      password ? field("password", isReset ? "新密码" : "密码", password, h("div", { class: "auth-password" }, password, reveal)) : null,
      alert,
      status,
      submit,
      h("p", { class: "auth-note" }, config.note));

    /* ---------- 提交 ---------- */
    form.addEventListener("submit", event => {
      event.preventDefault();
      if (busy) return;
      const list = problems();
      Object.keys(fields).forEach(clearFieldError);
      if (list.length) {
        list.forEach(([key, text]) => showFieldError(key, text));
        fields[list[0][0]].input.focus();
        return;
      }
      inflight = submitNow().finally(() => { inflight = null; });
    });

    async function submitNow() {
      busy = true;
      setBusy(submit, config.busy);
      alert.hidden = true;
      const value = readEmail();
      const body = state.mode === "register" || state.mode === "reset_password"
        ? { email: value, password: password.value, code: code.value }
        : state.mode === "login_code"
          ? { email: value, code: code.value, method: "code" }
          : { email: value, password: password.value, method: "password" };
      const endpoint = state.mode === "register" ? "register" : state.mode === "reset_password" ? "password/reset" : "login";
      try {
        const payload = await post(`/api/auth/${endpoint}`, body);
        applyAccount(payload);
        succeeded = true;
        rememberedEmail = value;
        toast(config.done, { type: "ok" });
        if (!closed) sheet.close("done");
      } catch (reason) {
        busy = false;
        if (!live()) return;
        setIdle(submit, config.submit);
        const text = String(reason?.message || "操作没有成功，请稍后再试");
        if (state.mode === "login_password" && text.includes("验证邮箱")) {
          state.mode = "reset_password";
          render({ message: text, tone: "info" });
          return;
        }
        const suggestLogin = state.mode === "register" && reason?.status === 409;
        showAlert(text, suggestLogin ? { label: "改为登录", onClick: switchTo("login_password") } : null);
        // 焦点回到最可能需要修改的字段，方便直接重输。
        const target = suggestLogin ? alert.querySelector(".link-btn")
          : code && text.includes("验证码") ? code
            : password && (text.includes("密码") || reason?.status === 401) ? password
              : text.includes("邮箱") ? email : null;
        if (target) {
          target.focus();
          if (target === code || target === password) target.select();
        }
      }
    }

    /* ---------- 切换方式 ---------- */
    function switchTo(next, { focus: focusMode = "auto" } = {}) {
      return () => {
        if (busy || state.mode === next) return;
        state.email = email.value;
        state.mode = next;
        render({ focus: focusMode });
      };
    }
    const TABS = [["login_password", "密码登录"], ["login_code", "验证码登录"]];
    const methodSwitch = isRegister || isReset ? null : h("div", { class: "seg auth-seg", role: "tablist", "aria-label": "登录方式" },
      TABS.map(([key, label]) => h("button", {
        type: "button",
        role: "tab",
        id: `${uid}-tab-${key}`,
        "aria-selected": String(state.mode === key),
        "aria-controls": `${uid}-panel`,
        tabindex: state.mode === key ? "0" : "-1",
        onClick: switchTo(key),
      }, label)));
    methodSwitch?.addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? "login_password" : event.key === "End" ? "login_code"
        : state.mode === "login_password" ? "login_code" : "login_password";
      switchTo(next, { focus: "tab" })();
    });

    const foot = isRegister
      ? h("p", { class: "auth-foot" }, "已经有账号？", h("button", { type: "button", class: "link-btn", onClick: switchTo("login_password") }, "直接登录"))
      : isReset
        ? h("p", { class: "auth-foot" }, "想起密码了？", h("button", { type: "button", class: "link-btn", onClick: switchTo("login_password") }, "返回密码登录"))
        : h("p", { class: "auth-foot" },
          h("button", { type: "button", class: "link-btn", onClick: switchTo("register") }, "注册新账号"),
          h("span", { class: "auth-foot-sep", "aria-hidden": "true" }, "·"),
          h("button", { type: "button", class: "link-btn", onClick: switchTo("reset_password") }, "忘记或重设密码"));

    // replaceChildren 会把 null 当成文字「null」，这里先滤掉空位。
    content.replaceChildren(...[
      h("div", { class: "auth-hero" },
        brandMark(),
        h("h2", { class: "auth-title" }, config.title),
        h("p", { class: "auth-sub" }, isRegister
          ? (reason ? `${reason} 验证邮箱后创建账户，注册即赠送积分。` : "验证邮箱后创建账户，注册即赠送积分。")
          : isReset ? "验证邮箱后设置一个新密码。" : reason || "登录后可以保存命盘、参与讨论、接收回复。")),
      methodSwitch,
      h("div", methodSwitch ? { id: `${uid}-panel`, role: "tabpanel", "aria-labelledby": `${uid}-tab-${state.mode}` } : null, form),
      foot].filter(Boolean));

    if (message && tone === "error") showAlert(message);
    else if (message) showStatus(message);
    syncCode();
    if (sendCode && !canSend()) startTimer();

    // 聚焦下一步：先邮箱，再验证码（还没发送时聚焦「发送验证码」），再密码。
    requestAnimationFrame(() => {
      if (!live()) return;
      const target = focus === "tab" ? methodSwitch?.querySelector('[aria-selected="true"]')
        : !EMAIL_RE.test(readEmail()) ? email
          : usesCode && code.value.length !== CODE_LENGTH ? (firstSend() ? sendCode : code)
            : password && !password.value ? password : submit;
      target?.focus({ preventScroll: true });
    });
  }

  render();
  return promise;
}
