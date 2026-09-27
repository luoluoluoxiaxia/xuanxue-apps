// 提问：先写下问题，再选方法。六爻是一场「三钱六掷」的小仪式，八字是分步填写出生信息。
import { h, autoGrow, submitOnEnter, reducedMotion } from "../lib/dom.js?v=n1";
import { icon } from "../lib/icons.js?v=n1";
import { get, post, put } from "../lib/api.js?v=n1";
import { session, local, refreshSession } from "../lib/store.js?v=n1";
import { newSessionId, localDateTimeISO } from "../lib/ids.js?v=n1";
import { ASK_EXAMPLES, LY_POS, LY_VALUE_NAME, CN_NUM } from "../lib/copy.js?v=n1";
import { handoff } from "../lib/handoff.js?v=n1";
import { humanizeError } from "../lib/interpret.js?v=n1";
import { stateView } from "../ui/bits.js?v=n1";
import { toast } from "../ui/toast.js?v=n1";
import { confirmDialog } from "../ui/overlay.js?v=n1";
import { locationPicker } from "../ui/location.js?v=n1";

const ASK_DRAFT = "xz-next-draft:ask";
const readDraft = () => local.get(ASK_DRAFT, "");
const writeDraft = text => (text.trim() ? local.set(ASK_DRAFT, text) : local.remove(ASK_DRAFT));

// 摇到一半被打断（刷新、切走、登录）时保留已成的爻：一事一卦，不必重摇。只保留两小时，
// 而且只还给同一个问题——换了问题就是另一卦，不能沿用。
const CAST_DRAFT = "xz-next-draft:cast";
const CAST_TTL = 2 * 60 * 60 * 1000;
function readCast(question) {
  const saved = local.json(CAST_DRAFT, null);
  if (!saved || !Array.isArray(saved.lines) || !(Date.now() - Number(saved.at || 0) < CAST_TTL)) return null;
  if (String(saved.question || "") !== String(question || "").trim()) return null;
  const lines = saved.lines
    .filter(line => [6, 7, 8, 9].includes(Number(line?.value)))
    .slice(0, 6)
    .map(line => ({ value: Number(line.value), coins: (Array.isArray(line.coins) ? line.coins : []).filter(face => face === "背" || face === "字").slice(0, 3) }));
  if (!lines.length) return null;
  return { lines, mode: saved.mode === "manual" ? "manual" : "coins", completedAt: lines.length === 6 ? String(saved.completedAt || "") : "" };
}

