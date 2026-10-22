import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readBookCaseQuery, bookCaseListPath, bookCaseDetailPath, bookCaseApiPath,
  bookCasesEntry, bookCaseReadingPath, bookCaseKindLabel } from "../web/public/next/lib/book-cases.js";

test("case queries preserve book, paging and learning context while API calls use only public parameters", () => {
  const filter = readBookCaseQuery(new URLSearchParams("book_id=ziping-zhenquan&offset=24&limit=12&from=learning"));
  assert.deepEqual(filter, { book_id: "ziping-zhenquan", kind: "", offset: 24, limit: 12, from: "learning" });
  assert.equal(bookCaseListPath(filter), "/book-cases?book_id=ziping-zhenquan&offset=24&limit=12&from=learning");
  assert.equal(bookCaseListPath(filter, { book_id: "ditian-sui", offset: 0 }), "/book-cases?book_id=ditian-sui&limit=12&from=learning");
  assert.equal(bookCaseDetailPath("display-example", filter), "/book-cases/display-example?book_id=ziping-zhenquan&offset=24&limit=12&from=learning");
  assert.equal(bookCaseApiPath(filter), "/api/book-cases?book_id=ziping-zhenquan&offset=24&limit=12");
  assert.deepEqual(readBookCaseQuery(new URLSearchParams("book_id=../private&offset=-1&limit=999&from=other")),
    { book_id: "", kind: "", offset: 0, limit: 24, from: "" });
  assert.equal(bookCaseApiPath({}), "/api/book-cases?offset=0&limit=24");
  const contract = JSON.parse(readFileSync(new URL("../contracts/openapi/client.openapi.json", import.meta.url), "utf8"));
  assert.deepEqual(contract.paths["/api/book-cases"].get.parameters.map(item => item.name), ["book_id", "kind", "offset", "limit"]);
  assert.ok(contract.paths["/api/book-cases/{case_id}"].get);
  assert.ok(contract.paths["/api/book-cases/{case_id}/chart"].get);
  const detail = contract.components.schemas.ClientBookCaseDetail.properties;
  assert.deepEqual(detail.study_format.enum, ["case", "source_mention"]);
  assert.deepEqual(detail.chart_status.enum, ["available", "incomplete", "not_applicable"]);
  assert.equal(detail.related_case_ids.items.type, "string");
});

test("kind filters retain the source category through paging, detail and return while ignoring invalid values", () => {
  const filter = readBookCaseQuery(new URLSearchParams("book_id=ziping-zhenquan&kind=hypothetical&offset=24&from=learning"));
  assert.equal(bookCaseApiPath(filter), "/api/book-cases?book_id=ziping-zhenquan&kind=hypothetical&offset=24&limit=24");
  assert.equal(bookCaseDetailPath("source-mention", filter), "/book-cases/source-mention?book_id=ziping-zhenquan&kind=hypothetical&offset=24&from=learning");
  assert.equal(bookCaseListPath(filter, { offset: 48 }), "/book-cases?book_id=ziping-zhenquan&kind=hypothetical&offset=48&from=learning");
  assert.equal(bookCaseKindLabel("hypothetical"), "假设推演");
  assert.equal(bookCaseKindLabel("rule_example"), "规则条目");
  for (const kind of ["__proto__", "constructor", "named", "all", "../private"]) {
    assert.equal(readBookCaseQuery(new URLSearchParams({ kind })).kind, "");
    assert.equal(bookCaseApiPath({ kind }), "/api/book-cases?offset=0&limit=24");
    assert.equal(bookCaseKindLabel(kind), "学习条目");
  }
});

test("book case entries require a positive public count and source links keep the server edition page", () => {
  for (const case_count of [undefined, null, 0, -1, "1", 1.5]) assert.equal(bookCasesEntry({ id: "book", case_count }), null);
  assert.equal(bookCasesEntry({ id: "ziping-zhenquan", case_count: 1 }, "learning"), "/book-cases?book_id=ziping-zhenquan&from=learning");
  assert.equal(bookCaseReadingPath("/books/ziping-zhenquan?page=5", "learning"), "/books/ziping-zhenquan?page=5&from=learning");
  assert.equal(bookCaseReadingPath("/books/ziping-zhenquan?page=5"), "/books/ziping-zhenquan?page=5");
  assert.equal(bookCaseReadingPath("/books/book?text-version=reading-20261022-abc123&chapter=section-019-r-001", "learning", "book"),
    "/books/book?text-version=reading-20261022-abc123&chapter=section-019-r-001&from=learning");
  assert.equal(bookCaseReadingPath("/books/ziping-zhenquan?text-version=reading-1926-frozen&chapter=zpzq-005", "", "ziping-zhenquan"),
    "/books/ziping-zhenquan?text-version=reading-1926-frozen&chapter=zpzq-005");
  assert.equal(bookCaseReadingPath("/books/other?page=5", "", "book"), null);
  for (const path of ["javascript:alert(1)", "//elsewhere.test/books/book?page=1", "/books/book?page=0", "/books/book?text-version=current", "/books/book?page=5&other=1"])
    assert.equal(bookCaseReadingPath(path), null);
  for (const path of ["/books/book?text-version=../private&chapter=3", "/books/book?text-version=version&chapter=",
    "/books/book?text-version=current&chapter=section-001", "/books/book?text-version=latest&chapter=section-001",
    "/books/book?text-version=version&chapter=1#outside", "/books/book?text-version=version&chapter=1&from=other"])
    assert.equal(bookCaseReadingPath(path), null);
});

