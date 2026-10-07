// 广场：社区问题流。桌面三栏（话题 / 问题流 / 今日与等你来答），手机单栏 + 话题横滑。
import { h, fill, on, whenVisible, reducedMotion } from "../lib/dom.js?v=n19";
import { icon } from "../lib/icons.js?v=n19";
import { get, post, query, prefetch, invalidateCached } from "../lib/api.js?v=n19";
import { session, local } from "../lib/store.js?v=n19";
import { relativeTime, count } from "../lib/format.js?v=n19";
import { errorView, stateView, skeletonCard } from "../ui/bits.js?v=n19";
import { guaToken, pillarsToken } from "../ui/gua.js?v=n19";
import { toast } from "../ui/toast.js?v=n19";

export const TOPICS = [
  ["", "全部话题", "compass"],
  ["career", "事业工作", "layers"],
  ["relationship", "感情关系", "heart"],
  ["wealth", "财运投资", "coins"],
  ["contract", "合同合作", "feather"],
  ["exam", "考试求职", "award"],
  ["health", "健康疾病", "sparkle"],
  ["travel", "出行迁移", "pin"],
  ["lost", "失物寻人", "search"],
  ["other", "其他", "hash"],
];
const VIEWS = [["latest", "最新"], ["popular", "热门"], ["seeking", "等你来答"]];
const SYSTEMS = [["", "全部"], ["liuyao", "六爻"], ["bazi", "八字"]];
const PAGE = 12;
const FILTER_KEY = "xz-next-feed-filter";

// 离开广场再回来时直接用内存里的列表，保持滚动位置与已加载内容。
const cache = new Map();
const CACHE_MS = 4 * 60 * 1000;
// 停在广场时约每分钟看一眼有没有新帖子（只在页面可见时）。
const POLL_MS = 60 * 1000;
// 右栏、「等你来答」与脉搏数据：切换筛选或返回广场时直接复用，不再闪骨架、不挤动列表。
const side = { seeking: null, stats: null, today: null };
const SIDE_MS = 90 * 1000;
let todayPending = null;
// 帖子详情的短时缓存：按下或悬停卡片时预取，帖子页先用它秒开。
export const DETAIL_TTL = 60 * 1000;
export const detailPath = slug => `/api/community/posts/${encodeURIComponent(slug)}`;

// 切换筛选时把「控件位置 / 焦点」交给下一次渲染，列表换内容但页面不跳。
let pendingHandoff = null;

// 换账号后缓存里的点赞状态不再可信：其它筛选的列表下次打开时重新核对。
if (typeof document !== "undefined") {
  document.addEventListener?.("xz:authchange", () => {
    side.today = null;
    cache.forEach(state => { state.at = 0; });
  });
}

const fresh = (entry, ms) => !!entry && Date.now() - entry.at < ms;
const cssValue = value => (window.CSS?.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, "\\$&"));
const stamp = item => Date.parse(item?.published_at || item?.created_at || "") || 0;

