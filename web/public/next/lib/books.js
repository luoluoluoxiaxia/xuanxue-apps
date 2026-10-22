// 页码来自服务端目录；只保存本机阅读进度，不修改书籍文字。
import traditionalCharacters from "../../vendor/opencc-ts-characters-1.4.2.js?v=n30";

// OpenCC 的字形词典只用于搜索比较；不转换底本文字或构造新正文。
const searchCharacters = new Map(traditionalCharacters.split("|").map(row => row.split(" ").slice(0, 2)));
const searchText = text => Array.from(String(text).normalize("NFKC").toLocaleLowerCase(), char => searchCharacters.get(char) || char).join("");
export const BOOK_STATUS = {
  reading_edition: "原文 · 白话", first_pass: "原文初录 · 待校勘", working_draft: "有疑缺的工作稿", unavailable: "成品待恢复",
};
export const BOOK_SYSTEM = { bazi: "八字", liuyao: "六爻", general: "通用" };

export const TEXT_ROLES = { original: "原文", original_note: "原注", commentary: "评注", modern_editorial: "现代整理说明", unclassified: "未分类" };
export const TEXT_COMPLETENESS = { complete: "完整", incomplete: "不完整", excerpt: "节录", unknown: "完整度待核" };
export const TEXT_COLLATION = { unproofread: "未校勘", partially_collated: "部分校勘", collated: "已校勘" };

export function textVersionPath(bookId, versionId = "catalog", chapterId = "", { resume = false } = {}) {
  const query = new URLSearchParams({ "text-version": versionId });
  if (chapterId) query.set("chapter", chapterId);
  if (resume) query.set("resume", "1");
  return `/books/${encodeURIComponent(bookId)}?${query}`;
}

export function textExportPath(bookId, versionId, format = "txt", chapterId = "") {
  const query = new URLSearchParams({ format });
  if (chapterId) query.set("chapter_id", chapterId);
  return `/api/books/${encodeURIComponent(bookId)}/text-versions/${encodeURIComponent(versionId)}/export?${query}`;
}

export const READING_KINDS = { body: "正文", preface: "序跋", appendix: "附录", notes: "整理校记" };

export function readingBlockText(block, punctuation = "punctuated") {
  return punctuation === "source" ? block.text : block.punctuated_text ?? block.text;
}

// Added punctuation and paragraph spacing do not count toward the location in
// the supplied words. Keep supplementary characters and diagram symbols intact.
export function readingCharacterLength(text) {
  return Array.from(text).filter(char => !/[\p{P}\s]/u.test(char)).length;
}

export function readingCharacterAnchor(anchors, character) {
  const rows = anchors.filter(anchor => anchor.length > 0);
  const row = rows.find(anchor => character < anchor.start + anchor.length) || rows.at(-1);
  return row ? { anchor: row.anchor, offset: Math.max(0, Math.min(1, (character - row.start) / row.length)) } : null;
}

// New reading sections retain links to immutable source chapters. Never choose a
// similar title when an old or malformed link has no exact source mapping.
export function selectReadingSection(reading, requested) {
  const id = requested || reading.default_section_id;
  const direct = reading.sections.findIndex(section => section.id === id);
  if (direct >= 0) return direct;
  const mapped = reading.source_sections.find(item => item.chapter_id === id)?.section_id;
  return mapped ? reading.sections.findIndex(section => section.id === mapped) : -1;
}

export function groupReadingSections(sections, query = "") {
  const needle = searchText(query.trim());
  return Object.entries(READING_KINDS).map(([kind, title]) => ({ kind, title,
    sections: sections.filter(section => section.kind === kind && (!needle || searchText(`${section.title} ${section.source_location}`).includes(needle)))
  })).filter(group => group.sections.length);
}

export function textReadingPosition(value) {
  const identity = id => typeof id === "string" && id.length <= 120 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id);
  if (!value || typeof value !== "object" || !identity(value.versionId) || !identity(value.sectionId) ||
      typeof value.title !== "string" || !value.title.trim() || value.title.length > 300 ||
      !Number.isFinite(value.updatedAt) || value.updatedAt <= 0) return null;
  const position = { versionId: value.versionId, sectionId: value.sectionId, title: value.title, updatedAt: value.updatedAt };
  // Older records identify only the section. A malformed anchor must not make
  // that valid section disappear from the library's continue-reading entry.
  if (Number.isSafeInteger(value.anchor) && value.anchor >= 0 && Number.isFinite(value.offset) && value.offset >= 0 && value.offset <= 1) {
    position.anchor = value.anchor; position.offset = value.offset;
  }
  if (["source", "punctuated"].includes(value.punctuation)) position.punctuation = value.punctuation;
  if (identity(value.blockId) && Number.isSafeInteger(value.blockAnchor) && value.blockAnchor >= 0) {
    position.blockId = value.blockId; position.blockAnchor = value.blockAnchor;
  }
  return position;
}

export function textReadingTarget(reading, { requested = "", saved = null, resume = false, footnote = "" } = {}) {
  const originalSaved = saved;
  // This frozen edition formerly put all 284 source paragraphs in section-002.
  // Its new reading segments preserve those blocks; recover old DOM anchors
  // only for the exact old layout, never for a guessed chapter or another book.
  if (saved && !saved.blockId && saved.sectionId === "section-002" && Number.isSafeInteger(saved.anchor) &&
      reading.book_id === "ziping-zhenquan" && reading.version_id === "reading-20261022-1a356195") {
    const segments = reading.sections.filter(section => section.source_chapter_id === "section-002" &&
      (section.id === "section-002" || section.id.startsWith("section-002-source-0002-")));
    if (segments.length > 1) {
      const blocks = segments.flatMap(section => section.blocks.map((block, anchor) => ({ section, block, anchor })));
      const target = blocks.length === 284 && blocks[saved.anchor];
      if (target) saved = { ...saved, sectionId: target.section.id, title: target.section.title, anchor: target.anchor,
        blockId: target.block.id, blockAnchor: 0 };
    }
  }
  if (saved?.blockId) {
    const target = reading.sections.find(section => section.blocks?.some(block => block.id === saved.blockId));
    if (target) saved = { ...saved, sectionId: target.id, title: target.title };
  }
  const destination = resume && !footnote && requested === originalSaved?.sectionId ? saved?.sectionId : requested;
  let index = selectReadingSection(reading, destination || saved?.sectionId);
  if (!requested && index < 0) index = selectReadingSection(reading, null);
  const section = reading.sections[index];
  // Explicit contents, pagination and footnote links are destinations, while a
  // continue-reading link (or an edition without a chapter) resumes its anchor.
  const position = section && saved?.sectionId === section.id && (!requested || resume) && !footnote ? saved : null;
  return { index, position };
}

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
    punctuation: value.punctuation === "source" ? "source" : "punctuated",
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
