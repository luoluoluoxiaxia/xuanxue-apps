import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createReadingMarkdownContext, focusReadingFootnote, readingMarkdownTokens, renderEditionText } from "../web/public/next/lib/reading-markdown.js";
import { textReadingPosition, textReadingTarget } from "../web/public/next/lib/books.js";

// Same minimal native-DOM approach as the glossary tests, without HTML parsing.
class MockNode {
  constructor(tagName = "", data = "") {
    this.tagName = tagName.toUpperCase(); this.data = data; this.childNodes = [];
    this.attributes = new Map(); this.listeners = new Map(); this.open = false;
    this.dataset = {};
    this.style = { setProperty(name, value) { this[name] = value; } };
    this.classList = {
      contains: name => String(this.className || "").split(" ").includes(name),
      add: name => { this.className = `${this.className || ""} ${name}`.trim(); },
      remove: name => { this.className = String(this.className || "").split(" ").filter(value => value !== name).join(" "); },
    };
  }
  append(...children) { for (const child of children) { child.parentElement = this; this.childNodes.push(child); } }
  replaceChildren(...children) { this.childNodes = []; this.append(...children); }
  after(node) { const siblings = this.parentElement.childNodes; node.parentElement = this.parentElement; siblings.splice(siblings.indexOf(this) + 1, 0, node); }
  remove() { if (this.parentElement) this.parentElement.childNodes = this.parentElement.childNodes.filter(node => node !== this); }
  get children() { return this.childNodes.filter(node => node.tagName); }
  set textContent(value) { this.childNodes = [new MockNode("", String(value))]; }
  get textContent() { return this.tagName ? this.childNodes.map(child => child.textContent).join("") : this.data; }
  set innerHTML(value) {
    assert.equal(this.tagName, "TEMPLATE", "Source must never be parsed as HTML");
    assert.match(value, /^<svg\b/);
    this.content = { firstElementChild: new MockNode("svg") };
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? (name.startsWith("data-") ? this.dataset[name.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] ?? null : null); }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(name, handler) { this.listeners.set(name, handler); }
  removeEventListener(name, handler) { if (this.listeners.get(name) === handler) this.listeners.delete(name); }
  contains(node) { return node === this || this.childNodes.some(child => child.contains(node)); }
  matches(selector) {
    const attr = selector.match(/^(.*?)\[([^=\]]+)(?:="([^"]*)")?\]$/);
    if (attr) return (!attr[1] || this.matches(attr[1])) && this.getAttribute(attr[2]) !== null && (attr[3] === undefined || this.getAttribute(attr[2]) === attr[3]);
    return selector.startsWith(".") ? this.classList.contains(selector.slice(1)) : this.tagName === selector.toUpperCase();
  }
  querySelectorAll(selector) { return all(this).slice(1).filter(node => selector.split(",").some(value => node.matches(value.trim()))); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  getBoundingClientRect() { return { top: 0, bottom: 100, height: 100, left: 0, width: 400 }; }
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

test("the actual reader block renders one title in each language layer and preserves its source anchor and notes", async () => {
  globalThis.Node = MockNode;
  globalThis.document = { ...environment(), addEventListener() {}, removeEventListener() {} };
  globalThis.location = { hash: "", search: "", origin: "https://example.test" };
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  const { renderBookBlock } = await import("../web/public/next/views/books.js");
  const { renderBookText } = await import("../web/public/next/ui/book-glossary.js");
  const renderText = (parts, terms, layer) => renderBookText(parts, terms, layer, new Map());
  const block = { id: "b-opening-source-1", role: "heading", text: "占法卦數", modern: "占法卦数",
    notes: ["源题名保留。"], terms: [] };
  const before = structuredClone(block);
  const node = renderBookBlock(block, { hasModern: true, hasFigure: false, openingTitle: true, renderText });
  const layer = name => all(node).find(child => child.className === name);
  assert.equal(node.dataset.blockId, block.id);
  assert.deepEqual(tags(layer("book-original"), "h2").map(item => item.textContent), [block.text]);
  assert.deepEqual(tags(layer("book-modern"), "h2").map(item => item.textContent), [block.modern]);
  assert.equal(tags(node, "h3").length, 0);
  assert.ok(tags(node, "details").some(item => item.textContent.includes(block.notes[0])));
  // Existing mode CSS selects these exact language-layer nodes. Each surviving
  // column has one real h2, including modern-only mode where original is hidden.
  const css = readFileSync(new URL("../web/public/next/next-books.css", import.meta.url), "utf8");
  assert.ok(css.includes('[data-mode="original"] .book-modern { display: none; }'));
  assert.ok(css.includes('[data-mode="modern"] .book-block:has(.book-modern) .book-original { display: none; }'));
  for (const mode of ["original", "modern", "parallel"]) {
    const columns = mode === "parallel" ? ["book-original", "book-modern"] : [`book-${mode}`];
    for (const name of columns) assert.equal(tags(layer(name), "h2").length, 1, `${mode} ${name}`);
  }
  const subheading = renderBookBlock(block, { hasModern: true, hasFigure: false, openingTitle: false, renderText });
  assert.equal(tags(subheading, "h2").length, 0);
  assert.equal(tags(subheading, "h3").length, 2);
  for (const attribution of ["原注", "原書欄外小字，歸屬未定", "某氏評注"]) {
    const note = renderBookBlock({ ...block, role: "note", text: "原注内容。", attribution }, { hasModern: true, renderText });
    const labels = all(note).filter(item => String(item.className || "").split(" ").includes("book-layer") &&
      item.parentElement.className === "book-original");
    assert.deepEqual(labels.map(item => item.textContent), [attribution]);
  }
  assert.deepEqual(block, before);
});

test("mapped transcription folding is explicit while legacy diagrams and tables keep their previous behavior", async () => {
  globalThis.Node = MockNode;
  globalThis.document = { ...environment(), addEventListener() {}, removeEventListener() {} };
  globalThis.location = { hash: "", search: "", origin: "https://example.test" };
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  const { renderBookBlock } = await import("../web/public/next/views/books.js");
  const block = { id: "transcription-stable", role: "table", text: "甲 𠮷 □ ▅▅\n乙 丙", modern: "", notes: ["原校记。"], terms: [] };
  const render = (value, options = {}) => renderBookBlock(value, { hasModern: false, renderText: parts => parts.map(part => part.text), ...options });
  const folded = node => Boolean(node.querySelector(".book-diagram-transcription"));
  assert.equal(folded(render(block)), false);
  assert.equal(folded(render(block, { hasFigure: true })), true);
  assert.equal(folded(render({ ...block, presentation: "diagram" })), true);
  for (const presentation of ["table", "diagram"]) {
    const value = { ...block, presentation };
    assert.equal(folded(render(value, { collapseTranscription: true })), true);
    const visible = render(value, { hasFigure: true, collapseTranscription: false });
    assert.equal(folded(visible), false);
    assert.equal(tags(visible, "pre")[0].textContent, block.text);
    assert.ok(visible.textContent.includes(block.notes[0]));
  }
  assert.equal(folded(render({ ...block, role: "text" }, { collapseTranscription: true })), false);
  const diagram = render({ ...block, role: "diagram_caption", source_text: false }, { collapseTranscription: false });
  assert.equal(folded(diagram), false);
  const notice = diagram.querySelector(".book-transcription-notice");
  assert.ok(notice.textContent.includes("位置与连接请以书影为准"));
  assert.equal(notice.parentElement.tagName, "DIV");
  assert.equal(diagram.querySelector(".book-original").querySelector("pre").textContent, block.text,
    "the copyable source layer contains the exact transcription, without the notice");
  assert.ok(diagram.querySelector(".book-notes").textContent.includes(block.notes[0]));
  const grouped = render({ ...block, role: "diagram_caption", source_text: false },
    { collapseTranscription: false, groupedTranscription: true });
  assert.equal(grouped.querySelector(".book-transcription-notice"), null);
  assert.equal(grouped.querySelector(".book-layer"), null);
  assert.equal(grouped.querySelector("pre").textContent, block.text);
  assert.ok(grouped.querySelector(".book-notes").textContent.includes(block.notes[0]));
});

// Actual 2026-10-22 Ziping reading segments, reduced to the fields used for
// navigation. Source paragraph numbers and the fifteen boundaries are frozen
// corpus data; no book text or temporary-file dependency is needed here.
function zipingReadingSegments() {
  const starts = [1, 10, 21, 31, 43, 65, 81, 102, 120, 148, 168, 199, 230, 254, 280];
  const blockId = number => `source-0002-r-001-p-${String(number).padStart(3, "0")}`;
  return { book_id: "ziping-zhenquan", version_id: "reading-20261022-1a356195", default_section_id: "section-002", source_sections: [],
    sections: starts.map((start, index) => ({
      id: index ? `section-002-${blockId(start)}` : "section-002",
      title: `正文 · 阅读分段 ${index + 1}`, kind: "body", source_chapter_id: "section-002",
      blocks: Array.from({ length: (starts[index + 1] || 285) - start }, (_, offset) => ({ id: blockId(start + offset) })),
    })) };
}

test("Ziping legacy first, boundary, middle and final paragraph positions resume in the corresponding new segments", () => {
  const reading = zipingReadingSegments();
  const untouched = structuredClone(reading);
  for (const [anchor, index, localAnchor, blockId] of [[0, 0, 0, "source-0002-r-001-p-001"],
    [9, 1, 0, "source-0002-r-001-p-010"], [141, 8, 22, "source-0002-r-001-p-142"],
    [283, 14, 4, "source-0002-r-001-p-284"]]) {
    const saved = { versionId: reading.version_id, sectionId: "section-002", title: "正文", updatedAt: 100,
      anchor, offset: .375, punctuation: "source" };
    const stored = textReadingPosition(JSON.parse(JSON.stringify(saved)));
    const expected = { index, position: { ...saved, sectionId: reading.sections[index].id,
      title: reading.sections[index].title, anchor: localAnchor, blockId, blockAnchor: 0 } };
    assert.deepEqual(textReadingTarget(reading, { saved: stored }), expected);
    assert.deepEqual(textReadingTarget(reading, { requested: "section-002", saved: stored, resume: true }), expected);
    assert.deepEqual(stored, saved);
  }
  assert.deepEqual(reading, untouched);
});

test("explicit Ziping contents and footnote destinations take priority over a migrated continue-reading anchor", () => {
  const reading = zipingReadingSegments();
  const saved = { versionId: reading.version_id, sectionId: "section-002", title: "正文", updatedAt: 100, anchor: 283, offset: .4 };
  assert.deepEqual(textReadingTarget(reading, { requested: reading.sections[8].id, saved, resume: true }), { index: 8, position: null });
  assert.deepEqual(textReadingTarget(reading, { requested: "section-002", saved }), { index: 0, position: null });
  assert.deepEqual(textReadingTarget(reading, { requested: "section-002", saved, resume: true, footnote: "注一" }), { index: 0, position: null });
  assert.deepEqual(textReadingTarget(reading, { requested: "unknown-chapter", saved, resume: true }), { index: -1, position: null });
});

test("persisted block identity and local paragraph survive segment changes without overriding explicit navigation", () => {
  const reading = zipingReadingSegments();
  const saved = { versionId: reading.version_id, sectionId: "section-002", title: "正文", updatedAt: 100,
    anchor: 141, offset: .625, punctuation: "punctuated", blockId: "source-0002-r-001-p-142", blockAnchor: 2 };
  const stored = textReadingPosition(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(stored, saved);
  const expected = { index: 8, position: { ...saved, sectionId: reading.sections[8].id, title: reading.sections[8].title } };
  assert.deepEqual(textReadingTarget(reading, { saved: stored }), expected);
  assert.deepEqual(textReadingTarget(reading, { requested: "section-002", saved: stored, resume: true }), expected);
  assert.deepEqual(textReadingTarget(reading, { requested: reading.sections[14].id, saved: stored, resume: true }), { index: 14, position: null });
  for (const fields of [{ blockId: "../unknown" }, { blockAnchor: -1 }, { blockAnchor: 1.5 }, { blockAnchor: undefined }]) {
    const withoutBlock = { ...saved }; delete withoutBlock.blockId; delete withoutBlock.blockAnchor;
    assert.deepEqual(textReadingPosition({ ...saved, ...fields }), withoutBlock);
  }
});

test("legacy migration leaves other editions and ordinary books alone and handles unknown identities safely", () => {
  const reading = zipingReadingSegments();
  const saved = { versionId: reading.version_id, sectionId: "section-002", title: "正文", updatedAt: 100, anchor: 283, offset: .4 };
  for (const changed of [{ ...reading, book_id: "ordinary-book" }, { ...reading, version_id: "reading-20261022-other" }]) {
    assert.deepEqual(textReadingTarget(changed, { saved }), { index: 0, position: saved });
  }
  const ordinary = { default_section_id: "body", source_sections: [], sections: [{ id: "preface" }, { id: "body" }] };
  const normalSaved = { ...saved, sectionId: "body", blockId: "unknown-block", blockAnchor: 0 };
  assert.deepEqual(textReadingTarget(ordinary, { saved: normalSaved }), { index: 1, position: normalSaved });
  assert.deepEqual(textReadingTarget(ordinary, { saved: { ...normalSaved, sectionId: "removed-section" } }), { index: 1, position: null });
  assert.deepEqual(textReadingTarget(ordinary, { requested: "unknown-section", saved: normalSaved, resume: true }), { index: -1, position: null });
});

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

test("supplied punctuation renders through the same safe Markdown path and leaves the source intact", async () => {
  const { readingBlockText } = await import("../web/public/next/lib/books.js");
  const block = { text: "正文原稿\n\n<script>alert(1)</script>", punctuated_text: "正文，整理句读。\n\n<script>alert(1)</script>\n\n```text\n甲\t乙\n丙\t丁\n```" };
  const source = structuredClone(block);
  const node = render(readingBlockText(block));
  assert.equal(tags(node, "p")[0].textContent, "正文，整理句读。\n");
  assert.equal(tags(node, "script").length, 0);
  assert.ok(node.textContent.includes("<script>alert(1)</script>"));
  assert.equal(tags(node, "code")[0].textContent, "甲\t乙\n丙\t丁\n");
  assert.equal(readingBlockText(block, "source"), block.text);
  assert.deepEqual(block, source);
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

test("Yiyin's explicit eight-trigram slash table displays only the supplied strokes", () => {
  const names = ["乾三连", "坤六断", "震仰盂", "艮覆碗", "离中虚", "坎中满", "兑上缺", "巽下断"];
  const strokes = [["/", "/", "/"], ["//", "//", "//"], ["//", "//", "/"], ["/", "//", "//"],
    ["/", "//", "/"], ["//", "/", "//"], ["//", "/", "/"], ["/", "/", "//"]];
  const source = "| 卦名 | 上爻 | 中爻 | 下爻 |\n| --- | --- | --- | --- |\n"
    + names.map((name, index) => `| ${name} | ${strokes[index].join(" | ")} |`).join("\n");
  const context = createReadingMarkdownContext([source], { bookId: "yiyin" });
  const node = render(source, context);
  assert.deepEqual(tags(node, "td").filter((_, index) => index % 4 === 0).map(cell => cell.textContent), names);
  const displayed = all(node).filter(item => item.className === "book-reading-trigram-stroke");
  assert.equal(displayed.length, 24);
  assert.deepEqual(displayed.map(item => item.getAttribute("data-source-text")), strokes.flat());
  assert.deepEqual(displayed.map(item => item.textContent), strokes.flat().map(value => value === "/" ? "⚊" : "⚋"));
  for (const item of displayed) {
    assert.ok(item.getAttribute("title").includes(item.getAttribute("data-source-text")));
    assert.ok(item.getAttribute("aria-label").includes(item.getAttribute("data-source-text")));
  }
  for (const bookId of [undefined, "zengshan-buyi"]) {
    assert.equal(all(render(source, createReadingMarkdownContext([source], { bookId }))).filter(item => item.className === "book-reading-trigram-stroke").length, 0);
  }
  const otherHeader = source.replace("卦名", "项目");
  assert.equal(all(render(otherHeader, createReadingMarkdownContext([otherHeader], { bookId: "yiyin" }))).filter(item => item.className === "book-reading-trigram-stroke").length, 0);
  assert.equal(source.includes("⚊"), false);
});

test("unfenced aligned hexagram rows preserve every space and tab in a literal block", () => {
  const source = "父母  戌土  ▅▅▅▅▅\n兄弟\t申金\t▅▅ ▅▅\n子孫  午火  ▅▅▅▅▅";
  const node = render(source);
  assert.equal(tags(node, "pre").length, 1);
  assert.equal(tags(node, "code")[0].textContent, source);
  assert.equal(tags(render("正文中  留空，但仍是一句。"), "pre").length, 0);
});

test("an unfenced hexagram inside a long prose paragraph isolates its consecutive rows only", () => {
  const before = "論動變之理，當以卦情參看。\n作者接著說明取用與判斷的方法。\n";
  const rows = "父母  戌土  ▅▅▅▅▅\n兄弟  申金  ▅▅ ▅▅\n子孫  午火  ▅▅▅▅▅\n官鬼  卯木  ▅▅▅▅▅\n妻財  子水  ▅▅ ▅▅\n父母  戌土  ▅▅ ▅▅\n";
  const after = "此卦之中，仍須逐一核對動爻。\n此後的長篇解說也應繼續正常閱讀。";
  const source = before + rows + after;
  const tokens = readingMarkdownTokens(source);
  assert.deepEqual(tokens, [{ type: "paragraph", text: before }, { type: "code", text: rows }, { type: "paragraph", text: after }]);
  assert.equal(tokens.map(token => token.text).join(""), source);
  const node = render(source);
  assert.equal(tags(node, "pre").length, 1);
  assert.equal(tags(node, "code")[0].textContent, rows);
  assert.deepEqual(tags(node, "p").map(item => item.textContent), [before, after]);
  const separated = readingMarkdownTokens("孤立  一列  數據\n中間仍然是正文。\n另一  單獨  數據");
  assert.equal(separated.length, 1); assert.equal(separated[0].type, "paragraph");
});

test("long Chinese prose with printed spacing or circles never becomes an unfenced diagram", () => {
  const passage = "柱干為禄夲定一生職位髙低支作命基布三限夀元終始年生為根月建為苖日管經營斷中年之休咎";
  for (const spacing of ["　　", "  ", "\t"]) {
    const long = passage.repeat(80) + spacing + "○先推胎息之由次入變通之道" + spacing + passage.repeat(80);
    const source = long + "\n印旺　官生　福重\n";
    const tokens = readingMarkdownTokens(source);
    assert.deepEqual(tokens, [{ type: "paragraph", text: source }]);
    const node = render(source);
    assert.equal(tags(node, "pre").length, 0);
    assert.equal(tags(node, "p")[0].textContent, source);
  }
});

test("short metrical runs keep lineation without promoting scanned prose into verse", () => {
  const before = "下面另有歌訣，原來的行序仍應保留。\n";
  const verse = "三才變化　四營成易\n六爻爲義　八卦爲體\n";
  const after = "此後回到正文，仍然繼續敘述取用的條件。";
  const tokens = readingMarkdownTokens(before + verse + after);
  assert.deepEqual(tokens, [{ type: "paragraph", text: before }, { type: "code", text: verse, verse: true }, { type: "paragraph", text: after }]);
  const node = render(before + verse + after);
  assert.equal(tags(node, "pre")[0].className, "book-reading-literal book-reading-literal-text");
  assert.equal(tags(node, "code")[0].textContent, verse);
  assert.equal(readingMarkdownTokens("長篇掃描正文不應只因有規律的換行就被當成歌訣\n下一行也仍然是一般正文的完整轉錄")[0].type, "paragraph");
  const table = "旺　相　休　囚　死\n春　木　火　水　金　土";
  assert.deepEqual(readingMarkdownTokens(table), [{ type: "code", text: table }]);
  assert.equal(tags(render(table), "pre")[0].className, "book-reading-literal book-reading-literal-diagram");
});

test("Chinese soft line breaks stay in source text and receive a display-only marker", () => {
  const source = "原文的掃描行在這裡\n接續下文，不應多一個空格。\n  這裡仍然是正文。\nEnglish line\nnext English line";
  const node = render(source);
  assert.equal(node.textContent, source);
  const breaks = all(node).filter(item => item.className === "book-reading-soft-break");
  assert.deepEqual(breaks.map(item => item.textContent), ["\n", "\n  "]);
  const literal = render("```text\n原來的行序\n仍然要保留\n```");
  assert.equal(all(literal).filter(item => item.className === "book-reading-soft-break").length, 0);
});

test("Huozhulin supplied two-space verse endings render as hard breaks after punctuation", () => {
  const sources = [
    { text: "吉凶只在面前決  \n禍福無勞口後知  \n從此敢開天地口  \n老夫非是愛吟詩",
      punctuated: "吉凶只在面前決，  \n禍福無勞口後知。  \n從此敢開天地口，  \n老夫非是愛吟詩。", breaks: 3 },
    { text: "休囚為鬼　旺相為神  \n本象家親　他宮外人",
      punctuated: "休囚為鬼，　旺相為神；  \n本象家親，　他宮外人。", breaks: 1 },
  ];
  for (const source of sources) {
    const original = structuredClone(source);
    const raw = render(source.text);
    assert.equal(tags(raw, "pre").length, 1);
    assert.equal(raw.textContent, source.text);
    const node = render(source.punctuated);
    assert.equal(tags(node, "p").length, 1);
    assert.equal(tags(node, "br").length, source.breaks);
    assert.equal(node.textContent, source.punctuated);
    assert.equal(all(node).filter(item => item.className === "book-reading-soft-break").length, 0);
    assert.deepEqual(source, original);
  }
});

test("explicit hard breaks differ from scan soft breaks and do not alter literal content", () => {
  const source = "正文接著說明條件\n接續正文。  \n**明確換行**後面。   \r\n末行。  \n";
  const node = render(source);
  assert.equal(tags(node, "br").length, 2);
  assert.equal(all(node).filter(item => item.className === "book-reading-soft-break").length, 1);
  assert.equal(node.textContent, source.replace("**明確換行**", "明確換行"));
  assert.equal(tags(node, "strong")[0].textContent, "明確換行");
  assert.equal(tags(render("普通一個空格 \n接續正文。"), "br").length, 0);
  const literal = render("```text\n  保留縮進。  \n  下一行。\n```\n\n`行末兩空格  `  \n接續正文。");
  assert.equal(tags(literal, "br").length, 1);
  assert.deepEqual(tags(literal, "code").map(item => item.textContent), ["  保留縮進。  \n  下一行。\n", "行末兩空格  "]);
  assert.equal(all(literal).filter(item => item.className === "book-reading-verse-indent").length, 0);
});

test("only detected unfenced verse hides its common scan margin while retaining exact source", () => {
  const margin = "　　　　";
  const verse = `${margin}六乙日生時丙戌　鬼敗臨身有損傷\n${margin}若不氣通身旺月　孤貧勞碌苦難當\n`;
  const prose = "乙日丙戌時，鬼敗臨身。\n　原注仍保留縮進。";
  const node = render(verse + prose);
  const indents = all(node).filter(item => item.className === "book-reading-verse-indent");
  assert.deepEqual(indents.map(item => item.textContent), [margin, margin]);
  assert.ok(indents.every(item => item.getAttribute("hidden") === ""));
  assert.equal(tags(node, "code")[0].textContent, verse);
  assert.deepEqual(tags(node, "p").map(item => item.textContent), [prose]);
  assert.equal(node.textContent, verse + prose);
  const relative = render(`${margin}六乙日生時丙戌　鬼敗臨身有損傷\n${margin}　若不氣通身旺月　孤貧勞碌苦難當`);
  assert.ok(tags(relative, "code")[0].childNodes.some(item => !item.tagName && item.textContent.startsWith("　若不")));
  for (const source of [`\`\`\`text\n${verse}\`\`\``,
    `${margin}父母  戌土  ▅▅▅▅▅\n${margin}兄弟  申金  ▅▅ ▅▅`,
    `${margin}旺　相　休　囚　死\n${margin}春　木　火　水　金　土`,
    "```js\n    const value = 1;  \n    next();\n```", "    正文仍在同一段。\n    不是詩歌，也不應去掉縮進。"] ) {
    const untouched = render(source);
    assert.equal(all(untouched).filter(item => item.className === "book-reading-verse-indent").length, 0);
  }
});

test("Chinese reading text and short verse in literal fences keep their exact lines without a code presentation", () => {
  for (const source of ["甲乙東方木\n", "正月\n丙\n癸\n調和氣候為要。丙火為主。癸水為佐。\n", "三才變化\t四營成易\n六爻爲義\t八卦爲體\n"]) {
    const node = render(`~~~~text\n${source}~~~~`);
    assert.equal(tags(node, "pre")[0].className, "book-reading-literal book-reading-literal-text");
    assert.equal(tags(node, "code")[0].textContent, source);
  }
  const rows = "旺　相　休　囚　死\n春　木　火　水　金　土\n";
  const table = render(`~~~~text\n${rows}~~~~`);
  assert.equal(tags(table, "pre")[0].className, "book-reading-literal book-reading-literal-diagram");
  assert.equal(tags(table, "code")[0].textContent, rows);
  const diagram = render("~~~~text\n父母\t戌土\t▅▅▅▅▅\n兄弟\t申金\t▅▅ ▅▅\n~~~~");
  assert.equal(tags(diagram, "pre")[0].className, "book-reading-literal book-reading-literal-diagram");
  const technical = render("```js\nconst value = 1;\n```");
  assert.equal(tags(technical, "pre")[0].className, "book-reading-literal book-reading-literal-code");
});

test("stand-alone source note labels have a secondary presentation and retain their words", () => {
  const node = render("〔原注〕\n\n注文\n\n〔原刊栏外小注，归属未定〕\n\n栏外原文");
  assert.deepEqual(all(node).filter(item => item.className === "book-reading-source-label").map(item => item.textContent), ["〔原注〕\n", "〔原刊栏外小注，归属未定〕\n"]);
  assert.ok(node.textContent.includes("注文"));
  assert.ok(node.textContent.includes("栏外原文"));
  assert.equal(all(render("原文里有〔原注〕字样，不是单独标签。")).filter(item => item.className === "book-reading-source-label").length, 0);
});

test("known Chinese angle notes display as inline source notes without parsing HTML", () => {
  const text = '本論<按三曆會同雲：螣蛇為凶神>下文<贵>。<script>bad()</script><img src=x onerror="bad()">';
  const context = createReadingMarkdownContext([text], { bookId: "wuxing-jingji" });
  const node = render(text, context);
  assert.equal(node.textContent, '本論〔按三曆會同雲：螣蛇為凶神〕下文〔贵〕。<script>bad()</script><img src=x onerror="bad()">');
  const notes = all(node).filter(item => item.className === "book-reading-inline-note");
  assert.deepEqual(notes.map(item => item.getAttribute("data-source-text")), ["<按三曆會同雲：螣蛇為凶神>", "<贵>"]);
  assert.equal(tags(node, "script").length, 0); assert.equal(tags(node, "img").length, 0);
  assert.equal(render(text).textContent, text);
});

test("known manuscript glyph markers show a gap with exact source labels and stay book scoped", () => {
  for (const [bookId, text, source, label] of [["sanming-tonghui", "甲&KR1134;乙", "&KR1134;", "&KR1134;"],
    ["wuxing-jingji", "甲\uf0b7乙", "\uf0b7", "U+F0B7"], ["yilin-buyi", "甲????乙", "????", "????"]]) {
    const context = createReadingMarkdownContext([text], { bookId });
    const node = render(text, context);
    assert.equal(node.textContent, "甲□乙");
    const marker = all(node).find(item => item.className === "book-reading-missing-glyph");
    assert.equal(marker.getAttribute("data-source-text"), source);
    assert.ok(marker.getAttribute("title").includes(label)); assert.ok(marker.getAttribute("aria-label").includes(label));
    assert.equal(render(text).textContent, text);
    assert.equal(readingMarkdownTokens(text).map(token => token.text).join(""), text);
    const literal = render(`~~~~text\n${text}\n~~~~`, context);
    assert.equal(tags(literal, "code")[0].textContent, "甲□乙\n");
  }
  const ordinary = "为何？为什么??真的???";
  assert.equal(render(ordinary).textContent, ordinary);
  const old = renderEditionText("archive-v1", "甲&KR1134;乙", { bookId: "sanming-tonghui" }, environment());
  assert.equal(old.textContent, "甲&KR1134;乙");
});

test("Chanwei isolated stem paragraphs compact by source token without inventing chart columns", () => {
  const source = "乾造\n\n甲子\n\n乙丑\n\n丙子丙申\n\n丁卯\n\n此例仍須參看前後解說，不改變正文。\n\n戊辰\n\n己巳";
  const tokens = readingMarkdownTokens(source);
  const context = createReadingMarkdownContext([source], { bookId: "ditian-sui-chanwei" });
  const node = render(source, context);
  const rows = all(node).filter(item => item.className === "book-reading-stem-row");
  assert.equal(rows.length, 1);
  const stems = all(node).filter(item => item.className === "book-reading-stem-token");
  assert.deepEqual(stems.map(item => item.textContent), ["甲子\n", "乙丑\n", "丙子丙申\n", "丁卯\n"]);
  assert.deepEqual(tags(node, "p").map(item => item.textContent), ["乾造\n", "此例仍須參看前後解說，不改變正文。\n", "戊辰\n", "己巳"]);
  assert.equal(node.textContent, tokens.map(token => token.text).join(""));
  assert.equal(all(render(source)).filter(item => item.className === "book-reading-stem-row").length, 0);
  assert.deepEqual(readingMarkdownTokens(source), tokens);
});

test("Yiyin and Zengshan completed source lines create prose paragraphs without changing words or line order", () => {
  const source = "此句先說明取用的條件。\n下行承接新的論述。\n「作者又說如此！」\n最後一段含\n未完之意。";
  const expected = ["此句先說明取用的條件。\n", "下行承接新的論述。\n", "「作者又說如此！」\n", "最後一段含\n未完之意。"];
  for (const bookId of ["yiyin", "zengshan-buyi"]) {
    const context = createReadingMarkdownContext([source], { bookId });
    const node = render(source, context);
    assert.deepEqual(tags(node, "p").map(item => item.textContent), expected);
    assert.equal(node.textContent, source);
    assert.equal(all(node).filter(item => item.className === "book-reading-soft-break").length, 1);
    const literal = render(`~~~~text\n${source}\n~~~~`, context);
    assert.equal(tags(literal, "code")[0].textContent, `${source}\n`);
    assert.equal(tags(literal, "p").length, 0);
  }
  assert.deepEqual(tags(render(source), "p").map(item => item.textContent), [source]);
  assert.deepEqual(readingMarkdownTokens(source), [{ type: "paragraph", text: source }]);
  const internal = render("### 胞胎逢印綬\n\n經云胞胎逢印綬禄享千鍾如庚寅辛卯丙申乙酉等日時。", createReadingMarkdownContext([], { bookId: "sanming-tonghui" }));
  assert.equal(tags(internal, "h3")[0].textContent, "胞胎逢印綬");
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
  assert.equal(link.textContent, "1");
  assert.equal(link.getAttribute("aria-label"), "查看注1");
  assert.equal(link.getAttribute("title"), "原稿脚注：a");
  assert.equal(link.getAttribute("href"), "#reading-footnote-1");
  const missing = all(nodes[0]).find(node => node.className === "book-footnote-unresolved");
  assert.equal(missing.textContent, "[^missing]");
  assert.ok(missing.getAttribute("title").includes("此版本未提供"));
  const target = doc.getElementById("reading-footnote-1");
  assert.equal(target.textContent, "1. Supplied note\ncontinuation");
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
  assert.equal(target.textContent, "1. supplied definition"); assert.equal(target.focused, true);
  assert.equal(target.getAttribute("title"), "原稿脚注：四補1");
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

test("footnote display numbers stay stable when navigating to another chapter", () => {
  const chapters = [{ id: "first", blocks: [{ text: "[^first]: first note\n\nRead cross-chapter[^third]" }] },
    { id: "second", blocks: [{ text: "[^second]: second note" }] },
    { id: "last", blocks: [{ text: "[^third]: third note" }] }];
  const options = { chapters, navigate() {}, footnotePath: chapter => `/books/example?chapter=${chapter}` };
  const origin = createReadingMarkdownContext(chapters[0].blocks.map(block => block.text), { ...options, chapterId: "first" });
  const destination = createReadingMarkdownContext(chapters[2].blocks.map(block => block.text), { ...options, chapterId: "last" });
  assert.equal(origin.definitions.get("third").number, 3);
  assert.equal(destination.definitions.get("third").number, 3);
  assert.equal(origin.definitions.get("third").id, destination.definitions.get("third").id);
  const link = tags(render(chapters[0].blocks[0].text, origin), "a")[0];
  assert.equal(link.textContent, "3"); assert.equal(link.getAttribute("aria-label"), "查看注3");
  const note = tags(render(chapters[2].blocks[0].text, destination), "p")[0];
  assert.equal(note.textContent, "3. third note"); assert.equal(note.getAttribute("id"), "reading-footnote-3");
});

test("library titles keep version catalogs and reader cards use the shared progress selector", () => {
  const source = readFileSync(new URL("../web/public/next/views/books.js", import.meta.url), "utf8");
  const library = source.slice(source.indexOf("function library(ctx)"), source.indexOf("function reader(ctx)"));
  assert.ok(library.includes("const catalogPath = textVersionPath(book.id)"));
  assert.match(library, /h\("h2", null, h\("a", \{ href: `#\$\{catalogPath\}` \}/);
  assert.ok(library.includes('const entry = book => bookReadingEntry(book, { reading: local.json(bookReadingKeys(book).position), text: local.json(textRecentKey(book.id)) })'));
  assert.ok(library.includes('const openPath = target.path'));
  assert.match(library, /class: "btn btn-soft books-electronic-open", href: `#\$\{openPath\}`/);
  assert.ok(library.includes('target.continuing ? "继续" : "阅读"'));
  assert.ok(!library.includes("历史阅读稿"));
  assert.ok(source.includes('"原文与白话阅读"'));
  assert.ok(source.includes('whitePosition ? whitePosition.number : bookDefaultSectionNumber(publishedBook)'));
  assert.ok(source.includes('"Markdown 原文阅读版"'));
  assert.match(source, /hasWhite \? h\("section", \{ class: "books-card book-version-card book-version-primary"/);
  assert.ok(source.includes("原文阅读稿"));
});

test("the real library, reader and version catalog isolate a new layout from an old page 29 and resume only its own saved progress", async () => {
  const storage = new Map();
  globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) };
  globalThis.Node = MockNode; globalThis.Element = MockNode;
  globalThis.location = { hash: "#/books", search: "", origin: "https://example.test" };
  globalThis.cancelAnimationFrame = () => {};
  globalThis.requestAnimationFrame = callback => { callback(); return 1; };
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => "64" });
  const { render: renderBooks } = await import("../web/public/next/views/books.js");
  const { bookReadingKeys } = await import("../web/public/next/lib/books.js");
  const book = { id: "layout-progress-test", title: "目录进度测试书", system: "liuyao", source_label: "测试底本", status: "reading_edition",
    has_modern: true, section_count: 85, default_section_number: 4, reading_layout_id: "db1d3509b7ead1e8", case_count: 0 };
  const olderBook = { ...book, id: "legacy-progress-test", reading_layout_id: undefined, section_count: 33, default_section_number: 1 };
  const oldKeys = bookReadingKeys({ id: book.id }); const keys = bookReadingKeys(book);
  const oldPosition = JSON.stringify({ number: 29, anchor: 4, offset: .3, updatedAt: 500 });
  storage.set(oldKeys.progress, "29"); storage.set(oldKeys.position, oldPosition);
  storage.set(bookReadingKeys(olderBook).progress, "29");
  storage.set(bookReadingKeys(olderBook).position, oldPosition);
  const paths = []; const previousFetch = globalThis.fetch;
  globalThis.fetch = async path => {
    paths.push(path);
    const selected = path.includes(olderBook.id) ? olderBook : book;
    const contents = Array.from({ length: selected.section_count }, (_, index) => ({ number: index + 1, title: `篇${index + 1}`, location: "测试来源", partial: false }));
    const match = path.match(/\/sections\/(\d+)$/);
    const data = path === "/api/books" ? { books: [book, olderBook] }
      : path.endsWith("/text-versions") ? { title: selected.title, versions: [], gap_note: "测试收录说明" }
      : match ? { book_id: selected.id, number: Number(match[1]), title: `篇${match[1]}`, location: "测试来源", partial: false,
        notice: "", page_notes: [], figures: [], blocks: [{ id: `test-block-${match[1]}`, role: "text", text: "测试原文。", modern: "测试白话。", notes: [] }] }
      : { book: selected, contents };
    return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  function mount(id = "", query = "") {
    globalThis.document = { ...environment(), documentElement: new MockNode("html"), addEventListener() {}, removeEventListener() {} };
    globalThis.window = { scrollY: 0, addEventListener() {}, removeEventListener() {}, getSelection: () => null, scrollTo() {},
      matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) };
    const cleanups = []; let current = true;
    const ctx = { params: { id }, query: new URLSearchParams(query), cleanup: fn => cleanups.push(fn), onRefresh() {},
      isCurrent: () => current, setTitle() {}, navigate() {} };
    const view = renderBooks(ctx); document.body.append(view.node);
    for (const node of all(view.node)) node.offsetHeight = 0;
    return { node: view.node, cleanup() { cleanups.forEach(fn => fn()); current = false; } };
  }
  const ready = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
  const whiteLink = node => tags(node, "a").find(link => /^(阅读|继续)原文白话$/.test(link.textContent));
  try {
    let view = mount(); await ready();
    assert.equal(tags(view.node, "a").find(link => link.getAttribute("aria-label") === `阅读${book.title}`).getAttribute("href"), `#/books/${book.id}?page=4`);
    view.cleanup();
    view = mount(book.id, "text-version=catalog"); await ready();
    assert.equal(whiteLink(view.node).textContent, "阅读原文白话");
    assert.equal(whiteLink(view.node).getAttribute("href"), `#/books/${book.id}?page=4`);
    view.cleanup();
    view = mount(book.id); await ready();
    assert.ok(paths.includes(`/api/books/${book.id}/sections/4`));
    assert.ok(!paths.includes(`/api/books/${book.id}/sections/29`));
    assert.equal(storage.get(keys.progress), "4");
    assert.equal(JSON.parse(storage.get(keys.position)).number, 4);
    view.cleanup();
    view = mount(book.id, "page=29"); await ready();
    assert.ok(paths.includes(`/api/books/${book.id}/sections/29`), "an explicit case page remains reachable");
    view.cleanup();
    view = mount(book.id, "page=82"); await ready(); view.cleanup();
    assert.equal(storage.get(keys.progress), "82");
    assert.equal(JSON.parse(storage.get(keys.position)).number, 82);
    const start = paths.length;
    view = mount(book.id); await ready();
    assert.ok(paths.slice(start).includes(`/api/books/${book.id}/sections/82`));
    view.cleanup();
    view = mount(book.id, "text-version=catalog"); await ready();
    assert.equal(whiteLink(view.node).textContent, "继续原文白话");
    assert.equal(whiteLink(view.node).getAttribute("href"), `#/books/${book.id}?page=82`);
    view.cleanup();
    view = mount(olderBook.id); await ready();
    assert.ok(paths.includes(`/api/books/${olderBook.id}/sections/29`));
    view.cleanup();
    const text = { versionId: "frozen-md-one", sectionId: "body-one", title: "冻结MD原文", updatedAt: Date.now() + 10000 };
    storage.set(`xz-book-text-recent:${book.id}`, JSON.stringify(text));
    view = mount(); await ready();
    assert.equal(tags(view.node, "a").find(link => link.getAttribute("aria-label") === `继续阅读${book.title}`).getAttribute("href"), `#/books/${book.id}?text-version=frozen-md-one&chapter=body-one&resume=1`);
    view.cleanup();
    assert.equal(storage.get(oldKeys.progress), "29");
    assert.equal(storage.get(oldKeys.position), oldPosition);
  } finally { globalThis.fetch = previousFetch; }
});

test("the real reader interleaves covered figures without losing text, glossary, notes or existing numeric positions", async () => {
  const storage = new Map();
  globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) };
  globalThis.Node = MockNode; globalThis.Element = MockNode;
  globalThis.location = { hash: "#/books", search: "", origin: "https://example.test" };
  globalThis.document = { ...environment(), addEventListener() {}, removeEventListener() {} };
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  globalThis.cancelAnimationFrame = () => {};
  globalThis.requestAnimationFrame = callback => { callback(); return 1; };
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => "64" });
  const { render: renderBooks } = await import("../web/public/next/views/books.js");
  const { bookReadingKeys } = await import("../web/public/next/lib/books.js");
  const blocks = [
    { id: "figure-heading", role: "heading", text: "圖表試讀", modern: "", notes: ["题名原样。"], terms: [] },
    { id: "figure-prose", role: "text", text: "用神原字𠮷。\n□保留。", modern: "", notes: ["正文原校记。"],
      terms: [{ layer: "original", start: 0, end: 2, sense_id: "supplied-sense" }] },
    { id: "figure-table", role: "table", text: "甲 𠮷 □ ▅▅\n乙 丙", modern: "", notes: ["表格原校记。"], terms: [] },
    { id: "figure-diagram", role: "text", presentation: "diagram", source_text: false, text: "上 ▅▅\n下 ▅ ▅", modern: "", notes: [], terms: [] },
    { id: "uncovered-table", role: "table", text: "未配圖之表\n子 丑", modern: "", notes: [], terms: [] },
    { id: "uncovered-diagram", role: "diagram_caption", text: "未配圖之標注 □", modern: "", notes: [], terms: [] },
  ];
  const image = (id, mapping = {}) => ({ id, url: `/figures/${id}.png`, caption: id, width: 800, height: 1000, ...mapping });
  const fixtures = new Map(); let sequence = 0;
  const previousFetch = globalThis.fetch;
  const previousRect = MockNode.prototype.getBoundingClientRect;
  // Physical positions follow DOM order; their saved identities deliberately do
  // not. This exposes both restoring by NodeList index and saving that index.
  MockNode.prototype.getBoundingClientRect = function () {
    for (let parent = this.parentElement; parent; parent = parent.parentElement) {
      // Native details can retain stale, nonzero descendant geometry after a
      // diagram was opened and then closed. Other disclosure mocks stay as-is.
      if (parent.tagName === "DETAILS" && !parent.open && parent.getAttribute("open") === null && !parent.classList.contains("book-diagram-group"))
        return { top: 0, bottom: 0, height: 0, left: 0, width: 0 };
    }
    if (this.parentElement?.classList.contains("book-diagram-group")) {
      const groupRect = this.parentElement.getBoundingClientRect();
      const top = groupRect.top + this.parentElement.children.indexOf(this) * 100;
      return { top, bottom: top + 100, height: 100, left: 0, width: 400 };
    }
    if (this.parentElement?.classList.contains("book-reading-content")) {
      const top = 200 + this.parentElement.children.indexOf(this) * 100 - window.scrollY;
      return { top, bottom: top + 100, height: 100, left: 0, width: 400 };
    }
    return previousRect.call(this);
  };
  globalThis.fetch = async path => {
    const id = path.split("/")[3]; const fixture = fixtures.get(id);
    const data = path.endsWith("/sections/1") ? fixture.section : { book: fixture.book,
      contents: [{ number: 1, title: fixture.section.title, location: fixture.section.location, partial: false }] };
    return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  async function mount(figures, savedAnchor, { sectionBlocks = blocks, hasModern = false, title = blocks[0].text,
    glossary = [{ id: "supplied-sense", term: "用神", definition: "服务端已提供释义。" }] } = {}) {
    const id = `figure-layout-test-${++sequence}`;
    const book = { id, title: "图表位置测试书", system: "liuyao", source_label: "测试底本", status: "reading_edition",
      has_modern: hasModern, section_count: 1, default_section_number: 1, case_count: 0 };
    const section = { book_id: id, number: 1, title, location: "测试来源", partial: false, notice: "",
      page_notes: ["页注不计入旧数字锚。"], figures, blocks: sectionBlocks, glossary };
    const before = structuredClone(section); fixtures.set(id, { book, section });
    const keys = bookReadingKeys(book);
    if (savedAnchor !== undefined) storage.set(keys.position, JSON.stringify({ number: 1, anchor: savedAnchor, offset: .25, updatedAt: 500 }));
    const listeners = new Map(); const scrolls = [];
    globalThis.document = { ...environment(), documentElement: new MockNode("html"), addEventListener() {}, removeEventListener() {} };
    globalThis.window = { scrollY: 0,
      addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
      removeEventListener(name, fn) { listeners.get(name)?.delete(fn); }, getSelection: () => null,
      scrollTo(x, y) { scrolls.push([x, y]); this.scrollY = y; },
      matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) };
    const cleanups = []; let current = true;
    const ctx = { params: { id }, query: new URLSearchParams(), cleanup: fn => cleanups.push(fn), onRefresh() {},
      isCurrent: () => current, setTitle() {}, navigate() {} };
    const view = renderBooks(ctx); document.body.append(view.node);
    for (const node of all(view.node)) node.offsetHeight = 0;
    for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
    const content = view.node.querySelector(".book-reading-content");
    assert.deepEqual(section, before);
    return { node: view.node, content, keys, scrolls, pagehide() { listeners.get("pagehide")?.forEach(fn => fn()); },
      cleanup() { cleanups.forEach(fn => fn()); current = false; } };
  }
  const caption = figure => figure.querySelector("figcaption, .book-figure-caption");
  const figureOrder = content => tags(content, "figure").map(node => caption(node).textContent);
  const folded = (content, id) => Boolean(content.querySelector(`[data-block-id="${id}"]`).querySelector(".book-diagram-transcription"));
  const insideClosedDetails = node => {
    for (let parent = node.parentElement; parent; parent = parent.parentElement)
      if (parent.tagName === "DETAILS" && !parent.open && parent.getAttribute("open") === null) return true;
    return false;
  };
  try {
    let view = await mount([image("multi", { block_indices: [2, 3] }), image("same-block", { block_indices: [2] }),
      image("invalid", { block_indices: [0, 99] }), image("later", { block_indices: [3] })], 6);
    assert.deepEqual(all(view.content).filter(node => node.tagName === "FIGURE" || node.dataset.blockId).map(node =>
      node.dataset.blockId || caption(node).textContent), ["invalid", "figure-heading", "figure-prose", "multi", "same-block",
      "figure-table", "later", "figure-diagram", "uncovered-table", "uncovered-diagram"]);
    assert.deepEqual(figureOrder(view.content), ["invalid", "multi", "same-block", "later"]);
    assert.deepEqual(view.content.querySelectorAll("[data-reading-anchor]").map(node => Number(node.dataset.readingAnchor)), [0, 3, 5, 6, 1, 2, 7, 4, 8, 9, 10]);
    assert.deepEqual(view.scrolls, [[0, 541]], "old anchor 6 still restores the original prose block, not the sixth DOM node");
    assert.equal(JSON.parse(storage.get(view.keys.position)).anchor, 6, "capture stores the block's old identity after moving figures");
    assert.equal(JSON.parse(storage.get(view.keys.position)).offset, .25);
    const target = view.content.querySelector('[data-block-id="uncovered-table"]');
    window.scrollY += target.getBoundingClientRect().top - 84;
    view.pagehide();
    assert.equal(JSON.parse(storage.get(view.keys.position)).anchor, 9);
    assert.equal(JSON.parse(storage.get(view.keys.position)).offset, 0);
    for (const [index, block] of blocks.entries()) {
      const rendered = view.content.querySelector(`[data-block-id="${block.id}"]`);
      assert.equal(Number(rendered.dataset.readingAnchor), index + 5);
      assert.equal(rendered.querySelector(".book-original").querySelector("p, h2, h3, pre").textContent, block.text);
      for (const note of block.notes) assert.ok(rendered.querySelector(".book-notes").textContent.includes(note));
    }
    assert.equal(view.content.querySelector(".book-term").textContent, "用神");
    assert.equal(view.content.querySelector(".book-term").dataset.senseId, "supplied-sense");
    assert.equal(folded(view.content, "figure-table"), false);
    assert.equal(folded(view.content, "figure-diagram"), false);
    assert.equal(insideClosedDetails(view.content.querySelector('[data-block-id="figure-table"]').querySelector("pre")), false);
    assert.equal(insideClosedDetails(view.content.querySelector(".book-transcription-notice")), true);
    const figureNodes = tags(view.content, "figure");
    assert.equal(figureNodes[0].querySelector(".book-figure-source"), null, "invalid mappings keep their previous figure behavior");
    for (const figure of figureNodes.slice(1, 3)) {
      const source = figure.querySelector(".book-figure-source");
      assert.equal(source.tagName, "DETAILS");
      assert.equal(source.children[0].tagName, "SUMMARY");
      assert.equal(source.children[0].textContent, "查看书影");
      assert.equal(source.getAttribute("open"), null);
      assert.equal(insideClosedDetails(figure.querySelector("img")), true);
      assert.equal(insideClosedDetails(caption(figure)), true);
      assert.equal(figure.querySelector(".book-figure-open").listeners.get("click"), figure.querySelector(".book-figure-link").listeners.get("click"),
        "both image controls retain the existing magnifier handler");
      const anchor = figure.dataset.readingAnchor;
      source.open = true;
      source.listeners.get("toggle")();
      assert.equal(insideClosedDetails(figure.querySelector("img")), false);
      source.open = false;
      source.listeners.get("toggle")();
      assert.equal(figure.dataset.readingAnchor, anchor, "native disclosure does not replace the figure or its saved identity");
    }
    assert.equal(figureNodes[3].querySelector(".book-figure-source"), null);
    assert.equal(figureNodes[3].classList.contains("book-figure-diagram"), true);
    assert.equal(insideClosedDetails(figureNodes[3].querySelector("img")), false);
    assert.equal(folded(view.content, "uncovered-table"), false);
    assert.equal(folded(view.content, "uncovered-diagram"), false);
    assert.equal(view.content.querySelector(".book-page-notes").dataset.readingAnchor, undefined);
    const failedImage = tags(view.content, "img")[0];
    failedImage.listeners.get("error")({ target: failedImage });
    assert.equal(failedImage.hidden, true);
    assert.equal(failedImage.parentElement.parentElement.querySelector(".books-notice").hidden, false);
    view.cleanup();

    view = await mount([image("omitted"), image("null", { block_indices: null })], 4);
    assert.deepEqual(figureOrder(view.content), ["omitted", "null"]);
    assert.equal(view.content.children.indexOf(tags(view.content, "figure")[1]) < view.content.children.indexOf(view.content.querySelector(".book-block")), true);
    assert.deepEqual(view.content.querySelectorAll("[data-reading-anchor]").map(node => Number(node.dataset.readingAnchor)), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(JSON.parse(storage.get(view.keys.position)).anchor, 4);
    assert.equal(view.content.querySelector(".book-figure-source"), null, "legacy images remain expanded");
    for (const id of ["figure-table", "figure-diagram", "uncovered-table", "uncovered-diagram"]) assert.equal(folded(view.content, id), true);
    view.cleanup();

    view = await mount([image("mapped-mixed", { block_indices: [2] }), image("legacy-mixed", { block_indices: null })]);
    assert.deepEqual(figureOrder(view.content), ["legacy-mixed", "mapped-mixed"]);
    assert.equal(folded(view.content, "figure-table"), false);
    assert.equal(tags(view.content, "figure")[0].querySelector(".book-figure-source"), null);
    assert.ok(tags(view.content, "figure")[1].querySelector(".book-figure-source"));
    for (const id of ["figure-diagram", "uncovered-table", "uncovered-diagram"])
      assert.equal(folded(view.content, id), false, "a legacy image must not widen explicit coverage in a mixed response");
    view.cleanup();

    view = await mount([image("invalid-mixed", { block_indices: [2, 99] }), image("legacy-with-invalid")]);
    assert.deepEqual(figureOrder(view.content), ["invalid-mixed", "legacy-with-invalid"]);
    for (const id of ["figure-table", "figure-diagram", "uncovered-table", "uncovered-diagram"])
      assert.equal(folded(view.content, id), false, "an invalid explicit mapping still selects exact coverage without covering any block");
    view.cleanup();

    view = await mount([image("invalid-only", { block_indices: [2, 99] })]);
    assert.deepEqual(figureOrder(view.content), ["invalid-only"]);
    for (const id of ["figure-table", "figure-diagram", "uncovered-table", "uncovered-diagram"]) assert.equal(folded(view.content, id), false);
    view.cleanup();

    view = await mount([]);
    assert.equal(folded(view.content, "figure-table"), false);
    assert.equal(folded(view.content, "figure-diagram"), true);
    view.cleanup();

    // The reported page contains only these five electronic table rows. A tall
    // mapped scan and its long caption must not hide the whole chapter's text.
    const rows = ["甲乙東方木", "丙丁南方火", "戊己中央土", "庚辛西方金", "壬癸北方水"].map((text, index) => ({
      id: `bszz-proposal-v01-p0018-b002--paragraph-map-${String(index + 2).padStart(4, "0")}`,
      role: "table", presentation: "table", text, modern: text, notes: [], terms: [],
    }));
    view = await mount([image("full-spread", { height: 2400, block_indices: [0, 1, 2, 3, 4], caption: "整张扫描书影供核对。".repeat(30) })], undefined,
      { sectionBlocks: rows, hasModern: true, title: "十天干所屬" });
    const scan = view.content.querySelector("figure");
    const source = scan.querySelector("details");
    const imageNode = scan.querySelector("img");
    for (const mode of ["original", "parallel", "modern"]) {
      view.node.querySelector(`[data-book-mode="${mode}"]`).listeners.get("click")();
      assert.equal(view.content.dataset.mode, mode);
      assert.equal(insideClosedDetails(imageNode), true);
      assert.equal(insideClosedDetails(caption(scan)), true);
      for (const block of rows) {
        const rendered = view.content.querySelector(`[data-block-id="${block.id}"]`);
        assert.equal(folded(view.content, block.id), false);
        assert.equal(rendered.querySelector(`.book-${mode === "modern" ? "modern" : "original"}`).querySelector("pre").textContent, block.text);
      }
    }
    source.open = true;
    source.listeners.get("toggle")();
    assert.equal(insideClosedDetails(imageNode), false);
    imageNode.listeners.get("error")({ target: imageNode });
    assert.equal(scan.querySelector(".books-notice").hidden, false);
    for (const row of rows) assert.equal(folded(view.content, row.id), false, "image failure cannot fold or remove the electronic rows");
    view.cleanup();

    // Page 7's diagram has 32 short labels. They must not become 32 large
    // cards with repeated warnings ahead of the actual diagram.
    const labels = ["中", "央", "戊", "己", "南", "午火離", "丙", "丁", "坤", "未", "申", "西", "酉金兌", "庚", "辛", "乾", "戌", "亥",
      "北", "子水坎", "壬", "癸", "艮", "丑", "寅", "東", "卯木震", "甲", "乙", "巽", "辰", "巳"].map((text, index) => ({
      id: `bszz-proposal-v01-p0018-b021--paragraph-map-${String(index + 2).padStart(4, "0")}`,
      role: "diagram_caption", presentation: "diagram", source_text: false, text, modern: "", notes: index === 0 ? ["图中文字原样保留。"] : [],
      terms: index === 19 ? [{ layer: "original", start: 0, end: 3, sense_id: "diagram-test-sense" }] : [],
    }));
    const diagramOptions = { sectionBlocks: labels, hasModern: true, title: "天干地支八卦方位圖",
      glossary: [{ id: "diagram-test-sense", term: "子水坎", definition: "测试数据中的图内标注。" }] };
    const diagramFigure = image("direction-diagram", { block_indices: labels.map((_, index) => index) });
    view = await mount([diagramFigure], undefined, diagramOptions);
    const diagramScan = view.content.querySelector("figure");
    const group = view.content.querySelector(".book-diagram-group");
    assert.equal(diagramScan.classList.contains("book-figure-diagram"), true);
    assert.equal(diagramScan.querySelector(".book-figure-source"), null);
    assert.equal(insideClosedDetails(diagramScan.querySelector("img")), false);
    assert.equal(diagramScan.querySelector(".book-figure-open").listeners.get("click"), diagramScan.querySelector(".book-figure-link").listeners.get("click"));
    assert.equal(group.children[0].textContent, "图式标注与转写");
    assert.equal(group.open, false);
    assert.equal(group.querySelectorAll(".book-block").length, 32);
    assert.equal(view.content.querySelectorAll(".book-diagram-group").length, 1);
    assert.equal(view.content.querySelectorAll(".book-transcription-notice").length, 1);
    assert.equal(group.querySelector(".book-layer"), null, "single glyphs do not repeat generated layer labels");
    assert.equal(group.querySelector(".book-modern-empty"), null, "single glyphs do not repeat missing-modern notices");
    for (const [index, block] of labels.entries()) {
      const rendered = group.querySelector(`[data-block-id="${block.id}"]`);
      assert.equal(rendered.querySelector("pre").textContent, block.text);
      assert.equal(Number(rendered.dataset.readingAnchor), index + 2);
      assert.equal(insideClosedDetails(rendered), true);
      assert.equal(all(view.content).filter(node => node.dataset.blockId === block.id).length, 1);
      for (const note of block.notes) assert.ok(rendered.querySelector(".book-notes").textContent.includes(note));
    }
    assert.equal(group.querySelector(".book-term").textContent, "子水坎");
    assert.equal(group.querySelector(".book-term").dataset.senseId, "diagram-test-sense");
    for (const mode of ["original", "parallel", "modern"]) {
      view.node.querySelector(`[data-book-mode="${mode}"]`).listeners.get("click")();
      assert.equal(view.content.dataset.mode, mode);
      assert.equal(group.open, false);
      assert.equal(insideClosedDetails(diagramScan.querySelector("img")), false);
    }
    window.scrollY = 10000; view.pagehide();
    assert.equal(JSON.parse(storage.get(view.keys.position)).anchor, 1, "hidden transcription anchors cannot replace the visible diagram position");
    group.open = true; group.listeners.get("toggle")();
    assert.equal(insideClosedDetails(group.querySelector(".book-block")), false);
    group.open = false; group.listeners.get("toggle")();
    assert.equal(group.querySelectorAll(".book-block").length, 32, "toggling retains every original block node");
    view.cleanup();

    view = await mount([diagramFigure], 21, diagramOptions);
    const restoredGroup = view.content.querySelector(".book-diagram-group");
    assert.equal(restoredGroup.open, true, "saved position inside a closed group opens its group before measuring");
    assert.deepEqual(view.scrolls, [[0, 2541]]);
    assert.equal(JSON.parse(storage.get(view.keys.position)).anchor, 21);
    assert.equal(JSON.parse(storage.get(view.keys.position)).offset, .25);
    assert.equal(all(restoredGroup).find(node => Number(node.dataset.readingAnchor) === 21).querySelector("pre").textContent, "子水坎");
    view.cleanup();

    const ending = { id: "after-closed-diagram", role: "text", text: "图式之后的完整正文。", modern: "图式之后的完整正文。", notes: [], terms: [] };
    const withEnding = { ...diagramOptions, sectionBlocks: [...labels, ending] };
    view = await mount([diagramFigure], undefined, withEnding);
    const closedGroup = view.content.querySelector(".book-diagram-group");
    closedGroup.open = true; closedGroup.listeners.get("toggle")();
    closedGroup.querySelectorAll(".book-block")[12].getBoundingClientRect();
    closedGroup.open = false; closedGroup.listeners.get("toggle")();
    assert.equal(closedGroup.querySelectorAll(".book-block").every(block => block.getBoundingClientRect().height > 0), true,
      "reproduce the browser's stale geometry for all 32 closed diagram anchors");
    const endingNode = view.content.querySelector(`[data-block-id="${ending.id}"]`);
    window.scrollY += endingNode.getBoundingClientRect().top - 84;
    view.pagehide();
    assert.equal(JSON.parse(storage.get(view.keys.position)).anchor, 34, "pagehide saves visible text beyond a closed group");
    for (const mode of ["original", "parallel", "modern"]) {
      view.node.querySelector(`[data-book-mode="${mode}"]`).listeners.get("click")();
      view.pagehide();
      assert.equal(closedGroup.open, false, `${mode} must not restore a stale closed-group anchor`);
      assert.equal(JSON.parse(storage.get(view.keys.position)).anchor, 34);
      assert.equal(endingNode.getBoundingClientRect().top, 84);
    }
    const directory = view.node.querySelector(".book-directory");
    for (let index = 0; index < 2; index++) {
      directory.listeners.get("click")({ currentTarget: directory });
      view.pagehide();
      assert.equal(closedGroup.open, false, "directory changes keep the closed group closed");
      assert.equal(JSON.parse(storage.get(view.keys.position)).anchor, 34);
      assert.equal(endingNode.getBoundingClientRect().top, 84);
    }
    view.cleanup();
    view = await mount([diagramFigure], 34, withEnding);
    assert.equal(view.content.querySelector(".book-diagram-group").open, false, "reloading beyond the diagram does not reopen it");
    assert.equal(JSON.parse(storage.get(view.keys.position)).anchor, 34);
    view.cleanup();

    // A gap or later figure stays in its own DOM position, outside a closed
    // group. Caption roles without API diagram flags do not change behavior.
    view = await mount([image("separated", { block_indices: [0, 2] }), image("next-diagram", { block_indices: [3] }),
      image("role-only", { block_indices: [5] })]);
    assert.deepEqual(view.content.querySelectorAll(".book-diagram-group").map(item => item.querySelectorAll(".book-block").map(block => block.dataset.blockId)),
      [["figure-diagram"]]);
    assert.ok(tags(view.content, "figure")[2].querySelector(".book-figure-source"), "role alone cannot promote an explicit mapping to a primary diagram");
    view.cleanup();

    view = await mount([image("disjoint-diagram", { block_indices: [0, 2, 3] }), image("later-diagram", { block_indices: [3] })], undefined,
      { ...diagramOptions, sectionBlocks: labels.slice(0, 4) });
    assert.deepEqual(view.content.querySelectorAll(".book-diagram-group").map(item => item.querySelectorAll(".book-block").map(block => block.dataset.blockId)),
      [[labels[0].id], [labels[2].id], [labels[3].id]]);
    for (const figure of tags(view.content, "figure")) assert.equal(insideClosedDetails(figure.querySelector("img")), false);
    assert.equal(insideClosedDetails(view.content.querySelector(`[data-block-id="${labels[1].id}"]`)), false, "a non-covered label is not swept into the neighboring range");
    view.cleanup();
  } finally { globalThis.fetch = previousFetch; MockNode.prototype.getBoundingClientRect = previousRect; }
});