// 同一问题可能跨页重复出现：按 slug 与规整后的问题去重，并跳过无意义的问题。
function normalizedQuestion(item) {
  return String(item?.question || item?.title || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function isJunkQuestion(question) {
  return question.length < 2 || /^[\d\s._-]+$/.test(question);
}

function cleanItems(raw, existing = []) {
  const slugs = new Set(existing.map(item => item.slug));
  const questions = new Set(existing.map(normalizedQuestion));
  const out = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const question = normalizedQuestion(item);
    if (!item?.slug || isJunkQuestion(question) || slugs.has(item.slug) || questions.has(question)) continue;
    slugs.add(item.slug);
    questions.add(question);
    out.push(item);
  }
  return out;
}

function filterKey(filter) {
  return `${filter.view}|${filter.system}|${filter.type}`;
}

function readFilter(queryParams) {
  const saved = local.json(FILTER_KEY, {}) || {};
  const view = queryParams.get("view") || saved.view || "latest";
  const system = queryParams.has("system") ? queryParams.get("system") : (saved.system || "");
  const type = queryParams.has("type") ? queryParams.get("type") : (saved.type || "");
  return {
    view: VIEWS.some(([key]) => key === view) ? view : "latest",
    system: SYSTEMS.some(([key]) => key === system) ? system : "",
    type: TOPICS.some(([key]) => key === type) ? type : "",
  };
}

// 顶栏（以及断网提示条）下沿：滚动定位时不让内容藏到吸顶栏后面。
export function stickyTop() {
  let bottom = 0;
  document.querySelectorAll(".topbar, .net-banner:not([hidden])").forEach(node => {
    bottom = Math.max(bottom, node.getBoundingClientRect().bottom);
  });
  return bottom;
}

// 帖子链接：按下、悬停或聚焦时预取详情，点开即可显示；普通点击走应用内导航，返回键能回到原处。
export function wirePostLinks(node, ctx, { beforeOpen } = {}) {
  const slugOf = target => {
    const holder = target instanceof Element ? target.closest('.post-card[data-slug], a[href^="#/post/"]') : null;
    if (!holder || !node.contains(holder)) return "";
    if (holder.dataset.slug) return holder.dataset.slug;
    try { return decodeURIComponent((holder.getAttribute("href") || "").slice("#/post/".length).split("?")[0]); } catch (_) { return ""; }
  };
  const warm = target => {
    const slug = slugOf(target);
    if (slug) prefetch(detailPath(slug), { ttl: DETAIL_TTL });
  };
  let hoverTimer = 0;
  let scrolledAt = 0;
  // 滚轮滚动时卡片会从静止的鼠标下划过：滚动中的「悬停」不算，避免一路预取。
  const onScroll = () => { scrolledAt = Date.now(); };
  window.addEventListener("scroll", onScroll, { passive: true });
  node.addEventListener("touchstart", event => warm(event.target), { passive: true });
  node.addEventListener("mousedown", event => warm(event.target));
  node.addEventListener("focusin", event => warm(event.target));
  const hoverWarm = target => {
    const wait = 250 - (Date.now() - scrolledAt);
    if (wait > 0) hoverTimer = setTimeout(() => hoverWarm(target), wait);
    else warm(target);
  };
  node.addEventListener("mouseover", event => {
    clearTimeout(hoverTimer);
    const target = event.target;
    hoverTimer = setTimeout(() => hoverWarm(target), 120);
  });
  node.addEventListener("mouseout", () => clearTimeout(hoverTimer));
  ctx.cleanup(() => {
    clearTimeout(hoverTimer);
    window.removeEventListener("scroll", onScroll);
  });
  on(node, "click", 'a[href^="#/post/"]', (event, link) => {
    if (event.defaultPrevented || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    beforeOpen?.();
    ctx.navigate(link.getAttribute("href"));
  });
}

export function postCard(item, { onLike } = {}) {
  const isHelp = item.post_kind === "help";
  const resolved = item.help_status === "resolved";
  const token = item.system === "bazi" ? pillarsToken(item.chart_summary) : guaToken(item.oracle_summary);
  const excerpt = String(item.answer_excerpt || "").trim();
  const href = `#/post/${encodeURIComponent(item.slug)}`;
  const like = h("button", {
    type: "button",
    class: ["react", item.viewer_liked && "is-on"],
    "aria-pressed": String(!!item.viewer_liked),
    "aria-label": `点赞，当前 ${item.like_count || 0}`,
    "data-like": item.slug,
  }, icon("heart"), h("span", { class: "tnum" }, count(item.like_count)));
  like.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    onLike?.(item, like);
  });
  return h("article", { class: ["post-card", isHelp && "is-help", resolved && "is-resolved"], "data-slug": item.slug },
    h("header", { class: "post-card-head" },
      h("span", { class: "post-card-author" }, item.author_name || "卦友"),
      h("span", { class: "dot", "aria-hidden": "true" }, "·"),
      h("time", { datetime: item.published_at || item.created_at, title: item.published_at || "" }, relativeTime(item.published_at || item.created_at)),
      h("span", { class: "post-card-tags" },
        h("span", { class: ["chip", item.system === "bazi" ? "chip-bazi" : "chip-liuyao"] }, item.system_label || (item.system === "bazi" ? "八字" : "六爻")),
        item.question_type_label ? h("span", { class: "chip" }, item.question_type_label) : null)),
    h("h3", { class: "post-card-title" }, h("a", { href, class: "post-card-link" }, item.question || item.title)),
    token || excerpt ? h("div", { class: "post-card-body" },
      token,
      excerpt ? h("p", { class: "post-card-excerpt" },
        h("span", { class: ["excerpt-mark", isHelp ? "is-people" : "is-ai"] }, isHelp ? "卦友" : "AI"),
        excerpt) : null) : null,
    h("footer", { class: "post-card-foot" },
      like,
      h("span", { class: "stat", title: "讨论", "data-stat": "comments" }, icon("comment"), h("span", { class: "tnum" }, count(item.comment_count)), h("span", { class: "sr-only" }, "条讨论")),
      h("span", { class: "stat", title: "看过的人数", "data-stat": "views" }, icon("eye"), h("span", { class: "tnum" }, count(item.viewer_count ?? item.view_count)), h("span", { class: "sr-only" }, "人看过")),
      h("span", { class: "post-card-status" },
        item.is_featured ? h("span", { class: "chip chip-gold" }, icon("award"), "精选") : null,
        isHelp ? h("span", { class: ["chip", resolved ? "chip-ok" : "chip-help"] }, resolved ? icon("check") : icon("hand"), item.help_status_label || (resolved ? "已解决" : "求助中")) : null)));
}

/* ---------- 点赞：乐观更新，失败回滚；同一帖子的所有点赞按钮同步 ---------- */
const liking = new Set();

function bump(button) {
  if (!button) return;
  button.classList.remove("is-bump");
  void button.offsetWidth;
  button.classList.add("is-bump");
}

function paintLike(button, item) {
  button.classList.toggle("is-on", !!item.viewer_liked);
  button.setAttribute("aria-pressed", String(!!item.viewer_liked));
  button.setAttribute("aria-label", `点赞，当前 ${item.like_count || 0}`);
  const label = button.querySelector(".tnum");
  if (label) label.textContent = count(item.like_count);
}

export function syncLikes(item, primary = null, { pop = false } = {}) {
  const buttons = new Set(primary ? [primary] : []);
  document.querySelectorAll("[data-like]").forEach(node => { if (node.dataset.like === item.slug) buttons.add(node); });
  buttons.forEach(button => {
    paintLike(button, item);
    if (pop && item.viewer_liked) bump(button);
  });
}

// 帖子页里的点赞、评论、采纳同步回广场缓存：返回列表时数字与状态是新的。
export function syncPost(slug, patch) {
  if (!slug || !patch) return;
  cache.forEach(state => state.items.forEach(item => { if (item.slug === slug) Object.assign(item, patch); }));
  (side.seeking?.items || []).forEach(item => { if (item.slug === slug) Object.assign(item, patch); });
}

