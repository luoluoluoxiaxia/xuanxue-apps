// 案例仅展示公开契约返回的内容，阅读链接始终由服务端指定底本与章节。
import { query } from "./api.js?v=n36";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const slug = value => typeof value === "string" && value.length <= 120 && SLUG.test(value) ? value : "";
export const BOOK_CASE_KINDS = Object.freeze({ named_case: "具名案例", unnamed_case: "未具名案例",
  hypothetical: "假设推演", rule_example: "规则条目" });
const integer = (value, fallback, max = Number.MAX_SAFE_INTEGER) => {
  const number = Number(value);
  return value !== null && value !== "" && Number.isSafeInteger(number) && number >= 0 && number <= max ? number : fallback;
};

export function readBookCaseQuery(params = new URLSearchParams()) {
  return {
    book_id: slug(params.get("book_id")),
    kind: Object.hasOwn(BOOK_CASE_KINDS, params.get("kind")) ? params.get("kind") : "",
    offset: integer(params.get("offset"), 0),
    limit: Math.max(1, integer(params.get("limit"), 24, 60)),
    from: params.get("from") === "learning" ? "learning" : "",
  };
}

export function bookCaseListPath(filter = {}, changes = {}) {
  const next = readBookCaseQuery(new URLSearchParams({ ...filter, ...changes }));
  return `/book-cases${query({ book_id: next.book_id, kind: next.kind, offset: next.offset || undefined,
    limit: next.limit === 24 ? undefined : next.limit, from: next.from })}`;
}

export function bookCaseDetailPath(id, filter = {}) {
  return `/book-cases/${encodeURIComponent(id)}${bookCaseListPath(filter).slice("/book-cases".length)}`;
}

export function bookCaseApiPath(filter) {
  const next = readBookCaseQuery(new URLSearchParams(filter));
  return `/api/book-cases${query({ book_id: next.book_id, kind: next.kind, offset: next.offset, limit: next.limit })}`;
}

export function bookCasesEntry(book, from = "") {
  return Number.isInteger(book?.case_count) && book.case_count > 0 && slug(book.id)
    ? bookCaseListPath({ book_id: book.id, from }) : null;
}

export function bookCaseReadingPath(path, from = "", bookId = "") {
  if (typeof path !== "string" || path.length > 400) return null;
  const match = path.match(/^\/books\/([a-z0-9]+(?:-[a-z0-9]+)*)\?(?:page=[1-9][0-9]*|text-version=([a-z0-9]+(?:-[a-z0-9]+)*)&chapter=[a-z0-9]+(?:-[a-z0-9]+)*)$/);
  if (!match || (bookId && match[1] !== slug(bookId))) return null;
  if (["current", "latest"].includes(match[2])) return null;
  return `${path}${from === "learning" ? "&from=learning" : ""}`;
}

export const bookCaseKindLabel = kind => Object.hasOwn(BOOK_CASE_KINDS, kind) ? BOOK_CASE_KINDS[kind] : "学习条目";
