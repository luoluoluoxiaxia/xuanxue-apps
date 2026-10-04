// 今日（观象台）：按默认八字命盘准备的今日宜忌，以及本月宜忌、穿搭配色与手镯材质。
// 内容与生成状态全部来自 /api/personal-home；准备中时每 1.8 秒静默刷新，离开页面或出错即停止。
// 再次进入时先用几分钟内的上次内容秒开，再静默更新；已在顶部时再点一次「今日」会重新拉取。
import { h } from "../lib/dom.js?v=n9";
import { icon } from "../lib/icons.js?v=n9";
import { get, post, put } from "../lib/api.js?v=n9";
import { session, refreshSession } from "../lib/store.js?v=n9";
import { greeting } from "../lib/format.js?v=n9";
import { stateView } from "../ui/bits.js?v=n9";
import { openSheet } from "../ui/overlay.js?v=n9";
import { toast } from "../ui/toast.js?v=n9";

const POLL_MS = 1800;
const PENDING = ["missing", "pending", "running"];
const REASON_FALLBACK = "依据本月月令变化，并与整月穿搭主调相互呼应。";
const CITY_MAX = 80;
const CACHE_TTL = 3 * 60 * 1000;

// 上次的观象台内容（只在内存里，按账户区分）；默认命盘变化或切换账户时作废。
let cache = null;
if (typeof document !== "undefined") {
  document.addEventListener("xz:authchange", () => { cache = null; });
  document.addEventListener("xz:personal-home-changed", () => { cache = null; });
}

// 按钮进入「处理中」：不用 disabled（焦点会丢到页面顶端），用 aria-busy 并忽略重复点击。
function setBusy(button, text) {
  if (button.getAttribute("aria-busy") === "true") return false;
  button.setAttribute("aria-busy", "true");
  button.classList.add("is-busy");
  button.replaceChildren(h("span", { class: "spinner", "aria-hidden": "true" }), text);
  return true;
}

function setIdle(button, ...content) {
  button.removeAttribute("aria-busy");
  button.classList.remove("is-busy");
  button.replaceChildren(...content);
}

let uidSeed = 0;
const uid = prefix => `${prefix}-${(uidSeed += 1).toString(36)}`;

/* ---------- 状态判断 ---------- */
function dayState(daily) {
  const status = daily?.status;
  if (PENDING.includes(status)) return "pending";
  const content = daily?.content || {};
  if (status === "done" && Array.isArray(content.suitable) && Array.isArray(content.avoid)) return "ready";
  if (status === "failed" || status === "done") return "failed";
  return "empty";
}

function monthState(month) {
  const status = month?.status;
  if (PENDING.includes(status)) return "pending";
  const content = month?.content || {};
  const outfit = content.outfit || {};
  if (status === "done"
    && Array.isArray(content.suitable)
    && Array.isArray(content.avoid)
    && Array.isArray(outfit.colors)
    && Array.isArray(outfit.bracelet_materials)) return "ready";
  if (status === "failed" || status === "done") return "failed";
  return "empty";
}

// 需要整页提示（而不是今日 / 本月两块内容）时返回提示类型。
function gateOf(payload) {
  const profileState = payload?.profile_state;
  if (profileState === "no_profile") return "no_profile";
  if (profileState === "choose_default") return "choose_default";
  if (profileState !== "ready") return "preparing";
  const generation = payload?.generation?.state || "";
  if (generation === "paused") return "paused";
  if (generation === "failed") return "failed";
  if (generation === "needs_default") return "preparing";
  const day = dayState(payload.daily);
  const month = monthState(payload.month);
  if (day === "failed" && month === "failed") return "failed";
  if (day === "empty" && month === "empty") return "preparing";
  return "";
}

function anyPending(payload) {
  return dayState(payload?.daily) === "pending" || monthState(payload?.month) === "pending";
}

function pillarsText(profile) {
  const pillars = profile?.pillars || {};
  return ["year", "month", "day", "hour"].map(key => pillars[key]).filter(Boolean).join(" · ") || "四柱命盘";
}

function safeHex(value) {
  const text = String(value || "").trim();
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(text) ? text : "var(--line-strong)";
}

const dateFormat = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", weekday: "short" });