export async function likePost(item, button) {
  if (!item?.slug || liking.has(item.slug)) return;
  if (item.viewer_liked) {
    bump(button);
    toast("已经赞过了");
    return;
  }
  liking.add(item.slug);
  const before = Number(item.like_count) || 0;
  item.viewer_liked = true;
  item.like_count = before + 1;
  syncLikes(item, button, { pop: true });
  try {
    const result = await post(`/api/community/posts/${encodeURIComponent(item.slug)}/like`, undefined, { interaction: true });
    if (result && typeof result.like_count === "number") item.like_count = result.like_count;
    item.viewer_liked = true;
    syncLikes(item, button);
    syncPost(item.slug, { viewer_liked: true, like_count: item.like_count });
    invalidateCached(detailPath(item.slug));
  } catch (error) {
    item.viewer_liked = false;
    item.like_count = before;
    syncLikes(item, button);
    toast(error.message || "点赞没有成功", { type: "error", action: { label: "重试", onClick: () => likePost(item, button) } });
  } finally {
    liking.delete(item.slug);
  }
}

function topicRail(filter, apply) {
  return h("nav", { class: "rail rail-left", "aria-label": "话题" },
    h("p", { class: "rail-label" }, "话题"),
    h("div", { class: "topic-list" },
      TOPICS.map(([key, label, glyph]) => h("button", {
        type: "button",
        class: "topic-item",
        "aria-pressed": String(filter.type === key),
        "data-filter": `rail-type:${key}`,
        onClick: event => apply({ type: key }, event.currentTarget),
      }, icon(glyph), h("span", null, label)))),
    h("p", { class: "rail-label" }, "盘法"),
    h("div", { class: "topic-list" },
      SYSTEMS.map(([key, label]) => h("button", {
        type: "button",
        class: "topic-item",
        "aria-pressed": String(filter.system === key),
        "data-filter": `rail-system:${key}`,
        onClick: event => apply({ system: key }, event.currentTarget),
      }, icon(key === "bazi" ? "pillars" : key === "liuyao" ? "gua" : "layers"), h("span", null, key ? label : "全部盘法")))));
}

// 每次页面加载只计一次访问。
let visitCounted = false;
function visitHeader() {
  if (visitCounted) return {};
  visitCounted = true;
  return { "X-Xuanshu-Visit": "web-v1" };
}

