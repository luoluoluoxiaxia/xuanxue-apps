// 消息：谁赞了、评论了、回复了或采纳了你的内容。
// 按北京时间分成「今天 / 昨天 / 更早」；同一页内同一卦帖的赞合并成一条；点开后标记已读并跳到对应评论。
// 从卦帖返回时先用上次的列表秒开并回到原位置，再静默拉取最新；再点一次底栏「消息」可手动刷新。
import { h, on, reducedMotion } from "../lib/dom.js?v=n1";
import { icon } from "../lib/icons.js?v=n1";
import { get, post, query } from "../lib/api.js?v=n1";
import { session, inbox, refreshSession } from "../lib/store.js?v=n1";
import { relativeTime, fullTime, count } from "../lib/format.js?v=n1";
import { avatar, stateView } from "../ui/bits.js?v=n1";
import { confirmDialog } from "../ui/overlay.js?v=n1";
import { toast } from "../ui/toast.js?v=n1";

const PAGE_LIMIT = 30;
const READ_BATCH = 100;
const SNAPSHOT_TTL = 15 * 60 * 1000;
const COMMENT_KINDS = ["post_comment", "comment_reply", "followed_post_comment"];
const FILTERS = [
  { key: "all", label: "全部", empty: "" },
  { key: "comment", label: "回复与评论", kinds: COMMENT_KINDS, empty: "回复与评论" },
  { key: "like", label: "赞", kinds: ["post_like"], empty: "赞" },
  { key: "accepted", label: "采纳", kinds: ["answer_accepted"], empty: "采纳" },
];
const KIND_STYLE = {
  post_like: { glyph: "heart", tone: "like" },
  comment_reply: { glyph: "reply", tone: "reply" },
  answer_accepted: { glyph: "award", tone: "accept" },
  post_comment: { glyph: "comment", tone: "comment" },
  followed_post_comment: { glyph: "bookmark", tone: "comment" },
};

// 离开再回来时保留筛选项。
let lastFilter = "all";
// 上次加载的列表（只在内存里，按账户区分）与最后点开的一条。
let snapshot = null;
let lastOpened = null;
if (typeof document !== "undefined") document.addEventListener("xz:authchange", () => { snapshot = null; lastOpened = null; });

const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" });

function dayKey(value) {
  const date = value instanceof Date ? value : new Date(value || "");
  return Number.isNaN(date.getTime()) ? "" : dayFormat.format(date);
}

function bucketOf(value) {
  const key = dayKey(value);
  if (key && key === dayKey(new Date())) return "今天";
  if (key && key === dayKey(new Date(Date.now() - 24 * 60 * 60 * 1000))) return "昨天";
  return "更早";
}

// 同一页里同一卦帖的多条「赞」合并展示，已读状态以其中任一未读为准。
function groupPage(items) {
  const entries = [];
  const likes = new Map();
  items.forEach(item => {
    const id = Number(item.id);
    const actor = String(item.actor_name || "").trim() || "卦友";
    const unread = !item.read_at;
    if (item.kind !== "post_like") {
      entries.push({ ...item, key: `n${id}`, ids: [id], actors: [actor], total: 1, unread, unreadCount: unread ? 1 : 0 });
      return;
    }
    const groupKey = String(item.post_slug || item.target_url || item.id);
    const existing = likes.get(groupKey);
    if (existing) {
      existing.ids.push(id);
      existing.total += 1;
      if (!existing.actors.includes(actor)) existing.actors.push(actor);
      existing.unread = existing.unread || unread;
      existing.unreadCount += unread ? 1 : 0;
      return;
    }
    const entry = { ...item, key: `n${id}`, ids: [id], actors: [actor], total: 1, unread, unreadCount: unread ? 1 : 0 };
    likes.set(groupKey, entry);
    entries.push(entry);
  });
  return entries;
}

