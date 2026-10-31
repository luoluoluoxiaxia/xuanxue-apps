import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { indexBookGlossary, bookTermRanges, bookTextRuns } from "../web/public/next/lib/book-glossary.js";
import { sourceBreaks, bookBlockParts } from "../web/public/next/lib/books.js";
import { selectionAnchor, annotationRange } from "../web/public/next/lib/book-annotations.js";
import { renderBookText, setupBookGlossary } from "../web/public/next/ui/book-glossary.js";

const entry = { id: "month-use", term: "用神", definition: "月令所定的格局核心", explanation: "详细说明", usage_note: "本段依据月令立格。" };
const senses = () => indexBookGlossary([entry]);
const occurrence = (start, end, layer = "original") => ({ start, end, layer, sense_id: entry.id });

test("book terms use server code-point ranges, including supplementary Han and source line breaks", () => {
  const text = "甲𠮷用\n神乙用神";
  const ranges = bookTermRanges(text, [occurrence(2, 5), occurrence(6, 8), occurrence(0, 1, "modern")], "original", senses());
  assert.deepEqual(ranges.map(({ start, end, unitStart, unitEnd }) => ({ start, end, unitStart, unitEnd })), [
    { start: 2, end: 5, unitStart: 3, unitEnd: 6 }, { start: 6, end: 8, unitStart: 7, unitEnd: 9 },
  ]);
  const parts = sourceBreaks({ text, role: "text" });
  const runs = bookTextRuns(parts, ranges);
  assert.equal(runs.flatMap(run => run.parts).map(part => part.text).join(""), text);
  assert.deepEqual(runs[1], { sense_id: entry.id, parts: [
    { text: "用", kind: null }, { text: "\n", kind: "soft" }, { text: "神", kind: null },
  ] });
  assert.equal(bookTermRanges("用神用神", [], "original", senses()).length, 0); // Never infer word matches.
});

test("malformed, unknown and overlapping display data falls back to unmarked source text", () => {
  const text = "甲乙丙丁戊己庚";
  const malformed = [occurrence(-1, 1), occurrence(0.5, 1), occurrence(0, "1"), occurrence(0, 9),
    occurrence(0, 0), occurrence(0, Infinity), { ...occurrence(0, 1), sense_id: "unknown" }];
  assert.deepEqual(bookTermRanges(text, malformed, "original", senses()), []);
  const ranges = bookTermRanges(text, [occurrence(0, 2), occurrence(1, 4), occurrence(3, 5), occurrence(5, 7)], "original", senses());
  assert.deepEqual(ranges.map(({ start, end }) => [start, end]), [[5, 7]]);
  assert.equal(bookTextRuns([{ text, kind: null }], ranges).flatMap(run => run.parts).map(part => part.text).join(""), text);
  assert.equal(indexBookGlossary([entry, { ...entry, definition: "另一义" }]).size, 0);
  assert.equal(indexBookGlossary([{ ...entry, definition: null }, entry]).size, 0);
  assert.equal(indexBookGlossary([null, { ...entry, term: "" }]).size, 0);
});

