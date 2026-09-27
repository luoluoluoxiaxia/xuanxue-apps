// 浮层：桌面为居中对话框，手机为底部面板；统一处理焦点、Esc、背景滚动锁与层叠。
import { h } from "../lib/dom.js?v=n1";
import { icon } from "../lib/icons.js?v=n1";

const stack = [];
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

export function openSheet({ title = "", body, footer = null, wide = false, dismissible = true, onClose, label, className = "" } = {}) {
  const returnFocus = document.activeElement;
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
    close(reason = "close") {
      if (closed) return;
      closed = true;
      const index = stack.indexOf(entry);
      if (index >= 0) stack.splice(index, 1);
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
  stack.push(entry);
  lockScroll();
  document.body.append(overlay);
  requestAnimationFrame(() => {
    const target = panel.querySelector("[autofocus]") || panel.querySelector(".sheet-body " + FOCUSABLE) || closeButton || panel;
    if (target === panel) panel.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
  });
  return { close: entry.close, panel, body: bodyNode, footer: footNode };
}

export function closeAllSheets() {
  [...stack].reverse().forEach(entry => entry.close("route"));
}

export function confirmDialog({ title, message = "", confirmText = "确定", cancelText = "取消", danger = false } = {}) {
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
      onClick: event => { closeMenus(); item.onSelect?.(event); },
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