function todayText(today) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(today || "")) ? new Date(`${today}T12:00:00+08:00`) : new Date();
  const parts = {};
  dateFormat.formatToParts(Number.isNaN(date.getTime()) ? new Date() : date).forEach(part => { parts[part.type] = part.value; });
  return `${parts.month}月${parts.day}日 · ${parts.weekday}`;
}

/* ---------- 组件 ---------- */
function actionRail() {
  const item = (tone, href, small, label, text) => h("a", { class: ["td-rail-item", `is-${tone}`], href },
    h("span", { class: "td-rail-copy" }, h("small", null, small), h("b", null, label), h("span", null, text)),
    h("span", { class: "td-rail-go", "aria-hidden": "true" }, icon("arrowRight")));
  return h("section", { class: "td-rail-wrap", "aria-labelledby": "td-rail-title" },
    h("h2", { class: "td-section-title", id: "td-rail-title" }, "想细问一件事？"),
    h("nav", { class: "td-rail", "aria-label": "开始问事" },
      item("liuyao", "#/ask/liuyao", "问眼前", "六爻起卦", "一件具体的事，看走向与时机"),
      item("bazi", "#/ask/bazi", "看长期", "八字排盘", "性格、事业与大运流年")));
}

function heroNode(payload, { onCity }) {
  const user = session.get().user || {};
  const nickname = String(user.nickname || "").trim();
  const daily = payload?.daily || {};
  const dateText = daily.date_label
    ? [daily.date_label, daily.weekday_label].filter(Boolean).join(" · ")
    : todayText(payload?.today);
  const city = String(payload?.current_city || "").trim();
  const profile = payload?.default_profile || null;
  return h("section", { class: "td-hero" },
    h("div", { class: "td-hero-copy" },
      h("p", { class: "kicker" }, "观象台"),
      h("h1", { class: "td-greet" }, nickname ? `${greeting()}，${nickname}` : greeting()),
      h("p", { class: "td-date" }, icon("calendar", "icon-sm"), h("span", null, dateText))),
    h("div", { class: "td-hero-chips" },
      h("button", {
        type: "button",
        class: ["td-chip", !city && "is-empty"],
        onClick: onCity,
        "aria-label": city ? `常住城市：${city}，点击修改` : "设置常住城市",
      }, icon("pin", "icon-sm"), h("span", null, city || "设置常住城市"), icon("edit", "icon-sm td-chip-edit")),
      profile ? h("a", { class: "td-chip", href: "#/me/archives", title: `默认命盘：${pillarsText(profile)}` },
        icon("book", "icon-sm"), h("span", null, `依据「${profile.name || "未命名命盘"}」`)) : null));
}

function chipList(items, tone) {
  const list = (items || []).map(item => String(item || "").trim()).filter(Boolean);
  if (!list.length) return h("p", { class: "td-none" }, "暂无");
  return h("ul", { class: ["td-chips", `is-${tone}`] }, list.map(text => h("li", null, text)));
}

function dayCard(tone, title, items) {
  return h("article", { class: ["td-card", `is-${tone}`] },
    h("header", { class: "td-card-head" }, h("h2", null, title)),
    chipList(items, tone));
}

// 「正在准备」由卡片上方的状态行说一次，卡片里只留骨架。
function pendingCard(tone, title) {
  return h("article", { class: ["td-card", `is-${tone}`, "is-pending"], "aria-hidden": "true" },
    h("header", { class: "td-card-head" }, h("h2", null, title)),
    h("div", { class: "td-skel-chips" },
      [68, 52, 84, 60].map(width => h("span", { class: "skel", style: { width: `${width}%` } }))));
}

function issueCard({ tone = "error", title, text, button, busyText, onRetry }) {
  const retry = h("button", { type: "button", class: "btn btn-soft btn-sm" }, icon("refresh"), button);
  retry.addEventListener("click", () => onRetry(retry, busyText, button));
  return h("div", { class: ["td-issue", `is-${tone}`], role: tone === "error" ? "alert" : null },
    h("div", { class: "td-issue-copy" }, h("b", null, title), text ? h("p", null, text) : null),
    retry);
}