// A minimal native-node substitute exercises canonical text and event cleanup
// without a browser dependency. Real viewport/selection QA runs in the reader.
class MockNode {
  constructor(type, document) { this.nodeType = type; this.ownerDocument = document; this.parentElement = null; this.childNodes = []; }
  append(...children) {
    for (let child of children) {
      if (!(child instanceof MockNode)) child = this.ownerDocument.createTextNode(String(child));
      child.parentElement = this; this.childNodes.push(child);
    }
  }
  replaceChildren(...children) { for (const child of this.childNodes) child.parentElement = null; this.childNodes = []; this.append(...children); }
  contains(node) { return node === this || this.childNodes.some(child => child.contains(node)); }
  get textContent() { return this.nodeType === 3 ? this.data : this.childNodes.map(child => child.textContent).join(""); }
  set textContent(value) { if (this.nodeType === 3) this.data = String(value); else this.replaceChildren(String(value)); }
  get isConnected() { return this === this.ownerDocument.body || !!this.parentElement?.isConnected; }
  remove() { if (this.parentElement) { const parent = this.parentElement; parent.childNodes = parent.childNodes.filter(child => child !== this); this.parentElement = null; } }
}
class MockText extends MockNode {
  constructor(value, document) { super(3, document); this.data = value; }
  get length() { return this.data.length; }
}
class MockElement extends MockNode {
  constructor(tag, document) {
    super(1, document); this.tagName = tag.toUpperCase(); this.className = ""; this.dataset = {};
    this.attributes = new Map(); this.listeners = new Map(); this.style = {}; this.hidden = false;
    this.classList = {
      contains: name => this.className.split(" ").includes(name),
      add: name => { this.className = [...new Set([...this.className.split(" "), name])].filter(Boolean).join(" "); },
      remove: name => { this.className = this.className.split(" ").filter(value => value !== name).join(" "); },
    };
  }
  set innerHTML(_) { throw new Error("Text content must never be parsed as HTML"); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); if (name === "hidden") this.hidden = true; }
  removeAttribute(name) { this.attributes.delete(name); }
  getAttribute(name) { return this.attributes.get(name) ?? (name.startsWith("data-")
    ? this.dataset[name.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] ?? null : null); }
  matches(selector) {
    return selector.split(",").some(item => {
      item = item.trim();
      const parts = item.split(/\s+/);
      if (parts.length > 1) return this.matches(parts.at(-1)) && !!this.parentElement?.closest(parts.slice(0, -1).join(" "));
      const [head] = item.split("[");
      const matched = head.startsWith(".") ? this.className.split(" ").includes(head.slice(1)) : this.tagName.toLowerCase() === head;
      if (!matched) return false;
      return !item.includes("[data-sense-id]") || !!this.dataset.senseId;
    });
  }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
  querySelector(selector) {
    for (const child of this.childNodes) { if (child.nodeType !== 1) continue; if (child.matches(selector)) return child; const found = child.querySelector(selector); if (found) return found; }
    return null;
  }
  querySelectorAll(selector) {
    return this.childNodes.flatMap(child => child.nodeType === 1
      ? [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)] : []);
  }
  addEventListener(type, handler) { const list = this.listeners.get(type) || []; list.push(handler); this.listeners.set(type, list); }
  removeEventListener(type, handler) { this.listeners.set(type, (this.listeners.get(type) || []).filter(value => value !== handler)); }
  emit(type, event = {}) {
    event.target ||= this; event.preventDefault ||= () => { event.defaultPrevented = true; };
    for (const listener of this.listeners.get(type) || []) listener(event);
    return event;
  }
  focus() { this.ownerDocument.activeElement = this; }
  scrollIntoView() { this.scrolled = true; }
  getBoundingClientRect() { return this.className === "book-glossary-popover"
    ? { left: 0, top: 0, right: 320, bottom: 200, width: 320, height: 200 }
    : { left: 50, top: 100, right: 90, bottom: 128, width: 40, height: 28 }; }
}
function textNodes(node) { return node.nodeType === 3 ? [node] : node.childNodes.flatMap(textNodes); }
function offsetWithin(root, node, offset) {
  if (root === node) return offset === 0 ? 0 : root.textContent.length;
  let seen = 0;
  for (const text of textNodes(root)) { if (text === node) return seen + offset; seen += text.length; }
  throw new Error("Range boundary is outside the canonical text");
}
class MockRange {
  setStart(node, offset) { this.startContainer = node; this.startOffset = offset; this.root ||= node.parentElement.closest("p, h2, h3, pre"); }
  setEnd(node, offset) { this.endContainer = node; this.endOffset = offset; }
  selectNodeContents(node) { this.root = node; this.startContainer = node; this.startOffset = 0; this.endContainer = node; this.endOffset = node.childNodes.length; }
  cloneRange() { return Object.assign(new MockRange(), this); }
  toString() { return this.root.textContent.slice(offsetWithin(this.root, this.startContainer, this.startOffset), offsetWithin(this.root, this.endContainer, this.endOffset)); }
  getBoundingClientRect() { return { left: 50, top: 100, right: 90, bottom: 128, width: 40, height: 28 }; }
}
function mockEnvironment() {
  const document = new MockElement("document", null); document.ownerDocument = document;
  document.createElement = tag => new MockElement(tag, document);
  document.createTextNode = text => new MockText(text, document);
  document.createRange = () => new MockRange();
  document.createTreeWalker = root => { const nodes = textNodes(root); let index = 0; return { nextNode: () => nodes[index++] || null }; };
  document.body = document.createElement("body");
  const window = new MockElement("window", document);
  window.innerWidth = 390; window.innerHeight = 700;
  window.matchMedia = () => ({ matches: true });
  window.selection = { rangeCount: 0, isCollapsed: true };
  window.getSelection = () => window.selection;
  Object.assign(globalThis, { document, window, Node: MockNode });
  return { document, window };
}

test("term wrappers retain canonical text, source breaks and annotation ranges across several nodes", () => {
  const { document } = mockEnvironment();
  const text = "甲𠮷用\n神乙用神<script>";
  const content = document.createElement("div"); document.body.append(content);
  const blockNode = document.createElement("section"); blockNode.className = "book-block"; blockNode.dataset.blockId = "block-1";
  const layer = document.createElement("div"); layer.className = "book-original";
  const canonical = document.createElement("p"); layer.append(canonical); blockNode.append(layer); content.append(blockNode);
  const terms = [occurrence(2, 5), occurrence(6, 8)];
  const nodes = renderBookText(sourceBreaks({ text, role: "text" }), terms, "original", senses());
  const append = children => { for (const child of children.flat(Infinity)) canonical.append(child); }; append(nodes);
  assert.equal(canonical.textContent, text);
  assert.equal(canonical.querySelector(".book-term").textContent, "用\n神");
  assert.equal(canonical.querySelector(".book-source-break").textContent, "\n");
  assert.equal(canonical.textContent.includes(entry.definition), false);
  assert.equal(canonical.querySelector("script"), null);
  const annotation = { start: 1, end: 7, quote: "𠮷用\n神乙用" };
  const range = annotationRange(canonical, annotation);
  assert.equal(range.toString(), annotation.quote);
  const section = { number: 1, edition_sha256: "a".repeat(64), blocks: [{ id: "block-1", text, modern: "" }] };
  const selected = selectionAnchor(content, section, { rangeCount: 1, isCollapsed: false, getRangeAt: () => range });
  assert.equal(selected.anchor.start, 1); assert.equal(selected.anchor.end, 7); assert.equal(selected.anchor.quote, annotation.quote);
});

