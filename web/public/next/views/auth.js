// 登录 / 注册 / 重设密码面板。账户由服务端决定，这里只提交表单并应用返回的账户状态。
import { h } from "../lib/dom.js?v=n1";
import { icon } from "../lib/icons.js?v=n1";
import { post } from "../lib/api.js?v=n1";
import { applyAccount } from "../lib/store.js?v=n1";
import { openSheet } from "../ui/overlay.js?v=n1";
import { toast } from "../ui/toast.js?v=n1";

const MODES = {
  login_password: { title: "登录玄枢", submit: "密码登录", busy: "正在登录…", done: "已登录", note: "密码无法登录时，可以验证邮箱后重设密码。" },
  login_code: { title: "登录玄枢", submit: "验证码登录", busy: "正在登录…", done: "邮箱验证完成，已登录", note: "验证码 10 分钟内有效。" },
  register: { title: "创建账户", submit: "注册", busy: "正在注册…", done: "邮箱已验证，账户已创建", note: "邮箱不会在社区展示。" },
  reset_password: { title: "重设密码", submit: "重设密码并登录", busy: "正在重设…", done: "密码已重设，已登录", note: "验证码 10 分钟内有效；重设后可使用新密码登录。" },
};
const PURPOSE = { register: "register", reset_password: "password_reset", login_code: "login", login_password: "login" };
const cooldown = {};
let open = null;

