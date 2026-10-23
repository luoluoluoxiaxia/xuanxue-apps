import { h, fill } from "../lib/dom.js?v=n37";
import { get } from "../lib/api.js?v=n37";
import { icon } from "../lib/icons.js?v=n37";
import { createKnowledgeLoader } from "../lib/knowledge.js?v=n37";
import { readBookCaseQuery, bookCaseListPath, bookCaseDetailPath, bookCaseApiPath,
  bookCasesEntry, bookCaseReadingPath, bookCaseKindLabel, bookCaseCasts, bookCaseChartPath,
  bookCaseChartMatches, bookCaseModernBlocks, BOOK_CASE_KINDS } from "../lib/book-cases.js?v=n37";
import { errorView, stateView, spinnerLine } from "../ui/bits.js?v=n37";
import { baziPanel, baziStrip } from "../ui/chart-bazi.js?v=n37";
import { liuyaoPanel, liuyaoStrip } from "../ui/chart-liuyao.js?v=n37";
import { openSheet } from "../ui/overlay.js?v=n37";

function attach(ctx, path, paint, request, readyReconnect = () => {}) {
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
  const reconnect = () => { if (phase === "error") refresh(); else if (phase === "ready") readyReconnect(); };
  window.addEventListener("online", reconnect);
  ctx.cleanup(() => { loader.destroy(); window.removeEventListener("online", reconnect); });
  ctx.onRefresh(refresh);
  return { refresh, onRestore(y) { pendingPosition = y; } };
}

function views(filter) {
  return h("nav", { class: "books-views", "aria-label": "书库视图" },
    h("a", { href: "#/books" }, "全部书籍"),
    h("a", { href: "#/books?view=learning" }, "学习路线"),
    h("a", { href: `#${bookCaseListPath({ from: filter.from })}`, "aria-current": "page" }, "案例与推演"));
}