function dayBlock(payload, actions) {
  const daily = payload?.daily || {};
  const state = dayState(daily);
  if (state === "ready") {
    return h("section", { class: "td-duo", "aria-label": "今日宜忌" },
      dayCard("good", "今日宜", daily.content.suitable),
      dayCard("bad", "今日忌", daily.content.avoid));
  }
  if (state === "pending") {
    return h("section", { class: "td-duo-wrap", "aria-label": "今日宜忌", "aria-busy": "true" },
      h("p", { class: "td-pending-note", role: "status" }, h("span", { class: "spinner", "aria-hidden": "true" }), daily.message || "正在准备今日宜忌"),
      h("div", { class: "td-duo" }, pendingCard("good", "今日宜"), pendingCard("bad", "今日忌")));
  }
  const failed = state === "failed";
  return h("section", { class: "td-duo-wrap", "aria-label": "今日宜忌" },
    issueCard({
      tone: failed ? "error" : "quiet",
      title: failed ? "今日宜忌生成失败" : "今日宜忌暂未生成",
      text: daily.message || "不消耗 AI 回答积分。",
      button: failed ? "重新生成今日" : "生成今日宜忌",
      busyText: "正在重新生成",
      onRetry: (buttonNode, busy, label) => actions.regenerate("day", buttonNode, busy, label),
    }));
}

function outfitSection(outfit, view) {
  const colors = (outfit.colors || []).filter(color => color && (color.name || color.hex));
  const panelId = uid("td-reason");
  const panel = h("div", { class: "td-reason", id: panelId, "aria-live": "polite" });
  if (view.color >= colors.length) view.color = colors.length ? 0 : -1;
  const buttons = colors.map((color, index) => h("button", {
    type: "button",
    class: "td-swatch",
    "aria-expanded": String(index === view.color),
    "aria-controls": panelId,
    "aria-label": `${color.name || "配色"}，查看选择依据`,
    style: { "--swatch": safeHex(color.hex) },
    onClick: () => select(index === view.color ? -1 : index),
  }, h("i", { class: "td-swatch-dot", "aria-hidden": "true" }), h("span", null, color.name || "配色")));
  function select(index) {
    view.color = index;
    buttons.forEach((button, i) => button.setAttribute("aria-expanded", String(i === index)));
    paintReason();
  }
  function paintReason() {
    const color = colors[view.color];
    panel.hidden = !color;
    if (!color) return;
    panel.style.setProperty("--swatch", safeHex(color.hex));
    panel.replaceChildren(
      h("b", null, `为什么是${color.name || "这个颜色"}`),
      h("p", null, String(color.reason || "").trim() || REASON_FALLBACK));
  }
  paintReason();
  return h("section", { class: "td-extra td-outfit", "aria-labelledby": `${panelId}-title` },
    h("h3", { class: "td-sub-title", id: `${panelId}-title` }, "本月穿搭"),
    h("p", { class: "td-intent" }, outfit.intent_label || "本月配色"),
    outfit.intent_reason ? h("p", { class: "td-intent-reason" }, outfit.intent_reason) : null,
    colors.length
      ? h("div", { class: "td-swatches", role: "group", "aria-label": "本月配色，点选查看选择依据" }, buttons)
      : h("p", { class: "td-none" }, "本月暂无配色建议"),
    panel);
}

function braceletSection(outfit) {
  const materials = (outfit.bracelet_materials || []).map(item => String(item || "").trim()).filter(Boolean);
  const reasons = outfit.bracelet_reasons && typeof outfit.bracelet_reasons === "object" ? outfit.bracelet_reasons : {};
  const titleId = uid("td-bracelet");
  return h("section", { class: "td-extra td-bracelet", "aria-labelledby": titleId },
    h("h3", { class: "td-sub-title", id: titleId }, "手镯材质"),
    materials.length
      ? h("ul", { class: "td-materials" }, materials.map(material => h("li", null,
        h("b", null, material),
        h("p", null, String(reasons[material] || "").trim() || REASON_FALLBACK))))
      : h("p", { class: "td-none" }, "本月暂无材质建议"));
}

