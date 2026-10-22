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

test("library titles open catalogs and primary entries open current or saved electronic reading", () => {
  const source = readFileSync(new URL("../web/public/next/views/books.js", import.meta.url), "utf8");
  const library = source.slice(source.indexOf("function library(ctx)"), source.indexOf("function reader(ctx)"));
  assert.ok(library.includes("const catalogPath = textVersionPath(book.id)"));
  assert.match(library, /h\("h2", null, h\("a", \{ href: `#\$\{catalogPath\}` \}/);
  assert.ok(library.includes('const openPath = saved ? textVersionPath(book.id, saved.versionId, saved.sectionId, { resume: true }) : textVersionPath(book.id, "current")'));
  assert.match(library, /class: "btn btn-soft books-electronic-open", href: `#\$\{openPath\}`/);
  assert.ok(library.includes('saved ? "继续" : "阅读"'));
  assert.ok(library.includes("继续历史阅读稿"));
  assert.ok(source.includes("publishedBook.source_label} · 原文白话对照"));
  assert.match(source, /hasHistorical && publishedBook\.has_modern \? h\("a", \{ href: `#\$\{links\.reading\(id\)\}`/);
  assert.ok(source.includes("原文阅读稿"));
});
