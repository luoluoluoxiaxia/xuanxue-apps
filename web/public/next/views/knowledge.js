// 典籍知识馆：阅读整理后的书籍导读、案例与名词，保留可核对的书籍出处。
import { h, fill } from "../lib/dom.js?v=n13";
import { icon } from "../lib/icons.js?v=n13";
import {
  KNOWLEDGE_KINDS, KNOWLEDGE_SYSTEMS, readKnowledgeQuery, knowledgeListPath,
  knowledgeEntryPath, knowledgeKindLabel, knowledgeSystemLabel, knowledgeApiPath,
  sourceLocation, createKnowledgeLoader,
} from "../lib/knowledge.js?v=n13";
import { stateView, errorView, spinnerLine } from "../ui/bits.js?v=n13";

function entryLink(entry, className = "") {
  return h("a", { href: `#${knowledgeEntryPath(entry.id)}`, class: className }, entry.title);
}

function entryMeta(entry) {
  return h("div", { class: "knowledge-meta" },
    h("span", { class: "knowledge-kind" }, knowledgeKindLabel(entry.kind)),
    h("span", null, knowledgeSystemLabel(entry.system)));
}

function tags(entry) {
  return h("div", { class: "knowledge-tags" }, (entry.tags || []).map(tag => h("span", null, tag)));
}

function sourceLinks(sources, { detailed = false } = {}) {
  return h("ul", { class: detailed ? "knowledge-sources" : "knowledge-card-sources" }, sources.map(source =>
    h("li", null,
      h("a", { href: `#${knowledgeEntryPath(source.book_id)}` }, `《${source.book_title}》`),
      detailed && sourceLocation(source) ? h("span", null, sourceLocation(source)) : null)));
}

function card(entry) {
  const sources = (entry.sources || []).filter((source, index, all) =>
    all.findIndex(other => other.book_id === source.book_id) === index);
  return h("article", { class: `knowledge-card knowledge-card-${entry.kind}` },
    entryMeta(entry),
    h("h2", null, entryLink(entry)),
    h("p", { class: "knowledge-card-summary" }, entry.summary),
    tags(entry),
    h("div", { class: "knowledge-card-foot" },
      entry.kind === "book"
        ? h("a", { class: "knowledge-book-browse", href: `#${knowledgeEntryPath(entry.id)}` }, "阅读书籍导读", icon("arrowRight"))
        : sourceLinks(sources),
      h("a", { class: "knowledge-read", href: `#${knowledgeEntryPath(entry.id)}`, "aria-label": `阅读${entry.title}` }, icon("arrowRight"))));
}

function attachLoader(ctx, path, paint) {
  let phase = "loading";
  const loader = createKnowledgeLoader(state => {
    if (!ctx.isCurrent()) return;
    phase = state.phase;
    paint(state);
  });
  const refresh = () => loader.load(path);
  const reconnect = () => { if (phase === "error") refresh(); };
  window.addEventListener("online", reconnect);
  ctx.cleanup(() => { loader.destroy(); window.removeEventListener("online", reconnect); });
  ctx.onRefresh(refresh);
  return refresh;
}

// 路由恢复时列表尚未加载完；等内容挂载后再恢复，避免被加载占位的高度截断。
function readingPosition(ctx, node) {
  let pending = null;
  return {
    onRestore(y) { pending = y; node.classList.add("is-quiet"); },
    afterPaint() {
      if (pending === null) return;
      const y = pending;
      pending = null;
      requestAnimationFrame(() => { if (ctx.isCurrent()) window.scrollTo(0, y); });
    },
  };
}