function monthBlock(payload, actions, view) {
  const month = payload?.month || {};
  const state = monthState(month);
  const solar = month.display && typeof month.display === "object" ? month.display.solar_terms_text : "";
  const period = [month.period_label, solar].map(text => String(text || "").trim()).filter(Boolean).join(" · ");
  const head = h("header", { class: "td-month-head" },
    h("div", null,
      month.month_label ? h("p", { class: "kicker" }, month.month_label) : null,
      h("h2", { class: "td-month-title" }, "本月提示"),
      period ? h("p", { class: "td-month-period" }, icon("calendar", "icon-sm"), h("span", null, period)) : null));
  if (state === "ready") {
    const content = month.content;
    return h("section", { class: "td-month", "aria-label": "本月提示" },
      head,
      h("div", { class: "td-month-lists" },
        h("div", { class: "td-list is-good" }, h("h3", null, "宜"), chipList(content.suitable, "good")),
        h("div", { class: "td-list is-bad" }, h("h3", null, "忌"), chipList(content.avoid, "bad"))),
      h("div", { class: "td-month-extras" },
        outfitSection(content.outfit, view),
        braceletSection(content.outfit)));
  }
  if (state === "pending") {
    return h("section", { class: "td-month is-pending", "aria-label": "本月提示", "aria-busy": "true" },
      head,
      h("p", { class: "td-pending-note", role: "status" }, h("span", { class: "spinner", "aria-hidden": "true" }), month.message || "正在准备本月内容"),
      h("div", { class: "td-month-lists", "aria-hidden": "true" },
        [0, 1].map(() => h("div", { class: "td-list is-skeleton" },
          h("span", { class: "skel skel-line", style: { width: "30%" } }),
          h("div", { class: "td-skel-chips" }, [72, 56, 80].map(width => h("span", { class: "skel", style: { width: `${width}%` } })))))));
  }
  const failed = state === "failed";
  return h("section", { class: "td-month", "aria-label": "本月提示" },
    head,
    issueCard({
      tone: failed ? "error" : "quiet",
      title: failed ? "本月内容生成失败" : "本月内容暂未生成",
      text: month.message || "不消耗 AI 回答积分。",
      button: failed ? "重新生成本月" : "生成本月内容",
      busyText: "正在重新生成",
      onRetry: (buttonNode, busy, label) => actions.regenerate("month", buttonNode, busy, label),
    }));
}

function gateNode(kind, payload, actions) {
  const generation = payload?.generation || {};
  const shell = ({ tone = "", title, text, body = null }) => h("section", { class: ["td-gate", tone && `is-${tone}`] },
    h("h2", { class: "td-gate-title" }, tone === "preparing" ? h("span", { class: "spinner", "aria-hidden": "true" }) : null, title),
    text ? h("p", { class: "td-gate-text" }, text) : null,
    body);
  if (kind === "no_profile") {
    return shell({
      title: "先建立一张本人命盘",
      text: "设为默认命盘后显示今日、本月、颜色与手镯提示。",
      body: h("div", { class: "td-gate-actions" },
        h("a", { class: "btn btn-primary btn-lg", href: "#/ask/bazi?set_default=1" }, icon("pillars"), "去排八字"),
        h("p", { class: "td-gate-note" }, "排盘不调用 AI，不扣积分。")),
    });
  }
  if (kind === "choose_default") {
    const currentId = Number(payload?.default_profile?.id || 0);
    const profiles = Array.isArray(payload?.profiles) ? payload.profiles : [];
    return shell({
      title: "选择一张默认命盘",
      text: "仅影响观象台，其他档案保留。设置后开始准备内容。",
      body: profiles.length
        ? h("div", { class: "td-choices", role: "list" }, profiles.map(profile => {
          const active = Number(profile.id) === currentId;
          const button = h("button", {
            type: "button",
            class: ["td-choice", active && "is-active"],
            disabled: active,
            "aria-current": active ? "true" : null,
          },
          h("span", { class: "td-choice-copy" }, h("b", null, profile.name || "未命名命盘"), h("em", null, pillarsText(profile))),
          h("span", { class: "td-choice-action" }, active ? "默认命盘" : "设为默认"));
          button.addEventListener("click", () => actions.setDefault(profile.id, button));
          return h("div", { role: "listitem" }, button);
        }))
        : h("div", { class: "td-gate-actions" }, h("a", { class: "btn btn-primary", href: "#/me/archives" }, icon("book"), "去我的盘选择")),
    });
  }
  if (kind === "paused" || kind === "failed") {
    const paused = kind === "paused";
    const button = h("button", { type: "button", class: "btn btn-primary btn-lg" }, icon("refresh"), paused ? "更新今日与本月" : "重新生成");
    button.addEventListener("click", () => actions.refresh(button, paused ? "更新今日与本月" : "重新生成"));
    return shell({
      tone: paused ? "" : "error",
      title: paused ? "今日与本月尚未更新" : "本次生成失败",
      text: generation.message || "",
      body: h("div", { class: "td-gate-actions" },
        button,
        paused ? h("p", { class: "td-gate-note" }, "不消耗 AI 回答积分。") : null),
    });
  }
  const refresh = h("button", { type: "button", class: "btn btn-ghost btn-sm" }, icon("refresh"), "刷新看看");
  refresh.addEventListener("click", () => actions.reload());
  return shell({
    tone: "preparing",
    title: "正在准备今日与本月",
    text: generation.message || "",
    body: h("div", { class: "td-gate-actions" }, h("p", { class: "td-gate-note" }, "完成后自动保存。"), refresh),
  });
}

