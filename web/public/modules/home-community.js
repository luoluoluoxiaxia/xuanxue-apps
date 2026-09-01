(function (global) {
  "use strict";

  const HOME_COMMUNITY_HASH = "#gua-square";

  function create({ select, selectAll, escapeHtml, getScreen, showScreen, setPrimaryNavCurrent }) {
    const $ = select;
    const $$ = selectAll;
    const esc = escapeHtml;

    let homeCommunitySettleTimer = null;
    let homeCommunityEntryNeedsSettle = false;
    function scrollHomeCommunityIntoView(behavior = "smooth") {
      const square = $("#gua-square");
      if (!square) return;
      const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      square.scrollIntoView({
        block: "start",
        behavior: reducedMotion ? "auto" : behavior,
      });
    }

    function settleHomeCommunityEntry() {
      homeCommunityEntryNeedsSettle = true;
      const settle = () => {
        if (getScreen() !== "landing" || location.hash !== HOME_COMMUNITY_HASH) return;
        scrollHomeCommunityIntoView("auto");
      };
      if (homeCommunitySettleTimer) window.clearTimeout(homeCommunitySettleTimer);
      homeCommunitySettleTimer = window.setTimeout(() => {
        homeCommunitySettleTimer = null;
        settle();
        if ($("#home-community-feed")?.getAttribute("aria-busy") !== "true") {
          homeCommunityEntryNeedsSettle = false;
        }
      }, 240);
      if (document.readyState !== "complete") {
        window.addEventListener("load", () => requestAnimationFrame(settle), { once: true });
      }
    }

    function openHomeCommunity({ behavior = "smooth", settle = false, historyMode = "push", focusPage = historyMode === "push", refresh = true } = {}) {
      showScreen("landing", { historyMode, routeHash: HOME_COMMUNITY_HASH, focusPage, focusTarget: "#gua-square" });
      setPrimaryNavCurrent("community");
      // HOME COMMUNITY FRESHNESS · 从工作台回到广场时拉取刚发布的卦帖（design-154）
      if (refresh) refreshHomeCommunityPosts();
      requestAnimationFrame(() => scrollHomeCommunityIntoView(behavior));
      if (settle) settleHomeCommunityEntry();
    }

    function restoreHomeRouteFromLocation() {
      const route = currentHomeRoute();
      const query = new URLSearchParams(location.search);
      const start = query.get("start");
      const detailed = start === "liuyao" && query.get("flow") === "detailed";
      if (query.get("view") === "credits") {
        showScreen("credits", { preserveEntryLocation: true, focusPage: true });
        return;
      }
      if (query.get("view") === "archives") {
        showScreen("archives", { preserveEntryLocation: true, focusPage: true });
        Account?.ready().then(account => {
          if (account?.authenticated) openProfileLibrary({ includeCurrent: !!lastPayload, preserveEntryLocation: true });
          else Account.requireLogin({ mode: "login", message: "登录后查看跨设备档案。" })
            .then(ok => {
              if (ok) openProfileLibrary({ includeCurrent: !!lastPayload, preserveEntryLocation: true });
              else renderProfileSignedOut({ preserveEntryLocation: true });
            });
        }).catch(() => {});
        return;
      }
      if (route?.screen === "dash" && lastPayload) {
        enterDashboard({ preserveEntryLocation: true, focusPage: true });
        return;
      }
      if (start === "bazi") {
        birthEntryFrom = route?.fromScreen === "dash" ? "work" : "landing";
        const back = $("#birth-close");
        if (back) back.textContent = birthEntryFrom === "work" ? "← 返回解读" : "← 返回观象台";
        showScreen("birth", { preserveEntryLocation: true, focusPage: true });
        return;
      }
      if (start === "liuyao") {
        pendingCombinedEntry = detailed;
        syncCastEntryMode();
        castEntryFrom = route?.fromScreen === "dash" ? "work" : "landing";
        const back = $("#cast-close");
        if (back) back.textContent = castEntryFrom === "work" ? "← 返回解读" : "← 返回观象台";
        showScreen("cast", { preserveEntryLocation: true, focusPage: true });
        Account?.ready().then(syncCastUI).catch(() => {});
        return;
      }
      const communityRequested = location.hash === HOME_COMMUNITY_HASH;
      showScreen("landing", {
        preserveEntryLocation: true,
        focusPage: true,
        focusTarget: communityRequested ? "#gua-square" : "",
      });
      if (communityRequested) {
        setPrimaryNavCurrent("community");
        refreshHomeCommunityPosts();
        requestAnimationFrame(() => scrollHomeCommunityIntoView("auto"));
      }
    }

    function closeEntryScreen(screen, fallback) {
      const route = currentHomeRoute();
      if (route?.screen === screen && route.pushed) {
        history.back();
        return;
      }
      showScreen(fallback, { historyMode: "replace", focusPage: true });
    }
    function setMode(mode) {
      state.mode = mode;
      document.body.dataset.mode = mode;
      $$("[data-mode-btn]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.modeBtn === mode)));
    }
    function formatCount(value) {
      const n = Number(value || 0);
      return Number.isFinite(n) ? n.toLocaleString("zh-CN") : "0";
    }

    async function loadSiteStats() {
      try {
        const resp = await fetch("/api/site-stats", { cache: "no-store" });
        if (!resp.ok) return;
        const data = await resp.json();
        const answered = data.answered || {};
        const divinations = data.divinations || {};
        const summary = $("[data-site-stats-summary]");
        if (summary) {
          const todayTotal = Number(answered.today || 0) + Number(divinations.today || 0);
          summary.textContent = `已排 ${formatCount(answered.total)} 盘 · 已断 ${formatCount(divinations.total)} 卦 · 今日 ${formatCount(todayTotal)} 问`;
        }
        const baziStats = $("[data-bazi-stats]");
        if (baziStats) {
          baziStats.textContent = `今日已答 ${formatCount(answered.today)} 问 · 累计 ${formatCount(answered.total)} 问`;
          baziStats.hidden = false;
        }
        const liuyaoStats = $("[data-liuyao-stats]");
        if (liuyaoStats) {
          liuyaoStats.textContent = `今日已断 ${formatCount(divinations.today)} 卦 · 累计 ${formatCount(divinations.total)} 卦`;
          liuyaoStats.hidden = false;
        }
      } catch (_) {}
    }

    function renderHomeGuaLines(lines, changed = false) {
      return lines.map(line => {
        const yin = changed ? !!line.changed_yin : !!line.yin;
        const moving = !changed && !!line.moving;
        return `<span class="post-card-gua-line ${yin ? "is-yin" : "is-yang"}${moving ? " is-moving" : ""}"><i></i><i></i></span>`;
      }).join("");
    }

    const HOME_COMMUNITY_PAGE_SIZE = 12;
    const HOME_COMMUNITY_VIEWS = new Set(["latest", "popular", "seeking"]);
    const HOME_COMMUNITY_TYPES = new Set([
      "", "contract", "relationship", "career", "wealth", "exam", "lost", "health", "travel", "other",
    ]);
    let homeCommunityCursor = "";
    let homeCommunityLoadedCount = 0;
    let homeCommunityLoading = false;
    let homeCommunityDone = false;
    let homeCommunityObserver = null;
    let homeCommunityLoadVersion = 0;
    let homeCommunityView = "latest";
    let homeCommunityType = "";
    let homeCommunitySystem = "";
    let homeCommunityRefreshFrame = null;
    const homeCommunitySlugs = new Set();
    const homeCommunityQuestions = new Set();

    function normalizedCommunityQuestion(post) {
      return String(post?.question || post?.title || "")
        .replace(/\s+/g, " ")
        .trim()
        .toLocaleLowerCase("zh-CN");
    }

    function isUsefulCommunityQuestion(post) {
      const question = normalizedCommunityQuestion(post);
      return question.length >= 2 && !/^[\d\s._-]+$/.test(question);
    }

    function renderHomeCommunityPreview(posts) {
      const host = $("[data-home-community-preview]");
      if (!host || !Array.isArray(posts)) return;
      const items = posts.filter(isUsefulCommunityQuestion).slice(0, 3);
      if (!items.length) {
        host.innerHTML = '<p>去社区看看最新问题与回答。</p>';
        return;
      }
      host.innerHTML = items.map(post => {
        const slug = String(post.slug || "");
        const url = String(post.url || `/?post=${encodeURIComponent(slug)}#gua-square`);
        const isHelp = post.post_kind === "help";
        const replies = Number(post.comment_count) || 0;
        return `<a href="${esc(url)}" data-community-post data-post-slug="${esc(slug)}">
          <span>${esc(isHelp ? (replies ? `${replies} 条回答` : "等回答") : "新讨论")}</span>
          <b>${esc(post.question || post.title || "一则社区帖子")}</b>
          <i aria-hidden="true">→</i>
        </a>`;
      }).join("");
    }

    function refreshHomeCommunityPosts() {
      if (homeCommunityRefreshFrame !== null) return;
      homeCommunityRefreshFrame = requestAnimationFrame(() => {
        homeCommunityRefreshFrame = null;
        void loadHomeCommunityPosts({ reset: true });
      });
    }

    function renderHomeCommunityPlaceholder(title, description, state = "empty") {
      const root = $("#home-community-feed");
      if (!root) return;
      root.dataset.state = state;
      const action = state === "empty"
        ? `<a class="home-community-empty-action" href="/?start=liuyao&community=help">发起社区求助 <span aria-hidden="true">→</span></a>`
        : "";
      root.innerHTML = `
        <div class="home-community-empty">
          <span class="home-community-empty-mark" aria-hidden="true">问</span>
          <span>
            <b>${esc(title)}</b>
            <em>${esc(description)}</em>
            ${action}
          </span>
        </div>`;
    }

    function renderHomeCommunityPosts(posts, { append = false } = {}) {
      const root = $("#home-community-feed");
      if (!root || !Array.isArray(posts) || !posts.length) return;
      root.dataset.state = "ready";
      const markup = posts.map((post) => {
        const rawSlug = String(post.slug || "");
        const slug = encodeURIComponent(rawSlug);
        const oracle = post.oracle_summary || {};
        const bazi = post.chart_summary || {};
        const lines = Array.isArray(oracle.lines) ? oracle.lines : [];
        const hasChanged = !!oracle.has_changed;
        const published = String(post.published_at || post.created_at || "").slice(0, 10);
        const authorName = String(post.author_name || "卦友");
        const liked = !!post.viewer_liked;
        const likeCount = Number(post.like_count) || 0;
        const commentCount = Number(post.comment_count) || 0;
        const isHelp = post.post_kind === "help";
        const isBazi = post.system === "bazi";
        const postUrl = String(post.url || `/?post=${slug}#gua-square`);
        const previewAttrs = ` data-community-post data-post-slug="${esc(rawSlug)}"`;
        const oracleHtml = lines.length ? `
          <div class="post-card-oracle">
            <div class="post-card-gua-pair${hasChanged ? "" : " is-static"}">
              <div class="post-card-gua">
                <div class="post-card-gua-name"><small>本卦</small><strong>${esc(oracle.ben_name || "本卦")}</strong></div>
                <div class="post-card-gua-lines" aria-hidden="true">${renderHomeGuaLines(lines)}</div>
              </div>
              ${hasChanged ? `
                <span class="post-card-gua-arrow" aria-hidden="true">→</span>
                <div class="post-card-gua">
                  <div class="post-card-gua-name"><small>变卦</small><strong>${esc(oracle.bian_name || "变卦")}</strong></div>
                  <div class="post-card-gua-lines" aria-hidden="true">${renderHomeGuaLines(lines, true)}</div>
                </div>` : '<span class="post-card-quiet">静卦</span>'}
            </div>
          </div>` : "";
        const pillars = bazi.pillars || {};
        const baziHtml = isBazi && Object.keys(pillars).length ? `
          <div class="post-card-bazi" aria-label="四柱命盘">
            ${["year", "month", "day", "hour"].map(key => `<span${key === "day" ? ' class="is-day"' : ""}>${esc(pillars[key] || "—")}</span>`).join("")}
          </div>` : "";
        const statusLabel = isHelp ? (post.help_status === "resolved" ? "已解决" : "等回答") : "AI 解读";
        return `
          <article class="home-community-post post-card${isHelp ? " is-help" : " is-ai"}" role="listitem" data-question-type="${esc(post.question_type || "other")}" data-system="${esc(post.system || "liuyao")}">
            <a class="post-card-link" href="${esc(postUrl)}"${previewAttrs}>
              <div class="post-card-body">
                <div class="post-card-head">
                  <div class="post-card-labels"><span>${esc(post.system_label || "命理")}</span><b>${esc(statusLabel)}</b></div>
                  <span class="post-card-author">${esc(authorName)} · ${esc(published)}</span>
                </div>
                <h3>${esc(post.question || post.title || "一则社区帖子")}</h3>
                ${oracleHtml}
                ${baziHtml}
                <p class="post-card-conclusion">${esc(isHelp ? (commentCount ? `已有 ${commentCount} 条回答` : "暂无回答，写下判断") : (post.answer_excerpt || "查看完整解答"))}</p>
              </div>
            </a>
            <div class="post-card-footer">
                <div class="post-card-meta">
                  <span>${esc(post.question_type_label || "其他")}</span>
                  <span class="post-card-views" data-post-viewers="${esc(rawSlug)}">${Number(post.viewer_count) || 0} 人看过</span>
                  <span class="post-card-comments">${commentCount} ${isHelp ? "回答" : "评论"}</span>
                  <button type="button" class="post-like-button${liked ? " is-liked" : ""}" data-like-post="${esc(rawSlug)}" data-like-title="${esc(post.question || post.title || "这条卦帖")}" aria-label="${liked ? "已赞：" : "点赞："}${esc(post.question || post.title || "这条卦帖")}" aria-pressed="${liked ? "true" : "false"}" title="${liked ? "已点赞" : "点赞"}">
                    <span data-like-icon aria-hidden="true">${liked ? "♥" : "♡"}</span><b data-like-count>${likeCount}</b>
                  </button>
                </div>
            </div>
          </article>`;
      }).join("");
      if (append) root.insertAdjacentHTML("beforeend", markup);
      else root.innerHTML = markup;
    }

    function setHomeCommunityStatus(message = "", { retry = false } = {}) {
      const status = $("[data-home-community-status]");
      const button = $("[data-home-community-more]");
      if (status) {
        status.textContent = message;
        status.hidden = !message;
      }
      if (button) button.hidden = !retry;
    }

    async function loadHomeCommunityPosts({ reset = false } = {}) {
      const root = $("#home-community-feed");
      const sentinel = $("[data-home-community-sentinel]");
      if (!root || (!reset && (homeCommunityLoading || homeCommunityDone))) return;
      if (reset) {
        homeCommunityLoadVersion += 1;
        homeCommunityCursor = "";
        homeCommunityLoadedCount = 0;
        homeCommunityDone = false;
        homeCommunitySlugs.clear();
        homeCommunityQuestions.clear();
        if (sentinel) sentinel.hidden = false;
        renderHomeCommunityPlaceholder(
          homeCommunityType || homeCommunitySystem || homeCommunityView !== "latest" ? "正在筛选社区帖子" : "正在翻阅社区帖子",
          "找到内容后会直接显示在社区首页。",
          "loading",
        );
      }
      const loadVersion = homeCommunityLoadVersion;
      homeCommunityLoading = true;
      root.setAttribute("aria-busy", "true");
      setHomeCommunityStatus(homeCommunityLoadedCount ? "正在加载更多帖子…" : "正在加载帖子…");
      try {
        const query = new URLSearchParams({
          limit: String(HOME_COMMUNITY_PAGE_SIZE),
          view: homeCommunityView,
          include_oracle_summary: "true",
        });
        if (homeCommunityType) query.set("question_type", homeCommunityType);
        if (homeCommunitySystem) query.set("system", homeCommunitySystem);
        if (homeCommunityCursor) {
          query.set("cursor", homeCommunityCursor);
        }
        const resp = await fetch(`/api/community/posts?${query}`, { cache: "no-store" });
        if (!resp.ok) throw new Error("社区帖子加载失败");
        const data = await resp.json();
        if (loadVersion !== homeCommunityLoadVersion) return;
        const items = Array.isArray(data.items) ? data.items : [];
        const freshItems = items.filter(post => {
          const slug = String(post.slug || "");
          const question = normalizedCommunityQuestion(post);
          if (!slug || homeCommunitySlugs.has(slug) || homeCommunityQuestions.has(question) || !isUsefulCommunityQuestion(post)) return false;
          homeCommunitySlugs.add(slug);
          homeCommunityQuestions.add(question);
          return true;
        });
        if (freshItems.length) {
          renderHomeCommunityPosts(freshItems, { append: homeCommunityLoadedCount > 0 });
          if (!homeCommunityLoadedCount) renderHomeCommunityPreview(freshItems);
        }
        homeCommunityLoadedCount += freshItems.length;
        homeCommunityCursor = typeof data.next_cursor === "string" ? data.next_cursor : "";
        homeCommunityDone = !homeCommunityCursor;
        if (!homeCommunityLoadedCount) {
          renderHomeCommunityPreview([]);
          renderHomeCommunityPlaceholder(
            homeCommunityType || homeCommunitySystem || homeCommunityView !== "latest" ? "此筛选暂无帖子" : "暂无帖子",
            homeCommunityType || homeCommunitySystem || homeCommunityView !== "latest"
              ? "换个分类或排序看看。"
              : "排盘后可发起求助。",
          );
        }
        if (sentinel) sentinel.hidden = homeCommunityDone;
        setHomeCommunityStatus(homeCommunityDone && homeCommunityLoadedCount ? "已加载全部" : "");
      } catch (_) {
        if (loadVersion !== homeCommunityLoadVersion) return;
        if (homeCommunityLoadedCount) {
          root.dataset.state = "ready";
        } else {
          renderHomeCommunityPreview([]);
          renderHomeCommunityPlaceholder("社区加载失败", "请重试。", "fallback");
        }
        setHomeCommunityStatus("加载失败", { retry: true });
      } finally {
        if (loadVersion === homeCommunityLoadVersion) {
          homeCommunityLoading = false;
          root.removeAttribute("aria-busy");
          const more = $("[data-home-community-more]");
          if (more && !("IntersectionObserver" in window) && !homeCommunityDone) more.hidden = false;
          if (homeCommunityEntryNeedsSettle) {
            homeCommunityEntryNeedsSettle = false;
            if (homeCommunitySettleTimer) window.clearTimeout(homeCommunitySettleTimer);
            homeCommunitySettleTimer = null;
            requestAnimationFrame(() => {
              if (getScreen() === "landing" && location.hash === HOME_COMMUNITY_HASH) {
                scrollHomeCommunityIntoView("auto");
              }
            });
          }
        }
      }
    }

    function syncHomeCommunityFilters() {
      $$('[data-home-community-view]').forEach(button => {
        button.setAttribute("aria-pressed", button.dataset.homeCommunityView === homeCommunityView ? "true" : "false");
      });
      $$('[data-home-community-type]').forEach(button => {
        button.setAttribute("aria-pressed", button.dataset.homeCommunityType === homeCommunityType ? "true" : "false");
      });
      $$('[data-home-community-system]').forEach(button => {
        button.setAttribute("aria-pressed", button.dataset.homeCommunitySystem === homeCommunitySystem ? "true" : "false");
      });
    }

    function setupHomeCommunityFilters() {
      const toggle = $("[data-home-community-filter-toggle]");
      const panel = $("#home-community-filters");
      if (!toggle || !panel) return;
      toggle.addEventListener("click", () => {
        const open = toggle.getAttribute("aria-expanded") !== "true";
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
        panel.hidden = !open;
      });
      $$('[data-home-community-view]').forEach(button => {
        button.addEventListener("click", () => {
          const next = button.dataset.homeCommunityView || "latest";
          if (!HOME_COMMUNITY_VIEWS.has(next) || next === homeCommunityView) return;
          homeCommunityView = next;
          syncHomeCommunityFilters();
          void loadHomeCommunityPosts({ reset: true });
        });
      });
      $$('[data-home-community-type]').forEach(button => {
        button.addEventListener("click", () => {
          const next = button.dataset.homeCommunityType || "";
          if (!HOME_COMMUNITY_TYPES.has(next) || next === homeCommunityType) return;
          homeCommunityType = next;
          syncHomeCommunityFilters();
          void loadHomeCommunityPosts({ reset: true });
        });
      });
      $$('[data-home-community-system]').forEach(button => {
        button.addEventListener("click", () => {
          const next = button.dataset.homeCommunitySystem || "";
          if (!["", "bazi", "liuyao"].includes(next) || next === homeCommunitySystem) return;
          homeCommunitySystem = next;
          syncHomeCommunityFilters();
          void loadHomeCommunityPosts({ reset: true });
        });
      });
      syncHomeCommunityFilters();
    }

    function setupHomeCommunityFeed() {
      const sentinel = $("[data-home-community-sentinel]");
      const more = $("[data-home-community-more]");
      if (!sentinel) return;
      setupHomeCommunityFilters();
      if (more) more.addEventListener("click", () => { void loadHomeCommunityPosts(); });
      void loadHomeCommunityPosts({ reset: true }).finally(() => {
        if (!("IntersectionObserver" in window) || homeCommunityObserver) {
          if (!("IntersectionObserver" in window) && more && !homeCommunityDone) more.hidden = false;
          return;
        }
        homeCommunityObserver = new IntersectionObserver(entries => {
          if (entries.some(entry => entry.isIntersecting)) void loadHomeCommunityPosts();
        }, { rootMargin: "700px 0px 300px" });
        homeCommunityObserver.observe(sentinel);
      });
    }

    return Object.freeze({
      closeEntryScreen,
      loadSiteStats,
      openHomeCommunity,
      refreshHomeCommunityPosts,
      restoreHomeRouteFromLocation,
      scrollHomeCommunityIntoView,
      setMode,
      setupHomeCommunityFeed,
    });
  }

  global.XuanxueHomeCommunity = Object.freeze({ HOME_COMMUNITY_HASH, create });
})(window);