test("mixed roles keep one canonical paragraph, modern pair and copy/annotation offsets", async () => {
  const { document } = mockEnvironment();
  globalThis.location ||= { hash: "", search: "", origin: "https://example.test" };
  const { renderBookBlock } = await import("../web/public/next/views/books.js");
  const texts = [" \r\n標題𠮷\n", "甲乙。\n", "短評。\n", "詩甲\n詩乙\n", "小注甲乙。\n", "評語。  "];
  const roles = ["heading", "text", "text", "verse", "note", "commentary"];
  let cursor = 0;
  const parts = texts.map((text, index) => {
    const start = cursor; cursor += Array.from(text).length;
    return { role: roles[index], start, end: cursor, ...(index === 0 ? { heading_level: 2 } : {}) };
  });
  const text = texts.join("");
  const originalStart = Array.from(text.slice(0, text.lastIndexOf("甲乙"))).length;
  const sample = { id: "sample-term", term: "甲乙", definition: "合成测试词义" };
  const glossary = indexBookGlossary([sample]);
  const block = { id: "block-mixed", role: "text", text, modern: "完整白话𠮷甲乙。", notes: [], parts,
    terms: [{ layer: "original", start: originalStart, end: originalStart + 2, sense_id: sample.id },
      { layer: "modern", start: 5, end: 7, sense_id: sample.id }] };
  const before = structuredClone(block);
  const content = document.createElement("div"); document.body.append(content);
  const body = renderBookBlock(block, { hasModern: true,
    renderText: (runs, terms, layer, source) => renderBookText(runs, terms, layer, glossary, source) });
  content.append(body);
  const canonical = body.querySelector(".book-original p");
  assert.equal(body.dataset.blockId, block.id);
  assert.deepEqual(content.querySelectorAll(".book-block"), [body]);
  assert.equal(body.querySelectorAll(".book-original").length, 1);
  assert.equal(body.querySelectorAll(".book-modern").length, 1);
  assert.equal(body.querySelectorAll("p").length, 2);
  assert.equal(canonical.textContent, text);
  assert.equal(canonical.className, "book-mixed-text");
  assert.deepEqual(canonical.childNodes.map(node => node.className), roles.map(role => `book-part book-part-${role}`));
  assert.deepEqual(canonical.childNodes.map(node => node.textContent), texts);
  assert.equal(canonical.childNodes[0].getAttribute("role"), "heading");
  assert.equal(canonical.childNodes[0].getAttribute("aria-level"), "2");
  assert.equal(canonical.querySelector(".book-part-note").querySelector(".book-term").textContent, sample.term);
  assert.equal(body.querySelector(".book-modern p").textContent, block.modern);
  assert.equal(body.querySelector(".book-modern .book-term").textContent, sample.term);
  const quote = { start: parts[0].end - 2, end: parts[4].end - 1 };
  quote.quote = Array.from(text).slice(quote.start, quote.end).join("");
  const range = annotationRange(canonical, quote);
  assert.equal(range.toString(), quote.quote);
  const selected = selectionAnchor(content, { number: 1, edition_sha256: "a".repeat(64), blocks: [block] },
    { rangeCount: 1, isCollapsed: false, getRangeAt: () => range });
  assert.deepEqual([selected.anchor.start, selected.anchor.end, selected.anchor.quote], [quote.start, quote.end, quote.quote]);
  for (const mode of ["original", "modern", "parallel"]) {
    content.dataset.mode = mode;
    assert.equal(canonical.textContent, block.text);
    assert.equal(body.querySelector(".book-modern p").textContent, block.modern);
    assert.equal(content.querySelectorAll(".book-block").length, 1);
  }
  assert.deepEqual(block, before);
});

test("part-local glossary display validates the complete string and fails closed across boundaries", () => {
  const { document } = mockEnvironment();
  const text = "𠮷甲乙\n丙丁";
  const sample = { id: "sample-term", term: "合成词", definition: "合成测试词义" };
  const glossary = indexBookGlossary([sample]);
  const occurrence = (start, end) => ({ layer: "original", start, end, sense_id: sample.id });
  const render = (value, terms, source) => {
    const node = document.createElement("p");
    node.append(...renderBookText([{ text: value, kind: null }], terms, "original", glossary, source).flat(Infinity));
    assert.equal(node.textContent, value);
    return node;
  };
  const source = { text, start: 1, end: 4 };
  const terms = [occurrence(1, 3), occurrence(4, 6)];
  const before = structuredClone(terms);
  assert.equal(render("甲乙\n", terms, source).querySelector(".book-term").textContent, "甲乙");
  // A crossing term cannot become a shorter clickable term at either edge.
  for (const range of [[0, 2], [2, 5]]) assert.equal(render("甲乙\n", [occurrence(...range)], source).querySelector(".book-term"), null);
  // Global ambiguity stays plain even when only one range fits this part.
  assert.equal(render("甲乙\n", [occurrence(1, 3), occurrence(2, 5)], source).querySelector(".book-term"), null);
  for (const invalid of [{ ...source, start: -1 }, { ...source, end: 7 }, { ...source, end: "4" },
    { ...source, start: 1.5 }, { ...source, text: "另一完整串" }])
    assert.equal(render("甲乙\n", terms, invalid).querySelector(".book-term"), null);
  assert.deepEqual(terms, before);
});

