import { h, fill } from "../lib/dom.js?v=n17";
import { icon } from "../lib/icons.js?v=n17";
import { get } from "../lib/api.js?v=n17";
import { local, session } from "../lib/store.js?v=n17";
import { createKnowledgeLoader } from "../lib/knowledge.js?v=n17";
import { BOOK_STATUS, BOOK_SYSTEM, readingPath, readingNumber, filterBooks, readingPreferences, readingPosition, sourceBreaks } from "../lib/books.js?v=n17";
import { errorView, stateView } from "../ui/bits.js?v=n17";
import { openBookImage } from "../ui/book-image.js?v=n17";
import { createBookSidebar, openBookContents, openBookSettings } from "../ui/book-tools.js?v=n17";
import { openSheet } from "../ui/overlay.js?v=n17";
import { setupBookAnnotations } from "../ui/book-annotations.js?v=n17";
import { setupBookGlossary } from "../ui/book-glossary.js?v=n17";

const progressKey = id => `xz-book-progress:${id}`;
const positionKey = id => `xz-book-position:${id}`;
const detailCache = new Map();
const annotationNavigation = new Map();

function lifecycle(ctx, paint, request) {
  const loader = createKnowledgeLoader(state => { if (ctx.isCurrent()) paint(state); }, request);
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
  const sort = h("select", { "aria-label": "书籍排序" }, h("option", { value: "recent" }, "最近阅读优先"), h("option", { value: "catalog" }, "书库顺序"));
  const recent = h("div", { class: "books-recent" });
  const filters = local.json("xz-book-filters", {});
  search.value = typeof filters?.query === "string" ? filters.query : "";
  system.value = Object.hasOwn(BOOK_SYSTEM, filters?.system) ? filters.system : "";
  sort.value = filters?.sort === "catalog" ? "catalog" : "recent";
  const node = h("div", { class: "books-library" },
    h("header", { class: "books-hero" }, h("p", { class: "kicker" }, "典籍研读"), h("h1", null, "典籍书库"),
      h("p", null, "现有原文初录稿开放查阅，疑字与缺文随页标明，尚待逐书校勘。已整理的白话与校记随文保留。")),
    recent, h("div", { class: "books-filters" }, search, system, sort), count, results);
  function paintBooks() {
    const rows = filterBooks(books, search.value, system.value);
    local.setJson("xz-book-filters", { query: search.value, system: system.value, sort: sort.value });
    const position = book => readingPosition(local.json(positionKey(book.id)), book.section_count);
    if (sort.value === "recent") rows.sort((a, b) => (position(b)?.updatedAt || 0) - (position(a)?.updatedAt || 0));
    const latest = books.filter(book => position(book)).sort((a, b) => position(b).updatedAt - position(a).updatedAt)[0];
    fill(recent, latest ? h("a", { class: "books-resume", href: `#${readingPath(latest.id, position(latest).number)}` },
      icon("book"), h("span", null, h("small", null, "接着上次读"), h("b", null, latest.title)),
      h("span", null, `第 ${position(latest).number} ${latest.has_modern ? "篇" : "页"} →`)) : null);
    count.textContent = `共 ${rows.length} 本 · ${rows.filter(book => book.section_count > 0).length} 本可阅读`;
    fill(results, rows.length ? rows.map(book => {
      const available = book.section_count > 0;
      const saved = position(book);
      const progress = saved?.number || readingNumber(local.get(progressKey(book.id), "1"), book.section_count);
      return h("article", { class: "books-card" },
        h("div", { class: "books-card-meta" }, h("span", null, BOOK_SYSTEM[book.system]),
          h("span", { class: "books-status" }, BOOK_STATUS[book.status])),
        h("h2", null, book.title), h("p", { class: "books-source" }, book.source_label),
        h("p", { class: "books-notice" }, book.notice),
        saved ? h("div", { class: "books-progress" }, h("small", null, `读到第 ${progress} / ${book.section_count} ${book.has_modern ? "篇" : "页"}`),
          h("progress", { max: book.section_count, value: progress, "aria-label": `${book.title} 阅读进度` })) : null,
        available ? h("a", { class: "btn btn-soft", href: `#${readingPath(book.id, progress)}` },
          icon("book"), saved || progress > 1 ? "继续阅读" : "打开书籍", h("span", null, `${book.section_count} ${book.has_modern ? "篇" : "页"}`))
          : h("p", { class: "books-unavailable" }, "电子成品待恢复"));
    }) : stateView({ glyph: "search", title: "没有匹配的书籍", text: "试试其他书名，或切换体系。" }));
  }
  search.addEventListener("input", paintBooks);
  system.addEventListener("change", paintBooks);
  sort.addEventListener("change", paintBooks);
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
  let contents = [];
  let activeSection = null;
  let mode = local.get("xz-book-mode", "parallel");
  if (!["original", "modern", "parallel"].includes(mode)) mode = "parallel";
  let preferences = readingPreferences(local.json("xz-book-preferences"));
  let routeRestore = null;
  let saving = false;
  let saveTimer;
  let request = 0;
  let controller = new AbortController();
  let sidebar = null;
  let directoryOpen = local.get("xz-book-directory-open", "1") !== "0";
  const wideDirectory = window.matchMedia("(min-width: 1100px)");
  const pending = annotationNavigation.get(id);
  annotationNavigation.delete(id);
  let pendingAnnotation = pending && pending.userId === session.get().user?.id ? pending.annotation : null;
  const content = h("div", { class: "book-reading-content", "aria-label": "书籍正文" });
  const controls = h("nav", { class: "book-reading-controls", "aria-label": "阅读工具", hidden: true,
    onMouseDown: event => {
      const button = event.target.closest?.("button:not([disabled])");
      if (event.button !== 0 || !button) return;
      // Chrome 的默认聚焦会把 sticky 按钮滚回布局位置，先保持正文位置再打开工具。
      event.preventDefault(); button.focus({ preventScroll: true });
    } });
  const pagination = h("nav", { class: "book-reading-pagination", "aria-label": "正文翻页" });
  const backLink = h("a", { class: "book-reading-back", href: "#/books", "aria-label": "返回典籍书库" }, icon("back"), h("span", null, "书库"));
  const heading = h("header", { class: "book-reading-header" }, backLink);
  const sidebarSlot = h("div", { class: "book-sidebar-slot" });
  const readerBody = h("div", { class: "book-reader-body" }, controls, content, pagination);
  const node = h("div", { class: "book-reading" },
    heading,
    h("div", { class: "book-reader-layout" }, sidebarSlot, readerBody));
  const glossary = setupBookGlossary({ content, ctx });
  const annotations = setupBookAnnotations({ content, book: () => book, getSection: () => activeSection,
    getMode: () => book?.has_modern ? mode : "original", ctx,
    onNavigate: annotation => {
      if (annotation.anchor_status !== "matched") {
        ctx.toast("底本或来源位置已变化，已打开来源页；原标记的位置仍待核对。");
      }
      if (annotation.kind === "highlight" && annotation.anchor_status === "matched") {
        if (annotation.layer === "modern" && mode === "original") setMode("modern");
        else if (annotation.layer === "original" && mode === "modern") setMode("original");
      }
      if (annotation.section_number === activeSection?.number) {
        if (!annotations.locate(annotation)) content.scrollIntoView({ block: "start" });
      } else {
        annotationNavigation.set(id, { userId: session.get().user?.id, annotation });
        savePosition();
        ctx.navigate(readingPath(id, annotation.section_number));
      }
    } });
  controls.after(annotations.statusNode);

  function applyPreferences() {
    glossary.close();
    content.style.setProperty("--reading-size", `${preferences.size}px`);
    content.style.setProperty("--reading-line", preferences.line);
    content.style.setProperty("--reading-font", `var(--font-${preferences.font})`);
    content.dataset.paper = preferences.paper;
    content.dataset.layout = preferences.layout;
    content.dataset.mode = book?.has_modern ? mode : "original";
    node.dataset.mode = content.dataset.mode;
    node.dataset.hasModern = String(!!book?.has_modern);
    for (const button of controls.querySelectorAll("[data-book-mode]")) {
      button.setAttribute("aria-pressed", String(button.dataset.bookMode === mode));
    }
  }
  applyPreferences();
  function readingTop() {
    const top = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--topbar-h")) || 64;
    return top + controls.offsetHeight + 20;
  }
  function capturePosition() {
    if (!book || !activeSection) return null;
    const anchors = [...content.querySelectorAll("[data-reading-anchor]")];
    const top = readingTop();
    let index = anchors.findIndex(anchor => anchor.getBoundingClientRect().bottom > top);
    if (index < 0) index = Math.max(0, anchors.length - 1);
    const rect = anchors[index]?.getBoundingClientRect();
    return { number: activeSection.number, anchor: index,
      offset: rect ? Math.max(0, Math.min(1, (top - rect.top) / Math.max(1, rect.height))) : 0, updatedAt: Date.now() };
  }
  function savePosition() {
    if (!saving || document.body.classList.contains("is-locked")) return;
    const position = capturePosition();
    if (position) local.setJson(positionKey(id), position);
  }
  function restorePosition(position) {
    const anchors = content.querySelectorAll("[data-reading-anchor]");
    const anchor = anchors[position?.anchor];
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    window.scrollTo(0, window.scrollY + rect.top + rect.height * position.offset - readingTop());
  }
  function setMode(nextMode) {
    if (!["original", "parallel", "modern"].includes(nextMode) || !book?.has_modern) return;
    const position = capturePosition();
    mode = nextMode;
    local.set("xz-book-mode", mode);
    applyPreferences();
    requestAnimationFrame(() => annotations.onLayout());
    if (position) restorePosition(position);
  }
  function syncDirectory() {
    node.dataset.directory = directoryOpen ? "open" : "collapsed";
    const button = controls.querySelector(".book-directory");
    if (button && book) {
      if (wideDirectory.matches) {
        button.setAttribute("aria-expanded", String(directoryOpen));
        button.setAttribute("aria-controls", "book-directory-sidebar");
        button.removeAttribute("aria-haspopup");
      } else {
        button.removeAttribute("aria-expanded"); button.removeAttribute("aria-controls");
        button.setAttribute("aria-haspopup", "dialog");
      }
      button.setAttribute("aria-label", `${wideDirectory.matches ? directoryOpen ? "收起" : "展开" : "打开"}${book.title}目录，当前第 ${activeSection?.number || 1} 页`);
      button.querySelector("span").textContent = wideDirectory.matches
        ? directoryOpen ? "收起目录" : `${book.title} · 展开目录` : `${book.title} · ${book.has_modern ? "目录" : "书页"}`;
    }
    requestAnimationFrame(() => { sidebar?.refresh(); annotations.onLayout(); glossary.onLayout(); });
  }
  function setDirectory(expanded) {
    const position = capturePosition();
    directoryOpen = expanded; local.set("xz-book-directory-open", expanded ? "1" : "0");
    syncDirectory();
    if (position) restorePosition(position);
    if (!expanded) controls.querySelector(".book-directory")?.focus({ preventScroll: true });
  }
  wideDirectory.addEventListener("change", syncDirectory);
  ctx.cleanup(() => { wideDirectory.removeEventListener("change", syncDirectory); sidebar?.destroy(); });
  const trackScroll = () => { clearTimeout(saveTimer); saveTimer = setTimeout(savePosition, 300); };
  window.addEventListener("scroll", trackScroll, { passive: true });
  window.addEventListener("pagehide", savePosition);
  ctx.cleanup(() => { savePosition(); clearTimeout(saveTimer); window.removeEventListener("scroll", trackScroll); window.removeEventListener("pagehide", savePosition); });

  function renderFigure(figure) {
    const warning = h("p", { class: "books-notice", hidden: true }, "书影未能加载，可展开下方转写查看，或刷新重试。");
    const image = h("img", { src: figure.url, alt: `${book.title} · ${activeSection.location} · 图式书影`,
      width: figure.width, height: figure.height, loading: "lazy", decoding: "async",
      onError: event => { event.target.hidden = true; warning.hidden = false; } });
    const show = event => openBookImage(figure, `${book.title} · ${activeSection.location}`, event.currentTarget);
    return h("figure", { class: "book-figure" },
      h("button", { type: "button", class: "book-figure-open", onClick: show, "aria-label": "放大图式书影" }, image),
      warning, h("figcaption", null, figure.caption),
      h("button", { type: "button", class: "book-figure-link btn btn-soft", onClick: show }, "放大查看"));
  }

  function renderBlock(block, hasFigure) {
    const diagram = block.presentation === "diagram" || block.role === "diagram_caption" || block.source_text === false;
    const table = block.presentation === "table" || block.role === "table";
    const transcribed = diagram || table;
    const original = h("div", { class: "book-original", lang: "zh-Hant" },
      book.has_modern && !["note", "commentary"].includes(block.role) && !transcribed
        ? h("span", { class: "book-layer book-original-label" }, "原文") : null,
      ["note", "commentary"].includes(block.role) ? h("span", { class: "book-layer" }, block.role === "note" ? "原注" : "评注") : null,
      transcribed ? h("span", { class: "book-layer" }, block.role === "diagram_caption" ? "图中标注" : diagram ? "图式转写" : "表格转写") : null,
      h(transcribed ? "pre" : block.role === "heading" ? "h3" : "p", { class: transcribed ? "book-transcription" : null,
        ...(transcribed ? { tabindex: "0", "aria-label": `${diagram ? "图式" : "表格"}转写，可横向滚动` } : {}) },
        glossary.renderText(sourceBreaks(block), block.terms, "original")));
    const notes = block.notes.length ? h("details", { class: "book-notes" }, h("summary", null, `校记与说明 · ${block.notes.length}`),
      block.notes.map(note => h("p", null, note))) : null;
    const layer = transcribed && (hasFigure || diagram)
      ? h("details", { class: "book-diagram-transcription" }, h("summary", null, diagram ? "展开图式标注与转写" : "展开表格转写"),
        block.source_text === false ? h("p", { class: "books-notice" }, "此处是图形结构的文字转写，位置与连接请以书影为准。") : null,
        original, notes)
      : h("div", null, original, notes);
    return h("section", { class: `book-block book-role-${block.role}`, dataset: { blockId: block.id } }, layer,
      block.modern ? h("div", { class: "book-modern", lang: "zh-Hans" }, h("span", { class: "book-layer" }, "白话"),
        h("p", null, glossary.renderText([{ text: block.modern, kind: null }], block.terms, "modern"))) : null);
  }

  function paintSection() {
    if (!activeSection) return;
    const section = activeSection;
    glossary.onSection(section);
    const figures = section.figures || [];
    content.dataset.mode = book.has_modern ? mode : "original";
    fill(content,
      h("header", { class: "book-section-header" }, h("p", { class: "books-source" }, section.location),
        section.title !== section.location ? h("h2", null, section.title) : null,
        book.has_modern ? h("div", { class: "book-comparison-heading", "aria-hidden": "true" },
          h("span", null, "原文"), h("span", null, "白话")) : null,
        section.glossary?.length ? h("p", { class: "book-glossary-help" }, "点状下划线的词可悬停或点按查看释义。") : null),
      section.partial || section.notice ? h("aside", { class: "book-page-notice" },
        section.partial ? h("strong", null, "本页有疑缺或顺序待核。") : null,
        section.notice ? section.partial
          ? h("details", { class: "book-source-notice" }, h("summary", null, "原稿整理说明"), h("p", null, section.notice))
          : h("p", null, section.notice) : null) : null,
      section.page_notes?.length ? h("details", { class: "book-notes book-page-notes" },
        h("summary", null, `本页说明 · ${section.page_notes.length}`),
        section.page_notes.map(note => h("p", null, note))) : null,
      figures.map(renderFigure),
      section.blocks.length ? section.blocks.map(block => renderBlock(block, figures.length > 0))
        : h("p", null, figures.length ? "本页为书影内容，未录连续正文。" : "保留此页的来源位置，页面情况见上方说明。"));
    // Page notes were added after saved reading positions; keep existing content indices stable.
    [...content.children].filter(child => !child.classList.contains("book-page-notes"))
      .forEach((child, index) => child.dataset.readingAnchor = index);
    for (const block of content.querySelectorAll(".book-block")) {
      if (book.has_modern && !block.querySelector(".book-modern")) {
        block.append(h("span", { class: "book-modern-empty" }, "本段暂无白话，保留原文供阅读。"));
      }
    }
    fill(pagination,
      section.number > 1 ? h("a", { class: "btn btn-soft", rel: "prev", href: `#${readingPath(id, section.number - 1)}` }, "上一页") : h("span"),
      h("span", null, `${section.number} / ${book.section_count}`),
      section.number < book.section_count ? h("a", { class: "btn btn-soft", rel: "next", href: `#${readingPath(id, section.number + 1)}` }, "下一页") : h("span"));
    local.set(progressKey(id), String(section.number));
  }
  function go(number) {
    if (!book || number < 1 || number > book.section_count || number === activeSection?.number) return;
    savePosition(); ctx.navigate(readingPath(id, number));
  }
  function paintControls(number) {
    fill(controls,
      h("div", { class: "book-toolbar-main" },
      h("button", { type: "button", class: "btn btn-ghost book-page-prev", disabled: number <= 1, "aria-label": "上一页", onClick: () => go(number - 1) }, "←"),
      h("button", { type: "button", class: "btn btn-ghost book-directory",
        "aria-label": `打开${book.title}目录，当前第 ${number} ${book.has_modern ? "篇" : "页"}，共 ${book.section_count} ${book.has_modern ? "篇" : "页"}`,
        onClick: event => wideDirectory.matches ? setDirectory(!directoryOpen)
          : openBookContents({ book, contents, current: number, onSelect: go, returnFocus: event.currentTarget }) },
        icon("book"), h("span", null, `${book.title} · ${book.has_modern ? "目录" : "书页"}`), h("small", null, `${number} / ${book.section_count}`)),
      h("button", { type: "button", class: "btn btn-ghost book-settings-open", "aria-label": "字号与排版设置", onClick: event => openBookSettings({ preferences, mode, hasModern: false, returnFocus: event.currentTarget,
        onChange: (prefs, nextMode) => {
          const position = capturePosition(); preferences = readingPreferences(prefs); mode = nextMode;
          local.setJson("xz-book-preferences", preferences); local.set("xz-book-mode", mode); applyPreferences();
          requestAnimationFrame(() => annotations.onLayout());
          if (position) restorePosition(position);
        } }) }, "Aa", h("span", null, "设置")),
      h("button", { type: "button", class: "btn btn-ghost book-notes-open", "aria-label": "打开笔记与书签", onClick: event => annotations.openNotes(event.currentTarget) }, "笔记"),
      h("button", { type: "button", class: "btn btn-ghost book-page-next", disabled: number >= book.section_count, "aria-label": "下一页", onClick: () => go(number + 1) }, "→")),
      book.has_modern ? h("div", { class: "book-mode-switch", role: "group", "aria-label": "阅读模式" },
        [["original", "原文"], ["parallel", "对照"], ["modern", "白话"]].map(([value, label]) =>
          h("button", { type: "button", class: "book-mode-option", dataset: { bookMode: value },
            "aria-pressed": String(mode === value), onClick: () => setMode(value) }, label))) : null);
    syncDirectory();
  }
  async function openSection(number) {
    const token = ++request;
    saving = false;
    glossary.onSection(null);
    annotations.onSection(null);
    content.setAttribute("aria-busy", "true");
    controller.abort(); controller = new AbortController();
    fill(content, h("p", { role: "status" }, "正在打开正文…"));
    fill(pagination);
    try {
      const section = await get(`/api/books/${encodeURIComponent(id)}/sections/${number}`, { signal: controller.signal });
      if (!ctx.isCurrent() || token !== request) return;
      activeSection = section; paintSection(); paintControls(number); content.setAttribute("aria-busy", "false");
      sidebar?.destroy();
      sidebar = createBookSidebar({ book, contents, current: number, onSelect: go,
        onNotes: returnFocus => annotations.openNotes(returnFocus), onCollapse: () => setDirectory(false) });
      fill(sidebarSlot, sidebar.node);
      annotations.onSection(section);
      const position = readingPosition(local.json(positionKey(id)), book.section_count);
      requestAnimationFrame(() => {
        if (!ctx.isCurrent() || token !== request) return;
        if (pendingAnnotation) {
          const target = pendingAnnotation; pendingAnnotation = null;
          if (!annotations.locate(target)) window.scrollTo(0, window.scrollY + content.getBoundingClientRect().top - readingTop());
        } else if (typeof routeRestore === "number") window.scrollTo(0, routeRestore);
        else if (position?.number === number) restorePosition(position);
        else if (number > 1) window.scrollTo(0, window.scrollY + content.getBoundingClientRect().top - readingTop());
        routeRestore = null; saving = true; savePosition();
      });
    } catch (error) {
      if (!ctx.isCurrent() || token !== request || error?.name === "AbortError") return;
      content.setAttribute("aria-busy", "false");
      fill(content, errorView(error, () => openSection(number), { title: "这一页暂时没有打开" }));
    }
  }
  ctx.cleanup(() => controller.abort());
  const keyboard = event => {
    if (!activeSection || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
        document.body.classList.contains("is-locked") || event.target.closest?.("input, textarea, select, button, a, [role=button], [contenteditable=true], pre")) return;
    if (window.getSelection()?.toString()) return;
    if (event.key === "ArrowLeft") { event.preventDefault(); go(activeSection.number - 1); }
    if (event.key === "ArrowRight") { event.preventDefault(); go(activeSection.number + 1); }
  };
  document.addEventListener("keydown", keyboard);
  ctx.cleanup(() => document.removeEventListener("keydown", keyboard));
  const life = lifecycle(ctx, ({ phase, data, error }) => {
    if (phase === "loading") { savePosition(); saving = false; glossary.onSection(null); content.setAttribute("aria-busy", "true"); fill(content, h("p", { role: "status" }, "正在打开书籍…")); return; }
    if (phase === "error") { content.setAttribute("aria-busy", "false"); fill(content, errorView(error, refresh, { title: "这本书暂时没有打开" })); return; }
    book = data.book;
    contents = data.contents;
    detailCache.set(id, data);
    ctx.setTitle(`${book.title} · 典籍书库`);
    const state = { first_pass: "待校勘", working_draft: "有疑缺", unavailable: "待恢复" }[book.status];
    fill(heading,
      backLink,
      h("div", { class: "book-reading-identity" }, h("h1", null, book.title),
        state ? h("span", { class: "book-reading-state" }, state) : null),
      h("button", { type: "button", class: "btn book-edition-open", "aria-haspopup": "dialog", onClick: event =>
        openSheet({ title: `${book.title} · 版本与整理说明`, className: "sheet-book-edition", returnFocus: event.currentTarget,
          body: h("div", { class: "book-edition" },
            h("p", { class: "books-notice" }, `${BOOK_SYSTEM[book.system]} · ${BOOK_STATUS[book.status]}`),
            h("p", { class: "books-source" }, book.source_label), h("p", { class: "books-notice" }, book.notice)) }) }, "版本说明"));
    if (!book.section_count) { content.setAttribute("aria-busy", "false"); fill(content, h("p", null, "电子成品待恢复，请先阅读其他书籍。")); return; }
    controls.hidden = false;
    const number = readingNumber(ctx.query.get("page") || local.get(progressKey(id), "1"), book.section_count);
    paintControls(number); applyPreferences();
    openSection(number);
  }, (path, options) => detailCache.has(id) ? Promise.resolve(detailCache.get(id)) : get(path, options));
  const refresh = () => { detailCache.delete(id); return life.loader.load(`/api/books/${encodeURIComponent(id)}`); };
  life.setRefresh(refresh); life.loader.load(`/api/books/${encodeURIComponent(id)}`);
  return { node, title: "典籍阅读", layout: "book-reader", onRestore(value) { routeRestore = value; } };
}

export function render(ctx) { return ctx.params.id ? reader(ctx) : library(ctx); }
