import { h, fill } from "../lib/dom.js?v=n36";
import { icon } from "../lib/icons.js?v=n36";
import { get } from "../lib/api.js?v=n36";
import { local, session } from "../lib/store.js?v=n36";
import { createKnowledgeLoader } from "../lib/knowledge.js?v=n36";
import { BOOK_STATUS, BOOK_SYSTEM, readingPath, readingNumber, filterBooks, readingPreferences, readingPosition, sourceBreaks,
  TEXT_ROLES, TEXT_COMPLETENESS, TEXT_COLLATION, textVersionPath, textExportPath,
  READING_KINDS, textReadingTarget, groupReadingSections, textReadingPosition, readingBlockText,
  readingCharacterLength, readingCharacterAnchor } from "../lib/books.js?v=n36";
import { errorView, stateView } from "../ui/bits.js?v=n36";
import { openBookImage } from "../ui/book-image.js?v=n36";
import { createBookSidebar, openBookContents, openElectronicBookContents, openBookSettings } from "../ui/book-tools.js?v=n36";
import { openSheet } from "../ui/overlay.js?v=n36";
import { setupBookAnnotations } from "../ui/book-annotations.js?v=n36";
import { setupBookGlossary } from "../ui/book-glossary.js?v=n36";
import { createReadingMarkdownContext, focusReadingFootnote, renderEditionText } from "../lib/reading-markdown.js?v=n36";
import { bookCasesEntry } from "../lib/book-cases.js?v=n36";

const progressKey = id => `xz-book-progress:${id}`;
const positionKey = id => `xz-book-position:${id}`;
const textProgressKey = (id, version) => `xz-book-text-progress:${id}:${version}`;
const textRecentKey = id => `xz-book-text-recent:${id}`;
const detailCache = new Map();
const electronicCache = new Map();
const annotationNavigation = new Map();
const initialBookLocation = location.hash;
const reloadBookLocation = ["reload", "back_forward"].includes(window.performance?.getEntriesByType?.("navigation")?.[0]?.type);
let firstBookRender = true;

function caseLink(book, ctx) {
  const path = bookCasesEntry(book, ctx.query.get("from"));
  return path ? h("a", { class: "book-cases-entry", href: `#${path}` }, "本书案例与推演") : null;
}

function lifecycle(ctx, paint, request) {
  const loader = createKnowledgeLoader(state => { if (ctx.isCurrent()) paint(state); }, request);
  let refresh = () => {};
  const reconnect = () => refresh();
  window.addEventListener("online", reconnect);
  ctx.cleanup(() => { loader.destroy(); window.removeEventListener("online", reconnect); });
  return { loader, setRefresh(fn) { refresh = fn; ctx.onRefresh(fn); } };
}