test("absent and malformed parts retain the legacy complete-block rendering", async () => {
  mockEnvironment();
  globalThis.location ||= { hash: "", search: "", origin: "https://example.test" };
  const { renderBookBlock } = await import("../web/public/next/views/books.js");
  const render = block => renderBookBlock(block, { hasModern: true, renderText: runs => runs.map(run => run.text) });
  const block = { id: "block-plain", role: "text", text: "甲𠮷\n乙  ", modern: "完整白话。", notes: [] };
  const signature = node => [node.tagName || "#text", node.className || "", node.data || "",
    [...(node.attributes || [])], { ...node.dataset }, node.childNodes.map(signature)];
  const legacy = signature(render(block));
  for (const parts of [undefined, null, [], [{ role: "text", start: 0, end: 2 }],
    [{ role: "text", start: 0, end: Array.from(block.text).length, heading_level: 2 }]]) {
    const value = { ...block, parts };
    assert.equal(bookBlockParts(value), null);
    assert.deepEqual(signature(render(value)), legacy);
  }
});

test("source cues are optional, closed, literal and outside body, glossary and reading anchors", async () => {
  const { document } = mockEnvironment();
  globalThis.location ||= { hash: "", search: "", origin: "https://example.test" };
  const { renderBookSourceCues, renderBookSectionHeader } = await import("../web/public/next/views/books.js");
  assert.deepEqual(renderBookSourceCues(), []);
  assert.deepEqual(renderBookSourceCues([]), []);
  const section = { title: "正文章", location: "电子源第20行", blocks: [], glossary: [entry] };
  const before = structuredClone(section);
  const signature = node => [node.tagName || "#text", node.className || "", node.data || "",
    [...(node.attributes || [])], { ...node.dataset }, node.childNodes.map(signature)];
  const without = renderBookSectionHeader(section, { hasModern: true });
  const empty = renderBookSectionHeader({ ...section, source_cues: [] }, { hasModern: true });
  assert.deepEqual(signature(without), signature(empty));
  assert.equal(without.querySelector(".book-source-cues"), null);
  const heading = "卷一𠮷\n  <script>题署</script>";
  const attribution = "野鹤 <img onerror=alert(1)>";
  const table = "甲\t乙\n丙  丁\n";
  const cues = [{ label: "原卷题署 <svg>", blocks: [
    { role: "heading", text: heading, modern: "", notes: [], attribution },
    { role: "text", presentation: "table", text: table, modern: "", notes: [] },
  ] }];
  const header = renderBookSectionHeader({ ...section, source_cues: cues }, { hasModern: true });
  const details = header.querySelector(".book-source-cues");
  assert.equal(details.tagName, "DETAILS"); assert.equal(details.getAttribute("open"), null);
  assert.equal(details.querySelector("summary").textContent, cues[0].label);
  assert.equal(details.querySelector("h3").textContent, heading);
  assert.equal(details.querySelector(".book-attribution").textContent, attribution);
  assert.equal(details.querySelector("pre").textContent, table);
  assert.equal(details.querySelector("pre").getAttribute("tabindex"), "0");
  assert.equal(details.closest(".book-section-header"), header);
  for (const selector of [".book-block", ".book-original", ".book-modern", ".book-modern-empty", ".book-term", "script", "img", "svg"])
    assert.equal(details.querySelector(selector), null, selector);
  const descendants = node => [node, ...node.childNodes.flatMap(descendants)];
  assert.ok(descendants(details).every(node => !node.dataset?.blockId && !node.dataset?.readingAnchor));
  assert.deepEqual(section, before);
  const css = await readFile(new URL("../web/public/next/next-books.css", import.meta.url), "utf8");
  const hidingRules = [...css.matchAll(/([^{}]+)\{([^{}]+)\}/g)]
    .filter(([, selector, declarations]) => selector.includes(".book-source-cues") && /display:\s*none/.test(declarations));
  assert.equal(hidingRules.length, 1);
  assert.equal(hidingRules[0][1].trim(), '[data-mode="modern"] .book-source-cues');
});

