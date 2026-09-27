// 帖子详情：一条问题的完整讨论串。桌面左侧讨论、右侧盘面速览与同类问题；手机底部固定评论栏。
import { h, autoGrow, submitOnEnter, coarsePointer, reducedMotion } from "../lib/dom.js?v=n1";
import { icon } from "../lib/icons.js?v=n1";
import { get, post as apiPost, query, cachedGet, peekCached, invalidateCached } from "../lib/api.js?v=n1";
import { session, displayName, local, refreshSession } from "../lib/store.js?v=n1";
import { relativeTime, fullTime, count } from "../lib/format.js?v=n1";
import { avatar, errorView, stateView } from "../ui/bits.js?v=n1";
import { guaGlyph, elementClass } from "../ui/gua.js?v=n1";
import { toast } from "../ui/toast.js?v=n1";
import { sharePost, renderShareImage, trackShare } from "../lib/share.js?v=n1";
import { openSheet, confirmDialog } from "../ui/overlay.js?v=n1";
import { likePost, syncLikes, syncPost, detailPath, DETAIL_TTL, stickyTop, wirePostLinks } from "./feed.js?v=n1";

const COMMENT_MAX = 500;
const draftKey = slug => `xz-next-draft:comment:${slug}`;
// 每条帖子的阅读位置：返回时即使要重新加载，也回到离开时的地方。
const readPos = new Map();
const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");

function renderMarkdown(markdown) {
  const renderer = window.XuanxueChatRenderer;
  const box = h("div", { class: "prose" });
  if (renderer && typeof renderer.renderBody === "function") box.innerHTML = renderer.renderBody(markdown);
  else box.textContent = markdown;
  return box;
}

const cloneDetail = detail => (typeof structuredClone === "function" ? structuredClone(detail) : JSON.parse(JSON.stringify(detail)));

// 需要整页重绘的变化（评论、采纳、权限等）；点赞与浏览数只就地更新。
function signature(post) {
  return JSON.stringify([
    post.comments_enabled, post.can_manage, post.accepted_comment_id, post.help_status, post.viewer_following, post.follow_count,
    post.question, String(post.answer || "").length, (post.updates || []).length,
    (post.comments || []).map(comment => [comment.id, !!comment.accepted, (comment.replies || []).map(reply => reply.id)]),
  ]);
}

// 让某个元素在一次 DOM 改动前后停在视口里的同一位置（上方内容变高变矮时不跳）。
function keepPlace(find, change) {
  const before = find()?.getBoundingClientRect().top;
  change();
  const after = find()?.getBoundingClientRect().top;
  if (typeof before === "number" && typeof after === "number" && Math.abs(after - before) > 1) {
    window.scrollTo(0, Math.max(0, window.scrollY + after - before));
  }
}

/* ---------- 卦象面板 ---------- */
function liuyaoBoard(oracle, { compact = false } = {}) {
  if (!oracle || !Array.isArray(oracle.lines) || !oracle.lines.length) return null;
  const changed = !!oracle.has_changed;
  const facts = [
    ["动爻", oracle.moving_label],
    ["世应", oracle.shi_ying_label],
    ["月建", oracle.month_jian],
    ["日辰", oracle.day_chen],
  ];
  const board = h("section", { class: ["board", "board-liuyao", compact && "is-compact"], "aria-label": "卦象" },
    h("div", { class: "board-figures" },
      h("figure", { class: "board-figure" },
        h("figcaption", null, "本卦"),
        guaGlyph(oracle.lines, { size: compact ? "md" : "lg", label: `本卦 ${oracle.ben_name || ""}` }),
        h("b", { class: "board-name" }, oracle.ben_name || "本卦")),
      h("span", { class: "board-arrow", "aria-hidden": "true" }, changed ? icon("arrowRight") : null),
      changed
        ? h("figure", { class: "board-figure" },
          h("figcaption", null, "变卦"),
          guaGlyph(oracle.lines, { changed: true, size: compact ? "md" : "lg", label: `变卦 ${oracle.bian_name || ""}` }),
          h("b", { class: "board-name" }, oracle.bian_name || "变卦"))
        : h("figure", { class: "board-figure is-quiet" }, h("figcaption", null, "变卦"), h("span", { class: "board-quiet" }, "静"), h("b", { class: "board-name" }, "六爻安静"))),
    h("p", { class: "board-caption" }, [oracle.palace_label, oracle.method_label].filter(Boolean).join(" · ")),
    h("dl", { class: "board-facts" }, facts.map(([label, value]) => h("div", null, h("dt", null, label), h("dd", null, value || "—")))));
  if (!compact) {
    const rows = oracle.lines.map(line => h("tr", { class: line.moving ? "is-moving" : "" },
      h("th", { scope: "row" }, `${line.position_label || ""}爻`),
      h("td", null, line.liu_shen || ""),
      h("td", null, h("span", { class: "ledger-line" }, h("span", { class: ["ledger-bar", line.yin ? "is-yin" : "is-yang"] }, h("i"), h("i")), line.moving ? h("em", null, line.moving_mark || "动") : null)),
      h("td", null, h("span", { class: elementClass(line.wuxing) }, `${line.liu_qin || ""} ${line.najia || ""}${line.wuxing || ""}`)),
      h("td", { class: "ledger-change" }, line.changed_label ? `→ ${line.changed_label}` : ""),
      h("td", { class: "ledger-roles" }, [line.roles, line.kong ? "空" : ""].filter(Boolean).join(" "))));
    board.append(h("details", { class: "board-ledger" },
      h("summary", null, "完整六爻排布", h("span", { class: "muted" }, [oracle.method_label, oracle.xun_kong ? `空亡 ${oracle.xun_kong}` : ""].filter(Boolean).join(" · "))),
      h("div", { class: "ledger-scroll" },
        h("table", { class: "ledger" },
          h("thead", null, h("tr", null, ["爻位", "六神", "爻", "六亲纳甲", "变", "世应"].map(label => h("th", { scope: "col" }, label)))),
          h("tbody", null, rows)))));
  }
  return board;
}

