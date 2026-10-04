// 浮层：桌面为居中对话框，手机为底部面板；统一处理焦点、Esc、背景滚动锁与层叠。
import { h } from "../lib/dom.js?v=n9";
import { icon } from "../lib/icons.js?v=n9";
import { holdNavigation, navigationHold } from "../lib/router.js?v=n9";

const stack = [];
let historyToken = 0;

// 手机返回键 / 浏览器后退：先关掉最上层的面板，而不是离开页面。
window.addEventListener("popstate", () => {
  const top = stack[stack.length - 1];
  if (!top || !top.historyToken) return;
  if (history.state?.xzOverlay !== top.historyToken) top.close("back");
});
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function lockScroll() {
  document.body.classList.add("is-locked");
}

function unlockScroll() {
  if (!stack.length) document.body.classList.remove("is-locked");
}

document.addEventListener("keydown", event => {
  const top = stack[stack.length - 1];
  if (!top) return;
  if (event.key === "Escape" && top.dismissible) {
    event.preventDefault();
    top.close("escape");
  } else if (event.key === "Tab") {
    const nodes = Array.from(top.panel.querySelectorAll(FOCUSABLE)).filter(node => node.offsetParent !== null || node === document.activeElement);
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});

export function openSheet({ title = "", body, footer = null, wide = false, dismissible = true, onClose, label, className = "", returnFocus: focusBack = null } = {}) {
  const returnFocus = focusBack || document.activeElement;
  const titleId = `sheet-title-${Math.random().toString(36).slice(2, 8)}`;
  const closeButton = dismissible
    ? h("button", { type: "button", class: "icon-btn", "aria-label": "关闭" }, icon("close"))
    : null;
  const bodyNode = h("div", { class: "sheet-body" }, body);
  const footNode = footer ? h("div", { class: "sheet-foot" }, footer) : null;
  const panel = h("section", {
    class: ["sheet", wide && "sheet-wide", className],
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": title ? titleId : null,
    "aria-label": title ? null : (label || "对话框"),
  },
  h("div", { class: "sheet-grip", "aria-hidden": "true" }),
  title || closeButton ? h("header", { class: "sheet-head" }, h("h2", { id: titleId }, title), closeButton) : null,
  bodyNode,
  footNode);
  const overlay = h("div", { class: "overlay" }, panel);
  let closed = false;
  const entry = {
    panel,
    dismissible,
    historyToken: 0,
    close(reason = "close") {
      if (closed) return;
      closed = true;
      const index = stack.indexOf(entry);
      if (index >= 0) stack.splice(index, 1);
      // 用按钮、Esc、下滑等方式关闭时，顺手退掉面板占用的那条历史记录；路由切换或返回键关闭时不用。
      if (entry.historyToken && reason !== "route" && reason !== "back" && history.state?.xzOverlay === entry.historyToken) {
        holdNavigation(new Promise(resolve => {
          const done = () => { window.removeEventListener("popstate", done); resolve(); };
          window.addEventListener("popstate", done);
          setTimeout(done, 600);
          history.back();
        }));
      }
      overlay.classList.add("is-closing");
      const finish = () => {
        overlay.remove();
        unlockScroll();
        if (returnFocus && typeof returnFocus.focus === "function" && document.contains(returnFocus)) returnFocus.focus({ preventScroll: true });
      };
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      if (reduce) finish(); else setTimeout(finish, 190);
      onClose?.(reason);
    },
  };
  closeButton?.addEventListener("click", () => entry.close("button"));
  overlay.addEventListener("mousedown", event => {
    if (event.target === overlay && dismissible) entry.close("backdrop");
  });
  if (dismissible) enableSwipeDown(panel, () => entry.close("swipe"));
  stack.push(entry);
  lockScroll();
  document.body.append(overlay);
  keepAboveKeyboard(overlay, entry);
  if (dismissible) {
    const remember = () => {
      if (closed) return;
      entry.historyToken = ++historyToken;
      const state = history.state && typeof history.state === "object" ? history.state : {};
      history.pushState({ ...state, xzOverlay: entry.historyToken }, "");
    };
    // 上一个面板刚关、它的后退还没完成就打开新面板（例如「重试」）时，等后退完成再记入历史，
    // 否则那次后退会把新面板当成返回键关掉。
    const pending = navigationHold();
    if (pending) pending.then(remember); else remember();
  }
  requestAnimationFrame(() => {
    const target = panel.querySelector("[autofocus]") || panel.querySelector(".sheet-body " + FOCUSABLE) || closeButton || panel;
    if (target === panel) panel.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
  });
  return { close: entry.close, panel, body: bodyNode, footer: footNode };
}

// 手机底部面板：按住把手或标题栏向下拖动即可关闭，拖得不够远则弹回。
function enableSwipeDown(panel, close) {
  const handles = panel.querySelectorAll(".sheet-grip, .sheet-head");
  let startY = 0;
  let startTime = 0;
  let offset = 0;
  let pointer = null;
  const isBottomSheet = () => window.matchMedia?.("(max-width: 719px)").matches;
  const down = event => {
    if (event.pointerType === "mouse" || !isBottomSheet()) return;
    if (event.target instanceof Element && event.target.closest("button, a, input, textarea, select")) return;
    pointer = event.pointerId;
    startY = event.clientY;
    startTime = performance.now();
    offset = 0;
    try { event.currentTarget.setPointerCapture?.(pointer); } catch (_) {}
    panel.style.transition = "none";
    panel.style.animation = "none";
  };
  const move = event => {
    if (event.pointerId !== pointer) return;
    offset = Math.max(0, event.clientY - startY);
    panel.style.transform = `translateY(${offset}px)`;
  };
  const up = event => {
    if (event.pointerId !== pointer) return;
    pointer = null;
    const speed = offset / Math.max(1, performance.now() - startTime);
    panel.style.transition = "transform .22s cubic-bezier(.16, 1, .3, 1)";
    if (offset > 110 || (offset > 30 && speed > 0.6)) {
      panel.style.transform = "translateY(100%)";
      close();
    } else {
      panel.style.transform = "";
    }
  };
  handles.forEach(node => {
    node.addEventListener("pointerdown", down);
    node.addEventListener("pointermove", move);
    node.addEventListener("pointerup", up);
    node.addEventListener("pointercancel", up);
  });
}

// iOS 弹出键盘时只缩小可视区域，底部面板会被挡住；按键盘高度把面板往上推。
// Android（viewport 设了 interactive-widget=resizes-content）会直接缩小页面，此时算出的高度为 0。
function keepAboveKeyboard(overlay, entry) {
  const viewport = window.visualViewport;
  if (!viewport) return;
  const sync = () => {
    if (!document.body.contains(overlay)) {
      viewport.removeEventListener("resize", sync);
      viewport.removeEventListener("scroll", sync);
      return;
    }
    const covered = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
    overlay.style.paddingBottom = covered > 80 ? `${Math.round(covered)}px` : "";
    entry.panel.style.maxHeight = covered > 80 ? `${Math.round(viewport.height - 12)}px` : "";
  };
  viewport.addEventListener("resize", sync);
  viewport.addEventListener("scroll", sync);
}

export function closeAllSheets() {
  [...stack].reverse().forEach(entry => entry.close("route"));
}

export function confirmDialog({ title, message = "", confirmText = "确定", cancelText = "取消", danger = false, returnFocus = null } = {}) {
  return new Promise(resolve => {
    let decided = false;
    const done = value => {
      if (decided) return;
      decided = true;
      resolve(value);
      sheet.close("decided");
    };
    const confirm = h("button", { type: "button", class: ["btn", danger ? "btn-danger" : "btn-primary"], onClick: () => done(true) }, confirmText);
    const cancel = h("button", { type: "button", class: "btn btn-ghost", onClick: () => done(false) }, cancelText);
    const sheet = openSheet({
      title,
      body: message ? h("p", { class: "confirm-text" }, message) : null,
      footer: [cancel, confirm],
      onClose: () => { if (!decided) { decided = true; resolve(false); } },
      className: "sheet-confirm",
      returnFocus,
    });
    requestAnimationFrame(() => confirm.focus());
  });
}

// 下拉菜单：桌面锚定在按钮下方，手机变成底部动作面板。
export function openMenu(anchor, items, { head = null, align = "end" } = {}) {
  closeMenus();
  const menu = h("div", { class: "menu", role: "menu" });
  if (head) menu.append(head);
  items.filter(Boolean).forEach(item => {
    if (item === "sep") { menu.append(h("div", { class: "menu-sep", role: "separator" })); return; }
    const node = h(item.href ? "a" : "button", {
      class: "menu-item",
      role: "menuitem",
      type: item.href ? null : "button",
      href: item.href || null,
      onClick: event => {
        if (document.contains(anchor)) anchor.focus({ preventScroll: true });
        closeMenus();
        item.onSelect?.(event);
      },
    }, item.icon ? icon(item.icon) : null, h("span", null, item.label), item.meta ? h("span", { class: "menu-meta" }, item.meta) : null);
    menu.append(node);
  });
  document.body.append(menu);
  const rect = anchor.getBoundingClientRect();
  const width = menu.offsetWidth;
  const left = align === "end" ? Math.max(8, rect.right - width) : Math.min(window.innerWidth - width - 8, rect.left);
  menu.style.left = `${left}px`;
  menu.style.top = `${rect.bottom + 8}px`;
  anchor.setAttribute("aria-expanded", "true");
  const outside = event => {
    if (!menu.contains(event.target) && !anchor.contains(event.target)) closeMenus();
  };
  const key = event => {
    if (event.key === "Escape") { closeMenus(); anchor.focus(); }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const nodes = Array.from(menu.querySelectorAll(".menu-item"));
      const index = nodes.indexOf(document.activeElement);
      const next = event.key === "ArrowDown" ? nodes[(index + 1) % nodes.length] : nodes[(index - 1 + nodes.length) % nodes.length];
      next?.focus();
      event.preventDefault();
    }
  };
  setTimeout(() => {
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", key);
  }, 0);
  menu._cleanup = () => {
    document.removeEventListener("mousedown", outside);
    document.removeEventListener("keydown", key);
    anchor.setAttribute("aria-expanded", "false");
  };
  requestAnimationFrame(() => menu.querySelector(".menu-item")?.focus({ preventScroll: true }));
  return menu;
}

export function closeMenus() {
  document.querySelectorAll(".menu").forEach(menu => {
    menu._cleanup?.();
    menu.remove();
  });
}