function skeletonView() {
  return h("div", { class: "td-skeleton" },
    h("p", { class: "sr-only", role: "status" }, "加载观象台…"),
    h("section", { class: "td-hero is-skeleton", "aria-hidden": "true" },
      h("div", { class: "td-hero-copy" },
        h("span", { class: "skel skel-line", style: { width: "64px" } }),
        h("span", { class: "skel skel-title", style: { width: "220px", height: "30px", marginTop: "12px" } }),
        h("span", { class: "skel skel-line", style: { width: "160px", marginTop: "12px" } }))),
    h("div", { class: "td-duo", "aria-hidden": "true" }, pendingCard("good", "今日宜"), pendingCard("bad", "今日忌")),
    h("section", { class: "td-month is-skeleton", "aria-hidden": "true" },
      h("span", { class: "skel skel-line", style: { width: "90px" } }),
      h("span", { class: "skel skel-title", style: { width: "160px", marginTop: "12px" } }),
      h("span", { class: "skel", style: { height: "120px", marginTop: "18px", borderRadius: "14px" } })));
}

function anonView(ctx) {
  const reason = "登录后，每天为你准备今日宜忌与本月提示。";
  const features = [
    ["今日宜忌", "今天适合做什么、少碰什么"],
    ["本月提示", "按节气划分的本月宜与忌"],
    ["穿搭配色", "本月适合的颜色，以及为什么是它"],
    ["手镯材质", "适合本月佩戴的材质与缘由"],
  ];
  return h("div", { class: "td-anon" },
    h("section", { class: "td-anon-hero" },
      h("p", { class: "kicker" }, "观象台"),
      h("h1", { class: "td-anon-title" }, "每天一份属于你的宜忌"),
      h("p", { class: "td-anon-text" }, "登录后排一张本人八字（排盘免费），之后每天自动更新。"),
      h("div", { class: "td-anon-actions" },
        h("button", { type: "button", class: "btn btn-primary btn-lg", onClick: () => ctx.openAuth({ reason }) }, icon("user"), "登录 / 注册"),
        h("a", { class: "btn btn-ghost btn-lg", href: "#/square" }, "先逛逛广场"))),
    h("ul", { class: "td-features", "aria-label": "观象台会为你准备" }, features.map(([title, text]) => h("li", { class: "td-feature" },
      h("b", null, title),
      h("span", null, text)))),
    actionRail());
}