test("chapter guides retain complete literal text after the title, fold by default and stay outside original mode", async () => {
  mockEnvironment();
  globalThis.location ||= { hash: "", search: "", origin: "https://example.test" };
  const { renderBookSectionHeader } = await import("../web/public/next/views/books.js");
  const intro = "  本章先说明通常条件。\n再分别讨论例外与原疑□𠮷，<script>仅是文字</script>。\n";
  const section = { title: "正文章", location: "电子源第20行", intro, blocks: [], glossary: [] };
  const before = structuredClone(section);
  const header = renderBookSectionHeader(section, { hasModern: true });
  const guide = header.querySelector(".book-chapter-intro");
  assert.equal(guide.tagName, "DETAILS");
  assert.equal(guide.getAttribute("open"), null);
  assert.equal(guide.querySelector("summary").textContent, "本章导读");
  assert.equal(guide.querySelector("p").textContent, intro);
  assert.equal(guide.querySelector("p").getAttribute("lang"), "zh-Hans");
  assert.ok(header.childNodes.indexOf(guide) > header.childNodes.indexOf(header.querySelector("h2")));
  const descendants = node => [node, ...node.childNodes.flatMap(descendants)];
  assert.ok(descendants(guide).every(node => !node.dataset?.blockId && !node.dataset?.readingAnchor));
  for (const selector of [".book-block", ".book-original", ".book-modern", ".book-term", "script"])
    assert.equal(guide.querySelector(selector), null, selector);
  for (const empty of [undefined, "", " \n\t"])
    assert.equal(renderBookSectionHeader({ ...section, intro: empty }, { hasModern: true }).querySelector(".book-chapter-intro"), null);
  assert.equal(renderBookSectionHeader(section, { hasModern: false }).querySelector(".book-chapter-intro"), null);
  assert.deepEqual(section, before);
  const css = await readFile(new URL("../web/public/next/next-books.css", import.meta.url), "utf8");
  const hidingRules = [...css.matchAll(/([^{}]+)\{([^{}]+)\}/g)]
    .filter(([, selector, declarations]) => selector.includes(".book-chapter-intro") && /display:\s*none/.test(declarations));
  assert.equal(hidingRules.length, 1);
  assert.equal(hidingRules[0][1].trim(), '[data-mode="original"] .book-chapter-intro');
});

test("only identical literal tables with matching term ranges and senses share their parallel presentation", async () => {
  mockEnvironment();
  globalThis.location ||= { hash: "", search: "", origin: "https://example.test" };
  const { renderBookBlock } = await import("../web/public/next/views/books.js");
  const text = "用神\t日辰\n甲乙  丙丁𠮷\n";
  const terms = [occurrence(0, 2), { ...occurrence(3, 5), sense_id: "day" },
    { ...occurrence(3, 5, "modern"), sense_id: "day" }, occurrence(0, 2, "modern")];
  const block = { id: "table-stable", role: "table", text, modern: text, notes: ["原校记保留。"], terms };
  const before = structuredClone(block);
  const render = value => renderBookBlock(value, { hasModern: true, hasFigure: false, renderText: parts => parts.map(part => part.text) });
  const table = render(block);
  assert.equal(table.classList.contains("book-shared-table"), true);
  assert.equal(table.dataset.blockId, block.id);
  for (const layer of ["original", "modern"]) {
    const pre = table.querySelector(`.book-${layer} pre`);
    assert.equal(pre.textContent, text);
    assert.equal(pre.classList.contains("book-transcription"), true);
    assert.equal(pre.getAttribute("tabindex"), "0");
  }
  assert.equal(table.querySelector(".book-notes p").textContent, block.notes[0]);
  assert.equal(render({ ...block, terms: [] }).classList.contains("book-shared-table"), true);
  for (const modified of [
    { ...block, modern: "这段白话另行解释表意。" },
    { ...block, terms: terms.filter(term => term.layer === "original") },
    { ...block, terms: terms.map(term => term.layer === "modern" ? { ...term, sense_id: "different" } : term) },
    { ...block, terms: terms.map(term => term.layer === "modern" ? { ...term, end: term.end - 1 } : term) },
    { ...block, role: "text" }, { ...block, presentation: "diagram" }, { ...block, source_text: false },
  ]) assert.equal(render(modified).classList.contains("book-shared-table"), false);
  const explained = render({ ...block, modern: "这段白话另行解释表意。" });
  assert.equal(explained.querySelector(".book-modern p").textContent, "这段白话另行解释表意。");
  assert.equal(explained.querySelector(".book-modern pre"), null);
  assert.deepEqual(block, before);
  const css = await readFile(new URL("../web/public/next/next-books.css", import.meta.url), "utf8");
  const hidingRules = [...css.matchAll(/([^{}]+)\{([^{}]+)\}/g)]
    .filter(([, selector, declarations]) => selector.includes(".book-shared-table") && /display:\s*none/.test(declarations));
  assert.equal(hidingRules.length, 1);
  assert.equal(hidingRules[0][1].trim(), '[data-mode="parallel"] .book-shared-table > .book-modern');
});

test("section headers omit only the exact empty-location placeholder and retain real page locations", async () => {
  mockEnvironment();
  globalThis.location ||= { hash: "", search: "", origin: "https://example.test" };
  const { renderBookSectionHeader } = await import("../web/public/next/views/books.js");
  const section = { title: "正文章", blocks: [] };
  const placeholder = renderBookSectionHeader({ ...section, location: "原书章节" }, { hasModern: true });
  assert.equal(placeholder.querySelector(".books-source"), null);
  assert.equal(placeholder.querySelector("h2").textContent, section.title);
  for (const location of ["来源页 3", "影像文件 1 · 来源页 9", "电子源第20行", "原书章节 附注"]) {
    const header = renderBookSectionHeader({ ...section, location }, { hasModern: true });
    assert.equal(header.querySelector(".books-source").textContent, location);
  }
});

