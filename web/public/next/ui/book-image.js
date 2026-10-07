import { h } from "../lib/dom.js?v=n16";
import { imageTransform } from "../lib/books.js?v=n16";
import { openSheet } from "./overlay.js?v=n16";

export function openBookImage(figure, title, returnFocus) {
  const readingY = window.scrollY;
  let transform = { scale: 1, x: 0, y: 0 };
  let size = { width: 1, height: 1, stageWidth: 1, stageHeight: 1 };
  let ready = false;
  const pointers = new Map();
  const status = h("p", { class: "book-image-status", role: "status" }, "正在打开书影…");
  const image = h("img", { alt: title, draggable: "false", width: figure.width, height: figure.height });
  const stage = h("div", { class: "book-image-stage", tabindex: "0", "aria-label": "书影区域，可拖动或双指缩放" }, image, status);
  const percent = h("output", { "aria-label": "书影放大倍数" }, "100%");
  const zoomOut = h("button", { type: "button", class: "btn btn-soft", "aria-label": "缩小书影", onClick: () => zoom(transform.scale / 1.4) }, "−");
  const zoomIn = h("button", { type: "button", class: "btn btn-soft", "aria-label": "放大书影", onClick: () => zoom(transform.scale * 1.4) }, "+");
  const reset = h("button", { type: "button", class: "btn btn-soft", onClick: () => zoom(1) }, "适合屏幕");
  const retry = h("button", { type: "button", class: "btn btn-soft", hidden: true, onClick: load }, "重新加载书影");
  const tools = h("div", { class: "book-image-tools" }, zoomOut, percent, zoomIn, reset, retry);
  const sheet = openSheet({ title, className: "sheet-book-image", returnFocus,
    body: [stage, tools, h("p", { class: "book-image-help" }, "拖动查看 · 滚轮或双指缩放 · 双击放大 · Esc / 返回关闭"),
      h("p", { class: "book-image-caption" }, figure.caption)],
    onClose: reason => {
      resize.disconnect(); document.removeEventListener("keydown", keyboard); pointers.clear();
      if (reason !== "route") window.scrollTo(0, readingY);
    },
  });

  function paint() {
    image.style.transform = `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`;
    percent.textContent = `${Math.round(transform.scale * 100)}%`;
    stage.classList.toggle("is-zoomed", transform.scale > 1);
    zoomOut.disabled = !ready || transform.scale <= 1;
    zoomIn.disabled = !ready || transform.scale >= 8;
    reset.disabled = !ready;
  }
  function zoom(scale, point = { x: 0, y: 0 }) {
    if (!ready) return;
    transform = imageTransform(transform, scale, point, size); paint();
  }
  function measure() {
    const rect = stage.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const fit = Math.min((rect.width - 24) / figure.width, (rect.height - 24) / figure.height);
    size = { width: figure.width * fit, height: figure.height * fit, stageWidth: rect.width, stageHeight: rect.height };
    image.style.width = `${size.width}px`; image.style.height = `${size.height}px`;
    transform = imageTransform(transform, transform.scale, { x: 0, y: 0 }, size); paint();
  }
  function load() {
    ready = false; image.hidden = true; retry.hidden = true; status.hidden = false;
    status.textContent = "正在打开书影…"; paint();
    image.src = figure.url;
  }
  image.addEventListener("load", () => { ready = true; image.hidden = false; status.hidden = true; measure(); });
  image.addEventListener("error", () => { ready = false; image.hidden = true; status.hidden = false;
    status.textContent = "书影未能加载，关闭后仍可查看本页转写。"; retry.hidden = false; paint(); });
  const resize = new ResizeObserver(measure); resize.observe(stage);
  function point(event) {
    const rect = stage.getBoundingClientRect();
    return { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 };
  }
  stage.addEventListener("wheel", event => {
    if (!ready) return;
    event.preventDefault(); zoom(transform.scale * Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * .006), point(event));
  }, { passive: false });
  stage.addEventListener("dblclick", event => { event.preventDefault(); zoom(transform.scale > 1 ? 1 : 3, point(event)); });
  stage.addEventListener("pointerdown", event => {
    if (!ready || event.button > 0) return;
    event.preventDefault(); stage.focus({ preventScroll: true });
    pointers.set(event.pointerId, point(event)); stage.setPointerCapture(event.pointerId);
  });
  stage.addEventListener("pointermove", event => {
    if (!pointers.has(event.pointerId)) return;
    const before = [...pointers.values()].slice(0, 2);
    const old = pointers.get(event.pointerId); const next = point(event);
    pointers.set(event.pointerId, next);
    if (before.length === 2) {
      const after = [...pointers.values()].slice(0, 2);
      const middle = points => ({ x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 });
      const distance = points => Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      const a = middle(before), b = middle(after);
      transform = imageTransform(transform, transform.scale * distance(after) / Math.max(1, distance(before)), a, size);
      transform.x += b.x - a.x; transform.y += b.y - a.y;
    } else { transform.x += next.x - old.x; transform.y += next.y - old.y; }
    transform = imageTransform(transform, transform.scale, { x: 0, y: 0 }, size); paint();
  });
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) stage.addEventListener(name, event => pointers.delete(event.pointerId));
  function keyboard(event) {
    if (!ready || event.altKey || event.ctrlKey || event.metaKey || !sheet.panel.contains(event.target)) return;
    if (["+", "="].includes(event.key)) zoom(transform.scale * 1.4);
    else if (event.key === "-") zoom(transform.scale / 1.4);
    else if (event.key === "0") zoom(1);
    else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      transform.x += event.key === "ArrowLeft" ? 60 : event.key === "ArrowRight" ? -60 : 0;
      transform.y += event.key === "ArrowUp" ? 60 : event.key === "ArrowDown" ? -60 : 0;
      transform = imageTransform(transform, transform.scale, { x: 0, y: 0 }, size); paint();
    } else return;
    event.preventDefault();
  }
  document.addEventListener("keydown", keyboard);
  load();
  return sheet;
}