function openCitySheet(current, save) {
  const id = uid("td-city");
  const input = h("input", {
    class: "input",
    id,
    name: "city",
    maxlength: CITY_MAX,
    required: true,
    autocomplete: "address-level2",
    enterkeyhint: "done",
    placeholder: "例如：杭州",
    value: current || "",
    autofocus: true,
    "aria-describedby": `${id}-error`,
  });
  const error = h("p", { class: "field-error", id: `${id}-error`, role: "alert", hidden: true });
  const form = h("form", { class: "td-city-form", id: `${id}-form`, novalidate: true },
    h("p", { class: "td-city-lead" }, "用于本月穿搭与手镯的城市方位辅助。"),
    h("div", { class: "field" },
      h("label", { class: "field-label", for: id }, "现在生活在哪座城市"),
      input,
      error));
  const cancel = h("button", { type: "button", class: "btn btn-ghost" }, "取消");
  const submit = h("button", { type: "submit", class: "btn btn-primary", form: `${id}-form` }, "保存");
  const sheet = openSheet({ title: "常住城市", body: form, footer: [cancel, submit], className: "sheet-city" });
  // 打开时选中原有城市：直接输入即可替换。
  requestAnimationFrame(() => { if (document.activeElement === input) input.select(); });
  cancel.addEventListener("click", () => sheet.close("cancel"));
  input.addEventListener("input", () => { error.hidden = true; error.textContent = ""; input.removeAttribute("aria-invalid"); });
  const invalid = text => {
    error.textContent = text;
    error.hidden = false;
    input.setAttribute("aria-invalid", "true");
    input.focus();
  };
  let saving = false;
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (saving) return;
    const city = input.value.trim();
    if (!city) {
      invalid("请填写常住城市");
      return;
    }
    if (Array.from(city).length > CITY_MAX) {
      invalid(`城市名称最多 ${CITY_MAX} 个字`);
      return;
    }
    // 没有改动：直接收起，不再请求。
    if (city === String(current || "").trim()) {
      sheet.close("same");
      return;
    }
    saving = true;
    setBusy(submit, "正在保存");
    cancel.disabled = true;
    try {
      await save(city);
      sheet.close("done");
      toast("常住城市已更新", { type: "ok" });
    } catch (reason) {
      setIdle(submit, "保存");
      cancel.disabled = false;
      invalid(reason?.message || "城市没有保存成功，请稍后再试");
    } finally {
      saving = false;
    }
  });
  return sheet;
}

