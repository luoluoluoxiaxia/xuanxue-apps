import { h, fill } from "../lib/dom.js?v=n14";
import { filterContents } from "../lib/books.js?v=n14";
import { openSheet } from "./overlay.js?v=n14";

export function openBookContents({ book, contents, current, onSelect, returnFocus }) {
  const readingY = window.scrollY;
  const search = h("input", { type: "search", placeholder: "搜索标题、来源页，或输入阅读页码", "aria-label": "搜索目录" });
  const count = h("p", { class: "books-count", role: "status" });
  const rows = h("div", { class: "book-contents-list" });
  let closed = false;
  let scrollFrame;
  let rowsObserver;
  const jump = h("input", { type: "number", min: 1, max: book.section_count, value: current, "aria-label": "跳转阅读页码", required: true });
  const go = h("form", { class: "book-page-jump", onSubmit: event => {
    event.preventDefault(); if (!go.reportValidity()) return;
    sheet.close(); onSelect(Number(jump.value));
  } }, h("label", null, `阅读页码（1–${book.section_count}）`, jump), h("button", { type: "submit", class: "btn btn-soft" }, "跳转"));
  const searchArea = h("div", { class: "book-contents-search" }, search, go, count,
    h("a", { class: "book-contents-library", href: "#/books" }, "返回书库"));
  const sheet = openSheet({ title: `${book.title} · ${book.has_modern ? "目录" : "书页"}`, className: "sheet-book-contents", returnFocus,
    body: [searchArea, rows],
    onClose: reason => {
      closed = true; cancelAnimationFrame(scrollFrame);
      rowsObserver?.disconnect();
      if (reason !== "route") window.scrollTo(0, readingY);
    } });
  function positionContents() {
    cancelAnimationFrame(scrollFrame);
    scrollFrame = requestAnimationFrame(() => {
      if (closed) return;
      const row = rows.querySelector('[aria-current="page"]');
      if (search.value.trim() || !row) { rows.scrollTop = 0; return; }
      // 只滚动目录容器，避免 scrollIntoView 把其下的阅读正文一起移走。
      const rect = rows.getBoundingClientRect();
      const scale = rows.offsetHeight ? rect.height / rows.offsetHeight : 1;
      const top = (row.getBoundingClientRect().top - rect.top) / (scale || 1) + rows.scrollTop;
      rows.scrollTop = Math.max(0, top - Math.max(0, (rows.clientHeight - row.offsetHeight) / 2));
    });
  }
  function paint() {
    const matches = filterContents(contents, search.value);
    count.textContent = `${matches.length} / ${contents.length} 项 · 当前第 ${current} ${book.has_modern ? "篇" : "页"}`;
    fill(rows, matches.length ? matches.map(item => h("button", { type: "button", class: "book-contents-item",
      "aria-current": item.number === current ? "page" : null,
      onClick: () => { sheet.close(); onSelect(item.number); } },
      h("span", { class: "book-contents-number" }, item.number),
      h("span", null, h("b", null, item.title), item.title !== item.location ? h("small", null, item.location) : null),
      item.partial ? h("small", { class: "books-status" }, "有疑缺") : null)) : h("p", { class: "books-notice" }, "没有匹配项，可直接按阅读页码跳转。"));
    positionContents();
  }
  // 手机搜索框唤起键盘后，目录可视高度会改变；空搜索仍保持当前页可见。
  if (typeof ResizeObserver === "function") {
    rowsObserver = new ResizeObserver(() => { if (!search.value.trim()) positionContents(); });
    rowsObserver.observe(rows);
  }
  search.addEventListener("input", paint); paint();
  requestAnimationFrame(() => { if (!closed) search.focus({ preventScroll: true }); });
  return sheet;
}

export function openBookSettings({ preferences, mode, hasModern, onChange, returnFocus }) {
  const prefs = { ...preferences };
  function field(label, key, options) {
    const select = h("select", { "aria-label": label, onChange: event => {
      if (key === "mode") mode = event.target.value;
      else prefs[key] = ["size", "line"].includes(key) ? Number(event.target.value) : event.target.value;
      onChange(prefs, mode);
    } }, options.map(([value, text]) => h("option", { value, selected: value === (key === "mode" ? mode : prefs[key]) }, text)));
    return h("label", null, h("span", null, label), select);
  }
  return openSheet({ title: "阅读设置", className: "sheet-book-settings", returnFocus,
    body: h("div", { class: "book-settings" },
      hasModern ? field("阅读模式", "mode", [["original", "原文"], ["parallel", "原文与白话"], ["modern", "白话"]]) : null,
      field("排版", "layout", [["continuous", "连续排版"], ["source", "保留原稿换行"]]),
      h("p", { class: "books-notice" }, "连续排版的正文按屏幕宽度换行，诗诀与表格保留原结构。"),
      field("字号", "size", [[18, "较小 · 18"], [20, "标准 · 20"], [22, "较大 · 22"], [24, "大字 · 24"]]),
      field("行距", "line", [[1.8, "紧凑"], [2, "舒适"], [2.2, "宽松"]]),
      field("字体", "font", [["serif", "宋体"], ["sans", "黑体"]]),
      field("纸张", "paper", [["white", "默认"], ["warm", "暖色纸张"]]),
      h("p", { class: "books-notice" }, "设置与阅读位置保存在当前浏览器。夜间阅读可使用网站顶部的深色模式。")) });
}
