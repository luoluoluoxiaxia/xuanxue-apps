import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readBookCaseQuery, bookCaseListPath, bookCaseDetailPath, bookCaseApiPath,
  bookCasesEntry, bookCaseReadingPath } from "../web/public/next/lib/book-cases.js";
import { render } from "../web/public/next/views/book-cases.js";

test("case queries preserve book, paging and learning context while API calls use only public parameters", () => {
  const filter = readBookCaseQuery(new URLSearchParams("book_id=ziping-zhenquan&offset=24&limit=12&from=learning"));
  assert.deepEqual(filter, { book_id: "ziping-zhenquan", offset: 24, limit: 12, from: "learning" });
  assert.equal(bookCaseListPath(filter), "/book-cases?book_id=ziping-zhenquan&offset=24&limit=12&from=learning");
  assert.equal(bookCaseListPath(filter, { book_id: "ditian-sui", offset: 0 }), "/book-cases?book_id=ditian-sui&limit=12&from=learning");
  assert.equal(bookCaseDetailPath("display-example", filter), "/book-cases/display-example?book_id=ziping-zhenquan&offset=24&limit=12&from=learning");
  assert.equal(bookCaseApiPath(filter), "/api/book-cases?book_id=ziping-zhenquan&offset=24&limit=12");
  assert.deepEqual(readBookCaseQuery(new URLSearchParams("book_id=../private&offset=-1&limit=999&from=other")),
    { book_id: "", offset: 0, limit: 24, from: "" });
  assert.equal(bookCaseApiPath({}), "/api/book-cases?offset=0&limit=24");
  const contract = JSON.parse(readFileSync(new URL("../contracts/openapi/client.openapi.json", import.meta.url), "utf8"));
  assert.deepEqual(contract.paths["/api/book-cases"].get.parameters.map(item => item.name), ["book_id", "offset", "limit"]);
  assert.ok(contract.paths["/api/book-cases/{case_id}"].get);
});

test("book case entries require a positive public count and source links keep the server edition page", () => {
  for (const case_count of [undefined, null, 0, -1, "1", 1.5]) assert.equal(bookCasesEntry({ id: "book", case_count }), null);
  assert.equal(bookCasesEntry({ id: "ziping-zhenquan", case_count: 1 }, "learning"), "/book-cases?book_id=ziping-zhenquan&from=learning");
  assert.equal(bookCaseReadingPath("/books/ziping-zhenquan?page=5", "learning"), "/books/ziping-zhenquan?page=5&from=learning");
  assert.equal(bookCaseReadingPath("/books/ziping-zhenquan?page=5"), "/books/ziping-zhenquan?page=5");
  for (const path of ["javascript:alert(1)", "//elsewhere.test/books/book?page=1", "/books/book?page=0", "/books/book?text-version=current", "/books/book?page=5&other=1"])
    assert.equal(bookCaseReadingPath(path), null);
});

