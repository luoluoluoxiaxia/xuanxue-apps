// 轻提示：底部居中，手机端避开底栏；错误提示可以带一个操作按钮。
import { h } from "../lib/dom.js?v=n1";
import { icon } from "../lib/icons.js?v=n1";

let host = null;

function ensureHost() {
  if (!host || !document.body.contains(host)) {
    host = h("div", { class: "toasts", role: "status", "aria-live": "polite" });
    document.body.append(host);
  }
  return host;
}

export function toast(message, { type = "info", action = null, duration = 2800 } = {}) {
  const glyph = type === "ok" ? "check" : type === "error" ? "alert" : "info";
  const node = h("div", { class: ["toast", `toast-${type}`] },
    icon(glyph),
    h("span", null, message),
    action ? h("button", { type: "button", onClick: () => { action.onClick(); dismiss(); } }, action.label) : null);
  ensureHost().append(node);
  let timer = setTimeout(dismiss, action ? duration + 2400 : duration);
  function dismiss() {
    clearTimeout(timer);
    node.classList.add("is-leaving");
    setTimeout(() => node.remove(), 200);
  }
  node.addEventListener("mouseenter", () => clearTimeout(timer));
  node.addEventListener("mouseleave", () => { timer = setTimeout(dismiss, 1600); });
  return dismiss;
}

export function toastError(error, fallback = "操作没有成功，请稍后再试") {
  const message = error && error.message ? error.message : fallback;
  return toast(message, { type: "error" });
}