/* ---------- 页面 ---------- */
export function render(ctx) {
  const root = h("div", { class: "td-page" });
  const view = { color: 0 };
  let payload = null;
  let requestId = 0;
  let timer = 0;
  let lastAuth = null;
  let stalled = null;
  let failed = false;
  let choosing = false;

  const heroSlot = h("div", { class: "td-slot" });
  const noticeSlot = h("div", { class: "td-slot" });
  const gateSlot = h("div", { class: "td-slot" });
  const daySlot = h("div", { class: "td-slot" });
  const monthSlot = h("div", { class: "td-slot" });
  const railSlot = h("div", { class: "td-slot" }, actionRail());
  const foot = h("p", { class: "td-foot" }, icon("info", "icon-sm"), "内容按默认命盘自动准备，仅供传统文化参考。");

  const signatures = new Map();
  function setSlot(slot, signature, build) {
    if (signatures.get(slot) === signature) return;
    signatures.set(slot, signature);
    const content = build();
    slot.replaceChildren(...(Array.isArray(content) ? content : [content]).filter(Boolean));
  }

  function mountContent() {
    if (heroSlot.isConnected) return;
    root.replaceChildren(heroSlot, noticeSlot, gateSlot, daySlot, monthSlot, railSlot, foot);
  }

  function remember() {
    const user = session.get().user?.id;
    if (user && payload) cache = { user, payload, at: Date.now() };
  }

  // 内容重绘后焦点丢了（按钮被替换或隐藏）：交给同一区域里新的按钮，没有按钮就交给这一块本身。
  function repairFocus(preferred) {
    const active = document.activeElement;
    if (active && root.contains(active) && active.getClientRects().length) return;
    const slot = [preferred, gateSlot, daySlot].find(node => node && !node.hidden && node.firstElementChild);
    if (!slot) return;
    const target = slot.querySelector("button:not([disabled]), a[href]") || slot.firstElementChild;
    if (!target.matches("button, a")) target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
  }

  function paint() {
    if (!payload || !ctx.isCurrent()) return;
    const focusSlot = [noticeSlot, gateSlot, daySlot, monthSlot].find(slot => slot.contains(document.activeElement)) || null;
    mountContent();
    const nickname = String(session.get().user?.nickname || "");
    const daily = payload.daily || {};
    setSlot(heroSlot, JSON.stringify([nickname, payload.today, daily.date_label, daily.weekday_label, payload.current_city, payload.default_profile?.id, payload.default_profile?.name]),
      () => heroNode(payload, { onCity: () => actions.openCity() }));
    const gate = gateOf(payload);
    gateSlot.hidden = !gate;
    daySlot.hidden = !!gate;
    monthSlot.hidden = !!gate;
    foot.hidden = !!gate;
    if (gate) {
      setSlot(gateSlot, JSON.stringify([gate, payload.generation, gate === "choose_default" ? [payload.profiles, payload.default_profile?.id] : null]),
        () => gateNode(gate, payload, actions));
      signatures.delete(daySlot);
      signatures.delete(monthSlot);
    } else {
      signatures.delete(gateSlot);
      setSlot(daySlot, JSON.stringify(payload.daily || {}), () => dayBlock(payload, actions));
      setSlot(monthSlot, JSON.stringify(payload.month || {}), () => monthBlock(payload, actions, view));
    }
    paintNotice();
    schedule();
    if (focusSlot) repairFocus(focusSlot);
  }

  function paintNotice() {
    const hadFocus = noticeSlot.contains(document.activeElement);
    if (!stalled) {
      noticeSlot.replaceChildren();
      if (hadFocus) repairFocus(daySlot);
      return;
    }
    const retry = h("button", { type: "button", class: "btn btn-soft btn-sm" }, icon("refresh"), "重试");
    retry.addEventListener("click", () => actions.reload({ button: retry }));
    noticeSlot.replaceChildren(h("div", { class: "td-notice", role: "alert" },
      icon("alert", "icon-sm"),
      h("span", null, `内容暂时没有更新：${stalled.message || "网络连接不稳定"}`),
      retry));
    if (hadFocus) retry.focus({ preventScroll: true });
  }

  function showError(error) {
    failed = true;
    const retry = h("button", { type: "button", class: "btn btn-soft" }, icon("refresh"), "重新加载");
    retry.addEventListener("click", () => {
      root.replaceChildren(skeletonView());
      load();
    });
    root.replaceChildren(
      h("div", { class: "td-error-card" }, stateView({
        tone: "error",
        title: "观象台加载失败",
        text: error?.message || "网络连接不稳定，请稍后重试。",
        actions: [retry],
      })),
      actionRail());
  }

  function schedule() {
    clearTimeout(timer);
    if (!payload || stalled || !ctx.isCurrent() || !session.get().authenticated) return;
    const gate = gateOf(payload);
    if (gate && gate !== "preparing") return;
    if (!anyPending(payload)) return;
    timer = setTimeout(tick, POLL_MS);
  }

  function tick() {
    if (!ctx.isCurrent()) return;
    if (document.hidden) {
      timer = setTimeout(tick, POLL_MS);
      return;
    }
    load({ quiet: true });
  }

  async function load({ quiet = false, announce = false } = {}) {
    const id = ++requestId;
    clearTimeout(timer);
    const visible = () => [...signatures.values()].join("|");
    const before = announce ? visible() : "";
    if (announce) root.classList.add("is-refreshing");
    try {
      const data = await get("/api/personal-home", { cache: "no-store" });
      if (!ctx.isCurrent() || id !== requestId) return;
      payload = data || {};
      stalled = null;
      failed = false;
      remember();
      paint();
      if (announce) toast(visible() === before ? "已是最新" : "已更新", { type: "ok" });
    } catch (error) {
      if (!ctx.isCurrent() || id !== requestId) return;
      if (error?.status === 401) refreshSession().catch(() => {});
      if (payload && quiet) {
        stalled = error;
        paintNotice();
      } else if (payload) {
        stalled = error;
        paintNotice();
        toast(error?.message || "观象台加载失败", { type: "error" });
      } else {
        showError(error);
      }
    } finally {
      if (id === requestId) root.classList.remove("is-refreshing");
    }
  }

  const failToast = (error, fallback) => {
    if (error?.status === 401) refreshSession().catch(() => {});
    toast(error?.message || fallback, { type: "error" });
  };

  const actions = {
    // 从提示条点「重试」：按钮先转圈，提示条等结果回来再收起。
    reload({ button = null } = {}) {
      if (button && !setBusy(button, "正在重试")) return;
      if (!button) {
        stalled = null;
        paintNotice();
      }
      load();
    },
    openCity() {
      openCitySheet(payload?.current_city || "", async city => {
        const data = await put("/api/personal-home/city", { city });
        if (!ctx.isCurrent()) return;
        payload = data || payload;
        remember();
        paint();
        // 城市标签被重绘：焦点交给新的标签，而不是丢在页面顶端。
        requestAnimationFrame(() => heroSlot.querySelector(".td-chip")?.focus({ preventScroll: true }));
      });
    },
    async setDefault(profileId, button) {
      if (choosing) return;
      choosing = true;
      const buttons = Array.from(root.querySelectorAll(".td-choice"));
      buttons.forEach(node => node.setAttribute("aria-disabled", "true"));
      button.setAttribute("aria-busy", "true");
      const label = button.querySelector(".td-choice-action");
      if (label) label.textContent = "设置中…";
      try {
        const data = await put("/api/personal-home/default-profile", { profile_id: Number(profileId) });
        if (!ctx.isCurrent()) return;
        payload = data || payload;
        remember();
        signatures.delete(gateSlot);
        paint();
        toast("已设为默认命盘，正在准备内容", { type: "ok" });
      } catch (error) {
        if (!ctx.isCurrent()) return;
        signatures.delete(gateSlot);
        paint();
        failToast(error, "默认命盘设置失败");
      } finally {
        choosing = false;
      }
    },
    async refresh(button, label) {
      if (!setBusy(button, "正在开始准备")) return;
      try {
        const data = await post("/api/personal-home/refresh");
        if (!ctx.isCurrent()) return;
        payload = data || payload;
        remember();
        signatures.delete(gateSlot);
        paint();
        toast("准备中；完成后自动保存。", { type: "ok" });
      } catch (error) {
        if (!ctx.isCurrent()) return;
        setIdle(button, icon("refresh"), label);
        failToast(error, "未开始准备");
      }
    },
    async regenerate(kind, button, busyText, label) {
      if (!setBusy(button, busyText)) return;
      try {
        const data = await post(kind === "day" ? "/api/personal-home/day" : "/api/personal-home/month");
        if (!ctx.isCurrent()) return;
        payload = { ...payload, [kind === "day" ? "daily" : "month"]: data || {} };
        stalled = null;
        remember();
        paint();
        toast(kind === "day" ? "今日宜忌重新生成中" : "本月内容重新生成中", { type: "ok" });
      } catch (error) {
        if (!ctx.isCurrent()) return;
        setIdle(button, icon("refresh"), label);
        failToast(error, kind === "day" ? "今日宜忌生成失败" : "本月内容准备失败");
      }
    },
  };

  function sync() {
    const current = session.get();
    if (!current.ready) {
      if (!root.childElementCount) root.replaceChildren(skeletonView());
      return;
    }
    if (current.authenticated !== lastAuth) {
      lastAuth = current.authenticated;
      clearTimeout(timer);
      requestId += 1;
      payload = null;
      stalled = null;
      signatures.clear();
      if (!current.authenticated) {
        root.replaceChildren(anonView(ctx));
        return;
      }
      const saved = cache;
      if (saved && saved.user === current.user?.id && Date.now() - saved.at < CACHE_TTL) {
        // 几分钟内回来：先显示上次的内容，再静默更新。
        payload = saved.payload;
        paint();
        load({ quiet: true });
        return;
      }
      root.replaceChildren(skeletonView());
      load();
      return;
    }
    // 同一账户下昵称变化等：只刷新问候语。
    if (current.authenticated && payload) paint();
  }

  // 断线恢复：网络恢复或回到页面时，自动重试中断的加载。
  const recover = () => {
    if (!ctx.isCurrent() || !session.get().authenticated || document.hidden) return;
    if (stalled) actions.reload();
    else if (failed && !payload) {
      failed = false;
      root.replaceChildren(skeletonView());
      load();
    }
  };
  window.addEventListener("online", recover);
  document.addEventListener("visibilitychange", recover);
  // 已在顶部时再点一次「今日」：重新拉取（内容先变淡，回来后恢复）。
  ctx.onRefresh(() => {
    if (!session.get().authenticated) return;
    if (payload) load({ announce: true });
    else if (failed) recover();
  });

  sync();
  ctx.subscribe(session, sync);
  ctx.cleanup(() => {
    clearTimeout(timer);
    requestId += 1;
    window.removeEventListener("online", recover);
    document.removeEventListener("visibilitychange", recover);
  });

  return { node: root, title: "今日" };
}