test("actual opening title h2 keeps term selection, saved highlights and note location after folded source cues", async () => {
  const { document, window } = mockEnvironment();
  globalThis.location ||= { hash: "", search: "", origin: "https://example.test" };
  window.document = document; window.ResizeObserver = class {};
  window.scrollY = 0; window.scrollTo = () => {};
  const { renderBookBlock, renderBookSectionHeader } = await import("../web/public/next/views/books.js");
  const { setupBookAnnotations } = await import("../web/public/next/ui/book-annotations.js?v=n43");
  const { session } = await import("../web/public/next/lib/store.js?v=n43");
  const { Decorator, DecorationController } = await import("../web/public/vendor/readium-decorator-1.2.5.js?v=n43");
  const original = { fetch: globalThis.fetch, MessageChannel: globalThis.MessageChannel,
    requestAnimationFrame: globalThis.requestAnimationFrame, cancelAnimationFrame: globalThis.cancelAnimationFrame,
    mount: Decorator.prototype.mount, unmount: Decorator.prototype.unmount,
    apply: DecorationController.prototype.applyDecorations, destroy: DecorationController.prototype.destroy,
    session: session.get() };
  const painted = [], cleanups = [];
  // Keep the actual reader, anchor, note UI and decoration adapter. Only the
  // vendor's browser paint backend is captured at its public adapter boundary.
  Decorator.prototype.mount = () => true; Decorator.prototype.unmount = () => true;
  DecorationController.prototype.applyDecorations = (values, group) => painted.push({ values, group });
  DecorationController.prototype.destroy = () => {};
  globalThis.MessageChannel = undefined;
  globalThis.requestAnimationFrame = callback => { callback(); return 1; };
  globalThis.cancelAnimationFrame = () => {};
  const block = { id: "opening-heading", role: "heading", text: "占𠮷用神", modern: "读𠮷用神", notes: [],
    terms: [occurrence(2, 4), occurrence(2, 4, "modern")] };
  const before = structuredClone(block);
  const section = { number: 4, title: "正文题", location: "电子源第20行", edition_sha256: "a".repeat(64), blocks: [block],
    source_cues: [{ label: "原卷题署", blocks: [{ role: "text", text: "原卷署名𠮷\n", modern: "", notes: [] }] }] };
  const items = ["original", "modern"].map(layer => ({ id: `heading-${layer}`, kind: "highlight", color: "yellow",
    anchor_status: "matched", section_number: 4, edition_sha256: section.edition_sha256,
    block_id: block.id, layer, start: 1, end: 4, quote: "𠮷用神" }));
  globalThis.fetch = async (path, options) => {
    assert.ok(path.startsWith("/api/books/synthetic-source/annotations?")); assert.equal(options.method, "GET");
    return { ok: true, status: 200, text: async () => JSON.stringify({ items, total: 2 }) };
  };
  let annotations;
  try {
    session.set({ authenticated: true, user: { id: "synthetic-reader" } });
    const content = document.createElement("div"); content.className = "book-reading-content"; document.body.append(content);
    const header = renderBookSectionHeader(section, { hasModern: true });
    const body = renderBookBlock(block, { hasModern: true, openingTitle: true,
      renderText: (parts, terms, layer) => renderBookText(parts, terms, layer, senses()) });
    content.append(header, body);
    assert.deepEqual(content.childNodes, [header, body]); // Cues add no direct progress anchor.
    assert.deepEqual(content.querySelectorAll(".book-block"), [body]);
    assert.equal(body.dataset.blockId, block.id);
    assert.equal(content.querySelectorAll(".book-term").length, 2);
    const cueText = textNodes(header.querySelector(".book-source-cue-block p"))[0];
    const cueRange = document.createRange(); cueRange.setStart(cueText, 0); cueRange.setEnd(cueText, 2);
    const cueSelection = selectionAnchor(content, section, { rangeCount: 1, isCollapsed: false, getRangeAt: () => cueRange });
    assert.equal(cueSelection.anchor, null); assert.equal(cueSelection.reason, "outside");
    for (const item of items) {
      const heading = content.querySelector(`.book-${item.layer} h2`);
      assert.ok(heading); assert.equal(heading.textContent, item.layer === "original" ? block.text : block.modern);
      assert.equal(heading.querySelector(".book-term").textContent, "用神");
      const range = annotationRange(heading, item);
      const selected = selectionAnchor(content, section, { rangeCount: 1, isCollapsed: false, getRangeAt: () => range });
      assert.equal(selected.reason, ""); assert.equal(selected.anchor.block_id, block.id);
      assert.equal(selected.anchor.layer, item.layer); assert.equal(selected.anchor.quote, "𠮷用神");
      assert.deepEqual([selected.anchor.start, selected.anchor.end], [1, 4]);
    }
    annotations = setupBookAnnotations({ content, book: { id: "synthetic-source" }, getSection: () => section,
      getMode: () => "parallel", ctx: { isCurrent: () => true, cleanup: callback => cleanups.push(callback) } });
    annotations.onSection(section); await new Promise(resolve => setImmediate(resolve));
    const marks = painted.find(({ group, values }) => group.startsWith("xz-book-marks-") && values.length === 2)?.values;
    assert.ok(marks, "Both h2 anchors must reach the real decoration adapter");
    for (const item of items) {
      const heading = content.querySelector(`.book-${item.layer} h2`);
      const mark = marks.find(value => value.id === item.id);
      assert.equal(mark.locator.locations.serialize().cssSelector, `[data-book-decoration-node="${heading.getAttribute("data-book-decoration-node")}"]`);
      assert.equal(annotations.locate(item), true, `Locate saved ${item.layer} h2 note`);
    }
    assert.deepEqual(block, before);
  } finally {
    cleanups.forEach(cleanup => cleanup());
    session.set(original.session);
    Decorator.prototype.mount = original.mount; Decorator.prototype.unmount = original.unmount;
    DecorationController.prototype.applyDecorations = original.apply; DecorationController.prototype.destroy = original.destroy;
    for (const key of ["fetch", "MessageChannel", "requestAnimationFrame", "cancelAnimationFrame"]) globalThis[key] = original[key];
  }
});