// Native DOM replacement, with no source-data HTML parsing. Only the existing
// static icon template may create an SVG; all API strings must stay text nodes.
class MockNode {
  constructor(tag = "", data = "") {
    this.tagName = tag.toUpperCase(); this.data = data; this.childNodes = [];
    this.attributes = new Map(); this.listeners = new Map(); this.dataset = {}; this.value = "";
    this.disabled = false; this.open = false; this.className = "";
    this.style = { setProperty(name, value) { this[name] = value; } };
    this.classList = {
      add: (...names) => { this.className = [...new Set([...this.className.split(" "), ...names])].filter(Boolean).join(" "); },
      remove: (...names) => { this.className = this.className.split(" ").filter(name => !names.includes(name)).join(" "); },
      contains: name => this.className.split(" ").includes(name),
    };
  }
  append(...children) { children.forEach(child => { child.parentElement = this; this.childNodes.push(child); }); }
  replaceChildren(...children) { this.childNodes = []; this.append(...children); }
  set textContent(value) { this.childNodes = [new MockNode("", String(value))]; }
  get textContent() { return this.tagName ? this.childNodes.map(child => child.textContent).join("") : this.data; }
  set innerHTML(value) {
    assert.equal(this.tagName, "TEMPLATE", "API text must never be assigned to innerHTML");
    assert.match(value, /^<svg\b/);
    this.content = { firstElementChild: new MockNode("svg") };
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  removeEventListener(name, callback) { if (this.listeners.get(name) === callback) this.listeners.delete(name); }
  emit(name) { this.listeners.get(name)?.({ currentTarget: this, target: this, preventDefault() {} }); }
  contains(node) { return node === this || this.childNodes.some(child => child.contains(node)); }
  get isConnected() { return document.body.contains(this); }
  remove() { if (this.parentElement) this.parentElement.childNodes = this.parentElement.childNodes.filter(child => child !== this); }
  focus() { document.activeElement = this; }
  matches(selector) {
    const name = selector.trim().split(/\s+/).at(-1);
    if (name.startsWith(".")) return this.classList.contains(name.slice(1));
    const attr = name.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
    return attr ? this.getAttribute(attr[1]) !== null && (attr[2] === undefined || this.getAttribute(attr[1]) === attr[2])
      : this.tagName === name.toUpperCase();
  }
  closest(selector) { return selector.split(",").some(item => this.matches(item)) ? this : this.parentElement?.closest(selector) || null; }
  querySelectorAll(selector) { return all(this).slice(1).filter(node => selector.split(",").some(item => node.matches(item))); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
const all = node => [node, ...node.childNodes.flatMap(all)];
const tags = (node, name) => all(node).filter(child => child.tagName === name.toUpperCase());
const byText = (node, name, text) => tags(node, name).find(child => child.textContent === text);
function environment(query = "", id = "") {
  const listeners = new Map();
  globalThis.Node = MockNode;
  globalThis.Element = MockNode;
  globalThis.document = { body: new MockNode("body"), activeElement: null,
    createElement: tag => new MockNode(tag), createTextNode: text => new MockNode("", text),
    addEventListener() {}, removeEventListener() {}, contains: node => document.body.contains(node) };
  globalThis.history = { state: {}, pushState(state) { this.state = state; }, back() { this.state = {}; } };
  globalThis.window = {
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name, callback) => { if (listeners.get(name) === callback) listeners.delete(name); },
    scrollTo: (...args) => scrolls.push(args),
    matchMedia: () => ({ matches: true }),
  };
  globalThis.requestAnimationFrame = callback => callback();
  const cleanups = [], navigated = [], titles = [], scrolls = [];
  let current = true, refresh;
  return {
    ctx: { query: new URLSearchParams(query), params: { id }, isCurrent: () => current,
      cleanup: callback => cleanups.push(callback), onRefresh: callback => { refresh = callback; },
      setTitle: title => titles.push(title), navigate: path => navigated.push(path) },
    navigated, titles, scrolls, refresh: () => refresh(), reconnect: () => listeners.get("online")?.(),
    cleanup() { current = false; cleanups.forEach(callback => callback()); }, listeners,
  };
}
// Import the real shared chart and sheet components after installing a native
// DOM-shaped environment. No panel, paipan, strip or overlay is replaced.
environment();
const { render } = await import("../web/public/next/views/book-cases.js");
const tick = () => new Promise(resolve => setImmediate(resolve));
test("reader directories keep case access beside existing links without adding a header row", async () => {
  environment();
  globalThis.cancelAnimationFrame = () => {};
  const { createBookSidebar, openBookContents } = await import("../web/public/next/ui/book-tools.js");
  const options = { book: { id: "display-book", title: "展示书", section_count: 1 }, contents: [], current: 1,
    onSelect() {}, onNotes() {}, onCollapse() {}, libraryPath: "#/books?view=learning", libraryLabel: "返回学习路线" };
  const casePath = "/book-cases?book_id=display-book&from=learning";
  const sidebar = createBookSidebar({ ...options, casePath });
  assert.equal(byText(sidebar.node, "a", "本书案例").getAttribute("href"), `#${casePath}`);
  assert.equal(byText(sidebar.node, "a", "返回学习路线").getAttribute("href"), options.libraryPath);
  sidebar.destroy();
  const empty = createBookSidebar(options);
  assert.equal(byText(empty.node, "a", "本书案例"), undefined);
  empty.destroy();
  const sheet = openBookContents({ ...options, casePath });
  assert.equal(byText(document.body, "a", "本书案例").getAttribute("href"), `#${casePath}`);
  assert.equal(byText(document.body, "a", "本书案例").parentElement.className, "book-contents-links");
  sheet.close("route");
  const noCase = openBookContents(options);
  assert.equal(byText(document.body, "a", "本书案例"), undefined);
  noCase.close("route");
});
const book = { id: "ziping-zhenquan", title: "子平真诠", case_count: 1 };
// Synthetic display data, not a transcription of a historical person's chart.
const summary = { id: "display-example", book_id: book.id, book_title: book.title, title: "展示测试案例", kind: "named_case", summary: "原书分析与四柱。" };
const caseDetail = () => ({ ...summary,
  study_format: "case", chart_status: "available", related_case_ids: [],
  chart: [{ label: "年柱", value: "壬午" }, { label: "月柱", value: "己酉" }, { label: "日柱", value: "甲午" }, { label: "时柱", value: "丙寅" }],
  facts: ["原书具名命例。"], judgment: ["作者认为这一结构有利。"], outcome: [], outcome_status: "not_reported",
  original_excerpt: "原文案例。", original_context: "案例所在完整原段。", modern_context: "所在完整段落的白话。",
  context_before: "前一段原文。", context_after: "后一段原文。", uncertainties: [],
  sources: [{ edition_label: "1926年校勘本", chapter: "论用神", location: "书内页码", reading_path: "/books/ziping-zhenquan?page=5" }],
});
const caseChart = (id = summary.id) => ({ case_id: id, system: "bazi", source_label: "按原书四柱复盘",
  available_sections: ["pillars", "facts", "wuxing", "relations", "shensha"], missing: ["出生日期", "性别", "起运岁数"],
  payload: { profile: {}, chart: { pillars: { year: "壬午", month: "己酉", day: "甲午", hour: "丙寅" }, day_master: { stem: "甲", yin_yang: "阳", element: "木" } },
    month_command: { branch: "酉", main_qi: "辛" }, roots: [{ branch: "寅" }],
    pillars_detail: { year: { stem_ten_god: "偏印", hidden: [{ stem: "丁", element: "火", ten_god: "伤官" }], na_yin: "杨柳木" },
      month: { stem_ten_god: "正财" }, day: { hidden: [{ stem: "丁", ten_god: "伤官" }] }, hour: { stem_ten_god: "食神" } },
    wuxing_count: { 木: 2, 火: 3, 土: 1, 金: 1, 水: 1 }, wuxing_count_with_hidden: { 木: 3, 火: 5, 土: 4, 金: 1, 水: 1 },
    relations: { heavenly_stems: ["甲己合"], earthly_branches: ["午午自刑"] }, shensha: {}, tai_yuan: "庚子", xun_kong: "辰巳" },
});
const detailRequest = (data = caseDetail(), chart = caseChart(data.id)) => async path => path.endsWith("/chart") ? chart : data;
// Six-line public chart response shape. Positions are supplied by the server,
// bottom to top; this fixture performs no hexagram or calendar calculation.
const liuyaoCaseChart = id => ({ case_id: id, system: "liuyao", source_label: "按原书月日、爻象复盘",
  available_sections: ["lines", "facts"], missing: ["公历日期", "占时"], payload: {
    question: "占升迁", ben_gua: { name: "师", palace: "坎", shi: 3, ying: 6 }, bian_gua: { name: "涣" },
    month_jian: "未", day_chen: "甲午", xun_kong: "辰巳", dong_yao: [5, 6],
    yaos: [
      { pos: 1, yin_yang: "阴", moving: false, old_young: "少阴", liu_shen: "青龙", liu_qin: "子孙", najia: "戊寅", wuxing: "木", shi: false, ying: false, kong: false },
      { pos: 2, yin_yang: "阳", moving: false, old_young: "少阳", liu_shen: "朱雀", liu_qin: "官鬼", najia: "戊辰", wuxing: "土", shi: false, ying: false, kong: true },
      { pos: 3, yin_yang: "阴", moving: false, old_young: "少阴", liu_shen: "勾陈", liu_qin: "妻财", najia: "戊午", wuxing: "火", shi: true, ying: false, kong: false },
      { pos: 4, yin_yang: "阴", moving: false, old_young: "少阴", liu_shen: "螣蛇", liu_qin: "官鬼", najia: "癸丑", wuxing: "土", shi: false, ying: false, kong: false },
      { pos: 5, yin_yang: "阴", moving: true, old_young: "老阴", liu_shen: "白虎", liu_qin: "兄弟", najia: "癸亥", wuxing: "水", shi: false, ying: false, kong: false,
        bian: { yin_yang: "阳", liu_qin: "妻财", najia: "辛巳", wuxing: "火" } },
      { pos: 6, yin_yang: "阴", moving: true, old_young: "老阴", liu_shen: "玄武", liu_qin: "父母", najia: "癸酉", wuxing: "金", shi: false, ying: true, kong: false,
        bian: { yin_yang: "阳", liu_qin: "子孙", najia: "辛卯", wuxing: "木" } },
    ],
  } });

test("case list loads public records, filters books, preserves paging and reports current intake counts", async () => {
  const env = environment("book_id=ziping-zhenquan&offset=2&limit=2&from=learning");
  const paths = [];
  const result = render(env.ctx, async path => {
    paths.push(path);
    return path === "/api/books" ? { books: [book, { id: "empty", title: "未收录书籍", case_count: 0 }] }
      : { items: [summary, { ...summary, id: "second-case", title: "第二例" }], total: 6, offset: 2, limit: 2 };
  });
  assert.match(result.node.textContent, /正在打开学习条目/);
  result.onRestore(350);
  await tick();
  assert.deepEqual(paths, ["/api/book-cases?book_id=ziping-zhenquan&offset=2&limit=2", "/api/books"]);
  assert.match(result.node.textContent, /当前已收录 6 条学习条目 · 按原文提及保存/);
  assert.equal(byText(result.node, "a", "案例与推演").getAttribute("href"), "#/book-cases?from=learning");
  assert.equal(result.node.textContent.includes("未收录书籍"), false);
  assert.equal(byText(result.node, "a", "展示测试案例").getAttribute("href"), "#/book-cases/display-example?book_id=ziping-zhenquan&offset=2&limit=2&from=learning");
  assert.equal(byText(result.node, "a", "上一页").getAttribute("href"), "#/book-cases?book_id=ziping-zhenquan&limit=2&from=learning");
  assert.equal(byText(result.node, "a", "下一页").getAttribute("href"), "#/book-cases?book_id=ziping-zhenquan&offset=4&limit=2&from=learning");
  const select = tags(result.node, "select")[0]; select.value = ""; select.emit("change");
  assert.deepEqual(env.navigated, ["/book-cases?limit=2&from=learning"]);
  assert.deepEqual(env.scrolls, [[0, 350]]);
  env.cleanup(); assert.equal(env.listeners.size, 0);
});

test("unknown or empty book scope stays usable without exposing an internal id as a title", async () => {
  const env = environment("book_id=not-in-catalogue");
  const result = render(env.ctx, async path => path === "/api/books" ? { books: [] } : { items: [], total: 0, offset: 0, limit: 24 });
  await tick();
  assert.match(result.node.textContent, /这本书暂未收录学习条目/);
  assert.match(result.node.textContent, /当前已收录 0 条学习条目/);
  assert.equal(all(result.node).find(node => node.className === "book-cases-pagination").childNodes.length, 0);
  assert.equal(tags(result.node, "h1")[0].className, "sr-only");
  assert.equal(result.node.textContent.includes("not-in-catalogue"), false);
  assert.equal(byText(result.node, "a", "查看全部条目").getAttribute("href"), "#/book-cases");
  env.cleanup();
});

test("single-page intake shows one count without a repeated heading, introduction or page counter", async () => {
  const env = environment();
  const result = render(env.ctx, async path => path === "/api/books" ? { books: [book] }
    : { items: [summary], total: 1, offset: 0, limit: 24 });
  await tick();
  assert.equal(tags(result.node, "h1")[0].className, "sr-only");
  assert.equal(tags(result.node, "header").length, 0);
  assert.match(result.node.textContent, /当前已收录 1 条学习条目/);
  assert.equal(all(result.node).find(node => node.className === "book-cases-pagination").childNodes.length, 0);
  env.cleanup();
});

test("source mention lists count learning entries and let book or kind change without losing the other filter", async () => {
  const env = environment("book_id=ziping-zhenquan&kind=hypothetical&offset=24&from=learning");
  const paths = [];
  const result = render(env.ctx, async path => {
    paths.push(path);
    return path === "/api/books" ? { books: [{ ...book, case_count: 157 }] }
      : { items: [{ ...summary, kind: "hypothetical", title: "假设配置" }], total: 53, offset: 24, limit: 24 };
  });
  result.onRestore(420); await tick();
  assert.equal(paths[0], "/api/book-cases?book_id=ziping-zhenquan&kind=hypothetical&offset=24&limit=24");
  assert.match(result.node.textContent, /当前已收录 53 条学习条目 · 按原文提及保存/);
  assert.doesNotMatch(result.node.textContent, /独立|53.*人物|53.*条案例/);
  const [bookSelect, kindSelect] = tags(result.node, "select");
  assert.equal(kindSelect.value, "hypothetical");
  assert.equal(tags(kindSelect, "option").length, 5);
  kindSelect.value = "rule_example"; kindSelect.emit("change");
  bookSelect.value = ""; bookSelect.emit("change");
  assert.deepEqual(env.navigated, ["/book-cases?book_id=ziping-zhenquan&kind=rule_example&from=learning", "/book-cases?kind=hypothetical&from=learning"]);
  assert.equal(byText(result.node, "a", "下一页").getAttribute("href"), "#/book-cases?book_id=ziping-zhenquan&kind=hypothetical&offset=48&from=learning");
  assert.deepEqual(env.scrolls, [[0, 420]]);
  env.cleanup();
});

test("case detail separates book judgment and unreported outcome and folds source text and same-paragraph translation", async () => {
  const env = environment("book_id=ziping-zhenquan&offset=24&from=learning", "display-example");
  const data = caseDetail();
  data.original_excerpt = "<script>alert(1)</script>"; data.modern_context = "<img onerror=alert(1)>";
  const paths = [];
  const response = detailRequest(data);
  const result = render(env.ctx, async path => { paths.push(path); return response(path); });
  assert.match(result.node.textContent, /正在打开学习条目/);
  await tick();
  assert.deepEqual(paths, ["/api/book-cases/display-example", "/api/book-cases/display-example/chart"]);
  const fullChart = all(result.node).find(node => node.classList.contains("book-case-full-chart"));
  assert.ok(fullChart.querySelector(".chart-panel"));
  assert.equal(fullChart.querySelectorAll(".cp-pillar").length, 4);
  assert.match(fullChart.textContent, /偏印.*壬.*午/);
  assert.match(fullChart.textContent, /杨柳木/);
  assert.match(fullChart.textContent, /原局干支关系/);
  assert.match(fullChart.textContent, /甲己合/);
  assert.match(fullChart.textContent, /午午自刑/);
  assert.match(fullChart.textContent, /出生日期、性别、起运岁数/);
  assert.doesNotMatch(fullChart.textContent, /大运流年|公历|近似锚点/);
  assert.equal(byText(result.node, "h2", "原书分析").parentElement.textContent, "原书分析作者认为这一结构有利。");
  assert.equal(byText(result.node, "h2", "书载结果").parentElement.textContent, "书载结果原书此处未记载具体结果。");
  assert.equal(all(result.node).filter(node => node.className === "book-case-context").length, 2);
  assert.ok(all(result.node).filter(node => node.className === "book-case-context").every(node => !node.open && node.getAttribute("open") === null));
  assert.match(result.node.textContent, /所在段白话/);
  assert.match(result.node.textContent, /案例所在完整原段/);
  assert.match(result.node.textContent, /前一段原文/);
  assert.match(result.node.textContent, /后一段原文/);
  assert.equal(tags(result.node, "script").length, 0); assert.equal(tags(result.node, "img").length, 0);
  assert.match(result.node.textContent, /<script>alert\(1\)<\/script>/);
  assert.equal(tags(result.node, "a").find(node => node.textContent.startsWith("回到原书章节")).getAttribute("href"), "#/books/ziping-zhenquan?page=5&from=learning");
  assert.equal(byText(result.node, "a", "返回学习条目").getAttribute("href"), "#/book-cases?book_id=ziping-zhenquan&offset=24&from=learning");
  env.cleanup();
});

test("recorded results remain server text and missing neighboring context is omitted", async () => {
  const env = environment("", "recorded-case");
  const data = { ...caseDetail(), id: "recorded-case", outcome_status: "recorded", outcome: ["书中记载的结果。"], context_before: null, context_after: null, modern_context: null };
  const result = render(env.ctx, detailRequest(data)); await tick();
  assert.equal(byText(result.node, "h2", "书载结果").parentElement.textContent, "书载结果书中记载的结果。");
  assert.equal(byText(result.node, "h2", "前一段"), undefined);
  assert.equal(byText(result.node, "h2", "后一段"), undefined);
  assert.equal(byText(result.node, "h2", "所在段白话"), undefined);
  assert.ok(byText(result.node, "summary", "原文与说明"));
  assert.equal(byText(result.node, "summary", "原文与白话"), undefined);
  env.cleanup();
});

test("an incomplete source mention puts the exact full-paragraph modern text first and folds all source quotes without a chart call", async () => {
  const env = environment("book_id=ziping-zhenquan&kind=named_case&offset=24&from=learning", "source-mention");
  const data = { ...caseDetail(), id: "source-mention", study_format: "source_mention", chart_status: "incomplete",
    modern_context: "第一段白话𠀀。\n\n第二段保留条件与结论。", original_excerpt: "甲子原句。", original_context: "完整原段：甲子原句。另句。",
    facts: ["事实逐字原句"], judgment: ["作者判断原句"], outcome_status: "recorded", outcome: ["结果逐字原句"],
    related_case_ids: ["related-mention", "related-mention", "source-mention"] };
  const before = structuredClone(data), paths = [];
  const result = render(env.ctx, async path => { paths.push(path); return data; }); await tick();
  assert.deepEqual(paths, ["/api/book-cases/source-mention"]);
  const article = result.node.querySelector(".book-case-analysis");
  assert.equal(article.childNodes[0].querySelector("h2").textContent, "所在段白话");
  assert.equal(article.querySelector(".book-case-text").textContent, data.modern_context);
  assert.equal(article.querySelectorAll(".book-case-modern").length, 1);
  assert.equal(byText(article, "h2", "原书分析"), undefined);
  assert.equal(article.childNodes.filter(node => node.tagName === "SECTION" && node.querySelector("h2")?.textContent === "书载结果").length, 0);
  const disclosures = tags(article, "details");
  assert.equal(disclosures.length, 2);
  assert.ok(disclosures.every(details => !details.open && details.getAttribute("open") === null));
  assert.match(disclosures[0].textContent, /原文摘句甲子原句。书载信息事实逐字原句作者判断作者判断原句书载结果结果逐字原句/);
  assert.match(result.node.textContent, /原书未载完整排盘条件，暂不能复盘。/);
  assert.doesNotMatch(result.node.textContent, /盘面暂时没有打开|逐句译文|独立人物|同一人物/);
  assert.equal(result.node.querySelector(".chart-panel"), null);
  assert.equal(byText(result.node, "button", "重试"), undefined);
  assert.equal(byText(result.node, "a", "相关条目 1").getAttribute("href"), "#/book-cases/related-mention?book_id=ziping-zhenquan&kind=named_case&offset=24&from=learning");
  assert.equal(result.node.querySelector(".book-case-related").querySelectorAll("a").length, 1);
  assert.equal(byText(result.node, "a", "返回学习条目").getAttribute("href"), "#/book-cases?book_id=ziping-zhenquan&kind=named_case&offset=24&from=learning");
  assert.deepEqual(data, before);
  env.reconnect(); assert.equal(paths.length, 1);
  env.cleanup();
});

test("supporting contexts fold the shared setup, keep its exact translation first and preserve safe reading links", async () => {
  const env = environment("from=learning", "supported-mention"), paths = [];
  const data = { ...caseDetail(), id: "supported-mention", study_format: "source_mention", chart_status: "incomplete",
    supporting_contexts: [
      { title: "共同题设", original: "𠀀原表\n初爻\t<script>原句</script>", modern: "𠀀对应段白话。\n若有此条件，才作此判断。<img onerror=alert(1)>",
        location: "合成底本第 1 页", reading_path: "/books/ziping-zhenquan?page=2" },
      { title: "相关原表", original: "只有原文的完整表。\n第二行。", modern: "", location: "合成底本第 2 页", reading_path: "/books/ziping-zhenquan?page=3" },
      { title: "另一相关段", original: "另一段原文。", modern: "另一段白话。", location: "合成底本第 3 页", reading_path: "/books/other-book?page=4" },
    ] };
  const before = structuredClone(data);
  const result = render(env.ctx, async path => { paths.push(path); return data; }); await tick();
  const article = result.node.querySelector(".book-case-analysis");
  assert.equal(article.childNodes[0].querySelector("h2").textContent, "所在段白话");
  assert.equal(article.childNodes[0].querySelector(".book-case-text").textContent, data.modern_context);
  const disclosure = byText(article, "summary", "题设与相关段落").parentElement;
  assert.equal(disclosure.tagName, "DETAILS");
  assert.ok(tags(disclosure, "details").every(node => !node.open && node.getAttribute("open") === null));
  const sections = tags(disclosure, "section");
  assert.equal(sections.length, 3);
  assert.deepEqual(sections.map(node => tags(node, "h3")[0].textContent), data.supporting_contexts.map(context => context.title));
  assert.equal(sections[0].querySelector(".book-case-text").textContent, data.supporting_contexts[0].modern);
  assert.ok(byText(sections[0], "p", "对应段白话"));
  const original = byText(sections[0], "summary", "查看对应原文").parentElement;
  assert.equal(original.querySelector(".book-case-original").textContent, data.supporting_contexts[0].original);
  assert.ok(all(sections[0]).indexOf(sections[0].querySelector(".book-case-text")) < all(sections[0]).indexOf(original));
  assert.equal(tags(sections[1], "details").length, 0);
  assert.equal(byText(sections[1], "p", "对应段白话"), undefined);
  assert.ok(byText(sections[1], "p", "对应段原文"));
  assert.equal(sections[1].querySelector(".book-case-original").textContent, data.supporting_contexts[1].original);
  assert.match(sections[0].textContent, /合成底本第 1 页/);
  assert.equal(tags(sections[0], "a")[0].getAttribute("href"), "#/books/ziping-zhenquan?page=2&from=learning");
  assert.equal(tags(sections[1], "a")[0].getAttribute("href"), "#/books/ziping-zhenquan?page=3&from=learning");
  assert.match(sections[2].textContent, /另一段白话.*合成底本第 3 页/);
  assert.equal(tags(sections[2], "a").length, 0);
  assert.equal(tags(result.node, "script").length, 0); assert.equal(tags(result.node, "img").length, 0);
  assert.match(disclosure.textContent, /<script>原句<\/script>/);
  assert.match(disclosure.textContent, /<img onerror=alert\(1\)>/);
  assert.equal(tags(result.node, "header").length, 1);
  assert.deepEqual(paths, ["/api/book-cases/supported-mention"]);
  assert.deepEqual(data, before);
  env.cleanup();
});

test("absent or empty supporting contexts add no nodes to the existing source mention tree", async () => {
  const shape = node => ({ tag: node.tagName, data: node.data, className: node.className,
    attributes: [...node.attributes], children: node.childNodes.map(shape) });
  let legacyShape;
  for (const supporting_contexts of [undefined, []]) {
    const env = environment("", "source-without-support");
    const data = { ...caseDetail(), id: "source-without-support", study_format: "source_mention", chart_status: "incomplete" };
    if (supporting_contexts !== undefined) data.supporting_contexts = supporting_contexts;
    const result = render(env.ctx, async () => data); await tick();
    const article = result.node.querySelector(".book-case-analysis");
    assert.equal(byText(article, "summary", "题设与相关段落"), undefined);
    assert.deepEqual(article.childNodes.map(node => node.tagName), ["SECTION", "DETAILS", "DETAILS", "FOOTER"]);
    assert.equal(tags(article, "details").length, 2);
    if (!legacyShape) legacyShape = shape(result.node);
    else assert.deepEqual(shape(result.node), legacyShape);
    env.cleanup();
  }
  const env = environment("", "legacy-card");
  const data = { ...caseDetail(), id: "legacy-card", chart_status: "incomplete", supporting_contexts: [
    { title: "仅供源提及的上下文", original: "原段。", modern: "白话。", location: "第 1 页", reading_path: "/books/ziping-zhenquan?page=2" },
  ] };
  const result = render(env.ctx, async () => data); await tick();
  assert.equal(byText(result.node, "summary", "题设与相关段落"), undefined);
  assert.equal(tags(result.node.querySelector(".book-case-analysis"), "details").length, 2);
  env.cleanup();
});

test("unselected hypothetical and rule entries never infer a chart from four quoted pillars", async () => {
  for (const kind of ["hypothetical", "rule_example"]) {
    const env = environment("", `${kind}-mention`), paths = [];
    const data = { ...caseDetail(), id: `${kind}-mention`, kind, study_format: "source_mention", chart_status: "not_applicable" };
    const result = render(env.ctx, async path => { paths.push(path); return data; }); await tick();
    assert.equal(paths.length, 1);
    assert.equal(result.node.querySelector(".chart-panel"), null);
    assert.equal(result.node.querySelector(".book-case-chart-strip"), null);
    assert.match(result.node.textContent, kind === "hypothetical" ? /本条为假设推演，按原文条件阅读。/ : /本条为规则说明，按原文条件阅读。/);
    assert.equal(byText(result.node, "button", "重试"), undefined);
    assert.doesNotMatch(result.node.textContent, /盘面暂时没有打开|修改信息|出生日期/);
    env.cleanup();
  }
});

test("an explicitly available hypothetical exercise retains its category and opens the real shared six-line panel", async () => {
  const env = environment("kind=hypothetical", "exercise-example"), paths = [];
  const data = { ...caseDetail(), id: "exercise-example", kind: "hypothetical", study_format: "source_mention" };
  const chart = { ...liuyaoCaseChart(data.id), source_label: "《测试书》假设推演练习" };
  const result = render(env.ctx, async path => { paths.push(path); return path.endsWith("/chart") ? chart : data; });
  document.body.append(result.node); await tick();
  const panel = result.node.querySelector(".book-case-full-chart");
  assert.equal(panel.getAttribute("aria-label"), "推演练习盘");
  assert.equal(tags(panel.querySelector("tbody"), "tr").length, 6);
  assert.match(result.node.textContent, /六爻 · 假设推演/);
  assert.match(panel.textContent, /假设推演练习/);
  const strip = result.node.querySelector(".book-case-chart-strip");
  assert.equal(strip.getAttribute("aria-label"), "查看完整推演练习盘");
  strip.emit("click");
  assert.match(document.body.querySelector(".sheet-chart").textContent, /推演练习盘.*师之涣/);
  assert.deepEqual(paths, ["/api/book-cases/exercise-example", "/api/book-cases/exercise-example/chart"]);
  assert.equal(data.kind, "hypothetical");
  env.cleanup();
});

test("a complete source mention keeps the primary paragraph readable while its real shared chart loads separately", async () => {
  const env = environment("", "complete-mention"), paths = []; let resolveChart;
  const data = { ...caseDetail(), id: "complete-mention", study_format: "source_mention", chart_status: "available" };
  const result = render(env.ctx, path => {
    paths.push(path);
    return path.endsWith("/chart") ? new Promise(resolve => { resolveChart = resolve; }) : Promise.resolve(data);
  }); await tick();
  const primary = result.node.querySelector(".book-case-modern");
  assert.ok(primary.textContent.includes(data.modern_context));
  assert.match(result.node.textContent, /正在打开盘面/);
  resolveChart(caseChart(data.id)); await tick();
  assert.equal(result.node.querySelector(".book-case-modern"), primary);
  assert.equal(result.node.querySelectorAll(".cp-pillar").length, 4);
  assert.deepEqual(paths, ["/api/book-cases/complete-mention", "/api/book-cases/complete-mention/chart"]);
  env.cleanup();
});

test("six-line cases use the actual shared paipan and immutable source links without a personal chart flow", async () => {
  const env = environment("from=learning", "liuyao-example");
  const data = { ...caseDetail(), id: "liuyao-example", book_id: "zengshan-buyi", book_title: "增删卜易", kind: "unnamed_case", modern_context: null, facts: ["原书未记占者姓名。"],
    sources: [{ edition_label: "网络转录", chapter: "两现章第三十二", location: "升迁例",
      reading_path: "/books/zengshan-buyi?text-version=reading-20261022-90dfe958&chapter=section-019-r-001" }] };
  const paths = [];
  const response = detailRequest(data, liuyaoCaseChart(data.id));
  const result = render(env.ctx, (path, options) => { paths.push([path, options]); return response(path); });
  await tick();
  const panel = result.node.querySelector(".book-case-full-chart");
  assert.ok(panel.querySelector(".is-liuyao"));
  assert.equal(tags(panel.querySelector("tbody"), "tr").length, 6);
  assert.match(panel.textContent, /师之涣/);
  assert.match(panel.textContent, /月建未日辰甲午旬空辰巳/);
  assert.match(panel.textContent, /玄武.*父母.*癸酉金/);
  assert.match(panel.textContent, /子孙 辛卯木/);
  assert.match(panel.textContent, /公历日期、占时/);
  assert.match(result.node.textContent, /六爻 · 未具名案例/);
  assert.doesNotMatch(result.node.textContent, /具名命例|未具名命例|公历生日|创建档案|付费解读|重新起卦/);
  assert.equal(tags(result.node, "a").find(node => node.textContent.startsWith("回到原书章节")).getAttribute("href"),
    "#/books/zengshan-buyi?text-version=reading-20261022-90dfe958&chapter=section-019-r-001&from=learning");
  assert.deepEqual(paths.map(([path]) => path), ["/api/book-cases/liuyao-example", "/api/book-cases/liuyao-example/chart"]);
  assert.ok(paths.every(([, options]) => options.signal instanceof AbortSignal && !options.method));
  document.body.append(result.node);
  result.node.querySelector(".book-case-chart-strip").emit("click");
  const sheet = document.body.querySelector(".sheet-chart");
  assert.equal(tags(sheet.querySelector("tbody"), "tr").length, 6);
  assert.match(sheet.textContent, /书例卦盘.*师之涣/);
  const row = sheet.querySelector("tbody").querySelector("tr");
  row.emit("click");
  const pop = document.body.querySelector(".sheet-pop");
  assert.match(pop.textContent, /盘面释读供对照，原书判断见案例正文。/);
  assert.match(pop.querySelector(".pop-classic").textContent, /临玄武。/);
  assert.doesNotMatch(pop.textContent, /回到断卦|回到断卦对话继续问/);
  byText(pop, "button", "返回卦盘").emit("click");
  await tick();
  assert.ok(document.body.querySelector(".sheet-chart"));
  env.cleanup();
  assert.equal(document.body.querySelector(".overlay"), null);
});

test("book cases without a recorded day show unknown six spirits in the real shared line popover", async () => {
  const env = environment("", "unknown-day-example");
  const data = { ...caseDetail(), id: "unknown-day-example", kind: "unnamed_case", study_format: "source_mention" };
  const chart = liuyaoCaseChart(data.id);
  chart.missing = ["月建", "日辰、六神与旬空"];
  Object.assign(chart.payload, { month_jian: null, day_chen: null, xun_kong: null });
  chart.payload.yaos = chart.payload.yaos.map(yao => ({ ...yao, liu_shen: null, kong: null, to_month: null, to_day: null }));
  const result = render(env.ctx, detailRequest(data, chart));
  document.body.append(result.node); await tick();
  result.node.querySelector(".book-case-chart-strip").emit("click");
  const sheet = document.body.querySelector(".sheet-chart");
  assert.match(sheet.textContent, /未载/);
  sheet.querySelector("tbody").querySelector("tr").emit("click");
  const pop = document.body.querySelector(".sheet-pop");
  assert.match(pop.querySelector(".pop-classic").textContent, /六神未载。/);
  assert.doesNotMatch(pop.textContent, /临—|青龙|朱雀|勾陈|螣蛇|白虎|玄武/);
  const fact = pop.querySelector(".pop-facts").childNodes.find(node => tags(node, "dt")[0]?.textContent === "六神");
  assert.equal(tags(fact, "dd")[0].textContent, "未载");
  byText(pop, "button", "返回卦盘").emit("click"); await tick();
  assert.ok(document.body.querySelector(".sheet-chart"));
  env.cleanup();
  assert.equal(document.body.querySelector(".overlay"), null);
});

test("the compact chart opens a full shared chart sheet and route cleanup closes it", async () => {
  const env = environment("", "display-example");
  const result = render(env.ctx, detailRequest()); document.body.append(result.node);
  await tick();
  const strip = result.node.querySelector(".book-case-chart-strip");
  strip.focus(); strip.emit("click");
  const sheet = document.body.querySelector(".sheet-chart");
  assert.equal(sheet.getAttribute("role"), "dialog");
  assert.match(sheet.textContent, /书例命盘/);
  assert.equal(sheet.querySelectorAll(".cp-pillar").length, 4);
  assert.ok(sheet.querySelector(".cp-facts"));
  assert.ok(sheet.querySelector(".cp-case-relations"));
  assert.ok(document.body.classList.contains("is-locked"));
  env.cleanup();
  assert.equal(document.body.querySelector(".overlay"), null);
  assert.equal(document.body.classList.contains("is-locked"), false);
  assert.equal(document.activeElement, strip);
});

test("source-declared missing sections never get filled with unrelated payload or made-up dates", async () => {
  const env = environment("", "partial-case");
  const chart = caseChart("partial-case"); chart.available_sections = ["pillars"];
  chart.payload.chart.pillars.hour = ""; chart.missing.push("时柱");
  const result = render(env.ctx, detailRequest({ ...caseDetail(), id: "partial-case" }, chart));
  await tick();
  const full = result.node.querySelector(".book-case-full-chart");
  assert.equal(full.querySelector(".cp-facts"), null);
  assert.equal(full.querySelector(".cp-case-relations"), null);
  assert.match(full.textContent, /未载/);
  assert.doesNotMatch(full.textContent, /甲己合|午午自刑|庚子|公历|近似锚点/);
  env.cleanup();
});

test("a missing chart preserves the original case and never substitutes the old four-field summary", async () => {
  const env = environment("", "display-example");
  const result = render(env.ctx, async path => {
    if (path.endsWith("/chart")) throw Object.assign(new Error("missing chart"), { status: 404 });
    return caseDetail();
  });
  await tick();
  assert.match(result.node.textContent, /此例盘面暂不可用/);
  assert.match(result.node.textContent, /原书分析作者认为这一结构有利/);
  assert.match(result.node.textContent, /案例所在完整原段/);
  assert.doesNotMatch(result.node.textContent, /这个条目暂不可用/);
  assert.equal(result.node.querySelector(".chart-panel"), null);
  assert.equal(result.node.querySelector(".book-case-chart-strip"), null);
  assert.equal(result.node.querySelector(".book-case-chart"), null);
  assert.equal(byText(result.node, "button", "重试"), undefined);
  env.cleanup();
});

test("chart network errors retain the book analysis and retry explicitly or when reconnected", async () => {
  const env = environment("", "display-example"); let attempts = 0, detailRequests = 0;
  const result = render(env.ctx, async path => {
    if (!path.endsWith("/chart")) { detailRequests++; return caseDetail(); }
    if (++attempts < 3) throw new Error("盘面连接中断");
    return caseChart();
  });
  await tick();
  assert.match(result.node.textContent, /盘面暂时没有打开/);
  assert.match(result.node.textContent, /盘面连接中断/);
  assert.match(result.node.textContent, /原书分析作者认为这一结构有利/);
  const article = result.node.querySelector(".book-case-analysis");
  const disclosure = tags(article, "details")[0]; disclosure.open = true;
  byText(result.node, "button", "重试").emit("click"); await tick();
  assert.equal(attempts, 2);
  assert.equal(result.node.querySelector(".book-case-analysis"), article);
  assert.equal(disclosure.open, true);
  env.reconnect(); await tick();
  assert.equal(attempts, 3); assert.ok(result.node.querySelector(".chart-panel"));
  assert.equal(byText(result.node, "button", "重试"), undefined);
  assert.equal(detailRequests, 1);
  env.reconnect(); await tick(); assert.equal(attempts, 3);
  env.cleanup();
});

test("the original case opens before its permitted chart and a different case's chart is rejected", async () => {
  const env = environment("", "display-example"); const pending = [];
  const result = render(env.ctx, (path, options) => new Promise(resolve => pending.push({ path, signal: options.signal, resolve })));
  assert.equal(pending.length, 1);
  pending[0].resolve(caseDetail()); await tick();
  assert.equal(pending.length, 2);
  assert.match(result.node.textContent, /原书分析作者认为这一结构有利/);
  assert.match(result.node.textContent, /正在打开盘面/);
  pending[1].resolve(caseChart("other-case")); await tick();
  assert.match(result.node.textContent, /案例与盘面未能对应/);
  assert.match(result.node.textContent, /原书分析作者认为这一结构有利/);
  assert.equal(result.node.querySelector(".chart-panel"), null);
  assert.ok(byText(result.node, "button", "重试"));
  env.refresh(); assert.ok(pending.slice(0, 2).every(item => item.signal.aborted));
  env.cleanup(); assert.ok(pending.every(item => item.signal.aborted));
});

test("refresh aborts the old chart and a late chart cannot overwrite the new case", async () => {
  const env = environment("", "display-example"); const pending = [];
  const result = render(env.ctx, (path, options) => new Promise(resolve => pending.push({ path, signal: options.signal, resolve })));
  pending[0].resolve({ ...caseDetail(), title: "旧案例不应出现" }); await tick();
  assert.equal(pending.length, 2);
  env.refresh(); assert.ok(pending.slice(0, 2).every(item => item.signal.aborted));
  pending[2].resolve({ ...caseDetail(), title: "新案例标题" }); await tick();
  pending[3].resolve(caseChart()); await tick();
  assert.match(result.node.textContent, /新案例标题/);
  pending[1].resolve(caseChart()); await tick();
  assert.doesNotMatch(result.node.textContent, /旧案例不应出现/);
  assert.deepEqual(env.titles, ["旧案例不应出现 · 典籍研读", "新案例标题 · 典籍研读"]);
  env.cleanup();
});

test("404 is a terminal unavailable state while network errors retry and recover on reconnect", async () => {
  const env = environment("", "missing-case");
  let attempt = 0;
  const result = render(env.ctx, async path => {
    if (path.endsWith("/chart")) return caseChart("missing-case");
    if (++attempt === 1) throw Object.assign(new Error("missing"), { status: 404 });
    if (attempt === 2) throw Object.assign(new Error("连接中断"), { status: 0 });
    return { ...caseDetail(), id: "missing-case" };
  });
  await tick();
  assert.match(result.node.textContent, /这个条目暂不可用/);
  assert.equal(byText(result.node, "button", "重试"), undefined);
  env.refresh(); await tick();
  assert.match(result.node.textContent, /连接中断/);
  assert.ok(byText(result.node, "button", "重试"));
  env.reconnect(); await tick();
  assert.match(result.node.textContent, /展示测试案例/);
  assert.equal(byText(result.node, "button", "重试"), undefined);
  env.reconnect(); await tick(); assert.equal(attempt, 3);
  env.cleanup();
});

test("list failure has a working retry and cancels superseded requests even if a late response resolves", async () => {
  const env = environment();
  const pending = [];
  const result = render(env.ctx, (path, options) => path === "/api/books" ? Promise.resolve({ books: [book] })
    : new Promise((resolve, reject) => pending.push({ resolve, reject, signal: options.signal })));
  pending[0].reject(new Error("暂时断线")); await tick();
  byText(result.node, "button", "重试").emit("click");
  assert.equal(pending[0].signal.aborted, true);
  env.refresh(); assert.equal(pending[1].signal.aborted, true);
  pending[2].resolve({ items: [summary], total: 1, offset: 0, limit: 24 }); await tick();
  assert.match(result.node.textContent, /展示测试案例/);
  pending[1].resolve({ items: [{ ...summary, title: "旧请求不应出现" }], total: 1, offset: 0, limit: 24 }); await tick();
  assert.equal(result.node.textContent.includes("旧请求不应出现"), false);
  env.refresh(); const beforeCleanup = result.node.textContent;
  env.cleanup(); assert.equal(pending[3].signal.aborted, true);
  pending[3].resolve({ items: [summary], total: 1, offset: 0, limit: 24 }); await tick();
  assert.equal(result.node.textContent, beforeCleanup);
});

test("leaving a case detail aborts it and suppresses both late content and title updates", async () => {
  const env = environment("", "display-example");
  const pending = [];
  const result = render(env.ctx, (path, options) => new Promise(resolve => pending.push({ path, signal: options.signal, resolve })));
  const before = result.node.textContent;
  env.cleanup(); assert.ok(pending.every(item => item.signal.aborted));
  pending.forEach(item => item.resolve(item.path.endsWith("/chart") ? caseChart() : caseDetail())); await tick();
  assert.equal(result.node.textContent, before);
  assert.deepEqual(env.titles, []);
});

test("leaving while a permitted chart is loading aborts its request and never publishes the late chart", async () => {
  const env = environment("", "display-example"); let resolveChart, chartSignal;
  const result = render(env.ctx, (path, options) => path.endsWith("/chart")
    ? new Promise(resolve => { resolveChart = resolve; chartSignal = options.signal; }) : Promise.resolve(caseDetail()));
  await tick();
  assert.match(result.node.textContent, /原书分析作者认为这一结构有利/);
  const before = result.node.textContent;
  env.cleanup(); assert.equal(chartSignal.aborted, true);
  resolveChart(caseChart()); await tick();
  assert.equal(result.node.textContent, before);
  assert.equal(result.node.querySelector(".chart-panel"), null);
});