function baziBoard(chart, { compact = false } = {}) {
  if (!chart || !chart.pillars) return null;
  const order = [["year", "年柱"], ["month", "月柱"], ["day", "日柱"], ["hour", "时柱"]];
  const wuxing = chart.wuxing_count || {};
  const total = Object.values(wuxing).reduce((sum, value) => sum + (Number(value) || 0), 0) || 1;
  return h("section", { class: ["board", "board-bazi", compact && "is-compact"], "aria-label": "命盘" },
    h("p", { class: "board-note" }, icon("lock", "icon-sm"), "已隐藏出生时间、地点与身份信息"),
    h("div", { class: "board-pillars" },
      order.map(([key, label]) => h("div", { class: ["board-pillar", key === "day" && "is-day"] },
        h("span", { class: "board-pillar-label" }, label),
        h("b", { class: "board-pillar-gz" }, chart.pillars[key] || "—"),
        !compact ? h("span", { class: "board-pillar-nayin" }, chart.pillars_detail?.[key]?.na_yin || "") : null))),
    h("dl", { class: "board-facts" },
      h("div", null, h("dt", null, "日主"), h("dd", null, chart.day_master || "—")),
      h("div", null, h("dt", null, "生肖"), h("dd", null, chart.shengxiao || "—")),
      h("div", null, h("dt", null, "旬空"), h("dd", null, chart.xun_kong || "—"))),
    Object.keys(wuxing).length ? h("div", { class: "board-wuxing", "aria-label": "五行数量" },
      ["木", "火", "土", "金", "水"].map(name => h("div", { class: ["wx", elementClass(name)] },
        h("span", null, name),
        h("i", { style: { "--w": `${Math.round(((Number(wuxing[name]) || 0) / total) * 100)}%` } }),
        h("b", { class: "tnum" }, String(wuxing[name] ?? 0))))) : null);
}

/* ---------- 评论 ---------- */
function commentNode(comment, context) {
  const { post, onReply, onAccept, pending = false } = context;
  const accepted = comment.accepted || (post.accepted_comment_id && Number(post.accepted_comment_id) === Number(comment.id));
  const isTop = !comment.parent_id;
  const canAccept = !pending && isTop && post.post_kind === "help" && post.can_manage && !post.accepted_comment_id && !accepted;
  const author = comment.author_name || "卦友";
  const node = h("article", {
    class: ["comment", accepted && "is-accepted", pending && "is-pending"],
    id: comment.id ? `comment-${comment.id}` : null,
    "data-comment-id": comment.id || "",
    "aria-busy": pending ? "true" : null,
  },
  avatar(author, "sm"),
  h("div", { class: "comment-main" },
    h("header", { class: "comment-head" },
      h("b", null, author),
      comment.kind === "reading" || (comment.kind_label && comment.kind_label !== "参与讨论")
        ? h("span", { class: "chip chip-liuyao comment-kind" }, comment.kind_label || "判断") : null,
      accepted ? h("span", { class: "chip chip-ok" }, icon("check"), "已采纳") : null,
      pending
        ? h("span", { class: "comment-sending" }, h("span", { class: "spinner", "aria-hidden": "true" }), "发送中…")
        : h("time", { datetime: comment.created_at || "", title: fullTime(comment.created_at) }, relativeTime(comment.created_at))),
    h("p", { class: "comment-body" }, comment.body || ""),
    comment.reasoning ? h("p", { class: "comment-extra" }, h("span", null, "判断依据"), comment.reasoning) : null,
    comment.prediction ? h("p", { class: "comment-extra" }, h("span", null, "应期 / 结果"), comment.prediction) : null,
    Array.isArray(comment.referenced_lines) && comment.referenced_lines.length
      ? h("p", { class: "comment-extra" }, h("span", null, "参考爻位"), comment.referenced_lines.join("、")) : null,
    pending ? null : h("div", { class: "comment-actions" },
      post.comments_enabled ? h("button", { type: "button", class: "comment-action", "data-reply": comment.id || "", "aria-label": `回复 ${author}`, onClick: event => onReply(comment, event.currentTarget) }, icon("reply"), "回复") : null,
      canAccept ? h("button", { type: "button", class: "comment-action is-accept", onClick: event => onAccept(comment, event.currentTarget) }, icon("check"), "采纳这条回答") : null)));
  const replies = Array.isArray(comment.replies) ? comment.replies : [];
  if (replies.length) {
    node.querySelector(".comment-main").append(h("div", { class: "replies" }, replies.map(reply => commentNode({ ...reply, parent_id: reply.parent_id || comment.id }, context))));
  }
  return node;
}

// 很长的评论先收起到几行，点「展开全文」再看；刚发的和从消息跳来的那条不收起。
function clampLong(root, { skip = new Set(), expanded = new Set() } = {}) {
  const bodies = Array.from(root.querySelectorAll(".comment-body:not([data-clamp])")).filter(body => {
    const id = body.closest(".comment")?.dataset.commentId || "";
    body.dataset.clamp = "1";
    if (skip.has(id) || expanded.has(id)) return false;
    const text = body.textContent || "";
    return text.length > 90 || (text.match(/\n/g) || []).length >= 6;
  });
  bodies.forEach(body => body.classList.add("is-clamped"));
  if (!bodies.length) return;
  requestAnimationFrame(() => {
    bodies.forEach(body => {
      if (!body.isConnected) return;
      if (body.scrollHeight <= body.clientHeight + 4) {
        body.classList.remove("is-clamped");
        return;
      }
      const id = body.closest(".comment")?.dataset.commentId || "";
      const toggle = h("button", { type: "button", class: "comment-more", "aria-expanded": "false" }, "展开全文");
      toggle.addEventListener("click", () => {
        const open = body.classList.contains("is-clamped");
        body.classList.toggle("is-clamped", !open);
        toggle.setAttribute("aria-expanded", String(open));
        toggle.textContent = open ? "收起" : "展开全文";
        if (open) expanded.add(id);
        else {
          expanded.delete(id);
          // 收起后按钮可能已在视口上方：把它带回眼前，读者不会迷路。
          if (toggle.getBoundingClientRect().top < stickyTop()) toggle.scrollIntoView({ block: "center" });
        }
      });
      body.after(toggle);
    });
  });
}

