// 意见反馈面板：类型可选、内容必填（1–4000 字）、联系方式可选。
// 只提交用户写下的文字与当前页面路由，不附带命盘、出生信息或会话内容。
import { h, autoGrow } from "../lib/dom.js?v=n1";
import { icon } from "../lib/icons.js?v=n1";
import { post } from "../lib/api.js?v=n1";
import { copyText } from "../lib/share.js?v=n1";
import { openSheet } from "../ui/overlay.js?v=n1";
import { toast } from "../ui/toast.js?v=n1";

const TYPES = ["体验建议", "断语不准", "想要功能"];
const MESSAGE_MAX = 4000;
const CONTACT_MAX = 200;
const MAIL = "luoluoluoxiaxia@gmail.com";

// 关闭面板后保留未提交的内容（仅内存），提交成功后清空。
const draft = { rating: "", message: "", contact: "" };
let current = null;

export function openFeedback() {
  if (current) {
    current.panel.querySelector("textarea")?.focus({ preventScroll: true });
    return current;
  }
  const formId = `fb-form-${Math.random().toString(36).slice(2, 8)}`;
  let submitting = false;

  const typeButtons = TYPES.map(label => h("button", {
    type: "button",
    class: "fb-type",
    "aria-pressed": String(draft.rating === label),
    onClick: event => {
      draft.rating = draft.rating === label ? "" : label;
      typeButtons.forEach(button => button.setAttribute("aria-pressed", String(button.textContent === draft.rating)));
      event.currentTarget.focus();
    },
  }, label));

  const message = h("textarea", {
    class: "textarea fb-message",
    id: `${formId}-message`,
    name: "message",
    rows: 5,
    maxlength: MESSAGE_MAX,
    required: true,
    "aria-describedby": `${formId}-count`,
    placeholder: "比如：哪一步不顺手、哪条断语和实际情况不符、希望增加什么功能……",
    autofocus: window.matchMedia?.("(pointer: fine)").matches ? true : null,
  });
  message.value = draft.message;
  const counter = h("span", { class: "fb-count tnum", id: `${formId}-count` }, `${message.value.length} / ${MESSAGE_MAX}`);
  const contact = h("input", {
    class: "input",
    id: `${formId}-contact`,
    name: "contact",
    type: "text",
    maxlength: CONTACT_MAX,
    autocomplete: "off",
    placeholder: "邮箱、微信或手机号",
    value: draft.contact,
  });
  const error = h("p", { class: "fb-error", role: "alert", hidden: true });
  const syncCount = () => {
    counter.textContent = `${message.value.length} / ${MESSAGE_MAX}`;
    counter.classList.toggle("is-over", message.value.length > MESSAGE_MAX);
  };
  message.addEventListener("input", () => {
    draft.message = message.value;
    syncCount();
    if (!error.hidden && message.value.trim()) {
      error.hidden = true;
      message.removeAttribute("aria-invalid");
    }
  });
  contact.addEventListener("input", () => { draft.contact = contact.value; });
  autoGrow(message, 320);

  const copyButton = h("button", { type: "button", class: "fb-copy", "aria-label": "复制邮箱地址" }, icon("copy", "icon-sm"), "复制");
  copyButton.addEventListener("click", async () => {
    const ok = await copyText(MAIL);
    toast(ok ? "邮箱地址已复制" : "复制失败，请手动选择邮箱地址", { type: ok ? "ok" : "error" });
  });

  const form = h("form", { class: "fb-form", id: formId, novalidate: true },
    h("p", { class: "fb-lead" }, "断得准不准、哪里不顺手、想要什么功能 —— 直说无妨。"),
    h("fieldset", { class: "fb-fieldset" },
      h("legend", { class: "field-label" }, "反馈类型", h("span", { class: "fb-optional" }, "可选")),
      h("div", { class: "fb-types" }, typeButtons)),
    h("div", { class: "field" },
      h("label", { class: "field-label", for: `${formId}-message` }, "反馈内容"),
      message,
      h("div", { class: "fb-meta" }, h("span", { class: "field-hint" }, "越具体越好，我们会认真看每一条。"), counter)),
    h("div", { class: "field" },
      h("label", { class: "field-label", for: `${formId}-contact` }, "你的联系方式", h("span", { class: "fb-optional" }, "可选")),
      contact,
      h("span", { class: "field-hint" }, "留下联系方式，方便我们回复你。")),
    error,
    h("p", { class: "fb-mail" },
      icon("message", "icon-sm"),
      h("span", null, "如需直接联系，可发邮件到 ", h("span", { class: "fb-mail-addr" }, MAIL), "。"),
      copyButton));

  const cancel = h("button", { type: "button", class: "btn btn-ghost" }, "取消");
  const submit = h("button", { type: "submit", class: "btn btn-primary", form: formId }, icon("send"), "提交");

  const sheet = openSheet({
    title: "意见反馈",
    body: form,
    footer: [cancel, submit],
    className: "sheet-feedback",
    onClose: () => { current = null; },
  });
  current = sheet;
  cancel.addEventListener("click", () => sheet.close("cancel"));

  const showError = text => {
    error.textContent = text;
    error.hidden = false;
  };

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (submitting) return;
    const text = message.value.trim();
    const contactText = contact.value.trim();
    if (!text) {
      showError("请先填写反馈内容");
      message.setAttribute("aria-invalid", "true");
      message.focus();
      return;
    }
    if (text.length > MESSAGE_MAX) {
      showError(`反馈内容最多 ${MESSAGE_MAX} 个字`);
      message.setAttribute("aria-invalid", "true");
      message.focus();
      return;
    }
    if (contactText.length > CONTACT_MAX) {
      showError(`联系方式最多 ${CONTACT_MAX} 个字`);
      contact.focus();
      return;
    }
    submitting = true;
    error.hidden = true;
    submit.disabled = true;
    cancel.disabled = true;
    submit.replaceChildren(h("span", { class: "spinner", "aria-hidden": "true" }), "提交中…");
    try {
      await post("/api/feedback", {
        rating: draft.rating,
        message: text,
        contact: contactText,
        page: `next:${location.hash.slice(0, 180)}`,
      }, { interaction: true });
      draft.rating = "";
      draft.message = "";
      draft.contact = "";
      sheet.close("done");
      toast("反馈已提交", { type: "ok" });
    } catch (reason) {
      showError(`提交失败：${reason?.message || "请稍后再试"}`);
      submit.disabled = false;
      cancel.disabled = false;
      submit.replaceChildren(icon("send"), "提交");
    } finally {
      submitting = false;
    }
  });

  return sheet;
}