export function openAuth({ reason = "", mode = "login_password" } = {}) {
  if (open) return open.promise;
  let resolveResult;
  const promise = new Promise(resolve => { resolveResult = resolve; });
  let succeeded = false;
  const state = { mode, email: "" };
  const content = h("div", { class: "auth" });
  const sheet = openSheet({
    title: "",
    label: "登录或注册",
    body: content,
    className: "sheet-auth",
    onClose: () => { open = null; resolveResult(succeeded); },
  });
  open = { promise, sheet };

  function render(message = "", tone = "") {
    const config = MODES[state.mode];
    const isRegister = state.mode === "register";
    const isReset = state.mode === "reset_password";
    const usesCode = state.mode !== "login_password";
    const usesPassword = state.mode !== "login_code";
    const error = h("p", { class: "auth-error", role: "alert", hidden: tone !== "error" }, tone === "error" ? message : "");
    const status = h("p", { class: "auth-status", role: "status", hidden: tone !== "info" }, tone === "info" ? message : "");
    const email = h("input", { class: "input", type: "email", name: "email", autocomplete: "email", required: true, placeholder: "name@example.com", value: state.email, inputmode: "email" });
    email.addEventListener("input", () => { state.email = email.value.trim(); });
    const password = usesPassword ? h("input", {
      class: "input", type: "password", name: "password", required: true, minlength: isRegister || isReset ? 8 : null, maxlength: 128,
      autocomplete: isRegister || isReset ? "new-password" : "current-password",
      placeholder: isRegister || isReset ? "至少 8 位" : "输入密码",
    }) : null;
    const reveal = password ? h("button", { type: "button", class: "auth-reveal", "aria-label": "显示密码", onClick: () => {
      const showing = password.type === "text";
      password.type = showing ? "password" : "text";
      reveal.setAttribute("aria-label", showing ? "显示密码" : "隐藏密码");
      reveal.classList.toggle("is-on", !showing);
    } }, icon("eye")) : null;
    const code = usesCode ? h("input", { class: "input", name: "code", inputmode: "numeric", autocomplete: "one-time-code", minlength: 6, maxlength: 6, pattern: "[0-9]{6}", required: true, placeholder: "6 位验证码" }) : null;
    const sendCode = usesCode ? h("button", { type: "button", class: "btn btn-soft auth-code-btn" }, "发送验证码") : null;
    const submit = h("button", { type: "submit", class: "btn btn-primary btn-lg btn-block" }, config.submit);

    const purpose = PURPOSE[state.mode];
    const syncCode = () => {
      if (!sendCode) return;
      const left = Math.ceil(((cooldown[purpose] || 0) - Date.now()) / 1000);
      if (left > 0) {
        sendCode.disabled = true;
        sendCode.textContent = `${left} 秒后重发`;
        setTimeout(syncCode, 1000);
      } else {
        sendCode.disabled = false;
        sendCode.textContent = "发送验证码";
      }
    };
    sendCode?.addEventListener("click", async () => {
      if (!email.reportValidity()) return;
      sendCode.disabled = true;
      sendCode.textContent = "正在发送…";
      error.hidden = true;
      try {
        const payload = await post("/api/auth/code", { email: email.value.trim(), purpose });
        cooldown[purpose] = Date.now() + Math.max(10, Number(payload?.retry_after || 60)) * 1000;
        status.textContent = payload?.message || "验证码已发送；如果收件箱里没有，请看看垃圾邮件。";
        status.hidden = false;
        code?.focus();
      } catch (reason) {
        error.textContent = reason.message || "验证码发送失败，请稍后再试";
        error.hidden = false;
      }
      syncCode();
    });
    syncCode();

    const form = h("form", { class: "auth-form", novalidate: true },
      h("label", { class: "field" }, h("span", { class: "field-label" }, "邮箱"), email),
      usesCode ? h("div", { class: "field" },
        h("span", { class: "field-label" }, "邮箱验证码"),
        h("div", { class: "auth-code-row" }, code, sendCode)) : null,
      password ? h("label", { class: "field" },
        h("span", { class: "field-label" }, isReset ? "新密码" : "密码"),
        h("span", { class: "auth-password" }, password, reveal)) : null,
      error,
      status,
      submit,
      h("p", { class: "auth-note" }, config.note));

    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      submit.disabled = true;
      submit.textContent = config.busy;
      error.hidden = true;
      const body = state.mode === "register" || state.mode === "reset_password"
        ? { email: email.value.trim(), password: password.value, code: code.value.trim() }
        : state.mode === "login_code"
          ? { email: email.value.trim(), code: code.value.trim(), method: "code" }
          : { email: email.value.trim(), password: password.value, method: "password" };
      const endpoint = state.mode === "register" ? "register" : state.mode === "reset_password" ? "password/reset" : "login";
      try {
        const payload = await post(`/api/auth/${endpoint}`, body);
        applyAccount(payload);
        succeeded = true;
        toast(config.done, { type: "ok" });
        sheet.close("done");
      } catch (reason) {
        if (state.mode === "login_password" && String(reason?.message || "").includes("验证邮箱")) {
          state.mode = "reset_password";
          render(reason.message, "info");
          return;
        }
        error.textContent = reason.message || "操作没有成功，请稍后再试";
        error.hidden = false;
        submit.disabled = false;
        submit.textContent = config.submit;
      }
    });

    const switchTo = next => () => { state.email = email.value.trim(); state.mode = next; render(); };
    const methodSwitch = state.mode === "login_password" || state.mode === "login_code"
      ? h("div", { class: "seg auth-seg", role: "tablist", "aria-label": "登录方式" },
        h("button", { type: "button", role: "tab", "aria-selected": String(state.mode === "login_password"), onClick: switchTo("login_password") }, "密码登录"),
        h("button", { type: "button", role: "tab", "aria-selected": String(state.mode === "login_code"), onClick: switchTo("login_code") }, "验证码登录"))
      : null;

    const foot = state.mode === "register"
      ? h("p", { class: "auth-foot" }, "已经有账号？", h("button", { type: "button", class: "link-btn", onClick: switchTo("login_password") }, "直接登录"))
      : state.mode === "reset_password"
        ? h("p", { class: "auth-foot" }, "想起密码了？", h("button", { type: "button", class: "link-btn", onClick: switchTo("login_password") }, "返回密码登录"))
        : h("p", { class: "auth-foot" },
          h("button", { type: "button", class: "link-btn", onClick: switchTo("register") }, "注册新账号"),
          h("span", { class: "auth-foot-sep", "aria-hidden": "true" }, "·"),
          h("button", { type: "button", class: "link-btn", onClick: switchTo("reset_password") }, "忘记或重设密码"));

    content.replaceChildren(
      h("div", { class: "auth-hero" },
        h("div", { class: "auth-seal", "aria-hidden": "true" }, "玄"),
        h("h2", { class: "auth-title" }, config.title),
        h("p", { class: "auth-sub" }, reason || (isRegister
          ? "验证邮箱后创建账户，注册即赠送积分。"
          : isReset ? "验证邮箱后设置一个新密码。" : "登录后可以保存命盘、参与讨论、接收回复。"))),
      methodSwitch,
      form,
      foot);
    requestAnimationFrame(() => (state.email ? (code || password) : email)?.focus({ preventScroll: true }));
  }

  render();
  return promise;
}
