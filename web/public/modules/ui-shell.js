(function (global) {
  "use strict";

  // 界面版本切换：新版与经典版共用同一套页面、状态和接口，只切换 html[data-ui] 与视觉层。
  // 首帧版本由 index.html 顶部内联脚本决定；这里负责切换按钮、首次提示和新版专属的输入增强。
  const STORAGE_KEY = "xz-ui";
  const INTRO_KEY = "xz-ui-intro-v1";
  const THEME_COLOR = { next: "#F4EFE6", classic: "#ffffff" };
  const root = document.documentElement;
  let noticeTimer = null;

  function currentMode() {
    return root.dataset.ui === "classic" ? "classic" : "next";
  }

  function store(key, value) {
    try { localStorage.setItem(key, value); } catch (_) {}
  }

  function read(key) {
    try { return localStorage.getItem(key) || ""; } catch (_) { return ""; }
  }

  function syncSwitches(mode = currentMode()) {
    const text = mode === "next" ? "回到经典版" : "体验新版";
    document.querySelectorAll("[data-ui-switch]").forEach(button => {
      button.dataset.uiTarget = mode === "next" ? "classic" : "next";
      button.setAttribute("aria-label", `${text}界面`);
      button.title = mode === "next" ? "切换回经典版界面" : "切换到新版界面";
      const label = button.querySelector("[data-ui-switch-label]");
      if (label) label.textContent = text;
    });
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[mode]);
  }

  function notice(message) {
    let node = document.querySelector("[data-ui-switch-notice]");
    if (!node) {
      node = document.createElement("div");
      node.className = "ui-switch-notice";
      node.dataset.uiSwitchNotice = "";
      node.setAttribute("role", "status");
      node.setAttribute("aria-live", "polite");
      document.body.append(node);
    }
    node.textContent = message;
    node.hidden = false;
    node.classList.remove("is-visible");
    window.requestAnimationFrame(() => node.classList.add("is-visible"));
    window.clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => {
      node.classList.remove("is-visible");
      noticeTimer = window.setTimeout(() => { node.hidden = true; }, 220);
    }, 2600);
  }

  function collapseSidebar() {
    const nav = document.querySelector(".hero-nav");
    if (nav?.dataset.sidebarExpanded === "true") document.querySelector("[data-sidebar-toggle]")?.click();
  }

  function setMode(mode, { persist = true, announce = true } = {}) {
    if (mode !== "next" && mode !== "classic") return;
    if (persist) store(STORAGE_KEY, mode);
    if (mode === currentMode()) {
      syncSwitches(mode);
      return;
    }
    root.dataset.ui = mode;
    syncSwitches(mode);
    collapseSidebar();
    closeIntro({ remember: true });
    syncBirthControls();
    // 版式变化后让依赖尺寸的图表、时间轴与视口高度重新测量。
    window.dispatchEvent(new Event("resize"));
    document.dispatchEvent(new CustomEvent("xuanshu:uichange", { detail: { mode } }));
    if (announce) notice(mode === "next" ? "已切换到新版界面" : "已回到经典版，可随时再切回新版");
  }

  function toggleMode() {
    setMode(currentMode() === "next" ? "classic" : "next");
  }

  /* ---------- 新版首次提示 ---------- */
  function closeIntro({ remember = false } = {}) {
    const intro = document.querySelector("[data-nx-intro]");
    if (remember) store(INTRO_KEY, "1");
    if (!intro) return;
    intro.classList.remove("is-visible");
    window.setTimeout(() => intro.remove(), 220);
  }

  function showIntro() {
    if (currentMode() !== "next" || read(INTRO_KEY) === "1") return;
    const intro = document.createElement("aside");
    intro.className = "nx-intro nx-only";
    intro.dataset.nxIntro = "";
    intro.setAttribute("aria-label", "新版界面说明");
    intro.innerHTML = `
      <span class="nx-seal" aria-hidden="true">新</span>
      <div class="nx-intro-copy">
        <b>玄枢换上了新界面</b>
        <span>字更大、排盘与对话更顺手。不习惯的话，随时可以回到经典版。</span>
      </div>
      <div class="nx-intro-actions">
        <button type="button" class="nx-intro-back" data-ui-switch><span data-ui-switch-label>回到经典版</span></button>
        <button type="button" class="nx-intro-ok" data-nx-intro-close>好的</button>
      </div>`;
    document.body.append(intro);
    syncSwitches();
    window.requestAnimationFrame(() => intro.classList.add("is-visible"));
  }

  /* ---------- 八字录入：性别与历法改为一次点选 ---------- */
  const birthControls = [];

  function segmentedFor(select, label) {
    if (!select || select.dataset.nxSegmented) return;
    select.dataset.nxSegmented = "true";
    const group = document.createElement("div");
    group.className = "nx-seg nx-only";
    group.setAttribute("role", "radiogroup");
    group.setAttribute("aria-label", label);
    const buttons = Array.from(select.options).map(option => {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "radio");
      button.dataset.value = option.value;
      button.textContent = option.textContent;
      group.append(button);
      return button;
    });
    const sync = () => {
      buttons.forEach(button => {
        const checked = button.dataset.value === select.value;
        button.setAttribute("aria-checked", String(checked));
        button.tabIndex = checked ? 0 : -1;
      });
    };
    const choose = button => {
      if (select.value !== button.dataset.value) {
        select.value = button.dataset.value;
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
      sync();
    };
    buttons.forEach((button, index) => {
      button.addEventListener("click", () => choose(button));
      button.addEventListener("keydown", event => {
        const step = event.key === "ArrowRight" || event.key === "ArrowDown"
          ? 1
          : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
        if (!step) return;
        event.preventDefault();
        const next = buttons[(index + step + buttons.length) % buttons.length];
        choose(next);
        next.focus();
      });
    });
    select.addEventListener("change", sync);
    select.classList.add("nx-enhanced-select");
    select.insertAdjacentElement("afterend", group);
    birthControls.push(sync);
    sync();
  }

  function syncBirthControls() {
    birthControls.forEach(sync => sync());
  }

  function setupBirthControls() {
    segmentedFor(document.getElementById("f-gender"), "性别");
    segmentedFor(document.getElementById("f-calendar"), "历法");
    const form = document.getElementById("birth-form");
    form?.addEventListener("reset", () => window.setTimeout(syncBirthControls, 0));
    // 回填档案时脚本直接写 select.value，不触发事件；页面显示时统一再同步一次。
    const page = document.getElementById("birth-modal");
    if (page && "MutationObserver" in global) {
      new MutationObserver(syncBirthControls).observe(page, { attributes: true, attributeFilter: ["hidden"] });
    }
    document.addEventListener("focusin", event => {
      if (event.target?.closest?.("#birth-form")) syncBirthControls();
    });
  }

  /* ---------- 新版：对话往上翻时「回到最新」、长页面「回到顶部」 ---------- */
  const reducedMotion = () => global.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  function setupJumpToLatest() {
    const thread = document.getElementById("chat-thread");
    const composer = document.getElementById("composer");
    if (!thread || !composer) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "nx-jump-latest nx-only";
    button.textContent = "回到最新";
    button.setAttribute("aria-label", "滚动到最新消息");
    composer.prepend(button);
    let frame = 0;
    const sync = () => {
      if (frame) return;
      frame = global.requestAnimationFrame(() => {
        frame = 0;
        const distance = thread.scrollHeight - thread.scrollTop - thread.clientHeight;
        button.classList.toggle("is-visible", currentMode() === "next" && distance > 360);
      });
    };
    thread.addEventListener("scroll", sync, { passive: true });
    if ("MutationObserver" in global) new MutationObserver(sync).observe(thread, { childList: true, subtree: true });
    button.addEventListener("click", () => {
      thread.scrollTo({ top: thread.scrollHeight, behavior: reducedMotion() ? "auto" : "smooth" });
    });
  }

  function setupBackToTop() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "nx-back-top nx-only";
    button.setAttribute("aria-label", "回到顶部");
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 14 6-6 6 6"/></svg>';
    document.body.append(button);
    let frame = 0;
    global.addEventListener("scroll", () => {
      if (frame) return;
      frame = global.requestAnimationFrame(() => {
        frame = 0;
        button.classList.toggle("is-visible", global.scrollY > 900);
      });
    }, { passive: true });
    button.addEventListener("click", () => global.scrollTo({ top: 0, behavior: reducedMotion() ? "auto" : "smooth" }));
  }

  /* ---------- 新版：对话与评论只在第一次出现时入场 ---------- */
  // 流式回答会频繁重绘消息节点，发出评论后也会重绘整个评论列表。按稳定键记住每条的首次出现时间：
  // 重绘出的同一条不再从头入场；入场还没播完就被重绘时，用负延迟接着播，避免闪烁。
  const ENTER_MS = 420;
  const ENTER_SELECTOR = ".msg-user, .msg-ai, .comment";
  const firstSeen = new Map();

  function enterKey(node) {
    if (node.matches(".msg-ai")) return node.dataset.id ? `ai:${node.dataset.id}` : "";
    if (node.matches(".comment")) return node.dataset.commentId ? `comment:${node.dataset.commentId}` : "";
    const users = node.parentElement ? Array.from(node.parentElement.querySelectorAll(":scope > .msg-user")) : [];
    return `user:${users.indexOf(node)}:${node.textContent.slice(0, 120)}`;
  }

  function markEnter(node, now) {
    const key = enterKey(node);
    if (!key) return;
    if (!firstSeen.has(key)) firstSeen.set(key, now);
    const elapsed = now - firstSeen.get(key);
    if (elapsed >= ENTER_MS) return;
    node.classList.add("nx-enter");
    if (elapsed > 0) node.style.animationDelay = `-${Math.round(elapsed)}ms`;
  }

  function setupEnterOnce() {
    if (!("MutationObserver" in global)) return;
    new MutationObserver(records => {
      if (currentMode() !== "next") return;
      const now = global.performance.now();
      records.forEach(record => record.addedNodes.forEach(node => {
        if (node.nodeType !== 1) return;
        if (node.matches(ENTER_SELECTOR)) markEnter(node, now);
        node.querySelectorAll(ENTER_SELECTOR).forEach(child => markEnter(child, now));
      }));
    }).observe(document.body, { childList: true, subtree: true });
  }

  /* ---------- 新版：登录后首页按时段问候 ---------- */
  function setupGreeting() {
    const header = document.querySelector(".ph-today > header");
    if (!header) return;
    const node = document.createElement("p");
    node.className = "nx-greeting nx-only";
    header.prepend(node);
    const render = () => {
      const hour = new Date().getHours();
      const part = hour < 5 ? "夜深了" : hour < 11 ? "早上好" : hour < 13 ? "中午好" : hour < 18 ? "下午好" : "晚上好";
      const nickname = String(global.XuanxueAccount?.snapshot?.()?.user?.nickname || "").trim();
      node.textContent = nickname ? `${part}，${nickname}` : part;
    };
    render();
    document.addEventListener("xuanshu:authchange", render);
    global.setInterval(render, 10 * 60 * 1000);
  }

  function mountFloatingSwitch() {
    // 经典版手机底栏没有空位，在首页右上角放一个小标签（仅经典版手机宽度显示）。
    if (document.querySelector(".ui-switch-float")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ui-switch-float";
    button.dataset.uiSwitch = "";
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h13l-3-3M20 16H7l3 3"/></svg><span data-ui-switch-label>体验新版</span>';
    document.body.append(button);
  }

  function init() {
    mountFloatingSwitch();
    syncSwitches();
    document.addEventListener("click", event => {
      if (event.target.closest?.("[data-ui-switch]")) {
        event.preventDefault();
        toggleMode();
        return;
      }
      if (event.target.closest?.("[data-nx-intro-close]")) closeIntro({ remember: true });
    });
    setupBirthControls();
    setupJumpToLatest();
    setupEnterOnce();
    setupBackToTop();
    setupGreeting();
    showIntro();
  }

  global.XuanxueUiShell = Object.freeze({ currentMode, setMode, toggleMode });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})(window);
