// 帖子详情：一条问题的完整讨论串。桌面左侧讨论、右侧盘面速览与同类问题；手机底部固定评论栏。
import { h, autoGrow } from "../lib/dom.js?v=n1";
import { icon } from "../lib/icons.js?v=n1";
import { get, post as apiPost, query } from "../lib/api.js?v=n1";
import { session, displayName, local, refreshSession } from "../lib/store.js?v=n1";
import { relativeTime, fullTime, count } from "../lib/format.js?v=n1";
import { avatar, errorView } from "../ui/bits.js?v=n1";
import { guaGlyph, elementClass } from "../ui/gua.js?v=n1";
import { toast } from "../ui/toast.js?v=n1";
import { sharePost, renderShareImage, copyText, trackShare } from "../lib/share.js?v=n1";
import { openSheet } from "../ui/overlay.js?v=n1";
import { likePost } from "./feed.js?v=n1";

const COMMENT_MAX = 500;
const draftKey = slug => `xz-next-draft:comment:${slug}`;

function renderMarkdown(markdown) {
  const renderer = window.XuanxueChatRenderer;
  const box = h("div", { class: "prose" });
  if (renderer && typeof renderer.renderBody === "function") box.innerHTML = renderer.renderBody(markdown);
  else box.textContent = markdown;
  return box;
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
  const { post, onReply, onAccept } = context;
  const accepted = comment.accepted || (post.accepted_comment_id && Number(post.accepted_comment_id) === Number(comment.id));
  const isTop = !comment.parent_id;
  const canAccept = isTop && post.post_kind === "help" && post.can_manage && !post.accepted_comment_id && !accepted;
  const node = h("article", { class: ["comment", accepted && "is-accepted"], id: comment.id ? `comment-${comment.id}` : null, "data-comment-id": comment.id || "" },
    avatar(comment.author_name || "卦友", "sm"),
    h("div", { class: "comment-main" },
      h("header", { class: "comment-head" },
        h("b", null, comment.author_name || "卦友"),
        comment.kind === "reading" || (comment.kind_label && comment.kind_label !== "参与讨论")
          ? h("span", { class: "chip chip-liuyao comment-kind" }, comment.kind_label || "判断") : null,
        accepted ? h("span", { class: "chip chip-ok" }, icon("check"), "已采纳") : null,
        h("time", { datetime: comment.created_at || "", title: fullTime(comment.created_at) }, relativeTime(comment.created_at))),
      h("p", { class: "comment-body" }, comment.body || ""),
      comment.reasoning ? h("p", { class: "comment-extra" }, h("span", null, "判断依据"), comment.reasoning) : null,
      comment.prediction ? h("p", { class: "comment-extra" }, h("span", null, "应期 / 结果"), comment.prediction) : null,
      Array.isArray(comment.referenced_lines) && comment.referenced_lines.length
        ? h("p", { class: "comment-extra" }, h("span", null, "参考爻位"), comment.referenced_lines.join("、")) : null,
      h("div", { class: "comment-actions" },
        post.comments_enabled ? h("button", { type: "button", class: "comment-action", onClick: () => onReply(comment) }, icon("reply"), "回复") : null,
        canAccept ? h("button", { type: "button", class: "comment-action is-accept", onClick: event => onAccept(comment, event.currentTarget) }, icon("check"), "采纳这条回答") : null)));
  const replies = Array.isArray(comment.replies) ? comment.replies : [];
  if (replies.length) {
    node.querySelector(".comment-main").append(h("div", { class: "replies" }, replies.map(reply => commentNode({ ...reply, parent_id: reply.parent_id || comment.id }, context))));
  }
  return node;
}