test("glossary supports keyboard, touch, selection priority, readable hover and section cleanup", async () => {
  const { document, window } = mockEnvironment();
  const cleanups = [];
  const content = document.createElement("div"); document.body.append(content);
  const glossary = setupBookGlossary({ content, ctx: { isCurrent: () => true, cleanup: callback => cleanups.push(callback) } });
  glossary.onSection({ glossary: [entry] });
  content.append(...glossary.renderText([{ text: "用神", kind: null }], [occurrence(0, 2)], "original"));
  const term = content.querySelector(".book-term"), popup = document.body.querySelector(".book-glossary-popover");
  const event = { target: term, relatedTarget: null };
  term.focus(); content.emit("focusin", { ...event });
  assert.equal(popup.hidden, false); assert.equal(popup.querySelector("p").textContent, entry.definition);
  assert.equal(content.textContent, "用神"); assert.equal(content.contains(popup), false);
  const key = document.emit("keydown", { ...event, key: "Enter" }); assert.equal(key.defaultPrevented, true);
  document.emit("keydown", { ...event, key: "Escape" }); assert.equal(popup.hidden, true); assert.equal(document.activeElement, term);
  document.emit("keydown", { ...event, key: " " }); assert.equal(popup.hidden, false);
  popup.querySelector("button").emit("click"); assert.equal(popup.hidden, true);
  document.activeElement = document.body;
  content.emit("pointerover", { ...event, pointerType: "mouse" }); assert.equal(popup.hidden, false);
  content.emit("pointerout", { ...event }); popup.emit("pointerenter");
  await new Promise(resolve => setTimeout(resolve, 240)); assert.equal(popup.hidden, false);
  popup.emit("pointerleave"); await new Promise(resolve => setTimeout(resolve, 240)); assert.equal(popup.hidden, true);
  content.emit("pointerover", { ...event, pointerType: "touch" }); assert.equal(popup.hidden, true);
  content.emit("pointerdown", { ...event, clientX: 50, clientY: 100, pointerType: "touch" });
  content.emit("click", { ...event }); assert.equal(popup.hidden, false);
  const definitionText = popup.querySelector("p").childNodes[0];
  window.selection = { rangeCount: 1, isCollapsed: false, anchorNode: definitionText, focusNode: definitionText };
  document.emit("selectionchange"); assert.equal(popup.hidden, false); // Definition text can be copied.
  window.selection = { rangeCount: 1, isCollapsed: false };
  document.emit("selectionchange"); assert.equal(popup.hidden, true);
  content.emit("click", { ...event }); assert.equal(popup.hidden, true);
  window.selection = { rangeCount: 0, isCollapsed: true };
  content.emit("pointerdown", { ...event, clientX: 50, clientY: 100 });
  content.emit("pointermove", { ...event, clientX: 80, clientY: 100 });
  content.emit("click", { ...event }); assert.equal(popup.hidden, true);
  const now = Date.now;
  let instant = now();
  Date.now = () => instant;
  try {
    content.emit("pointerdown", { ...event, clientX: 50, clientY: 100 }); instant += 500;
    document.emit("pointerup", { ...event });
    content.emit("focusin", { ...event }); assert.equal(popup.hidden, true);
    content.emit("click", { ...event }); assert.equal(popup.hidden, true);
  } finally { Date.now = now; }
  content.emit("click", { ...event }); assert.equal(popup.hidden, false);
  glossary.onSection(null); assert.equal(popup.hidden, true); assert.equal(popup.textContent, "×");
  assert.equal(term.getAttribute("aria-expanded"), "false");
  cleanups.forEach(cleanup => cleanup()); assert.equal(popup.isConnected, false);
  assert.equal([...content.listeners.values()].flat().length, 0);
  assert.equal([...document.listeners.values()].flat().length, 0);
  assert.equal([...window.listeners.values()].flat().length, 0);
});