function list(ctx, request) {
  const filter = readBookCaseQuery(ctx.query);
  const count = h("p", { class: "books-count", role: "status", "aria-live": "polite" });
  const results = h("div", { class: "book-cases-grid", id: "book-case-results" });
  const pagination = h("nav", { class: "book-cases-pagination", "aria-label": "学习条目分页" });
  const select = h("select", { id: "book-case-book", "aria-controls": "book-case-results", disabled: true,
    onChange: () => ctx.navigate(bookCaseListPath(filter, { book_id: select.value, offset: 0 })) },
  h("option", { value: "" }, "全部书籍"));
  const kind = h("select", { id: "book-case-kind", "aria-controls": "book-case-results", value: filter.kind,
    onChange: () => ctx.navigate(bookCaseListPath(filter, { kind: kind.value, offset: 0 })) },
  h("option", { value: "" }, "全部类型"), Object.entries(BOOK_CASE_KINDS).map(([value, label]) => h("option", { value }, label)));
  kind.value = filter.kind;
  const node = h("div", { class: "books-library book-cases-library" }, views(filter),
    h("h1", { class: "sr-only" }, "典籍案例与推演"),
    h("div", { class: "book-cases-filters" },
      h("div", { class: "book-cases-filter" }, h("label", { for: "book-case-book" }, "书籍"), select),
      h("div", { class: "book-cases-filter" }, h("label", { for: "book-case-kind" }, "类型"), kind)), count, results, pagination);
  const path = bookCaseApiPath(filter);
  const life = attach(ctx, path, ({ phase, data, error }) => {
    results.setAttribute("aria-busy", String(phase === "loading"));
    if (phase !== "ready") { count.textContent = ""; fill(pagination); }
    if (phase === "loading") { fill(results, spinnerLine("正在打开学习条目…")); return; }
    if (phase === "error") { fill(results, errorView(error, life.refresh, { title: "学习条目暂时没有打开" })); return; }
    const { cases, catalogue } = data;
    const books = catalogue.books.filter(book => bookCasesEntry(book) || book.id === filter.book_id);
    fill(select, h("option", { value: "" }, "全部书籍"), books.map(book => h("option", { value: book.id }, book.title)),
      filter.book_id && !books.some(book => book.id === filter.book_id) ? h("option", { value: filter.book_id }, "所选书籍") : null);
    select.value = filter.book_id; select.disabled = false;
    count.textContent = `当前已收录 ${cases.total} 条学习条目 · 按原文提及保存`;
    fill(results, cases.items.length ? cases.items.map(item => h("article", { class: "book-case-card" },
      h("p", { class: "book-case-meta" }, `《${item.book_title}》 · ${bookCaseKindLabel(item.kind)}`),
      h("h2", null, h("a", { href: `#${bookCaseDetailPath(item.id, filter)}` }, item.title)),
      h("p", { class: "book-case-summary" }, item.summary),
      h("a", { class: "book-case-open", href: `#${bookCaseDetailPath(item.id, filter)}`, "aria-label": `研读${item.title}` }, "开始研读", icon("arrowRight"))))
      : stateView({ glyph: "book", title: filter.kind ? "暂无这类学习条目" : filter.book_id ? "这本书暂未收录学习条目" : "暂未收录学习条目",
        text: filter.offset ? "这一页没有条目，可以返回前一页。" : "可以先在书库阅读原书。",
        actions: [h("a", { class: "btn btn-soft", href: filter.book_id || filter.kind ? `#${bookCaseListPath(filter, { book_id: "", kind: "", offset: 0 })}` : "#/books" }, filter.book_id || filter.kind ? "查看全部条目" : "前往书库")] }));
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
  return { node, title: "典籍案例与推演 · 书库", onRestore: life.onRestore };
}

const paragraphs = (texts, className = "") => texts.map(text => h("p", { class: className }, text));
const section = (title, texts) => h("section", { class: "book-case-section" }, h("h2", null, title), paragraphs(texts));

function detail(ctx, request) {
  const filter = readBookCaseQuery(ctx.query);
  const back = () => h("a", { class: "book-reading-back", href: `#${bookCaseListPath(filter)}` }, icon("back"), "返回学习条目");
  const body = h("div", { class: "book-case-detail-body" });
  const node = h("div", { class: "book-case-detail" }, back(), body);
  let chartSheet = null;
  let chartLoader = null;
  let chartPhase = "idle";
  let chartError = null;
  let chartPath = null;
  let currentData = null;
  const closeChart = reason => { chartSheet?.close(reason); chartSheet = null; };
  const stopChart = reason => { chartLoader?.destroy(); chartLoader = null; chartPath = null; chartPhase = "idle"; chartError = null; closeChart(reason); };
  const refreshChart = () => { if (chartPath) chartLoader?.load(chartPath); };
  ctx.cleanup(() => { currentData = null; stopChart("route"); });
  const life = attach(ctx, `/api/book-cases/${encodeURIComponent(ctx.params.id)}`, ({ phase, data, error }) => {
    body.setAttribute("aria-busy", String(phase === "loading"));
    if (phase === "loading") { currentData = null; stopChart("refresh"); fill(body, spinnerLine("正在打开学习条目…")); return; }
    if (phase === "error") {
      fill(body, error?.status === 404 ? stateView({ glyph: "book", title: "这个条目暂不可用", text: "可以返回列表查看当前收录的学习条目。",
        actions: [h("a", { class: "btn btn-soft", href: `#${bookCaseListPath(filter)}` }, "返回学习条目")] })
        : errorView(error, life.refresh, { title: "学习条目暂时没有打开" }));
      return;
    }
    currentData = data;
    const sourceMention = data.study_format === "source_mention";
    const exercise = data.kind === "hypothetical";
    const chartName = exercise ? "推演练习盘" : "书例盘面";
    const casts = bookCaseCasts(data);
    const sourceTables = new Set(casts.map(cast => cast.original_table).filter(Boolean));
    const sourceText = (text, original = false) => h(sourceTables.has(text) ? "pre" : "p",
      { class: sourceTables.has(text) ? "book-case-original-table" : ["book-case-text", original && "book-case-original"] }, text);
    let selectedCast = casts[0] || null;
    const castSlot = h("section", { class: "book-case-cast", "aria-label": "书载卦次" });
    const castContent = h("div", { id: "book-case-cast-content", "aria-live": "polite" });
    const chartSlot = h("div", { class: "book-case-chart-area", id: "book-case-chart" });
    const fullChart = h("aside", { class: "book-case-full-chart", "aria-label": chartName });
    const article = h("article", { class: "book-case-analysis", "aria-label": "原书条目研读" });
    const study = h("div", { class: ["book-case-study", sourceMention && "is-source-mention"] },
      casts.length || data.chart_status === "available" ? fullChart : null, article);
    const metaText = system => [`《${data.book_title}》`, system === "liuyao" ? "六爻" : system === "bazi" ? "八字" : "", bookCaseKindLabel(data.kind)].filter(Boolean).join(" · ");
    const meta = h("p", { class: "book-case-meta" }, metaText());
    ctx.setTitle(`${data.title} · 典籍研读`);
    fill(body, h("header", { class: "book-case-heading" },
      meta, h("h1", null, data.title)), casts.length ? castSlot : null, chartSlot, study);
    const uncertainties = data.uncertainties.length ? h("aside", { class: "book-case-uncertainties", "aria-label": "存疑说明" }, h("h3", null, "存疑说明"), paragraphs(data.uncertainties)) : null;
    fill(article, sourceMention ? [
      h("section", { class: "book-case-section book-case-modern" }, h("h2", null, "所在段白话"),
        typeof data.modern_context === "string" && data.modern_context.trim() ? null
          : h("p", { class: "book-case-chart-note" }, "本条所在段白话暂未提供，可展开原文阅读。"),
        bookCaseModernBlocks(data).map(text => sourceText(text))),
      h("details", { class: "book-case-context" }, h("summary", null, "原文摘句与判断"),
        h("div", { class: "book-case-context-body" },
          h("h2", null, "原文摘句"), h("blockquote", { class: "book-case-original" }, data.original_excerpt),
          data.facts.length ? section("书载信息", data.facts) : null,
          data.judgment.length ? section("作者判断", data.judgment) : null,
          data.outcome_status === "recorded" && data.outcome.length ? section("书载结果", data.outcome) : null,
          uncertainties)),
      Array.isArray(data.supporting_contexts) && data.supporting_contexts.length
        ? h("details", { class: "book-case-context" }, h("summary", null, "题设与相关段落"),
          h("div", { class: "book-case-context-body" }, data.supporting_contexts.map(context => {
            const reading = bookCaseReadingPath(context.reading_path, filter.from, data.book_id);
            const hasModern = typeof context.modern === "string" && context.modern.trim();
            return h("section", { class: "book-case-section" }, h("h3", null, context.title),
              hasModern ? [h("p", { class: "book-case-meta" }, "对应段白话"),
                sourceText(context.modern),
                h("details", { class: "book-case-context" }, h("summary", null, "查看对应原文"),
                  h("div", { class: "book-case-context-body" },
                    sourceText(context.original, true)))]
                : [h("p", { class: "book-case-meta" }, "对应段原文"),
                  sourceText(context.original, true)],
              h("p", { class: "book-case-meta" }, context.location),
              reading ? h("a", { href: `#${reading}` }, "回到原书章节", icon("arrowRight")) : null);
          }))) : null,
    ] : [
      section("原书分析", data.judgment.length ? data.judgment : ["原书此处未给出分析。"]),
      section("书载结果", data.outcome_status === "not_reported" ? ["原书此处未记载具体结果。"] : data.outcome),
      h("details", { class: "book-case-context" }, h("summary", null, data.modern_context ? "原文与白话" : "原文与说明"),
        h("div", { class: "book-case-context-body" },
          h("h2", null, "案例原文"), h("blockquote", { class: "book-case-original" }, data.original_excerpt),
          data.facts.length ? section("书中信息", data.facts) : null,
          data.modern_context ? [h("h2", null, "所在段白话"), h("p", { class: "book-case-text" }, data.modern_context)] : null,
          uncertainties)),
    ],
    h("details", { class: "book-case-context" }, h("summary", null, "查看原文前后文"),
      h("div", { class: "book-case-context-body" },
        data.context_before ? section("前一段", [data.context_before]) : null,
        h("h2", null, "所在原段"), h("p", { class: "book-case-text book-case-original" }, data.original_context),
        data.context_after ? section("后一段", [data.context_after]) : null)),
    Array.isArray(data.related_case_ids) && data.related_case_ids.some(id => typeof id === "string" && id !== data.id)
      ? h("nav", { class: "book-case-related", "aria-label": "互参条目" }, h("h2", null, "互参条目"),
        [...new Set(data.related_case_ids)].filter(id => typeof id === "string" && id !== data.id).map((id, index) =>
          h("a", { href: `#${bookCaseDetailPath(id, filter)}` }, `相关条目 ${index + 1}`, icon("arrowRight")))) : null,
    h("footer", { class: "book-case-sources" }, h("h2", null, "出处"),
      data.sources.map(source => {
        const reading = bookCaseReadingPath(source.reading_path, filter.from, data.book_id);
        return h("div", { class: "book-case-source" }, h("p", null, source.edition_label),
          h("p", null, [source.chapter, source.location].filter(Boolean).join(" · ")),
          reading ? h("a", { href: `#${reading}` }, "回到原书章节", icon("arrowRight")) : null);
      })));
    const selectCast = cast => {
      stopChart("cast");
      selectedCast = cast;
      study.classList.remove("has-chart");
      fill(fullChart); fill(chartSlot);
      chartSlot.setAttribute("aria-busy", "false");
      meta.textContent = metaText(cast ? "liuyao" : undefined);
      const castNotes = () => cast ? [
        cast.missing?.length ? h("p", { class: "book-case-chart-note" }, cast.missing.join("、")) : null,
        cast.uncertainties?.length ? paragraphs(cast.uncertainties, "book-case-chart-note") : null,
      ] : null;
      if (cast) {
        fill(castContent,
          h("details", { class: "book-case-context book-case-cast-source" }, h("summary", null, "书载问事与原表"),
            h("div", { class: "book-case-context-body" },
              h("p", { class: "book-case-cast-heading" }, cast.source_heading || "书载原题未载。"),
              h("dl", { class: "book-case-cast-facts" },
                [["书载月", cast.source_month], ["书载日", cast.source_day],
                  ["书载卦名", cast.source_hexagram_names?.join(" → ")]].map(([label, value]) =>
                  h("div", null, h("dt", null, label), h("dd", null, value || "未载")))),
              cast.original_table ? h("pre", { class: "book-case-original-table" }, cast.original_table) : null,
              cast.chart_status === "available" ? castNotes() : null)));
      }
      const chartStatus = cast?.chart_status ?? data.chart_status;
      if (chartStatus !== "available") {
        fill(chartSlot, h("div", { class: "book-case-chart-status", role: "status" },
          h("p", { class: "book-case-chart-note" }, chartStatus === "incomplete"
          ? cast ? "本卦资料不全，暂不能复盘。" : "原书未载完整排盘条件，暂不能复盘。"
          : chartStatus === "not_applicable" ? data.kind === "hypothetical" ? "本条为假设推演，按原文条件阅读。" : "本条为规则说明，按原文条件阅读。"
            : "排盘资料暂不可用，可先阅读原书内容。"), castNotes()));
        return;
      }
      chartLoader = createKnowledgeLoader(state => {
        if (!ctx.isCurrent() || currentData !== data || selectedCast !== cast) return;
        chartPhase = state.phase;
        chartError = state.error || null;
        chartSlot.setAttribute("aria-busy", String(state.phase === "loading"));
        closeChart("refresh");
        if (state.phase === "loading") { fill(chartSlot, spinnerLine("正在打开盘面…")); fill(fullChart); return; }
        if (state.phase === "error") {
          study.classList.remove("has-chart"); fill(fullChart);
          fill(chartSlot, h("div", { class: "book-case-chart-status" }, state.error?.status === 404
            ? stateView({ glyph: "book", title: "此例盘面暂不可用", text: "可以继续阅读原书内容。" })
            : errorView(state.error, refreshChart, { title: "盘面暂时没有打开" })));
          return;
        }
        const chart = state.data;
        const caseContext = { available_sections: chart.available_sections, missing: chart.missing, source_label: chart.source_label };
        const panel = () => chart.system === "liuyao" ? liuyaoPanel(chart.payload, { caseContext })
          : baziPanel(chart.payload, { name: data.title, beside: true, caseContext });
        const openChart = event => {
          if (!ctx.isCurrent() || currentData !== data || selectedCast !== cast) return;
          closeChart("replace");
          const sheet = openSheet({ title: cast ? "书例卦盘 · 复盘计算" : exercise ? "推演练习盘" : chart.system === "liuyao" ? "书例卦盘" : "书例命盘", body: panel(),
            wide: true, className: "sheet-chart", returnFocus: event.currentTarget,
            onClose: () => { if (chartSheet === sheet) chartSheet = null; } });
          chartSheet = sheet;
        };
        meta.textContent = metaText(chart.system);
        study.classList.add("has-chart");
        fill(fullChart, cast ? h("p", { class: "book-case-chart-caption" }, "复盘计算") : null, panel());
        fill(chartSlot, h("button", { type: "button", class: "book-case-chart-strip", "aria-label": `查看完整${chartName}`, onClick: openChart },
          chart.system === "liuyao" ? liuyaoStrip(chart.payload, { caseContext }) : baziStrip(chart.payload, { caseContext }),
          h("span", { class: "book-case-chart-open" }, cast ? "复盘计算 · 完整盘面" : "完整盘面", icon("chevronDown", "icon-sm"))));
      }, async (path, options) => {
        const chart = await request(path, options);
        if (!bookCaseChartMatches(chart, data.id, cast?.id ?? null))
          throw new Error("案例与盘面未能对应，请重试。");
        return chart;
      });
      chartPath = bookCaseChartPath(data.id, cast?.id ?? null);
      refreshChart();
    };
    if (casts.length) {
      const selector = casts.length > 1 ? h("select", { id: "book-case-cast", "aria-controls": "book-case-cast-content book-case-chart",
        onChange: () => {
          const cast = casts.find(item => item.id === selector.value);
          if (cast && cast !== selectedCast) selectCast(cast);
        } }, casts.map(cast => h("option", { value: cast.id }, cast.label))) : null;
      if (selector) selector.value = selectedCast.id;
      fill(castSlot, selector ? h("div", { class: "book-case-cast-picker" },
        h("label", { for: "book-case-cast" }, "按原书卦次阅读"), selector) : null, castContent);
    }
    selectCast(selectedCast);
  }, async (path, options) => {
    const data = await request(path, options);
    if (data?.id !== ctx.params.id) throw new Error("条目未能对应，请重试。");
    return data;
  }, () => { if (chartPhase === "error" && chartError?.status !== 404) refreshChart(); });
  life.refresh();
  return { node, title: "典籍研读", onRestore: life.onRestore };
}

export function render(ctx, request = get) {
  return ctx.params.id ? detail(ctx, request) : list(ctx, request);
}