// shown()：列表还没载入时返回 undefined（右栏先留骨架），「等你来答」列表时返回 null（右栏这一块收起），
// 其余返回列表里已有帖子的 slug 集合，右栏只补列表里没有的求助。
function sideRail(ctx, { shown, onStats } = {}) {
  const rail = h("aside", { class: "rail rail-right", "aria-label": "社区动态" });
  const todayBox = h("section", { class: "side-card side-today" });
  const seekingList = h("div", { class: "side-seeking-list" });
  const seekingBox = h("section", { class: "side-card side-seeking" },
    h("div", { class: "side-head" }, h("h2", null, "等你来答"), h("a", { class: "link-btn", href: "#/square?view=seeking", "data-view-link": "seeking" }, "更多")),
    seekingList);
  const pulseGrid = h("div", { class: "pulse-grid" });
  const pulseBox = h("section", { class: "side-card side-pulse" }, h("div", { class: "side-head" }, h("h2", null, "社区脉搏")), pulseGrid);
  const rules = h("section", { class: "side-card side-rules" },
    h("div", { class: "side-head" }, h("h2", null, "讨论公约")),
    h("ol", { class: "rules" },
      h("li", null, h("b", null, "就盘论事"), h("span", null, "说依据，也说不确定的地方。")),
      h("li", null, h("b", null, "善意表达"), h("span", null, "对事不对人，不嘲讽、不恐吓。")),
      h("li", null, h("b", null, "保护隐私"), h("span", null, "不留联系方式，不晒他人信息。"))));
  const foot = h("footer", { class: "side-foot" },
    h("button", { type: "button", class: "link-btn", "data-open-feedback": "" }, "意见反馈"),
    h("p", null, "AI 解读仅供传统文化研究与娱乐参考，不替代医疗、法律、投资等专业意见。"));
  rail.append(todayBox, seekingBox, pulseBox, rules, foot);

  const paintToday = daily => {
    const suitable = Array.isArray(daily?.content?.suitable) ? daily.content.suitable : [];
    const avoid = Array.isArray(daily?.content?.avoid) ? daily.content.avoid : [];
    if (daily?.status !== "done" || (!suitable.length && !avoid.length)) {
      todayBox.replaceChildren(
        h("h2", null, "今日宜忌"),
        h("p", null, "按你的命盘生成，每天更新。"),
        h("a", { class: "btn btn-soft btn-sm", href: "#/today" }, "查看今日", icon("arrowRight")));
      return;
    }
    fill(todayBox,
      h("h2", null, `今日 · ${[daily.date_label, daily.weekday_label].filter(Boolean).join(" ")}`),
      suitable.length ? h("p", { class: "side-today-line" }, h("b", { class: "yi" }, "宜"), suitable.slice(0, 3).join("、")) : null,
      avoid.length ? h("p", { class: "side-today-line" }, h("b", { class: "ji" }, "忌"), avoid.slice(0, 2).join("、")) : null,
      h("a", { class: "btn btn-soft btn-sm", href: "#/today" }, "看完整今日与本月", icon("arrowRight")));
  };
  const renderToday = () => {
    const state = session.get();
    if (!state.authenticated) {
      todayBox.replaceChildren(
        h("h2", null, "每天一份属于你的宜忌"),
        h("p", null, "登录并保存命盘后，按你的八字生成今日宜忌与本月提醒。"),
        h("button", { type: "button", class: "btn btn-soft btn-sm", "data-open-auth": "" }, "登录 / 注册"));
      return;
    }
    // 缓存按账号区分：换号后不会先闪出上一个账号的宜忌。
    const who = String(state.user?.id ?? "");
    const mine = side.today && side.today.who === who ? side.today : null;
    paintToday(mine?.daily);
    if (fresh(mine, SIDE_MS) || todayPending === who) return;
    todayPending = who;
    get("/api/personal-home", { cache: "no-store" }).then(home => {
      side.today = { at: Date.now(), who, daily: home?.daily || {} };
      if (!ctx.isCurrent() || String(session.get().user?.id ?? "") !== who) return;
      paintToday(side.today.daily);
    }).catch(() => {}).finally(() => { if (todayPending === who) todayPending = null; });
  };
  renderToday();
  ctx.subscribe(session, renderToday);

  const paintSeeking = items => {
    const inList = shown?.();
    if (inList === undefined) return;
    const open = inList === null ? [] : (items || []).filter(item => item.help_status !== "resolved" && !inList.has(item.slug)).slice(0, 4);
    seekingBox.hidden = !open.length;
    if (!open.length) {
      seekingList.replaceChildren();
      return;
    }
    seekingList.replaceChildren(...open.map(item => h("a", { class: "seeking-item", href: `#/post/${encodeURIComponent(item.slug)}` },
      h("span", { class: "seeking-q" }, item.question),
      h("span", { class: "seeking-meta" },
        h("span", { class: ["chip", item.system === "bazi" ? "chip-bazi" : "chip-liuyao"] }, item.system_label || "六爻"),
        Number(item.comment_count) ? `${item.comment_count} 条回答` : "还没有回答",
        h("span", { "aria-hidden": "true" }, "·"),
        relativeTime(item.published_at || item.created_at)))));
  };
  // 骨架与真实列表差不多高，数据回来时下面的卡片不被推动。
  if (shown?.() === null) seekingBox.hidden = true;
  else seekingList.replaceChildren(...[0, 1, 2, 3].map(() => h("span", { class: "skel", style: { height: "74px", margin: "4px 8px", borderRadius: "12px" } })));
  if (side.seeking) paintSeeking(side.seeking.items);
  // 右栏只在宽屏显示；窄屏不取这份数据，拉宽窗口时再取。
  const wide = window.matchMedia?.("(min-width: 1080px)");
  const loadSeeking = () => {
    if ((wide && !wide.matches) || fresh(side.seeking, SIDE_MS) || !ctx.isCurrent()) return;
    get(`/api/community/posts${query({ limit: 12, view: "seeking" })}`, { cache: "no-store" })
      .then(data => {
        side.seeking = { at: Date.now(), items: Array.isArray(data?.items) ? data.items : [] };
        if (!ctx.isCurrent()) return;
        paintSeeking(side.seeking.items);
      })
      .catch(() => {
        if (!side.seeking && ctx.isCurrent() && shown?.() !== null) seekingList.replaceChildren(h("p", { class: "side-empty" }, "暂时加载不出来，稍后再看看。"));
      });
  };
  loadSeeking();
  wide?.addEventListener?.("change", loadSeeking);
  ctx.cleanup(() => wide?.removeEventListener?.("change", loadSeeking));

  const paintStats = stats => {
    const cell = (value, label) => h("div", { class: "pulse-cell" }, h("b", { class: "tnum" }, count(value)), h("span", null, label));
    pulseGrid.replaceChildren(
      cell(stats?.divinations?.today, "今日起卦"),
      cell(stats?.answered?.today, "今日解读"),
      cell(stats?.divinations?.total, "累计起卦"),
      cell(stats?.answered?.total, "累计解读"));
  };
  if (side.stats) {
    paintStats(side.stats.value);
    onStats?.(side.stats.value);
  } else {
    pulseGrid.replaceChildren(h("span", { class: "skel skel-line", style: { height: "48px" } }), h("span", { class: "skel skel-line", style: { height: "48px" } }));
  }
  if (!fresh(side.stats, SIDE_MS * 3)) {
    get("/api/site-stats", { cache: "no-store", headers: visitHeader() })
      .then(stats => {
        side.stats = { at: Date.now(), value: stats };
        if (!ctx.isCurrent()) return;
        paintStats(stats);
        onStats?.(stats);
      })
      .catch(() => {
        if (side.stats || !ctx.isCurrent()) return;
        pulseBox.remove();
        onStats?.(null);
      });
  }
  return { node: rail, refreshSeeking: () => { if (side.seeking) paintSeeking(side.seeking.items); } };
}

