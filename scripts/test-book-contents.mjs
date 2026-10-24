import { test } from "node:test";
import assert from "node:assert/strict";
import { groupBookContents } from "../web/public/next/lib/books.js";

const contents = [
  { number: 1, title: "开篇", location: "原书章节", partial: false },
  { number: 2, title: "正文", location: "来源页 2", partial: false },
  { number: 3, title: "原書目錄", location: "附录", partial: false },
  { number: 4, title: "原書目錄", location: "附录", partial: false },
  { number: 5, title: "刊記", location: "附录", partial: false },
  { number: 6, title: "刊記", location: "附录", partial: true },
  { number: 7, title: "后记正文", location: "来源页 7", partial: false },
  { number: 8, title: "原書目錄", location: "附录", partial: false },
];

test("consecutive appendices fold without merging separated runs or changing source identities", () => {
  const before = structuredClone(contents);
  const groups = groupBookContents(contents, "", 1);
  assert.deepEqual(groups.map(group => [group.kind, group.items.map(row => row.number), group.open]), [
    ["body", [1, 2], true], ["appendix", [3, 4, 5, 6], false], ["body", [7], true], ["appendix", [8], false],
  ]);
  assert.deepEqual(groups[1].items.map(row => row.display_title), ["原書目錄 · 1", "原書目錄 · 2", "刊記 · 1", "刊記 · 2"]);
  assert.deepEqual(groups[3].items.map(row => row.display_title), ["原書目錄"]);
  assert.deepEqual(groups.flatMap(group => group.items).map(({ display_title, ...row }) => row), contents);
  assert.deepEqual(contents, before);
  assert.deepEqual(groupBookContents([]), []);
});

test("current appendix and matching searches open while duplicate numbering survives filtering", () => {
  assert.equal(groupBookContents(contents, "", 4)[1].open, true);
  const byNumber = groupBookContents(contents, "4", 1);
  assert.deepEqual(byNumber.map(group => [group.kind, group.open, group.items.map(row => [row.number, row.title, row.display_title])]),
    [["appendix", true, [[4, "原書目錄", "原書目錄 · 2"]]]]);
  const bySimplified = groupBookContents(contents, "原书目录", 1);
  assert.deepEqual(bySimplified.map(group => group.items.map(row => row.number)), [[3, 4], [8]]);
  assert.ok(bySimplified.every(group => group.open));
  assert.equal(groupBookContents(contents, "后记正文", 1)[0].kind, "body");
  assert.deepEqual(groupBookContents(contents, "不存在", 1), []);
});

class TestNode {
  constructor(tag, text = "") {
    this.tagName = tag.toUpperCase(); this.nodeType = tag === "#text" ? 3 : 1; this.data = text;
    this.parentElement = null; this.childNodes = []; this.attributes = new Map(); this.listeners = new Map();
    this.className = ""; this.dataset = {}; this.style = {}; this.open = false; this.tabIndex = -1; this.value = "";
  }
  append(...children) {
    for (const child of children) { child.parentElement = this; this.childNodes.push(child); }
  }
  replaceChildren(...children) { this.childNodes = []; this.append(...children); }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === "open") this.open = true;
    if (name === "tabindex") this.tabIndex = Number(value);
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  get textContent() { return this.nodeType === 3 ? this.data : this.childNodes.map(child => child.textContent).join(""); }
  set textContent(text) { this.childNodes = [new TestNode("#text", String(text))]; this.childNodes[0].parentElement = this; }
  get classList() { return { contains: name => this.className.split(" ").includes(name) }; }
  matches(selector) {
    return selector.split(",").some(part => {
      part = part.trim();
      if (part.startsWith(".")) return this.classList.contains(part.slice(1));
      const attr = /^\[([^=]+)="([^"]*)"\]$/.exec(part);
      return attr ? this.getAttribute(attr[1]) === attr[2] : this.tagName.toLowerCase() === part;
    });
  }
  querySelectorAll(selector) {
    return this.childNodes.flatMap(child => child.nodeType === 1
      ? [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)] : []);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(name, handler) { this.listeners.set(name, handler); }
  contains(node) { return node === this || this.childNodes.some(child => child.contains(node)); }
  focus() { document.activeElement = this; this.emit("focus"); }
  emit(name, event = {}) { this.listeners.get(name)?.({ currentTarget: this, target: this, preventDefault() {}, ...event }); }
}

