// DOM 工具：零构建环境下创建元素、转义文本与事件委托。
// 所有来自接口的文本都以 textContent 或 esc() 写入，不直接拼接未转义的 HTML。

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]
  ));
}

function appendChildren(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === true) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

// h("button", { class: "btn", onClick }, "文本", childNode)
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === "class") el.className = Array.isArray(value) ? value.filter(Boolean).join(" ") : String(value);
      else if (key === "dataset") Object.assign(el.dataset, value);
      else if (key === "style" && typeof value === "object") {
        for (const [name, v] of Object.entries(value)) {
          if (name.startsWith("--")) el.style.setProperty(name, v);
          else el.style[name] = v;
        }
      } else if (key === "html") el.innerHTML = value;
      else if (key === "text") el.textContent = value;
      else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2).toLowerCase(), value);
      else if (key === "value" && "value" in el) el.value = value;
      else el.setAttribute(key, value === true ? "" : String(value));
    }
  }
  appendChildren(el, children);
  return el;
}

export function frag(...children) {
  const fragment = document.createDocumentFragment();
  appendChildren(fragment, children);
  return fragment;
}

export function svg(markup) {
  const template = document.createElement("template");
  template.innerHTML = markup.trim();
  return template.content.firstElementChild;
}

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

// 事件委托：on(root, "click", "[data-like]", (event, target) => …)
export function on(root, type, selector, handler, options) {
  const listener = event => {
    const target = event.target instanceof Element ? event.target.closest(selector) : null;
    if (target && root.contains(target)) handler(event, target);
  };
  root.addEventListener(type, listener, options);
  return () => root.removeEventListener(type, listener, options);
}

export function mount(container, ...children) {
  container.replaceChildren();
  appendChildren(container, children);
  return container;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

export function autoGrow(textarea, max = 220) {
  const fit = () => {
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(max, textarea.scrollHeight + 2)}px`;
  };
  textarea.addEventListener("input", fit);
  requestAnimationFrame(fit);
  return fit;
}

// 在元素进入视口时触发一次（无限加载、懒渲染）。
export function whenVisible(element, callback, rootMargin = "600px 0px") {
  if (!("IntersectionObserver" in window)) {
    callback();
    return () => {};
  }
  const observer = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) callback();
  }, { rootMargin });
  observer.observe(element);
  return () => observer.disconnect();
}

export const coarsePointer = () => window.matchMedia?.("(pointer: coarse)").matches === true;

// 输入框回车行为（中文输入法选词时的回车从不触发发送）：
// - "chat"：回车发送、Shift+回车换行，手机键盘的回车键显示为「发送」；
// - "compose"：回车换行，Ctrl/⌘+回车发送（长评论、正文）。
export function submitOnEnter(field, submit, { mode = "chat" } = {}) {
  field.setAttribute("enterkeyhint", mode === "chat" ? "send" : "enter");
  const listener = event => {
    if (event.key !== "Enter" || event.isComposing || event.keyCode === 229) return;
    const modifier = event.metaKey || event.ctrlKey;
    if (modifier || (mode === "chat" && !event.shiftKey)) {
      event.preventDefault();
      submit();
    }
  };
  field.addEventListener("keydown", listener);
  return () => field.removeEventListener("keydown", listener);
}