// 单选组（role="radiogroup"）：方向键切换选中项，只有选中项留在 Tab 顺序里。
function radioKeys(group) {
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
  group.addEventListener("keydown", event => {
    if (!(event.key in step)) return;
    const radios = Array.from(group.querySelectorAll('[role="radio"]'));
    const index = radios.indexOf(document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    radios[(index + step[event.key] + radios.length) % radios.length].click();
    group.querySelector('[role="radio"][aria-checked="true"]')?.focus();
  });
}

export function render(ctx) {
  const system = ctx.params.system;
  if (system === "liuyao") return liuyaoFlow(ctx);
  if (system === "bazi") return baziFlow(ctx);
  return hub(ctx);
}

function focusHeader(ctx, title, sub) {
  return h("header", { class: "ask-head" },
    h("button", { type: "button", class: "back-link", onClick: () => ctx.back("/") }, icon("back"), "返回"),
    h("div", null, h("h1", null, title), sub ? h("p", null, sub) : null));
}

/* ==========================================================================
   提问入口
   ========================================================================== */
function hub(ctx) {
  const textarea = h("textarea", { class: "ask-input", rows: 3, maxlength: 2000, placeholder: "例如：这个月能顺利签下合作合同吗？", "aria-label": "你想问什么" });
  textarea.value = readDraft();
  textarea.addEventListener("input", () => writeDraft(textarea.value));
  autoGrow(textarea, 240);
  const go = target => () => {
    writeDraft(textarea.value);
    ctx.navigate(target);
  };
  const recent = h("section", { class: "ask-recent", hidden: true });
  const methodTitle = h("h2", { class: "ask-section-title" }, "选一种方式来看");
  const node = h("div", { class: "ask-page" },
    focusHeader(ctx, "你想问什么？", "写下一件放在心上的事。越具体，越好判断。"),
    h("section", { class: "ask-card" },
      textarea,
      h("div", { class: "ask-examples", role: "group", "aria-label": "例子" },
        ASK_EXAMPLES.map(example => h("button", { type: "button", class: "pill-filter", onClick: () => {
          textarea.value = example;
          writeDraft(example);
          textarea.dispatchEvent(new Event("input"));
          textarea.focus();
          textarea.setSelectionRange(example.length, example.length);
        } }, example))),
      h("p", { class: "ask-privacy" }, icon("lock", "icon-sm"), "不要写姓名、电话、住址或证件号。")),
    methodTitle,
    h("div", { class: "method-grid" },
      h("button", { type: "button", class: "method-card is-liuyao", onClick: go("/ask/liuyao") },
        h("span", { class: "method-icon" }, icon("gua")),
        h("span", { class: "method-copy" },
          h("b", null, "六爻问事"),
          h("span", null, "适合一件具体的事：成不成、何时、怎么做。三钱六掷，当下成卦。"),
          h("small", null, "AI 解读 · 或请卦友帮看")),
        icon("chevronRight", "method-go")),
      h("button", { type: "button", class: "method-card is-bazi", onClick: go("/ask/bazi") },
        h("span", { class: "method-icon" }, icon("pillars")),
        h("span", { class: "method-copy" },
          h("b", null, "八字看长期"),
          h("span", null, "用出生时间排一张命盘：性格底色、事业财运、大运流年。"),
          h("small", null, "排盘免费 · 同一张盘可以一直追问")),
        icon("chevronRight", "method-go")),
      h("button", { type: "button", class: "method-card is-help", onClick: go("/ask/liuyao?help=1") },
        h("span", { class: "method-icon" }, icon("hand")),
        h("span", { class: "method-copy" },
          h("b", null, "向卦友求助"),
          h("span", null, "起卦后把脱敏的卦象和问题发到广场，请懂的卦友帮你断。"),
          h("small", null, "不调用 AI · 不扣积分")),
        icon("chevronRight", "method-go"))),
    recent);

  // 回车是「下一步」：写完问题直接去选方式（Shift+回车换行；输入法选词时的回车不算）。
  submitOnEnter(textarea, () => {
    if (!textarea.value.trim()) return;
    node.querySelector(".method-card")?.focus({ preventScroll: true });
    methodTitle.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
  });
  textarea.setAttribute("enterkeyhint", "next");

  const loadRecent = () => {
    if (!session.get().authenticated) { recent.hidden = true; return; }
    get("/api/profiles", { cache: "no-store" }).then(items => {
      if (!ctx.isCurrent()) return;
      const list = (Array.isArray(items) ? items : []).slice().sort((a, b) => Number(b.id) - Number(a.id)).slice(0, 4);
      if (!list.length) { recent.hidden = true; return; }
      recent.hidden = false;
      recent.replaceChildren(
        h("h2", { class: "ask-section-title" }, "接着上次的盘问"),
        h("div", { class: "recent-grid" }, list.map(item => {
          const bazi = (item.system || item.summary?.system) !== "liuyao";
          const summary = item.summary || {};
          const line = bazi
            ? Object.values(summary.pillars || {}).join(" ")
            : [summary.ben_gua?.name, summary.bian_gua?.name].filter(Boolean).join(" → ") || summary.question || "六爻卦盘";
          return h("a", { class: "recent-card", href: `#/reading/${encodeURIComponent(item.id)}${bazi ? "?fresh=1" : ""}`, onClick: () => { if (bazi && textarea.value.trim()) local.set(`xz-next-draft:reading:${item.id}`, textarea.value.trim()); } },
            h("span", { class: ["chip", bazi ? "chip-bazi" : "chip-liuyao"] }, bazi ? "八字" : "六爻"),
            h("b", null, item.name || (bazi ? "未命名命盘" : "未命名卦盘")),
            h("span", { class: "recent-line serif" }, line));
        })));
    }).catch(() => { recent.hidden = true; });
  };
  loadRecent();
  ctx.subscribe(session, loadRecent);
  requestAnimationFrame(() => textarea.focus({ preventScroll: true }));
  return { node, title: "提问", layout: "focus" };
}

/* ==========================================================================
   六爻：写问题 → 三钱六掷 → 选择回答方式
   ========================================================================== */
function liuyaoFlow(ctx) {
  const wantsHelp = ctx.query.get("help") === "1";
  const restored = readCast(readDraft());
  const state = {
    mode: restored?.mode || "coins",
    lines: restored?.lines || [],   // 自下而上：{ value, coins: ["背","字",…] }
    casting: false,
    completedAt: restored?.completedAt || "",
    editing: null,                  // 手动录入时正在修改的爻位
    restored: !!restored,           // 这些爻是从上次未完成的起卦恢复的
    visibility: wantsHelp ? "help" : "private",
    submitting: false,
    saved: null,                    // 已排好的盘：求助发布失败后重试时不再重复排盘
  };
  const question = h("textarea", { class: "ask-input", rows: 2, maxlength: 2000, placeholder: "例如：本月能否签下这个合同？", "aria-label": "所问之事" });
  question.value = readDraft();
  question.addEventListener("input", () => { writeDraft(question.value); if (state.lines.length) saveCast(); questionError.hidden = true; question.removeAttribute("aria-invalid"); syncSubmit(); });
  autoGrow(question, 200);
  const questionError = h("p", { class: "field-error", hidden: true, role: "alert" });

  const coins = [0, 1, 2].map(() => h("span", { class: "coin", "aria-hidden": "true" },
    h("span", { class: "coin-face is-front" }, h("img", { src: "assets/qianlong_coin_front_transparent_512.png", alt: "", draggable: "false" })),
    h("span", { class: "coin-face is-back" }, h("img", { src: "assets/qianlong_coin_back_transparent_512.png", alt: "", draggable: "false" }))));
  const coinTags = h("div", { class: "coin-tags", "aria-live": "polite" });
  // 摇卦期间不用 disabled：按钮一旦禁用就会丢焦点，键盘用户下一次按空格会变成滚动页面。
  const castButton = h("button", { type: "button", class: "btn btn-primary btn-lg cast-btn" });
  const castNote = h("p", { class: "cast-note" });
  const modeSeg = h("div", { class: "seg", role: "group", "aria-label": "起卦方式" });
  const builder = h("ol", { class: "gua-builder", "aria-label": "六爻（自上而下显示，自下而上成卦）" });
  const banner = h("div", { class: "gua-ready", hidden: true, role: "status", tabindex: "-1" });
  const stage = h("div", { class: "cast-stage" }, h("div", { class: "coins" }, coins), coinTags, castButton, castNote);
  const manualPad = h("div", { class: "manual-pad", hidden: true });

  const visibilityOptions = [
    ["private", "私密 AI 解读", "仅自己可见，不进入社区。", "lock"],
    ["public", "公开 AI 解读", "选择即同意公开问题、卦象和首轮 AI 解答到广场。", "globe"],
    ["help", "向社区求助", "不调用 AI，不扣积分；公开脱敏卦象和问题，由卦友回答。", "hand"],
  ];
  const visibilityGroup = h("div", { class: "vis-grid", role: "radiogroup", "aria-label": "回答方式" });
  radioKeys(visibilityGroup);
  const quotaLabel = () => {
    const quota = session.get().quota;
    const wallet = session.get().wallet;
    if (!session.get().authenticated) return "登录后每日赠送免费积分";
    if (!quota) return "";
    return quota.remaining > 0 ? `今日免费 ${quota.remaining}/${quota.total} 分` : `今日免费已用 · 充值 ${wallet?.balance ?? 0} 分`;
  };
  const renderVisibility = () => {
    visibilityGroup.replaceChildren(...visibilityOptions.map(([value, label, copy, glyph]) => h("button", {
      type: "button",
      role: "radio",
      class: ["vis-card", `is-${value}`],
      "aria-checked": String(state.visibility === value),
      tabindex: state.visibility === value ? "0" : "-1",
      onClick: () => { state.visibility = value; renderVisibility(); syncSubmit(); },
    },
    h("span", { class: "vis-icon" }, icon(glyph)),
    h("span", { class: "vis-copy" }, h("b", null, label), h("span", null, copy),
      value === "private" ? h("small", null, quotaLabel()) : value === "public" ? h("small", null, "消耗积分 · 分享可增加每日额度") : h("small", null, "卦友回答后会提醒你")),
    h("span", { class: "vis-radio", "aria-hidden": "true" }))));
  };
  const submit = h("button", { type: "button", class: "btn btn-primary btn-lg btn-block submit-btn" });
  const submitError = h("p", { class: "field-error", hidden: true, role: "alert" });
  const ritual = h("div", { class: "ritual", hidden: true, role: "status" },
    h("span", { class: "ritual-mark", "aria-hidden": "true" }),
    h("span", { class: "ritual-text", "aria-hidden": "true" }),
    h("span", { class: "sr-only" }, "正在排盘，请稍候"));

  const node = h("div", { class: "ask-page is-cast" },
    focusHeader(ctx, wantsHelp ? "起一卦，请卦友帮你断" : "六爻问事", "一事一卦：写清所问，静心摇六次。"),
    h("section", { class: "flow-step" },
      h("div", { class: "flow-step-head" }, h("span", { class: "flow-num" }, "1"), h("h2", null, "所问之事"), h("span", { class: "flow-hint" }, "写清时间范围，一次只问一件事")),
      question, questionError,
      h("p", { class: "ask-privacy" }, icon("lock", "icon-sm"), "不要填写姓名、电话、住址或证件号。")),
    h("section", { class: "flow-step" },
      h("div", { class: "flow-step-head" }, h("span", { class: "flow-num" }, "2"), h("h2", null, "三钱六掷"), modeSeg),
      h("div", { class: "cast-layout" }, h("div", { class: "cast-left" }, stage, manualPad), h("div", { class: "cast-right" }, builder, banner))),
    h("section", { class: "flow-step" },
      h("div", { class: "flow-step-head" }, h("span", { class: "flow-num" }, "3"), h("h2", null, "怎么回答")),
      visibilityGroup),
    h("div", { class: "flow-submit" }, submitError, submit),
    ritual);

  /* ---- 摇钱 ---- */
  function secureCoins() {
    const bytes = new Uint8Array(3);
    if (!window.crypto || typeof window.crypto.getRandomValues !== "function") return null;
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, byte => (byte % 2 === 1 ? "背" : "字"));
  }

  function requireQuestion(verb) {
    if (question.value.trim()) return true;
    questionError.textContent = `先写下所问之事，再${verb}。`;
    questionError.hidden = false;
    question.setAttribute("aria-invalid", "true");
    question.focus();
    return false;
  }

  function saveCast() {
    if (state.lines.length) local.setJson(CAST_DRAFT, { lines: state.lines, mode: state.mode, completedAt: state.completedAt, question: question.value.trim(), at: Date.now() });
    else local.remove(CAST_DRAFT);
  }

  // 问题写好后回车：去摇下一爻；六爻已成就去选回答方式。
  function focusNextStep() {
    if (state.lines.length < 6 || state.editing !== null) {
      (state.mode === "manual" ? manualPad.querySelector(".manual-grid .btn") : castButton)?.focus();
    } else {
      visibilityGroup.querySelector('[aria-checked="true"]')?.focus();
    }
  }
  submitOnEnter(question, () => { if (question.value.trim()) focusNextStep(); });
  question.setAttribute("enterkeyhint", "next");

  function castOnce() {
    if (state.casting || state.lines.length >= 6) return;
    if (!requireQuestion("掷铜钱")) return;
    const faces = secureCoins();
    if (!faces) { toast("当前浏览器不支持安全随机数，无法本机摇钱。", { type: "error" }); return; }
    state.casting = true;
    syncCast();
    coins.forEach((coin, index) => {
      coin.classList.remove("is-back", "is-landed");
      coin.style.setProperty("--spin-delay", `${index * 70}ms`);
      coin.classList.add("is-spinning");
    });
    coinTags.replaceChildren();
    const reduce = reducedMotion();
    setTimeout(() => {
      coins.forEach((coin, index) => {
        coin.classList.remove("is-spinning");
        coin.classList.toggle("is-back", faces[index] === "背");
        coin.classList.add("is-landed");
      });
    }, reduce ? 0 : 760);
    setTimeout(() => {
      if (!ctx.isCurrent()) return;
      const value = faces.reduce((sum, face) => sum + (face === "背" ? 3 : 2), 0);
      state.lines.push({ value, coins: faces });
      state.restored = false;
      coinTags.replaceChildren(...faces.map(face => h("span", { class: ["coin-tag", face === "背" && "is-back"] }, face)),
        h("span", { class: "coin-result" }, `${LY_POS[state.lines.length - 1]}爻 · ${LY_VALUE_NAME[value]}`));
      if (state.lines.length === 6) state.completedAt = localDateTimeISO();
      state.casting = false;
      saveCast();
      syncCast();
      renderBuilder(state.lines.length - 1);
      syncSubmit();
      if (state.lines.length === 6) revealReady(castButton);
    }, reduce ? 50 : 1150);
  }

  // 卦成：把「六爻已就绪」带进视野（不被吸底的开始按钮挡住），焦点也移到这条提示上。
  function revealReady(from) {
    const reduce = reducedMotion();
    setTimeout(() => {
      if (!ctx.isCurrent() || banner.hidden) return;
      const active = document.activeElement;
      const rect = banner.getBoundingClientRect();
      // 按钮区约 116px（见 .gua-ready 的 scroll-margin-bottom）；block: "nearest" 判断可见时不算这段边距，所以自己判断。
      if (rect.top < 0 || rect.bottom > window.innerHeight - 116) banner.scrollIntoView({ block: "end", behavior: reduce ? "auto" : "smooth" });
      if (!active || active === document.body || from.contains(active)) banner.focus({ preventScroll: true });
    }, reduce ? 0 : 450);
  }

  function resetCast() {
    state.lines = [];
    state.completedAt = "";
    state.editing = null;
    state.restored = false;
    state.saved = null;
    coins.forEach(coin => coin.classList.remove("is-back", "is-landed", "is-spinning"));
    coinTags.replaceChildren();
    saveCast();
    syncCast();
    renderBuilder();
    renderManual();
    syncSubmit();
  }

  // 清空已成的爻之前先确认，避免误触丢掉一卦。
  async function confirmReset() {
    if (state.casting || !state.lines.length) return;
    const manual = state.mode === "manual";
    const ok = await confirmDialog({
      title: manual ? "全部重新录入？" : "重新摇一次？",
      message: `已${manual ? "录入" : "摇出"}的 ${state.lines.length} 爻会清空，从初爻重新开始。`,
      confirmText: "清空重来",
      danger: true,
    });
    if (!ok || !ctx.isCurrent()) return;
    resetCast();
    (manual ? manualPad.querySelector(".manual-grid .btn") : castButton)?.focus();
  }

  function syncCast() {
    const done = state.lines.length;
    castButton.setAttribute("aria-disabled", String(state.casting || done >= 6));
    castButton.classList.toggle("is-done", !state.casting && done >= 6);
    castButton.replaceChildren(state.casting
      ? h("span", null, `第 ${done + 1} 爻 · 钱落…`)
      : done >= 6 ? h("span", null, icon("check"), "六爻已成") : h("span", null, `摇第 ${CN_NUM[done + 1]} 爻`, h("small", null, ` · 共六爻`)));
    const reset = done && !state.casting ? h("button", { type: "button", class: "link-btn", onClick: confirmReset }, "重新摇一次") : null;
    castNote.replaceChildren(!done
      ? h("span", null, "本机随机 · 自下而上六掷 · 背为三、字为二")
      : done >= 6
        ? h("span", null, state.restored ? "已恢复刚才摇出的六爻 · " : null, reset)
        : h("span", null, state.restored ? `已恢复刚才的 ${done} 爻` : `已摇 ${done}/6`, " · 继续自下而上", reset ? [" · ", reset] : null));
  }

  function renderBuilder(animateIndex = -1) {
    const manual = state.mode === "manual";
    builder.classList.toggle("is-manual", manual);
    const rows = [];
    for (let index = 5; index >= 0; index -= 1) {
      const line = state.lines[index];
      const moving = line && (line.value === 6 || line.value === 9);
      const yin = line && (line.value === 6 || line.value === 8);
      const editing = manual && state.editing === index;
      rows.push(h("li", { class: ["gb-row", line ? "is-filled" : "is-empty", moving && "is-moving", editing && "is-editing", index === animateIndex && "is-new"] },
        h("span", { class: "gb-pos" }, `${LY_POS[index]}爻`),
        h("span", { class: ["gb-bar", line ? (yin ? "is-yin" : "is-yang") : ""], "aria-hidden": "true" }, h("i"), h("i")),
        h("span", { class: "gb-name" }, line ? LY_VALUE_NAME[line.value] : manual ? "待录入" : "待摇"),
        // 手动录入：改某一爻只替换这一爻，不会让上面的爻往下错位。
        manual && line ? h("button", {
          type: "button",
          class: "gb-edit",
          "aria-pressed": String(editing),
          "aria-label": `修改${LY_POS[index]}爻（现为${LY_VALUE_NAME[line.value]}）`,
          onClick: () => startEdit(index),
        }, editing ? "修改中" : "修改") : null));
    }
    builder.replaceChildren(...rows);
    const moving = state.lines.filter(line => line.value === 6 || line.value === 9).length;
    banner.hidden = state.lines.length < 6;
    banner.replaceChildren(h("span", { class: "gua-ready-seal", "aria-hidden": "true" }, "卦成"), h("span", null, h("b", null, "六爻已就绪"), h("small", null, `动爻 ${CN_NUM[moving]} 处 · 下一步选择怎么回答`)));
  }

  function startEdit(index) {
    if (state.editing === index) { cancelEdit(); return; }
    state.editing = index;
    renderBuilder();
    renderManual();
    (manualPad.querySelector('.manual-grid .btn[aria-pressed="true"]') || manualPad.querySelector(".manual-grid .btn"))?.focus();
  }

  function cancelEdit() {
    const index = state.editing;
    state.editing = null;
    renderBuilder();
    renderManual();
    builder.querySelectorAll(".gb-row")[5 - index]?.querySelector(".gb-edit")?.focus();
  }

  function pickManual(value, buttonIndex) {
    if (!requireQuestion("录入六爻")) return;
    const editing = state.editing;
    if (editing !== null) {
      state.lines[editing] = { value, coins: [] };
      state.editing = null;
    } else {
      state.lines.push({ value, coins: [] });
    }
    if (state.lines.length === 6 && !state.completedAt) state.completedAt = localDateTimeISO();
    state.restored = false;
    const full = state.lines.length === 6 && editing === null;
    saveCast();
    renderBuilder(editing ?? state.lines.length - 1);
    // 连续录入时焦点留在同一个选项上，键盘可以一路按下去。
    renderManual(full ? -1 : buttonIndex);
    syncSubmit();
    if (full) revealReady(manualPad);
  }

  function renderManual(focusIndex = -1) {
    manualPad.replaceChildren();
    if (state.mode !== "manual") return;
    const editing = state.editing !== null;
    const target = editing ? state.editing : state.lines.length;
    if (target >= 6) {
      manualPad.append(
        h("p", { class: "manual-title" }, "六爻已录满"),
        h("p", { class: "cast-note" }, "录错了？点右侧「修改」只改那一爻。 ", h("button", { type: "button", class: "link-btn", onClick: confirmReset }, "全部重录")));
      return;
    }
    const current = editing ? state.lines[target]?.value : null;
    const buttons = [[7, "少阳"], [8, "少阴"], [9, "老阳 ○"], [6, "老阴 ✕"]].map(([value, label], index) => h("button", {
      type: "button",
      class: "btn",
      "aria-pressed": editing ? String(current === value) : null,
      onClick: () => pickManual(value, index),
    }, label));
    manualPad.append(
      h("p", { class: "manual-title" }, editing ? `修改${LY_POS[target]}爻` : `录入${LY_POS[target]}爻`),
      h("div", { class: "manual-grid" }, buttons),
      h("p", { class: "cast-note" }, editing
        ? h("button", { type: "button", class: "link-btn", onClick: cancelEdit }, "取消修改")
        : state.lines.length
          ? ["自下而上逐爻点选 · ", h("button", { type: "button", class: "link-btn", onClick: confirmReset }, "全部重录")]
          : "自下而上逐爻点选"));
    if (focusIndex >= 0) buttons[focusIndex]?.focus({ preventScroll: true });
  }

  function renderMode() {
    modeSeg.replaceChildren(
      h("button", { type: "button", "aria-pressed": String(state.mode === "coins"), onClick: () => switchMode("coins") }, "本机摇钱"),
      h("button", { type: "button", "aria-pressed": String(state.mode === "manual"), onClick: () => switchMode("manual") }, "手动录入"));
    stage.hidden = state.mode !== "coins";
    manualPad.hidden = state.mode !== "manual";
  }

  function switchMode(mode) {
    if (state.casting || state.mode === mode) return;
    state.mode = mode;
    state.editing = null;
    saveCast();
    renderMode();
    renderManual();
    renderBuilder();
    syncCast();
    modeSeg.querySelector('[aria-pressed="true"]')?.focus();
  }

  castButton.addEventListener("click", castOnce);
  coins.forEach(coin => coin.addEventListener("click", castOnce));

  /* ---- 提交 ---- */
  // 还不能开始时，按钮说明差哪一步；点一下直接带到那一步。
  function missingStep() {
    if (!question.value.trim()) return "先写下所问之事";
    if (state.lines.length < 6) return `还差 ${6 - state.lines.length} 爻`;
    return "";
  }

  function syncSubmit() {
    const labels = { help: "发布社区求助", private: "开始私密解读", public: "开始公开解读" };
    const missing = missingStep();
    submit.disabled = state.submitting;
    submit.classList.toggle("is-waiting", !!missing);
    submit.setAttribute("aria-disabled", String(!!missing));
    submit.replaceChildren(...[icon(state.visibility === "help" ? "hand" : "sparkle"), labels[state.visibility], missing && h("small", null, ` · ${missing}`)].filter(Boolean));
  }

  function showRitual(lines) {
    ritual.hidden = false;
    let index = 0;
    const text = ritual.querySelector(".ritual-text");
    text.textContent = lines[0];
    const timer = setInterval(() => { index = (index + 1) % lines.length; text.textContent = lines[index]; }, 800);
    return () => { clearInterval(timer); ritual.hidden = true; };
  }

  submit.addEventListener("click", async () => {
    if (state.submitting) return;
    submitError.hidden = true;
    const text = question.value.trim();
    if (!requireQuestion("起卦")) return;
    if (state.lines.length < 6) {
      toast(`还差 ${6 - state.lines.length} 爻，自下而上摇满六爻再开始`);
      focusNextStep();
      return;
    }
    const help = state.visibility === "help";
    if (help && text.length < 8) {
      questionError.textContent = "向社区求助时，问题至少写 8 个字，让卦友看得明白。";
      questionError.hidden = false;
      question.setAttribute("aria-invalid", "true");
      question.focus();
      return;
    }
    const reasons = {
      help: "登录并验证邮箱后可免费求助，不调用 AI，不扣积分。",
      private: "私密提问，先登录或注册。",
      public: "登录后使用每日免费积分。分享公开问题可增加每日积分。",
    };
    const ok = await ctx.requireAuth(reasons[state.visibility]);
    if (!ok || !ctx.isCurrent() || state.submitting) return;
    const quota = session.get().quota;
    if (!help && quota && quota.can_start_answer === false) {
      submitError.replaceChildren("今日免费积分与账户积分已用完；明日北京时间 0 点刷新，或充值后继续。 ", h("a", { class: "link-btn", href: "#/me/credits" }, "去充值"));
      submitError.hidden = false;
      return;
    }
    state.submitting = true;
    syncSubmit();
    const stop = showRitual(help ? ["装卦 · 纳甲定世应 …", "整理脱敏卦面 …"] : ["装卦 · 纳甲定世应 …", "排六神 · 观动爻 …"]);
    const sessionId = newSessionId();
    const body = {
      system: "liuyao",
      method: state.mode === "manual" ? "manual" : "client_coins",
      question: text,
      as_of: state.completedAt || localDateTimeISO(),
      visibility: help ? "private" : state.visibility,
      public_consent: state.visibility === "public",
      public_consent_version: state.visibility === "public" ? "liuyao-public-v2" : "",
      session_id: sessionId,
      yaos: state.lines.map(line => line.value),
    };
    const signature = JSON.stringify([body.question, body.yaos, body.method, body.visibility]);
    let charted = false;
    try {
      // 同一卦同一问已经排过（只是求助没发出去）就直接复用，避免重复建档。
      const reuse = state.saved?.signature === signature ? state.saved : null;
      const chart = reuse ? reuse.chart : await post("/api/chart", body);
      if (!ctx.isCurrent()) return;
      const profileId = chart?.profile_id;
      if (!profileId) throw new Error("排盘已完成，但没有拿到档案编号，请到「我的盘」查看。");
      charted = true;
      state.saved = { signature, chart };
      refreshSession().catch(() => {});
      if (help) {
        ritual.querySelector(".ritual-text").textContent = "正在检查隐私并生成公开帖子…";
        const result = await post("/api/community/help-posts", { profile_id: Number(profileId), question: text, consent_version: "community-help-v1" }, { interaction: true });
        stop();
        writeDraft("");
        local.remove(CAST_DRAFT);
        if (!ctx.isCurrent()) return;
        toast("求助已发布，卦友回答后会提醒你", { type: "ok" });
        if (result?.post?.slug) ctx.navigate(`/post/${encodeURIComponent(result.post.slug)}`, { replace: true });
        else ctx.navigate(`/reading/${encodeURIComponent(profileId)}`, { replace: true });
        return;
      }
      stop();
      writeDraft("");
      local.remove(CAST_DRAFT);
      handoff(profileId, { system: "liuyao", payload: chart, input: body, sessionId: chart.session_id || sessionId, autoStart: true, question: text, name: chart.profile_name || "" });
      ctx.navigate(`/reading/${encodeURIComponent(profileId)}`, { replace: true });
    } catch (error) {
      stop();
      if (!ctx.isCurrent()) return;
      state.submitting = false;
      syncSubmit();
      const reason = humanizeError(error.message, "请稍后再试");
      submitError.textContent = charted ? `求助没有发出去：${reason}（卦已保存，重试不会重复排盘）` : `起卦失败：${reason}`;
      submitError.hidden = false;
    }
  });

  renderMode();
  renderBuilder();
  renderManual();
  renderVisibility();
  syncCast();
  syncSubmit();
  ctx.subscribe(session, () => { renderVisibility(); });
  if (restored) toast(restored.lines.length >= 6 ? "已恢复刚才摇出的六爻" : `已恢复刚才摇出的 ${restored.lines.length} 爻，可以接着摇`);
  if (!question.value) requestAnimationFrame(() => question.focus({ preventScroll: true }));
  return { node, title: "六爻问事", layout: "focus" };
}