globalThis.Node = TestNode;
globalThis.window = { addEventListener() {}, crypto: globalThis.crypto };
globalThis.document = { createElement: tag => new TestNode(tag), createTextNode: text => new TestNode("#text", text),
  addEventListener() {}, activeElement: null };
globalThis.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};
const { renderBookContentsGroups, bookContentsControls, createBookSidebar } = await import("../web/public/next/ui/book-tools.js");

test("the shared desktop/mobile group preserves every button and excludes closed descendants from keyboard destinations", () => {
  const groups = groupBookContents(contents, "", 1);
  const rows = new TestNode("nav"); const selected = [];
  const renderItem = item => {
    const button = new TestNode("button"); button.textContent = item.display_title;
    button.addEventListener("click", () => selected.push(item.number)); return button;
  };
  rows.append(...renderBookContentsGroups(groups, renderItem, () => {}));
  assert.equal(rows.querySelectorAll("button").length, contents.length);
  const disclosures = rows.querySelectorAll("details");
  assert.equal(disclosures.length, 2);
  assert.equal(disclosures[0].querySelector("summary").textContent, "版本附录 · 4");
  assert.deepEqual(bookContentsControls(rows).map(node => node.textContent), ["开篇", "正文", "版本附录 · 4", "后记正文", "版本附录 · 1"]);
  disclosures[0].open = true;
  assert.deepEqual(bookContentsControls(rows).slice(3, 7).map(node => node.textContent), ["原書目錄 · 1", "原書目錄 · 2", "刊記 · 1", "刊記 · 2"]);
  disclosures[0].querySelectorAll("button")[1].emit("click"); assert.deepEqual(selected, [4]);
  disclosures[0].open = false;
  assert.equal(bookContentsControls(rows).includes(disclosures[0].querySelector("button")), false);
  assert.equal(rows.querySelectorAll("button").length, contents.length, "native disclosure never removes source destinations");
});

test("desktop arrows and tab stops stay outside closed groups and can enter reopened appendix rows", () => {
  const selected = [];
  const sidebar = createBookSidebar({ book: { id: "sample-book", title: "测试书", section_count: contents.length },
    contents, current: 2, onSelect: number => selected.push(number), onCollapse() {} });
  const rows = sidebar.node.querySelector("nav"), disclosure = rows.querySelector("details");
  const hiddenButtons = disclosure.querySelectorAll("button");
  assert.ok(hiddenButtons.every(button => button.tabIndex === -1));
  const ordinary = bookContentsControls(rows).filter(node => node.tagName === "BUTTON");
  ordinary[1].focus(); rows.emit("keydown", { key: "ArrowDown" });
  assert.equal(document.activeElement, disclosure.querySelector("summary"));
  rows.emit("keydown", { key: "ArrowDown" }); assert.equal(document.activeElement.querySelector("b").textContent, "后记正文");
  disclosure.open = true; disclosure.emit("toggle"); disclosure.querySelector("summary").focus();
  rows.emit("keydown", { key: "ArrowDown" }); assert.equal(document.activeElement, hiddenButtons[0]);
  document.activeElement.emit("click"); assert.deepEqual(selected, [3]);
  disclosure.open = false; disclosure.emit("toggle");
  assert.equal(document.activeElement, disclosure.querySelector("summary"));
  assert.ok(hiddenButtons.every(button => button.tabIndex === -1));
  sidebar.destroy();
});
