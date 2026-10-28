import { test } from "node:test";
import assert from "node:assert/strict";
import { groupBookContents, isOriginalOnlyAppendix } from "../web/public/next/lib/books.js";

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

const volumeLabels = ["卷一", "卷二", "卷三", "卷四", "卷五", "卷六"];
const volumeCounts = [19, 15, 12, 11, 11, 2];
const volumeContents = Array.from({ length: 3 }, (_, index) =>
  ({ number: index + 1, title: `序${index + 1}`, location: "原书章节", partial: false }));
volumeCounts.forEach((count, index) => {
  for (let offset = 0; offset < count; offset++) {
    const number = volumeContents.length + 1;
    volumeContents.push({ number, title: `章节${number}`, location: volumeLabels[index], partial: false });
  }
});
for (const [child, parent] of [[16, 15], [21, 20], [22, 20], [30, 29], [31, 29]]) {
  volumeContents[child - 1].location += ` · ${volumeContents[parent - 1].title}`;
}

test("explicit six-volume paths keep all 73 source destinations and only five child depths", () => {
  const before = structuredClone(volumeContents);
  const groups = groupBookContents(volumeContents, "", 22);
  assert.deepEqual(groups.map(group => [group.kind, group.label, group.items.length, group.open]), [
    ["body", undefined, 3, true],
    ...volumeLabels.map((label, index) => ["volume", label, volumeCounts[index], index === 0]),
  ]);
  const items = groups.flatMap(group => group.items);
  assert.deepEqual(items.filter(item => item.contents_depth === 1).map(item => item.number), [16, 21, 22, 30, 31]);
  assert.deepEqual(items.map(({ display_title, contents_depth, ...item }) => item), volumeContents);
  assert.deepEqual(volumeContents, before);
  assert.ok(items.slice(0, 3).every(item => !Object.hasOwn(item, "contents_depth")));
  for (const item of volumeContents.slice(-2)) {
    assert.equal(isOriginalOnlyAppendix({ ...item, blocks: [] }), false, "volume-six ancient text stays in the chapter reading mode");
  }
});

test("volume searches preserve child depth and parent path, then clearing restores the current volume", () => {
  const child = groupBookContents(volumeContents, "22", 2);
  assert.deepEqual(child.map(group => [group.kind, group.label, group.open, group.items.map(item => [item.number, item.contents_depth])]),
    [["volume", "卷一", true, [[22, 1]]]]);
  assert.deepEqual(groupBookContents(volumeContents, "章节20", 2).flatMap(group => group.items).map(item => item.number), [20, 21, 22]);
  assert.deepEqual(groupBookContents(volumeContents, "卷六", 2).map(group => [group.label, group.items.map(item => item.number)]),
    [["卷六", [72, 73]]]);
  const reset = groupBookContents(volumeContents, "", 31);
  assert.equal(reset.flatMap(group => group.items).length, 73);
  assert.deepEqual(reset.filter(group => group.kind === "volume" && group.open).map(group => group.label), ["卷二"]);
});

test("same-volume runs remain separate across body and appendix rows, including after filtering", () => {
  const rows = [
    { number: 1, title: "同题", location: "卷一" },
    { number: 2, title: "同题", location: "卷一 · 同题" },
    { number: 3, title: "中间说明", location: "原书章节" },
    { number: 4, title: "同题", location: "卷一" },
    { number: 5, title: "来源", location: "附录" },
    { number: 6, title: "同题", location: "卷一" },
    { number: 7, title: "同题", location: "卷二" },
  ];
  const groups = groupBookContents(rows, "卷", 1);
  assert.deepEqual(groups.map(group => [group.label, group.items.map(item => item.number)]),
    [["卷一", [1, 2]], ["卷一", [4]], ["卷一", [6]], ["卷二", [7]]]);
  assert.ok(groups.flatMap(group => group.items).every(item => item.display_title === "同题"), "real repeated chapter titles are never appendix ordinals");
});

