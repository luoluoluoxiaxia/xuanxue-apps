import { h, fill } from "../lib/dom.js?v=n12";
import { filterContents } from "../lib/books.js?v=n12";
import { openSheet } from "./overlay.js?v=n12";

export function openBookContents({ book, contents, current, onSelect, returnFocus }) {
  const readingY = window.scrollY;
  const search = h("input", { type: "search", placeholder: "搜索标题、来源页，或输入阅读页码", "aria-label": "搜索目录" });
  const count = h("p", { class: "books-count", role: "status" });
  const rows = h("div", { class: "book-contents-list" });
  const jump = h("input", { type: "number", min: 1, max: book.section_count, value: current, "aria-label": "跳转阅读页码", required: true });
  const go = h("form", { class: "book-page-jump", onSubmit: event => {
    event.preventDefault(); if (!go.reportValidity()) return;
    sheet.close(); onSelect(Number(jump.value));
  } }, h("label", null, `阅读页码（1–${book.section_count}）`, jump), h("button", { type: "submit", class: "btn btn-soft" }, "跳转"));
  const sheet = openSheet({ title: `${book.title} · ${book.has_modern ? "目录" : "书页"}`, className: "sheet-book-contents", returnFocus,
    body: [h("div", { class: "book-contents-search" }, search, go, count), rows],
    onClose: reason => { if (reason !== "route") window.scrollTo(0, readingY); } });
  function paint() {
    const matches = filterContents(contents, search.value);
    count.textContent = `${matches.length} / ${contents.length} 项 · 当前第 ${current} ${book.has_modern ? "篇" : "页"}`;
    fill(rows, matches.length ? matches.map(item => h("button", { type: "button", class: "book-contents-item",
      "aria-current": item.number === current ? "page" : null,
      onClick: () => { sheet.close(); onSelect(item.number); } },
      h("span", { class: "book-contents-number" }, item.number),
      h("span", null, h("b", null, item.title), item.title !== item.location ? h("small", null, item.location) : null),
      item.partial ? h("small", { class: "books-status" }, "有疑缺") : null)) : h("p", { class: "books-notice" }, "没有匹配项，可直接按阅读页码跳转。"));
  }
  search.addEventListener("input", paint); paint();
  requestAnimationFrame(() => search.focus({ preventScroll: true }));
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
      field("字号", "size", [[18, "较小 · 18"], [20, "标准 · 20"], [22, "较大 · 22"], [24, "大字 · 24"]]),
      field("行距", "line", [[1.8, "紧凑"], [2, "舒适"], [2.2, "宽松"]]),
      field("字体", "font", [["serif", "宋体"], ["sans", "黑体"]]),
      field("纸张", "paper", [["white", "默认"], ["warm", "暖色纸张"]]),
      h("p", { class: "books-notice" }, "设置与阅读位置保存在当前浏览器。夜间阅读可使用网站顶部的深色模式。")) });
}