function library(ctx) {
  const learning = ctx.query.get("view") === "learning";
  const views = h("nav", { class: "books-views", "aria-label": "书库视图" },
    h("a", { href: "#/books", "aria-current": learning ? null : "page" }, "全部书籍"),
    h("a", { href: "#/books?view=learning", "aria-current": learning ? "page" : null }, "学习路线"),
    h("a", { href: learning ? "#/book-cases?from=learning" : "#/book-cases" }, "案例与推演"));
  if (learning) return learningLibrary(ctx, views);
  let books = null;
  const results = h("div", { class: "books-grid" });
  const count = h("p", { class: "books-count", role: "status", "aria-live": "polite" });
  const search = h("input", { type: "search", placeholder: "搜索书名", "aria-label": "搜索书名" });
  const recent = h("div", { class: "books-recent" });
  const filters = local.json("xz-book-filters", {});
  search.value = typeof filters?.query === "string" ? filters.query : "";
  let system = Object.hasOwn(BOOK_SYSTEM, filters?.system) ? filters.system : "";
  let sort = filters?.sort === "catalog" ? "catalog" : "recent";
  function choices(name, label, accessibleLabel, options, selected, change) {
    return h("div", { class: "books-filter-group" }, h("span", { class: "books-filter-label" }, label),
      h("div", { class: "books-filter-options", role: "group", "aria-label": accessibleLabel },
        options.map(([value, text]) => h("label", { class: "books-filter-choice" },
          h("input", { type: "radio", name, value, checked: value === selected,
            onChange: event => { if (event.currentTarget.checked) { change(value); paintBooks(); } } }),
          h("span", null, text)))));
  }
  const systems = choices("book-system", "体系", "筛选典籍体系", [["", "全部"], ...Object.entries(BOOK_SYSTEM)], system, value => { system = value; });
  const sorts = choices("book-sort", "排序", "书籍排序", [["recent", "最近阅读优先"], ["catalog", "书库顺序"]], sort, value => { sort = value; });
  const filterState = h("small");
  const wideFilters = window.matchMedia("(min-width: 900px)");
  const filterDetails = h("details", { class: "books-filter-details", open: wideFilters.matches },
    h("summary", null, icon("sliders"), "筛选与排序", filterState),
    h("div", { class: "books-filter-fields" }, systems, sorts));
  const syncFilters = () => { filterDetails.open = wideFilters.matches; };
  wideFilters.addEventListener("change", syncFilters);
  ctx.cleanup(() => wideFilters.removeEventListener("change", syncFilters));
  const node = h("div", { class: "books-library" },
    views, recent, h("div", { class: "books-filters" }, search, filterDetails), count, results);
  function paintBooks() {
    local.setJson("xz-book-filters", { query: search.value, system, sort });
    filterState.textContent = `${BOOK_SYSTEM[system] || "全部"} · ${sort === "recent" ? "最近阅读" : "书库顺序"}`;
    if (!books) return;
    const rows = filterBooks(books, search.value, system);
    const position = book => readingPosition(local.json(positionKey(book.id)), book.section_count);
    const textPosition = book => textReadingPosition(local.json(textRecentKey(book.id)));
    const updated = book => Math.max(position(book)?.updatedAt || 0, textPosition(book)?.updatedAt || 0);
    if (sort === "recent") rows.sort((a, b) => updated(b) - updated(a));
    const latest = books.filter(book => updated(book)).sort((a, b) => updated(b) - updated(a))[0];
    const textSaved = latest && textPosition(latest);
    const latestIsText = textSaved && textSaved.updatedAt >= (position(latest)?.updatedAt || 0);
    fill(recent, latest ? latestIsText ? h("a", { class: "books-resume", href: `#${textVersionPath(latest.id, textSaved.versionId, textSaved.sectionId, { resume: true })}` },
      icon("book"), h("span", null, h("small", null, "继续阅读"), h("b", null, latest.title)), h("span", null, `${textSaved.title} →`))
      : h("a", { class: "books-resume", href: `#${readingPath(latest.id, position(latest).number)}` },
        icon("book"), h("span", null, h("small", null, "继续历史阅读稿"), h("b", null, latest.title)),
        h("span", null, `历史稿第 ${position(latest).number} ${latest.has_modern ? "篇" : "页"} →`)) : null);
    count.textContent = `共 ${rows.length} 本`;
    fill(results, rows.length ? rows.map(book => {
      const saved = textPosition(book);
      const catalogPath = textVersionPath(book.id);
      const openPath = saved ? textVersionPath(book.id, saved.versionId, saved.sectionId, { resume: true }) : textVersionPath(book.id, "current");
      return h("article", { class: "books-card books-library-card" },
        h("div", { class: "books-card-copy" },
          h("div", { class: "books-card-meta" }, BOOK_SYSTEM[book.system]),
          h("h2", null, h("a", { href: `#${catalogPath}` }, book.title)),
          book.summary ? h("p", { class: "books-card-summary" }, book.summary) : null,
          saved ? h("p", { class: "books-card-progress" }, `读到：${saved.title}`) : null,
          caseLink(book, ctx)),
        h("a", { class: "btn btn-soft books-electronic-open", href: `#${openPath}`, "aria-label": `${saved ? "继续阅读" : "阅读"}${book.title}` },
          icon("book"), saved ? "继续" : "阅读"));
    }) : stateView({ glyph: "search", title: "没有匹配的书籍", text: "试试其他书名，或切换体系。" }));
  }
  search.addEventListener("input", paintBooks);
  const life = lifecycle(ctx, ({ phase, data, error }) => {
    results.setAttribute("aria-busy", String(phase === "loading"));
    if (phase !== "ready") { books = null; count.textContent = ""; }
    if (phase === "loading") { fill(results, h("p", { role: "status" }, "正在打开书库…")); return; }
    if (phase === "error") { fill(results, errorView(error, refresh, { title: "书库暂时没有打开" })); return; }
    books = data.books;
    paintBooks();
  });
  const refresh = () => life.loader.load("/api/books");
  life.setRefresh(refresh); refresh();
  return { node, title: "典籍书库" };
}

function learningLibrary(ctx, views) {
  const content = h("div", { class: "book-learning-paths" });
  const node = h("div", { class: "books-library" }, views, content);
  const life = lifecycle(ctx, ({ phase, data, error }) => {
    content.setAttribute("aria-busy", String(phase === "loading"));
    if (phase === "loading") { fill(content, h("p", { role: "status" }, "正在打开学习路线…")); return; }
    if (phase === "error") { fill(content, errorView(error, refresh, { title: "学习路线暂时没有打开" })); return; }
    const paths = data.learning_paths || [];
    fill(content, paths.length ? paths.map(path => h("section", { class: "book-learning-track", "aria-label": path.title },
      h("h2", null, path.title),
      h("ol", { class: "book-learning-steps" }, path.nodes.map((step, index) => h("li", null,
        h("div", { class: "book-learning-node" },
          h("h3", null, step.books.map(book => h("a", { href: `#${book.path}${book.path.includes("?") ? "&" : "?"}from=learning` }, book.title))),
          h("p", null, step.title)),
        index < path.nodes.length - 1 ? icon("arrowRight", "book-learning-arrow") : null)))))
      : stateView({ glyph: "book", title: "学习路线尚未开放", text: "可以先在全部书籍中选择阅读。" }));
  });
  const refresh = () => life.loader.load("/api/books");
  life.setRefresh(refresh); refresh();
  return { node, title: "学习路线 · 典籍书库" };
}

function bookLinks(ctx) {
  const learning = ctx.query.get("from") === "learning";
  const carry = path => learning ? `${path}${path.includes("?") ? "&" : "?"}from=learning` : path;
  return {
    libraryPath: learning ? "#/books?view=learning" : "#/books",
    libraryLabel: learning ? "返回学习路线" : "返回书库",
    reading: (...args) => carry(readingPath(...args)),
    text: (...args) => carry(textVersionPath(...args)),
    back: () => h("a", { class: "book-reading-back", href: learning ? "#/books?view=learning" : "#/books",
      "aria-label": learning ? "返回学习路线" : "返回典籍书库" }, icon("back"), h("span", null, learning ? "学习路线" : "书库")),
  };
}