test("ordinary and malformed locations are not inferred as volume paths", () => {
  const locations = ["來源頁 卷一", "卷一頁", " 卷一", "卷一 ", "卷一·章", "卷一 · ", "卷一 · 章 · 子章", "卷一 ·  章", "卷一 · 章\n注", "卷甲", "卷三 · 第 20 页"];
  const rows = locations.map((location, index) => ({ number: index + 1, title: "卷一", location }));
  const groups = groupBookContents(rows);
  assert.deepEqual(groups.map(group => group.kind), ["body"]);
  assert.ok(groups[0].items.every(item => !Object.hasOwn(item, "contents_depth")));
  assert.ok(!Object.hasOwn(groups[0], "label"));
  assert.deepEqual(groups[0].items.map(({ display_title, ...item }) => item), rows);
});

test("a child path needs its exact nearest parent in the same uninterrupted volume", () => {
  const rows = [
    { number: 1, title: "甲", location: "卷一" },
    { number: 2, title: "乙", location: "卷一" },
    { number: 3, title: "旧父题引用", location: "卷一 · 甲" },
    { number: 4, title: "跨普通行引用", location: "卷一 · 乙" },
    { number: 5, title: "丙", location: "卷二" },
    { number: 6, title: "跨卷引用", location: "卷一 · 丙" },
  ];
  const groups = groupBookContents(rows);
  assert.deepEqual(groups.map(group => [group.kind, group.items.map(item => item.number)]),
    [["volume", [1, 2]], ["body", [3, 4]], ["volume", [5]], ["body", [6]]]);
  assert.ok(groups.flatMap(group => group.items).every(item => item.contents_depth !== 1));
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

test("six-volume directory renders one summary per volume and indents only real child buttons", () => {
  const selected = [];
  const sidebar = createBookSidebar({ book: { id: "volume-sample", title: "分卷测试", section_count: volumeContents.length },
    contents: volumeContents, current: 22, onSelect: number => selected.push(number), onCollapse() {} });
  const rows = sidebar.node.querySelector("nav"), details = rows.querySelectorAll("details");
  assert.deepEqual(details.map(group => group.querySelector("summary").textContent), volumeLabels);
  assert.equal(rows.querySelectorAll("button").length, 73);
  assert.equal(rows.querySelectorAll(".book-contents-subchapter").length, 5);
  assert.equal(rows.querySelectorAll("small").length, 0, "the volume path is not repeated underneath every chapter");
  assert.equal(details[0].open, true);
  assert.ok(details.slice(1).every(group => !group.open));
  const current = rows.querySelector('[aria-current="page"]');
  current.emit("click"); assert.deepEqual(selected, [22]);
  current.focus(); details[0].open = false; details[0].emit("toggle");
  assert.equal(document.activeElement, details[0].querySelector("summary"));
  assert.ok(details[0].querySelectorAll("button").every(button => button.tabIndex === -1));
  details[0].open = true; details[0].emit("toggle");
  rows.emit("keydown", { key: "ArrowDown" });
  assert.equal(document.activeElement, details[0].querySelector("button"));
  const search = sidebar.node.querySelector("input");
  search.value = "22"; search.emit("input");
  assert.equal(rows.querySelectorAll("summary").length, 1);
  assert.equal(rows.querySelectorAll("button").length, 1);
  assert.equal(rows.querySelector("button").classList.contains("book-contents-subchapter"), true);
  assert.equal(rows.querySelector("details").open, true);
  search.value = ""; search.emit("input");
  assert.deepEqual(rows.querySelectorAll("summary").map(summary => summary.textContent), volumeLabels);
  assert.equal(rows.querySelectorAll("button").length, 73);
  assert.equal(rows.querySelector('[aria-current="page"]').querySelector("b").textContent, "章节22");
  sidebar.destroy();
});