export function render(ctx) {
  const filter = readFilter(ctx.query);
  const key = filterKey(filter);
  let feedState = cache.get(key);
  if (!feedState) {
    feedState = { at: 0, items: [], cursor: "", done: false, anchor: null, y: null };
    cache.set(key, feedState);
  }
  const stale = Date.now() - feedState.at > CACHE_MS;
  const handoff = pendingHandoff && Date.now() - pendingHandoff.at < 2000 ? pendingHandoff : null;
  pendingHandoff = null;
  const myHash = location.hash || "#/square";

  const list = h("div", { class: "feed-list", "aria-busy": "false" });
  const sentinel = h("div", { class: "feed-sentinel" });
  const newbar = h("div", { class: "feed-newbar" });
  const announcer = h("p", { class: "sr-only", role: "status" });
  const announce = text => {
    announcer.textContent = "";
    requestAnimationFrame(() => { announcer.textContent = text; });
  };

  let controls = null;
  let chips = null;
  const apply = (patch, control = null) => {
    const next = { ...filter, ...patch };
    // 再点当前筛选：已经往下读了很多时回到列表开头，否则什么也不做。
    if (filterKey(next) === key) {
      if (controls && controls.getBoundingClientRect().top < stickyTop()) scrollToListTop();
      return;
    }
    local.setJson(FILTER_KEY, next);
    saveAnchor();
    pendingHandoff = {
      at: Date.now(),
      controlsTop: controls ? controls.getBoundingClientRect().top : 0,
      chipsScroll: chips ? chips.scrollLeft : 0,
      focus: control && control === document.activeElement ? control.dataset.filter || "" : "",
    };
    const params = {};
    if (next.view !== "latest") params.view = next.view;
    if (next.system) params.system = next.system;
    if (next.type) params.type = next.type;
    const search = new URLSearchParams(params).toString();
    ctx.navigate(`/square${search ? `?${search}` : ""}`, { replace: true });
  };

  const tabs = h("div", { class: "feed-tabs", role: "tablist", "aria-label": "排序" },
    VIEWS.map(([keyName, label]) => h("button", {
      type: "button",
      role: "tab",
      class: "feed-tab",
      "aria-selected": String(filter.view === keyName),
      tabindex: filter.view === keyName ? "0" : "-1",
      "data-filter": `view:${keyName}`,
      onClick: event => apply({ view: keyName }, event.currentTarget),
    }, keyName === "seeking" ? icon("hand", "icon-sm") : keyName === "popular" ? icon("flame", "icon-sm") : icon("clock", "icon-sm"), label)));
  // 标签页键盘操作：左右方向键、Home / End 在标签间移动，回车或空格切换。
  tabs.addEventListener("keydown", event => {
    const items = Array.from(tabs.querySelectorAll('[role="tab"]'));
    const index = items.indexOf(document.activeElement);
    if (index < 0) return;
    const target = event.key === "ArrowRight" ? items[(index + 1) % items.length]
      : event.key === "ArrowLeft" ? items[(index - 1 + items.length) % items.length]
        : event.key === "Home" ? items[0]
          : event.key === "End" ? items[items.length - 1] : null;
    if (!target) return;
    event.preventDefault();
    target.focus();
  });
  const systemSeg = h("div", { class: "seg feed-system", role: "group", "aria-label": "盘法" },
    SYSTEMS.map(([keyName, label]) => h("button", {
      type: "button",
      "aria-pressed": String(filter.system === keyName),
      "data-filter": `system:${keyName}`,
      onClick: event => apply({ system: keyName }, event.currentTarget),
    }, label)));
  chips = h("div", { class: "topic-chips", role: "group", "aria-label": "话题" },
    TOPICS.map(([keyName, label]) => h("button", {
      type: "button",
      class: "pill-filter",
      "aria-pressed": String(filter.type === keyName),
      "data-filter": `type:${keyName}`,
      onClick: event => apply({ type: keyName }, event.currentTarget),
    }, keyName ? label : "全部")));
  controls = h("div", { class: "feed-controls" }, tabs, systemSeg);

  // 脉搏数据还没到时先占好位置，数据回来不把整页往下挤。
  const pulse = h("p", { class: "feed-pulse", hidden: true });
  const paintPulse = stats => {
    pulse.classList.remove("skel", "is-loading");
    pulse.removeAttribute("aria-hidden");
    const today = Number(stats?.divinations?.today) || 0;
    const answered = Number(stats?.answered?.today) || 0;
    if (!stats || (!today && !answered)) {
      pulse.hidden = true;
      pulse.replaceChildren();
      return;
    }
    pulse.hidden = false;
    pulse.replaceChildren(`今日 ${count(today)} 卦 · ${count(answered)} 次解读`);
  };
  if (!side.stats) {
    pulse.hidden = false;
    pulse.classList.add("skel", "is-loading");
    pulse.setAttribute("aria-hidden", "true");
  }
  const heading = h("div", { class: "feed-heading" },
    h("h1", { class: "feed-title" }, "大家正在问"),
    pulse);

  const center = h("div", { class: "feed-main" },
    heading,
    controls,
    chips,
    h("div", { class: "feed-stream" }, newbar, list),
    sentinel,
    announcer);

  let listReady = false;
  const rightRail = sideRail(ctx, {
    shown: () => filter.view === "seeking" ? null : listReady ? new Set(feedState.items.map(item => item.slug)) : undefined,
    onStats: paintPulse,
  });
  const listChanged = () => {
    listReady = true;
    rightRail.refreshSeeking();
  };
  const node = h("div", { class: "feed-layout" }, topicRail(filter, apply), center, rightRail.node);
  // 切换筛选：整页不再做入场动画，只让列表轻轻换一下。
  if (handoff) node.classList.add("is-quiet");

  let loading = false;
  let failed = false;
  let gen = 0;

  const onLike = (item, button) => likePost(item, button);

  function renderItems(items, { append = false } = {}) {
    const cards = items.map(item => postCard(item, { onLike }));
    if (append) list.append(...cards);
    else list.replaceChildren(...cards);
    listChanged();
    return cards;
  }

  function renderEnd() {
    sentinel.replaceChildren();
    if (!feedState.items.length) return;
    if (feedState.done) {
      sentinel.append(h("div", { class: "feed-end" },
        h("span", null, "已经看完了"),
        h("a", { class: "btn btn-soft btn-sm", href: "#/" }, icon("plus"), "问问你的事")));
    } else {
      sentinel.append(h("button", { type: "button", class: "btn btn-ghost feed-more", onClick: () => load() }, "加载更多"));
    }
  }

  function renderEmpty() {
    const topic = TOPICS.find(([keyName]) => keyName === filter.type)?.[1];
    const narrowed = !!(filter.type || filter.system);
    const seeking = filter.view === "seeking";
    list.replaceChildren(stateView({
      glyph: seeking ? "hand" : "compass",
      title: seeking ? "暂时没有等待回答的求助" : "这里还没有讨论",
      text: topic && filter.type ? `「${topic}」下还没有内容，来问第一个问题吧。`
        : seeking ? "大家的求助暂时都有人接手了，去看看最新的讨论吧。" : "来问第一个问题，让大家帮你看看。",
      actions: [
        h("a", { class: "btn btn-primary", href: "#/" }, icon("plus"), "发起提问"),
        narrowed ? h("button", { type: "button", class: "btn btn-soft", "data-filter": "empty:all", onClick: event => apply({ type: "", system: "" }, event.currentTarget) }, "看看全部话题")
          : seeking ? h("button", { type: "button", class: "btn btn-soft", "data-filter": "empty:latest", onClick: event => apply({ view: "latest" }, event.currentTarget) }, "看看最新讨论") : null,
      ].filter(Boolean),
    }));
    listChanged();
  }

  function pagePath({ cursor = "", light = false } = {}) {
    return `/api/community/posts${query({
      limit: light ? 6 : PAGE,
      view: filter.view,
      include_oracle_summary: light ? "" : "true",
      question_type: filter.type,
      system: filter.system,
      cursor,
    })}`;
  }

  async function load({ reset = false } = {}) {
    if (!reset && (loading || feedState.done)) return;
    const my = ++gen;
    loading = true;
    failed = false;
    list.setAttribute("aria-busy", "true");
    if (reset) {
      Object.assign(feedState, { items: [], cursor: "", done: false, anchor: null, y: null });
      hideNewbar();
    }
    if (!feedState.items.length) list.replaceChildren(skeletonCard(), skeletonCard(), skeletonCard());
    else sentinel.replaceChildren(h("div", { class: "feed-loading" }, h("span", { class: "spinner", "aria-hidden": "true" }), "正在加载更多…"));
    try {
      const data = await get(pagePath({ cursor: feedState.cursor }), { cache: "no-store" });
      if (!ctx.isCurrent() || my !== gen) return;
      const items = cleanItems(data?.items, feedState.items);
      const first = !feedState.items.length;
      feedState.items.push(...items);
      feedState.cursor = typeof data?.next_cursor === "string" ? data.next_cursor : "";
      feedState.done = !feedState.cursor;
      feedState.at = Date.now();
      if (!feedState.items.length) renderEmpty();
      else renderItems(first ? feedState.items : items, { append: !first });
      renderEnd();
      if (!first && items.length) announce(`又加载了 ${items.length} 条`);
    } catch (error) {
      if (!ctx.isCurrent() || my !== gen) return;
      failed = true;
      if (!feedState.items.length) {
        list.replaceChildren(errorView(error, () => load({ reset: true })));
        listChanged();
      } else {
        sentinel.replaceChildren(h("div", { class: "feed-end" }, h("span", null, error.message || "加载失败"), h("button", { type: "button", class: "btn btn-soft btn-sm", onClick: () => load() }, icon("refresh"), "重试")));
      }
    } finally {
      if (my === gen) {
        loading = false;
        list.setAttribute("aria-busy", "false");
      }
    }
  }

  /* ---------- 阅读位置：记住视口顶端的那张卡片，返回时按卡片对齐 ---------- */
  function captureAnchor() {
    const top = stickyTop();
    for (const card of list.querySelectorAll(":scope > .post-card[data-slug]")) {
      const rect = card.getBoundingClientRect();
      if (rect.bottom > top + 8) return { slug: card.dataset.slug, offset: rect.top };
    }
    return null;
  }

  function restoreAnchor(anchor) {
    if (!anchor) return false;
    const card = list.querySelector(`:scope > .post-card[data-slug="${cssValue(anchor.slug)}"]`);
    if (!card) return false;
    const delta = card.getBoundingClientRect().top - anchor.offset;
    if (Math.abs(delta) > 1) window.scrollTo(0, Math.max(0, window.scrollY + delta));
    return true;
  }

  function saveAnchor() {
    if (!ctx.isCurrent() || (location.hash || "#/square") !== myHash || !feedState.items.length) return;
    feedState.y = window.scrollY;
    feedState.anchor = feedState.y > 12 ? captureAnchor() : null;
  }

  let anchorTimer = 0;
  const onScroll = () => {
    clearTimeout(anchorTimer);
    anchorTimer = setTimeout(saveAnchor, 120);
  };
  const onHide = () => { if (document.visibilityState === "hidden") saveAnchor(); };
  window.addEventListener("scroll", onScroll, { passive: true });
  document.addEventListener("visibilitychange", onHide);
  ctx.cleanup(() => {
    clearTimeout(anchorTimer);
    window.removeEventListener("scroll", onScroll);
    document.removeEventListener("visibilitychange", onHide);
  });

  function scrollToListTop() {
    const target = window.scrollY + controls.getBoundingClientRect().top - stickyTop() - 8;
    if (window.scrollY <= target + 1) return;
    const far = window.scrollY - target > window.innerHeight * 2;
    window.scrollTo({ top: Math.max(0, target), behavior: far || reducedMotion() ? "auto" : "smooth" });
  }

  function revealSelectedChip() {
    const chip = chips.querySelector('[aria-pressed="true"]');
    if (!chip || chips.scrollWidth <= chips.clientWidth + 1) return;
    const box = chips.getBoundingClientRect();
    const rect = chip.getBoundingClientRect();
    if (rect.left >= box.left && rect.right <= box.right) return;
    chips.scrollLeft += rect.left - box.left - (box.width - rect.width) / 2;
  }

  /* ---------- 新帖子提示与刷新 ---------- */
  let lastCheck = Date.now();
  let newCount = 0;

  function hideNewbar() {
    newCount = 0;
    newbar.replaceChildren();
  }

  function showNewPill(n, capped) {
    const label = capped ? `有 ${n}+ 条新帖子` : `有 ${n} 条新帖子`;
    const first = !newCount;
    newCount = n;
    newbar.replaceChildren(h("button", { type: "button", class: "feed-newpill", onClick: revealNew }, icon("arrowUp", "icon-sm"), label));
    if (first) announce(label);
  }

  function showNewbarStatus(text) {
    newbar.replaceChildren(h("span", { class: "feed-newpill is-status" }, h("span", { class: "spinner", "aria-hidden": "true" }), text));
  }

  const PATCH_FIELDS = ["like_count", "viewer_liked", "comment_count", "view_count", "viewer_count", "help_status", "help_status_label", "is_featured", "answer_excerpt"];
  const STRUCTURAL = ["help_status", "is_featured", "answer_excerpt"];

  // 静默更新已在列表里的卡片（点赞、讨论数、求助状态）。只重建视口顶端以下的卡片，
  // 上方的卡片只改数字：不需要回滚动位置，也不会打断正在进行的手指滑动。
  function patchItems(freshItems) {
    const top = stickyTop();
    for (const item of Array.isArray(freshItems) ? freshItems : []) {
      const existing = feedState.items.find(entry => entry.slug === item?.slug);
      if (!existing) continue;
      const fields = PATCH_FIELDS.filter(field => field in item && item[field] !== existing[field]
        && !(liking.has(item.slug) && (field === "viewer_liked" || field === "like_count")));
      if (!fields.length) continue;
      const structural = fields.some(field => STRUCTURAL.includes(field));
      fields.forEach(field => { existing[field] = item[field]; });
      const card = list.querySelector(`:scope > .post-card[data-slug="${cssValue(item.slug)}"]`);
      if (!card) continue;
      if (structural && !card.contains(document.activeElement) && card.getBoundingClientRect().top >= top - 1) {
        card.replaceWith(postCard(existing, { onLike }));
      } else {
        const like = card.querySelector("[data-like]");
        if (like) paintLike(like, existing);
        const comments = card.querySelector('[data-stat="comments"] .tnum');
        if (comments) comments.textContent = count(existing.comment_count);
        const views = card.querySelector('[data-stat="views"] .tnum');
        if (views) views.textContent = count(existing.viewer_count ?? existing.view_count);
      }
    }
  }

  function noteNew(items) {
    if (filter.view !== "latest") return;
    const newest = feedState.items.reduce((max, item) => Math.max(max, stamp(item)), 0);
    const incoming = cleanItems(items, feedState.items).filter(item => stamp(item) > newest);
    if (!incoming.length) return;
    showNewPill(incoming.length, incoming.length >= (items?.length || 0));
  }

  // 轻量核对第一页：更新数字，最新列表里出现新帖子时给出提示（不直接插入，列表不跳）。
  async function check({ light = true } = {}) {
    if (loading || !feedState.items.length || navigator.onLine === false) return;
    const my = gen;
    lastCheck = Date.now();
    try {
      const data = await get(pagePath({ light }), { cache: "no-store" });
      if (!ctx.isCurrent() || my !== gen || loading) return;
      patchItems(data?.items);
      noteNew(data?.items);
      feedState.at = Date.now();
    } catch (_) {}
  }

  // 点「有新帖子」：把新帖子放到最前面并回到列表开头；新帖子太多时直接换成最新一页。
  async function revealNew() {
    if (loading) return;
    const my = ++gen;
    loading = true;
    showNewbarStatus("正在载入新帖子…");
    try {
      const data = await get(pagePath(), { cache: "no-store" });
      if (!ctx.isCurrent() || my !== gen) return;
      const raw = Array.isArray(data?.items) ? data.items : [];
      const known = new Set(feedState.items.map(item => item.slug));
      const gap = raw.length && raw.every(item => !known.has(item.slug));
      let added = [];
      if (gap) {
        added = cleanItems(raw);
        Object.assign(feedState, { items: added.slice(), cursor: typeof data?.next_cursor === "string" ? data.next_cursor : "", anchor: null });
        feedState.done = !feedState.cursor;
        renderItems(feedState.items);
        renderEnd();
      } else {
        added = cleanItems(raw, feedState.items);
        feedState.items.unshift(...added);
        const cards = added.map(item => postCard(item, { onLike }));
        list.prepend(...cards);
        listChanged();
      }
      feedState.at = Date.now();
      patchItems(raw);
      hideNewbar();
      list.querySelectorAll(":scope > .post-card").forEach((card, index) => {
        if (index < added.length) card.classList.add("is-fresh");
      });
      scrollToListTop();
      announce(added.length ? `已显示 ${added.length} 条新帖子` : "已是最新");
    } catch (error) {
      if (!ctx.isCurrent() || my !== gen) return;
      toast(error.message || "新帖子没能载入", { type: "error" });
      if (newCount) showNewPill(newCount, false);
      else hideNewbar();
    } finally {
      if (my === gen) loading = false;
    }
  }

  // 已在顶部时再点「广场」：重新拉取第一页，给出「正在刷新 / 已是最新」的反馈。
  async function refreshNow() {
    if (!ctx.isCurrent()) return;
    if (!feedState.items.length || failed) {
      load({ reset: true });
      return;
    }
    if (loading) return;
    const my = ++gen;
    loading = true;
    list.setAttribute("aria-busy", "true");
    showNewbarStatus("正在刷新…");
    try {
      const data = await get(pagePath(), { cache: "no-store" });
      if (!ctx.isCurrent() || my !== gen) return;
      const items = cleanItems(data?.items);
      const known = new Set(feedState.items.map(item => item.slug));
      const added = items.filter(item => !known.has(item.slug)).length;
      Object.assign(feedState, { items, cursor: typeof data?.next_cursor === "string" ? data.next_cursor : "", at: Date.now(), anchor: null, y: 0 });
      feedState.done = !feedState.cursor;
      if (!items.length) renderEmpty();
      else renderItems(items);
      renderEnd();
      list.classList.remove("is-swapping");
      void list.offsetWidth;
      list.classList.add("is-swapping");
      toast(added ? `更新了 ${added} 条新帖子` : "已是最新", { type: added ? "ok" : "info", duration: 1800 });
    } catch (error) {
      if (!ctx.isCurrent() || my !== gen) return;
      toast(error.message || "刷新没有成功，请稍后再试", { type: "error" });
    } finally {
      if (my === gen) {
        loading = false;
        list.setAttribute("aria-busy", "false");
        if (!newCount) hideNewbar();
      }
    }
  }
  ctx.onRefresh(refreshNow);

  if (feedState.items.length) {
    renderItems(feedState.items);
    renderEnd();
  } else if (feedState.done && !stale) {
    // 已确认这个筛选下没有内容：直接画空态（load() 会因 done 提前返回，列表就一直空白）。
    renderEmpty();
  } else {
    load({ reset: true });
  }
  const stopWatching = whenVisible(sentinel, () => {
    if (!feedState.done && feedState.items.length && !failed) load();
  });
  ctx.cleanup(() => stopWatching());

  // 停留期间约每分钟核对一次；切回前台时如果已经隔了一分钟，也立即核对。
  const tick = () => {
    if (!ctx.isCurrent() || document.visibilityState !== "visible") return;
    if (Date.now() - lastCheck >= POLL_MS - 1000) check();
  };
  const pollTimer = setInterval(tick, POLL_MS / 2);
  document.addEventListener("visibilitychange", tick);
  ctx.cleanup(() => {
    clearInterval(pollTimer);
    document.removeEventListener("visibilitychange", tick);
  });

  // 断线恢复：网络恢复后自动重试失败的加载，并补上断网期间的变化。
  const recover = () => {
    if (!ctx.isCurrent() || loading) return;
    if (failed) load({ reset: !feedState.items.length });
    else check();
  };
  window.addEventListener("online", recover);
  ctx.cleanup(() => window.removeEventListener("online", recover));

  // 登录状态变化后，点赞状态等个人字段需要重新取：列表不清空，只就地更新。
  let lastAuth = session.get().authenticated;
  ctx.subscribe(session, state => {
    if (state.authenticated === lastAuth) return;
    lastAuth = state.authenticated;
    cache.forEach(entry => { if (entry !== feedState) entry.at = 0; });
    if (loading || !feedState.items.length) load({ reset: true });
    else check({ light: false });
  });

  on(node, "click", "[data-view-link]", (event, link) => {
    event.preventDefault();
    apply({ view: link.dataset.viewLink }, link);
  });

  // 打开帖子前记下阅读位置；返回键回到列表原处，而不是重新从顶部开始。
  wirePostLinks(node, ctx, { beforeOpen: saveAnchor });

  // 挂载之后：切换筛选时让控件留在原处并还原焦点；过期缓存按进入方式刷新。
  let restored = null;
  queueMicrotask(() => {
    if (!ctx.isCurrent()) return;
    if (handoff) {
      chips.scrollLeft = handoff.chipsScroll || 0;
      revealSelectedChip();
      const top = stickyTop();
      const want = handoff.controlsTop < top ? top + 8 : handoff.controlsTop;
      const delta = controls.getBoundingClientRect().top - want;
      if (Math.abs(delta) > 1) window.scrollTo(0, Math.max(0, window.scrollY + delta));
      if (handoff.focus) node.querySelector(`[data-filter="${cssValue(handoff.focus)}"]`)?.focus({ preventScroll: true });
      list.classList.add("is-swapping");
    } else {
      revealSelectedChip();
    }
    if (!feedState.items.length || !stale) return;
    // 从帖子返回：保留原来的列表和位置，只核对更新（换过账号时核对整页）；重新进入：直接拉最新。
    if (restored !== null) check({ light: feedState.at > 0 });
    else load({ reset: true });
  });

  return {
    node,
    // 首页（广场）用站点完整标题，便于搜索引擎收录。
    title: filter.view === "seeking" ? "等你来答" : "广场",
    layout: "feed",
    onRestore(y) {
      restored = y;
      // 返回时直接显示原页面，不做入场动画；按离开时的卡片对齐，不受列表上方内容变化影响。
      node.classList.add("is-quiet");
      requestAnimationFrame(() => {
        if (!ctx.isCurrent() || !feedState.items.length) return;
        if (feedState.anchor && restoreAnchor(feedState.anchor)) return;
        if (typeof feedState.y === "number") window.scrollTo(0, feedState.y);
      });
    },
  };
}
