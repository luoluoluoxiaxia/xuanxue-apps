import { h, fill } from "../lib/dom.js?v=n42";
import { groupBookContents, groupReadingSections } from "../lib/books.js?v=n42";
import { local } from "../lib/store.js?v=n42";
import { openSheet } from "./overlay.js?v=n42";

export function renderBookContentsGroups(groups, renderItem, onToggle) {
  return groups.flatMap(group => group.kind === "appendix"
    ? h("details", { class: "book-contents-appendices", open: group.open, onToggle },
      h("summary", null, group.label || "版本附录", h("small", null, ` · ${group.items.length}`)), group.items.map(renderItem))
    : group.kind === "volume"
      ? h("details", { class: "book-contents-volume", open: group.open, onToggle },
        h("summary", null, group.label), group.items.map(renderItem))
      : group.items.map(renderItem));
}

// Native closed details can retain stale geometry. Check their ancestry rather
// than measuring hidden rows when choosing a keyboard destination.
export function bookContentsControls(rows) {
  return [...rows.querySelectorAll("button, summary")].filter(node => {
    for (let parent = node.parentElement; parent && parent !== rows; parent = parent.parentElement) {
      if (parent.tagName === "DETAILS" && !parent.open && !(node.tagName === "SUMMARY" && node.parentElement === parent)) return false;
    }
    return true;
  });
}