function list(ctx) {
  const filter = readKnowledgeQuery(ctx.query);
  const resultCount = h("p", { class: "knowledge-result-count", role: "status", "aria-live": "polite" });
  const results = h("div", { class: "knowledge-results", id: "knowledge-results" });
  const pagination = h("nav", { class: "knowledge-pagination", "aria-label": "知识列表分页" });
  const kinds = h("nav", { class: "knowledge-kinds", "aria-label": "知识分类" });
  const bookScope = h("div", { class: "knowledge-book-scope", hidden: !filter.book_id });
  const search = h("input", {
    type: "search", id: "knowledge-search", name: "q", value: filter.q,
    placeholder: "搜索书名、案例或名词", maxlength: "160", autocomplete: "off", enterkeyhint: "search",
  });
  // 中文输入法选字时按回车，不提前提交搜索。
  search.addEventListener("keydown", event => {
    if (event.key === "Enter" && (event.isComposing || event.keyCode === 229)) event.preventDefault();
  });
  const searchForm = h("form", { class: "knowledge-search", role: "search", onSubmit: event => {
    event.preventDefault();
    ctx.navigate(knowledgeListPath(filter, { q: search.value, offset: 0 }));
  } },
  h("label", { for: "knowledge-search", class: "sr-only" }, "搜索知识馆"),
  icon("search"), search,
  h("button", { type: "submit", class: "btn btn-primary" }, "搜索"));

  const systems = h("nav", { class: "knowledge-systems", "aria-label": "知识体系" }, KNOWLEDGE_SYSTEMS.map(([value, label]) =>
    h("a", { href: `#${knowledgeListPath(filter, { system: value, offset: 0 })}`, "aria-current": filter.system === value ? "page" : null }, label)));
  const node = h("div", { class: "knowledge-library" },
    h("header", { class: "knowledge-hero" },
      h("div", null,
        h("p", { class: "kicker" }, "典籍研读"),
        h("h1", null, "知识馆"),
        h("p", { class: "knowledge-intro" }, "读一本书，理解一个名词，再看它如何用在案例里。")),
      h("div", { class: "knowledge-seal", "aria-hidden": "true" }, "知", h("span", null, "有所本"))),
    searchForm, kinds,
    h("div", { class: "knowledge-toolbar" }, systems,
      filter.q || filter.system || filter.book_id
        ? h("a", { class: "knowledge-reset", href: "#/knowledge" }, icon("close"), "清除筛选") : null),
    bookScope, resultCount, results, pagination,
    h("p", { class: "knowledge-footnote" }, "内容依据典籍归纳整理，阅读时可结合条目出处理解上下文。"));
  const position = readingPosition(ctx, node);

  function paintKinds(counts) {
    fill(kinds, KNOWLEDGE_KINDS.map(([value, label]) => {
      const count = counts ? (value ? counts[value] : counts.book + counts.case + counts.term) : null;
      return h("a", { href: `#${knowledgeListPath(filter, { kind: value, offset: 0 })}`, "aria-current": filter.kind === value ? "page" : null },
        h("span", null, label), count === null ? null : h("span", { class: "knowledge-count" }, count));
    }));
  }

  function paintScope(items = [], counts = null) {
    if (!filter.book_id) return;
    const book = items.find(item => item.kind === "book" && item.id === filter.book_id);
    const source = items.flatMap(item => item.sources || []).find(item => item.book_id === filter.book_id);
    fill(bookScope, icon("book"),
      h("span", null, book?.title || source?.book_title ? `来自《${book?.title || source?.book_title}》的条目` : "正在浏览本书条目"),
      h("a", { href: `#${knowledgeEntryPath(filter.book_id)}` }, "书籍导读"),
      h("a", { href: `#${knowledgeListPath(filter, { book_id: "", offset: 0 })}`, "aria-label": "取消本书筛选" }, icon("close")),
      counts && !filter.q && !filter.system && !counts.case && !counts.term
        ? h("p", { class: "knowledge-book-pending" }, "本书的案例与名词正在整理，可以先阅读书籍导读。") : null);
  }

  paintKinds();
  paintScope();
  const load = attachLoader(ctx, knowledgeApiPath(filter), ({ phase, data, error }) => {
    results.setAttribute("aria-busy", String(phase === "loading"));
    fill(pagination);
    if (phase === "loading") {
      resultCount.textContent = "";
      fill(results, spinnerLine("正在整理书架…"));
      return;
    }
    if (phase === "error") {
      resultCount.textContent = "";
      fill(results, errorView(error, load, { title: "知识馆暂时没有打开" }));
      return;
    }
    const { items, total, offset, limit, counts } = data;
    paintKinds(counts);
    paintScope(items, counts);
    const noun = filter.kind ? knowledgeKindLabel(filter.kind) : "知识";
    resultCount.textContent = filter.q ? `“${filter.q}” · 找到 ${total} 条${noun}` : `共 ${total} 条${noun}`;
    if (!items.length) {
      fill(results, stateView({
        glyph: "search", title: offset ? "这一页没有更多内容" : "暂时没有匹配的内容",
        text: offset ? "可以回到第一页继续阅读。" : "试试更短的关键词，或切换分类与体系。",
        actions: [h("a", { class: "btn btn-soft", href: offset ? `#${knowledgeListPath(filter, { offset: 0 })}` : "#/knowledge" }, offset ? "回到第一页" : "浏览全部知识")],
      }));
      return;
    }
    fill(results, h("div", { class: "knowledge-grid" }, items.map(card)));
    if (total > limit || offset) {
      fill(pagination,
        offset > 0
          ? h("a", { class: "btn", rel: "prev", href: `#${knowledgeListPath(filter, { offset: Math.max(0, offset - limit) })}` }, icon("back"), "上一页")
          : h("span", { class: "knowledge-page-spacer" }),
        h("span", { class: "knowledge-page-label" }, `${offset + 1}–${Math.min(offset + items.length, total)} / ${total}`),
        offset + limit < total
          ? h("a", { class: "btn", rel: "next", href: `#${knowledgeListPath(filter, { offset: offset + limit })}` }, "下一页", icon("chevronRight"))
          : h("span", { class: "knowledge-page-spacer" }));
    }
    position.afterPaint();
  });
  load();
  return { node, title: "知识馆", onRestore: position.onRestore };
}