export function render(ctx) {
  const slug = ctx.params.slug;
  const root = h("div", { class: "post-layout" });
  const mainCol = h("div", { class: "post-main" });
  const sideCol = h("aside", { class: "post-side", "aria-label": "盘面与相关问题" });
  const mobileBar = h("div", { class: "post-mobilebar" });
  root.append(mainCol, sideCol, mobileBar);

  mainCol.append(
    h("button", { type: "button", class: "back-link", onClick: () => ctx.back("/") }, icon("back"), "返回"),
    h("div", { class: "post-loading" },
      h("span", { class: "skel skel-line", style: { width: "160px" } }),
      h("span", { class: "skel skel-title", style: { height: "30px", width: "86%" } }),
      h("span", { class: "skel skel-title", style: { height: "30px", width: "54%" } }),
      h("span", { class: "skel", style: { height: "220px", borderRadius: "18px", marginTop: "12px" } }),
      h("span", { class: "skel skel-line", style: { width: "96%" } }),
      h("span", { class: "skel skel-line", style: { width: "88%" } })));

  let post = null;
  let replyTo = null;
  let composer = null;

  async function load({ countView = true } = {}) {
    try {
      const [detail, view] = await Promise.all([
        get(`/api/community/posts/${encodeURIComponent(slug)}`, { cache: "no-store" }),
        countView
          ? apiPost(`/api/community/posts/${encodeURIComponent(slug)}/view`, undefined, { interaction: true, keepalive: true }).catch(() => null)
          : Promise.resolve(null),
      ]);
      if (!ctx.isCurrent()) return;
      post = { ...detail };
      if (view) {
        ["like_count", "view_count", "viewer_count"].forEach(key => { if (typeof view[key] === "number") post[key] = view[key]; });
        if (typeof view.liked === "boolean") post.viewer_liked = view.liked || post.viewer_liked;
      }
      paint();
      const target = ctx.query.get("target");
      if (target) {
        requestAnimationFrame(() => {
          const node = document.getElementById(target);
          if (node) {
            node.scrollIntoView({ block: "center" });
            node.classList.add("is-target");
          }
        });
      }
    } catch (error) {
      if (!ctx.isCurrent()) return;
      loadFailed = error.status !== 404;
      mainCol.replaceChildren(
        h("button", { type: "button", class: "back-link", onClick: () => ctx.back("/") }, icon("back"), "返回"),
        errorView(error, () => { loadFailed = false; mainCol.replaceChildren(); load(); }, { title: error.status === 404 ? "这条帖子不存在或已下线" : "帖子没能加载出来" }));
    }
  }

  // 断线恢复：网络恢复后自动重新打开没载入的帖子（不重复计浏览）。
  let loadFailed = false;
  const recover = () => {
    if (!ctx.isCurrent() || !loadFailed) return;
    loadFailed = false;
    mainCol.replaceChildren();
    load({ countView: false });
  };
  window.addEventListener("online", recover);
  ctx.cleanup(() => window.removeEventListener("online", recover));

  function paint() {
    const isHelp = post.post_kind === "help";
    const resolved = post.help_status === "resolved";
    const systemLabel = post.system_label || (post.system === "bazi" ? "八字" : "六爻");
    ctx.setTitle(post.question || post.title || "卦帖");

    const likeBtn = h("button", { type: "button", class: ["react", "react-lg", post.viewer_liked && "is-on"], "aria-pressed": String(!!post.viewer_liked), "aria-label": `点赞，当前 ${post.like_count || 0}` },
      icon("heart"), h("span", { class: "tnum" }, count(post.like_count)));
    likeBtn.addEventListener("click", () => likePost(post, likeBtn));
    const followBtn = isHelp ? h("button", { type: "button", class: ["btn", "btn-sm", post.viewer_following ? "btn-soft" : ""], "aria-pressed": String(!!post.viewer_following) },
      icon("bookmark"), post.viewer_following ? "已关注" : "关注进展", post.follow_count ? h("span", { class: "tnum follow-count" }, String(post.follow_count)) : null) : null;
    followBtn?.addEventListener("click", () => toggleFollow(followBtn));
    const shareBtn = h("button", { type: "button", class: "btn btn-sm" }, icon("share"), "分享");
    shareBtn.addEventListener("click", async () => {
      if (post.post_kind === "ai" && post.system === "liuyao" && post.answer && post.oracle) {
        openShareSheet(post);
        return;
      }
      const result = await sharePost({ slug: post.slug, title: post.question || post.title });
      if (!result.silent && result.message) toast(result.message, { type: result.ok ? "ok" : "error" });
    });
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

    composer = buildComposer();
    const comments = Array.isArray(post.comments) ? post.comments : [];
    const list = h("div", { class: "comment-list" });
    const renderList = () => {
      const context = { post, onReply: startReply, onAccept: acceptComment };
      if (!comments.length) {
        list.replaceChildren(h("div", { class: "comments-empty" },
          icon(isHelp ? "hand" : "comment"),
          h("p", null, isHelp ? "还没有人回答。你的一句判断，可能正是对方需要的。" : "还没有评论，来说说你的看法。")));
      } else {
        list.replaceChildren(...comments.map(comment => commentNode(comment, context)));
      }
    };
    renderList();
    paint.renderList = renderList;
    paint.comments = comments;

    const discussion = h("section", { class: "discussion", id: "discussion", "aria-label": isHelp ? "回答与讨论" : "评论" },
      h("div", { class: "discussion-head" },
        h("h2", { class: "block-title" }, isHelp ? "回答与讨论" : "评论"),
        h("span", { class: "discussion-count tnum", "data-comment-count": "" }, `${post.comment_count || comments.length} 条`)),
      post.comments_enabled ? composer.node : h("p", { class: "comments-closed" }, "这条卦帖暂未开放评论。"),
      list);

    mainCol.replaceChildren(
      h("button", { type: "button", class: "back-link", onClick: () => ctx.back("/") }, icon("back"), "返回"),
      h("article", { class: "post-article" },
        h("header", { class: "post-head" },
          h("div", { class: "post-author" },
            avatar(post.author_name || "卦友", "lg"),
            h("div", null,
              h("b", null, post.author_name || "卦友"),
              h("span", null,
                h("time", { datetime: post.published_at || post.created_at || "", title: fullTime(post.published_at || post.created_at) }, relativeTime(post.published_at || post.created_at)),
                " · ", `${count(post.viewer_count || post.view_count)} 人看过`))),
          h("div", { class: "post-tags" },
            h("span", { class: ["chip", post.system === "bazi" ? "chip-bazi" : "chip-liuyao"] }, systemLabel),
            post.question_type_label ? h("span", { class: "chip" }, post.question_type_label) : null,
            h("span", { class: ["chip", isHelp ? (resolved ? "chip-ok" : "chip-help") : "chip-outline"] },
              isHelp ? (resolved ? icon("check") : icon("hand")) : icon("sparkle"),
              isHelp ? (post.help_status_label || (resolved ? "已解决" : "求助中")) : (post.post_kind_label || "AI 解读")),
            post.is_featured ? h("span", { class: "chip chip-gold" }, icon("award"), "精选") : null),
          h("h1", { class: "post-title" }, post.question || post.title || "卦帖")),
        board,
        answer,
        updates,
        h("div", { class: "post-actions" }, likeBtn, followBtn, shareBtn, h("span", { class: "post-actions-spacer" }), primary)),
      discussion);

    // 右栏：盘面速览 + 同类问题 + 行动
    sideCol.replaceChildren(
      h("section", { class: "side-card side-cta" },
        h("h2", null, "你也有类似的事？"),
        h("p", null, isHelp ? "起一卦，或者把你的命盘发到社区，请大家帮你看。" : "写下你的问题，AI 解读之外，还有卦友一起讨论。"),
        h("div", { class: "side-cta-actions" },
          h("a", { class: "btn btn-primary btn-sm", href: "#/ask/liuyao" }, icon("gua"), "六爻问事"),
          h("a", { class: "btn btn-sm", href: "#/ask/bazi" }, icon("pillars"), "八字排盘"))),
      relatedBox());

    mobileBar.replaceChildren(
      post.comments_enabled
        ? h("button", { type: "button", class: "mobilebar-input", onClick: () => focusComposer() }, icon("comment"), isHelp ? "写下你的判断…" : "说说你的看法…")
        : h("span", { class: "mobilebar-input is-disabled" }, "暂未开放评论"),
      (() => {
        const mLike = h("button", { type: "button", class: ["react", post.viewer_liked && "is-on"], "aria-pressed": String(!!post.viewer_liked), "aria-label": "点赞" }, icon("heart"), h("span", { class: "tnum" }, count(post.like_count)));
        mLike.addEventListener("click", () => likePost(post, mLike).then(() => {
          likeBtn.classList.toggle("is-on", !!post.viewer_liked);
          likeBtn.querySelector("span").textContent = count(post.like_count);
        }));
        return mLike;
      })(),
      h("button", { type: "button", class: "icon-btn", "aria-label": "分享", onClick: () => shareBtn.click() }, icon("share")));
  }

  function relatedBox() {
    const box = h("section", { class: "side-card side-related" },
      h("div", { class: "side-head" }, h("h2", null, "同类问题")),
      h("div", { class: "side-seeking-list" }, [0, 1, 2].map(() => h("span", { class: "skel skel-line", style: { height: "36px", borderRadius: "10px" } }))));
    get(`/api/community/posts${query({ limit: 6, view: "latest", include_oracle_summary: "true", question_type: post.question_type || "", system: post.system || "" })}`, { cache: "no-store" })
      .then(data => {
        const items = (data?.items || []).filter(item => item.slug !== post.slug).slice(0, 4);
        const listNode = box.querySelector(".side-seeking-list");
        if (!items.length) { box.remove(); return; }
        listNode.replaceChildren(...items.map(item => h("a", { class: "seeking-item", href: `#/post/${encodeURIComponent(item.slug)}` },
          h("span", { class: "seeking-q" }, item.question),
          h("span", { class: "seeking-meta" },
            `${item.comment_count || 0} 条讨论`, h("span", { "aria-hidden": "true" }, "·"), relativeTime(item.published_at || item.created_at)))));
      })
      .catch(() => box.remove());
    return box;
  }

  /* ---------- 评论编辑器 ---------- */
  function buildComposer() {
    const state = session.get();
    const readingLabel = post.system === "bazi" ? "命盘判断" : "断卦回复";
    const saved = local.json(draftKey(slug), null);
    const textarea = h("textarea", {
      class: "textarea composer-input",
      name: "body",
      maxlength: COMMENT_MAX,
      rows: 3,
      placeholder: post.post_kind === "help" ? "说说你的判断和依据……" : "写下你的看法……",
      "aria-label": "回复内容",
    });
    textarea.value = saved?.body || "";
    const reading = h("input", { type: "checkbox", name: "reading_reply" });
    reading.checked = !!saved?.reading;
    const counter = h("span", { class: "composer-count tnum" }, `${textarea.value.length} / ${COMMENT_MAX}`);
    const status = h("p", { class: "composer-status", role: "status" });
    const replyChip = h("div", { class: "reply-chip", hidden: true });
    const submit = h("button", { type: "submit", class: "btn btn-primary btn-sm" }, icon("send"), "发布");
    const identity = h("span", { class: "composer-identity" });
    const syncIdentity = () => {
      const current = session.get();
      identity.textContent = current.authenticated
        ? (current.user?.nickname ? `显示为 ${current.user.nickname}` : "显示匿名编号")
        : "发布时登录 · 显示昵称或匿名编号";
    };
    syncIdentity();
    ctx.subscribe(session, syncIdentity);
    const saveDraft = () => {
      counter.textContent = `${textarea.value.length} / ${COMMENT_MAX}`;
      if (textarea.value.trim() || reading.checked) local.setJson(draftKey(slug), { body: textarea.value, reading: reading.checked });
      else local.remove(draftKey(slug));
    };
    textarea.addEventListener("input", saveDraft);
    reading.addEventListener("change", saveDraft);
    autoGrow(textarea, 260);

    const form = h("form", { class: "composer", novalidate: true },
      h("div", { class: "composer-row" },
        state.authenticated ? avatar(displayName(state.user), "sm") : h("span", { class: "composer-mark", "aria-hidden": "true" }, icon("feather")),
        h("div", { class: "composer-field" }, replyChip, textarea)),
      h("div", { class: "composer-tools" },
        h("label", { class: "check composer-check" }, reading, h("span", null, readingLabel)),
        identity,
        counter,
        submit),
      status);

    form.addEventListener("submit", async event => {
      event.preventDefault();
      const text = textarea.value.trim();
      if (!text) {
        status.textContent = "先写下你的看法。";
        textarea.focus();
        return;
      }
      if (text.length > COMMENT_MAX) {
        status.textContent = `最多 ${COMMENT_MAX} 字。`;
        return;
      }
      if (!session.get().authenticated) {
        status.textContent = "登录后继续发布，刚才写的内容会保留。";
        const ok = await ctx.requireAuth("登录后继续发布，刚才写的内容会保留。");
        if (!ok) {
          status.textContent = "内容已保留，登录后可发布。";
          return;
        }
      }
      submit.disabled = true;
      submit.textContent = "正在发布…";
      status.textContent = "";
      try {
        const result = await apiPost(`/api/community/posts/${encodeURIComponent(slug)}/comments`, {
          body: text,
          parent_id: replyTo ? Number(replyTo.id) || null : null,
          kind: reading.checked ? "reading" : "discussion",
        });
        if (!ctx.isCurrent()) return;
        const item = result?.item || {};
        appendComment(item);
        textarea.value = "";
        reading.checked = false;
        local.remove(draftKey(slug));
        counter.textContent = `0 / ${COMMENT_MAX}`;
        cancelReply();
        status.textContent = `已发布，显示为 ${item.author_name || "匿名卦友"}`;
        toast("评论已发布", { type: "ok" });
        requestAnimationFrame(() => document.getElementById(`comment-${item.id}`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
      } catch (error) {
        if (error.status === 401 || error.status === 403) {
          refreshSession().catch(() => {});
          toast("登录已失效，请重新登录", { type: "error" });
          status.textContent = "内容已保留，重新登录后可发布。";
        } else {
          status.textContent = error.message || "回复发布失败";
        }
      } finally {
        submit.disabled = false;
        submit.replaceChildren(icon("send"), "发布");
      }
    });

    function setReply(comment) {
      replyTo = comment;
      replyChip.hidden = false;
      replyChip.replaceChildren(icon("reply", "icon-sm"), h("span", null, `回复 ${comment.author_name || "卦友"}`),
        h("button", { type: "button", class: "reply-cancel", "aria-label": "取消回复", onClick: cancelReply }, icon("close", "icon-sm")));
      textarea.placeholder = `回复 ${comment.author_name || "卦友"}`;
    }
    function cancelReply() {
      replyTo = null;
      replyChip.hidden = true;
      textarea.placeholder = post.post_kind === "help" ? "说说你的判断和依据……" : "写下你的看法……";
    }
    return { node: form, textarea, setReply, cancelReply };
  }

  function focusComposer() {
    if (!composer || !post.comments_enabled) {
      toast("这条卦帖暂未开放回复");
      return;
    }
    composer.node.scrollIntoView({ block: "center", behavior: "smooth" });
    setTimeout(() => composer.textarea.focus({ preventScroll: true }), 260);
  }

  function startReply(comment) {
    composer?.setReply(comment);
    focusComposer();
  }

  function appendComment(item) {
    const comments = paint.comments;
    const parent = item.parent_id ? comments.find(entry => Number(entry.id) === Number(item.parent_id)) : null;
    if (parent) {
      parent.replies = Array.isArray(parent.replies) ? parent.replies : [];
      parent.replies.push(item);
    } else {
      comments.push({ ...item, replies: item.replies || [] });
    }
    post.comment_count = (Number(post.comment_count) || 0) + 1;
    paint.renderList();
    const counter = mainCol.querySelector("[data-comment-count]");
    if (counter) counter.textContent = `${post.comment_count} 条`;
  }

  async function acceptComment(comment, button) {
    button.disabled = true;
    button.textContent = "正在采纳…";
    try {
      const result = await apiPost(`/api/community/posts/${encodeURIComponent(slug)}/resolve`, { comment_id: Number(comment.id) }, { interaction: true });
      post.accepted_comment_id = result?.accepted_comment_id || comment.id;
      post.help_status = result?.help_status || "resolved";
      post.help_status_label = result?.help_status_label || "已解决";
      comment.accepted = true;
      toast("已采纳", { type: "ok" });
      paint();
    } catch (error) {
      button.disabled = false;
      button.replaceChildren(icon("check"), "采纳这条回答");
      toast(error.message || "采纳失败", { type: "error" });
    }
  }

  async function toggleFollow(button) {
    const ok = await ctx.requireAuth("登录后关注；新回答会提醒。");
    if (!ok) return;
    const next = !post.viewer_following;
    button.disabled = true;
    try {
      const result = await apiPost(`/api/community/posts/${encodeURIComponent(slug)}/follow`, { following: next }, { interaction: true });
      post.viewer_following = !!result?.following;
      post.follow_count = Number(result?.follow_count) || 0;
      toast(post.viewer_following ? "已关注，有新回答会提醒你" : "已取消关注", { type: "ok" });
      paint();
    } catch (error) {
      button.disabled = false;
      toast(error.message || "关注失败", { type: "error" });
    }
  }

  load();

  // 登录状态变化会改变可管理、已关注等个人字段：重新取一次，保留未发布的草稿。
  let lastAuth = session.get().authenticated;
  ctx.subscribe(session, state => {
    if (state.ready && state.authenticated !== lastAuth) {
      lastAuth = state.authenticated;
      if (post) load({ countView: false });
    }
  });

  return { node: root, title: "卦帖", layout: "post" };
}

// 分享面板：先给出复制链接，同时生成一张带二维码的分享长图。
function openShareSheet(post) {
  const title = post.question || post.title || "玄枢卦帖";
  const preview = h("div", { class: "share-preview", "aria-busy": "true" }, h("div", { class: "spinner-line" }, h("span", { class: "spinner", "aria-hidden": "true" }), "正在生成分享长图…"));
  const actions = h("div", { class: "share-actions" });
  const copyBtn = h("button", { type: "button", class: "btn" }, icon("copy"), "复制标题和链接");
  copyBtn.addEventListener("click", async () => {
    const result = await sharePost({ slug: post.slug, title });
    if (!result.silent && result.message) toast(result.message, { type: result.ok ? "ok" : "error" });
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