export function createBookSidebar({ book, contents, current, onSelect, onCollapse, libraryPath = "#/books", libraryLabel = "返回书库", casePath = "" }) {
  let closed = false, scrollFrame;
  const search = h("input", { type: "search", maxLength: 160, placeholder: "搜索目录或页码", "aria-label": "搜索目录" });
  search.value = local.get(`xz-book-directory-query:${book.id}`, "").slice(0, 160);
  const count = h("p", { class: "books-count", role: "status" });
  const rows = h("nav", { class: "book-contents-list", "aria-label": "章节列表" });
  const jump = h("input", { type: "number", min: 1, max: book.section_count, value: current, "aria-label": "跳转阅读页码", required: true });
  const go = h("form", { class: "book-page-jump", onSubmit: event => {
    event.preventDefault(); if (go.reportValidity()) onSelect(Number(jump.value));
  } }, h("label", null, "阅读页码", jump), h("button", { type: "submit", class: "btn btn-soft" }, "跳转"));
  const node = h("aside", { id: "book-directory-sidebar", class: "book-sidebar", "aria-label": `${book.title}目录`,
    onMouseDown: event => {
      const button = event.target.closest?.("button");
      if (event.button === 0 && button) { event.preventDefault(); button.focus({ preventScroll: true }); }
    } },
    h("div", { class: "book-sidebar-head" }, h("b", null, book.title),
      h("button", { type: "button", class: "book-sidebar-collapse", "aria-label": "收起目录", onClick: onCollapse }, "‹")),
    h("div", { class: "book-sidebar-links" }, h("a", { href: libraryPath }, libraryLabel),
      casePath ? h("a", { href: `#${casePath}` }, "本书案例") : null),
    h("div", { class: "book-contents-search" }, search, go, count), rows);
  function showRow(row, center = false) {
    if (!row || !rows.clientHeight) return;
    const rect = rows.getBoundingClientRect(), item = row.getBoundingClientRect();
    const top = item.top - rect.top + rows.scrollTop;
    if (center) rows.scrollTop = Math.max(0, top - Math.max(0, (rows.clientHeight - item.height) / 2));
    else if (item.top < rect.top) rows.scrollTop = top;
    else if (item.bottom > rect.bottom) rows.scrollTop += item.bottom - rect.bottom;
  }
  function refresh() {
    cancelAnimationFrame(scrollFrame);
    scrollFrame = requestAnimationFrame(() => {
      if (closed) return;
      if (search.value.trim()) rows.scrollTop = 0;
      else {
        const row = rows.querySelector('[aria-current="page"]');
        if (bookContentsControls(rows).includes(row)) showRow(row, true);
      }
    });
  }
  function paint() {
    local.set(`xz-book-directory-query:${book.id}`, search.value);
    const groups = groupBookContents(contents, search.value, current);
    const matches = groups.flatMap(group => group.items);
    count.textContent = `${matches.length} / ${contents.length} 项 · 当前 ${current}`;
    fill(rows, matches.length ? renderBookContentsGroups(groups, item => h("button", { type: "button", class: `book-contents-item${item.contents_depth === 1 ? " book-contents-subchapter" : ""}`,
      tabindex: -1, "aria-current": item.number === current ? "page" : null,
      onClick: () => onSelect(item.number), onFocus: event => {
        for (const button of rows.querySelectorAll("button")) button.tabIndex = button === event.currentTarget ? 0 : -1;
      } }, h("span", { class: "book-contents-number" }, item.number),
      h("span", null, h("b", null, item.display_title), item.contents_depth === undefined && item.title !== item.location && !["原书章节", "附录", "版本资料"].includes(item.location) ? h("small", null, item.location) : null),
      item.partial ? h("small", { class: "books-status" }, "有疑缺") : null), event => {
        const group = event.currentTarget;
        if (!group.open && group.contains(document.activeElement)) group.querySelector("summary")?.focus({ preventScroll: true });
        syncTabStop();
      })
      : h("p", { class: "books-notice" }, "没有匹配项，可按阅读页码跳转。"));
    syncTabStop();
    refresh();
  }
  function syncTabStop() {
    const visible = bookContentsControls(rows).filter(node => node.tagName === "BUTTON");
    const target = visible.find(node => node === document.activeElement) || visible.find(node => node.getAttribute("aria-current") === "page") || visible[0];
    for (const button of rows.querySelectorAll("button")) button.tabIndex = button === target ? 0 : -1;
  }
  rows.addEventListener("keydown", event => {
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    const buttons = bookContentsControls(rows), index = buttons.indexOf(document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
      : Math.max(0, Math.min(buttons.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
    buttons[next].focus({ preventScroll: true }); showRow(buttons[next]);
  });
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(refresh) : null;
  observer?.observe(rows);
  search.addEventListener("input", paint); paint();
  return { node, refresh, destroy() { closed = true; cancelAnimationFrame(scrollFrame); observer?.disconnect(); } };
}

export function openBookContents({ book, contents, current, onSelect, returnFocus, libraryPath = "#/books", libraryLabel = "返回书库", casePath = "" }) {
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
    h("div", { class: "book-contents-links" },
      h("a", { class: "book-contents-library", href: libraryPath }, libraryLabel),
      casePath ? h("a", { href: `#${casePath}` }, "本书案例") : null));
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
      if (search.value.trim() || !row || !bookContentsControls(rows).includes(row)) { rows.scrollTop = 0; return; }
      // 只滚动目录容器，避免 scrollIntoView 把其下的阅读正文一起移走。
      const rect = rows.getBoundingClientRect();
      const scale = rows.offsetHeight ? rect.height / rows.offsetHeight : 1;
      const top = (row.getBoundingClientRect().top - rect.top) / (scale || 1) + rows.scrollTop;
      rows.scrollTop = Math.max(0, top - Math.max(0, (rows.clientHeight - row.offsetHeight) / 2));
    });
  }
  function paint() {
    const groups = groupBookContents(contents, search.value, current);
    const matches = groups.flatMap(group => group.items);
    count.textContent = `${matches.length} / ${contents.length} 项 · 当前第 ${current} ${book.has_modern ? "篇" : "页"}`;
    fill(rows, matches.length ? renderBookContentsGroups(groups, item => h("button", { type: "button", class: `book-contents-item${item.contents_depth === 1 ? " book-contents-subchapter" : ""}`,
      "aria-current": item.number === current ? "page" : null,
      onClick: () => { sheet.close(); onSelect(item.number); } },
      h("span", { class: "book-contents-number" }, item.number),
      h("span", null, h("b", null, item.display_title), item.contents_depth === undefined && item.title !== item.location && !["原书章节", "附录", "版本资料"].includes(item.location) ? h("small", null, item.location) : null),
      item.partial ? h("small", { class: "books-status" }, "有疑缺") : null), syncHiddenButtons) : h("p", { class: "books-notice" }, "没有匹配项，可直接按阅读页码跳转。"));
    syncHiddenButtons();
    positionContents();
  }
  function syncHiddenButtons() {
    const visible = new Set(bookContentsControls(rows));
    for (const button of rows.querySelectorAll("button")) button.tabIndex = visible.has(button) ? 0 : -1;
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

export function openElectronicBookContents({ bookTitle, sections, current, onSelect, returnFocus }) {
  const readingY = window.scrollY;
  const search = h("input", { type: "search", maxLength: 160, placeholder: "搜索章节标题或来源页", "aria-label": "搜索章节目录" });
  const count = h("p", { class: "books-count", role: "status", "aria-live": "polite" });
  const rows = h("nav", { class: "book-contents-list", "aria-label": "章节列表" });
  let closed = false, selected = false, scrollFrame, rowsObserver;
  const sheet = openSheet({ title: `${bookTitle} · 目录`, className: "sheet-book-contents", returnFocus,
    body: [h("div", { class: "book-contents-search" }, search, count), rows],
    onClose: reason => {
      closed = true; cancelAnimationFrame(scrollFrame); rowsObserver?.disconnect();
      if (!selected && reason !== "route") window.scrollTo(0, readingY);
    } });
  function positionContents() {
    cancelAnimationFrame(scrollFrame);
    scrollFrame = requestAnimationFrame(() => {
      if (closed) return;
      const row = rows.querySelector('[aria-current="page"]');
      if (search.value.trim() || !row) { rows.scrollTop = 0; return; }
      const rect = rows.getBoundingClientRect();
      const scale = rows.offsetHeight ? rect.height / rows.offsetHeight : 1;
      const top = (row.getBoundingClientRect().top - rect.top) / (scale || 1) + rows.scrollTop;
      rows.scrollTop = Math.max(0, top - Math.max(0, (rows.clientHeight - row.offsetHeight) / 2));
    });
  }
  function paint() {
    const groups = groupReadingSections(sections, search.value);
    const matches = groups.reduce((total, group) => total + group.sections.length, 0);
    count.textContent = `${matches} / ${sections.length} 节`;
    fill(rows, groups.length ? groups.map(group => h("section", { class: "book-electronic-sheet-group" },
      h("h3", null, group.title, h("small", null, ` · ${group.sections.length}`)),
      group.sections.map(item => h("button", { type: "button", class: "book-contents-item", "aria-current": item.id === current ? "page" : null,
        onClick: () => { selected = true; sheet.close(); onSelect(item.id); } },
        h("span", { class: "book-electronic-contents-label" }, h("b", null, item.title),
          item.source_location && item.source_location !== item.title && item.source_location !== "原书章节" ? h("small", null, item.source_location) : null),
        item.id === current ? h("small", null, "正在阅读") : null))))
      : h("p", { class: "books-notice", role: "status" }, "没有匹配的章节，试试其他标题或清空搜索。"));
    positionContents();
  }
  if (typeof ResizeObserver === "function") {
    rowsObserver = new ResizeObserver(() => { if (!search.value.trim()) positionContents(); });
    rowsObserver.observe(rows);
  }
  search.addEventListener("input", paint); paint();
  requestAnimationFrame(() => { if (!closed) search.focus({ preventScroll: true }); });
  return sheet;
}

export function openBookSettings({ preferences, mode, hasModern, hasLayout = true, hasPunctuation = false, onChange, onClose, returnFocus }) {
  const prefs = { ...preferences };
  function field(label, key, options) {
    const select = h("select", { "aria-label": label, onChange: event => {
      if (key === "mode") mode = event.target.value;
      else prefs[key] = ["size", "line"].includes(key) ? Number(event.target.value) : event.target.value;
      onChange(prefs, mode);
    } }, options.map(([value, text]) => h("option", { value, selected: value === (key === "mode" ? mode : prefs[key]) }, text)));
    return h("label", null, h("span", null, label), select);
  }
  return openSheet({ title: "阅读设置", className: "sheet-book-settings", returnFocus, onClose,
    body: h("div", { class: "book-settings" },
      hasModern ? field("阅读模式", "mode", [["original", "原文"], ["parallel", "原文与白话"], ["modern", "白话"]]) : null,
      hasPunctuation ? field("句读", "punctuation", [["punctuated", "整理句读"], ["source", "原稿句读"]]) : null,
      hasLayout ? field("排版", "layout", [["continuous", "连续排版"], ["source", "保留原稿换行"]]) : null,
      hasLayout ? h("p", { class: "books-notice" }, "连续排版的正文按屏幕宽度换行，诗诀与表格保留原结构。")
        : h("p", { class: "books-notice" }, "正文随屏幕宽度换行，诗诀、卦图与表格保留原稿结构。"),
      field("字号", "size", [[18, "较小 · 18"], [20, "标准 · 20"], [22, "较大 · 22"], [24, "大字 · 24"]]),
      field("行距", "line", [[1.8, "紧凑"], [2, "舒适"], [2.2, "宽松"]]),
      field("字体", "font", [["serif", "宋体"], ["sans", "黑体"]]),
      field("纸张", "paper", [["white", "默认"], ["warm", "暖色纸张"]]),
      h("p", { class: "books-notice" }, "设置与阅读位置保存在当前浏览器。夜间阅读可使用网站顶部的深色模式。")) });
}
