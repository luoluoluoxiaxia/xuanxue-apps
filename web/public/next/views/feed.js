// 广场：社区问题流。桌面三栏（话题 / 问题流 / 今日与等你来答），手机单栏 + 话题横滑。
import { h, on, whenVisible } from "../lib/dom.js?v=n1";
import { icon } from "../lib/icons.js?v=n1";
import { get, post, query } from "../lib/api.js?v=n1";
import { session, displayName, local } from "../lib/store.js?v=n1";
import { relativeTime, count } from "../lib/format.js?v=n1";
import { avatar, errorView, stateView, skeletonCard } from "../ui/bits.js?v=n1";
import { guaToken, pillarsToken } from "../ui/gua.js?v=n1";
import { toast } from "../ui/toast.js?v=n1";

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

// 同一问题可能跨页重复出现：按 slug 与规整后的问题去重，并跳过无意义的问题。
function normalizedQuestion(item) {
  return String(item?.question || item?.title || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function isJunkQuestion(question) {
  return question.length < 2 || /^[\d\s._-]+$/.test(question);
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

export function postCard(item, { onLike } = {}) {
  const isHelp = item.post_kind === "help";
  const resolved = item.help_status === "resolved";
  const token = item.system === "bazi" ? pillarsToken(item.chart_summary) : guaToken(item.oracle_summary);
  const excerpt = String(item.answer_excerpt || "").trim();
  const noAnswers = isHelp && !resolved && !Number(item.comment_count);
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
      avatar(item.author_name || "卦友", "sm"),
      h("span", { class: "post-card-author" }, item.author_name || "卦友"),
      h("span", { class: "dot", "aria-hidden": "true" }, "·"),
      h("time", { datetime: item.published_at || item.created_at, title: item.published_at || "" }, relativeTime(item.published_at || item.created_at)),
      h("span", { class: "post-card-tags" },
        h("span", { class: ["chip", item.system === "bazi" ? "chip-bazi" : "chip-liuyao"] }, item.system_label || (item.system === "bazi" ? "八字" : "六爻")),
        item.question_type_label ? h("span", { class: "chip" }, item.question_type_label) : null)),
    h("h3", { class: "post-card-title" }, h("a", { href, class: "post-card-link" }, item.question || item.title)),
    token || excerpt || noAnswers ? h("div", { class: "post-card-body" },
      token,
      excerpt ? h("p", { class: "post-card-excerpt" },
        h("span", { class: ["excerpt-mark", isHelp ? "is-people" : "is-ai"] }, isHelp ? "卦友" : "AI"),
        excerpt) : null,
      noAnswers ? h("p", { class: "post-card-invite" }, icon("hand", "icon-sm"), "还没有人回答，懂的卦友来说说？") : null) : null,
    h("footer", { class: "post-card-foot" },
      like,
      h("span", { class: "stat", title: "讨论" }, icon("comment"), h("span", { class: "tnum" }, count(item.comment_count)), h("span", { class: "sr-only" }, "条讨论")),
      h("span", { class: "stat", title: "浏览" }, icon("eye"), h("span", { class: "tnum" }, count(item.view_count)), h("span", { class: "sr-only" }, "次浏览")),
      h("span", { class: "post-card-status" },
        item.is_featured ? h("span", { class: "chip chip-gold" }, icon("award"), "精选") : null,
        isHelp ? h("span", { class: ["chip", resolved ? "chip-ok" : "chip-help"] }, resolved ? icon("check") : icon("hand"), item.help_status_label || (resolved ? "已解决" : "求助中")) : null)));
}

export async function likePost(item, button) {
  if (item.viewer_liked) {
    button.classList.remove("is-bump");
    void button.offsetWidth;
    button.classList.add("is-bump");
    toast("已赞过");
    return;
  }
  item.viewer_liked = true;
  item.like_count = (Number(item.like_count) || 0) + 1;
  syncLike(button, item);
  try {
    const result = await post(`/api/community/posts/${encodeURIComponent(item.slug)}/like`, undefined, { interaction: true });
    if (result && typeof result.like_count === "number") item.like_count = result.like_count;
    syncLike(button, item);
    toast(result?.newly_liked === false ? "已赞过" : "已点赞", { type: "ok" });
  } catch (error) {
    item.viewer_liked = false;
    item.like_count = Math.max(0, item.like_count - 1);
    syncLike(button, item);
    toast(error.message || "点赞没有成功", { type: "error" });
  }
}

function syncLike(button, item) {
  button.classList.toggle("is-on", !!item.viewer_liked);
  button.setAttribute("aria-pressed", String(!!item.viewer_liked));
  button.setAttribute("aria-label", `点赞，当前 ${item.like_count || 0}`);
  const label = button.querySelector("span");
  if (label) label.textContent = count(item.like_count);
  if (item.viewer_liked) {
    button.classList.remove("is-bump");
    void button.offsetWidth;
    button.classList.add("is-bump");
  }
}

function composerCard(ctx) {
  const state = session.get();
  const name = state.authenticated ? displayName(state.user) : "";
  return h("section", { class: "composer-card", "aria-label": "发起提问" },
    h("a", { class: "composer-prompt", href: "#/ask" },
      state.authenticated ? avatar(name) : h("span", { class: "composer-mark", "aria-hidden": "true" }, icon("feather")),
      h("span", { class: "composer-placeholder" }, "有什么放不下的事？写下来，让卦象和卦友一起帮你看看"),
      h("span", { class: "composer-go", "aria-hidden": "true" }, icon("arrowRight"))),
    h("div", { class: "composer-actions" },
      h("a", { class: "composer-action is-liuyao", href: "#/ask/liuyao" }, icon("gua"), h("span", null, h("b", null, "六爻问事"), h("small", null, "一件具体的事"))),
      h("a", { class: "composer-action is-bazi", href: "#/ask/bazi" }, icon("pillars"), h("span", null, h("b", null, "八字看长期"), h("small", null, "性格、事业与运势"))),
      h("a", { class: "composer-action is-help", href: "#/ask/liuyao?help=1" }, icon("hand"), h("span", null, h("b", null, "向卦友求助"), h("small", null, "请大家帮忙断")))));
}

function topicRail(filter, apply) {
  return h("nav", { class: "rail rail-left", "aria-label": "话题" },
    h("p", { class: "rail-label" }, "话题"),
    h("div", { class: "topic-list" },
      TOPICS.map(([key, label, glyph]) => h("button", {
        type: "button",
        class: "topic-item",
        "aria-pressed": String(filter.type === key),
        onClick: () => apply({ type: key }),
      }, icon(glyph), h("span", null, label)))),
    h("p", { class: "rail-label" }, "盘法"),
    h("div", { class: "topic-list" },
      SYSTEMS.map(([key, label]) => h("button", {
        type: "button",
        class: "topic-item",
        "aria-pressed": String(filter.system === key),
        onClick: () => apply({ system: key }),
      }, icon(key === "bazi" ? "pillars" : key === "liuyao" ? "gua" : "layers"), h("span", null, key ? label : "全部盘法")))));
}

// 每次页面加载只计一次访问。
let visitCounted = false;
function visitHeader() {
  if (visitCounted) return {};
  visitCounted = true;
  return { "X-Xuanshu-Visit": "web-v1" };
}

function sideRail(ctx, { onSeeking, onStats } = {}) {
  const rail = h("aside", { class: "rail rail-right", "aria-label": "社区动态" });
  const todayBox = h("section", { class: "side-card side-today" });
  const seekingBox = h("section", { class: "side-card side-seeking" },
    h("div", { class: "side-head" }, h("h2", null, "等你来答"), h("a", { class: "link-btn", href: "#/?view=seeking", "data-view-link": "seeking" }, "更多")),
    h("div", { class: "side-seeking-list" }, [0, 1, 2].map(() => h("span", { class: "skel skel-line", style: { height: "36px", borderRadius: "10px" } }))));
  const pulseBox = h("section", { class: "side-card side-pulse" },
    h("div", { class: "side-head" }, h("h2", null, "社区脉搏")),
    h("div", { class: "pulse-grid" }, h("span", { class: "skel skel-line", style: { height: "48px" } }), h("span", { class: "skel skel-line", style: { height: "48px" } })));
  const rules = h("section", { class: "side-card side-rules" },
    h("div", { class: "side-head" }, h("h2", null, "讨论公约")),
    h("ol", { class: "rules" },
      h("li", null, h("b", null, "就盘论事"), h("span", null, "说依据，也说不确定的地方。")),
      h("li", null, h("b", null, "善意表达"), h("span", null, "对事不对人，不嘲讽、不恐吓。")),
      h("li", null, h("b", null, "保护隐私"), h("span", null, "不留联系方式，不晒他人信息。"))));
  const foot = h("footer", { class: "side-foot" },
    h("button", { type: "button", class: "link-btn", "data-open-feedback": "" }, "意见反馈"),
    h("span", { "aria-hidden": "true" }, "·"),
    h("button", { type: "button", class: "link-btn", "data-switch-classic": "" }, "回到经典版"),
    h("p", null, "AI 解读仅供传统文化研究与娱乐参考，不替代医疗、法律、投资等专业意见。"));
  rail.append(todayBox, seekingBox, pulseBox, rules, foot);

  const renderToday = () => {
    const state = session.get();
    if (!state.authenticated) {
      todayBox.replaceChildren(
        h("div", { class: "side-today-mark", "aria-hidden": "true" }, icon("sun")),
        h("h2", null, "每天一份属于你的宜忌"),
        h("p", null, "登录并保存命盘后，按你的八字生成今日宜忌与本月提醒。"),
        h("button", { type: "button", class: "btn btn-soft btn-sm", "data-open-auth": "" }, "登录 / 注册"));
      return;
    }
    todayBox.replaceChildren(
      h("div", { class: "side-today-mark", "aria-hidden": "true" }, icon("sun")),
      h("h2", null, "今日宜忌"),
      h("p", null, "按你的命盘生成，每天更新。"),
      h("a", { class: "btn btn-soft btn-sm", href: "#/today" }, "查看今日", icon("arrowRight")));
    get("/api/personal-home", { cache: "no-store" }).then(home => {
      if (!ctx.isCurrent() || !session.get().authenticated) return;
      const daily = home?.daily || {};
      const suitable = Array.isArray(daily.content?.suitable) ? daily.content.suitable : [];
      const avoid = Array.isArray(daily.content?.avoid) ? daily.content.avoid : [];
      if (daily.status !== "done" || (!suitable.length && !avoid.length)) return;
      todayBox.replaceChildren(
        h("div", { class: "side-today-mark", "aria-hidden": "true" }, icon("sun")),
        h("h2", null, `今日 · ${[daily.date_label, daily.weekday_label].filter(Boolean).join(" ")}`),
        suitable.length ? h("p", { class: "side-today-line" }, h("b", { class: "yi" }, "宜"), suitable.slice(0, 3).join("、")) : null,
        avoid.length ? h("p", { class: "side-today-line" }, h("b", { class: "ji" }, "忌"), avoid.slice(0, 2).join("、")) : null,
        h("a", { class: "btn btn-soft btn-sm", href: "#/today" }, "看完整今日与本月", icon("arrowRight")));
    }).catch(() => {});
  };
  renderToday();
  ctx.subscribe(session, renderToday);

  get(`/api/community/posts${query({ limit: 6, view: "seeking", include_oracle_summary: "true" })}`, { cache: "no-store" })
    .then(data => {
      const items = (data?.items || []).filter(item => item.help_status !== "resolved").slice(0, 4);
      onSeeking?.((data?.items || []).filter(item => item.help_status !== "resolved"));
      const list = seekingBox.querySelector(".side-seeking-list");
      if (!items.length) {
        list.replaceChildren(h("p", { class: "side-empty" }, "暂时没有等待回答的求助。"));
        return;
      }
      list.replaceChildren(...items.map(item => h("a", { class: "seeking-item", href: `#/post/${encodeURIComponent(item.slug)}` },
        h("span", { class: "seeking-q" }, item.question),
        h("span", { class: "seeking-meta" },
          h("span", { class: ["chip", item.system === "bazi" ? "chip-bazi" : "chip-liuyao"] }, item.system_label || "六爻"),
          Number(item.comment_count) ? `${item.comment_count} 条回答` : "还没有回答",
          h("span", { "aria-hidden": "true" }, "·"),
          relativeTime(item.published_at || item.created_at)))));
    })
    .catch(() => {
      seekingBox.querySelector(".side-seeking-list").replaceChildren(h("p", { class: "side-empty" }, "暂时加载不出来，稍后再看看。"));
    });

  get("/api/site-stats", { cache: "no-store", headers: visitHeader() })
    .then(stats => {
      onStats?.(stats);
      const grid = pulseBox.querySelector(".pulse-grid");
      const cell = (value, label) => h("div", { class: "pulse-cell" }, h("b", { class: "tnum" }, count(value)), h("span", null, label));
      grid.replaceChildren(
        cell(stats?.divinations?.today, "今日起卦"),
        cell(stats?.answered?.today, "今日解读"),
        cell(stats?.divinations?.total, "累计起卦"),
        cell(stats?.answered?.total, "累计解读"));
    })
    .catch(() => pulseBox.remove());
  return rail;
}

export function render(ctx) {
  const filter = readFilter(ctx.query);
  const key = filterKey(filter);
  const cached = cache.get(key);
  const fresh = cached && Date.now() - cached.at < CACHE_MS;
  const feedState = fresh ? cached : { at: Date.now(), items: [], cursor: "", done: false };
  cache.set(key, feedState);

  const list = h("div", { class: "feed-list", "aria-live": "polite", "aria-busy": "false" });
  const sentinel = h("div", { class: "feed-sentinel" });
  const apply = patch => {
    const next = { ...filter, ...patch };
    local.setJson(FILTER_KEY, next);
    const params = {};
    if (next.view !== "latest") params.view = next.view;
    if (next.system) params.system = next.system;
    if (next.type) params.type = next.type;
    const search = new URLSearchParams(params).toString();
    ctx.navigate(`/${search ? `?${search}` : ""}`, { replace: true });
  };

  const tabs = h("div", { class: "feed-tabs", role: "tablist", "aria-label": "排序" },
    VIEWS.map(([keyName, label]) => h("button", {
      type: "button",
      role: "tab",
      class: "feed-tab",
      "aria-selected": String(filter.view === keyName),
      onClick: () => apply({ view: keyName }),
    }, keyName === "seeking" ? icon("hand", "icon-sm") : keyName === "popular" ? icon("flame", "icon-sm") : icon("clock", "icon-sm"), label)));
  const systemSeg = h("div", { class: "seg feed-system", role: "group", "aria-label": "盘法" },
    SYSTEMS.map(([keyName, label]) => h("button", { type: "button", "aria-pressed": String(filter.system === keyName), onClick: () => apply({ system: keyName }) }, label)));
  const chips = h("div", { class: "topic-chips", role: "group", "aria-label": "话题" },
    TOPICS.map(([keyName, label]) => h("button", { type: "button", class: "pill-filter", "aria-pressed": String(filter.type === keyName), onClick: () => apply({ type: keyName }) }, keyName ? label : "全部")));

  const pulse = h("p", { class: "feed-pulse", hidden: true });
  const heading = h("div", { class: "feed-heading" },
    h("div", null,
      pulse,
      h("p", { class: "kicker" }, "玄枢广场"),
      h("h1", { class: "feed-title" }, filter.view === "seeking" ? "这些问题在等你的判断" : filter.view === "popular" ? "大家都在看" : "大家正在问"),
      h("p", { class: "feed-sub" }, "真实的问题，真人的讨论。看看别人怎么想，也说说你的看法。")));

  const center = h("div", { class: "feed-main" },
    heading,
    composerCard(ctx),
    h("div", { class: "feed-controls" }, tabs, systemSeg),
    chips,
    list,
    sentinel);

  let seekingItems = [];
  const seekingStrip = () => {
    if (!seekingItems.length || filter.view === "seeking") return null;
    return h("section", { class: "seeking-strip", "aria-label": "等你来答" },
      h("div", { class: "seeking-strip-head" },
        h("h2", null, icon("hand", "icon-sm"), "这些问题在等你来答"),
        h("button", { type: "button", class: "link-btn", onClick: () => apply({ view: "seeking" }) }, "全部")),
      h("div", { class: "seeking-strip-scroll" }, seekingItems.slice(0, 8).map(item => h("a", { class: "seeking-chip-card", href: `#/post/${encodeURIComponent(item.slug)}` },
        h("span", { class: ["chip", item.system === "bazi" ? "chip-bazi" : "chip-liuyao"] }, item.system_label || "六爻"),
        h("b", null, item.question),
        h("span", { class: "seeking-chip-meta" }, Number(item.comment_count) ? `${item.comment_count} 条回答` : "还没有回答", " · ", relativeTime(item.published_at || item.created_at)),
        h("span", { class: "seeking-chip-go" }, "去回答", icon("arrowRight", "icon-sm"))))));
  };
  const placeStrip = () => {
    list.querySelector(".seeking-strip")?.remove();
    const strip = seekingStrip();
    if (!strip) return;
    const cards = list.querySelectorAll(":scope > .post-card:not(.is-skeleton)");
    if (cards.length >= 3) cards[2].after(strip);
  };
  const node = h("div", { class: "feed-layout" }, topicRail(filter, apply), center, sideRail(ctx, {
    onSeeking: items => { seekingItems = items; placeStrip(); },
    onStats: stats => {
      const today = Number(stats?.divinations?.today) || 0;
      const answered = Number(stats?.answered?.today) || 0;
      if (!today && !answered) return;
      pulse.hidden = false;
      pulse.replaceChildren(h("span", { class: "pulse-dot", "aria-hidden": "true" }), `今日 ${count(today)} 卦 · ${count(answered)} 次解读`);
    },
  }));

  let loading = false;
  let stopWatching = () => {};

  const onLike = (item, button) => likePost(item, button);

  function renderItems(items, { append = false } = {}) {
    const cards = items.map(item => postCard(item, { onLike }));
    if (append) list.append(...cards);
    else list.replaceChildren(...cards);
    if (!append) placeStrip();
  }

  function renderEnd() {
    sentinel.replaceChildren();
    if (!feedState.items.length) return;
    if (feedState.done) {
      sentinel.append(h("div", { class: "feed-end" },
        h("span", null, "已经看完了"),
        h("a", { class: "btn btn-soft btn-sm", href: "#/ask" }, icon("plus"), "问问你的事")));
    } else {
      sentinel.append(h("button", { type: "button", class: "btn btn-ghost feed-more", onClick: () => load() }, "加载更多"));
    }
  }

  function renderEmpty() {
    const topic = TOPICS.find(([keyName]) => keyName === filter.type)?.[1];
    list.replaceChildren(stateView({
      glyph: filter.view === "seeking" ? "hand" : "compass",
      title: filter.view === "seeking" ? "暂时没有等待回答的求助" : "这里还没有讨论",
      text: topic && filter.type ? `「${topic}」下还没有内容，来问第一个问题吧。` : "来问第一个问题，让大家帮你看看。",
      actions: [h("a", { class: "btn btn-primary", href: "#/ask" }, icon("plus"), "发起提问")],
    }));
  }

  let failed = false;
  async function load({ reset = false } = {}) {
    if (loading || (feedState.done && !reset)) return;
    loading = true;
    failed = false;
    list.setAttribute("aria-busy", "true");
    if (reset) {
      feedState.items = [];
      feedState.cursor = "";
      feedState.done = false;
    }
    if (!feedState.items.length) list.replaceChildren(skeletonCard(), skeletonCard(), skeletonCard());
    else sentinel.replaceChildren(h("div", { class: "feed-loading" }, h("span", { class: "spinner", "aria-hidden": "true" }), "正在加载更多…"));
    try {
      const data = await get(`/api/community/posts${query({
        limit: PAGE,
        view: filter.view,
        include_oracle_summary: "true",
        question_type: filter.type,
        system: filter.system,
        cursor: feedState.cursor,
      })}`, { cache: "no-store" });
      if (!ctx.isCurrent()) return;
      const items = (data?.items || []).filter(item => {
        const question = normalizedQuestion(item);
        if (!item.slug || isJunkQuestion(question)) return false;
        if (feedState.items.some(existing => existing.slug === item.slug || normalizedQuestion(existing) === question)) return false;
        return true;
      });
      const first = !feedState.items.length;
      feedState.items.push(...items);
      feedState.cursor = typeof data?.next_cursor === "string" ? data.next_cursor : "";
      feedState.done = !feedState.cursor;
      feedState.at = Date.now();
      if (!feedState.items.length) renderEmpty();
      else renderItems(first ? feedState.items : items, { append: !first });
      renderEnd();
    } catch (error) {
      if (!ctx.isCurrent()) return;
      failed = true;
      if (!feedState.items.length) list.replaceChildren(errorView(error, () => load({ reset: true })));
      else {
        sentinel.replaceChildren(h("div", { class: "feed-end" }, h("span", null, error.message || "加载失败"), h("button", { type: "button", class: "btn btn-soft btn-sm", onClick: () => load() }, "重试")));
      }
    } finally {
      loading = false;
      list.setAttribute("aria-busy", "false");
    }
  }

  if (feedState.items.length) {
    renderItems(feedState.items);
    renderEnd();
  } else {
    load();
  }
  stopWatching = whenVisible(sentinel, () => {
    if (!feedState.done && feedState.items.length) load();
  });
  ctx.cleanup(() => stopWatching());

  // 断线恢复：网络恢复后自动重试失败的加载。
  const recover = () => {
    if (!ctx.isCurrent() || loading || !failed) return;
    load({ reset: !feedState.items.length });
  };
  window.addEventListener("online", recover);
  ctx.cleanup(() => window.removeEventListener("online", recover));

  // 登录状态变化后，点赞状态等个人字段需要重新取。
  let lastAuth = session.get().authenticated;
  ctx.subscribe(session, state => {
    if (state.authenticated === lastAuth) return;
    lastAuth = state.authenticated;
    const composer = center.querySelector(".composer-card");
    composer?.replaceWith(composerCard(ctx));
    cache.clear();
    load({ reset: true });
  });

  on(node, "click", "[data-view-link]", event => {
    event.preventDefault();
    apply({ view: event.target.closest("[data-view-link]").dataset.viewLink });
    window.scrollTo({ top: 0 });
  });

  return {
    node,
    title: filter.view === "seeking" ? "等你来答" : "广场",
    layout: "feed",
  };
}