function reader(ctx) {
  const id = ctx.params.id;
  const links = bookLinks(ctx);
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
  const backLink = links.back();
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
        ctx.navigate(links.reading(id, annotation.section_number));
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
      section.number > 1 ? h("a", { class: "btn btn-soft", rel: "prev", href: `#${links.reading(id, section.number - 1)}` }, "上一页") : h("span"),
      h("span", null, `${section.number} / ${book.section_count}`),
      section.number < book.section_count ? h("a", { class: "btn btn-soft", rel: "next", href: `#${links.reading(id, section.number + 1)}` }, "下一页") : h("span"));
    local.set(progressKey(id), String(section.number));
  }
  function go(number) {
    if (!book || number < 1 || number > book.section_count || number === activeSection?.number) return;
    savePosition(); ctx.navigate(links.reading(id, number));
  }
  function paintControls(number) {
    fill(controls,
      h("div", { class: "book-toolbar-main" },
      h("button", { type: "button", class: "btn btn-ghost book-page-prev", disabled: number <= 1, "aria-label": "上一页", onClick: () => go(number - 1) }, "←"),
      h("button", { type: "button", class: "btn btn-ghost book-directory",
        "aria-label": `打开${book.title}目录，当前第 ${number} ${book.has_modern ? "篇" : "页"}，共 ${book.section_count} ${book.has_modern ? "篇" : "页"}`,
        onClick: event => wideDirectory.matches ? setDirectory(!directoryOpen)
          : openBookContents({ book, contents, current: number, onSelect: go, returnFocus: event.currentTarget,
            libraryPath: links.libraryPath, libraryLabel: links.libraryLabel }) },
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
        libraryPath: links.libraryPath, libraryLabel: links.libraryLabel,
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
            h("p", { class: "books-source" }, book.source_label), h("p", { class: "books-notice" }, book.notice),
            h("a", { href: `#${links.text(id)}` }, "电子文字版本、章节引用与下载")) }) }, "版本说明"),
      h("a", { class: "btn btn-soft", href: `#${links.text(id)}` }, "电子文字与下载"), caseLink(book, ctx));
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

