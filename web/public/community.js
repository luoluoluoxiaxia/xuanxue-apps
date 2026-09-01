(() => {
  "use strict";

  const body = document.body;
  const pageSlug = body?.dataset.postSlug || "";
  const pageKind = body?.dataset.postKind || "ai";
  const pageSystem = body?.dataset.postSystem || "liuyao";
  const pageCanManage = body?.dataset.canManage === "true";
  const previewCache = new Map();
  const PREVIEW_DIALOG_HTML = `
    <dialog class="post-preview-dialog" data-post-preview aria-labelledby="post-preview-title">
      <button type="button" class="post-preview-close" data-preview-close aria-label="关闭卦帖">×</button>
      <div class="post-preview-loading" data-preview-loading role="status">
        <span></span>
        <b>加载中…</b>
      </div>
      <div class="post-preview-error" data-preview-error hidden>
        <b>加载失败</b>
        <p data-preview-error-message>请重试。</p>
        <a class="secondary-action" data-preview-error-link href="/#gua-square">前往完整页面</a>
      </div>
      <div class="post-preview-content" data-preview-content hidden>
        <section class="post-preview-context">
          <header class="post-preview-head">
            <h2 id="post-preview-title" data-preview-question></h2>
            <div class="preview-meta"><time data-preview-date></time><span data-preview-viewers></span></div>
          </header>

          <section class="post-oracle-panel post-preview-oracle" data-preview-liuyao aria-label="卦象">
            <div class="gua-board">
              <div class="gua-pair">
                <div class="gua-figure">
                  <div class="gua-figure-title"><span>本卦</span><strong data-preview-ben-name></strong></div>
                  <div class="gua-lines" data-preview-ben-lines aria-hidden="true"></div>
                </div>
                <span class="gua-change-arrow" aria-hidden="true">→</span>
                <div class="gua-figure" data-preview-bian-figure>
                  <div class="gua-figure-title">
                    <em class="gua-palace-meta" data-preview-oracle-meta></em>
                    <span>变卦</span><strong data-preview-bian-name></strong>
                  </div>
                  <div class="gua-lines" data-preview-bian-lines aria-hidden="true"></div>
                  <div class="quiet-gua" data-preview-quiet hidden aria-label="六爻安静">静</div>
                </div>
              </div>
              <div class="oracle-facts">
                <span><small>动爻</small><b data-preview-moving></b></span>
                <span><small>世应</small><b data-preview-shiying></b></span>
                <span><small>月建</small><b data-preview-month></b></span>
                <span><small>日辰</small><b data-preview-day></b></span>
              </div>
              <details class="yao-ledger">
                <summary><span>完整六爻排布</span><em data-preview-method></em></summary>
                <div class="yao-ledger-body">
                  <div class="yao-ledger-labels" aria-hidden="true"><span>爻</span><span>六神</span><span>阴阳</span><span>六亲纳甲</span><span>世应</span></div>
                  <div data-preview-ledger></div>
                </div>
              </details>
            </div>
          </section>
          <section class="post-oracle-panel post-preview-bazi" data-preview-bazi aria-label="脱敏八字命盘" hidden>
            <div class="bazi-public-board">
              <div class="bazi-public-heading"><span>命盘机械信息</span><em>已隐藏出生时间、地点与身份信息</em></div>
              <div class="bazi-public-pillars" data-preview-bazi-pillars aria-label="四柱"></div>
              <div class="bazi-public-facts">
                <span><small>日主</small><b data-preview-bazi-day-master></b></span>
                <span><small>生肖</small><b data-preview-bazi-shengxiao></b></span>
                <span><small>旬空</small><b data-preview-bazi-xun-kong></b></span>
              </div>
              <div class="bazi-public-elements" data-preview-bazi-elements aria-label="五行数量"></div>
            </div>
          </section>
        </section>

        <section class="post-preview-story">
          <div class="post-preview-scroll">
            <section class="post-preview-answer" data-preview-answer-section>
              <div class="section-title-row">
                <div><span class="section-heading-copy"><h3 data-preview-answer-title>解答</h3><small data-preview-disclosure></small></span></div>
              </div>
              <article class="reading-prose" data-preview-answer></article>
              <div class="reading-updates-inline" data-preview-updates></div>
            </section>

            <section class="post-preview-comments">
              <div class="section-title-row">
                <div><span class="section-heading-copy"><h3 data-preview-comments-title>评论</h3></span></div>
                <span data-preview-comment-count></span>
              </div>
              <div data-preview-comments></div>
              <div class="comment-composer post-preview-comment-composer" data-preview-comment-composer></div>
            </section>
          </div>
          <div class="post-preview-actions">
            <a class="primary-action" href="/?start=liuyao" data-preview-start-action>我也要起卦</a>
            <button type="button" class="preview-action-button follow-post-action" data-preview-follow hidden><span data-follow-label>关注进展</span><b data-follow-count hidden>0</b></button>
            <button type="button" class="preview-action-button post-like-action" data-preview-like data-like-post="" aria-pressed="false"><span data-like-icon aria-hidden="true">♡</span><b data-like-count>0</b></button>
            <button type="button" class="preview-action-button" data-preview-share>分享</button>
            <button type="button" class="preview-action-button" data-preview-copy>复制标题+链接</button>
          </div>
        </section>
      </div>
    </dialog>`;

  function ensureCommunityToast() {
    let element = document.querySelector("[data-community-toast]");
    if (element || !body) return element;
    element = document.createElement("div");
    element.className = "community-toast";
    element.dataset.communityToast = "";
    element.setAttribute("role", "status");
    element.setAttribute("aria-live", "polite");
    element.hidden = true;
    body.append(element);
    return element;
  }

  function ensurePreviewDialog() {
    let dialog = document.querySelector("[data-post-preview]");
    if (dialog || !body) return dialog;
    if (!document.querySelector("#home-community-feed, [data-community-post]")) return null;
    const template = document.createElement("template");
    template.innerHTML = PREVIEW_DIALOG_HTML.trim();
    dialog = template.content.firstElementChild;
    if (dialog) body.append(dialog);
    return dialog;
  }

  const toast = ensureCommunityToast();
  let toastTimer = 0;
  let toastHideTimer = 0;

  window.XuanxueChatRenderer?.renderMarkdownElements(document);

  function canonicalFor(slug, ref = "") {
    const params = new URLSearchParams({ post: String(slug || "") });
    if (ref) params.set("ref", ref);
    return `${location.origin}/?${params.toString()}#gua-square`;
  }

  async function shareTarget(slug) {
    return await window.XuanxueAccount?.shareTarget(slug) || {
      url: canonicalFor(slug, "post_share"),
      attributed: false,
    };
  }

  function nativeSharePayload(title, url) {
    const shareTitle = String(title || "玄枢六爻卦帖").trim() || "玄枢六爻卦帖";
    return {
      title: shareTitle,
      text: `${shareTitle}\n${url}`,
    };
  }

  function formatStamp(value, includeTime = false) {
    const text = String(value || "");
    return (includeTime ? text.slice(0, 16) : text.slice(0, 10)).replace("T", " ");
  }

  function formatRelativeStamp(value) {
    const stamp = new Date(String(value || ""));
    if (Number.isNaN(stamp.getTime())) return formatStamp(value, true);
    const elapsed = Math.max(0, Date.now() - stamp.getTime());
    const minutes = Math.floor(elapsed / 60000);
    if (minutes < 1) return "刚刚";
    if (minutes < 60) return `${minutes} 分钟前`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} 小时前`;
    if (hours < 48) return "昨天";
    return formatStamp(value);
  }

  function showToast(message, tone = "success") {
    if (!toast) return;
    window.clearTimeout(toastTimer);
    window.clearTimeout(toastHideTimer);
    toast.textContent = message;
    toast.dataset.tone = tone;
    toast.hidden = false;
    requestAnimationFrame(() => toast.classList.add("is-visible"));
    toastTimer = window.setTimeout(() => {
      toast.classList.remove("is-visible");
      toastHideTimer = window.setTimeout(() => { toast.hidden = true; }, 180);
    }, 2400);
  }

  function ensureNotificationDialog() {
    let dialog = document.querySelector("[data-community-notifications-dialog]");
    if (dialog || !body) return dialog;
    dialog = document.createElement("dialog");
    dialog.className = "community-notifications-dialog";
    dialog.dataset.communityNotificationsDialog = "";
    dialog.setAttribute("aria-labelledby", "community-notifications-title");
    dialog.innerHTML = `
      <div class="community-notifications-shell">
        <header class="community-notifications-head">
          <div><h2 id="community-notifications-title">消息</h2><p>赞、评论与回复</p></div>
          <div class="community-notifications-head-actions">
            <button type="button" data-notification-mark-all>全部已读</button>
            <button type="button" data-notification-close aria-label="关闭消息">×</button>
          </div>
        </header>
        <section class="community-notification-summary" aria-label="互动汇总">
          <button type="button" data-notification-jump="like"><b data-notification-like-total>0</b><span>收到的赞</span></button>
          <button type="button" data-notification-jump="comment"><b data-notification-comment-total>0</b><span>评论与回复</span></button>
          <button type="button" data-notification-jump="unread"><b data-notification-unread-total>0</b><span>未读消息</span></button>
        </section>
        <div class="community-notification-list" data-notification-list></div>
        <button type="button" class="community-notification-more" data-notification-more hidden>继续加载</button>
      </div>`;
    body.append(dialog);
    return dialog;
  }

  function setupCommunityNotifications() {
    const buttons = [...document.querySelectorAll("[data-community-notifications]")];
    if (!buttons.length) return;
    const dialog = ensureNotificationDialog();
    if (!dialog) return;
    const list = dialog.querySelector("[data-notification-list]");
    const more = dialog.querySelector("[data-notification-more]");
    const markAll = dialog.querySelector("[data-notification-mark-all]");
    let nextCursor = null;
    let loading = false;
    let opener = null;

    const setText = (selector, value) => {
      const element = dialog.querySelector(selector);
      if (element) element.textContent = String(Number(value) || 0);
    };
    const syncBadge = unread => {
      const count = Math.max(0, Number(unread) || 0);
      buttons.forEach(button => {
        const badge = button.querySelector("[data-notification-badge]");
        if (!badge) return;
        badge.textContent = count > 99 ? "99+" : String(count);
        badge.hidden = count === 0;
        button.setAttribute("aria-label", count ? `消息，${count} 条未读` : "消息");
      });
    };
    const renderSummary = summary => {
      const safe = summary || {};
      setText("[data-notification-like-total]", safe.received_like_count);
      setText("[data-notification-comment-total]", safe.received_comment_count);
      setText("[data-notification-unread-total]", safe.unread_count);
      markAll.disabled = !Number(safe.unread_count);
      syncBadge(safe.unread_count);
    };
    const renderState = (message, retry = false) => {
      const state = document.createElement("div");
      state.className = "community-notification-state";
      const copy = document.createElement("p");
      copy.textContent = message;
      state.append(copy);
      if (retry) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "重新加载";
        button.addEventListener("click", () => fetchNotifications().catch(error => renderState(error.message || "消息加载失败", true)));
        state.append(button);
      }
      list.replaceChildren(state);
    };
    const notificationIcon = kind => kind === "post_like" ? "♥" : kind === "comment_reply" ? "↩" : kind === "answer_accepted" ? "✓" : "评";
    const groupNotificationItems = items => {
      const grouped = [];
      const likesByPost = new Map();
      items.forEach(item => {
        if (item.kind !== "post_like") {
          grouped.push({ ...item, notification_ids: [Number(item.id)] });
          return;
        }
        const key = String(item.post_slug || item.target_url || item.id);
        const existing = likesByPost.get(key);
        if (existing) {
          existing.notification_ids.push(Number(item.id));
          existing.like_actor_count += 1;
          existing.has_unread ||= !item.read_at;
          return;
        }
        const group = {
          ...item,
          notification_ids: [Number(item.id)],
          like_actor_count: 1,
          has_unread: !item.read_at,
        };
        likesByPost.set(key, group);
        grouped.push(group);
      });
      return grouped;
    };
    const renderItem = item => {
      const notificationIds = (item.notification_ids || [Number(item.id)]).filter(Number.isFinite);
      const isUnread = Boolean(item.has_unread || !item.read_at);
      const button = document.createElement("button");
      button.type = "button";
      button.className = `community-notification-item${isUnread ? " is-unread" : ""}`;
      button.dataset.notificationIds = notificationIds.join(",");
      button.dataset.notificationKind = item.kind || "";
      button.dataset.notificationTarget = String(item.target_url || "");
      const icon = document.createElement("span");
      icon.className = "community-notification-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = notificationIcon(item.kind);
      const copy = document.createElement("span");
      copy.className = "community-notification-copy";
      const title = document.createElement("b");
      title.textContent = item.kind === "post_like" && Number(item.like_actor_count) > 1
        ? `${item.like_actor_count} 位卦友赞了你的卦帖`
        : `${item.actor_name || "有位卦友"} ${item.kind_label || "与你互动了"}`;
      const post = document.createElement("small");
      post.textContent = item.post_title || "相关卦帖";
      copy.append(title);
      if (item.body_excerpt) {
        const excerpt = document.createElement("p");
        excerpt.textContent = item.body_excerpt;
        copy.append(excerpt);
      }
      copy.append(post);
      const time = document.createElement("time");
      time.dateTime = String(item.created_at || "");
      time.title = formatStamp(item.created_at, true);
      time.textContent = formatRelativeStamp(item.created_at);
      button.setAttribute("aria-label", `${title.textContent}${item.body_excerpt ? `，${item.body_excerpt}` : ""}，${post.textContent}，${time.textContent}${isUnread ? "，未读" : ""}`);
      button.append(icon, copy, time);
      button.addEventListener("click", async () => {
        await markNotifications(notificationIds).catch(() => {});
        const targetUrl = item.target_url || `/?post=${encodeURIComponent(item.post_slug || "")}#gua-square`;
        dialog.close();
        location.assign(targetUrl);
      });
      return button;
    };
    const fetchNotifications = async ({ append = false } = {}) => {
      if (loading) return;
      loading = true;
      if (!append) renderState("加载消息…");
      try {
        const params = new URLSearchParams({ limit: "30" });
        if (append && nextCursor) params.set("before_id", String(nextCursor));
        const response = await fetch(`/api/community/notifications?${params}`, {
          headers: { Accept: "application/json" },
          credentials: "same-origin",
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw Object.assign(new Error(payload.detail || "消息加载失败"), { status: response.status });
        const items = Array.isArray(payload.items) ? payload.items : [];
        if (!append) list.replaceChildren();
        groupNotificationItems(items).forEach(item => list.append(renderItem(item)));
        if (!append && !items.length) renderState("暂无新互动");
        nextCursor = payload.next_cursor || null;
        more.hidden = !nextCursor;
        renderSummary(payload.summary);
      } finally {
        loading = false;
      }
    };
    async function markNotifications(ids = [], markAllNotifications = false) {
      await window.XuanxueAccount?.ready();
      const response = await fetch("/api/community/notifications/read", {
        method: "POST",
        headers: window.XuanxueAccount?.csrfHeaders({
          "Content-Type": "application/json",
          Accept: "application/json",
        }) || { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ ids, mark_all: markAllNotifications }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || "消息状态更新失败");
      syncBadge(payload.unread_count);
      return payload;
    }
    const refreshBadge = async () => {
      const account = await window.XuanxueAccount?.ready();
      if (!account?.authenticated) {
        syncBadge(0);
        return;
      }
      try {
        const response = await fetch("/api/community/notifications?limit=1", {
          headers: { Accept: "application/json" }, credentials: "same-origin",
        });
        if (!response.ok) throw new Error();
        const payload = await response.json();
        renderSummary(payload.summary);
      } catch (_) {}
    };
    const openNotifications = async event => {
      opener = event?.currentTarget || document.activeElement;
      const account = await window.XuanxueAccount?.ready();
      if (!account?.authenticated) {
        const loggedIn = await window.XuanxueAccount?.requireLogin({
          mode: "login",
          message: "登录后查看谁赞了、评论了或回复了你的卦帖。",
        });
        if (!loggedIn) return;
      }
      if (!dialog.open) dialog.showModal();
      body.classList.add("community-notifications-open");
      await fetchNotifications().catch(error => renderState(error.message || "消息加载失败", true));
      dialog.querySelector("[data-notification-close]")?.focus({ preventScroll: true });
    };

    buttons.forEach(button => button.addEventListener("click", openNotifications));
    dialog.querySelector("[data-notification-close]")?.addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", event => {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener("close", () => {
      body.classList.remove("community-notifications-open");
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    });
    markAll.addEventListener("click", async () => {
      markAll.disabled = true;
      try {
        await markNotifications([], true);
        list.querySelectorAll(".is-unread").forEach(item => item.classList.remove("is-unread"));
        setText("[data-notification-unread-total]", 0);
      } catch (error) {
        showToast(error.message || "消息状态更新失败", "error");
      } finally {
        markAll.disabled = !list.querySelector(".is-unread");
      }
    });
    more.addEventListener("click", () => fetchNotifications({ append: true }).catch(error => showToast(error.message, "error")));
    dialog.querySelectorAll("[data-notification-jump]").forEach(button => button.addEventListener("click", () => {
      const kind = button.dataset.notificationJump;
      const selector = kind === "like"
        ? '[data-notification-kind="post_like"]'
        : kind === "comment"
          ? '[data-notification-kind="post_comment"], [data-notification-kind="comment_reply"], [data-notification-kind="followed_post_comment"], [data-notification-kind="answer_accepted"]'
          : ".community-notification-item.is-unread";
      const target = list.querySelector(selector);
      if (!target) return;
      target.scrollIntoView({ behavior: "smooth", block: "nearest" });
      target.focus({ preventScroll: true });
    }));
    document.addEventListener("xuanshu:authchange", event => {
      if (!event.detail?.authenticated && dialog.open) dialog.close();
      refreshBadge();
    });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refreshBadge();
    });
    window.setInterval(refreshBadge, 60000);
    refreshBadge();
  }

  setupCommunityNotifications();

  async function track(slug, channel) {
    if (!slug) return;
    try {
      await fetch("/api/community/share-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          channel,
          ref: new URLSearchParams(location.search).get("ref") || "",
        }),
        keepalive: true,
      });
    } catch (_) {}
  }

  async function copyLink(slug, title) {
    if (!slug) return;
    const target = await shareTarget(slug);
    const url = target.url;
    const data = nativeSharePayload(title || document.title, url);
    let copied = false;
    try {
      await navigator.clipboard.writeText(data.text);
      copied = true;
    } catch (_) {
      const input = document.createElement("textarea");
      input.value = data.text;
      document.body.appendChild(input);
      input.select();
      copied = document.execCommand("copy");
      input.remove();
    }
    if (!copied) {
      showToast("复制失败，请手动复制标题和链接", "error");
      return;
    }
    await track(slug, "copy");
    showToast(target.attributed ? "邀请链接已复制，新用户激活后每日额度永久 +1" : "标题和链接已复制");
  }

  async function sharePost(slug, title, post = null) {
    if (!slug) return;
    const target = await shareTarget(slug);
    const shareKind = post?.post_kind || pageKind;
    const shareSystem = post?.system || pageSystem;
    if (window.XuanxueShareCard?.open && shareKind === "ai" && shareSystem === "liuyao") {
      await window.XuanxueShareCard.open({
        slug,
        title,
        post,
        ref: new URLSearchParams(location.search).get("ref") || "community_share",
        shareUrl: target.url,
        attributed: target.attributed,
      });
      return;
    }
    const url = target.url;
    const data = nativeSharePayload(title || document.title, url);
    if (navigator.share) {
      try {
        await navigator.share(data);
        await track(slug, "native");
        showToast("分享已完成");
        return;
      } catch (error) {
        if (error?.name === "AbortError") return;
      }
    }
    await copyLink(slug, title);
  }

  const pageTitle = document.querySelector(".public-post-head h1")?.textContent?.trim() || "";
  document.querySelectorAll("[data-share-post]").forEach(button => {
    button.addEventListener("click", () => sharePost(pageSlug, pageTitle));
  });
  document.querySelectorAll("[data-copy-post]").forEach(button => {
    button.addEventListener("click", () => copyLink(pageSlug, pageTitle));
  });

  function likeButtonsFor(slug) {
    return Array.from(document.querySelectorAll("[data-like-post]"))
      .filter(button => button.dataset.likePost === slug);
  }

  function syncLikeState(slug, count, liked = true) {
    likeButtonsFor(slug).forEach(button => {
      button.disabled = false;
      button.classList.toggle("is-liked", liked);
      button.setAttribute("aria-pressed", liked ? "true" : "false");
      const title = button.dataset.likeTitle || "这条卦帖";
      button.setAttribute("aria-label", `${liked ? "已赞" : "点赞"}：${title}`);
      button.title = liked ? "已点赞" : "点赞";
      const icon = button.querySelector("[data-like-icon]");
      if (icon) icon.textContent = liked ? "♥" : "♡";
      const counter = button.querySelector("[data-like-count]");
      if (counter) counter.textContent = String(Number(count) || 0);
    });
    const cached = previewCache.get(slug);
    if (cached) cached.then(post => {
      post.like_count = Number(count) || 0;
      post.viewer_liked = liked;
    }).catch(() => {});
  }

  function syncViewerState(slug, viewerCount, viewCount) {
    document.querySelectorAll("[data-post-viewers]").forEach(element => {
      if (element.dataset.postViewers !== slug) return;
      element.textContent = `${Number(viewerCount) || 0} 人看过`;
      element.title = `共 ${Number(viewCount) || 0} 次浏览`;
    });
    const cached = previewCache.get(slug);
    if (cached) cached.then(post => {
      post.viewer_count = Number(viewerCount) || 0;
      post.view_count = Number(viewCount) || 0;
    }).catch(() => {});
  }

  async function likePost(slug) {
    if (!slug) return;
    const buttons = likeButtonsFor(slug);
    if (buttons.some(button => button.getAttribute("aria-pressed") === "true")) {
      showToast("已赞过");
      return;
    }
    buttons.forEach(button => { button.disabled = true; });
    try {
      const response = await fetch(`/api/community/posts/${encodeURIComponent(slug)}/like`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "X-Xuanshu-Interaction": "same-origin-v1",
        },
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.detail || "点赞失败");
      syncLikeState(slug, result.like_count, true);
      showToast(result.newly_liked ? "已点赞" : "已赞过");
    } catch (error) {
      buttons.forEach(button => { button.disabled = false; });
      showToast(error.message || "点赞失败", "error");
    }
  }

  async function recordView(slug) {
    if (!slug) return null;
    try {
      const response = await fetch(`/api/community/posts/${encodeURIComponent(slug)}/view`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "X-Xuanshu-Interaction": "same-origin-v1",
        },
        keepalive: true,
      });
      if (!response.ok) return null;
      const result = await response.json();
      syncViewerState(slug, result.viewer_count, result.view_count);
      return result;
    } catch (_) {
      return null;
    }
  }

  document.addEventListener("click", event => {
    const button = event.target instanceof Element ? event.target.closest("[data-like-post]") : null;
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    void likePost(button.dataset.likePost || "");
  });

  function setupFollowPost() {
    const button = document.querySelector("[data-follow-post]");
    if (!button || !pageSlug) return;
    button.addEventListener("click", async () => {
      let account = await window.XuanxueAccount?.ready();
      if (!account?.authenticated) {
        const loggedIn = await window.XuanxueAccount?.requireLogin({
          mode: "login",
          message: "登录后关注；新回答会提醒。",
        });
        if (!loggedIn) return;
        account = await window.XuanxueAccount?.ready();
      }
      if (!account?.authenticated) return;
      const following = button.getAttribute("aria-pressed") !== "true";
      button.disabled = true;
      try {
        const response = await fetch(`/api/community/posts/${encodeURIComponent(pageSlug)}/follow`, {
          method: "POST",
          headers: window.XuanxueAccount?.csrfHeaders({
            "Content-Type": "application/json",
            Accept: "application/json",
            "X-Xuanshu-Interaction": "same-origin-v1",
          }),
          credentials: "same-origin",
          body: JSON.stringify({ following }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.detail || "关注失败");
        button.setAttribute("aria-pressed", payload.following ? "true" : "false");
        button.classList.toggle("is-following", !!payload.following);
        const label = button.querySelector("[data-follow-label]");
        const count = button.querySelector("[data-follow-count]");
        if (label) label.textContent = payload.following ? "已关注" : "关注进展";
        if (count) {
          count.textContent = String(Number(payload.follow_count) || 0);
          count.hidden = !Number(payload.follow_count);
        }
        showToast(payload.following ? "已关注，有新回答会提醒你" : "已取消关注");
      } catch (error) {
        showToast(error.message || "关注失败", "error");
      } finally {
        button.disabled = false;
      }
    });
  }

  setupFollowPost();

  const report = document.querySelector("[data-report-post]");
  const reportDialog = document.querySelector("[data-report-dialog]");
  const reportForm = document.querySelector("[data-report-form]");
  if (report && reportDialog && reportForm && pageSlug) {
    const reportOverlayId = "community-report";
    const closeReportDialogNow = () => {
      if (reportDialog.open) reportDialog.close();
    };
    const openReportDialogNow = () => {
      reportForm.reset();
      reportForm.querySelector("[data-report-state]").textContent = "";
      reportForm.querySelector("button[type=submit]").disabled = false;
      if (!reportDialog.open) reportDialog.showModal();
      body.classList.add("report-dialog-open");
      requestAnimationFrame(() => reportForm.querySelector("input, textarea, button")?.focus({ preventScroll: true }));
    };
    window.XuanOverlayHistory?.register(reportOverlayId, {
      isOpen: () => reportDialog.open,
      open: openReportDialogNow,
      close: closeReportDialogNow,
    });
    const openReportDialog = () => window.XuanOverlayHistory
      ? window.XuanOverlayHistory.open(reportOverlayId)
      : openReportDialogNow();
    const closeReportDialog = () => window.XuanOverlayHistory
      ? window.XuanOverlayHistory.requestClose(reportOverlayId)
      : (closeReportDialogNow(), Promise.resolve(true));
    report.addEventListener("click", openReportDialog);
    reportDialog.querySelectorAll("[data-report-cancel]").forEach(button => {
      button.addEventListener("click", closeReportDialog);
    });
    reportDialog.addEventListener("click", event => {
      if (event.target === reportDialog) closeReportDialog();
    });
    reportDialog.addEventListener("cancel", event => {
      event.preventDefault();
      closeReportDialog();
    });
    reportDialog.addEventListener("close", () => {
      body.classList.remove("report-dialog-open");
      report.focus({ preventScroll: true });
    });
    reportForm.addEventListener("submit", async event => {
      event.preventDefault();
      const form = new FormData(reportForm);
      const submit = reportForm.querySelector("button[type=submit]");
      const state = reportForm.querySelector("[data-report-state]");
      submit.disabled = true;
      state.textContent = "正在提交…";
      try {
        const response = await fetch("/api/community/reports", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            slug: pageSlug,
            reason: String(form.get("reason") || ""),
            detail: String(form.get("detail") || "").trim(),
          }),
        });
        if (!response.ok) {
          const detail = (await response.json().catch(() => ({}))).detail;
          throw new Error(detail || "举报失败");
        }
        closeReportDialog();
        showToast("举报已提交，我们会尽快处理");
      } catch (error) {
        state.textContent = error.message || "举报失败";
        submit.disabled = false;
      }
    });
  }

  const commentComposer = document.querySelector("[data-comment-composer]");
  const commentSection = document.querySelector(".comments-section");

  function bindAcceptActions(scope = document, slug = pageSlug, system = pageSystem) {
    scope?.querySelectorAll("[data-accept-comment]").forEach(button => {
      if (button.dataset.acceptBound === "true") return;
      button.dataset.acceptBound = "true";
      button.addEventListener("click", async () => {
        const commentId = Number(button.dataset.acceptComment || 0);
        if (!commentId) return;
        button.disabled = true;
        button.textContent = "正在采纳…";
        try {
          const response = await fetch(`/api/community/posts/${encodeURIComponent(slug)}/resolve`, {
            method: "POST",
            headers: window.XuanxueAccount?.csrfHeaders({
              "Content-Type": "application/json",
              Accept: "application/json",
              "X-Xuanshu-Interaction": "same-origin-v1",
            }),
            credentials: "same-origin",
            body: JSON.stringify({ comment_id: commentId }),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(payload.detail || "采纳失败");
          document.querySelectorAll("[data-accept-comment]").forEach(item => item.remove());
          const accepted = document.querySelector(`#comment-${commentId}`);
          accepted?.classList.add("is-accepted");
          const metaLabel = accepted?.querySelector(".comment-meta span");
          if (metaLabel && !metaLabel.textContent.includes("已采纳")) metaLabel.textContent += " · 已采纳";
          const badge = document.querySelector("[data-help-status]");
          if (badge) badge.textContent = `${system === "bazi" ? "八字" : "六爻"} · ${payload.help_status_label || "已解决"}`;
          const briefTitle = document.querySelector("[data-help-brief] h2");
          if (briefTitle) briefTitle.textContent = "已采纳";
          showToast("已采纳");
        } catch (error) {
          button.disabled = false;
          button.textContent = "采纳";
          showToast(error.message || "采纳失败", "error");
        }
      });
    });
  }

  function commentFormMarkup(inputId = "comment-body", system = pageSystem) {
    const readingLabel = system === "liuyao" ? "断卦回复" : "命盘判断";
    return `<form class="comment-form" data-comment-form>
      <div class="comment-reply-context" data-comment-reply-context hidden>
        <span data-comment-reply-label></span>
        <button type="button" data-comment-reply-cancel>取消回复</button>
      </div>
      <div class="comment-body-field">
        <div class="comment-compose-head">
          <label for="${inputId}">回复内容</label>
          <label class="comment-reading-toggle"><input type="checkbox" name="reading_reply" value="reading"><span>${readingLabel}</span></label>
        </div>
        <textarea id="${inputId}" name="body" rows="4" maxlength="500" required placeholder="写下回复……"></textarea>
      </div>
      <div class="comment-form-actions">
        <span><b data-comment-length>0</b> / 500 · 匿名发布</span>
        <button type="submit" class="primary-action" data-comment-submit>发布回复</button>
      </div>
      <p class="form-state" data-comment-state role="status" aria-live="polite"></p>
    </form>`;
  }

  function commentGateMarkup() {
    return `<div class="comment-gate">
      <span>评</span>
      <div><b>登录后匿名回复</b><p>仅显示卦友编号。</p></div>
      <button type="button" class="comment-login-action" data-comment-login>登录回复</button>
    </div>`;
  }

  function syncCommentTotal(increment = 0) {
    const total = commentSection?.querySelector("[data-comment-total]");
    if (!total) return;
    const count = Math.max(0, Number(total.dataset.count || 0) + increment);
    total.dataset.count = String(count);
    total.textContent = `${count} 条`;
  }

  function appendPublishedComment(comment) {
    if (!commentSection) return;
    commentSection.querySelector(".section-empty")?.remove();
    let list = commentSection.querySelector(".comment-list");
    if (!list) {
      list = document.createElement("div");
      list.className = "comment-list";
      commentComposer?.before(list);
    }
    const parent = comment.parent_id ? list.querySelector(`#comment-${comment.parent_id}`) : null;
    if (parent) parent.append(renderCommentReply(comment));
    else list.append(renderComment(comment));
    syncCommentTotal(1);
    bindReplyActions(commentSection, commentComposer, renderDetailCommentComposer);
    bindAcceptActions(commentSection);
  }

  function clearCommentReply(form) {
    if (!form) return;
    form.removeAttribute("data-reply-parent-id");
    const context = form.querySelector("[data-comment-reply-context]");
    if (context) context.hidden = true;
    const input = form.elements.body;
    if (input) input.placeholder = "写下回复……";
  }

  function beginCommentReply(host, parentId, authorName) {
    const form = host?.querySelector("[data-comment-form]");
    if (!form) return;
    form.dataset.replyParentId = String(parentId || "");
    const context = form.querySelector("[data-comment-reply-context]");
    const label = form.querySelector("[data-comment-reply-label]");
    if (context) context.hidden = false;
    if (label) label.textContent = `回复 ${authorName || "卦友"}`;
    const input = form.elements.body;
    input.placeholder = `回复 ${authorName || "卦友"}`;
    input.focus({ preventScroll: true });
  }

  function bindReplyActions(scope, composerHost, ensureComposer) {
    scope?.querySelectorAll("[data-comment-reply]").forEach(button => {
      if (button.dataset.replyBound === "true") return;
      button.dataset.replyBound = "true";
      button.addEventListener("click", async () => {
        let account = await window.XuanxueAccount?.ready();
        if (!account?.authenticated) {
          const loggedIn = await window.XuanxueAccount?.requireLogin({
            mode: "login",
            message: "登录后匿名回复",
          });
          if (!loggedIn) return;
          account = await window.XuanxueAccount?.ready();
        }
        if (!account?.authenticated) return;
        if (!composerHost?.querySelector("[data-comment-form]")) ensureComposer?.();
        beginCommentReply(composerHost, Number(button.dataset.commentReply), button.dataset.commentAuthor || "卦友");
      });
    });
  }

  function bindCommentLogin(host, onLoggedIn) {
    host?.querySelector("[data-comment-login]")?.addEventListener("click", async event => {
      const button = event.currentTarget;
      button.disabled = true;
      const loggedIn = await window.XuanxueAccount?.requireLogin({
        mode: "login",
        message: "登录后匿名回复",
      });
      if (loggedIn) onLoggedIn();
      else button.disabled = false;
    });
  }

  function renderCommentGate(host, onLoggedIn) {
    if (!host) return;
    host.dataset.writeReady = "false";
    host.innerHTML = commentGateMarkup();
    bindCommentLogin(host, onLoggedIn);
  }

  function bindCommentForm(host, slug, onPublished, onAuthExpired) {
    const form = host?.querySelector("[data-comment-form]");
    if (!form || form.dataset.commentBound === "true") return;
    form.dataset.commentBound = "true";
    const input = form.elements.body;
    const length = form.querySelector("[data-comment-length]");
    const state = form.querySelector("[data-comment-state]");
    const submit = form.querySelector("button[type=submit]");
    form.querySelector("[data-comment-reply-cancel]")?.addEventListener("click", () => clearCommentReply(form));
    const syncLength = () => { length.textContent = String(input.value.length); };
    input.addEventListener("input", syncLength);
    syncLength();
    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (!input.reportValidity()) return;
      submit.disabled = true;
      submit.textContent = "正在发布…";
      state.textContent = "";
      state.dataset.tone = "";
      try {
        await window.XuanxueAccount?.ready();
        const response = await fetch(`/api/community/posts/${encodeURIComponent(slug)}/comments`, {
          method: "POST",
          headers: window.XuanxueAccount?.csrfHeaders({
            "Content-Type": "application/json",
            Accept: "application/json",
          }) || { "Content-Type": "application/json", Accept: "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            body: input.value.trim(),
            parent_id: Number(form.dataset.replyParentId) || null,
            kind: form.elements.reading_reply?.checked ? "reading" : "discussion",
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw Object.assign(new Error(payload.detail || "回复发布失败"), { status: response.status });
        onPublished(payload.item);
        input.value = "";
        clearCommentReply(form);
        syncLength();
        form.reset();
        state.textContent = `已发布，将显示为 ${payload.item?.author_name || "匿名卦友"}`;
        state.dataset.tone = "success";
        showToast("评论已发布");
      } catch (error) {
        if (error?.status === 401 || error?.status === 403) {
          await window.XuanxueAccount?.refresh();
          onAuthExpired();
          showToast("登录已失效，请重新登录", "error");
          return;
        }
        state.textContent = error.message || "回复发布失败";
        state.dataset.tone = "error";
      } finally {
        if (submit.isConnected) {
          submit.disabled = false;
          submit.textContent = "发布回复";
        }
      }
    });
  }

  function renderCommentComposer(host, slug, onPublished, onAuthExpired, { focus = true, inputId = "comment-body", system = pageSystem } = {}) {
    if (!host) return;
    host.dataset.writeReady = "true";
    host.innerHTML = commentFormMarkup(inputId, system);
    bindCommentForm(host, slug, onPublished, onAuthExpired);
    if (focus) requestAnimationFrame(() => host.querySelector("textarea")?.focus());
  }

  function renderDetailCommentGate() {
    renderCommentGate(commentComposer, renderDetailCommentComposer);
  }

  function renderDetailCommentComposer() {
    renderCommentComposer(
      commentComposer,
      pageSlug,
      appendPublishedComment,
      renderDetailCommentGate,
    );
  }

  if (commentComposer) {
    if (commentComposer.dataset.writeReady === "true") {
      bindCommentForm(commentComposer, pageSlug, appendPublishedComment, renderDetailCommentGate);
    } else {
      bindCommentLogin(commentComposer, renderDetailCommentComposer);
    }
    window.XuanxueAccount?.ready().then(account => {
      if (account.authenticated && commentComposer.dataset.writeReady !== "true") renderDetailCommentComposer();
    });
    document.addEventListener("xuanshu:authchange", event => {
      if (event.detail?.authenticated) {
        if (commentComposer.dataset.writeReady !== "true") renderDetailCommentComposer();
      } else if (commentComposer.dataset.writeReady === "true") {
        renderDetailCommentGate();
      }
    });
    bindReplyActions(commentSection, commentComposer, renderDetailCommentComposer);
    bindAcceptActions(commentSection);
  }

  const storyForm = document.querySelector("[data-story-update-form]");
  if (storyForm) {
    const input = storyForm.elements.body;
    const length = storyForm.querySelector("[data-story-length]");
    const state = storyForm.querySelector("[data-story-state]");
    const submit = storyForm.querySelector("button[type=submit]");
    const syncLength = () => { length.textContent = String(input.value.length); };
    input.addEventListener("input", syncLength);
    syncLength();
    storyForm.addEventListener("submit", async event => {
      event.preventDefault();
      if (!input.reportValidity()) return;
      submit.disabled = true;
      submit.textContent = "正在发布…";
      state.textContent = "";
      state.dataset.tone = "";
      try {
        await window.XuanxueAccount?.ready();
        const headers = window.XuanxueAccount?.csrfHeaders({
          "Content-Type": "application/json",
          Accept: "application/json",
        }) || { "Content-Type": "application/json", Accept: "application/json" };
        headers["x-xuanshu-interaction"] = "same-origin-v1";
        const response = await fetch(`/api/community/liuyao/posts/${encodeURIComponent(pageSlug)}/updates`, {
          method: "POST",
          headers,
          credentials: "same-origin",
          body: JSON.stringify({
            verification_status: storyForm.elements.verification_status.value,
            body: input.value.trim(),
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw Object.assign(new Error(payload.detail || "进展发布失败"), { status: response.status });
        appendStoryUpdate(payload.item);
        input.value = "";
        syncLength();
        state.textContent = "故事进展已公开发布";
        state.dataset.tone = "success";
        showToast("故事进展已发布");
      } catch (error) {
        state.textContent = error.message || "进展发布失败";
        state.dataset.tone = "error";
      } finally {
        submit.disabled = false;
        submit.textContent = "发布事情进展";
      }
    });
  }

  function appendStoryUpdate(update) {
    const timeline = document.querySelector("[data-story-timeline]");
    if (!timeline || !update) return;
    const article = makeElement("article", "reading-update-inline");
    article.dataset.storyUpdate = "";
    const meta = makeElement("div", "reading-update-meta");
    meta.append(
      makeElement("b", "", `卦主后续 · ${update.verification_status_label || "待观察"}`),
      makeElement("time", "", formatStamp(update.created_at, true)),
    );
    article.append(meta, makeElement("p", "", update.body || ""));
    timeline.append(article);
    const status = document.querySelector("[data-story-status]");
    if (status) {
      status.textContent = update.verification_status_label || "待观察";
      status.dataset.status = update.verification_status || "watching";
    }
  }

  const previewDialog = ensurePreviewDialog();
  if (!previewDialog) return;

  const previewClose = previewDialog.querySelector("[data-preview-close]");
  const previewLoading = previewDialog.querySelector("[data-preview-loading]");
  const previewError = previewDialog.querySelector("[data-preview-error]");
  const previewErrorMessage = previewDialog.querySelector("[data-preview-error-message]");
  const previewErrorLink = previewDialog.querySelector("[data-preview-error-link]");
  const previewContent = previewDialog.querySelector("[data-preview-content]");
  const previewScroll = previewDialog.querySelector(".post-preview-scroll");
  let activePreview = null;
  let activeRequest = 0;
  let opener = null;

  function field(selector) {
    return previewDialog.querySelector(selector);
  }

  function setField(selector, value) {
    const element = field(selector);
    if (element) element.textContent = String(value || "");
  }

  function makeElement(tag, className = "", text = "") {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  }

  function renderGuaLines(container, lines, changed = false) {
    container.replaceChildren();
    lines.forEach(line => {
      const yin = changed ? line.changed_yin : line.yin;
      const item = makeElement("span", `gua-line ${yin ? "is-yin" : "is-yang"}${!changed && line.moving ? " is-moving" : ""}`);
      item.append(makeElement("i"), makeElement("i"));
      if (!changed && line.moving) item.append(makeElement("b", "", line.moving_mark));
      container.append(item);
    });
  }

  function renderLedger(lines) {
    const ledger = field("[data-preview-ledger]");
    ledger.replaceChildren();
    lines.forEach(line => {
      const row = makeElement("div", `yao-ledger-row${line.moving ? " is-moving" : ""}`);
      row.append(
        makeElement("span", "yao-position", line.position_label),
        makeElement("span", "yao-spirit", line.liu_shen),
      );
      const mini = makeElement("span", `yao-mini-line ${line.yin ? "is-yin" : "is-yang"}`);
      mini.append(makeElement("i"), makeElement("i"));
      row.append(mini);
      const detail = makeElement("span", "yao-detail");
      detail.append(makeElement("b", "", `${line.liu_qin || ""} ${line.najia || ""}${line.wuxing || ""}`.trim()));
      if (line.changed_label) detail.append(makeElement("small", "", `→ ${line.changed_label}`));
      row.append(detail, makeElement("span", "yao-role", `${line.roles || ""}${line.kong ? "空" : ""}`));
      ledger.append(row);
    });
  }

  function renderBaziChart(chart) {
    const pillars = chart.pillars || {};
    const details = chart.pillars_detail || {};
    const pillarHost = field("[data-preview-bazi-pillars]");
    pillarHost.replaceChildren();
    [["year", "年柱"], ["month", "月柱"], ["day", "日柱"], ["hour", "时柱"]].forEach(([key, label]) => {
      const item = makeElement("span", key === "day" ? "is-day" : "");
      item.append(
        makeElement("small", "", label),
        makeElement("b", "", pillars[key] || "—"),
        makeElement("em", "", details[key]?.na_yin || "—"),
      );
      pillarHost.append(item);
    });
    setField("[data-preview-bazi-day-master]", chart.day_master || "—");
    setField("[data-preview-bazi-shengxiao]", chart.shengxiao || "—");
    setField("[data-preview-bazi-xun-kong]", chart.xun_kong || "—");
    const elements = chart.wuxing_count || {};
    const elementHost = field("[data-preview-bazi-elements]");
    elementHost.replaceChildren();
    ["木", "火", "土", "金", "水"].forEach(element => {
      const item = makeElement("span");
      item.append(makeElement("b", "", element), makeElement("i", "", String(Number(elements[element]) || 0)));
      elementHost.append(item);
    });
  }

  function renderCommentReply(reply) {
    const replyItem = makeElement("div", `comment-reply${reply.accepted ? " is-accepted" : ""}`);
    if (reply.id) {
      replyItem.id = `comment-${reply.id}`;
      replyItem.dataset.commentId = String(reply.id);
    }
    const replyMeta = makeElement("div", "comment-meta");
    replyMeta.append(
      makeElement("b", "", reply.author_name || "卦友"),
      makeElement("span", "", `${reply.kind_label || "参与讨论"}${reply.accepted ? " · 已采纳" : ""}`),
      makeElement("time", "", formatStamp(reply.created_at, true)),
    );
    const replyAction = makeElement("button", "comment-reply-action", "回复");
    replyAction.type = "button";
    replyAction.dataset.commentReply = String(reply.id || "");
    replyAction.dataset.commentAuthor = reply.author_name || "卦友";
    replyItem.append(replyMeta, makeElement("p", "", reply.body || ""));
    appendCommentReading(replyItem, reply);
    replyItem.append(replyAction);
    return replyItem;
  }

  function appendCommentReading(host, comment) {
    if (comment.reasoning) {
      const field = makeElement("div", "comment-reading-field");
      field.append(makeElement("b", "", "判断依据"), makeElement("p", "", comment.reasoning));
      host.append(field);
    }
    if (comment.prediction) {
      const field = makeElement("div", "comment-reading-field");
      field.append(makeElement("b", "", "应期 / 结果"), makeElement("p", "", comment.prediction));
      host.append(field);
    }
    if (Array.isArray(comment.referenced_lines) && comment.referenced_lines.length) {
      host.append(makeElement("div", "comment-reading-lines", `参考爻位：${comment.referenced_lines.join("、")}`));
    }
  }

  function renderComment(comment, context = {}) {
    const item = makeElement("article", `comment${comment.accepted ? " is-accepted" : ""}`);
    if (comment.id) {
      item.id = `comment-${comment.id}`;
      item.dataset.commentId = String(comment.id);
    }
    const meta = makeElement("div", "comment-meta");
    meta.append(
      makeElement("b", "", comment.author_name || "卦友"),
      makeElement("span", "", `${comment.kind_label || "参与讨论"}${comment.accepted ? " · 已采纳" : ""}`),
      makeElement("time", "", formatStamp(comment.created_at, true)),
    );
    const replyAction = makeElement("button", "comment-reply-action", "回复");
    replyAction.type = "button";
    replyAction.dataset.commentReply = String(comment.id || "");
    replyAction.dataset.commentAuthor = comment.author_name || "卦友";
    item.append(meta, makeElement("p", "", comment.body || ""));
    appendCommentReading(item, comment);
    item.append(replyAction);
    const postKind = context.post_kind || pageKind;
    const canManage = context.can_manage ?? pageCanManage;
    if (postKind === "help" && canManage && !comment.accepted) {
      const accept = makeElement("button", "comment-accept-action", "采纳");
      accept.type = "button";
      accept.dataset.acceptComment = String(comment.id || "");
      item.append(accept);
    }
    (comment.replies || []).forEach(reply => item.append(renderCommentReply(reply)));
    return item;
  }

  function renderComments(post) {
    const host = field("[data-preview-comments]");
    const comments = post.comments || [];
    setField("[data-preview-comment-count]", `${post.comment_count || comments.length} 条`);
    host.replaceChildren();
    if (!comments.length) {
      host.append(makeElement("p", "section-empty", post.post_kind === "help" ? "暂无回答。" : "暂无评论。"));
      return;
    }
    const list = makeElement("div", "comment-list");
    comments.forEach(comment => list.append(renderComment(comment, post)));
    host.append(list);
    bindReplyActions(host, field("[data-preview-comment-composer]"), () => renderPreviewCommentComposer(post, { focus: false }));
    bindAcceptActions(host, post.slug, post.system);
  }

  function appendPreviewComment(post, comment) {
    if (!Array.isArray(post.comments)) post.comments = [];
    const parent = comment.parent_id
      ? post.comments.find(item => Number(item.id) === Number(comment.parent_id))
      : null;
    if (parent) {
      if (!Array.isArray(parent.replies)) parent.replies = [];
      parent.replies.push(comment);
    } else {
      post.comments.push(comment);
    }
    post.comment_count = Math.max(0, Number(post.comment_count) || 0) + 1;
    renderComments(post);
  }

  function renderPreviewCommentGate(post) {
    const host = field("[data-preview-comment-composer]");
    renderCommentGate(host, () => {
      post.comments_write_ready = true;
      renderPreviewCommentComposer(post, { focus: true });
    });
  }

  function renderPreviewCommentComposer(post, { focus = false } = {}) {
    const host = field("[data-preview-comment-composer]");
    renderCommentComposer(
      host,
      post.slug,
      comment => appendPreviewComment(post, comment),
      () => {
        post.comments_write_ready = false;
        renderPreviewCommentGate(post);
      },
      { focus, inputId: "preview-comment-body", system: post.system },
    );
  }

  function renderPreviewCommentEntry(post) {
    const host = field("[data-preview-comment-composer]");
    if (!host) return;
    if (!post.comments_enabled) {
      host.dataset.writeReady = "false";
      host.innerHTML = '<p class="section-empty">这条卦帖暂未开放评论。</p>';
      return;
    }
    if (post.comments_write_ready) renderPreviewCommentComposer(post);
    else renderPreviewCommentGate(post);
  }

  document.addEventListener("xuanshu:authchange", event => {
    if (!activePreview || !previewDialog.open) return;
    activePreview.comments_write_ready = !!event.detail?.authenticated;
    renderPreviewCommentEntry(activePreview);
  });

  function renderUpdates(post) {
    const host = field("[data-preview-updates]");
    const updates = post.updates || [];
    host.replaceChildren();
    updates.forEach(update => {
      const article = makeElement("article", "reading-update-inline");
      const meta = makeElement("div", "reading-update-meta");
      meta.append(
        makeElement("b", "", `卦主后续 · ${update.verification_status_label || "待观察"}`),
        makeElement("time", "", formatStamp(update.created_at, true)),
      );
      article.append(meta, makeElement("p", "", update.body || ""));
      host.append(article);
    });
  }

  function renderPreview(post) {
    const isHelp = post.post_kind === "help";
    const isBazi = post.system === "bazi";
    const liuyaoPanel = field("[data-preview-liuyao]");
    const baziPanel = field("[data-preview-bazi]");
    liuyaoPanel.hidden = isBazi;
    baziPanel.hidden = !isBazi;
    if (isBazi) {
      renderBaziChart(post.chart || {});
    } else {
      const oracle = post.oracle || {};
      const lines = Array.isArray(oracle.lines) ? oracle.lines : [];
      setField("[data-preview-oracle-meta]", oracle.palace_label || [oracle.moving_label, oracle.shi_ying_label].filter(Boolean).join(" · "));
      setField("[data-preview-ben-name]", oracle.ben_name || "本卦");
      setField("[data-preview-bian-name]", oracle.bian_name || "无变卦");
      renderGuaLines(field("[data-preview-ben-lines]"), lines, false);
      const changedLines = field("[data-preview-bian-lines]");
      const quiet = field("[data-preview-quiet]");
      const bianFigure = field("[data-preview-bian-figure]");
      if (oracle.has_changed) {
        renderGuaLines(changedLines, lines, true);
        changedLines.hidden = false;
        quiet.hidden = true;
        bianFigure.classList.remove("is-quiet");
      } else {
        changedLines.replaceChildren();
        changedLines.hidden = true;
        quiet.hidden = false;
        bianFigure.classList.add("is-quiet");
      }
      setField("[data-preview-moving]", oracle.moving_label || "—");
      setField("[data-preview-shiying]", oracle.shi_ying_label || "—");
      setField("[data-preview-month]", oracle.month_jian || "—");
      setField("[data-preview-day]", oracle.day_chen || "—");
      setField("[data-preview-method]", `${oracle.method_label || ""}${oracle.xun_kong ? ` · 空亡 ${oracle.xun_kong}` : ""}`);
      renderLedger(lines);
    }

    setField("[data-preview-category]", post.question_type_label || "其他");
    setField("[data-preview-question]", post.question || post.title || "六爻卦帖");
    setField("[data-preview-date]", formatStamp(post.published_at || post.created_at));
    setField("[data-preview-viewers]", `${Number(post.viewer_count) || 0} 人看过`);
    setField("[data-preview-answer-title]", "解答");
    setField("[data-preview-comments-title]", isHelp ? "回答与讨论" : "评论");
    const answerSection = field("[data-preview-answer-section]");
    if (answerSection) answerSection.hidden = isHelp;
    const startAction = field("[data-preview-start-action]");
    if (startAction) {
      startAction.href = isHelp ? `/?start=${post.system}&community=help` : `/?start=${post.system}`;
      startAction.textContent = isHelp ? "发起求助" : (isBazi ? "我也要排盘" : "我也要起卦");
    }
    const previewFollow = field("[data-preview-follow]");
    previewFollow.hidden = !isHelp;
    previewFollow.setAttribute("aria-pressed", post.viewer_following ? "true" : "false");
    previewFollow.classList.toggle("is-following", !!post.viewer_following);
    previewFollow.querySelector("[data-follow-label]").textContent = post.viewer_following ? "已关注" : "关注进展";
    const followCount = previewFollow.querySelector("[data-follow-count]");
    followCount.textContent = String(Number(post.follow_count) || 0);
    followCount.hidden = !Number(post.follow_count);
    const previewViewers = field("[data-preview-viewers]");
    previewViewers.title = `共 ${Number(post.view_count) || 0} 次浏览`;
    setField("[data-preview-disclosure]", post.ai_disclosure || "AI 生成解读，仅供传统文化研究与娱乐参考");
    const answer = field("[data-preview-answer]");
    answer.removeAttribute("data-chat-rendered");
    answer.setAttribute("data-chat-markdown", "");
    answer.textContent = post.answer || "";
    window.XuanxueChatRenderer?.renderMarkdownElements(answer.parentElement);
    renderUpdates(post);
    renderComments(post);
    renderPreviewCommentEntry(post);

    const previewLike = field("[data-preview-like]");
    previewLike.dataset.likePost = post.slug;
    previewLike.dataset.likeTitle = post.question || post.title || "这条卦帖";
    syncLikeState(post.slug, post.like_count, !!post.viewer_liked);
    activePreview = post;
    previewLoading.hidden = true;
    previewError.hidden = true;
    previewContent.hidden = false;
    previewDialog.removeAttribute("aria-busy");
    if (previewScroll) previewScroll.scrollTop = 0;
  }

  async function loadPreview(slug) {
    if (previewCache.has(slug)) return previewCache.get(slug);
    const request = fetch(`/api/community/posts/${encodeURIComponent(slug)}`, {
      headers: { Accept: "application/json" },
    }).then(async response => {
      if (!response.ok) {
        const detail = (await response.json().catch(() => ({}))).detail;
        throw new Error(detail || "卦帖加载失败");
      }
      return response.json();
    }).catch(error => {
      previewCache.delete(slug);
      throw error;
    });
    previewCache.set(slug, request);
    return request;
  }

  const previewOverlayId = "community-preview";

  async function openPreviewNow(options = {}) {
    const slug = String(options.slug || "").trim();
    if (!slug) return;
    if (options.opener?.isConnected) opener = options.opener;
    const requestId = ++activeRequest;
    activePreview = null;
    previewContent.hidden = true;
    previewError.hidden = true;
    previewLoading.hidden = false;
    previewDialog.setAttribute("aria-busy", "true");
    previewErrorLink.href = options.href || canonicalFor(slug);
    if (!previewDialog.open) {
      previewDialog.showModal();
      body.classList.add("preview-open");
    }
    requestAnimationFrame(() => previewClose.focus());
    try {
      const [post, view] = await Promise.all([loadPreview(slug), recordView(slug)]);
      if (view) Object.assign(post, view);
      if (requestId !== activeRequest || !previewDialog.open) return;
      renderPreview(post);
      const targetId = new URLSearchParams(location.search).get("target") || "";
      if (/^comment-\d+$/.test(targetId)) {
        requestAnimationFrame(() => document.getElementById(targetId)?.scrollIntoView({ block: "center" }));
      }
    } catch (error) {
      if (requestId !== activeRequest || !previewDialog.open) return;
      previewLoading.hidden = true;
      previewContent.hidden = true;
      previewError.hidden = false;
      previewDialog.removeAttribute("aria-busy");
      previewErrorMessage.textContent = error.message || "请稍后再试。";
    }
  }

  function openPreview(link) {
    const slug = String(link?.dataset?.postSlug || "").trim();
    if (!slug) return undefined;
    opener = link;
    const payload = { slug, href: link.href || canonicalFor(slug) };
    if (window.XuanOverlayHistory) {
      return window.XuanOverlayHistory.open(previewOverlayId, payload, { ...payload, opener: link });
    }
    return openPreviewNow({ ...payload, opener: link });
  }

  function clearSharedPreviewLocation() {
    const url = new URL(location.href);
    if (!url.searchParams.has("post")) return;
    url.searchParams.delete("post");
    url.searchParams.delete("target");
    history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function closePreviewNow() {
    if (previewDialog.open) previewDialog.close();
    clearSharedPreviewLocation();
  }

  function closePreview() {
    if (window.XuanOverlayHistory) return window.XuanOverlayHistory.requestClose(previewOverlayId);
    closePreviewNow();
    return Promise.resolve(true);
  }

  window.XuanOverlayHistory?.register(previewOverlayId, {
    isOpen: () => previewDialog.open,
    open: openPreviewNow,
    close: closePreviewNow,
  });

  function previewLinkFor(event) {
    return event.target instanceof Element ? event.target.closest("[data-community-post]") : null;
  }

  document.addEventListener("pointerover", event => {
    const link = previewLinkFor(event);
    if (link) loadPreview(link.dataset.postSlug || "").catch(() => {});
  });
  document.addEventListener("focusin", event => {
    const link = previewLinkFor(event);
    if (link) loadPreview(link.dataset.postSlug || "").catch(() => {});
  });
  document.addEventListener("click", event => {
    const link = previewLinkFor(event);
    if (!link || (
      event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey ||
      event.shiftKey || event.altKey
    )) return;
    event.preventDefault();
    openPreview(link);
  });

  previewClose.addEventListener("click", closePreview);
  previewDialog.addEventListener("click", event => {
    if (event.target !== previewDialog) return;
    const rect = previewDialog.getBoundingClientRect();
    const outside = event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
    if (outside) closePreview();
  });
  previewDialog.addEventListener("cancel", event => {
    event.preventDefault();
    closePreview();
  });
  previewDialog.addEventListener("close", () => {
    activeRequest += 1;
    activePreview = null;
    body.classList.remove("preview-open");
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  });
  field("[data-preview-copy]").addEventListener("click", () => {
    if (activePreview) copyLink(activePreview.slug, activePreview.question || activePreview.title);
  });
  field("[data-preview-share]").addEventListener("click", () => {
    if (activePreview) sharePost(
      activePreview.slug,
      activePreview.question || activePreview.title,
      activePreview,
    );
  });
  field("[data-preview-follow]").addEventListener("click", async event => {
    if (!activePreview || activePreview.post_kind !== "help") return;
    const button = event.currentTarget;
    let account = await window.XuanxueAccount?.ready();
    if (!account?.authenticated) {
      const loggedIn = await window.XuanxueAccount?.requireLogin({
        mode: "login",
        message: "登录后关注；新回答会提醒。",
      });
      if (!loggedIn) return;
      account = await window.XuanxueAccount?.ready();
    }
    if (!account?.authenticated) return;
    const following = button.getAttribute("aria-pressed") !== "true";
    button.disabled = true;
    try {
      const response = await fetch(`/api/community/posts/${encodeURIComponent(activePreview.slug)}/follow`, {
        method: "POST",
        headers: window.XuanxueAccount?.csrfHeaders({
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Xuanshu-Interaction": "same-origin-v1",
        }),
        credentials: "same-origin",
        body: JSON.stringify({ following }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || "关注失败");
      activePreview.viewer_following = !!payload.following;
      activePreview.follow_count = Number(payload.follow_count) || 0;
      button.setAttribute("aria-pressed", payload.following ? "true" : "false");
      button.classList.toggle("is-following", !!payload.following);
      button.querySelector("[data-follow-label]").textContent = payload.following ? "已关注" : "关注进展";
      const count = button.querySelector("[data-follow-count]");
      count.textContent = String(activePreview.follow_count);
      count.hidden = !activePreview.follow_count;
      showToast(payload.following ? "已关注，有新回答会提醒你" : "已取消关注");
    } catch (error) {
      showToast(error.message || "关注失败", "error");
    } finally {
      button.disabled = false;
    }
  });
  const sharedPostSlug = new URLSearchParams(location.search).get("post") || "";
  if (sharedPostSlug) {
    window.setTimeout(() => openPreviewNow({ slug: sharedPostSlug, href: canonicalFor(sharedPostSlug) }), 0);
  }
})();