test("leaving ordinary reader text while no term is active does not throw", () => {
  const { document } = mockEnvironment();
  const cleanups = [], content = document.createElement("div"); document.body.append(content);
  const glossary = setupBookGlossary({ content, ctx: { isCurrent: () => true, cleanup: callback => cleanups.push(callback) } });
  glossary.onSection({ glossary: [entry] });
  const paragraph = document.createElement("p"); content.append(paragraph);
  paragraph.append("普通正文", ...glossary.renderText([{ text: "用神", kind: null }], [occurrence(0, 2)], "original"));
  const popup = document.body.querySelector(".book-glossary-popover");
  const leaveText = () => content.emit("pointerout", { target: paragraph.childNodes[0], relatedTarget: null });
  assert.doesNotThrow(leaveText);
  content.emit("click", { target: paragraph.querySelector(".book-term") });
  assert.equal(popup.hidden, false);
  popup.querySelector("button").emit("click");
  assert.equal(popup.hidden, true);
  assert.doesNotThrow(leaveText);
  assert.doesNotThrow(() => content.emit("pointerout", { target: paragraph, relatedTarget: document.body }));
  cleanups.forEach(cleanup => cleanup());
});

test("glossary definitions and expanded explanations stay literal and long mobile content stays bounded", () => {
  const { document } = mockEnvironment();
  const cleanups = [], content = document.createElement("div"); document.body.append(content);
  const malicious = { ...entry, term: "<img onerror=alert(1)>", definition: "<script>alert(1)</script>",
    explanation: "<svg onload=alert(1)>".repeat(80), usage_note: "<iframe>" };
  const glossary = setupBookGlossary({ content, ctx: { isCurrent: () => true, cleanup: callback => cleanups.push(callback) } });
  glossary.onSection({ glossary: [malicious] });
  content.append(...glossary.renderText([{ text: "用神", kind: null }], [occurrence(0, 2)], "original"));
  content.emit("click", { target: content.querySelector(".book-term") });
  const popup = document.body.querySelector(".book-glossary-popover");
  assert.equal(popup.querySelector("h3").textContent, malicious.term);
  assert.equal(popup.querySelector("p").textContent, malicious.definition);
  for (const tag of ["img", "script", "svg", "iframe"]) assert.equal(popup.querySelector(tag), null);
  assert.equal(popup.style.maxWidth, "366px"); assert.equal(popup.style.maxHeight, "676px");
  assert.equal(popup.style.left, "50px"); assert.equal(popup.style.top, "136px");
  cleanups.forEach(cleanup => cleanup());
});

test("a native drag starting on a focusable term stays selectable across another term without reopening a definition", () => {
  const { document, window } = mockEnvironment();
  const cleanups = [], content = document.createElement("div"); document.body.append(content);
  const glossary = setupBookGlossary({ content, ctx: { isCurrent: () => true, cleanup: callback => cleanups.push(callback) } });
  glossary.onSection({ glossary: [entry] });
  const canonical = document.createElement("p"); content.append(canonical);
  const rendered = glossary.renderText([{ text: "用神的成败得失；用神的", kind: null }], [occurrence(0, 2), occurrence(8, 10)], "original");
  for (const node of rendered.flat(Infinity)) canonical.append(node);
  const first = canonical.childNodes[0], second = canonical.childNodes[2];
  const popup = document.body.querySelector(".book-glossary-popover");
  const event = { target: first, relatedTarget: null, pointerType: "mouse", button: 0, clientX: 50, clientY: 100 };
  document.activeElement = document.body;
  content.emit("pointerover", { ...event, buttons: 0 }); assert.equal(popup.hidden, false);
  const down = content.emit("pointerdown", { ...event, buttons: 1 });
  assert.equal(down.defaultPrevented, undefined); // Native selection must remain enabled.
  assert.equal(first.getAttribute("tabindex"), null); // No default pointer focus to swallow its starting text.
  assert.equal(popup.hidden, true);
  content.emit("focusin", { ...event }); assert.equal(popup.hidden, true);
  content.emit("pointermove", { ...event, target: second, clientX: 180, buttons: 1 });
  content.emit("pointerover", { ...event, target: second, relatedTarget: first, buttons: 1 });
  assert.equal(popup.hidden, true); // Mouse-held hover cannot interrupt a drag, even before selectionchange.
  document.emit("pointerup", { ...event, target: second, clientX: 180, buttons: 0 });
  assert.equal(first.getAttribute("tabindex"), "0");
  content.emit("click", { ...event, target: second, clientX: 180, buttons: 0 });
  assert.equal(popup.hidden, true); // Releasing on a different term cannot discard the gesture's moved state.
  assert.equal(canonical.textContent, "用神的成败得失；用神的");
  second.focus(); content.emit("focusin", { target: second }); assert.equal(popup.hidden, false);
  glossary.close();
  content.emit("pointerdown", { ...event });
  assert.equal(first.getAttribute("tabindex"), null);
  window.emit("blur"); assert.equal(first.getAttribute("tabindex"), "0");
  content.emit("pointerdown", { ...event });
  glossary.onSection(null); assert.equal(first.getAttribute("tabindex"), "0");
  cleanups.forEach(cleanup => cleanup());
});