function electronicReader(ctx, resumeOnReload = false) {
  const id = ctx.params.id;
  const links = bookLinks(ctx);
  const versionId = ctx.query.get("text-version");
  const isCurrent = versionId === "current";
  const isCatalog = versionId === "catalog" || isCurrent;
  let routeRestore = null;
  let activeReading = null;
  let saving = false;
  let saveTimer;
  let settingsTimer;
  let editionCleanup = () => {};
  ctx.cleanup(() => editionCleanup());
  let preferences = readingPreferences(local.json("xz-book-preferences"));
  const body = h("div");
  const node = h("div", { class: `book-electronic${isCatalog ? "" : " book-electronic-reader"}` }, body);
  const readingTop = () => (parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--topbar-h")) || 64) +
    (activeReading?.controls.offsetHeight || 0) +
    (activeReading?.header && getComputedStyle(activeReading.header).position === "sticky" ? activeReading.header.offsetHeight : 0) + 16;
  function capturePosition() {
    if (!activeReading) return null;
    const { section, article } = activeReading;
    const position = { versionId, sectionId: section.id, title: section.title, updatedAt: Date.now(), punctuation: activeReading.punctuation };
    if (window.scrollY <= 0) return position;
    const anchors = [...article.querySelectorAll("[data-reading-anchor]")];
    const visible = anchor => !anchor.closest("details:not([open])") && anchor.getBoundingClientRect().height > 0;
    const top = readingTop();
    let index = anchors.findIndex(anchor => visible(anchor) && anchor.getBoundingClientRect().bottom > top);
    if (index < 0) index = anchors.findLastIndex(visible);
    const rect = anchors[index]?.getBoundingClientRect();
    const block = anchors[index]?.closest("[data-block-id]");
    const blockAnchors = anchors.filter(anchor => anchor.closest("[data-block-id]") === block);
    return rect ? { ...position, anchor: index, offset: Math.max(0, Math.min(1, (top - rect.top) / rect.height)),
      ...(block ? { blockId: block.dataset.blockId, blockAnchor: blockAnchors.indexOf(anchors[index]) } : {}) } : position;
  }
  function savePosition() {
    if (!saving || document.body.classList.contains("is-locked")) return;
    const position = capturePosition();
    if (position) { local.setJson(textProgressKey(id, versionId), position); local.setJson(textRecentKey(id), position); }
  }
  function restorePosition(position) {
    if (!position || !activeReading || position.sectionId !== activeReading.section.id) return;
    const anchors = [...activeReading.article.querySelectorAll("[data-reading-anchor]")];
    const anchor = position.blockId ? anchors.filter(item => item.closest("[data-block-id]")?.dataset.blockId === position.blockId)[position.blockAnchor || 0]
      : anchors[position.anchor];
    if (!anchor || anchor.closest("details:not([open])")) { window.scrollTo(0, 0); return; }
    const rect = anchor.getBoundingClientRect();
    window.scrollTo(0, Math.max(0, window.scrollY + rect.top + rect.height * position.offset - readingTop()));
  }
  const trackScroll = () => { clearTimeout(saveTimer); saveTimer = setTimeout(savePosition, 250); };
  const keepLinkPosition = event => {
    const link = event.target.closest?.('a[href^="#/"]');
    if (event.button !== 0 || !link) return;
    // Focusing a sticky navigation link can move Chrome to its layout position
    // before route cleanup saves the paragraph. Keep the actual reading place.
    event.preventDefault(); link.focus({ preventScroll: true });
  };
  if (!isCatalog) {
    window.addEventListener("scroll", trackScroll, { passive: true });
    window.addEventListener("pagehide", savePosition);
    document.addEventListener("mousedown", keepLinkPosition, true);
    ctx.cleanup(() => { savePosition(); clearTimeout(saveTimer); clearTimeout(settingsTimer); window.removeEventListener("scroll", trackScroll); window.removeEventListener("pagehide", savePosition); document.removeEventListener("mousedown", keepLinkPosition, true); });
  }
  const sourceLink = (url, label) => h("a", { href: url, target: "_blank", rel: "noopener noreferrer" }, label);
  const downloadLinks = (version, chapter = "") => h("nav", { class: "book-text-downloads", "aria-label": chapter ? "来源章节下载" : "全本文本下载" },
    [["md", "Markdown"], ["txt", "TXT"]].map(([format, label]) =>
      h("a", { class: "btn btn-soft", href: textExportPath(id, version, format, chapter), download: "" }, label)));
  function paintInventory(data) {
    const primary = data.versions.find(version => version.availability === "available");
    const saved = textReadingPosition(local.json(textRecentKey(id)));
    if (isCurrent && primary) {
      ctx.navigate(links.text(id, primary.version_id, saved?.versionId === primary.version_id ? saved.sectionId : "",
        { resume: saved?.versionId === primary.version_id }), { replace: true });
      return;
    }
    const versionCard = (version, preferred = false) => {
      const available = version.availability === "available";
      const continuing = available && saved?.versionId === version.version_id;
      return h("section", { class: `books-card book-version-card${preferred ? " book-version-primary" : ""}` },
        h("h2", null, preferred ? "当前阅读版" : version.title),
        h("p", { class: "book-quality-brief" }, `${TEXT_COMPLETENESS[version.completeness]} · ${TEXT_COLLATION[version.collation_status]}`),
        available ? h("a", { class: preferred ? "btn btn-primary" : "btn btn-soft", href: `#${links.text(id, version.version_id,
          continuing ? saved.sectionId : "", { resume: continuing })}` }, continuing ? "继续阅读" : "开始阅读")
          : h("p", { class: "books-notice" }, version.availability === "candidate_only" ? "尚未收录正文" : "正文待导入"),
        h("details", { class: "book-version-details" }, h("summary", null, "版本、来源与下载"),
          preferred ? h("p", null, version.title) : null,
          h("p", null, version.edition_statement), version.missing.map(item => h("p", null, item)),
          h("p", null, sourceLink(version.source_url, "查看来源")), available ? downloadLinks(version.version_id) : null));
    };
    const others = data.versions.filter(version => version !== primary);
    const publishedBook = data.publishedBook;
    const hasHistorical = publishedBook?.section_count > 0;
    fill(body, links.back(),
      h("header", { class: "books-hero" }, h("h1", null, data.title), h("p", null, "疑字、缺文与原注保留，版本详情可展开查看。")),
      (hasHistorical && publishedBook.has_modern) || bookCasesEntry(publishedBook)
        ? h("nav", { class: "book-edition-shortcuts", "aria-label": "其他阅读入口" },
          hasHistorical && publishedBook.has_modern ? h("a", { href: `#${links.reading(id)}` }, `${publishedBook.source_label} · 原文白话对照`) : null,
          caseLink(publishedBook, ctx)) : null,
      primary ? versionCard(primary, true) : stateView({ glyph: "book", title: "此书尚无可读文字版本", text: "正文收录后会在这里列出。" }),
      others.length ? h("details", { class: "book-source-notice book-other-versions" }, h("summary", null, `其他版本（${others.length}）`),
        others.map(version => versionCard(version))) : null,
      h("details", { class: "book-source-notice" }, h("summary", null, "收录说明"),
        h("p", null, data.gap_note), hasHistorical && !publishedBook.has_modern
          ? h("p", null, h("a", { href: `#${links.reading(id)}` }, `${publishedBook.source_label} · 原文阅读稿`)) : null));
  }
  function paintEdition({ edition: data, reading, publishedBook }) {
    editionCleanup();
    const sections = reading.sections;
    const requested = ctx.query.get("chapter");
    const stored = textReadingPosition(local.json(textProgressKey(id, versionId)));
    const saved = stored?.versionId === versionId ? stored : null;
    const { index, position } = textReadingTarget(reading, { requested, saved,
      resume: ctx.query.get("resume") === "1" || resumeOnReload, footnote: ctx.query.get("footnote") });
    const section = sections[index];
    const sequence = section ? sections.filter(item => item.kind === section.kind) : [];
    const sequenceIndex = sequence.findIndex(item => item.id === section?.id);
    const path = item => links.text(id, versionId, item.id);
    const navigationSections = sections.filter(item => item.kind !== "notes" || item.id === section?.id);
    const hasPunctuation = sections.some(item => item.blocks.some(block => typeof block.punctuated_text === "string"));
    const sectionHasPunctuation = section?.blocks.some(block => typeof block.punctuated_text === "string");
    const actualPunctuation = () => sectionHasPunctuation && preferences.punctuation !== "source" ? "punctuated" : "source";
    // Records saved before editorial punctuation existed use source paragraphs.
    // Recover their original words before mapping to the preferred paragraphing.
    const savedPunctuation = position?.punctuation || "source";
    const remapResume = Number.isSafeInteger(position?.anchor) && savedPunctuation !== actualPunctuation();
    let renderingPunctuation = remapResume ? savedPunctuation : preferences.punctuation;
    const makeMarkdownContext = () => createReadingMarkdownContext(section?.blocks.map(block => readingBlockText(block, renderingPunctuation)) || [], {
      chapters: sections.map(item => ({ ...item, blocks: item.blocks.map(block => ({ ...block, text: readingBlockText(block, renderingPunctuation) })) })),
      chapterId: section?.id, bookId: id,
      footnotePath: (chapterId, label) => `${links.text(id, versionId, chapterId)}&footnote=${encodeURIComponent(label)}`,
      navigate: route => ctx.navigate(route),
    });
    let markdownContext = makeMarkdownContext();
    const blockViews = [];
    const punctuationHint = sectionHasPunctuation ? h("span", { class: "book-punctuation-hint", hidden: preferences.punctuation === "source" }, "整理句读") : null;
    ctx.setTitle(`${section ? section.title + " · " : ""}${reading.title}`);
    const quality = data.quality;
    const article = section ? h("article", { class: "book-reading-content book-text-projection", "aria-label": "书籍正文" },
      h("header", { class: "book-section-header" },
        h("p", { class: "book-section-kind" }, READING_KINDS[section.kind], punctuationHint),
        h("h2", null, section.title),
        section.source_location && section.source_location !== section.title ? h("p", { class: "book-section-location" }, section.source_location) : null),
      section.blocks.map(block => {
        if (block.role === "modern_editorial" && ["未辨片段", "原稿附注"].includes(block.label)) {
          const cue = h("aside", { class: "book-reading-source-cue", dataset: { blockId: block.id } }, readingBlockText(block, renderingPunctuation));
          blockViews.push({ block, node: cue, plain: true });
          return cue;
        }
        const folded = ["aside", "transcription"].includes(block.presentation) || block.role === "modern_editorial" && section.kind !== "notes";
        const label = block.label || (block.presentation === "aside" ? "栏外小注" : block.presentation === "transcription" ? "原稿杂注与未辨记录" : "整理说明");
        const text = h("div", { class: "book-original" }, renderEditionText(data.version_id, readingBlockText(block, renderingPunctuation), markdownContext));
        blockViews.push({ block, node: text, plain: false });
        const noteLabel = block.label || TEXT_ROLES[block.role];
        const compactNote = !folded && ["original_note", "commentary"].includes(block.role) && noteLabel.length <= 6 &&
          text.textContent.length <= 120 && text.querySelectorAll("p").length === 1 && !text.querySelector("pre, table, details");
        return h(folded ? "details" : "section",
          { class: `book-block${folded ? " book-folded-text" : ""}${["original_note", "commentary"].includes(block.role) ? " book-source-note" : ""}${compactNote ? " book-note-compact" : ""}`, dataset: { blockId: block.id } },
          folded ? h("summary", null, label) : null,
          !folded && ["original_note", "commentary"].includes(block.role) ? h("p", { class: "book-layer" }, block.label || TEXT_ROLES[block.role]) : null,
          text);
      }))
      : stateView({ glyph: "book", title: "此版本没有该章节", text: "请从目录选择章节，或返回版本页重新打开。" });
    const refineReadingLayout = () => {
      // A source heading may repeat the section name before its subdivision.
      // Keep the source characters in the DOM and downloads, showing the name
      // once in the section header and the remaining subdivision below it.
      const firstHeading = article.querySelector(".book-original > .book-reading-markdown > :first-child");
      const firstText = firstHeading?.firstChild;
      if (firstHeading?.matches("h3, h4, h5, h6") && firstText?.nodeType === Node.TEXT_NODE &&
          section?.title && firstText.textContent.startsWith(section.title)) {
        const rest = firstText.textContent.slice(section.title.length);
        const separator = rest.match(/^[、，：:\s]+/u)?.[0];
        if (separator && rest.slice(separator.length).trim()) {
          const prefix = h("span", { hidden: true }, section.title + separator);
          firstText.textContent = rest.slice(separator.length);
          firstHeading.prepend(prefix); firstHeading.classList.add("book-reading-subdivision");
        }
      }
      if (["bushi-zhengzong", "sanche-yilan"].includes(id)) article.querySelectorAll("pre.book-reading-literal-text").forEach(pre => {
        const rows = pre.textContent.trim().split(/\r?\n/u);
        const labels = id === "bushi-zhengzong" && rows.length >= 2 && rows.length <= 6 &&
          rows.every(row => /^(?:[子丑寅卯辰巳午未申酉戌亥](?:[ \t\u3000]+[子丑寅卯辰巳午未申酉戌亥][化伏])?|父母|兄弟|官鬼|妻[财財]|子[孙孫]|[父母兄弟才财財官鬼孙孫世应應])$/u.test(row.trim()));
        const stems = id === "sanche-yilan" && rows.length === 4 && rows.every(row => /^[甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥]$/u.test(row.trim()));
        if (labels || stems) {
          pre.classList.add("book-reading-compact-chart");
        }
      });
    };
    refineReadingLayout();
    // Some Bazi transcripts store a run of stem/branch pairs as separate
    // paragraphs. Reflow those exact blocks without inventing chart columns.
    if (["ditian-sui-chanwei", "sanche-yilan"].includes(id)) {
      let run = [];
      const finishRun = () => {
        if (run.length >= 4) {
          const group = h("div", { class: "book-stem-group", "aria-label": "原稿干支行" });
          run[0].before(group); group.append(...run);
        }
        run = [];
      };
      for (const child of [...article.children]) {
        const block = section?.blocks.find(item => item.id === child.dataset.blockId);
        if (block && ["original", "unclassified"].includes(block.role) &&
            /^(?:[甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥]){1,2}$/u.test(block.text.trim()) &&
            child.querySelectorAll(".book-original p").length === 1 && !child.querySelector("pre, table, details")) run.push(child);
        else finishRun();
      }
      finishRun();
    }
    if (id === "wuxing-jingji" && section?.id === "section-002-r-001") {
      const names = section.blocks.slice(0, 30);
      const nodes = names.map(block => [...article.children].find(child => child.dataset.blockId === block.id));
      if (names.length === 30 && names.every(block => /^\p{Script=Han}{6}[金木水火土]$/u.test(block.text.trim())) && nodes.every(Boolean)) {
        const list = h("div", { class: "book-nayin-list", "aria-label": "六十甲子纳音原录" });
        nodes[0].before(list); list.append(...nodes);
      }
    }
    const applyPreferences = () => {
      article.style.setProperty("--reading-size", `${preferences.size}px`);
      article.style.setProperty("--reading-line", preferences.line);
      article.style.setProperty("--reading-font", `var(--font-${preferences.font})`);
      article.dataset.paper = preferences.paper;
      article.dataset.layout = preferences.layout;
      if (punctuationHint) punctuationHint.hidden = preferences.punctuation === "source";
    };
    const markReadingAnchors = () => article.querySelectorAll(".book-original p, .book-original h3, .book-original h4, .book-original h5, .book-original h6, .book-original ul, .book-original ol, .book-original pre, .book-original table, .book-original .book-reading-stem-row, .book-reading-source-cue")
      .forEach((anchor, anchorIndex) => { anchor.dataset.readingAnchor = anchorIndex; });
    const characterStart = (view, anchor) => {
      if (view.node === anchor) return 0;
      const range = document.createRange();
      range.setStart(view.node, 0); range.setEndBefore(anchor);
      return readingCharacterLength(range.toString());
    };
    const capturePunctuationPosition = position => {
      const anchor = article.querySelectorAll("[data-reading-anchor]")[position?.anchor];
      const blockId = anchor?.closest("[data-block-id]")?.dataset.blockId;
      const view = blockViews.find(item => item.block.id === blockId);
      return view ? { blockId, character: characterStart(view, anchor) + readingCharacterLength(anchor.textContent) * position.offset } : null;
    };
    const punctuationPosition = (source, fallback) => {
      const view = blockViews.find(item => item.block.id === source?.blockId);
      if (!view) return fallback;
      const anchors = [view.node, ...view.node.querySelectorAll("[data-reading-anchor]")]
        .filter(anchor => anchor.hasAttribute("data-reading-anchor") && !anchor.closest("details:not([open])"));
      const target = readingCharacterAnchor(anchors.map(anchor => ({ anchor: Number(anchor.dataset.readingAnchor),
        start: characterStart(view, anchor), length: readingCharacterLength(anchor.textContent) })), source.character);
      const targetAnchor = anchors.find(anchor => Number(anchor.dataset.readingAnchor) === target?.anchor);
      return target ? { ...fallback, ...target, blockId: source.blockId, blockAnchor: anchors.indexOf(targetAnchor) } : fallback;
    };
    const paintPunctuation = () => {
      renderingPunctuation = preferences.punctuation;
      markdownContext = makeMarkdownContext();
      for (const view of blockViews) {
        const open = [...view.node.querySelectorAll("details")].map(details => details.open);
        fill(view.node, view.plain ? readingBlockText(view.block, renderingPunctuation)
          : renderEditionText(data.version_id, readingBlockText(view.block, renderingPunctuation), markdownContext));
        view.node.querySelectorAll("details").forEach((details, index) => { details.open = !!open[index]; });
      }
      refineReadingLayout();
      markReadingAnchors();
      updateOverflowHints();
      if (activeReading) { activeReading.markdownContext = markdownContext; activeReading.punctuation = actualPunctuation(); }
    };
    applyPreferences();
    const settings = h("button", { type: "button", class: "btn btn-soft book-settings-open", "aria-label": "阅读设置", onClick: event => {
      let readingPosition = capturePosition();
      const sourcePosition = capturePunctuationPosition(readingPosition);
      savePosition();
      openBookSettings({ preferences, mode: "original", hasModern: false, hasLayout: false, hasPunctuation, returnFocus: event.currentTarget,
        onChange: value => {
          const punctuationChanged = preferences.punctuation !== value.punctuation;
          preferences = readingPreferences(value); local.setJson("xz-book-preferences", preferences); applyPreferences();
          if (punctuationChanged) { paintPunctuation(); readingPosition = punctuationPosition(sourcePosition, readingPosition); }
          restorePosition(readingPosition);
        },
        onClose: reason => {
          if (reason === "route") return;
          // The sheet releases the body's scroll lock after its close animation.
          clearTimeout(settingsTimer); settingsTimer = setTimeout(() => { if (ctx.isCurrent()) { restorePosition(readingPosition); savePosition(); } }, 210);
        } });
    } },
      icon("sliders"), h("span", null, "阅读设置"));
    const directory = h("button", { type: "button", class: "btn btn-soft book-electronic-contents-open", "aria-label": "目录与搜索", "aria-haspopup": "dialog", onClick: event => {
      savePosition();
      openElectronicBookContents({ bookTitle: reading.title, sections: navigationSections, current: section?.id, returnFocus: event.currentTarget,
        onSelect: sectionId => { if (sectionId !== section?.id) ctx.navigate(links.text(id, versionId, sectionId)); } });
    } }, icon("book"), h("span", null, section?.title || "章节目录"),
      section ? h("small", null, `${sequenceIndex + 1} / ${sequence.length}`) : null, icon("chevronDown"));
    const rows = h("nav", { class: "book-electronic-contents", "aria-label": "章节目录" });
    const search = h("input", { type: "search", placeholder: "搜索目录", "aria-label": "搜索章节目录" });
    let contentsFrame;
    const positionContents = () => {
      cancelAnimationFrame(contentsFrame);
      contentsFrame = requestAnimationFrame(() => {
        if (!ctx.isCurrent() || search.value.trim() || !rows.clientHeight) return;
        const current = rows.querySelector('[aria-current="page"]');
        if (!current) return;
        const rect = rows.getBoundingClientRect();
        const scale = rows.offsetHeight ? rect.height / rows.offsetHeight : 1;
        const top = (current.getBoundingClientRect().top - rect.top) / (scale || 1) + rows.scrollTop;
        rows.scrollTop = Math.max(0, top - (rows.clientHeight - current.offsetHeight) / 2);
      });
    };
    const paintContents = () => {
      const filtered = groupReadingSections(navigationSections, search.value);
      fill(rows, filtered.length ? filtered.map(group => h("details", { class: "book-electronic-group", open: group.kind === "body" || group.kind === section?.kind || !!search.value.trim() },
        h("summary", null, group.title, h("small", null, group.sections.length)),
        group.sections.map(item => h("a", { href: `#${path(item)}`, "aria-current": item.id === section?.id ? "page" : null }, item.title))))
        : h("p", { class: "books-notice" }, "没有匹配的章节"));
      positionContents();
    };
    search.addEventListener("input", paintContents); paintContents();
    const sidebar = h("aside", { class: "book-electronic-sidebar", "aria-label": `${reading.title}目录` },
      h("div", { class: "book-electronic-sidebar-head" }, h("b", null, "目录"), h("span", null, `${navigationSections.length} 节`)), search, rows);
    const versionDetails = h("details", { class: "book-source-notice book-electronic-details" },
      h("summary", null, "版本、来源与下载"),
      h("p", null, data.title), h("p", null, data.edition_statement),
      h("p", null, quality.scope_note), quality.missing.map(item => h("p", null, item)),
      h("p", null, data.relationship_to_archive),
      data.sources.map(source => h("p", null, sourceLink(source.url, source.title), ` · ${source.attribution}`,
        source.revision_url ? sourceLink(source.revision_url, "固定修订") : null)),
      h("p", null, sourceLink(data.license.url, data.license.name), ` · ${data.license.attribution}`),
      h("p", null, data.license.reuse_basis), h("p", null, data.license.notice),
      h("p", null, data.license.share_alike ? "适用相同方式共享义务；正文许可独立于项目代码许可。" : "正文许可独立于项目代码许可。"),
      data.changes.map(change => h("p", null, change)),
      sections.some(item => item.kind === "notes") ? h("details", { class: "book-edition-notes" },
        h("summary", null, "整理校记与逐章来源"),
        h("ul", null, sections.filter(item => item.kind === "notes").map(item =>
          h("li", null, h("a", { href: `#${path(item)}` }, item.title))))) : null,
      h("p", null, "下载本版本完整原稿（包含来源说明与校记）："), downloadLinks(versionId),
      h("p", null, h("a", { href: `#${links.text(id)}` }, "查看其他版本")));
    const citation = section ? h("details", { class: "book-source-notice book-section-source" }, h("summary", null, "本节来源与引用"),
      h("p", { class: "book-text-citation" }, h("code", null, `${id}/${versionId}/${section.id}`)),
      h("p", null, "下载对应的完整来源章节（可能包含相邻小节）："),
      (section.source_chapter_ids?.length ? section.source_chapter_ids : [section.source_chapter_id]).map(chapterId =>
        h("div", { class: "book-source-chapter-download" }, h("p", null, h("code", null, chapterId)), downloadLinks(versionId, chapterId)))) : null;
    const controls = h("nav", { class: "book-reading-controls book-electronic-controls", "aria-label": "阅读工具", onMouseDown: event => {
      const button = event.target.closest?.("button:not([disabled])");
      if (event.button === 0 && button) { event.preventDefault(); button.focus({ preventScroll: true }); }
    } }, directory, settings);
    const desktopSettings = h("div", { class: "book-desktop-settings" });
    const header = h("header", { class: "book-reading-header book-electronic-header" },
      links.back(),
      h("div", { class: "book-reading-identity" }, h("h1", null, reading.title),
        h("span", { class: "book-reading-state" }, `${TEXT_COMPLETENESS[quality.completeness]} · ${TEXT_COLLATION[quality.collation_status]}`)),
      caseLink(publishedBook, ctx), desktopSettings);
    fill(body,
      header,
      h("div", { class: "book-electronic-layout" }, sidebar,
        h("div", { class: "book-electronic-main" },
          controls,
          article,
          section ? h("nav", { class: "book-reading-pagination book-electronic-pagination", "aria-label": "章节翻页" },
            sequenceIndex > 0 ? h("a", { href: `#${path(sequence[sequenceIndex - 1])}` }, h("small", null, "上一节"), h("span", null, sequence[sequenceIndex - 1].title)) : h("span"),
            h("span", { class: "book-section-count" }, `${READING_KINDS[section.kind]} ${sequenceIndex + 1} / ${sequence.length}`),
            sequenceIndex + 1 < sequence.length ? h("a", { href: `#${path(sequence[sequenceIndex + 1])}` }, h("small", null, "下一节"), h("span", null, sequence[sequenceIndex + 1].title)) : h("span")) : null,
          citation, versionDetails)));
    const wideDirectory = window.matchMedia("(min-width: 1100px)");
    const syncTools = () => {
      (wideDirectory.matches ? desktopSettings : controls).append(settings);
      node.style.setProperty("--book-header-height", `${header.offsetHeight}px`);
      positionContents();
    };
    const updateOverflowHints = () => {
      article.querySelectorAll("pre.book-reading-literal-diagram, .book-reading-table").forEach(element => {
        let frame = element.parentElement;
        if (!frame.classList.contains("book-overflow-frame")) {
          frame = h("div", { class: "book-overflow-frame" }); element.before(frame); frame.append(element);
        }
        frame.classList.toggle("book-has-overflow", element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1);
      });
    };
    const layoutObserver = typeof ResizeObserver === "function" ? new ResizeObserver(() => {
      if (header.isConnected) node.style.setProperty("--book-header-height", `${header.offsetHeight}px`);
      positionContents();
      updateOverflowHints();
    }) : null;
    layoutObserver?.observe(header); layoutObserver?.observe(rows); layoutObserver?.observe(article);
    wideDirectory.addEventListener("change", syncTools);
    editionCleanup = () => { layoutObserver?.disconnect(); wideDirectory.removeEventListener("change", syncTools); cancelAnimationFrame(contentsFrame); };
    syncTools(); updateOverflowHints();
    markReadingAnchors();
    activeReading = section ? { article, controls, header, section, markdownContext, punctuation: actualPunctuation() } : null;
    if (remapResume) {
      const sourcePosition = capturePunctuationPosition(position);
      paintPunctuation();
      routeRestore = null;
      return punctuationPosition(sourcePosition, position);
    }
    return position;
  }
  const basePath = `/api/books/${encodeURIComponent(id)}/text-versions${isCatalog ? "" : `/${encodeURIComponent(versionId)}`}`;
  const request = async (path, options) => {
    if (isCurrent) return get(path, options);
    if (isCatalog) {
      const [inventory, catalogue] = await Promise.all([get(path, options), get("/api/books", options)]);
      return { ...inventory, publishedBook: catalogue.books.find(book => book.id === id) };
    }
    if (electronicCache.has(path)) return electronicCache.get(path);
    const [edition, reading, catalogue] = await Promise.all([get(path, options), get(`${path}/reading`, options), get("/api/books", options)]);
    const result = { edition, reading, publishedBook: catalogue.books.find(book => book.id === id) };
    if (!options.signal.aborted) {
      electronicCache.set(path, result);
      if (electronicCache.size > 3) electronicCache.delete(electronicCache.keys().next().value);
    }
    return result;
  };
  const life = lifecycle(ctx, ({ phase, data, error }) => {
    body.setAttribute("aria-busy", String(phase === "loading"));
    if (phase === "loading") { saving = false; fill(body, h("p", { role: "status" }, "正在打开书籍…")); return; }
    if (phase === "error") { saving = false; fill(body, errorView(error, refresh, { title: "书籍暂时没有打开" })); return; }
    const position = isCatalog ? (paintInventory(data), null) : paintEdition(data);
    // A history entry may return after its edition has left the small cache.
    // Restore only after the async text exists; explicit footnotes take priority.
    const restore = routeRestore;
    routeRestore = null;
    requestAnimationFrame(() => {
      if (!ctx.isCurrent()) return;
      if (ctx.query.get("footnote") && activeReading) focusReadingFootnote(activeReading.markdownContext, ctx.query.get("footnote"));
      else if (typeof restore === "number") window.scrollTo(0, restore);
      else if (position) restorePosition(position);
      saving = !!activeReading; savePosition();
    });
  }, request);
  const refresh = () => { savePosition(); routeRestore = window.scrollY; electronicCache.delete(basePath); life.loader.load(basePath); };
  life.setRefresh(refresh); life.loader.load(basePath);
  return { node, title: "典籍阅读", onRestore(value) { routeRestore = value; }, ...(!isCatalog ? { layout: "book-reader" } : {}) };
}

export function render(ctx) {
  const resumeOnReload = firstBookRender && reloadBookLocation && location.hash === initialBookLocation;
  firstBookRender = false;
  return ctx.params.id ? ctx.query.get("text-version") ? electronicReader(ctx, resumeOnReload) : reader(ctx) : library(ctx);
}
