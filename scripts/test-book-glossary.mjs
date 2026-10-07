import { test } from "node:test";
import assert from "node:assert/strict";
import { indexBookGlossary, bookTermRanges, bookTextRuns } from "../web/public/next/lib/book-glossary.js";
import { sourceBreaks } from "../web/public/next/lib/books.js";
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
  }
  set innerHTML(_) { throw new Error("Text content must never be parsed as HTML"); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); if (name === "hidden") this.hidden = true; }
  removeAttribute(name) { this.attributes.delete(name); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  matches(selector) {
    return selector.split(",").some(item => {
      item = item.trim();
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
  addEventListener(type, handler) { const list = this.listeners.get(type) || []; list.push(handler); this.listeners.set(type, list); }
  removeEventListener(type, handler) { this.listeners.set(type, (this.listeners.get(type) || []).filter(value => value !== handler)); }
  emit(type, event = {}) {
    event.target ||= this; event.preventDefault ||= () => { event.defaultPrevented = true; };
    for (const listener of this.listeners.get(type) || []) listener(event);
    return event;
  }
  focus() { this.ownerDocument.activeElement = this; }
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
  setStart(node, offset) { this.startContainer = node; this.startOffset = offset; this.root ||= node.parentElement.closest("p, h3, pre"); }
  setEnd(node, offset) { this.endContainer = node; this.endOffset = offset; }
  selectNodeContents(node) { this.root = node; this.startContainer = node; this.startOffset = 0; this.endContainer = node; this.endOffset = node.childNodes.length; }
  cloneRange() { return Object.assign(new MockRange(), this); }
  toString() { return this.root.textContent.slice(offsetWithin(this.root, this.startContainer, this.startOffset), offsetWithin(this.root, this.endContainer, this.endOffset)); }
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
