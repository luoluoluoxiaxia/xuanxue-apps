import { h, fill } from "../lib/dom.js?v=n9";
import { icon } from "../lib/icons.js?v=n9";
import { get } from "../lib/api.js?v=n9";
import { local } from "../lib/store.js?v=n9";
import { createKnowledgeLoader } from "../lib/knowledge.js?v=n9";
import { BOOK_STATUS, BOOK_SYSTEM, readingPath, readingNumber, filterBooks } from "../lib/books.js?v=n9";
import { errorView, stateView } from "../ui/bits.js?v=n9";

const progressKey = id => `xz-book-progress:${id}`;

function lifecycle(ctx, paint) {
  const loader = createKnowledgeLoader(state => { if (ctx.isCurrent()) paint(state); });
  let refresh = () => {};
  const reconnect = () => refresh();
  window.addEventListener("online", reconnect);
  ctx.cleanup(() => { loader.destroy(); window.removeEventListener("online", reconnect); });
  return { loader, setRefresh(fn) { refresh = fn; ctx.onRefresh(fn); } };
}

function library(ctx) {
  let books = [];
  const results = h("div", { class: "books-grid" });
  const count = h("p", { class: "books-count", role: "status", "aria-live": "polite" });
  const search = h("input", { type: "search", placeholder: "搜索书名", "aria-label": "搜索书名" });
  const system = h("select", { "aria-label": "筛选典籍体系" }, h("option", { value: "" }, "全部体系"),
    Object.entries(BOOK_SYSTEM).map(([value, label]) => h("option", { value }, label)));
  const node = h("div", { class: "books-library" },
    h("header", { class: "books-hero" }, h("p", { class: "kicker" }, "典籍研读"), h("h1", null, "典籍书库"),
      h("p", null, "打开原文，循着书页读下去。已整理的白话与校记随文保留。")),
    h("div", { class: "books-filters" }, search, system), count, results);
  function paintBooks() {
    const rows = filterBooks(books, search.value, system.value);
    count.textContent = `共 ${rows.length} 本 · ${rows.filter(book => book.section_count > 0).length} 本可阅读`;
    fill(results, rows.length ? rows.map(book => {
      const available = book.section_count > 0;
      const progress = readingNumber(local.get(progressKey(book.id), "1"), book.section_count);
      return h("article", { class: "books-card" },
        h("div", { class: "books-card-meta" }, h("span", null, BOOK_SYSTEM[book.system]),
          h("span", { class: "books-status" }, BOOK_STATUS[book.status])),
        h("h2", null, book.title), h("p", { class: "books-source" }, book.source_label),
        h("p", { class: "books-notice" }, book.notice),
        available ? h("a", { class: "btn btn-soft", href: `#${readingPath(book.id, progress)}` },
          icon("book"), progress > 1 ? "继续阅读" : "打开书籍", h("span", null, `${book.section_count} ${book.has_modern ? "篇" : "页"}`))
          : h("p", { class: "books-unavailable" }, "电子成品待恢复"));
    }) : stateView({ glyph: "search", title: "没有匹配的书籍", text: "试试其他书名，或切换体系。" }));
  }
  search.addEventListener("input", paintBooks);
  system.addEventListener("change", paintBooks);
  const life = lifecycle(ctx, ({ phase, data, error }) => {
    results.setAttribute("aria-busy", String(phase === "loading"));
    if (phase === "loading") { fill(results, h("p", { role: "status" }, "正在打开书库…")); return; }
    if (phase === "error") { fill(results, errorView(error, refresh, { title: "书库暂时没有打开" })); return; }
    books = data.books;
    paintBooks();
  });
  const refresh = () => life.loader.load("/api/books");
  life.setRefresh(refresh); refresh();
  return { node, title: "典籍书库" };
}