export function render(ctx) {
  const slug = ctx.params.slug;
  const path = detailPath(slug);
  const root = h("div", { class: "post-layout" });
  const mainCol = h("div", { class: "post-main" });
  const sideCol = h("aside", { class: "post-side", "aria-label": "盘面与相关问题" });
  const mobileBar = h("div", { class: "post-mobilebar" });
  root.append(mainCol, sideCol, mobileBar);

  const backLink = () => h("button", { type: "button", class: "back-link", onClick: () => ctx.back("/") }, icon("back"), "返回");
  const skeleton = () => h("div", { class: "post-loading", "aria-busy": "true", "aria-label": "正在加载帖子" },
    h("span", { class: "skel skel-line", style: { width: "160px" } }),
    h("span", { class: "skel skel-title", style: { height: "30px", width: "86%" } }),
    h("span", { class: "skel skel-title", style: { height: "30px", width: "54%" } }),
    h("span", { class: "skel", style: { height: "220px", borderRadius: "18px", marginTop: "12px" } }),
    h("span", { class: "skel skel-line", style: { width: "96%" } }),
    h("span", { class: "skel skel-line", style: { width: "88%" } }));

  let post = null;
  let replyTo = null;
  let composer = null;
  let loadSeq = 0;
  let loadFailed = false;
  let viewed = false;
  let lastView = null;
  let busy = 0;
  let reloadWhenIdle = false;
  let restoring = false;
  let related = null;
  let relatedRequest = null;
  const expanded = new Set();
  const ui = {};
  const targetId = ctx.query.get("target") || "";
  let targetDone = !targetId;

  /* ---------- 加载：预取缓存先秒开，再用新数据核对 ---------- */
  async function load({ countView = true, fresh = false } = {}) {
    const my = ++loadSeq;
    if (fresh) invalidateCached(path);
    // 五秒内的预取（包括还在路上的）直接复用，否则重新取。
    const request = cachedGet(path, { ttl: fresh ? 0 : 5000 });
    if (countView) recordView();
    try {
      const detail = await request;
      if (!ctx.isCurrent() || my !== loadSeq) return;
      loadFailed = false;
      apply(detail);
    } catch (error) {
      if (!ctx.isCurrent() || my !== loadSeq) return;
      loadFailed = error.status !== 404;
      if (post && error.status !== 404) {
        toast("网络不稳定，显示的可能不是最新内容；恢复后会自动刷新", { type: "error" });
        return;
      }
      showError(error);
    }
  }

  // 每次打开只计一次浏览；失败（例如断网）时允许恢复后补记。
  function recordView() {
    if (viewed) return;
    viewed = true;
    apiPost(`${path}/view`, undefined, { interaction: true, keepalive: true })
      .then(view => {
        if (!view) return;
        lastView = view;
        if (post && ctx.isCurrent()) {
          applyView(view);
          patchCounts();
        }
      })
      .catch(() => { viewed = false; });
  }

  function applyView(view) {
    ["like_count", "view_count", "viewer_count"].forEach(key => {
      if (typeof view[key] === "number") post[key] = Math.max(Number(post[key]) || 0, view[key]);
    });
    if (typeof view.liked === "boolean") post.viewer_liked = view.liked || post.viewer_liked;
    syncPost(slug, { like_count: post.like_count, view_count: post.view_count, viewer_liked: post.viewer_liked });
  }

  function apply(detail) {
    const next = cloneDetail(detail);
    const first = !post;
    const before = post ? signature(post) : "";
    post = next;
    if (lastView) applyView(lastView);
    if (first || signature(post) !== before) repaint();
    else patchCounts();
    if (first && restoring && readPos.has(slug)) {
      const y = readPos.get(slug);
      requestAnimationFrame(() => { if (ctx.isCurrent()) window.scrollTo(0, y); });
    }
  }

  function showError(error) {
    const missing = error.status === 404;
    sideCol.replaceChildren();
    mobileBar.replaceChildren();
    mainCol.replaceChildren(backLink(), missing
      ? stateView({
        glyph: "compass",
        title: "这条帖子不存在或已下线",
        text: "可能已被作者删除或暂时下线，去广场看看别的讨论吧。",
        actions: [h("a", { class: "btn btn-soft", href: "#/" }, icon("plaza"), "回到广场")],
      })
      : errorView(error, retry, { title: "帖子没能加载出来" }));
  }

  function retry() {
    loadFailed = false;
    mainCol.replaceChildren(backLink(), skeleton());
    load({ countView: !viewed, fresh: true });
  }

  // 断线恢复：网络恢复后自动重新打开没载入的帖子（浏览只计一次）。
  const recover = () => {
    if (!ctx.isCurrent() || !loadFailed) return;
    if (post) {
      loadFailed = false;
      load({ countView: !viewed, fresh: true });
    } else retry();
  };
  window.addEventListener("online", recover);
  ctx.cleanup(() => window.removeEventListener("online", recover));

  // 正在发布、关注或采纳时先不整页刷新，等操作结束再核对。
  function settle() {
    busy = Math.max(0, busy - 1);
    if (!busy && reloadWhenIdle && ctx.isCurrent()) {
      reloadWhenIdle = false;
      load({ countView: false, fresh: true });
    }
  }

  /* ---------- 绘制 ---------- */
  function commentTotal() {
    const comments = Array.isArray(post.comments) ? post.comments : [];
    return Number(post.comment_count) || comments.reduce((sum, item) => sum + 1 + (Array.isArray(item.replies) ? item.replies.length : 0), 0);
  }

  function statusChip() {
    const isHelp = post.post_kind === "help";
    const resolved = post.help_status === "resolved";
    return h("span", { class: ["chip", isHelp ? (resolved ? "chip-ok" : "chip-help") : "chip-outline"] },
      isHelp ? (resolved ? icon("check") : icon("hand")) : icon("sparkle"),
      isHelp ? (post.help_status_label || (resolved ? "已解决" : "求助中")) : (post.post_kind_label || "AI 解读"));
  }

  function renderFollow() {
    const button = ui.follow;
    if (!button) return;
    const on = !!post.viewer_following;
    button.classList.toggle("btn-soft", on);
    button.setAttribute("aria-pressed", String(on));
    button.replaceChildren(icon("bookmark"), on ? "已关注" : "关注进展", post.follow_count ? h("span", { class: "tnum follow-count" }, String(post.follow_count)) : null);
  }

  function patchCounts() {
    syncLikes(post);
    if (ui.viewers) ui.viewers.textContent = `${count(post.viewer_count || post.view_count)} 人看过`;
    if (ui.count) ui.count.textContent = `${commentTotal()} 条`;
    renderFollow();
  }

  // 整页重绘时保住读者的状态：输入框焦点与光标、展开的排盘表。
  function repaint() {
    const field = composer?.textarea;
    const focused = !!field && document.activeElement === field;
    const selection = focused ? [field.selectionStart, field.selectionEnd] : null;
    const openDetails = Array.from(mainCol.querySelectorAll("details")).map(node => node.open);
    paint();
    mainCol.querySelectorAll("details").forEach((node, index) => { if (openDetails[index]) node.open = true; });
    if (focused) {
      field.focus({ preventScroll: true });
      try { field.setSelectionRange(...selection); } catch (_) {}
    }
    revealTarget();
  }

  function paint() {
    const isHelp = post.post_kind === "help";
    const systemLabel = post.system_label || (post.system === "bazi" ? "八字" : "六爻");
    ctx.setTitle(post.question || post.title || "卦帖");

    const likeBtn = h("button", { type: "button", class: ["react", "react-lg", post.viewer_liked && "is-on"], "aria-pressed": String(!!post.viewer_liked), "aria-label": `点赞，当前 ${post.like_count || 0}`, "data-like": post.slug },
      icon("heart"), h("span", { class: "tnum" }, count(post.like_count)));
    likeBtn.addEventListener("click", () => likePost(post, likeBtn));
    ui.follow = isHelp ? h("button", { type: "button", class: "btn btn-sm follow-btn" }) : null;
    if (ui.follow) {
      renderFollow();
      ui.follow.addEventListener("click", toggleFollow);
    }
    const shareBtn = h("button", { type: "button", class: "btn btn-sm" }, icon("share"), "分享");
    shareBtn.addEventListener("click", () => share(shareBtn));
    ui.share = shareBtn;
    const primary = isHelp
      ? h("button", { type: "button", class: "btn btn-primary btn-sm", onClick: () => focusComposer() }, icon("feather"), "写下判断")
      : h("a", { class: "btn btn-primary btn-sm", href: post.system === "bazi" ? "#/ask/bazi" : "#/ask/liuyao" }, icon("plus"), post.system === "bazi" ? "我也要排盘" : "我也要起卦");

    const board = post.system === "bazi" ? baziBoard(post.chart) : liuyaoBoard(post.oracle);
    const answer = !isHelp && post.answer ? h("section", { class: "answer-card", "aria-label": "AI 解读" },
      h("header", { class: "answer-head" },
        h("span", { class: "answer-mark", "aria-hidden": "true" }, icon("sparkle")),
        h("div", null, h("h2", null, "解答"), h("p", null, post.ai_disclosure || "AI 生成解读，仅供传统文化研究与娱乐参考"))),
      renderMarkdown(post.answer)) : null;
    const updates = Array.isArray(post.updates) && post.updates.length ? h("section", { class: "updates", "aria-label": "卦主后续" },
      h("h2", { class: "block-title" }, "卦主后续"),
      h("ol", { class: "timeline" }, post.updates.map(update => h("li", null,
        h("div", { class: "timeline-head" },
          h("span", { class: ["chip", update.verification_status === "verified" ? "chip-ok" : "chip-gold"] }, update.verification_status_label || "待观察"),
          h("time", { datetime: update.created_at || "", title: fullTime(update.created_at) }, relativeTime(update.created_at))),
        h("p", null, update.body || ""))))) : null;

    if (!composer) composer = buildComposer();
    ui.list = h("div", { class: "comment-list" });
    ui.count = h("span", { class: "discussion-count tnum", "data-comment-count": "" }, `${commentTotal()} 条`);
    ui.home = h("div", { class: "composer-home" });
    const discussion = h("section", { class: "discussion", id: "discussion", "aria-label": isHelp ? "回答与讨论" : "评论" },
      h("div", { class: "discussion-head" },
        h("h2", { class: "block-title" }, isHelp ? "回答与讨论" : "评论"),
        ui.count),
      post.comments_enabled ? ui.home : h("p", { class: "comments-closed" }, "这条卦帖暂未开放评论。"),
      ui.list);
    ui.viewers = h("span", null, `${count(post.viewer_count || post.view_count)} 人看过`);
    ui.status = statusChip();

    mainCol.replaceChildren(
      backLink(),
      h("article", { class: "post-article" },
        h("header", { class: "post-head" },
          h("div", { class: "post-author" },
            avatar(post.author_name || "卦友", "lg"),
            h("div", null,
              h("b", null, post.author_name || "卦友"),
              h("span", null,
                h("time", { datetime: post.published_at || post.created_at || "", title: fullTime(post.published_at || post.created_at) }, relativeTime(post.published_at || post.created_at)),
                " · ", ui.viewers))),
          h("div", { class: "post-tags" },
            h("span", { class: ["chip", post.system === "bazi" ? "chip-bazi" : "chip-liuyao"] }, systemLabel),
            post.question_type_label ? h("span", { class: "chip" }, post.question_type_label) : null,
            ui.status,
            post.is_featured ? h("span", { class: "chip chip-gold" }, icon("award"), "精选") : null),
          h("h1", { class: "post-title" }, post.question || post.title || "卦帖")),
        board,
        answer,
        updates,
        h("div", { class: "post-actions" }, likeBtn, ui.follow, shareBtn, h("span", { class: "post-actions-spacer" }), primary)),
      discussion);
    renderComments();

    // 右栏：行动 + 同类问题
    sideCol.replaceChildren(
      h("section", { class: "side-card side-cta" },
        h("h2", null, "你也有类似的事？"),
        h("p", null, isHelp ? "起一卦，或者把你的命盘发到社区，请大家帮你看。" : "写下你的问题，AI 解读之外，还有卦友一起讨论。"),
        h("div", { class: "side-cta-actions" },
          h("a", { class: "btn btn-primary btn-sm", href: "#/ask/liuyao" }, icon("gua"), "六爻问事"),
          h("a", { class: "btn btn-sm", href: "#/ask/bazi" }, icon("pillars"), "八字排盘"))),
      relatedBox());

    const mLike = h("button", { type: "button", class: ["react", post.viewer_liked && "is-on"], "aria-pressed": String(!!post.viewer_liked), "aria-label": `点赞，当前 ${post.like_count || 0}`, "data-like": post.slug }, icon("heart"), h("span", { class: "tnum" }, count(post.like_count)));
    mLike.addEventListener("click", () => likePost(post, mLike));
    mobileBar.replaceChildren(
      post.comments_enabled
        ? h("button", { type: "button", class: "mobilebar-input", onClick: () => focusComposer() }, icon("comment"), isHelp ? "写下你的判断…" : "说说你的看法…")
        : h("span", { class: "mobilebar-input is-disabled" }, "暂未开放评论"),
      mLike,
      h("button", { type: "button", class: "icon-btn", "aria-label": "分享", onClick: () => share(ui.share) }, icon("share")));
  }

  function renderComments() {
    const field = composer?.textarea;
    const focused = !!field && document.activeElement === field;
    const comments = Array.isArray(post.comments) ? post.comments : [];
    const context = { post, onReply: startReply, onAccept: acceptComment };
    if (!comments.length) {
      const isHelp = post.post_kind === "help";
      ui.list.replaceChildren(h("div", { class: "comments-empty" },
        icon(isHelp ? "hand" : "comment"),
        h("p", null, isHelp ? "还没有人回答。你的一句判断，可能正是对方需要的。" : "还没有评论，来说说你的看法。")));
    } else {
      ui.list.replaceChildren(...comments.map(comment => commentNode(comment, context)));
    }
    placeComposer();
    if (focused && document.activeElement !== field) field.focus({ preventScroll: true });
    clampLong(ui.list, { skip: new Set(targetId.startsWith("comment-") ? [targetId.slice(8)] : []), expanded });
  }

  function relatedBox() {
    const listNode = h("div", { class: "side-seeking-list" });
    const box = h("section", { class: "side-card side-related" }, h("div", { class: "side-head" }, h("h2", null, "同类问题")), listNode);
    const fill = items => {
      const shown = (items || []).filter(item => item.slug !== post.slug).slice(0, 4);
      if (!shown.length) {
        box.remove();
        return;
      }
      listNode.replaceChildren(...shown.map(item => h("a", { class: "seeking-item", href: `#/post/${encodeURIComponent(item.slug)}` },
        h("span", { class: "seeking-q" }, item.question),
        h("span", { class: "seeking-meta" },
          `${item.comment_count || 0} 条讨论`, h("span", { "aria-hidden": "true" }, "·"), relativeTime(item.published_at || item.created_at)))));
    };
    if (related) {
      fill(related);
      return box;
    }
    listNode.replaceChildren(...[0, 1, 2].map(() => h("span", { class: "skel skel-line", style: { height: "36px", borderRadius: "10px" } })));
    // 同一次打开只取一次；关注、采纳等重绘直接复用。
    relatedRequest ||= get(`/api/community/posts${query({ limit: 6, view: "latest", include_oracle_summary: "true", question_type: post.question_type || "", system: post.system || "" })}`, { cache: "no-store" })
      .then(data => { related = Array.isArray(data?.items) ? data.items : []; });
    relatedRequest.then(() => { if (ctx.isCurrent()) fill(related); }).catch(() => { relatedRequest = null; box.remove(); });
    return box;
  }

  // 从消息里的「查看回复」进来：滚到那条评论并闪一下；返回浏览时不打断原来的位置。
  function revealTarget() {
    if (targetDone) return;
    const node = root.querySelector(`#${CSS.escape(targetId)}`);
    if (!node) return;
    targetDone = true;
    requestAnimationFrame(() => {
      if (!ctx.isCurrent() || !node.isConnected || restoring) return;
      node.scrollIntoView({ block: "center" });
      node.classList.add("is-target");
    });
  }

  /* ---------- 评论编辑器 ---------- */
  function buildComposer() {
    const readingLabel = post.system === "bazi" ? "命盘判断" : "断卦回复";
    const placeholder = post.post_kind === "help" ? "说说你的判断和依据……" : "写下你的看法……";
    const saved = local.json(draftKey(slug), null);
    const textarea = h("textarea", {
      class: "textarea composer-input",
      name: "body",
      maxlength: COMMENT_MAX,
      rows: 3,
      placeholder,
      "aria-label": "回复内容",
    });
    textarea.value = saved?.body || "";
    const reading = h("input", { type: "checkbox", name: "reading_reply" });
    reading.checked = !!saved?.reading;
    const counter = h("span", { class: "composer-count tnum" });
    const status = h("p", { class: "composer-status", role: "status" });
    const replyChip = h("div", { class: "reply-chip", hidden: true });
    const submit = h("button", { type: "submit", class: "btn btn-primary btn-sm composer-submit" }, icon("send"), "发布");
    const hint = h("span", { class: "composer-hint", "aria-hidden": "true" }, IS_MAC ? "⌘ + Enter 发布" : "Ctrl + Enter 发布");
    const identity = h("span", { class: "composer-identity" });
    const field = h("div", { class: "composer-field" }, replyChip, textarea);
    const row = h("div", { class: "composer-row" }, h("span"), field);
    const syncIdentity = () => {
      const current = session.get();
      identity.textContent = current.authenticated
        ? (current.user?.nickname ? `显示为 ${current.user.nickname}` : "显示匿名编号")
        : "发布时登录 · 显示昵称或匿名编号";
      row.firstElementChild.replaceWith(current.authenticated ? avatar(displayName(current.user), "sm") : h("span", { class: "composer-mark", "aria-hidden": "true" }, icon("feather")));
    };
    syncIdentity();
    ctx.subscribe(session, syncIdentity);

    const updateCounter = () => {
      const length = textarea.value.length;
      counter.textContent = `${length} / ${COMMENT_MAX}`;
      counter.classList.toggle("is-near", length >= COMMENT_MAX * 0.9);
    };
    const setStatus = (text = "", tone = "") => {
      status.textContent = text;
      if (tone) status.dataset.tone = tone;
      else delete status.dataset.tone;
    };
    const saveDraft = () => {
      updateCounter();
      if (textarea.value.trim() || reading.checked) {
        local.setJson(draftKey(slug), {
          body: textarea.value,
          reading: reading.checked,
          reply: replyTo ? { id: replyTo.id, parent_id: replyTo.parent_id || null, author_name: replyTo.author_name } : null,
        });
      } else local.remove(draftKey(slug));
    };
    textarea.addEventListener("input", () => {
      if (status.dataset.tone === "error" || status.dataset.tone === "done") setStatus();
      saveDraft();
    });
    reading.addEventListener("change", saveDraft);
    const fit = autoGrow(textarea, 260);
    updateCounter();

    const form = h("form", { class: "composer", novalidate: true },
      row,
      h("div", { class: "composer-tools" },
        h("label", { class: "check composer-check" }, reading, h("span", null, readingLabel)),
        identity,
        h("span", { class: "composer-meta" }, hint, counter),
        submit),
      status);

    // 长评论：回车换行，Ctrl / ⌘ + 回车发布（中文输入法选词时的回车不会触发）。
    submitOnEnter(textarea, () => (form.requestSubmit ? form.requestSubmit() : submit.click()), { mode: "compose" });
    textarea.addEventListener("keydown", event => {
      if (event.key === "Escape" && replyTo && !event.isComposing) {
        event.preventDefault();
        cancelReply({ returnFocus: true });
      }
    });

    let sending = false;
    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (sending) return;
      const text = textarea.value.trim();
      if (!text) {
        setStatus("先写下你的看法。", "error");
        textarea.focus();
        return;
      }
      if (text.length > COMMENT_MAX) {
        setStatus(`最多 ${COMMENT_MAX} 字。`, "error");
        return;
      }
      sending = true;
      busy += 1;
      try {
        if (!session.get().authenticated) {
          setStatus("登录后继续发布，刚才写的内容会保留。");
          const ok = await ctx.requireAuth("登录后继续发布，刚才写的内容会保留。");
          if (!ok) {
            setStatus("内容已保留，登录后可发布。");
            return;
          }
          if (!ctx.isCurrent()) return;
        }
        await send(text);
      } finally {
        sending = false;
        settle();
      }
    });

    async function send(text) {
      const target = replyTo;
      const kind = reading.checked ? "reading" : "discussion";
      const author = session.get().user?.nickname || "我";
      setStatus("");
      submit.setAttribute("aria-disabled", "true");
      submit.classList.add("is-busy");
      submit.replaceChildren(h("span", { class: "spinner", "aria-hidden": "true" }), "发布中…");
      // 先把这条放进讨论串（标着「发送中」），成功后换成正式的一条；失败就撤下，文字仍在输入框里。
      const pending = commentNode({ id: 0, author_name: author, body: text, kind, kind_label: kind === "reading" ? readingLabel : "参与讨论", parent_id: target ? (target.parent_id || target.id) : null },
        { post, onReply: startReply, onAccept: acceptComment, pending: true });
      placeCommentNode(pending, target ? (target.parent_id || target.id) : null);
      try {
        const result = await apiPost(`${path}/comments`, {
          body: text,
          parent_id: target ? Number(target.id) || null : null,
          kind,
        });
        // 已发出：即使读者已经离开本页也清掉草稿，回来时不会看到已发布的内容。
        local.remove(draftKey(slug));
        invalidateCached(path);
        if (!ctx.isCurrent()) return;
        const item = result?.item || {};
        // 发送途中又写了新内容就保留新内容，否则清空。
        if (textarea.value.trim() === text) {
          textarea.value = "";
          reading.checked = false;
          fit();
        }
        saveDraft();
        const node = settleComment(pending, item);
        if (target) cancelReply();
        setStatus(`已发布，显示为 ${item.author_name || "匿名卦友"}`, "done");
        syncPost(slug, { comment_count: post.comment_count });
        revealComment(node);
        toast(target ? "回复已发布" : "评论已发布", { type: "ok" });
      } catch (error) {
        const holder = pending.parentElement;
        pending.remove();
        if (holder?.classList.contains("replies") && !holder.children.length) holder.remove();
        if (!ui.list.querySelector(".comment")) renderComments();
        if (!ctx.isCurrent()) return;
        if (error.status === 401 || error.status === 403) {
          refreshSession().catch(() => {});
          toast("登录已失效，请重新登录", { type: "error" });
          setStatus("内容已保留，重新登录后可发布。", "error");
        } else {
          setStatus(`${String(error.message || "发布没有成功").replace(/[。.！!]+$/, "")}。刚写的内容还在。`, "error");
        }
      } finally {
        submit.removeAttribute("aria-disabled");
        submit.classList.remove("is-busy");
        submit.replaceChildren(icon("send"), "发布");
      }
    }

    if (saved?.reply?.id) replyTo = { id: saved.reply.id, parent_id: saved.reply.parent_id || null, author_name: saved.reply.author_name || "卦友" };

    return {
      node: form,
      textarea,
      saveDraft,
      showReply(reply) {
        replyChip.hidden = false;
        replyChip.replaceChildren(icon("reply", "icon-sm"), h("span", null, `回复 ${reply.author_name}`),
          h("button", { type: "button", class: "reply-cancel", "aria-label": `取消回复 ${reply.author_name}`, onClick: () => cancelReply({ returnFocus: true }) }, icon("close", "icon-sm")));
        textarea.placeholder = `回复 ${reply.author_name}…`;
        textarea.setAttribute("aria-label", `回复 ${reply.author_name}`);
      },
      hideReply() {
        replyChip.hidden = true;
        replyChip.replaceChildren();
        textarea.placeholder = placeholder;
        textarea.setAttribute("aria-label", "回复内容");
      },
    };
  }

  // 编辑器平时在讨论区顶部；回复某条评论时搬到这条讨论串的末尾（新回复出现的位置），
  // 读者不用离开上下文，窄屏上也保留整行宽度。
  function placeComposer() {
    if (!composer || !ui.home || !post?.comments_enabled) return;
    const node = composer.node;
    let slot = null;
    if (replyTo) {
      const exists = ui.list.querySelector(`.comment[data-comment-id="${CSS.escape(String(replyTo.id))}"]`);
      slot = exists ? ui.list.querySelector(`:scope > .comment[data-comment-id="${CSS.escape(String(replyTo.parent_id || replyTo.id))}"]`) : null;
      if (!slot) replyTo = null;
    }
    if (replyTo) composer.showReply(replyTo);
    else composer.hideReply();
    node.classList.toggle("is-inline", !!slot);
    if (slot) {
      if (slot.nextElementSibling !== node) slot.after(node);
    } else if (node.parentNode !== ui.home) {
      ui.home.append(node);
    }
  }

  function focusComposer() {
    if (!composer || !post?.comments_enabled) {
      toast("这条卦帖暂未开放评论");
      return;
    }
    focusField();
  }

  // 在点击当下同步聚焦（iOS 只在用户手势里弹出键盘），再把编辑器带到视口中间。
  function focusField() {
    const field = composer.textarea;
    field.focus({ preventScroll: true });
    const rect = composer.node.getBoundingClientRect();
    const bottom = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    if (rect.top < stickyTop() || rect.bottom > bottom - 16) {
      composer.node.scrollIntoView({ block: "center", behavior: coarsePointer() || reducedMotion() ? "auto" : "smooth" });
    }
  }

  function startReply(comment, trigger) {
    if (!composer || !post?.comments_enabled) return;
    const commentId = comment.id;
    replyTo = { id: commentId, parent_id: comment.parent_id || null, author_name: comment.author_name || "卦友" };
    // 编辑器离开讨论区顶部时，保持被回复的这条评论在原处。
    keepPlace(() => trigger?.isConnected ? trigger : null, () => placeComposer());
    composer.saveDraft();
    focusField();
  }

  function cancelReply({ returnFocus = false } = {}) {
    if (!replyTo) return;
    const id = String(replyTo.id);
    replyTo = null;
    const trigger = () => ui.list?.querySelector(`.comment[data-comment-id="${CSS.escape(id)}"] [data-reply]`);
    keepPlace(trigger, () => placeComposer());
    composer.saveDraft();
    if (returnFocus) trigger()?.focus({ preventScroll: true });
  }

  function placeCommentNode(node, parentId) {
    ui.list.querySelector(".comments-empty")?.remove();
    if (parentId) {
      const parent = ui.list.querySelector(`:scope > .comment[data-comment-id="${CSS.escape(String(parentId))}"]`);
      const main = parent?.querySelector(":scope > .comment-main");
      if (main) {
        let replies = main.querySelector(":scope > .replies");
        if (!replies) {
          replies = h("div", { class: "replies" });
          main.append(replies);
        }
        replies.append(node);
        return;
      }
    }
    ui.list.append(node);
  }

  // 把服务端返回的评论写回数据，并替换「发送中」的那条。
  function settleComment(pending, item) {
    const comments = Array.isArray(post.comments) ? post.comments : (post.comments = []);
    const parentId = item.parent_id ? Number(item.parent_id) : null;
    const parent = parentId
      ? comments.find(entry => Number(entry.id) === parentId || (entry.replies || []).some(reply => Number(reply.id) === parentId))
      : null;
    if (parent) {
      parent.replies = Array.isArray(parent.replies) ? parent.replies : [];
      parent.replies.push(item);
    } else {
      comments.push({ ...item, replies: item.replies || [] });
    }
    post.comment_count = (Number(post.comment_count) || 0) + 1;
    const node = commentNode(parent ? { ...item, parent_id: parent.id } : item, { post, onReply: startReply, onAccept: acceptComment });
    if (pending.isConnected) pending.replaceWith(node);
    else placeCommentNode(node, parent ? parent.id : null);
    if (ui.count) ui.count.textContent = `${commentTotal()} 条`;
    return node;
  }

  function revealComment(node) {
    node.setAttribute("tabindex", "-1");
    node.classList.add("is-new");
    const rect = node.getBoundingClientRect();
    const bottom = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    if (rect.top < stickyTop() || rect.bottom > bottom - 120) {
      node.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
    }
    node.focus({ preventScroll: true });
  }

  /* ---------- 采纳、关注、分享 ---------- */
  let accepting = false;
  async function acceptComment(comment, button) {
    if (accepting) return;
    const ok = await confirmDialog({
      title: "采纳这条回答？",
      message: `采纳「${comment.author_name || "卦友"}」的回答后，这条求助会标记为已解决。每条求助只能采纳一条回答。`,
      confirmText: "采纳",
      cancelText: "再想想",
    });
    if (!ok || !ctx.isCurrent()) return;
    accepting = true;
    busy += 1;
    button.setAttribute("aria-disabled", "true");
    button.replaceChildren(h("span", { class: "spinner", "aria-hidden": "true" }), "正在采纳…");
    try {
      const result = await apiPost(`${path}/resolve`, { comment_id: Number(comment.id) }, { interaction: true });
      if (!ctx.isCurrent()) return;
      post.accepted_comment_id = result?.accepted_comment_id || comment.id;
      post.help_status = result?.help_status || "resolved";
      post.help_status_label = result?.help_status_label || "已解决";
      (post.comments || []).forEach(entry => { entry.accepted = Number(entry.id) === Number(post.accepted_comment_id); });
      invalidateCached(path);
      syncPost(slug, { help_status: post.help_status, help_status_label: post.help_status_label });
      const find = () => document.getElementById(`comment-${post.accepted_comment_id}`);
      keepPlace(find, () => renderComments());
      const fresh = statusChip();
      ui.status?.replaceWith(fresh);
      ui.status = fresh;
      const node = find();
      if (node) {
        node.setAttribute("tabindex", "-1");
        node.classList.add("is-new");
        node.focus({ preventScroll: true });
      }
      toast("已采纳，这条求助已标记为解决", { type: "ok" });
    } catch (error) {
      if (button.isConnected) {
        button.removeAttribute("aria-disabled");
        button.replaceChildren(icon("check"), "采纳这条回答");
      }
      toast(error.message || "采纳没有成功", { type: "error" });
    } finally {
      accepting = false;
      settle();
    }
  }

  let following = false;
  async function toggleFollow() {
    if (following || !post) return;
    // 按点下时的意图：点「关注」就是关注，登录回来拿到新数据也不会变成取消。
    const next = !post.viewer_following;
    following = true;
    busy += 1;
    try {
      if (!session.get().authenticated) {
        const ok = await ctx.requireAuth("登录后关注；新回答会提醒。");
        if (!ok || !ctx.isCurrent()) return;
      }
      const before = { on: !!post.viewer_following, total: Number(post.follow_count) || 0 };
      post.viewer_following = next;
      post.follow_count = Math.max(0, before.total + (next === before.on ? 0 : next ? 1 : -1));
      renderFollow();
      try {
        const result = await apiPost(`${path}/follow`, { following: next }, { interaction: true });
        post.viewer_following = !!result?.following;
        if (typeof result?.follow_count === "number") post.follow_count = result.follow_count;
        renderFollow();
        invalidateCached(path);
        toast(post.viewer_following ? "已关注，有新回答会提醒你" : "已取消关注", { type: "ok" });
      } catch (error) {
        post.viewer_following = before.on;
        post.follow_count = before.total;
        renderFollow();
        toast(error.message || "关注没有成功", { type: "error", action: { label: "重试", onClick: () => toggleFollow() } });
      }
    } finally {
      following = false;
      settle();
    }
  }

  let sharing = false;
  async function share(button) {
    if (!post || sharing || document.querySelector(".sheet-share")) return;
    if (post.post_kind === "ai" && post.system === "liuyao" && post.answer && post.oracle) {
      openShareSheet(post);
      return;
    }
    sharing = true;
    button?.setAttribute("aria-busy", "true");
    try {
      const result = await sharePost({ slug: post.slug, title: post.question || post.title });
      if (!result.silent && result.message) toast(result.message, { type: result.ok ? "ok" : "error" });
    } finally {
      sharing = false;
      button?.removeAttribute("aria-busy");
    }
  }

  // 手机键盘弹出后可视区域变矮：输入时让编辑器底部（发布按钮）留在键盘上方，但不把输入框顶出顶栏。
  const viewport = window.visualViewport;
  if (viewport) {
    let frame = 0;
    const keepVisible = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!composer || document.activeElement !== composer.textarea || !ctx.isCurrent()) return;
        const rect = composer.node.getBoundingClientRect();
        const visibleBottom = viewport.offsetTop + viewport.height;
        const room = rect.top - (viewport.offsetTop + stickyTop()) - 8;
        const delta = Math.min(rect.bottom + 8 - visibleBottom, room);
        if (delta > 1) window.scrollBy(0, delta);
      });
    };
    viewport.addEventListener("resize", keepVisible);
    ctx.cleanup(() => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", keepVisible);
    });
  }

  // 同类问题与其它帖子链接：预取详情，应用内导航（返回回到这条帖子的原位置）。
  wirePostLinks(root, ctx, { beforeOpen: () => { if (post) readPos.set(slug, window.scrollY); } });

  // 登录状态变化会改变可管理、已关注等个人字段：重新取一次，保留未发布的草稿。
  let lastAuth = session.get().authenticated;
  ctx.subscribe(session, state => {
    if (!state.ready || state.authenticated === lastAuth) return;
    lastAuth = state.authenticated;
    if (busy) reloadWhenIdle = true;
    else load({ countView: false, fresh: true });
  });

  // 记住阅读位置（只在本页仍是当前页时记，避免浏览器前进后退时把别的页面的位置记进来）。
  const myHash = location.hash;
  let posTimer = 0;
  const savePos = () => {
    clearTimeout(posTimer);
    posTimer = setTimeout(() => {
      if (ctx.isCurrent() && location.hash === myHash && post) readPos.set(slug, window.scrollY);
    }, 150);
  };
  window.addEventListener("scroll", savePos, { passive: true });
  ctx.cleanup(() => {
    clearTimeout(posTimer);
    window.removeEventListener("scroll", savePos);
  });

  const cached = peekCached(path, { ttl: DETAIL_TTL });
  if (cached) {
    post = cloneDetail(cached);
    paint();
    revealTarget();
  } else {
    mainCol.append(backLink(), skeleton());
  }
  load();

  return {
    node: root,
    title: post ? (post.question || post.title || "卦帖") : "卦帖",
    layout: "post",
    onRestore() {
      restoring = true;
      // 已经秒开的内容直接按自己记下的位置对齐（浏览器自带的恢复可能被上一页的高度截断）。
      if (post && readPos.has(slug)) {
        const y = readPos.get(slug);
        requestAnimationFrame(() => { if (ctx.isCurrent()) window.scrollTo(0, y); });
      }
    },
  };
}

