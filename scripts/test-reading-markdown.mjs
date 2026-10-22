import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createReadingMarkdownContext, focusReadingFootnote, readingMarkdownTokens, renderEditionText } from "../web/public/next/lib/reading-markdown.js";

// Same minimal native-DOM approach as the glossary tests, without HTML parsing.
class MockNode {
  constructor(tagName = "", data = "") {
    this.tagName = tagName.toUpperCase(); this.data = data; this.childNodes = [];
    this.attributes = new Map(); this.listeners = new Map(); this.open = false;
  }
  append(...children) { for (const child of children) { child.parentElement = this; this.childNodes.push(child); } }
  set textContent(value) { this.childNodes = [new MockNode("", String(value))]; }
  get textContent() { return this.tagName ? this.childNodes.map(child => child.textContent).join("") : this.data; }
  set innerHTML(_) { throw new Error("Source must never be parsed as HTML"); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(name, handler) { this.listeners.set(name, handler); }
  scrollIntoView() { this.scrolled = true; }
  focus() { this.focused = true; }
}
const all = node => [node, ...node.childNodes.flatMap(all)];
const tags = (node, tag) => all(node).filter(child => child.tagName === tag.toUpperCase());
function environment() {
  const doc = { createElement: tag => new MockNode(tag), createTextNode: text => new MockNode("", text) };
  doc.body = doc.createElement("body");
  doc.getElementById = id => all(doc.body).find(node => node.getAttribute("id") === id);
  return doc;
}
const version = "reading-20261022-synthetic";
function render(text, context, doc = environment()) { return renderEditionText(version, text, context, doc); }

test("only the new reading collection enables formatting; old edition text stays identical", () => {
  const text = "# Sample\n<details>\n<summary>Extra</summary>\nbody\n</details>\n[^a]: note";
  for (const id of ["archive-v1", "reading-20261021-sample", "other-reading-20261022-a", undefined]) {
    const node = renderEditionText(id, text, null, environment());
    assert.equal(node.tagName, "P"); assert.equal(node.textContent, text);
    assert.equal(tags(node, "details").length, 0);
  }
  assert.equal(tags(render(text), "h1").length, 1);
});

test("headings and paragraphs keep source line breaks without mutating source input", () => {
  const source = "# Heading\n\nFirst line\nsecond  line\n\n###### Sixth\nLast line";
  const node = render(source);
  assert.equal(tags(node, "h1")[0].textContent, "Heading");
  assert.equal(tags(node, "h6")[0].textContent, "Sixth");
  assert.deepEqual(tags(node, "p").map(p => p.textContent), ["First line\nsecond  line\n", "Last line"]);
  assert.equal(source, "# Heading\n\nFirst line\nsecond  line\n\n###### Sixth\nLast line");
});

test("balanced source comments are hidden while surrounding prose and literal examples remain", () => {
  const source = "前文<!-- source-id -->后文\n\n<!-- locator\ncontinued -->\n\n正文\n\n`<!-- inline literal -->`\n\n```text\n<!-- fenced literal -->\n```\n\n<!-- unclosed stays";
  const node = render(source);
  assert.equal(tags(node, "p")[0].textContent, "前文后文\n");
  assert.ok(node.textContent.includes("正文"));
  assert.ok(!node.textContent.includes("source-id"));
  assert.ok(!node.textContent.includes("locator"));
  assert.deepEqual(tags(node, "code").map(code => code.textContent), ["<!-- inline literal -->", "<!-- fenced literal -->\n"]);
  assert.ok(node.textContent.includes("<!-- unclosed stays"));
  assert.ok(source.includes("<!-- source-id -->"));
  const hiddenFence = render("<!-- hidden\n```text\nlocator\n```\n-->\n可读正文");
  assert.equal(tags(hiddenFence, "pre").length, 0);
  assert.ok(!hiddenFence.textContent.includes("locator"));
  assert.ok(hiddenFence.textContent.includes("可读正文"));
});

test("emphasis and inline literals render through safe DOM and retain inert markup", () => {
  const node = render("**重点**与*轻读*，__另一重点__ _斜体_，`https://example.test/<script>**原样**`\n\n**<img src=x onerror=bad()>** [bad](javascript:alert(1))");
  assert.deepEqual(tags(node, "strong").map(item => item.textContent), ["重点", "另一重点", "<img src=x onerror=bad()>"]);
  assert.deepEqual(tags(node, "em").map(item => item.textContent), ["轻读", "斜体"]);
  assert.equal(tags(node, "code")[0].textContent, "https://example.test/<script>**原样**");
  assert.equal(tags(node, "a").length, 0);
  assert.equal(tags(node, "img").length, 0);
  assert.equal(tags(node, "script").length, 0);
  assert.ok(node.textContent.includes("[bad](javascript:alert(1))"));
});

test("lists preserve supplied numbering and pipe tables retain aligned and literal cells", () => {
  const node = render("- **甲**\n- 乙\n    补行\n\n3. 第三\n4. 第四\n\n| 名目 | 字义 |\n| :--- | ---: |\n| 干\\|支 | `甲|乙` |\n| <script>x</script> | **原注** |");
  assert.equal(tags(node, "ul").length, 1);
  assert.equal(tags(node, "ol")[0].getAttribute("start"), "3");
  assert.deepEqual(tags(node, "li").map(item => item.textContent), ["甲", "乙\n补行", "第三", "第四"]);
  assert.deepEqual(tags(node, "th").map(item => item.textContent), ["名目", "字义"]);
  assert.deepEqual(tags(node, "td").map(item => item.textContent), ["干|支", "甲|乙", "<script>x</script>", "原注"]);
  assert.deepEqual(tags(node, "th").map(item => item.getAttribute("data-align")), ["left", "right"]);
  assert.equal(tags(node, "script").length, 0);
  assert.ok(all(node).find(item => item.className === "book-reading-table").getAttribute("tabindex") === "0");
  assert.equal(tags(render("甲|乙\n文字|正文"), "table").length, 0);
});

test("unfenced aligned hexagram rows preserve every space and tab in a literal block", () => {
  const source = "父母  戌土  ▅▅▅▅▅\n兄弟\t申金\t▅▅ ▅▅\n子孫  午火  ▅▅▅▅▅";
  const node = render(source);
  assert.equal(tags(node, "pre").length, 1);
  assert.equal(tags(node, "code")[0].textContent, source);
  assert.equal(tags(render("正文中  留空，但仍是一句。"), "pre").length, 0);
});

test("fenced original notes preserve every inner character, CRLF, whitespace and markup literally", () => {
  const original = "  alpha\t[注：𠮷]  \r\n# not a heading\r\n<details>\r\n[^x]: not a note\r\n<script>alert(1)</script>\r\nhttps://example.test/code\r\n";
  const source = `\`\`\`text\r\n${original}\`\`\`\r\n`;
  const node = render(source);
  assert.equal(tags(node, "code")[0].textContent, original);
  assert.equal(tags(node, "pre")[0].getAttribute("tabindex"), "0");
  for (const tag of ["script", "details", "h1", "a"]) assert.equal(tags(node, tag).length, 0);
  assert.deepEqual(readingMarkdownTokens(source), [{ type: "code", text: original }]);
  assert.equal(tags(render("```text\nunfinished\n"), "code")[0].textContent, "unfinished\n");
});

test("exact details/summary create closed native disclosure nodes and retain duplicate text", () => {
  const source = "Outside\n\n<details>\n<summary>Repeated page</summary>\n\n# Retained\nSame text\n\n<details>\n<summary>Nested</summary>\nSame text\n</details>\n</details>";
  const node = render(source);
  const details = tags(node, "details");
  assert.equal(details.length, 2);
  assert.equal(details[0].childNodes[0].tagName, "SUMMARY");
  assert.equal(details[0].childNodes[0].textContent, "Repeated page");
  assert.equal(details[0].open, false); assert.equal(details[0].getAttribute("open"), null);
  details[0].open = true; assert.equal(details[0].open, true);
  assert.equal(tags(node, "h1")[0].textContent, "Retained");
  assert.equal(node.textContent.match(/Same text/g).length, 2);
  const fenced = render("<details>\n<summary>Sample</summary>\n```text\n</details>\n```\n</details>");
  assert.equal(tags(fenced, "details").length, 1);
  assert.equal(tags(fenced, "code")[0].textContent, "</details>\n");
});

test("HTML tags, scripts, disclosure attributes and malformed disclosure stay literal", () => {
  const samples = [
    '<script>alert(1)</script>\n<img src=x onerror="alert(1)">',
    '<details open onclick="alert(1)">\n<summary>Unsafe</summary>\nbody\n</details>',
    '<details>\n<summary onmouseover="alert(1)">Unsafe</summary>\nbody\n</details>',
    '<details>\n<summary>Unclosed</summary>\nbody',
    '<iframe src="https://example.test/"></iframe>',
  ];
  for (const source of samples) {
    const node = render(source);
    assert.equal(node.textContent, source);
    for (const tag of ["script", "img", "iframe", "details", "summary", "a"]) assert.equal(tags(node, tag).length, 0);
  }
  const safeSummary = render('<details>\n<summary><img onerror="bad()">literal</summary>\nbody\n</details>');
  assert.equal(tags(safeSummary, "summary")[0].textContent, '<img onerror="bad()">literal');
  assert.equal(tags(safeSummary, "img").length, 0);
});

test("only validated https links become clickable and never transfer source attributes", () => {
  const source = '[source](https://example.test/a?x=1&y=2) https://example.test/路径。\n' +
    '[bad](javascript:alert(1)) [bad](data:text/html,bad) [bad](//example.test/) ' +
    '[bad](http://example.test/) [bad](https://user:pass@example.test/) ' +
    '[bad](https://example.test/"onclick="bad) https://\n' +
    '<a href="https://example.test/" onclick="bad()">html</a>';
  const node = render(source);
  const links = tags(node, "a");
  assert.deepEqual(links.map(link => link.getAttribute("href")), ["https://example.test/a?x=1&y=2", "https://example.test/路径"]);
  assert.deepEqual(links.map(link => link.textContent), ["source", "https://example.test/路径"]);
  for (const link of links) {
    assert.deepEqual([...link.attributes.keys()], ["href", "target", "rel"]);
    assert.equal(link.getAttribute("rel"), "noopener noreferrer");
  }
  assert.ok(node.textContent.includes('[bad](javascript:alert(1))'));
  assert.ok(node.textContent.includes('<a href="https://example.test/" onclick="bad()">html</a>'));
});

test("chapter-local footnotes resolve across blocks, retain missing markers and open containing disclosure", () => {
  const doc = environment();
  const texts = ["Reference[^a] and cross-chapter[^missing]", "<details>\n<summary>Notes</summary>\n[^a]: Supplied note\n    continuation\n</details>"];
  const context = createReadingMarkdownContext(texts);
  const nodes = texts.map(text => render(text, context, doc)); doc.body.append(...nodes);
  const link = tags(nodes[0], "a")[0];
  assert.equal(link.textContent, "[^a]");
  assert.equal(link.getAttribute("href"), "#reading-footnote-1");
  const missing = all(nodes[0]).find(node => node.className === "book-footnote-unresolved");
  assert.equal(missing.textContent, "[^missing]");
  assert.ok(missing.getAttribute("title").includes("此版本未提供"));
  const target = doc.getElementById("reading-footnote-1");
  assert.equal(target.textContent, "[^a]: Supplied note\ncontinuation");
  assert.equal(tags(nodes[1], "details")[0].open, false);
  let prevented = false;
  link.listeners.get("click")({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(target.focused, true); assert.equal(target.scrolled, true);
  assert.equal(tags(nodes[1], "details")[0].open, true);
  const isolated = render("[^a]");
  assert.equal(tags(isolated, "a").length, 0); assert.equal(isolated.textContent, "[^a]");
});

test("footnote IDs are generated locally and duplicate supplied definitions are all retained", () => {
  const source = '[^<unsafe>]: first\n\n[^<unsafe>]: second\n\nRef[^<unsafe>]';
  const node = render(source);
  const identified = all(node).filter(child => child.getAttribute("id"));
  assert.deepEqual(identified.map(child => child.getAttribute("id")), ["reading-footnote-1"]);
  assert.ok(node.textContent.includes("first")); assert.ok(node.textContent.includes("second"));
  assert.equal(tags(node, "unsafe").length, 0);
});

test("cross-chapter footnotes navigate within the edition route and focus only the supplied destination definition", () => {
  const chapters = [
    { id: "first", blocks: [{ text: "Reference[^四補1], unknown[^absent]" }] },
    { id: "last/chapter", blocks: [{ text: "<details>\n<summary>Notes</summary>\n[^四補1]: supplied definition\n</details>" }] },
  ];
  const navigated = [];
  const options = { chapters, chapterId: "first", navigate: path => navigated.push(path),
    footnotePath: (chapter, label) => `/books/sample?text-version=${version}&chapter=${encodeURIComponent(chapter)}&footnote=${encodeURIComponent(label)}` };
  const context = createReadingMarkdownContext(chapters[0].blocks.map(block => block.text), options);
  const node = render(chapters[0].blocks[0].text, context);
  const link = tags(node, "a")[0];
  const path = `/books/sample?text-version=${version}&chapter=last%2Fchapter&footnote=${encodeURIComponent("四補1")}`;
  assert.equal(link.getAttribute("href"), `#${path}`);
  let prevented = false;
  link.listeners.get("click")({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.deepEqual(navigated, [path]);
  assert.equal(all(node).filter(child => child.className === "book-footnote-unresolved").length, 1);
  assert.equal(node.textContent.includes("supplied definition"), false);
  const doc = environment();
  const destination = createReadingMarkdownContext(chapters[1].blocks.map(block => block.text), { ...options, chapterId: chapters[1].id });
  doc.body.append(render(chapters[1].blocks[0].text, destination, doc));
  assert.equal(focusReadingFootnote(destination, "四補1", doc), true);
  const target = doc.getElementById(destination.definitions.get("四補1").id);
  assert.equal(target.textContent, "[^四補1]: supplied definition"); assert.equal(target.focused, true);
  assert.equal(tags(doc.body, "details")[0].open, true);
  assert.equal(focusReadingFootnote(context, "四補1", doc), false);
  assert.equal(focusReadingFootnote(destination, "absent", doc), false);
});

test("chapter-local definitions take priority over a repeated label elsewhere in the edition", () => {
  const chapters = [{ id: "other", blocks: [{ text: "[^same]: other" }] },
    { id: "current", blocks: [{ text: "[^same]: local\n\nRef[^same]" }] }];
  const context = createReadingMarkdownContext([chapters[1].blocks[0].text], { chapters, chapterId: "current" });
  assert.equal(context.definitions.get("same").chapterId, "current");
  assert.equal(context.definitions.get("same").text, "local");
  assert.equal(tags(render(chapters[1].blocks[0].text, context), "a")[0].getAttribute("href"), "#reading-footnote-1");
});

test("library titles and primary entries open electronic catalogs; historical sources and routes stay labeled", () => {
  const source = readFileSync(new URL("../web/public/next/views/books.js", import.meta.url), "utf8");
  const library = source.slice(source.indexOf("function library(ctx)"), source.indexOf("function reader(ctx)"));
  assert.ok(library.includes("const catalogPath = textVersionPath(book.id)"));
  assert.match(library, /h\("h2", null, h\("a", \{ href: `#\$\{catalogPath\}` \}/);
  assert.match(library, /class: "btn btn-soft books-electronic-open", href: `#\$\{catalogPath\}`/);
  assert.match(library, /class: "books-history-open", href: `#\$\{readingPath\(book.id, progress\)\}`/);
  for (const marker of ["历史稿来源：", "历史稿说明：", "历史稿读到第", "打开历史阅读稿", "继续历史阅读稿"]) assert.ok(library.includes(marker));
});