/* ==========================================================================
   八字：选已有命盘，或填写出生信息新建
   ========================================================================== */
const STEMS = "甲乙丙丁戊己庚辛壬癸";
const BRANCHES = "子丑寅卯辰巳午未申酉戌亥";
const validPillar = text => {
  const value = String(text || "").replace(/\s/g, "");
  if (value.length !== 2) return false;
  const s = STEMS.indexOf(value[0]);
  const b = BRANCHES.indexOf(value[1]);
  return s >= 0 && b >= 0 && s % 2 === b % 2;
};
const pillarForYear = year => STEMS[((year - 4) % 10 + 10) % 10] + BRANCHES[((year - 4) % 12 + 12) % 12];
let birthFormSeq = 0;

// 新建命盘时暂存已填的出生信息（一天内有效）：切出去问家人时辰、页面被系统回收，回来不用重填。
const BIRTH_DRAFT = "xz-next-draft:birth";
const BIRTH_TTL = 24 * 60 * 60 * 1000;
function readBirthDraft() {
  const draft = local.json(BIRTH_DRAFT, null);
  return draft && typeof draft === "object" && Date.now() - Number(draft.at || 0) < BIRTH_TTL ? draft : null;
}

function baziFlow(ctx) {
  const setDefault = ctx.query.get("set_default") === "1";
  const editId = ctx.query.get("edit") || "";
  const node = h("div", { class: "ask-page is-birth" },
    editId
      ? focusHeader(ctx, "修改出生信息", "当前命盘资料已回填；提交后会更新此档案并按新信息重新排盘。")
      : focusHeader(ctx, "八字看长期", "用出生时间排一张命盘，之后可以一直追问。"));
  const body = h("div", { class: "birth-body" }, h("div", { class: "spinner-line" }, h("span", { class: "spinner" }), "正在准备…"));
  node.append(body);

  const start = async () => {
    const ready = session.get();
    if (!ready.ready) return;
    if (!ready.authenticated) {
      body.replaceChildren(stateView({
        glyph: "lock",
        title: "私人排盘，先登录或注册",
        text: "命盘只对本人可见，保存后可以跨设备继续追问。排盘本身不消耗积分。",
        actions: [h("button", { type: "button", class: "btn btn-primary", onClick: () => ctx.openAuth() }, "登录 / 注册")],
      }));
      return;
    }
    if (editId) {
      try {
        const detail = await get(`/api/profiles/${encodeURIComponent(editId)}`, { cache: "no-store" });
        if (!ctx.isCurrent()) return;
        body.replaceChildren(birthForm(ctx, { editing: { id: editId, input: detail?.input || {}, name: detail?.name || "" } }));
      } catch (error) {
        if (!ctx.isCurrent()) return;
        const gone = error?.status === 404;
        body.replaceChildren(stateView({
          tone: "error",
          title: gone ? "这份档案不存在或已删除" : "档案没能打开",
          text: error.message || "请稍后重试",
          actions: [
            gone ? null : h("button", { type: "button", class: "btn btn-soft", onClick: () => { body.replaceChildren(h("div", { class: "spinner-line", role: "status" }, h("span", { class: "spinner", "aria-hidden": "true" }), "正在打开…")); start(); } }, icon("refresh"), "重试"),
            h("a", { class: ["btn", gone ? "btn-primary" : "btn-ghost"], href: "#/me/archives" }, "回到我的盘"),
          ].filter(Boolean),
        }));
      }
      return;
    }
    let profiles = [];
    try {
      const items = await get("/api/profiles", { cache: "no-store" });
      profiles = (Array.isArray(items) ? items : []).filter(item => (item.system || item.summary?.system) !== "liuyao");
    } catch (_) {}
    if (!ctx.isCurrent()) return;
    body.replaceChildren(...[
      profiles.length && !setDefault ? existingProfiles(ctx, profiles) : null,
      birthForm(ctx, { setDefault, hasProfiles: profiles.length > 0 }),
    ].filter(Boolean));
  };
  start();
  let lastAuth = session.get().authenticated;
  let lastReady = session.get().ready;
  ctx.subscribe(session, s => {
    if (s.authenticated !== lastAuth || s.ready !== lastReady) {
      lastAuth = s.authenticated;
      lastReady = s.ready;
      start();
    }
  });
  return { node, title: "八字排盘", layout: "focus" };
}

