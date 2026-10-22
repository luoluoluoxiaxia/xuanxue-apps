import { h, fill } from "../lib/dom.js?v=n34";
import { get } from "../lib/api.js?v=n34";
import { icon } from "../lib/icons.js?v=n34";
import { createKnowledgeLoader } from "../lib/knowledge.js?v=n34";
import { readBookCaseQuery, bookCaseListPath, bookCaseDetailPath, bookCaseApiPath,
  bookCasesEntry, bookCaseReadingPath, bookCaseKindLabel } from "../lib/book-cases.js?v=n34";
import { errorView, stateView, spinnerLine } from "../ui/bits.js?v=n34";

function attach(ctx, path, paint, request) {
  let phase = "loading";
  let pendingPosition = null;
  const loader = createKnowledgeLoader(state => {
    if (!ctx.isCurrent()) return;
    phase = state.phase;
    paint(state);
    if (phase === "ready" && pendingPosition !== null) {
      const y = pendingPosition; pendingPosition = null;
      requestAnimationFrame(() => { if (ctx.isCurrent()) window.scrollTo(0, y); });
    }
  }, request);
  const refresh = () => loader.load(path);
  const reconnect = () => { if (phase === "error") refresh(); };
  window.addEventListener("online", reconnect);
  ctx.cleanup(() => { loader.destroy(); window.removeEventListener("online", reconnect); });
  ctx.onRefresh(refresh);
  return { refresh, onRestore(y) { pendingPosition = y; } };
}

function views(filter) {
  return h("nav", { class: "books-views", "aria-label": "书库视图" },
    h("a", { href: "#/books" }, "全部书籍"),
    h("a", { href: "#/books?view=learning" }, "学习路线"),
    h("a", { href: `#${bookCaseListPath({ from: filter.from })}`, "aria-current": "page" }, "案例"));
}

function list(ctx, request) {
  const filter = readBookCaseQuery(ctx.query);
  const count = h("p", { class: "books-count", role: "status", "aria-live": "polite" });
  const results = h("div", { class: "book-cases-grid", id: "book-case-results" });
  const pagination = h("nav", { class: "book-cases-pagination", "aria-label": "案例分页" });
  const select = h("select", { id: "book-case-book", "aria-controls": "book-case-results", disabled: true,
    onChange: () => ctx.navigate(bookCaseListPath(filter, { book_id: select.value, offset: 0 })) },
  h("option", { value: "" }, "全部书籍"));
  const node = h("div", { class: "books-library book-cases-library" }, views(filter),
    h("h1", { class: "sr-only" }, "典籍案例"),
    h("div", { class: "book-cases-filter" }, h("label", { for: "book-case-book" }, "书籍"), select), count, results, pagination);
  const path = bookCaseApiPath(filter);
  const life = attach(ctx, path, ({ phase, data, error }) => {
    results.setAttribute("aria-busy", String(phase === "loading"));
    if (phase !== "ready") { count.textContent = ""; fill(pagination); }
    if (phase === "loading") { fill(results, spinnerLine("正在打开案例…")); return; }
    if (phase === "error") { fill(results, errorView(error, life.refresh, { title: "案例暂时没有打开" })); return; }
    const { cases, catalogue } = data;
    const books = catalogue.books.filter(book => bookCasesEntry(book) || book.id === filter.book_id);
    fill(select, h("option", { value: "" }, "全部书籍"), books.map(book => h("option", { value: book.id }, book.title)),
      filter.book_id && !books.some(book => book.id === filter.book_id) ? h("option", { value: filter.book_id }, "所选书籍") : null);
    select.value = filter.book_id; select.disabled = false;
    count.textContent = `当前已收录 ${cases.total} 条案例`;
    fill(results, cases.items.length ? cases.items.map(item => h("article", { class: "book-case-card" },
      h("p", { class: "book-case-meta" }, `《${item.book_title}》 · ${bookCaseKindLabel(item.kind)}`),
      h("h2", null, h("a", { href: `#${bookCaseDetailPath(item.id, filter)}` }, item.title)),
      h("p", { class: "book-case-summary" }, item.summary),
      h("a", { class: "book-case-open", href: `#${bookCaseDetailPath(item.id, filter)}`, "aria-label": `研读${item.title}` }, "研读案例", icon("arrowRight"))))
      : stateView({ glyph: "book", title: filter.book_id ? "这本书暂未收录案例" : "暂未收录案例",
        text: filter.offset ? "这一页没有案例，可以返回前一页。" : "可以先在书库阅读原书。",
        actions: [h("a", { class: "btn btn-soft", href: filter.book_id ? `#${bookCaseListPath(filter, { book_id: "", offset: 0 })}` : "#/books" }, filter.book_id ? "查看全部案例" : "前往书库")] }));
    fill(pagination, cases.total > cases.limit || cases.offset > 0 ? [
      cases.offset > 0 ? h("a", { class: "btn btn-soft", href: `#${bookCaseListPath(filter, { offset: Math.max(0, cases.offset - cases.limit) })}` }, "上一页") : h("span"),
      cases.items.length ? h("span", null, `${cases.offset + 1}–${cases.offset + cases.items.length} / ${cases.total}`) : null,
      cases.offset + cases.items.length < cases.total && cases.items.length
        ? h("a", { class: "btn btn-soft", href: `#${bookCaseListPath(filter, { offset: cases.offset + cases.limit })}` }, "下一页") : h("span")] : null);
  }, async (apiPath, options) => {
    const [cases, catalogue] = await Promise.all([request(apiPath, options), request("/api/books", options)]);
    return { cases, catalogue };
  });
  life.refresh();
  return { node, title: "典籍案例 · 书库", onRestore: life.onRestore };
}

