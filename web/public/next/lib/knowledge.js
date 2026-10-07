// 知识馆的公开查询参数与请求生命周期；书目、条目和出处均来自服务端。
import { get, query } from "./api.js?v=n19";

export const KNOWLEDGE_KINDS = [["", "全部"], ["book", "书籍"], ["case", "案例"], ["term", "名词"]];
export const KNOWLEDGE_SYSTEMS = [["", "全部体系"], ["bazi", "八字"], ["liuyao", "六爻"], ["general", "通用"]];
export const KNOWLEDGE_PAGE_SIZE = 24;

export function readKnowledgeQuery(params = new URLSearchParams()) {
  const kind = params.get("kind") || "";
  const system = params.get("system") || "";
  const offset = Number(params.get("offset"));
  return {
    kind: KNOWLEDGE_KINDS.some(([value]) => value === kind) ? kind : "",
    system: KNOWLEDGE_SYSTEMS.some(([value]) => value === system) ? system : "",
    q: (params.get("q") || "").trim().slice(0, 160),
    book_id: (params.get("book_id") || "").trim(),
    offset: Number.isSafeInteger(offset) && offset >= 0 ? offset : 0,
  };
}

export function knowledgeListPath(filter, changes = {}) {
  const next = readKnowledgeQuery(new URLSearchParams({ ...filter, ...changes }));
  return `/knowledge${query({ ...next, offset: next.offset || undefined })}`;
}

export const knowledgeEntryPath = id => `/knowledge/${encodeURIComponent(id)}`;
export const knowledgeKindLabel = kind => KNOWLEDGE_KINDS.find(([value]) => value === kind)?.[1] || "知识";
export const knowledgeSystemLabel = system => KNOWLEDGE_SYSTEMS.find(([value]) => value === system)?.[1] || "";

export function sourceLocation(source) {
  const start = source.page_start;
  const end = source.page_end;
  const page = Number.isInteger(start) && start > 0
    ? `来源页码 ${start}${Number.isInteger(end) && end > start ? `–${end}` : ""}`
    : "";
  return [source.chapter, page, source.location_note].filter(Boolean).join(" · ");
}

// 即使底层请求已返回到不可取消的阶段，序号仍保证旧结果不能覆盖新页面。
export function createKnowledgeLoader(publish, request = get) {
  let sequence = 0;
  let controller = null;
  let stopped = false;
  return {
    async load(path) {
      if (stopped) return;
      const current = ++sequence;
      controller?.abort();
      controller = new AbortController();
      publish({ phase: "loading" });
      try {
        const data = await request(path, { signal: controller.signal });
        if (!stopped && current === sequence) publish({ phase: "ready", data });
      } catch (error) {
        if (!stopped && current === sequence && error?.name !== "AbortError") publish({ phase: "error", error });
      }
    },
    destroy() {
      stopped = true;
      sequence += 1;
      controller?.abort();
    },
  };
}

export function knowledgeApiPath(filter) {
  return `/api/knowledge${query({ ...readKnowledgeQuery(new URLSearchParams(filter)), limit: KNOWLEDGE_PAGE_SIZE })}`;
}