function existingProfiles(ctx, profiles) {
  const question = readDraft();
  const list = profiles.slice().sort((a, b) => Number(b.is_default) - Number(a.is_default) || Number(b.id) - Number(a.id)).slice(0, 6);
  return h("section", { class: "flow-step" },
    h("div", { class: "flow-step-head" }, h("span", { class: "flow-num" }, icon("book", "icon-sm")), h("h2", null, "用已有命盘"), h("span", { class: "flow-hint" }, "同一张盘可以开新的对话")),
    h("div", { class: "recent-grid" }, list.map(item => h("a", {
      class: "recent-card",
      href: `#/reading/${encodeURIComponent(item.id)}?fresh=1`,
      onClick: () => { if (question.trim()) { local.set(`xz-next-draft:reading:${item.id}`, question.trim()); writeDraft(""); } },
    },
    h("span", { class: "recent-top" },
      h("span", { class: "chip chip-bazi" }, "八字"),
      item.is_default ? h("span", { class: "chip chip-gold" }, "默认命盘") : null),
    h("b", null, item.name || "未命名命盘"),
    h("span", { class: "recent-line serif" }, Object.values(item.summary?.pillars || {}).join(" ") || "四柱命盘")))),
    h("p", { class: "flow-or" }, h("span", null, "或者新建一张")));
}

