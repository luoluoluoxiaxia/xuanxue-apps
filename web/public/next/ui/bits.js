// 通用小组件：状态页（空 / 错误 / 未登录）、骨架屏。
import { h } from "../lib/dom.js?v=n15";
import { icon } from "../lib/icons.js?v=n15";

export function stateView({ tone = "empty", glyph = "compass", title, text = "", actions = [] } = {}) {
  return h("div", { class: ["state", tone === "error" && "state-error"], role: tone === "error" ? "alert" : null },
    h("div", { class: "state-mark" }, icon(tone === "error" ? "alert" : glyph)),
    title ? h("h3", null, title) : null,
    text ? h("p", null, text) : null,
    actions.length ? h("div", { class: "state-actions" }, actions) : null);
}

export function errorView(error, retry, { title = "没能加载出来" } = {}) {
  const text = error && error.message ? error.message : "网络或服务暂时不可用";
  return stateView({
    tone: "error",
    title,
    text,
    actions: retry ? [h("button", { type: "button", class: "btn btn-soft", onClick: retry }, icon("refresh"), "重试")] : [],
  });
}

export function skeletonCard() {
  return h("div", { class: "post-card is-skeleton", "aria-hidden": "true" },
    h("div", { class: "post-card-head" }, h("span", { class: "skel skel-line", style: { width: "120px" } })),
    h("span", { class: "skel skel-title" }),
    h("span", { class: "skel skel-line", style: { width: "92%", marginTop: "10px" } }),
    h("span", { class: "skel skel-line", style: { width: "64%", marginTop: "8px" } }),
    h("div", { class: "post-card-foot" }, h("span", { class: "skel skel-line", style: { width: "180px" } })));
}

export function spinnerLine(text = "加载中…") {
  return h("div", { class: "spinner-line", role: "status" }, h("span", { class: "spinner", "aria-hidden": "true" }), h("span", null, text));
}