// 分享面板：先给出复制链接，同时生成一张带二维码的分享长图。
function openShareSheet(post) {
  const title = post.question || post.title || "玄枢卦帖";
  const preview = h("div", { class: "share-preview", "aria-busy": "true" }, h("div", { class: "spinner-line" }, h("span", { class: "spinner", "aria-hidden": "true" }), "正在生成分享长图…"));
  const actions = h("div", { class: "share-actions" });
  const copyBtn = h("button", { type: "button", class: "btn" }, icon("copy"), "复制标题和链接");
  let copying = false;
  copyBtn.addEventListener("click", async () => {
    if (copying) return;
    copying = true;
    try {
      const result = await sharePost({ slug: post.slug, title });
      if (!result.silent && result.message) toast(result.message, { type: result.ok ? "ok" : "error" });
    } finally {
      copying = false;
    }
  });
  actions.append(copyBtn);
  const sheet = openSheet({ title: "分享这条卦帖", body: h("div", { class: "share-sheet" }, preview, actions), wide: false, className: "sheet-share" });
  let objectUrl = "";
  const cleanup = () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  renderShareImage(post).then(image => {
    if (!document.contains(sheet.panel)) return;
    objectUrl = URL.createObjectURL(image.blob);
    trackShare(post.slug, "image_preview", "community_share");
    preview.removeAttribute("aria-busy");
    preview.replaceChildren(h("img", { src: objectUrl, alt: `分享长图：${title}`, class: "share-image" }),
      h("p", { class: "share-hint" }, window.matchMedia?.("(pointer: coarse)").matches ? "长按图片保存或发给朋友" : "图片里的二维码可以直接扫码查看全文", image.attributed ? " · 已记录你的邀请归因" : ""));
    const file = typeof File === "function" ? new File([image.blob], image.filename || "玄枢卦帖.png", { type: "image/png" }) : null;
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      actions.prepend(h("button", { type: "button", class: "btn btn-primary", onClick: async () => {
        try {
          await navigator.share({ files: [file], title });
          trackShare(post.slug, "image_native", "community_share");
        } catch (error) {
          if (error?.name !== "AbortError") toast("分享没有成功，可以先保存图片", { type: "error" });
        }
      } }, icon("share"), "分享图片"));
    }
    if (!window.matchMedia?.("(pointer: coarse)").matches) {
      const save = h("a", { class: "btn btn-primary", href: objectUrl, download: image.filename || "玄枢卦帖.png", onClick: () => trackShare(post.slug, "image_save", "community_share") }, icon("arrowUp"), "保存图片");
      save.querySelector(".icon")?.setAttribute("style", "transform: rotate(180deg)");
      actions.prepend(save);
    }
  }).catch(error => {
    preview.removeAttribute("aria-busy");
    preview.replaceChildren(h("p", { class: "share-hint" }, error?.message || "长图生成失败，可以先复制链接分享"));
  });
  const observer = new MutationObserver(() => { if (!document.contains(sheet.panel)) { cleanup(); observer.disconnect(); } });
  observer.observe(document.body, { childList: true });
}

export { liuyaoBoard, baziBoard, renderMarkdown };