// Native DOM replacement, with no source-data HTML parsing. Only the existing
// static icon template may create an SVG; all API strings must stay text nodes.
class MockNode {
  constructor(tag = "", data = "") {
    this.tagName = tag.toUpperCase(); this.data = data; this.childNodes = [];
    this.attributes = new Map(); this.listeners = new Map(); this.dataset = {}; this.value = "";
    this.disabled = false; this.open = false; this.className = "";
  }
  append(...children) { children.forEach(child => { child.parentElement = this; this.childNodes.push(child); }); }
  replaceChildren(...children) { this.childNodes = []; this.append(...children); }
  set textContent(value) { this.childNodes = [new MockNode("", String(value))]; }
  get textContent() { return this.tagName ? this.childNodes.map(child => child.textContent).join("") : this.data; }
  set innerHTML(value) {
    assert.equal(this.tagName, "TEMPLATE", "API text must never be assigned to innerHTML");
    assert.match(value, /^<svg class="icon /);
    this.content = { firstElementChild: new MockNode("svg") };
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  emit(name) { this.listeners.get(name)?.({ currentTarget: this, target: this }); }
}
const all = node => [node, ...node.childNodes.flatMap(all)];
const tags = (node, name) => all(node).filter(child => child.tagName === name.toUpperCase());
const byText = (node, name, text) => tags(node, name).find(child => child.textContent === text);
function environment(query = "", id = "") {
  const listeners = new Map();
  globalThis.Node = MockNode;
  globalThis.document = { createElement: tag => new MockNode(tag), createTextNode: text => new MockNode("", text) };
  globalThis.window = {
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name, callback) => { if (listeners.get(name) === callback) listeners.delete(name); },
    scrollTo: (...args) => scrolls.push(args),
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
const tick = () => new Promise(resolve => setImmediate(resolve));
const book = { id: "ziping-zhenquan", title: "子平真诠", case_count: 1 };
// Synthetic display data, not a transcription of a historical person's chart.
const summary = { id: "display-example", book_id: book.id, book_title: book.title, title: "展示测试案例", kind: "named_case", summary: "原书分析与四柱。" };
const caseDetail = () => ({ ...summary,
  chart: [{ label: "年柱", value: "壬午" }, { label: "月柱", value: "己酉" }, { label: "日柱", value: "甲午" }, { label: "时柱", value: "丙寅" }],
  facts: ["原书具名命例。"], judgment: ["作者认为这一结构有利。"], outcome: [], outcome_status: "not_reported",
  original_excerpt: "原文案例。", original_context: "案例所在完整原段。", modern_context: "所在完整段落的白话。",
  context_before: "前一段原文。", context_after: "后一段原文。", uncertainties: [],
  sources: [{ edition_label: "1926年校勘本", chapter: "论用神", location: "书内页码", reading_path: "/books/ziping-zhenquan?page=5" }],
});

test("case list loads public records, filters books, preserves paging and reports current intake counts", async () => {
  const env = environment("book_id=ziping-zhenquan&offset=2&limit=2&from=learning");
  const paths = [];
  const result = render(env.ctx, async path => {
    paths.push(path);
    return path === "/api/books" ? { books: [book, { id: "empty", title: "未收录书籍", case_count: 0 }] }
      : { items: [summary, { ...summary, id: "second-case", title: "第二例" }], total: 6, offset: 2, limit: 2 };
  });
  assert.match(result.node.textContent, /正在打开案例/);
  result.onRestore(350);
  await tick();
  assert.deepEqual(paths, ["/api/book-cases?book_id=ziping-zhenquan&offset=2&limit=2", "/api/books"]);
  assert.match(result.node.textContent, /当前已收录 6 条案例/);
  assert.equal(byText(result.node, "a", "案例").getAttribute("href"), "#/book-cases?from=learning");
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
  assert.match(result.node.textContent, /这本书暂未收录案例/);
  assert.match(result.node.textContent, /当前已收录 0 条案例/);
  assert.equal(all(result.node).find(node => node.className === "book-cases-pagination").childNodes.length, 0);
  assert.equal(tags(result.node, "h1")[0].className, "sr-only");
  assert.equal(result.node.textContent.includes("not-in-catalogue"), false);
  assert.equal(byText(result.node, "a", "查看全部案例").getAttribute("href"), "#/book-cases");
  env.cleanup();
});

test("single-page intake shows one count without a repeated heading, introduction or page counter", async () => {
  const env = environment();
  const result = render(env.ctx, async path => path === "/api/books" ? { books: [book] }
    : { items: [summary], total: 1, offset: 0, limit: 24 });
  await tick();
  assert.equal(tags(result.node, "h1")[0].className, "sr-only");
  assert.equal(tags(result.node, "header").length, 0);
  assert.match(result.node.textContent, /当前已收录 1 条案例/);
  assert.equal(all(result.node).find(node => node.className === "book-cases-pagination").childNodes.length, 0);
  env.cleanup();
});

test("case detail separates book judgment and unreported outcome and folds source text and same-paragraph translation", async () => {
  const env = environment("book_id=ziping-zhenquan&offset=24&from=learning", "display-example");
  const data = caseDetail();
  data.original_excerpt = "<script>alert(1)</script>"; data.modern_context = "<img onerror=alert(1)>";
  const paths = [];
  const result = render(env.ctx, async path => { paths.push(path); return data; });
  assert.match(result.node.textContent, /正在打开案例/);
  await tick();
  assert.deepEqual(paths, ["/api/book-cases/display-example"]);
  assert.deepEqual(tags(result.node, "dd").map(node => node.textContent), ["壬午", "己酉", "甲午", "丙寅"]);
  assert.equal(byText(result.node, "h2", "原书分析").parentElement.textContent, "原书分析作者认为这一结构有利。");
  assert.equal(byText(result.node, "h2", "书载结果").parentElement.textContent, "书载结果原书此处未记载具体结果。");
  assert.equal(tags(result.node, "details").length, 2);
  assert.ok(tags(result.node, "details").every(node => !node.open && node.getAttribute("open") === null));
  assert.match(result.node.textContent, /所在段白话/);
  assert.match(result.node.textContent, /案例所在完整原段/);
  assert.match(result.node.textContent, /前一段原文/);
  assert.match(result.node.textContent, /后一段原文/);
  assert.equal(tags(result.node, "script").length, 0); assert.equal(tags(result.node, "img").length, 0);
  assert.match(result.node.textContent, /<script>alert\(1\)<\/script>/);
  assert.equal(tags(result.node, "a").find(node => node.textContent.startsWith("回到原书章节")).getAttribute("href"), "#/books/ziping-zhenquan?page=5&from=learning");
  assert.equal(byText(result.node, "a", "返回案例").getAttribute("href"), "#/book-cases?book_id=ziping-zhenquan&offset=24&from=learning");
  env.cleanup();
});

test("recorded results remain server text and missing neighboring context is omitted", async () => {
  const env = environment("", "recorded-case");
  const data = { ...caseDetail(), outcome_status: "recorded", outcome: ["书中记载的结果。"], context_before: null, context_after: null };
  const result = render(env.ctx, async () => data); await tick();
  assert.equal(byText(result.node, "h2", "书载结果").parentElement.textContent, "书载结果书中记载的结果。");
  assert.equal(byText(result.node, "h2", "前一段"), undefined);
  assert.equal(byText(result.node, "h2", "后一段"), undefined);
  env.cleanup();
});

test("404 is a terminal unavailable state while network errors retry and recover on reconnect", async () => {
  const env = environment("", "missing-case");
  let attempt = 0;
  const result = render(env.ctx, async () => {
    if (++attempt === 1) throw Object.assign(new Error("missing"), { status: 404 });
    if (attempt === 2) throw Object.assign(new Error("连接中断"), { status: 0 });
    return caseDetail();
  });
  await tick();
  assert.match(result.node.textContent, /这个案例暂不可用/);
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
  let resolve, signal;
  const result = render(env.ctx, (_path, options) => { signal = options.signal; return new Promise(done => { resolve = done; }); });
  const before = result.node.textContent;
  env.cleanup(); assert.equal(signal.aborted, true);
  resolve(caseDetail()); await tick();
  assert.equal(result.node.textContent, before);
  assert.deepEqual(env.titles, []);
});
