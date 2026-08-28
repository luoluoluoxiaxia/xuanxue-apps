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
    const HOME_COMMUNITY_VIEWS = new Set(["latest", "popular", "featured"]);
    const HOME_COMMUNITY_TYPES = new Set([
      "", "contract", "relationship", "career", "wealth", "exam", "lost", "health", "travel", "other",
    ]);
    let homeCommunityCursor = "";
    let homeCommunityLoadedCount = 0;
    let homeCommunityLoading = false;
    let homeCommunityDone = false;
    let homeCommunityObserver = null;
    let homeCommunityLoadVersion = 0;
    let homeCommunityView = "popular";
    let homeCommunityType = "";
    let homeCommunityRefreshFrame = null;
    const homeCommunitySlugs = new Set();

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
        ? `<a class="home-community-empty-action" href="/?start=liuyao">去公开起卦 <span aria-hidden="true">→</span></a>`
        : "";
      root.innerHTML = `
        <div class="home-community-empty">
          <span class="home-community-empty-mark" aria-hidden="true">卦</span>
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
        const lines = Array.isArray(oracle.lines) ? oracle.lines : [];
        const hasChanged = !!oracle.has_changed;
        const published = String(post.published_at || post.created_at || "").slice(0, 10);
        const liked = !!post.viewer_liked;
        const likeCount = Number(post.like_count) || 0;
        const commentCount = Number(post.comment_count) || 0;
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
        return `
          <article class="home-community-post post-card" role="listitem" data-question-type="${esc(post.question_type || "other")}">
            <a class="post-card-link" href="/gua/${slug}" data-community-post data-post-slug="${esc(rawSlug)}">
              <div class="post-card-body">
                <h3>${esc(post.question || post.title || "一则公开卦帖")}</h3>
                ${oracleHtml}
                <p class="post-card-conclusion">${esc(post.answer_excerpt || "查看完整解答")}</p>
              </div>
            </a>
            <div class="post-card-footer">
                <div class="post-card-meta">
                  <span>${esc(post.question_type_label || "其他")}</span>
                  <time>${esc(published)}</time>
                  <span class="post-card-views" data-post-viewers="${esc(rawSlug)}">${Number(post.viewer_count) || 0} 人看过</span>
                  <span class="post-card-comments">${commentCount} 评论</span>
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
        if (sentinel) sentinel.hidden = false;
        renderHomeCommunityPlaceholder(
          homeCommunityType || homeCommunityView !== "popular" ? "正在筛选卦帖" : "正在翻阅卦帖",
          "找到内容后会直接显示在首页广场。",
          "loading",
        );
      }
      const loadVersion = homeCommunityLoadVersion;
      homeCommunityLoading = true;
      root.setAttribute("aria-busy", "true");
      setHomeCommunityStatus(homeCommunityLoadedCount ? "正在加载更多卦帖…" : "正在加载卦帖…");
      try {
        const query = new URLSearchParams({
          limit: String(homeCommunityView === "popular" ? 100 : HOME_COMMUNITY_PAGE_SIZE),
          view: homeCommunityView,
          include_oracle_summary: "true",
        });
        if (homeCommunityType) query.set("question_type", homeCommunityType);
        if (homeCommunityCursor) {
          query.set("cursor", homeCommunityCursor);
        }
        const resp = await fetch(`/api/community/liuyao/posts?${query}`, { cache: "no-store" });
        if (!resp.ok) throw new Error("卦帖加载失败");
        const data = await resp.json();
        if (loadVersion !== homeCommunityLoadVersion) return;
        const items = Array.isArray(data.items) ? data.items : [];
        const freshItems = items.filter(post => {
          const slug = String(post.slug || "");
          if (!slug || homeCommunitySlugs.has(slug)) return false;
          homeCommunitySlugs.add(slug);
          return true;
        });
        if (freshItems.length) renderHomeCommunityPosts(freshItems, { append: homeCommunityLoadedCount > 0 });
        homeCommunityLoadedCount += freshItems.length;
        homeCommunityCursor = typeof data.next_cursor === "string" ? data.next_cursor : "";
        homeCommunityDone = !homeCommunityCursor;
        if (!homeCommunityLoadedCount) {
          renderHomeCommunityPlaceholder(
            homeCommunityType || homeCommunityView !== "popular" ? "这个筛选下还没有卦帖" : "广场刚刚开卷",
            homeCommunityType || homeCommunityView !== "popular"
              ? "换个分类或排序看看。"
              : "审核通过的公开问题会自动进入这里。",
          );
        }
        if (sentinel) sentinel.hidden = homeCommunityDone;
        setHomeCommunityStatus(homeCommunityDone && homeCommunityLoadedCount ? "已经看到全部卦帖" : "");
      } catch (_) {
        if (loadVersion !== homeCommunityLoadVersion) return;
        if (homeCommunityLoadedCount) {
          root.dataset.state = "ready";
        } else {
          renderHomeCommunityPlaceholder("卦帖暂时没有加载出来", "稍后重试即可，不会离开首页。", "fallback");
        }
        setHomeCommunityStatus("暂时没有加载出来", { retry: true });
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
          const next = button.dataset.homeCommunityView || "popular";
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

    function setupHomeActionDock() {
      const panel = $("[data-home-action-panel]");
      const dock = $("[data-home-action-dock]");
      if (!panel || !dock) return;
      let queued = false;
      const update = () => {
        queued = false;
        const show = document.body.dataset.screen === "landing" && window.scrollY > 48 && panel.getBoundingClientRect().bottom < 72;
        dock.classList.toggle("is-visible", show);
        dock.setAttribute("aria-hidden", show ? "false" : "true");
        dock.inert = !show;
      };
      const schedule = () => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(update);
      };
      window.addEventListener("scroll", schedule, { passive: true });
      window.addEventListener("resize", schedule, { passive: true });
      update();
    }


    return Object.freeze({
      closeEntryScreen,
      loadSiteStats,
      openHomeCommunity,
      refreshHomeCommunityPosts,
      restoreHomeRouteFromLocation,
      scrollHomeCommunityIntoView,
      setMode,
      setupHomeActionDock,
      setupHomeCommunityFeed,
    });
  }

  global.XuanxueHomeCommunity = Object.freeze({ HOME_COMMUNITY_HASH, create });
})(window);
