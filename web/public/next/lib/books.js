// 页码来自服务端目录；只保存本机阅读进度，不修改书籍文字。
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
  const needle = query.trim().toLocaleLowerCase();
  return books.filter(book => (!system || book.system === system) &&
    (!needle || `${book.title} ${book.source_label}`.toLocaleLowerCase().includes(needle)));
}
