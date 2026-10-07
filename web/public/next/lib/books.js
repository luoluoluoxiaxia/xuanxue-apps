// 页码来自服务端目录；只保存本机阅读进度，不修改书籍文字。
import traditionalCharacters from "../../vendor/opencc-ts-characters-1.4.2.js?v=n17";

// OpenCC 的字形词典只用于搜索比较；不转换底本文字或构造新正文。
const searchCharacters = new Map(traditionalCharacters.split("|").map(row => row.split(" ").slice(0, 2)));
const searchText = text => Array.from(String(text).normalize("NFKC").toLocaleLowerCase(), char => searchCharacters.get(char) || char).join("");
export const BOOK_STATUS = {
  reading_edition: "原文 · 白话", first_pass: "原文初录 · 待校勘", working_draft: "有疑缺的工作稿", unavailable: "成品待恢复",
};
export const BOOK_SYSTEM = { bazi: "八字", liuyao: "六爻", general: "通用" };

export function readingPath(id, number = 1) {
  return `/books/${encodeURIComponent(id)}?page=${number}`;
}

export function readingNumber(value, count) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 1 && number <= count ? number : 1;
}

export function filterBooks(books, query, system) {
  const needle = searchText(query.trim());
  return books.filter(book => (!system || book.system === system) &&
    (!needle || searchText(`${book.title} ${book.source_label}`).includes(needle)));
}

export function filterContents(contents, query) {
  const needle = searchText(query.trim());
  if (/^\d+$/.test(needle)) return contents.filter(item => item.number === Number(needle));
  return contents.filter(item => !needle ||
    searchText(`${item.title} ${item.location}`).includes(needle));
}

export function readingPreferences(value = {}) {
  value = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    size: [18, 20, 22, 24].includes(value.size) ? value.size : 20,
    line: [1.8, 2, 2.2].includes(value.line) ? value.line : 2,
    font: value.font === "sans" ? "sans" : "serif",
    paper: value.paper === "warm" ? "warm" : "white",
    layout: value.layout === "source" ? "source" : "continuous",
  };
}

// 只标记普通正文的来源换行；每一段 text 拼回后仍与接口原文逐字符相同。
// 诗诀、标题和图表转写始终保留自身结构，不在这里推断或重组段落。
export function sourceBreaks(block) {
  const text = block.text;
  if (!["text", "prose", "note", "commentary"].includes(block.role) ||
      (block.presentation && block.presentation !== "prose") || block.source_text === false) {
    return [{ text, kind: null }];
  }
  const parts = [];
  let offset = 0;
  for (const match of text.matchAll(/\n+/g)) {
    if (match.index > offset) parts.push({ text: text.slice(offset, match.index), kind: null });
    const before = text[match.index - 1] || "";
    const after = text[match.index + match[0].length] || "";
    const kind = match[0].length > 1 ? "paragraph"
      : /[A-Za-z0-9]/.test(before) && /[A-Za-z0-9]/.test(after) ? "space" : "soft";
    parts.push({ text: match[0], kind });
    offset = match.index + match[0].length;
  }
  if (offset < text.length || !parts.length) parts.push({ text: text.slice(offset), kind: null });
  return parts;
}

// 以段落及段内比例保存位置，换字号或屏幕宽度后仍可找到同一段。
export function readingPosition(value, count) {
  if (!value || typeof value !== "object" || readingNumber(value.number, count) !== value.number ||
      !Number.isSafeInteger(value.anchor) || value.anchor < 0 || !Number.isFinite(value.offset) ||
      value.offset < 0 || value.offset > 1 || !Number.isFinite(value.updatedAt) || value.updatedAt <= 0) return null;
  return { number: value.number, anchor: value.anchor, offset: value.offset, updatedAt: value.updatedAt };
}

// 坐标以看图区域中心为原点；缩放保持指针下的图像位置，拖动不允许把图完全移出视野。
export function imageTransform(current, scale, point, size) {
  scale = Math.max(1, Math.min(8, scale));
  const ratio = scale / current.scale;
  const limitX = Math.max(0, (size.width * scale - size.stageWidth) / 2);
  const limitY = Math.max(0, (size.height * scale - size.stageHeight) / 2);
  const x = point.x - (point.x - current.x) * ratio;
  const y = point.y - (point.y - current.y) * ratio;
  return { scale, x: limitX ? Math.max(-limitX, Math.min(limitX, x)) : 0, y: limitY ? Math.max(-limitY, Math.min(limitY, y)) : 0 };
}