const paragraphs = (texts, className = "") => texts.map(text => h("p", { class: className }, text));
const section = (title, texts) => h("section", { class: "book-case-section" }, h("h2", null, title), paragraphs(texts));

function detail(ctx, request) {
  const filter = readBookCaseQuery(ctx.query);
  const back = () => h("a", { class: "book-reading-back", href: `#${bookCaseListPath(filter)}` }, icon("back"), "返回案例");
  const body = h("div", { class: "book-case-detail-body" });
  const node = h("div", { class: "book-case-detail" }, back(), body);
  const life = attach(ctx, `/api/book-cases/${encodeURIComponent(ctx.params.id)}`, ({ phase, data, error }) => {
    body.setAttribute("aria-busy", String(phase === "loading"));
    if (phase === "loading") { fill(body, spinnerLine("正在打开案例…")); return; }
    if (phase === "error") {
      fill(body, error?.status === 404 ? stateView({ glyph: "book", title: "这个案例暂不可用", text: "可以返回列表查看当前收录的案例。",
        actions: [h("a", { class: "btn btn-soft", href: `#${bookCaseListPath(filter)}` }, "返回案例列表")] })
        : errorView(error, life.refresh, { title: "案例暂时没有打开" }));
      return;
    }
    ctx.setTitle(`${data.title} · 典籍案例`);
    fill(body, h("header", { class: "book-case-heading" },
      h("p", { class: "book-case-meta" }, `《${data.book_title}》 · ${bookCaseKindLabel(data.kind)}`), h("h1", null, data.title)),
    data.chart.length ? h("section", { class: "book-case-section book-case-chart-section", "aria-label": "原书四柱" },
      h("h2", null, "四柱"), h("dl", { class: "book-case-chart" }, data.chart.map(pillar => h("div", null,
        h("dt", null, pillar.label), h("dd", null, pillar.value))))) : null,
    section("原书分析", data.judgment.length ? data.judgment : ["原书此处未给出分析。"]),
    section("书载结果", data.outcome_status === "not_reported" ? ["原书此处未记载具体结果。"] : data.outcome),
    h("details", { class: "book-case-context" }, h("summary", null, "原文与白话"),
      h("div", { class: "book-case-context-body" },
        h("h2", null, "案例原文"), h("blockquote", { class: "book-case-original" }, data.original_excerpt),
        data.facts.length ? section("书中信息", data.facts) : null,
        h("h2", null, "所在段白话"), h("p", { class: "book-case-text" }, data.modern_context),
        data.uncertainties.length ? h("aside", { class: "book-case-uncertainties", "aria-label": "存疑说明" }, h("h3", null, "存疑说明"), paragraphs(data.uncertainties)) : null)),
    h("details", { class: "book-case-context" }, h("summary", null, "查看原文前后文"),
      h("div", { class: "book-case-context-body" },
        data.context_before ? section("前一段", [data.context_before]) : null,
        h("h2", null, "案例所在段"), h("p", { class: "book-case-text book-case-original" }, data.original_context),
        data.context_after ? section("后一段", [data.context_after]) : null)),
    h("footer", { class: "book-case-sources" }, h("h2", null, "出处"),
      data.sources.map(source => {
        const reading = bookCaseReadingPath(source.reading_path, filter.from);
        return h("div", { class: "book-case-source" }, h("p", null, source.edition_label),
          h("p", null, [source.chapter, source.location].filter(Boolean).join(" · ")),
          reading ? h("a", { href: `#${reading}` }, "回到原书章节", icon("arrowRight")) : null);
      })));
  }, request);
  life.refresh();
  return { node, title: "典籍案例", onRestore: life.onRestore };
}

export function render(ctx, request = get) {
  return ctx.params.id ? detail(ctx, request) : list(ctx, request);
}