function birthForm(ctx, { setDefault = false, hasProfiles = false, editing = null } = {}) {
  const draft = editing ? null : readBirthDraft();
  const saved = editing?.input || draft || {};
  const savedGender = saved.gender === "male" ? "男" : saved.gender === "female" ? "女" : saved.gender;
  const state = {
    mode: saved.input_mode === "manual_pillars" ? "manual_pillars" : "birth_time",
    gender: editing || draft ? (savedGender === "男" || savedGender === "女" ? savedGender : "") : "男",
    calendar: saved.calendar === "lunar" ? "lunar" : "solar",
  };
  const name = h("input", { class: "input", maxlength: 20, placeholder: "如 小秋、我的命盘；留空自动命名", autocomplete: "off", enterkeyhint: "next" });
  const genderSeg = h("div", { class: "seg seg-lg", role: "radiogroup", "aria-label": "性别" });
  const calendarSeg = h("div", { class: "seg", role: "radiogroup", "aria-label": "历法" });
  radioKeys(genderSeg);
  radioKeys(calendarSeg);
  const leap = h("input", { type: "checkbox" });
  const leapRow = h("label", { class: "check", hidden: true }, leap, h("span", null, "闰月"));
  const dateHintId = `birth-date-hint-${++birthFormSeq}`;
  // 占位符写成范围，避免看起来像已经填好的值。
  const num = (placeholder, label, max, last = false) => h("input", { class: "input num-input", inputmode: "numeric", maxlength: max, placeholder, "aria-label": label, autocomplete: "off", enterkeyhint: last ? "go" : "next", "aria-describedby": dateHintId });
  const year = num("如 1990", "出生年", 4);
  const month = num("1–12", "出生月", 2);
  const day = num("1–31", "出生日", 2);
  const hour = num("0–23", "出生小时", 2);
  const minute = num("0–59", "出生分钟", 2, true);
  const DATE_HINT = "小时必填，分钟留空按 00 分；时辰不确定可先填 12。";
  const dateHint = h("p", { class: "field-hint", id: dateHintId, "aria-live": "polite" }, DATE_HINT);
  const boundary = h("select", { class: "select", "aria-label": "换日规则" },
    h("option", { value: "zi" }, "子时换日（23:00）"),
    h("option", { value: "midnight" }, "零点换日（00:00）"),
    h("option", { value: "late_zi" }, "零点换日 + 夜子时"));
  // 折叠时也能看到已选的出生地与换日规则。
  const locationSummary = h("span", { class: "birth-more-label" });
  const showLocation = text => locationSummary.replaceChildren(...(text
    ? ["出生地", h("span", { class: "birth-more-value" }, text)]
    : ["出生地（选填 · 用于真太阳时）"]));
  showLocation("");
  const location = locationPicker({ initial: editing || draft ? String(saved.location || "") : "", onChange: showLocation });
  const moreSummary = h("span", { class: "birth-more-label" });
  const showBoundary = () => moreSummary.replaceChildren(...["更多设置", boundary.value !== "zi" && h("span", { class: "birth-more-value" }, boundary.selectedOptions[0]?.textContent || "")].filter(Boolean));
  boundary.addEventListener("change", showBoundary);
  const pillarInputs = [["year", "年柱"], ["month", "月柱"], ["day", "日柱"], ["hour", "时柱"]].map(([key, label]) => [key, label, h("input", { class: "input pillar-input", maxlength: 2, placeholder: key === "year" ? "如 甲子" : "", "aria-label": label, autocomplete: "off", enterkeyhint: key === "hour" ? "go" : "next" })]);
  const yearCandidates = h("div", { class: "year-candidates" });
  let manualBirthYear = null;
  const error = h("p", { class: "field-error", hidden: true, role: "alert" });
  const submitLabel = editing ? "更新并重新排盘" : "生成命盘";
  const submit = h("button", { type: "submit", class: "btn btn-primary btn-lg btn-block submit-btn" }, icon("sparkle"), submitLabel);
  const ritual = h("div", { class: "ritual", hidden: true, role: "status" },
    h("span", { class: "ritual-mark", "aria-hidden": "true" }),
    h("span", { class: "ritual-text", "aria-hidden": "true" }),
    h("span", { class: "sr-only" }, "正在排盘，请稍候"));

  if (editing || draft) {
    name.value = editing?.name || saved.name || "";
    const put = (input, value) => { if (value !== undefined && value !== null && value !== "") input.value = String(value); };
    put(year, saved.year); put(month, saved.month); put(day, saved.day); put(hour, saved.hour); put(minute, saved.minute);
    leap.checked = !!saved.is_leap_month;
    if (["zi", "midnight", "late_zi"].includes(saved.day_boundary)) boundary.value = saved.day_boundary;
    const pillars = saved.pillars || {};
    pillarInputs.forEach(([key, , input]) => put(input, pillars[key] || saved[`${key}_pillar`]));
  }
  showBoundary();
  const radio = (group, current, options, onPick) => {
    group.replaceChildren(...options.map(([value, label]) => h("button", {
      type: "button", role: "radio", "aria-checked": String(current() === value), tabindex: current() === value ? "0" : "-1",
      onClick: () => { onPick(value); },
    }, label)));
  };
  const renderGender = () => radio(genderSeg, () => state.gender, [["男", "男"], ["女", "女"], ["", "不透露"]], value => { state.gender = value; renderGender(); saveBirthDraft(); });
  const renderCalendar = () => {
    radio(calendarSeg, () => state.calendar, [["solar", "公历"], ["lunar", "农历"]], value => { state.calendar = value; renderCalendar(); saveBirthDraft(); if (day.value) checkDateField(day); });
    leapRow.hidden = state.calendar !== "lunar";
  };
  renderGender();
  renderCalendar();

  const updateCandidates = () => {
    const text = pillarInputs[0][2].value.replace(/\s/g, "");
    manualBirthYear = null;
    if (!text) { yearCandidates.replaceChildren(h("span", { class: "field-hint" }, "填写年柱后显示近 120 年候选。")); return; }
    if (!validPillar(text)) { yearCandidates.replaceChildren(h("span", { class: "field-error" }, "年柱干支不合（阳干配阳支、阴干配阴支，如「乙巳」「甲子」），请检查。")); return; }
    const now = new Date().getFullYear();
    const matches = [];
    for (let y = now; y > now - 120 && matches.length < 2; y -= 1) if (pillarForYear(y) === text) matches.push(y);
    manualBirthYear = matches[0] || null;
    const renderButtons = () => yearCandidates.replaceChildren(...matches.map((y, index) => h("button", {
      type: "button", class: ["pill-filter"], "aria-pressed": String(manualBirthYear === y),
      onClick: () => { manualBirthYear = y; renderButtons(); },
    }, `${text}年 · 公历 ${y}`, h("small", null, ` · ${index === 0 ? "本甲子" : "上一甲子"} · 虚岁约 ${now - y + 1}`))));
    renderButtons();
  };
  pillarInputs[0][2].addEventListener("input", updateCandidates);
  updateCandidates();

  const timeSection = h("div", { class: "birth-time" },
    h("div", { class: "birth-row" }, h("span", { class: "field-label" }, "历法"), calendarSeg, leapRow),
    h("div", { class: "date-grid" },
      h("label", { class: "date-cell" }, year, h("span", null, "年")),
      h("label", { class: "date-cell" }, month, h("span", null, "月")),
      h("label", { class: "date-cell" }, day, h("span", null, "日")),
      h("label", { class: "date-cell" }, hour, h("span", null, "时")),
      h("label", { class: "date-cell" }, minute, h("span", null, "分"))),
    dateHint,
    h("details", { class: "birth-more" },
      h("summary", null, locationSummary),
      location.node,
      h("p", { class: "field-hint" }, "海外请选择城市；留空或未识别时不做经度修正。")),
    h("details", { class: "birth-more" },
      h("summary", null, moreSummary),
      h("label", { class: "field" }, h("span", { class: "field-label" }, "换日规则"), boundary)));
  const manualSection = h("div", { class: "birth-manual", hidden: true },
    h("div", { class: "pillar-grid" }, pillarInputs.map(([, label, input]) => h("label", { class: "field" }, h("span", { class: "field-label" }, label), input))),
    h("div", { class: "field" }, h("span", { class: "field-label" }, "生年（匹配出生锚点）"), yearCandidates));
  const modeSeg = h("div", { class: "seg", role: "tablist", "aria-label": "输入方式" });
  const renderMode = () => {
    modeSeg.replaceChildren(
      h("button", { type: "button", role: "tab", "aria-selected": String(state.mode === "birth_time"), onClick: () => { state.mode = "birth_time"; renderMode(); saveBirthDraft(); } }, "按出生时间"),
      h("button", { type: "button", role: "tab", "aria-selected": String(state.mode === "manual_pillars"), onClick: () => { state.mode = "manual_pillars"; renderMode(); saveBirthDraft(); } }, "已知四柱"));
    timeSection.hidden = state.mode !== "birth_time";
    manualSection.hidden = state.mode !== "manual_pillars";
  };
  renderMode();

  const form = h("form", { class: "birth-form", novalidate: true },
    h("section", { class: "flow-step" },
      h("div", { class: "flow-step-head" }, h("span", { class: "flow-num" }, "1"), h("h2", null, "你是谁")),
      h("label", { class: "field" }, h("span", { class: "field-label" }, "称呼（可选）"), name),
      h("div", { class: "field" }, h("span", { class: "field-label" }, "性别"), genderSeg, h("span", { class: "field-hint" }, "性别决定大运顺逆；不透露则无法排大运。"))),
    h("section", { class: "flow-step" },
      h("div", { class: "flow-step-head" }, h("span", { class: "flow-num" }, "2"), h("h2", null, "出生时间"), modeSeg),
      timeSection,
      manualSection),
    h("div", { class: "flow-submit" }, error, submit),
    h("p", { class: "flow-foot" }, icon("lock", "icon-sm"), editing ? "更新后从新盘重新开始解读，原有解读不再挂在当前档案下。" : setDefault ? "生成后设为默认命盘，用于每天的宜忌。" : "排盘免费，命盘只对本人可见。"),
    ritual);

  function fail(message, field) {
    error.textContent = message;
    error.hidden = false;
    if (field) { field.setAttribute("aria-invalid", "true"); field.focus(); }
  }

  /* ---- 出生时间：数字格 ---- */
  const DATE_FIELDS = [year, month, day, hour, minute];
  // 首位已不可能再接第二位时（月份 2–9、日期 4–9、小时 3–9）也算填完。
  const EARLY = new Map([[month, 2], [day, 4], [hour, 3]]);

  // 离开某一格时就检查范围，不必等到提交才发现。
  function dateProblem(input) {
    const text = input.value.trim();
    if (!text) return "";
    const value = Number(text);
    if (input === year) return value >= 1 ? "" : "请填写有效的出生年份";
    if (input === month) return value >= 1 && value <= 12 ? "" : "月份应在 1–12 之间";
    if (input === hour) return value <= 23 ? "" : "小时应在 0–23 之间";
    if (input === minute) return value <= 59 ? "" : "分钟应在 0–59 之间";
    if (value < 1 || value > 31) return "日期应在 1–31 之间";
    if (state.calendar === "lunar") return value > 30 ? "农历日期应在 1–30 之间" : "";
    const y = Number(year.value);
    const m = Number(month.value);
    if (!(y >= 1000) || !(m >= 1 && m <= 12)) return "";
    return new Date(Date.UTC(y, m - 1, value)).getUTCDate() === value ? "" : "该公历日期不存在，请检查月份和日期";
  }

  function refreshDateHint() {
    const first = DATE_FIELDS.find(input => input.getAttribute("aria-invalid") === "true" && dateProblem(input));
    const problem = first ? dateProblem(first) : "";
    dateHint.className = problem ? "field-error" : "field-hint";
    dateHint.textContent = problem || DATE_HINT;
  }

  function checkDateField(input) {
    if (dateProblem(input)) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
    refreshDateHint();
  }

  DATE_FIELDS.forEach((input, index) => {
    input.addEventListener("input", event => {
      const digits = input.value.replace(/\D/g, "").slice(0, input.maxLength);
      if (digits !== input.value) input.value = digits;
      if (input.hasAttribute("aria-invalid")) { input.removeAttribute("aria-invalid"); refreshDateHint(); }
      // 写满就跳到下一格（只在往后打字时跳，删改和粘贴不跳）。
      const next = DATE_FIELDS[index + 1];
      if (!next || event.inputType !== "insertText" || input.selectionEnd !== digits.length) return;
      if (digits.length >= input.maxLength || (EARLY.has(input) && digits.length === 1 && Number(digits) >= EARLY.get(input))) {
        next.focus();
        next.select();
      }
    });
    input.addEventListener("blur", () => {
      checkDateField(input);
      if ((input === year || input === month) && day.value) checkDateField(day);
    });
  });

  // 已知四柱：一柱写成有效干支后跳到下一柱（输入法上屏后才判断）。
  pillarInputs.forEach(([, , input], index) => {
    input.addEventListener("input", event => {
      const next = pillarInputs[index + 1]?.[2];
      if (!next || event.isComposing || !validPillar(input.value)) return;
      next.focus();
      next.select();
    });
  });

  // 回车 = 下一格（输入法选词时的回车不算）；最后一格回车直接生成，不再从第一格就提交出错。
  form.addEventListener("keydown", event => {
    if (event.key !== "Enter" || event.isComposing || event.keyCode === 229) return;
    const fields = state.mode === "manual_pillars" ? [name, ...pillarInputs.map(entry => entry[2])] : [name, ...DATE_FIELDS];
    const index = fields.indexOf(event.target);
    if (index < 0) return;
    event.preventDefault();
    const next = fields[index + 1];
    if (next) { next.focus(); next.select(); } else form.requestSubmit();
  });
  // 改动任何一项后，旧的提交错误就收起来。
  form.addEventListener("input", () => { if (!submit.disabled) error.hidden = true; });

  function saveBirthDraft() {
    if (editing) return;
    const pillars = Object.fromEntries(pillarInputs.map(([key, , input]) => [key, input.value]));
    const snapshot = {
      name: name.value, gender: state.gender, input_mode: state.mode, calendar: state.calendar,
      year: year.value, month: month.value, day: day.value, hour: hour.value, minute: minute.value,
      is_leap_month: leap.checked, day_boundary: boundary.value, location: location.value(), pillars, at: Date.now(),
    };
    const filled = [snapshot.name, snapshot.year, snapshot.month, snapshot.day, snapshot.hour, snapshot.minute, snapshot.location, ...Object.values(pillars)].some(value => String(value || "").trim());
    if (filled) local.setJson(BIRTH_DRAFT, snapshot);
    else local.remove(BIRTH_DRAFT);
  }
  form.addEventListener("input", saveBirthDraft);
  form.addEventListener("change", saveBirthDraft);

  function clearBirthForm() {
    local.remove(BIRTH_DRAFT);
    [name, year, month, day, hour, minute, ...pillarInputs.map(entry => entry[2])].forEach(input => { input.value = ""; input.removeAttribute("aria-invalid"); });
    leap.checked = false;
    boundary.value = "zi";
    showBoundary();
    location.reset();
    Object.assign(state, { mode: "birth_time", gender: "男", calendar: "solar" });
    renderGender();
    renderCalendar();
    renderMode();
    updateCandidates();
    refreshDateHint();
    name.focus({ preventScroll: true });
  }
  if (draft) toast("已恢复上次没填完的出生信息", { action: { label: "清空重填", onClick: clearBirthForm } });

  function validate() {
    [year, month, day, hour, minute, ...pillarInputs.map(entry => entry[2])].forEach(input => input.removeAttribute("aria-invalid"));
    refreshDateHint();
    error.hidden = true;
    if (state.mode === "manual_pillars") {
      for (const [, label, input] of pillarInputs) {
        const value = input.value.replace(/\s/g, "");
        if (!value) return fail(`请填写${label}`, input);
        if (!validPillar(value)) return fail(`${label}应为有效干支，如 甲子`, input);
      }
      return true;
    }
    const read = input => (input.value.trim() === "" ? null : Number(input.value.trim()));
    const y = read(year); const m = read(month); const d = read(day); const hh = read(hour); const mm = read(minute);
    if (y === null || Number.isNaN(y)) return fail("请填写出生年", year);
    if (!Number.isInteger(y) || y < 1) return fail("请填写有效的出生年份", year);
    if (m === null || Number.isNaN(m)) return fail("请填写出生月", month);
    if (!Number.isInteger(m)) return fail("月份请填写整数", month);
    if (d === null || Number.isNaN(d)) return fail("请填写出生日", day);
    if (!Number.isInteger(d)) return fail("日期请填写整数", day);
    if (m < 1 || m > 12) return fail("月份应在 1–12 之间", month);
    if (d < 1 || d > 31) return fail("日期应在 1–31 之间", day);
    if (state.calendar === "solar") {
      const date = new Date(Date.UTC(y, m - 1, d));
      if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return fail("该公历日期不存在，请检查月份和日期", day);
    } else if (d > 30) return fail("农历日期应在 1–30 之间", day);
    if (hh === null || Number.isNaN(hh)) return fail("请填写出生小时；不确定时可先填 12", hour);
    if (!Number.isInteger(hh)) return fail("小时请填写整数", hour);
    if (hh < 0 || hh > 23) return fail("小时应在 0–23 之间", hour);
    if (mm !== null && (!Number.isInteger(mm) || mm < 0 || mm > 59)) return fail("分钟应在 0–59 之间", minute);
    return true;
  }

  function buildBody() {
    const sessionId = newSessionId();
    const asOf = new Date().toISOString().slice(0, 10);
    const base = { system: "bazi", name: name.value.trim() || null, gender: state.gender || null, as_of: asOf, session_id: sessionId };
    if (state.mode === "manual_pillars") {
      const [yp, mp, dp, hp] = pillarInputs.map(entry => entry[2].value.replace(/\s/g, ""));
      return { ...base, input_mode: "manual_pillars", manual_birth_year: manualBirthYear, year_pillar: yp, month_pillar: mp, day_pillar: dp, hour_pillar: hp, pillars: { year: yp, month: mp, day: dp, hour: hp } };
    }
    return {
      ...base,
      input_mode: "birth_time",
      calendar: state.calendar,
      year: Number(year.value), month: Number(month.value), day: Number(day.value),
      hour: Number(hour.value), minute: minute.value.trim() === "" ? 0 : Number(minute.value),
      is_leap_month: state.calendar === "lunar" && leap.checked,
      location: location.value() || null,
      use_true_solar: true,
      day_boundary: boundary.value,
    };
  }

  function fieldForMessage(message) {
    if (/出生日期|年月日|公历日期|农历日期/.test(message)) return day;
    if (/分钟|分应|0–59/.test(message)) return minute;
    if (/小时|时辰|0–23/.test(message)) return hour;
    if (/月份|1–12/.test(message)) return month;
    if (/日期/.test(message)) return day;
    if (/出生年|年份/.test(message)) return year;
    return null;
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!validate()) return;
    const bodyPayload = buildBody();
    submit.disabled = true;
    submit.textContent = editing ? "更新并排盘中…" : "排盘中…";
    ritual.hidden = false;
    const text = ritual.querySelector(".ritual-text");
    const lines = bodyPayload.input_mode === "manual_pillars" ? ["录四柱 · 定甲子 …", "定大运 · 起流年 …"] : ["校真太阳时 · 排四柱 …", "定大运 · 起流年 …"];
    let index = 0;
    text.textContent = lines[0];
    const timer = setInterval(() => { index = (index + 1) % lines.length; text.textContent = lines[index]; }, 800);
    try {
      if (editing) {
        const saved = await put(`/api/profiles/${encodeURIComponent(editing.id)}`, bodyPayload);
        if (!ctx.isCurrent()) return;
        const payloadData = saved?.payload || saved;
        const warn = Array.isArray(payloadData?.warnings) && payloadData.warnings[0];
        toast(warn ? String(warn) : "档案已更新，已按新信息重新排盘", { type: warn ? "info" : "ok" });
        refreshSession().catch(() => {});
        handoff(editing.id, { system: "bazi", payload: payloadData, input: bodyPayload, sessionId: bodyPayload.session_id, name: saved?.name || payloadData?.profile_name || bodyPayload.name || "" });
        ctx.navigate(`/reading/${encodeURIComponent(editing.id)}`, { replace: true });
        return;
      }
      const chart = await post("/api/chart", bodyPayload);
      if (!ctx.isCurrent()) return;
      const profileId = chart?.profile_id;
      if (!profileId) throw new Error("排盘已完成，但没有拿到档案编号，请到「我的盘」查看。");
      local.remove(BIRTH_DRAFT);
      refreshSession().catch(() => {});
      const warning = Array.isArray(chart.warnings) && chart.warnings[0];
      if (warning) toast(String(warning));
      if (setDefault) {
        await put("/api/personal-home/default-profile", { profile_id: Number(profileId) }).catch(() => null);
        toast("已设为默认命盘，正在准备今日内容", { type: "ok" });
        ctx.navigate("/today", { replace: true });
        return;
      }
      const draft = readDraft().trim();
      if (draft) { local.set(`xz-next-draft:reading:${profileId}`, draft); writeDraft(""); }
      handoff(profileId, { system: "bazi", payload: chart, input: bodyPayload, sessionId: bodyPayload.session_id, name: chart.profile_name || bodyPayload.name || "" });
      ctx.navigate(`/reading/${encodeURIComponent(profileId)}`, { replace: true });
    } catch (error) {
      if (!ctx.isCurrent()) return;
      const message = humanizeError(error.message, "请稍后再试");
      fail(`${editing ? "更新失败" : "排盘失败"}：${message}`, fieldForMessage(message));
      submit.disabled = false;
      submit.replaceChildren(icon("sparkle"), submitLabel);
    } finally {
      clearInterval(timer);
      ritual.hidden = true;
    }
  });
  if (!hasProfiles && !editing) requestAnimationFrame(() => name.focus({ preventScroll: true }));
  return form;
}