function reader(ctx) {
  const id = ctx.params.id;
  let book = null;
  let activeSection = null;
  let mode = local.get("xz-book-mode", "original");
  let controller = new AbortController();
  const content = h("div", { class: "book-reading-content", "aria-live": "polite" });
  const controls = h("div", { class: "book-reading-controls" });
  const pagination = h("nav", { class: "book-reading-pagination", "aria-label": "正文翻页" });
  const heading = h("header", { class: "book-reading-header" });
  const node = h("div", { class: "book-reading" },
    h("a", { class: "back-link", href: "#/books" }, icon("back"), "典籍书库"), heading, controls, content, pagination);

  function paintSection() {
    if (!activeSection) return;
    const section = activeSection;
    content.dataset.mode = book.has_modern ? mode : "original";
    fill(content,
      h("header", { class: "book-section-header" }, h("p", { class: "books-source" }, section.location), h("h2", null, section.title)),
      section.partial || section.notice ? h("aside", { class: "book-page-notice" },
        section.partial ? h("strong", null, "本页有疑缺或顺序待核。") : null,
        section.notice ? h("p", null, section.notice) : null) : null,
      section.blocks.length ? section.blocks.map(block => h("section", { class: `book-block book-role-${block.role}` },
        h("div", { class: "book-original", lang: "zh-Hant" },
          ["note", "commentary"].includes(block.role) ? h("span", { class: "book-layer" }, block.role === "note" ? "原注" : "评注") : null,
          h(block.role === "heading" ? "h3" : "p", null, block.text)),
        block.modern ? h("div", { class: "book-modern", lang: "zh-Hans" }, h("span", { class: "book-layer" }, "白话"), h("p", null, block.modern)) : null,
        block.notes.length ? h("details", { class: "book-notes" }, h("summary", null, `校记与说明 · ${block.notes.length}`),
          block.notes.map(note => h("p", null, note))) : null)) : h("p", null, "本页没有录文，保留此页的来源位置。"));
    fill(pagination,
      section.number > 1 ? h("a", { class: "btn btn-soft", rel: "prev", href: `#${readingPath(id, section.number - 1)}` }, "上一页") : h("span"),
      h("span", null, `${section.number} / ${book.section_count}`),
      section.number < book.section_count ? h("a", { class: "btn btn-soft", rel: "next", href: `#${readingPath(id, section.number + 1)}` }, "下一页") : h("span"));
    local.set(progressKey(id), String(section.number));
  }
  async function openSection(number) {
    controller.abort(); controller = new AbortController();
    fill(content, h("p", { role: "status" }, "正在打开正文…"));
    fill(pagination);
    try {
      const section = await get(`/api/books/${encodeURIComponent(id)}/sections/${number}`, { signal: controller.signal });
      if (!ctx.isCurrent()) return;
      activeSection = section; paintSection();
    } catch (error) {
      if (!ctx.isCurrent() || error?.name === "AbortError") return;
      fill(content, errorView(error, () => openSection(number), { title: "这一页暂时没有打开" }));
    }
  }
  ctx.cleanup(() => controller.abort());
  const life = lifecycle(ctx, ({ phase, data, error }) => {
    if (phase === "loading") { fill(content, h("p", { role: "status" }, "正在打开书籍…")); return; }
    if (phase === "error") { fill(content, errorView(error, refresh, { title: "这本书暂时没有打开" })); return; }
    book = data.book;
    ctx.setTitle(`${book.title} · 典籍书库`);
    fill(heading, h("p", { class: "kicker" }, `${BOOK_SYSTEM[book.system]} · ${BOOK_STATUS[book.status]}`),
      h("h1", null, book.title), h("p", { class: "books-source" }, book.source_label), h("p", { class: "books-notice" }, book.notice));
    if (!book.section_count) { fill(content, h("p", null, "电子成品待恢复，请先阅读其他书籍。")); return; }
    const number = readingNumber(ctx.query.get("page") || local.get(progressKey(id), "1"), book.section_count);
    const select = h("select", { "aria-label": "选择章节或来源页", onChange: event => ctx.navigate(readingPath(id, Number(event.target.value))) },
      data.contents.map(item => h("option", { value: item.number, selected: item.number === number }, `${item.number}. ${item.title}${item.partial ? " · 有疑缺" : ""}`)));
    const modes = book.has_modern ? h("select", { "aria-label": "阅读模式", onChange: event => {
      mode = event.target.value; local.set("xz-book-mode", mode); paintSection();
    } }, [["original", "原文"], ["parallel", "原文与白话"], ["modern", "白话"]].map(([value, label]) =>
      h("option", { value, selected: mode === value }, label))) : null;
    fill(controls, h("label", null, "目录", select), modes ? h("label", null, "显示", modes) : null);
    openSection(number);
  });
  const refresh = () => life.loader.load(`/api/books/${encodeURIComponent(id)}`);
  life.setRefresh(refresh); refresh();
  return { node, title: "典籍阅读" };
}

export function render(ctx) { return ctx.params.id ? reader(ctx) : library(ctx); }