function bookReading(ctx) {
  const node = h("section", { class: "knowledge-book-reading", "aria-label": "本书条目" });
  let bookId = "";
  let phase = "idle";
  const loader = createKnowledgeLoader(state => {
    if (!ctx.isCurrent()) return;
    phase = state.phase;
    if (phase === "loading") {
      fill(node, spinnerLine("正在查看本书条目…"));
      return;
    }
    if (phase === "error") {
      fill(node, h("p", null, "暂时无法查询本书条目。"),
        h("button", { type: "button", class: "btn btn-soft btn-sm", onClick: refresh }, "重试"));
      return;
    }
    const { counts } = state.data;
    if (!counts.case && !counts.term) {
      fill(node, h("h2", null, "继续研读"), h("p", null, "本书的案例与名词正在整理。"));
      return;
    }
    fill(node, h("h2", null, "继续研读"), h("div", { class: "knowledge-book-reading-links" },
      [["case", "案例"], ["term", "名词"]].filter(([kind]) => counts[kind] > 0).map(([kind, label]) =>
        h("a", { class: "knowledge-browse-cta", href: `#${knowledgeListPath({}, { book_id: bookId, kind })}` },
          icon("book"), h("span", null, h("strong", null, `看本书${label}`), h("span", null, `已整理 ${counts[kind]} 条`)), icon("arrowRight")))));
  });
  function refresh() {
    if (bookId) loader.load(`/api/knowledge?${new URLSearchParams({ book_id: bookId, limit: "1" })}`);
  }
  const reconnect = () => { if (phase === "error") refresh(); };
  window.addEventListener("online", reconnect);
  ctx.cleanup(() => { loader.destroy(); window.removeEventListener("online", reconnect); });
  return { node, load(id) { bookId = id; refresh(); } };
}

function detail(ctx) {
  const body = h("div", { class: "knowledge-detail-body" });
  const reading = bookReading(ctx);
  const node = h("div", { class: "knowledge-detail" },
    h("nav", { class: "knowledge-breadcrumb", "aria-label": "当前位置" },
      h("a", { href: "#/knowledge" }, icon("back"), "知识馆"),
      h("span", { "aria-hidden": "true" }, "/"), h("span", null, "阅读")), body);
  const position = readingPosition(ctx, node);
  const load = attachLoader(ctx, `/api/knowledge/${encodeURIComponent(ctx.params.id)}`, ({ phase, data, error }) => {
    body.setAttribute("aria-busy", String(phase === "loading"));
    if (phase === "loading") {
      fill(body, spinnerLine("正在打开条目…"));
      return;
    }
    if (phase === "error") {
      fill(body, error?.status === 404 ? stateView({
        glyph: "book", title: "这个条目暂时找不到了", text: "它可能已调整或尚未收录，可以回知识馆看看其他内容。",
        actions: [h("a", { class: "btn btn-soft", href: "#/knowledge" }, "返回知识馆")],
      }) : errorView(error, load, { title: "条目没有加载出来" }));
      return;
    }
    const { entry, related } = data;
    ctx.setTitle(`${entry.title} · 知识馆`);
    const sectionNodes = (entry.sections || []).map((section, index) =>
      h("section", { class: "knowledge-section", id: `knowledge-section-${index}`, tabindex: "-1" },
        h("h2", null, section.heading),
        h("div", { class: "knowledge-prose" }, section.body.split(/\n\s*\n/).filter(Boolean).map(paragraph => h("p", null, paragraph)))));
    const contents = sectionNodes.length > 1 ? h("nav", { class: "knowledge-contents", "aria-label": "条目目录" },
      h("h2", null, "本篇内容"),
      entry.sections.map((section, index) => h("button", { type: "button", onClick: () => {
        sectionNodes[index].scrollIntoView({ block: "start", behavior: "auto" });
        sectionNodes[index].focus({ preventScroll: true });
      } }, h("span", { "aria-hidden": "true" }, String(index + 1).padStart(2, "0")), section.heading))) : null;
    fill(body,
      h("article", { class: "knowledge-article" },
        h("header", { class: "knowledge-article-head" },
          entryMeta(entry), h("h1", null, entry.title),
          entry.aliases?.length ? h("p", { class: "knowledge-aliases" }, `又称：${entry.aliases.join("、")}`) : null,
          h("p", { class: "knowledge-lead" }, entry.summary), tags(entry)),
        contents, sectionNodes,
        entry.kind === "book" ? reading.node : null,
        entry.sources?.length ? h("section", { class: "knowledge-provenance", "aria-label": "内容出处" },
          h("h2", null, "内容出处"), sourceLinks(entry.sources, { detailed: true })) : null),
      related?.length ? h("section", { class: "knowledge-related", "aria-label": "延伸阅读" },
        h("div", { class: "knowledge-related-head" }, h("h2", null, "延伸阅读"), h("span", null, "把书、案例和名词连起来")),
        h("div", { class: "knowledge-grid" }, related.map(card))) : null);
    if (entry.kind === "book") reading.load(entry.id);
    position.afterPaint();
  });
  load();
  return { node, title: "知识馆", onRestore: position.onRestore };
}

export function render(ctx) {
  return ctx.params.id ? detail(ctx) : list(ctx);
}