// 通知指向的卦帖：优先 post_slug，其次解析 target_url 里的 ?post= 与 target=。
function routeFor(entry) {
  let slug = String(entry.post_slug || "").trim();
  let target = entry.comment_id ? `comment-${entry.comment_id}` : "";
  if ((!slug || !target) && entry.target_url) {
    try {
      const url = new URL(entry.target_url, location.origin);
      const hashQuery = new URLSearchParams(url.hash.split("?")[1] || "");
      slug = slug || url.searchParams.get("post") || hashQuery.get("post") || (/\/community\/([^/?#]+)/.exec(url.pathname)?.[1] ?? "");
      target = target || url.searchParams.get("target") || hashQuery.get("target") || "";
    } catch (_) {}
  }
  if (!slug) return "";
  const safeTarget = /^comment-\d+$/.test(target) ? target : "";
  return `/post/${encodeURIComponent(decodeURIComponentSafe(slug))}${safeTarget ? `?target=${safeTarget}` : ""}`;
}

function decodeURIComponentSafe(value) {
  try { return decodeURIComponent(value); } catch (_) { return value; }
}

function skeletonRows(n = 5) {
  return h("div", { class: "ib-skeleton", "aria-hidden": "true" },
    Array.from({ length: n }, (_, index) => h("div", { class: "ib-skel-row" },
      h("span", { class: "skel skel-circle", style: { width: "40px", height: "40px" } }),
      h("span", { class: "ib-skel-lines" },
        h("span", { class: "skel skel-line", style: { width: `${[62, 48, 70, 54, 66][index % 5]}%` } }),
        h("span", { class: "skel skel-line", style: { width: `${[86, 72, 80, 90, 64][index % 5]}%`, marginTop: "10px" } }),
        h("span", { class: "skel skel-line", style: { width: "38%", marginTop: "10px", height: "10px" } })))));
}

function anonView(ctx) {
  const reason = "登录后查看谁赞了、评论了或回复了你的卦帖。";
  return h("section", { class: "ib-anon" },
    h("div", { class: "ib-anon-mark", "aria-hidden": "true" }, icon("bell")),
    h("h1", { class: "ib-anon-title" }, "登录后查看消息"),
    h("p", { class: "ib-anon-text" }, reason),
    h("ul", { class: "ib-anon-list" },
      h("li", null, h("span", { class: "ib-kind is-like", "aria-hidden": "true" }, icon("heart")), h("span", null, h("b", null, "赞"), "有人认同你的卦帖")),
      h("li", null, h("span", { class: "ib-kind is-reply", "aria-hidden": "true" }, icon("reply")), h("span", null, h("b", null, "评论与回复"), "卦友的判断和追问")),
      h("li", null, h("span", { class: "ib-kind is-accept", "aria-hidden": "true" }, icon("award")), h("span", null, h("b", null, "采纳"), "你的回答帮到了人"))),
    h("div", { class: "ib-anon-actions" },
      h("button", { type: "button", class: "btn btn-primary btn-lg", onClick: () => ctx.openAuth({ reason }) }, icon("user"), "登录 / 注册"),
      h("a", { class: "btn btn-ghost btn-lg", href: "#/" }, "先去广场看看")));
}

export function render(ctx) {
  const root = h("div", { class: "ib-page" });
  const state = {
    entries: [],
    summary: null,
    cursor: null,
    loaded: false,
    loading: false,
    refreshing: false,
    error: null,
    moreError: null,
    requestId: 0,
    filter: FILTERS.some(item => item.key === lastFilter) ? lastFilter : "all",
  };
  let marking = false;

  // 「全部已读」用 aria-disabled 而不是 disabled：点完后焦点仍停在按钮上，不会丢到页面顶端。
  const markAllButton = h("button", { type: "button", class: "btn btn-soft btn-sm ib-markall", "aria-disabled": "true" }, icon("check"), "全部已读");
  const summaryNode = h("div", { class: "ib-summary" });
  const filterNode = h("div", { class: "ib-filters", role: "tablist", "aria-label": "消息类型" });
  const listNode = h("div", { class: "ib-list", "aria-live": "polite", "aria-busy": "false" });
  const moreNode = h("div", { class: "ib-more" });
  const liveNote = h("p", { class: "sr-only", role: "status" });

  const header = h("header", { class: "ib-head" },
    h("div", null,
      h("h1", { class: "ib-title" }, "消息"),
      h("p", { class: "ib-sub" }, "赞、评论与回复")),
    markAllButton);

  function paintShell() {
    root.replaceChildren(header, summaryNode, filterNode, listNode, moreNode, liveNote);
  }

  function saveSnapshot() {
    const user = session.get().user?.id;
    if (!user || !state.loaded || state.error) return;
    snapshot = { user, entries: state.entries, summary: state.summary, cursor: state.cursor, at: Date.now() };
  }

  const unreadTotal = () => Math.max(0, Number(state.summary?.unread_count) || 0);

  /* ---------- 汇总与筛选 ---------- */
  function paintSummary() {
    const loaded = !!state.summary;
    const summary = state.summary || {};
    const unread = unreadTotal();
    if (!marking) markAllButton.setAttribute("aria-disabled", String(!unread));
    markAllButton.hidden = !loaded;
    summaryNode.hidden = !loaded && !!state.error;
    filterNode.hidden = !loaded && !!state.error;
    const tile = (key, glyph, value, label, filter) => h("button", {
      type: "button",
      class: ["ib-tile", `is-${key}`],
      onClick: () => {
        if (key === "unread") {
          setFilter("all");
          requestAnimationFrame(() => {
            const first = listNode.querySelector(".ib-item.is-unread");
            if (first) {
              first.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
              first.focus({ preventScroll: true });
            } else {
              toast("没有未读消息");
            }
          });
        } else {
          setFilter(filter);
        }
      },
    },
    h("span", { class: "ib-tile-icon", "aria-hidden": "true" }, icon(glyph)),
    loaded ? h("b", { class: "tnum" }, count(value)) : h("span", { class: "skel skel-line ib-tile-skel", "aria-hidden": "true" }),
    h("span", null, label));
    summaryNode.replaceChildren(
      tile("like", "heart", summary.received_like_count, "收到的赞", "like"),
      tile("comment", "comment", summary.received_comment_count, "评论与回复", "comment"),
      tile("unread", "bell", unread, "未读消息", "all"));
  }

  function paintFilters() {
    const hadFocus = filterNode.contains(document.activeElement);
    filterNode.replaceChildren(...FILTERS.map(item => {
      const unread = state.entries.filter(entry => entry.unread && matches(entry, item)).length;
      return h("button", {
        type: "button",
        role: "tab",
        class: "pill-filter ib-filter",
        "aria-selected": String(state.filter === item.key),
        tabindex: state.filter === item.key ? "0" : "-1",
        "data-filter": item.key,
        onClick: () => setFilter(item.key),
      }, item.label, unread && item.key !== "all" ? h("span", { class: "ib-filter-count tnum", "aria-label": `${unread} 条未读` }, String(unread)) : null);
    }));
    if (hadFocus) filterNode.querySelector(`[data-filter="${state.filter}"]`)?.focus({ preventScroll: true });
  }

  filterNode.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = FILTERS.findIndex(item => item.key === state.filter);
    const next = event.key === "Home" ? 0
      : event.key === "End" ? FILTERS.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + FILTERS.length) % FILTERS.length;
    setFilter(FILTERS[next].key);
    filterNode.querySelector(`[data-filter="${FILTERS[next].key}"]`)?.focus();
  });

  function matches(entry, filter) {
    return !filter.kinds || filter.kinds.includes(entry.kind);
  }

  function setFilter(key) {
    if (state.filter === key) return;
    state.filter = key;
    lastFilter = key;
    paintFilters();
    paintList();
  }

  /* ---------- 列表 ---------- */
  function itemNode(entry) {
    const style = KIND_STYLE[entry.kind] || { glyph: "bell", tone: "comment" };
    const grouped = entry.kind === "post_like" && entry.total > 1;
    const route = routeFor(entry);
    const actor = entry.actors[0] || "卦友";
    const title = grouped
      ? h("span", { class: "ib-item-title" }, h("b", null, `${entry.total} 位卦友`), "赞了你的卦帖")
      : h("span", { class: "ib-item-title" }, h("b", null, String(entry.actor_name || "").trim() || "有位卦友"), entry.kind_label || "与你互动了");
    const excerpt = String(entry.body_excerpt || "").trim();
    return h(route ? "a" : "div", {
      class: ["ib-item", entry.unread && "is-unread", `is-${style.tone}`],
      href: route ? `#${route}` : null,
      role: route ? null : "button",
      tabindex: route ? null : "0",
      "data-key": entry.key,
    },
    h("span", { class: "ib-who" },
      grouped ? h("span", { class: "ib-like-tile", "aria-hidden": "true" }, icon("heart")) : avatar(actor),
      grouped ? null : h("span", { class: ["ib-kind", `is-${style.tone}`], "aria-hidden": "true" }, icon(style.glyph))),
    h("span", { class: "ib-main" },
      h("span", { class: "ib-line" },
        title,
        h("time", { datetime: entry.created_at || "", title: fullTime(entry.created_at) }, relativeTime(entry.created_at)),
        entry.unread ? h("span", { class: "ib-dot" }, h("span", { class: "sr-only" }, "未读")) : null),
      grouped
        ? h("span", { class: "ib-actors" },
          h("span", { class: "ib-stack", "aria-hidden": "true" }, entry.actors.slice(0, 5).map(name => avatar(name, "sm"))),
          h("span", null, `${entry.actors.slice(0, 3).join("、")}${entry.actors.length > 3 ? " 等" : ""}`))
        : null,
      excerpt ? h("span", { class: "ib-excerpt" }, h("span", null, excerpt)) : null,
      h("span", { class: "ib-post" }, icon("feather", "icon-sm"), h("span", null, entry.post_title || "相关卦帖"))));
  }

  function paintList() {
    listNode.setAttribute("aria-busy", "false");
    if (state.error && !state.entries.length) {
      listNode.replaceChildren(stateView({
        tone: "error",
        title: "消息加载失败",
        text: state.error?.message || "消息加载失败",
        actions: [h("button", { type: "button", class: "btn btn-soft", onClick: () => load({ reset: true }) }, icon("refresh"), "重新加载")],
      }));
      paintMore();
      return;
    }
    if (!state.loaded) {
      listNode.replaceChildren(skeletonRows());
      return;
    }
    if (!state.entries.length) {
      listNode.replaceChildren(stateView({
        glyph: "bell",
        title: "暂无新互动",
        text: "有人赞了、评论或回复你的卦帖时，会第一时间出现在这里。发个问题，卦友会来帮你看。",
        actions: [
          h("a", { class: "btn btn-soft", href: "#/ask" }, icon("plus"), "发起提问"),
          h("a", { class: "btn btn-ghost", href: "#/" }, icon("plaza"), "去广场看看"),
        ],
      }));
      paintMore();
      return;
    }
    const filter = FILTERS.find(item => item.key === state.filter) || FILTERS[0];
    const visible = state.entries.filter(entry => matches(entry, filter));
    if (!visible.length) {
      listNode.replaceChildren(h("div", { class: "ib-filter-empty" },
        icon(filter.key === "like" ? "heart" : filter.key === "accepted" ? "award" : "comment"),
        h("p", null, state.cursor ? `已加载的消息里还没有「${filter.empty}」。` : `还没有「${filter.empty}」消息。`)));
      paintMore();
      return;
    }
    const groups = [];
    visible.forEach(entry => {
      const bucket = bucketOf(entry.created_at);
      const last = groups[groups.length - 1];
      if (last && last.label === bucket) last.items.push(entry);
      else groups.push({ label: bucket, items: [entry] });
    });
    // 重绘会替换节点：焦点在某一条上时，重绘后还给同一条。
    const focusedKey = listNode.contains(document.activeElement) ? document.activeElement.closest(".ib-item")?.dataset.key : "";
    listNode.replaceChildren(...groups.map(group => h("section", { class: "ib-group", "aria-label": group.label },
      h("h2", { class: "ib-group-title" }, group.label),
      h("div", { class: "ib-group-list" }, group.items.map(itemNode)))));
    if (focusedKey) listNode.querySelector(`[data-key="${focusedKey}"]`)?.focus({ preventScroll: true });
    paintMore();
  }

  // 列表整体重绘时，让视口里的那一条停在原位（新消息插在上方也不跳）。
  function keepPlace(paint) {
    const topbar = document.querySelector(".topbar")?.getBoundingClientRect().bottom || 0;
    const anchor = window.scrollY > 0
      ? Array.from(listNode.querySelectorAll(".ib-item")).find(node => node.getBoundingClientRect().bottom > topbar + 8)
      : null;
    const key = anchor?.dataset.key;
    const before = anchor?.getBoundingClientRect().top;
    paint();
    const after = key ? listNode.querySelector(`[data-key="${key}"]`)?.getBoundingClientRect().top : undefined;
    if (typeof after === "number" && typeof before === "number" && Math.abs(after - before) > 1) window.scrollBy(0, after - before);
  }

  function paintMore() {
    if (!state.entries.length && !state.cursor) {
      moreNode.replaceChildren();
      return;
    }
    if (state.loading && state.entries.length) {
      moreNode.replaceChildren(h("div", { class: "ib-more-status", role: "status" }, h("span", { class: "spinner", "aria-hidden": "true" }), "正在加载更多…"));
      return;
    }
    if (state.moreError) {
      moreNode.replaceChildren(h("div", { class: "ib-more-status", role: "alert" },
        h("span", null, state.moreError.message || "加载失败"),
        h("button", { type: "button", class: "btn btn-soft btn-sm", onClick: () => load() }, icon("refresh"), "重试")));
      return;
    }
    if (state.cursor) {
      moreNode.replaceChildren(h("button", { type: "button", class: "btn btn-ghost ib-more-btn", onClick: () => load() }, "加载更多", icon("chevronDown")));
      return;
    }
    if (state.entries.length > 4) moreNode.replaceChildren(h("p", { class: "ib-end" }, "没有更早的消息了"));
    else moreNode.replaceChildren();
  }

  /* ---------- 数据 ---------- */
  function applySummary(summary) {
    if (!summary) return;
    state.summary = summary;
    inbox.set({ unread: unreadTotal(), loaded: true });
    paintSummary();
  }

  async function load({ reset = false } = {}) {
    if (state.loading && !reset) return;
    const requestId = ++state.requestId;
    // 用键盘点「加载更多」时，加载完把焦点交给新出现的第一条。
    const keepFocus = !reset && moreNode.contains(document.activeElement);
    state.loading = true;
    state.moreError = null;
    if (reset) {
      state.entries = [];
      state.cursor = null;
      state.loaded = false;
      state.error = null;
      listNode.setAttribute("aria-busy", "true");
      paintList();
    }
    paintMore();
    try {
      const data = await get(`/api/community/notifications${query({ limit: PAGE_LIMIT, before_id: reset ? "" : state.cursor })}`, { cache: "no-store" });
      if (!ctx.isCurrent() || requestId !== state.requestId) return;
      const items = Array.isArray(data?.items) ? data.items : [];
      const known = new Set(state.entries.flatMap(entry => entry.ids));
      const added = groupPage(items.filter(item => !known.has(Number(item.id))));
      state.entries.push(...added);
      state.cursor = data?.next_cursor ? Number(data.next_cursor) || null : null;
      state.loaded = true;
      state.error = null;
      state.loading = false;
      applySummary(data?.summary);
      paintFilters();
      paintList();
      saveSnapshot();
      if (keepFocus) {
        const target = added.map(entry => listNode.querySelector(`[data-key="${entry.key}"]`)).find(Boolean)
          || moreNode.querySelector("button") || listNode;
        if (target === listNode) listNode.setAttribute("tabindex", "-1");
        target.focus({ preventScroll: false });
      }
    } catch (error) {
      if (!ctx.isCurrent() || requestId !== state.requestId) return;
      state.loading = false;
      if (error?.status === 401) refreshSession().catch(() => {});
      if (state.entries.length) state.moreError = error;
      else {
        state.error = error;
        state.loaded = true;
      }
      paintSummary();
      paintList();
    }
  }

  // 静默拉取第一页：新消息插到最前，已有条目同步已读状态；手动刷新（announce）时给出反馈。
  async function refreshTop({ announce = false } = {}) {
    if (state.loading || state.refreshing || !state.loaded || state.error) {
      if (announce && state.error && !state.loading) load({ reset: true });
      return;
    }
    const requestId = state.requestId;
    state.refreshing = true;
    if (announce) {
      listNode.classList.add("is-refreshing");
      listNode.setAttribute("aria-busy", "true");
    }
    try {
      const data = await get(`/api/community/notifications${query({ limit: PAGE_LIMIT })}`, { cache: "no-store" });
      if (!ctx.isCurrent() || requestId !== state.requestId) return;
      const items = Array.isArray(data?.items) ? data.items : [];
      const byId = new Map(items.map(item => [Number(item.id), item]));
      const known = new Set(state.entries.flatMap(entry => entry.ids));
      const overlaps = items.some(item => known.has(Number(item.id)));
      const added = groupPage(items.filter(item => !known.has(Number(item.id))));
      if (!overlaps && state.entries.length && items.length) {
        // 离开太久、新消息超过一页：直接换成最新一页，避免中间缺一段。
        state.entries = added;
        state.cursor = data?.next_cursor ? Number(data.next_cursor) || null : null;
      } else {
        state.entries.forEach(entry => {
          const fresh = entry.ids.map(id => byId.get(id));
          if (fresh.every(Boolean)) {
            entry.unreadCount = fresh.filter(item => !item.read_at).length;
            entry.unread = entry.unreadCount > 0;
          }
        });
        state.entries.unshift(...added);
      }
      applySummary(data?.summary);
      paintFilters();
      keepPlace(paintList);
      saveSnapshot();
      if (announce) {
        if (added.length) liveNote.textContent = `有 ${added.length} 条新消息`;
        else toast("暂无新消息");
      }
    } catch (error) {
      if (!ctx.isCurrent()) return;
      if (error?.status === 401) refreshSession().catch(() => {});
      if (announce) toast(error?.message || "刷新失败，请稍后再试", { type: "error" });
    } finally {
      state.refreshing = false;
      if (ctx.isCurrent()) {
        listNode.classList.remove("is-refreshing");
        listNode.setAttribute("aria-busy", "false");
      }
    }
  }

  function syncEntryNodes(entry) {
    listNode.querySelectorAll(`[data-key="${entry.key}"]`).forEach(node => {
      node.classList.toggle("is-unread", entry.unread);
      if (!entry.unread) node.querySelector(".ib-dot")?.remove();
    });
  }

  function setUnreadCount(value) {
    if (!state.summary) return;
    state.summary.unread_count = Math.max(0, Number(value) || 0);
    inbox.set({ unread: unreadTotal(), loaded: true });
  }

  // 乐观标记已读：先更新界面与角标，请求失败再恢复原状。
  async function markRead(entry) {
    if (!entry?.unread) return;
    const ids = entry.ids.filter(Number.isFinite).slice(0, READ_BATCH);
    const previous = { unread: entry.unread, unreadCount: entry.unreadCount, total: unreadTotal() };
    entry.unread = false;
    entry.unreadCount = 0;
    setUnreadCount(previous.total - Math.max(1, previous.unreadCount || 0));
    if (ctx.isCurrent()) {
      syncEntryNodes(entry);
      paintSummary();
      paintFilters();
    }
    try {
      const result = await post("/api/community/notifications/read", { ids, mark_all: false });
      if (typeof result?.unread_count === "number") setUnreadCount(result.unread_count);
    } catch (error) {
      entry.unread = previous.unread;
      entry.unreadCount = previous.unreadCount;
      setUnreadCount(previous.total);
      if (error?.status === 401) refreshSession().catch(() => {});
      if (ctx.isCurrent()) {
        syncEntryNodes(entry);
        paintFilters();
        toast("消息状态没有更新，请稍后再试", { type: "error" });
      }
    } finally {
      ctx.refreshInbox();
      if (ctx.isCurrent()) paintSummary();
    }
  }

  markAllButton.addEventListener("click", async () => {
    if (marking || markAllButton.getAttribute("aria-disabled") === "true") return;
    const unread = unreadTotal();
    // 标为已读后无法恢复为未读：先确认一次。
    const ok = await confirmDialog({
      title: "全部标为已读？",
      message: `${unread} 条未读消息会全部标为已读，之后不能再恢复为未读。`,
      confirmText: "全部已读",
    });
    if (!ok || !ctx.isCurrent()) return;
    marking = true;
    markAllButton.setAttribute("aria-busy", "true");
    markAllButton.classList.add("is-busy");
    markAllButton.replaceChildren(h("span", { class: "spinner", "aria-hidden": "true" }), "正在标记…");
    try {
      const result = await post("/api/community/notifications/read", { ids: [], mark_all: true });
      if (!ctx.isCurrent()) return;
      state.entries.forEach(entry => {
        entry.unread = false;
        entry.unreadCount = 0;
        syncEntryNodes(entry);
      });
      state.summary = { ...(state.summary || {}), unread_count: Number(result?.unread_count) || 0 };
      ctx.refreshInbox();
      saveSnapshot();
      toast(`已将 ${unread} 条消息标为已读`, { type: "ok" });
    } catch (error) {
      if (!ctx.isCurrent()) return;
      if (error?.status === 401) refreshSession().catch(() => {});
      toast(error?.message || "消息状态更新失败", { type: "error" });
    } finally {
      marking = false;
      if (ctx.isCurrent()) {
        markAllButton.removeAttribute("aria-busy");
        markAllButton.classList.remove("is-busy");
        markAllButton.replaceChildren(icon("check"), "全部已读");
        paintSummary();
        paintFilters();
      }
    }
  });

  // 点开消息：立即进入卦帖并定位到评论，已读在后台同步（失败会恢复未读）。
  on(listNode, "click", ".ib-item", (event, node) => {
    const entry = state.entries.find(item => item.key === node.dataset.key);
    if (!entry) return;
    const modified = event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
    if (modified && node.tagName === "A") {
      markRead(entry);
      return;
    }
    event.preventDefault();
    const route = routeFor(entry);
    if (!route) {
      markRead(entry);
      toast("这条消息关联的卦帖已不存在");
      return;
    }
    lastOpened = { key: entry.key, keyboard: event.detail === 0 };
    saveSnapshot();
    markRead(entry);
    ctx.navigate(route);
  });
  on(listNode, "keydown", "div.ib-item", (event, node) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      node.click();
    }
  });

  /* ---------- 登录状态 ---------- */
  let lastAuth = null;
  function sync() {
    const current = session.get();
    if (!current.ready) {
      root.replaceChildren(header, h("div", { class: "ib-list" }, skeletonRows(4)));
      markAllButton.setAttribute("aria-disabled", "true");
      return;
    }
    if (current.authenticated === lastAuth) return;
    lastAuth = current.authenticated;
    state.requestId += 1;
    if (!current.authenticated) {
      snapshot = null;
      state.entries = [];
      state.summary = null;
      state.loading = false;
      root.replaceChildren(anonView(ctx));
      return;
    }
    paintShell();
    const saved = snapshot;
    if (saved && saved.user === current.user?.id && Date.now() - saved.at < SNAPSHOT_TTL) {
      // 回到消息页：先用上次的列表（位置可以立即恢复），再静默拉取最新。
      Object.assign(state, { entries: saved.entries, summary: saved.summary, cursor: saved.cursor, loaded: true, error: null });
      paintSummary();
      paintFilters();
      paintList();
      refreshTop();
      return;
    }
    paintSummary();
    paintFilters();
    load({ reset: true });
  }
  // 断线恢复：网络恢复后自动重试失败的加载。
  const recover = () => {
    if (!ctx.isCurrent() || !session.get().authenticated || state.loading) return;
    if (state.error && !state.entries.length) load({ reset: true });
    else if (state.moreError) load();
  };
  window.addEventListener("online", recover);
  ctx.cleanup(() => window.removeEventListener("online", recover));
  // 已在顶部时再点一次底栏「消息」：拉取最新。
  ctx.onRefresh(() => {
    if (session.get().authenticated) refreshTop({ announce: true });
  });

  sync();
  ctx.subscribe(session, sync);

  return {
    node: root,
    title: "消息",
    // 浏览器返回到这里：键盘用户的焦点回到刚才点开的那一条。
    onRestore() {
      const opened = lastOpened;
      lastOpened = null;
      if (!opened?.keyboard) return;
      listNode.querySelector(`[data-key="${opened.key}"]`)?.focus({ preventScroll: true });
    },
  };
}
