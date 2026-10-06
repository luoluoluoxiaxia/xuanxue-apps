// 意见反馈面板：类型可选、内容必填（1–4000 字）、联系方式可选。
// 只提交用户写下的文字、当前页面路由，以及（从解读页打开时）档案 / 盘 / 对话 / 任务的编号；不附带出生信息或对话内容。
// 没提交的内容存为本机草稿（退出登录时随其他草稿一起清除），误关面板或刷新页面都不会丢。
import { h, autoGrow, submitOnEnter, coarsePointer } from "../lib/dom.js?v=n14";
import { icon } from "../lib/icons.js?v=n14";
import { post } from "../lib/api.js?v=n14";
import { local } from "../lib/store.js?v=n14";
import { copyText } from "../lib/share.js?v=n14";
import { openSheet } from "../ui/overlay.js?v=n14";
import { toast } from "../ui/toast.js?v=n14";

const TYPES = ["体验建议", "断语不准", "想要功能"];
const MESSAGE_MAX = 4000;
const CONTACT_MAX = 200;
const MAIL = "luoluoluoxiaxia@gmail.com";
const DRAFT_KEY = "xz-next-draft:feedback";

function readDraft() {
  const saved = local.json(DRAFT_KEY, null) || {};
  return {
    rating: TYPES.includes(saved.rating) ? saved.rating : "",
    message: typeof saved.message === "string" ? saved.message.slice(0, MESSAGE_MAX) : "",
    contact: typeof saved.contact === "string" ? saved.contact.slice(0, CONTACT_MAX) : "",
  };
}

function writeDraft(draft) {
  if (draft.message.trim() || draft.contact.trim() || draft.rating) local.setJson(DRAFT_KEY, draft);
  else local.remove(DRAFT_KEY);
}

let current = null;

// context：从解读页打开时带上档案、盘、对话与任务编号，方便定位是哪一次解读（不带出生信息）。
export function openFeedback(context = {}) {
  if (current) {
    current.panel.querySelector("textarea")?.focus({ preventScroll: true });
    return current;
  }
  const formId = `fb-form-${Math.random().toString(36).slice(2, 8)}`;
  const draft = readDraft();
  const save = () => writeDraft(draft);
  let submitting = false;
  let sent = false;

  const typeButtons = TYPES.map(label => h("button", {
    type: "button",
    class: "fb-type",
    "aria-pressed": String(draft.rating === label),
    onClick: event => {
      draft.rating = draft.rating === label ? "" : label;
      typeButtons.forEach(button => button.setAttribute("aria-pressed", String(button.textContent === draft.rating)));
      save();
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
    "aria-describedby": `${formId}-hint ${formId}-count`,
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
    enterkeyhint: "send",
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
    save();
    syncCount();
    if (!error.hidden && message.value.trim()) {
      error.hidden = true;
      message.removeAttribute("aria-invalid");
    }
  });
  contact.addEventListener("input", () => {
    draft.contact = contact.value;
    save();
  });
  autoGrow(message, 320);

  const copyButton = h("button", { type: "button", class: "fb-copy", "aria-label": "复制邮箱地址" }, icon("copy", "icon-sm"), "复制");
  copyButton.addEventListener("click", async () => {
    const ok = await copyText(MAIL);
    toast(ok ? "邮箱地址已复制" : "复制失败，请手动选择邮箱地址", { type: ok ? "ok" : "error" });
  });

  // 长文本输入：回车换行，Ctrl / ⌘ + 回车提交（中文输入法选词时的回车不会触发）。
  const apple = /Mac|iPhone|iPad/i.test(navigator.userAgentData?.platform || navigator.platform || "");
  const hint = coarsePointer() ? "越具体越好，我们会认真看每一条。" : `越具体越好，我们会认真看每一条；${apple ? "⌘" : "Ctrl"} + 回车可直接提交。`;

  const form = h("form", { class: "fb-form", id: formId, novalidate: true },
    h("p", { class: "fb-lead" }, "断得准不准、哪里不顺手、想要什么功能 —— 直说无妨。"),
    h("fieldset", { class: "fb-fieldset" },
      h("legend", { class: "field-label" }, "反馈类型", h("span", { class: "fb-optional" }, "可选")),
      h("div", { class: "fb-types" }, typeButtons)),
    h("div", { class: "field" },
      h("label", { class: "field-label", for: `${formId}-message` }, "反馈内容"),
      message,
      h("div", { class: "fb-meta" }, h("span", { class: "field-hint", id: `${formId}-hint` }, hint), counter)),
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
  const requestSubmit = () => (form.requestSubmit ? form.requestSubmit(submit) : submit.click());
  submitOnEnter(message, requestSubmit, { mode: "compose" });

  const sheet = openSheet({
    title: "意见反馈",
    body: form,
    footer: [cancel, submit],
    className: "sheet-feedback",
    onClose: () => {
      current = null;
      // 没提交就关掉：告诉用户内容还在，下次打开会自动带上。
      if (!sent && draft.message.trim()) toast("反馈草稿已保存，下次打开会自动带上");
    },
  });
  current = sheet;
  cancel.addEventListener("click", () => sheet.close("cancel"));

  const showError = text => {
    error.textContent = text;
    error.hidden = false;
    // 提交按钮在面板底部，错误在正文里：滚到能看见的位置。
    error.scrollIntoView({ block: "nearest", behavior: "auto" });
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
    // 提交中不禁用提交按钮（焦点会丢），用 aria-busy 并忽略重复提交。
    submit.setAttribute("aria-busy", "true");
    submit.classList.add("is-busy");
    cancel.disabled = true;
    submit.replaceChildren(h("span", { class: "spinner", "aria-hidden": "true" }), "提交中…");
    try {
      await post("/api/feedback", {
        rating: draft.rating,
        message: text,
        contact: contactText,
        page: `next:${location.hash.slice(0, 180)}`,
        ...feedbackContext(context),
      }, { interaction: true });
      sent = true;
      local.remove(DRAFT_KEY);
      sheet.close("done");
      toast("反馈已收到，谢谢你！", { type: "ok" });
    } catch (reason) {
      showError(`提交失败：${reason?.message || "请稍后再试"}；内容已保存为草稿。`);
      submit.removeAttribute("aria-busy");
      submit.classList.remove("is-busy");
      cancel.disabled = false;
      submit.replaceChildren(icon("send"), "提交");
    } finally {
      submitting = false;
    }
  });

  return sheet;
}

function feedbackContext({ profileId, chartId, sessionId, taskId } = {}) {
  const out = {};
  const toId = value => (Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null);
  if (toId(profileId)) out.profile_id = toId(profileId);
  if (toId(chartId)) out.chart_id = toId(chartId);
  if (typeof sessionId === "string" && /^s_[a-f0-9]{16}$/.test(sessionId)) out.session_id = sessionId;
  if (typeof taskId === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(taskId)) out.task_id = taskId;
  return out;
}
