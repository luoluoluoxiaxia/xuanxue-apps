"use strict";

/* Profile archive and interpretation-history workspace.
   This zero-build feature fragment shares the app.js runtime by design. */

/* ============================================================
   档案 / 历史
   ============================================================ */
function renderProfileFab() {
  if (detailedWorkspaceActive()) {
    const status = detailedCaseStatusText();
    $("#profile-fab-state").textContent = status;
    const topState = $("#top-profile-state");
    if (topState) topState.textContent = status;
    const profileFab = $("#profile-fab");
    if (profileFab) {
      profileFab.setAttribute("aria-label", "查看当前详断事项");
      profileFab.onclick = openDetailedCaseOverview;
    }
    return;
  }
  const hasProfile = !!activeProfileId;
  const archiveTotal = Number(Account?.snapshot()?.archiveSummary?.total || 0);
  const stateText = hasProfile
    ? `${activeHistory.length} 条历史`
    : lastPayload
      ? "临时记录"
      : archiveTotal
        ? `${archiveTotal} 份档案`
        : "暂无档案";
  $("#profile-fab-state").textContent = stateText;
  const topState = $("#top-profile-state");
  if (topState) topState.textContent = stateText;
  const profileFab = $("#profile-fab");
  if (profileFab) {
    profileFab.setAttribute("aria-label", "打开档案与历史");
    profileFab.onclick = () => Account.requireLogin({ mode: "login", message: "登录后查看私人档案。" }).then(ok => { if (ok) openProfileHome(); });
  }
}
async function refreshProfileHistory() {
  if (!activeProfileId) { activeHistory = []; renderProfileFab(); return; }
  const r = await fetch(`/api/profiles/${activeProfileId}/interpretations`);
  if (!r.ok) throw new Error(await r.text());
  activeHistory = await r.json();
  renderProfileFab();
}

function openProfileModal(title, subtitle, bodyHtml, focusSelector = "") {
  $("#profile-card").innerHTML =
    `<div class="profile-card-head">
      <div><div class="profile-card-title">${esc(title)}</div><div class="profile-card-sub">${esc(subtitle)}</div></div>
      <button type="button" class="modal-close" data-profile-close aria-label="关闭">×</button>
    </div>
    <div class="profile-card-body sc-scroll">${bodyHtml}</div>`;
  const card = $("#profile-card");
  card.querySelector("[data-profile-close]").onclick = closeProfileModal;
  setPrimaryNavCurrent("profile");
  showModalMask($("#profile-modal"), focusSelector ? card.querySelector(focusSelector) : card.querySelector("[data-profile-close]"));
}

function closeProfileModal(afterClose = null) {
  profileLibraryRequestId += 1;
  pendingProfileDeleteId = null;
  deletingProfileId = null;
  pendingHistoryDeleteId = null;
  deletingHistoryId = null;
  return hideModalMask($("#profile-modal"), () => {
    setPrimaryNavCurrent(currentScreenNavTarget());
    if (typeof afterClose === "function") afterClose();
  });
}

function openDetailedCaseOverview() {
  if (!detailedWorkspaceActive()) {
    openProfileHome();
    return;
  }
  const bazi = detailedBaziFacts();
  const p = lastPayload || {};
  const ben = p.ben_gua || {};
  const bian = (p.dong_yao || []).length ? ` → ${(p.bian_gua || {}).name || "变卦"}` : "";
  const body = `<div class="detailed-case-overview">
    <div class="detailed-case-question"><span>所问之事</span><b>${esc(liuyaoQuestionText())}</b><em>${esc(detailedCaseStatusText())}</em></div>
    <div class="detailed-case-pair">
      <div><span>本人命盘</span><b>${esc(bazi.name)}</b><em>${esc(bazi.pillars || "命盘正在读取")}</em></div>
      <i>×</i>
      <div><span>本次卦象</span><b>${esc((ben.name || "本卦") + bian)}</b><em>${esc(p.month_jian || "—")}月建 · ${esc(p.day_chen || "—")}日辰</em></div>
    </div>
    <p>独立的一事详断记录。八字与卦象共同支持结论，后续追问保留在本事项。</p>
    <div class="profile-card-actions detailed-case-actions">
      <button type="button" class="primary" data-detailed-continue>继续这件事</button>
      <button type="button" data-detailed-new>另起一事</button>
    </div>
  </div>`;
  openProfileModal("一事详断", "八字 × 卦象同参", body, "[data-detailed-continue]");
  const card = $("#profile-card");
  card.querySelector("[data-detailed-continue]").onclick = () => closeProfileModal(() => $("#draft-input")?.focus());
  card.querySelector("[data-detailed-new]").onclick = () => closeProfileModal(() => PersonalHome?.openDetailed());
}

function openProfileHome() {
  const hasProfile = !!activeProfileId;
  const unit = state.system === "liuyao" ? "卦盘" : "命盘";
  const isBazi = state.system !== "liuyao";
  const savedBazi = accountProfileFor("bazi");
  const savedLiuyao = accountProfileFor("liuyao");
  const visibilityLabel = isBazi ? "仅自己" : ((lastPayload?.visibility || lastInput?.visibility) === "public" ? "公开" : "私密");
  const savedLabel = hasProfile ? `已入档 · ${visibilityLabel}` : "临时记录";
  const baziBody = (() => {
    if (!isBazi || !lastPayload?.chart) {
      if (savedBazi?.id) {
        const summary = savedBazi.summary || {};
        const pillars = ["year", "month", "day", "hour"].map(key => summary.pillars?.[key]).filter(Boolean).join(" ");
        return `<div class="profile-oracle-card bazi">
          <div class="profile-oracle-head"><span>八字 · 命盘</span><em>账户档案</em></div>
          <div class="profile-oracle-name">${esc(savedBazi.name || "命盘")}</div>
          <div class="profile-oracle-pillars">${esc(pillars || "四柱命盘")}</div>
          <div class="profile-oracle-meta">${esc(archiveDateLabel(savedBazi.created_at))} · ${Number(savedBazi.history_count || 0)} 条历史解读</div>
          <div class="profile-card-actions"><button type="button" data-profile-open-bazi-detail="${Number(savedBazi.id)}">查看档案</button></div>
        </div>`;
      }
      return `<div class="profile-oracle-card bazi muted">
        <div class="profile-oracle-head"><span>八字 · 命盘</span><em>未载入</em></div>
        <div class="profile-oracle-name">尚无当前命盘</div>
        <div class="profile-oracle-meta">登录后排盘、解读与追问自动入档。</div>
        <div class="profile-card-actions"><button type="button" data-profile-open-bazi>开始排盘</button></div>
      </div>`;
    }
    const p = lastPayload;
    const c = p.chart || {};
    const pillars = ["year", "month", "day", "hour"].map(k => c.pillars?.[k]).filter(Boolean).join(" ");
    const profile = p.profile || {};
    const meta = [lastInput?.location, (profile.solar || "").slice(0, 16)].filter(Boolean).join(" · ") || "当前命盘";
    return `<div class="profile-oracle-card bazi">
      <div class="profile-oracle-head"><span>八字 · 命盘</span><em>${esc(savedLabel)}</em></div>
      <div class="profile-oracle-name">${esc(profileName || "命盘")} · ${esc(genderLabel(profile.gender))}</div>
      <div class="profile-oracle-pillars">${esc(pillars || "四柱未定")}</div>
      <div class="profile-oracle-meta">${esc(meta)}</div>
      <div class="profile-card-actions">
        <button type="button" data-profile-history ${hasProfile ? "" : "disabled"}>历史解读</button>
      </div>
    </div>`;
  })();
  const liuyaoBody = (() => {
    if (isBazi || !lastPayload?.ben_gua) {
      if (savedLiuyao?.id) {
        const summary = savedLiuyao.summary || {};
        const ben = summary.ben_gua?.name || savedLiuyao.name || "六爻";
        const bianName = summary.bian_gua?.name || "";
        const bian = bianName && bianName !== ben ? ` <span>之</span> ${esc(bianName)}` : "";
        const visibility = savedLiuyao.visibility === "public" ? "公开" : "私密";
        return `<div class="profile-oracle-card liuyao">
          <div class="profile-oracle-head"><span>六爻 · 卦档</span><em>账户档案 · ${esc(visibility)}</em></div>
          <div class="profile-oracle-name">${esc(ben)}${bian}</div>
          <div class="profile-oracle-meta">「${esc(summary.question || savedLiuyao.name || "所问事项")}」</div>
          <div class="profile-oracle-meta">${esc(archiveDateLabel(savedLiuyao.created_at))} · ${Number(savedLiuyao.history_count || 0)} 条历史解读</div>
          <div class="profile-card-actions"><button type="button" data-profile-open-saved="${Number(savedLiuyao.id)}">打开卦档</button></div>
        </div>`;
      }
      return `<div class="profile-oracle-card liuyao muted">
        <div class="profile-oracle-head"><span>六爻 · 卦档</span><em>未载入</em></div>
        <div class="profile-oracle-name">尚无当前卦盘</div>
        <div class="profile-oracle-meta">登录后起卦自动入档，并保留公开或私密状态。</div>
        <div class="profile-card-actions"><button type="button" data-profile-open-liuyao>凝神起卦</button></div>
      </div>`;
    }
    const p = lastPayload;
    const ben = p.ben_gua?.name || "本卦";
    const bian = (p.dong_yao || []).length ? ` <span>之</span> ${esc(p.bian_gua?.name || "变卦")}` : "";
    return `<div class="profile-oracle-card liuyao">
      <div class="profile-oracle-head"><span>六爻 · 本次卦</span><em>${esc(savedLabel)}</em></div>
      <div class="profile-oracle-name">${esc(ben)}${bian}</div>
      <div class="profile-oracle-meta">「${esc(p.question || "未填写所问")}」</div>
      <div class="profile-oracle-meta">${esc(p.month_jian || "—")}月建 · ${esc(p.day_chen || "—")}日辰 · 动爻 ${esc(liuyaoDongText(p))}</div>
      <div class="profile-card-actions">
        <button type="button" data-profile-history ${hasProfile ? "" : "disabled"}>历史解读</button>
      </div>
    </div>`;
  })();
  const body =
    `<div class="profile-home profile-oracle-home">
      ${baziBody}
      ${liuyaoBody}
      <div class="profile-archive-note">登录后排盘或起卦自动入档。</div>
      <div class="profile-home-actions profile-utility-actions">
        <button type="button" data-profile-library>档案列表</button>
        <button type="button" data-profile-history ${hasProfile ? "" : "disabled"}>查看历史解读</button>
      </div>
      ${isDesktopLayout() ? `<button type="button" class="profile-bigtext-btn" data-big-toggle data-big-suffix="模式">大字模式</button>` : ""}
      <button type="button" class="profile-feedback-link" data-profile-feedback>提交反馈 →</button>
    </div>`;
  openProfileModal("档 案", `保存于当前账户 · 当前${unit}${hasProfile ? ` · ${activeHistory.length} 条历史` : ""}`, body);
  const bigBtn = $("#profile-card").querySelector("[data-big-toggle]");
  if (bigBtn) {
    bigBtn.onclick = toggleBigText;
    applyBigText();
  }
  const library = $("#profile-card").querySelector("[data-profile-library]");
  const histories = $("#profile-card").querySelectorAll("[data-profile-history]");
  const openBazi = $("#profile-card").querySelector("[data-profile-open-bazi]");
  const openLiuyao = $("#profile-card").querySelector("[data-profile-open-liuyao]");
  const openBaziDetail = $("#profile-card").querySelector("[data-profile-open-bazi-detail]");
  const openSaved = $("#profile-card").querySelectorAll("[data-profile-open-saved]");
  const feedback = $("#profile-card").querySelector("[data-profile-feedback]");
  if (library) library.onclick = openProfileLibrary;
  histories.forEach(history => { history.onclick = openHistoryModal; });
  if (openBazi) openBazi.onclick = () => closeProfileModal(() => openBirthModal());
  if (openLiuyao) openLiuyao.onclick = () => closeProfileModal(() => openCastModal({ clearQuestion: true, fresh: true }));
  if (openBaziDetail) openBaziDetail.onclick = () => openBaziProfileDetail(Number(openBaziDetail.dataset.profileOpenBaziDetail));
  openSaved.forEach(button => {
    button.onclick = async () => {
      button.disabled = true;
      button.textContent = "打开中…";
      await openSavedProfile(Number(button.dataset.profileOpenSaved));
      if (button.isConnected) {
        button.disabled = false;
        button.textContent = button.closest(".liuyao") ? "打开卦档" : "打开命盘";
      }
    };
  });
  if (feedback) feedback.onclick = () => closeProfileModal(() => openFeedback());
}

function archiveDateLabel(value) {
  const raw = String(value || "").trim().replace("T", " ").replace(/Z$/, "");
  return raw ? raw.slice(0, 16) : "时间未记录";
}

function archiveTaskState(status) {
  if (status === "pending" || status === "running") return { label: "解读进行中", tone: "active" };
  if (status === "failed") return { label: "上次解读未完成", tone: "failed" };
  if (status === "cancelled") return { label: "上次解读已停止", tone: "stopped" };
  return null;
}

function profileDeleteConfirmHtml(profile) {
  const busy = Number(deletingProfileId) === Number(profile.id);
  const unit = (profile.system || profile.summary?.system) === "liuyao" ? "卦档" : "命盘";
  const count = Number(profile.history_count || 0);
  const detail = count
    ? `同时删除 ${count} 条历史解读，且无法恢复。`
    : `这份${unit}将从账户中移除，删除后无法恢复。`;
  return `<div class="profile-delete-confirm" role="group" aria-label="确认删除档案">
    <div><b>确定永久删除这份${unit}？</b><span>${detail}</span></div>
    <div class="profile-delete-confirm-actions">
      <button type="button" data-cancel-delete-profile="${profile.id}" ${busy ? "disabled" : ""}>取消</button>
      <button type="button" class="danger" data-confirm-delete-profile="${profile.id}" ${busy ? "disabled" : ""}>${busy ? "正在删除…" : "永久删除"}</button>
    </div>
  </div>`;
}

async function openProfileLibrary() {
  const supplied = arguments[0];
  const options = supplied && typeof supplied === "object" && !(supplied instanceof Event) ? supplied : {};
  if (options.tab === "bazi" || options.tab === "liuyao") profileArchiveTab = options.tab;
  const requestId = ++profileLibraryRequestId;
  if (!options.preserveDelete) {
    pendingProfileDeleteId = null;
    deletingProfileId = null;
    openProfileModal(
      "档案列表",
      "正在同步当前账户的档案…",
      `<div class="profile-empty" role="status">正在读取档案，请稍候…</div>`,
    );
  }
  const includeCurrent = !!options.includeCurrent && !!lastPayload;
  try {
    const r = await fetch("/api/profiles");
    if (!r.ok) throw new Error(await r.text());
    const profiles = await r.json();
    if (requestId !== profileLibraryRequestId) return;
    setAccountProfileIndex(profiles);
    const currentProfile = includeCurrent && activeProfileId
      ? profiles.find(p => Number(p.id) === Number(activeProfileId)) || null
      : null;
    const tabProfiles = profiles.filter(p => profileSystemKey(p) === profileArchiveTab);
    const currentIsInTab = !!currentProfile && profileSystemKey(currentProfile) === profileArchiveTab;
    const visibleProfiles = currentIsInTab
      ? tabProfiles.filter(p => Number(p.id) !== Number(activeProfileId))
      : tabProfiles;
    const currentCard = includeCurrent && currentIsInTab ? currentArchiveCardHtml(currentProfile) : "";
    const profileCards = visibleProfiles.map(p => {
      const isLy = (p.system || p.summary?.system) === "liuyao";
      const summary = p.summary || {};
      const ben = summary.ben_gua?.name || "";
      const bian = summary.bian_gua?.name || "";
      const lyLine = [ben, bian && bian !== ben ? `→ ${bian}` : ""].filter(Boolean).join(" ");
      const pillars = isLy ? (lyLine || summary.question || "六爻卦盘") : (summary.pillars ? Object.values(summary.pillars).join(" ") : "");
      const fallbackName = isLy ? "未命名卦盘" : "未命名命盘";
      const visibility = isLy ? (p.visibility === "public" ? "公开" : "私密") : "仅自己";
      const typeLabel = isLy ? "六爻" : "八字";
      const taskState = archiveTaskState(p.task_status);
      const detail = isLy && summary.question ? `<div class="saved-pillars sub">${esc(summary.question)}</div>` : "";
      const confirming = Number(pendingProfileDeleteId) === Number(p.id);
      const publicSlug = String(p.public_post?.slug || "").trim();
      const defaultBadge = !isLy && p.is_default
        ? `<em class="saved-default-badge">默认命盘</em>`
        : "";
      const defaultAction = !isLy && !p.is_default
        ? `<button type="button" data-set-default-profile="${p.id}">设为默认</button>`
        : "";
      const actions = confirming
        ? profileDeleteConfirmHtml(p)
        : `<div class="profile-card-actions saved-actions">
            <button type="button" class="primary" ${isLy ? `data-open-profile="${p.id}"` : `data-open-bazi-profile="${p.id}"`}>${isLy ? "打开卦档" : "查看档案"}</button>
            ${defaultAction}
            ${p.visibility === "public"
              ? publicSlug
                ? `<a class="profile-action-link" href="/gua/${encodeURIComponent(publicSlug)}" data-community-post data-post-slug="${esc(publicSlug)}">查看公开卦帖</a>`
                : `<span class="saved-retained">公开档案随卦帖保留</span>`
              : `<button type="button" class="danger" data-request-delete-profile="${p.id}">删除</button>`}
          </div>`;
      return `<div class="saved-item">
        <div class="saved-main">
          <div class="saved-copy">
            <div class="saved-eyebrow"><span>${esc(typeLabel)}</span><em>${esc(visibility)}</em>${defaultBadge}</div>
            <div class="saved-name">${esc(p.name || fallbackName)}</div>
            <div class="saved-meta">${esc(archiveDateLabel(p.created_at))} · ${p.history_count || 0} 条解读</div>
            ${taskState ? `<div class="saved-task-state ${taskState.tone}"><i></i>${esc(taskState.label)}</div>` : ""}
            <div class="saved-pillars">${esc(pillars)}</div>
            ${detail}
          </div>
          ${actions}
        </div>
      </div>`;
    }).join("");
    const archiveEmpty = visibleProfiles.length || currentCard
      ? ""
      : `<div class="profile-empty profile-empty-actionable">
            <span>${profileArchiveTab === "bazi" ? "暂无八字档案。" : "暂无六爻档案。"}</span>
            <div class="profile-empty-actions">
              ${profileArchiveTab === "bazi"
                ? `<button type="button" class="primary" data-empty-open-bazi>去排八字</button>`
                : `<button type="button" class="primary" data-empty-open-liuyao>去起六爻</button>`}
            </div>
          </div>`;
    const baziCount = profiles.filter(p => (p.system || p.summary?.system) !== "liuyao").length;
    const liuyaoCount = profiles.length - baziCount;
    const historyCount = profiles.reduce((total, p) => total + Number(p.history_count || 0), 0);
    const activeCount = profiles.filter(p => ["pending", "running"].includes(p.task_status)).length;
    const body = `<div class="saved-list">
      <div class="saved-library-summary" role="status">
        <b>${profiles.length} 份云端档案</b>
        <span>${baziCount} 份八字 · ${liuyaoCount} 份六爻 · ${historyCount} 条解读${activeCount ? ` · ${activeCount} 份档案正在生成` : ""}</span>
      </div>
      <div class="profile-home-actions profile-library-account-actions">
        <button type="button" data-profile-account>账户与退出</button>
      </div>
      <div class="archive-system-tabs" role="tablist" aria-label="档案类型">
        <button type="button" id="archive-tab-bazi" role="tab" data-archive-tab="bazi" aria-controls="archive-system-panel" aria-selected="${profileArchiveTab === "bazi"}" tabindex="${profileArchiveTab === "bazi" ? "0" : "-1"}" class="${profileArchiveTab === "bazi" ? "active" : ""}">八字 <span>${baziCount}</span></button>
        <button type="button" id="archive-tab-liuyao" role="tab" data-archive-tab="liuyao" aria-controls="archive-system-panel" aria-selected="${profileArchiveTab === "liuyao"}" tabindex="${profileArchiveTab === "liuyao" ? "0" : "-1"}" class="${profileArchiveTab === "liuyao" ? "active" : ""}">六爻 <span>${liuyaoCount}</span></button>
      </div>
      <div id="archive-system-panel" class="archive-system-panel" role="tabpanel" aria-labelledby="archive-tab-${profileArchiveTab}">
      ${currentCard}
      ${currentCard && (profileCards || archiveEmpty) ? `<div class="saved-section-title">全部档案</div>` : ""}
      ${profileCards || archiveEmpty}
      </div>
    </div>`;
    const focusSelector = pendingProfileDeleteId
      ? `[data-cancel-delete-profile="${pendingProfileDeleteId}"]`
      : options.focusProfileAction
        ? `[data-request-delete-profile="${Number(options.focusProfileAction)}"]`
        : options.focusArchiveTab
          ? `[data-archive-tab="${options.focusArchiveTab}"]`
          : "";
    openProfileModal("档案", profiles.length ? "选择档案继续查看。" : "", body, focusSelector);
    const account = $("#profile-card").querySelector("[data-profile-account]");
    if (account) account.onclick = () => closeProfileModal(() => Account.open("account"));
    const current = $("#profile-card").querySelector("[data-open-current-profile]");
    if (current) current.onclick = openCurrentProfile;
    $("#profile-card").querySelectorAll("[data-archive-tab]").forEach(tab => {
      tab.onclick = () => openProfileLibrary({
        ...options,
        tab: tab.dataset.archiveTab,
        preserveDelete: true,
        focusArchiveTab: tab.dataset.archiveTab,
      });
      tab.onkeydown = event => {
        if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
        event.preventDefault();
        const nextTab = tab.dataset.archiveTab === "bazi" ? "liuyao" : "bazi";
        openProfileLibrary({ ...options, tab: nextTab, preserveDelete: true, focusArchiveTab: nextTab });
      };
    });
    $("#profile-card").querySelectorAll("[data-open-bazi-profile]").forEach(b => {
      b.onclick = () => openBaziProfileDetail(Number(b.dataset.openBaziProfile));
    });
    $("#profile-card").querySelectorAll("[data-open-profile]").forEach(b => {
      b.onclick = async () => {
        b.disabled = true;
        b.textContent = "打开中…";
        await openSavedProfile(Number(b.dataset.openProfile));
        if (b.isConnected) {
          b.disabled = false;
          b.textContent = "打开卦档";
        }
      };
    });
    $("#profile-card").querySelectorAll("[data-set-default-profile]").forEach(b => {
      b.onclick = () => setArchiveDefaultProfile(
        Number(b.dataset.setDefaultProfile),
        options,
      );
    });
    $("#profile-card").querySelectorAll("[data-request-delete-profile]").forEach(b => {
      b.onclick = () => {
        const pid = Number(b.dataset.requestDeleteProfile);
        if (pid === Number(activeProfileId) && activeStreamingMessage()) {
          toast("请先等待当前解读完成，或停止解读后再删除档案", "warn");
          return;
        }
        pendingProfileDeleteId = pid;
        openProfileLibrary({ ...options, preserveDelete: true, focusProfileAction: null });
      };
    });
    $("#profile-card").querySelectorAll("[data-cancel-delete-profile]").forEach(b => {
      b.onclick = () => {
        const pid = Number(b.dataset.cancelDeleteProfile);
        pendingProfileDeleteId = null;
        openProfileLibrary({ ...options, preserveDelete: true, focusProfileAction: pid });
      };
    });
    $("#profile-card").querySelectorAll("[data-confirm-delete-profile]").forEach(b => {
      b.onclick = () => deleteSavedProfile(Number(b.dataset.confirmDeleteProfile), options);
    });
    const emptyOpenBazi = $("#profile-card").querySelector("[data-empty-open-bazi]");
    const emptyOpenLiuyao = $("#profile-card").querySelector("[data-empty-open-liuyao]");
    if (emptyOpenBazi) emptyOpenBazi.onclick = () => closeProfileModal(() => openBirthModal());
    if (emptyOpenLiuyao) emptyOpenLiuyao.onclick = () => closeProfileModal(() => openCastModal({ clearQuestion: true, fresh: true }));
  } catch (e) {
    if (requestId !== profileLibraryRequestId) return;
    const retryBody = `<div class="profile-empty profile-empty-actionable">
      <span>档案加载失败，已保存内容不受影响。</span>
      <div class="profile-empty-actions"><button type="button" class="primary" data-retry-profile-library>重新加载</button></div>
    </div>`;
    openProfileModal("档案列表", "网络恢复后重试。", retryBody, "[data-retry-profile-library]");
    const retry = $("#profile-card").querySelector("[data-retry-profile-library]");
    if (retry) retry.onclick = () => openProfileLibrary(options);
    toast("读取档案失败：" + humanError(String(e.message || e)), "warn");
  }
}

function baziProfilePillars(profile) {
  const pillars = profile?.payload?.chart?.pillars || profile?.summary?.pillars || {};
  return ["year", "month", "day", "hour"].map(key => pillars[key]).filter(Boolean).join(" ");
}

function baziConversationState(status) {
  if (status === "pending" || status === "running") return { label: "正在解读", tone: "active" };
  if (status === "failed") return { label: "上次未完成", tone: "failed" };
  if (status === "cancelled") return { label: "已停止", tone: "stopped" };
  return { label: "可继续", tone: "done" };
}

async function openBaziProfileDetail(pid) {
  if (!pid) return;
  profileLibraryRequestId += 1;
  openProfileModal(
    "八字档案",
    "正在读取命盘与对话历史…",
    `<div class="profile-empty" role="status">正在整理这份八字档案，请稍候…</div>`,
  );
  try {
    const [profileResponse, conversationResponse] = await Promise.all([
      fetch(`/api/profiles/${pid}`),
      fetch(`/api/profiles/${pid}/conversations`),
    ]);
    if (!profileResponse.ok) throw new Error(await profileResponse.text());
    if (!conversationResponse.ok) throw new Error(await conversationResponse.text());
    const profile = await profileResponse.json();
    const conversations = await conversationResponse.json();
    if ((profile.system || profile.payload?.system) !== "bazi") {
      throw new Error("这不是八字档案");
    }
    const pillars = baziProfilePillars(profile) || "四柱命盘";
    const birthProfile = profile.payload?.profile || {};
    const birthMeta = [
      genderLabel(birthProfile.gender || profile.input?.gender),
      profile.input?.location,
      String(birthProfile.solar || "").slice(0, 16),
    ].filter(Boolean).join(" · ");
    const latest = conversations[0] || null;
    const conversationCards = conversations.map((conversation, index) => {
      const stateInfo = baziConversationState(conversation.status);
      const title = conversation.first_question || conversation.last_question || "本命解读";
      const lastQuestion = conversation.last_question && conversation.last_question !== title
        ? `<div class="bazi-conversation-latest">最近追问：${esc(conversation.last_question)}</div>`
        : "";
      const preview = historyAnswerPreview(conversation.last_answer || "", 150);
      return `<article class="bazi-conversation-card${index === 0 ? " latest" : ""}">
        <div class="bazi-conversation-head">
          <div class="saved-eyebrow"><span>${index === 0 ? "最近对话" : "历史对话"}</span><em>${esc(stateInfo.label)}</em></div>
          <time>${esc(archiveDateLabel(conversation.updated_at))}</time>
        </div>
        <div class="bazi-conversation-title">${esc(title)}</div>
        ${lastQuestion}
        ${preview ? `<div class="bazi-conversation-preview">${esc(preview)}</div>` : ""}
        <div class="bazi-conversation-foot">
          <span>${Number(conversation.turn_count || 0)} 个问题 · ${Number(conversation.message_count || 0)} 条消息</span>
          <button type="button" class="${index === 0 ? "primary" : ""}" data-resume-bazi-conversation="${esc(conversation.session_id)}">查看并继续</button>
        </div>
      </article>`;
    }).join("");
    const body = `<div class="bazi-archive-detail">
      <button type="button" class="profile-detail-back" data-profile-back-library>← 返回八字档案</button>
      <section class="bazi-archive-hero">
        <div class="saved-eyebrow"><span>八字命盘</span>${profile.is_default ? `<em class="saved-default-badge">默认命盘</em>` : ""}</div>
        <h3>${esc(profile.name || "我的八字")}</h3>
        <div class="bazi-archive-pillars">${esc(pillars)}</div>
        <div class="bazi-archive-meta">${esc(birthMeta || "出生信息已保存")}</div>
        <div class="bazi-archive-primary-actions">
          ${latest ? `<button type="button" class="primary" data-resume-latest-bazi>恢复上次对话</button>` : ""}
          <button type="button" class="${latest ? "" : "primary"}" data-new-bazi-conversation>开启新对话</button>
        </div>
        <p>新对话会沿用这份命盘，但不会带入旧对话内容。</p>
      </section>
      <div class="bazi-conversation-section-head">
        <div><b>对话历史</b><span>按完整会话整理</span></div>
        <em>${conversations.length} 次对话</em>
      </div>
      ${conversationCards || `<div class="profile-empty profile-empty-actionable">
        <span>暂无对话，开始首次解读。</span>
        <div class="profile-empty-actions"><button type="button" class="primary" data-new-bazi-conversation>开启新对话</button></div>
      </div>`}
    </div>`;
    openProfileModal(
      profile.name || "八字档案",
      `${conversations.length} 次对话 · 可恢复，也可从同一命盘重新开始`,
      body,
      latest ? "[data-resume-latest-bazi]" : "[data-new-bazi-conversation]",
    );
    const back = $("#profile-card").querySelector("[data-profile-back-library]");
    if (back) back.onclick = () => openProfileLibrary({ tab: "bazi" });
    const openConversation = async conversation => {
      if (!conversation) return;
      await openSavedProfile(pid, { resumeSessionId: conversation.session_id });
    };
    const latestButton = $("#profile-card").querySelector("[data-resume-latest-bazi]");
    if (latestButton) latestButton.onclick = () => openConversation(latest);
    $("#profile-card").querySelectorAll("[data-resume-bazi-conversation]").forEach(button => {
      button.onclick = () => openConversation(
        conversations.find(item => item.session_id === button.dataset.resumeBaziConversation),
      );
    });
    $("#profile-card").querySelectorAll("[data-new-bazi-conversation]").forEach(button => {
      button.onclick = () => openSavedProfile(pid, { freshConversation: true });
    });
  } catch (e) {
    const retryBody = `<div class="profile-empty profile-empty-actionable">
      <span>档案加载失败，对话记录不受影响。</span>
      <div class="profile-empty-actions">
        <button type="button" data-profile-back-library>返回档案列表</button>
        <button type="button" class="primary" data-retry-bazi-profile>重新加载</button>
      </div>
    </div>`;
    openProfileModal("八字档案", "网络恢复后重试。", retryBody, "[data-retry-bazi-profile]");
    const back = $("#profile-card").querySelector("[data-profile-back-library]");
    const retry = $("#profile-card").querySelector("[data-retry-bazi-profile]");
    if (back) back.onclick = () => openProfileLibrary({ tab: "bazi" });
    if (retry) retry.onclick = () => openBaziProfileDetail(pid);
    toast("读取八字档案失败：" + humanError(String(e.message || e)), "warn");
  }
}

async function setArchiveDefaultProfile(pid, options = {}) {
  if (!pid) return;
  const button = $("#profile-card")?.querySelector(`[data-set-default-profile="${pid}"]`);
  if (button) {
    button.disabled = true;
    button.textContent = "设置中…";
  }
  try {
    const response = await fetch("/api/personal-home/default-profile", {
      method: "PUT",
      headers: Account.csrfHeaders({ "Content-Type": "application/json", Accept: "application/json" }),
      credentials: "same-origin",
      body: JSON.stringify({ profile_id: Number(pid) }),
    });
    if (!response.ok) throw new Error(await response.text());
    await refreshAccountProfileIndex({ force: true });
    window.XuanxuePersonalHome?.load?.({ quiet: true }).catch(() => {});
    await openProfileLibrary({ ...options, preserveDelete: true });
    toast("已设为默认命盘");
  } catch (e) {
    if (button?.isConnected) {
      button.disabled = false;
      button.textContent = "设为默认";
    }
    toast("设置失败：" + humanError(String(e.message || e)), "warn");
  }
}

function clearDeletedProfileFromWorkspace(pid) {
  Object.keys(sessionStore).forEach(key => {
    if (Number(sessionStore[key]?.activeProfileId) === Number(pid)) sessionStore[key] = null;
  });
  if (Number(activeProfileId) !== Number(pid)) return false;
  stopAllPendingWork();
  sessionStore[currentWorkspaceKey()] = null;
  lastInput = null;
  lastPayload = null;
  activeChartId = null;
  activeProfileId = null;
  activeHistory = [];
  profileName = "命盘";
  calendarLabel = "公历";
  state.system = "bazi";
  initThreads();
  clearCookie(RESUME_COOKIE);
  renderProfileFab();
  return true;
}

async function deleteSavedProfile(pid, options = {}) {
  if (!pid || deletingProfileId) return;
  deletingProfileId = pid;
  await openProfileLibrary({ ...options, preserveDelete: true });
  try {
    const r = await fetch(`/api/profiles/${pid}`, {
      method: "DELETE",
      headers: Account.csrfHeaders(),
    });
    if (!r.ok) throw new Error(await r.text());
    const removedCurrent = clearDeletedProfileFromWorkspace(pid);
    pendingProfileDeleteId = null;
    deletingProfileId = null;
    await Account.refresh();
    if (removedCurrent) {
      showScreen("landing");
    }
    await openProfileLibrary({ ...options, preserveDelete: true });
    toast("档案已永久删除");
  } catch (e) {
    deletingProfileId = null;
    await openProfileLibrary({ ...options, preserveDelete: true });
    toast("删除失败：" + humanError(String(e.message || e)), "warn");
  }
}

function currentArchiveCardHtml(currentProfile = null) {
  if (!lastPayload) return "";
  const isLy = state.system === "liuyao";
  const visibility = isLy ? ((lastPayload.visibility || lastInput?.visibility) === "public" ? "公开" : "私密") : "仅自己";
  const label = activeProfileId ? `已入档 · ${visibility}` : "临时记录";
  let title = profileName || (isLy ? "六爻" : "命盘");
  const currentMessages = Object.values(state.threads || {}).flat();
  const liveTask = currentMessages.find(message => message.kind === "ai" && message.streaming);
  const lastTask = currentMessages.filter(message => message.kind === "ai").sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
  const taskState = liveTask
    ? "解读正在后台继续"
    : lastTask?.error
      ? "上次解读未完成"
      : lastTask?.stopped
        ? "上次解读已停止"
        : "";
  const historyCount = Number(currentProfile?.history_count ?? activeHistory.length);
  let meta = taskState || (activeProfileId ? `${historyCount} 条历史` : "当前记录未绑定账户档案");
  let detail = "";
  let subDetail = "";
  if (isLy) {
    const ben = lastPayload.ben_gua?.name || "本卦";
    const bian = (lastPayload.dong_yao || []).length ? ` → ${lastPayload.bian_gua?.name || "变卦"}` : "";
    title = `${ben}${bian}`;
    detail = lastPayload.question || "六爻卦盘";
    subDetail = `${lastPayload.month_jian || "—"}月建 · ${lastPayload.day_chen || "—"}日辰 · 动爻 ${liuyaoDongText(lastPayload)}`;
  } else {
    const c = lastPayload.chart || {};
    const profile = lastPayload.profile || {};
    const pillars = ["year", "month", "day", "hour"].map(k => c.pillars?.[k]).filter(Boolean).join(" ");
    title = `${profileName || "命盘"}${profile.gender ? ` · ${genderLabel(profile.gender)}` : ""}`;
    detail = pillars || "四柱未定";
    subDetail = [lastInput?.location, calendarLabel, (profile.solar || "").slice(0, 16)].filter(Boolean).join(" · ");
  }
  const confirming = currentProfile && Number(pendingProfileDeleteId) === Number(currentProfile.id);
  const publicSlug = String(currentProfile?.public_post?.slug || "").trim();
  const defaultLabel = !isLy && currentProfile?.is_default ? " · 默认命盘" : "";
  const defaultAction = !isLy && currentProfile && !currentProfile.is_default
    ? `<button type="button" data-set-default-profile="${Number(currentProfile.id)}">设为默认</button>`
    : "";
  const actions = confirming
    ? profileDeleteConfirmHtml(currentProfile)
    : `<div class="profile-card-actions saved-actions">
        <button type="button" class="primary" ${!isLy && currentProfile ? `data-open-bazi-profile="${Number(currentProfile.id)}"` : "data-open-current-profile"}>${isLy ? "打开卦档" : currentProfile ? "查看档案" : "打开"}</button>
        ${defaultAction}
        ${currentProfile
          ? currentProfile.visibility === "public"
            ? publicSlug
              ? `<a class="profile-action-link" href="/gua/${encodeURIComponent(publicSlug)}" data-community-post data-post-slug="${esc(publicSlug)}">查看公开卦帖</a>`
              : `<span class="saved-retained">公开档案随卦帖保留</span>`
            : `<button type="button" class="danger" data-request-delete-profile="${Number(currentProfile.id)}">删除</button>`
          : ""}
      </div>`;
  return `<div class="saved-section-title">上次打开</div>
    <div class="saved-item saved-resume-item">
      <div class="saved-main">
        <div class="saved-copy">
          <div class="saved-kicker">${esc(label)} · ${esc(meta)}${defaultLabel}</div>
          <div class="saved-name">${esc(title)}</div>
          <div class="saved-pillars">${esc(detail)}</div>
          ${subDetail ? `<div class="saved-pillars sub">${esc(subDetail)}</div>` : ""}
        </div>
        ${actions}
      </div>
    </div>`;
}

function openCurrentProfile() {
  clearPersonalCaseContext();
  const historyMode = state.screen === "landing" ? "push" : "replace";
  const focusPage = state.screen !== "dash";
  closeProfileModal(() => {
    enterDashboard({ historyMode, focusPage });
    saveResumeCookie();
    toast(activeProfileId ? "档案已打开" : "已打开上次记录");
  });
}

async function openSavedProfile(pid, options = {}) {
  const previousWorkspace = currentWorkspaceKey();
  const previousSession = lastPayload ? snapshotSession() : null;
  if (!options?.preservePersonalCase) clearPersonalCaseContext();
  const historyMode = state.screen === "landing" ? "push" : "replace";
  const focusPage = state.screen !== "dash";
  try {
    const r = await fetch(`/api/profiles/${pid}`);
    if (!r.ok) throw new Error(await r.text());
    const data = await r.json();
    const loadedSystem = data.system || data.payload?.system || data.input?.system || "bazi";
    const resumeTabKey = loadedSystem === "liuyao" ? "断卦" : "解读";
    let resumedConversation = null;
    if (options.resumeSessionId) {
      const detailedResume = loadedSystem === "liuyao" && options.preservePersonalCase;
      if ((loadedSystem !== "bazi" && !detailedResume) || !validSessionId(options.resumeSessionId)) {
        throw new Error("对话标识无效");
      }
      const resumeResponse = await fetch("/api/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [{
          key: resumeTabKey,
          chart_id: Number(data.chart_id || data.payload?.chart_id || 0),
          session_id: options.resumeSessionId,
          profile_id: Number(data.id),
          limit: 200,
        }] }),
      });
      if (!resumeResponse.ok) throw new Error(await resumeResponse.text());
      const resumeData = await resumeResponse.json();
      resumedConversation = (resumeData.items || [])[0] || null;
      if (!resumedConversation?.ok) {
        throw new Error(resumedConversation?.error || "这段对话暂时无法恢复");
      }
    }
    if (previousSession && previousWorkspace !== loadedSystem) {
      sessionStore[previousWorkspace] = previousSession;
    }
    state.system = loadedSystem;
    lastInput = resumedConversation?.input || data.input;
    lastPayload = resumedConversation?.payload || data.payload;
    activeChartId = resumedConversation?.chart_id || data.chart_id || data.payload?.chart_id || null;
    profileName = data.name || (loadedSystem === "liuyao" ? "六爻" : "命盘");
    calendarLabel = calendarFromInput(loadedSystem, lastInput);
    activeProfileId = data.id;
    activeHistory = data.history || [];
    resetThreads();
    let recoverableTasks = [];
    if (resumedConversation) {
      state.sessionIds[resumeTabKey] = options.resumeSessionId;
      state.threads[resumeTabKey] = chatRowsToThread(resumeTabKey, resumedConversation.messages || []);
      state.activeTab = resumeTabKey;
      if (resumedConversation.active_task) recoverableTasks = [resumedConversation.active_task];
    } else if (!options.freshConversation && Array.isArray(data.active_tasks)) {
      recoverableTasks = data.active_tasks.slice().sort(
        (a, b) => restoredTaskTime(a.created_at, 0) - restoredTaskTime(b.created_at, 0),
      );
    }
    if (recoverableTasks.length && !resumedConversation) {
      const restoreItems = recoverableTasks.map(task => ({
        ok: true,
        key: historyTabKey({ scenario: task.scenario || "natal", topic: task.topic || "" }),
        active_task: task,
      }));
      restoreActiveTasks(restoreItems);
      state.activeTab = restoreItems[restoreItems.length - 1].key;
    } else if (recoverableTasks.length) {
      restoreActiveTasks([{ ok: true, key: resumeTabKey, active_task: recoverableTasks[0] }]);
    }
    await closeProfileModal();
    enterDashboard({ historyMode, focusPage });
    saveResumeCookie();
    refreshAccountProfileIndex({ force: true }).catch(() => {});
    const hasRunning = recoverableTasks.some(task => ["pending", "running"].includes(task.status));
    const hasFailure = recoverableTasks.some(task => task.status === "failed");
    const hasStopped = recoverableTasks.some(task => task.status === "cancelled");
    const conversationLabel = loadedSystem === "liuyao"
      ? options.preservePersonalCase ? "详断对话" : "六爻对话"
      : "八字对话";
    toast(options.resumeSessionId
      ? hasRunning ? "已恢复上次对话，解读继续" : `已恢复这段${conversationLabel}，继续追问`
      : options.freshConversation
        ? `已用这份${loadedSystem === "liuyao" ? "卦档" : "八字"}开启新对话`
        : hasRunning
          ? "档案已打开，解读正在继续"
          : hasFailure
            ? "档案已打开，可重试上次解读"
            : hasStopped
              ? "档案已打开，上次解读已停止"
          : "档案已打开");
    return true;
  } catch (e) {
    toast("打开档案失败：" + humanError(String(e.message || e)), "warn");
    return false;
  }
}

async function openHistoryModal() {
  if (!activeProfileId) { toast("尚未入档，请登录后重新排盘或起卦", "warn"); return; }
  pendingHistoryDeleteId = null;
  deletingHistoryId = null;
  try {
    await refreshProfileHistory();
    renderHistoryModal();
  } catch (e) {
    toast("读取历史失败：" + humanError(String(e.message || e)), "warn");
  }
}

function historyTitle(h) {
  if (h.scenario === "topic") return h.topic || "命理解读";
  return scenarioLabel({ scenario: h.scenario, topic: h.topic });
}

function historyAnswerPreview(value, limit = 260) {
  const preview = String(value || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*(?:[-*+] |\d+[.)] )/gm, "")
    .replace(/[>*_`~|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return preview.length > limit ? preview.slice(0, limit).trimEnd() + "…" : preview;
}

function historyTabKey(h) {
  if (state.system === "liuyao" || h.scenario === "divination") return "断卦";
  return "解读";
}

function historyDeleteConfirmHtml(h) {
  const busy = Number(deletingHistoryId) === Number(h.id);
  return `<div class="profile-delete-confirm history-delete-confirm" role="group" aria-label="确认删除历史解读">
    <div><b>确定删除这条解读？</b><span>只删除这条解读，不影响所属档案；删除后无法恢复。</span></div>
    <div class="profile-delete-confirm-actions">
      <button type="button" data-cancel-delete-history="${h.id}" ${busy ? "disabled" : ""}>取消</button>
      <button type="button" class="danger" data-confirm-delete-history="${h.id}" ${busy ? "disabled" : ""}>${busy ? "正在删除…" : "确认删除"}</button>
    </div>
  </div>`;
}

function renderHistoryModal(actionFocusSelector = "") {
  const body = activeHistory.length ? `<div class="history-list">${activeHistory.map(h => `
    <div class="history-item">
      <div class="history-main">
        <div>
          <div class="history-q">${esc(h.question || "默认解读")}</div>
          <div class="history-meta">${esc(historyTitle(h))} · ${esc(archiveDateLabel(h.created_at))}</div>
        </div>
        ${Number(pendingHistoryDeleteId) === Number(h.id)
          ? historyDeleteConfirmHtml(h)
          : `<div class="profile-card-actions history-actions">
              <button type="button" class="primary" data-restore-history="${h.id}">在对话中查看</button>
              <button type="button" class="danger" data-request-delete-history="${h.id}">删除</button>
            </div>`}
      </div>
      <div class="history-answer">${esc(historyAnswerPreview(h.answer))}</div>
    </div>`).join("")}</div>` : `<div class="profile-empty profile-empty-actionable">
      <span>暂无历史解读。点击「开始解读」后自动归档。</span>
      <div class="profile-empty-actions"><button type="button" class="primary" data-history-return>返回当前对话</button></div>
    </div>`;
  const focusSelector = actionFocusSelector || (pendingHistoryDeleteId ? `[data-cancel-delete-history="${pendingHistoryDeleteId}"]` : "");
  openProfileModal("历史解读", activeProfileId ? `${profileName} · ${activeHistory.length} 条` : "", body, focusSelector);
  const returnButton = $("#profile-card").querySelector("[data-history-return]");
  if (returnButton) returnButton.onclick = closeProfileModal;
  $("#profile-card").querySelectorAll("[data-restore-history]").forEach(b => {
    b.onclick = () => restoreHistory(Number(b.dataset.restoreHistory));
  });
  $("#profile-card").querySelectorAll("[data-request-delete-history]").forEach(b => {
    b.onclick = () => {
      pendingHistoryDeleteId = Number(b.dataset.requestDeleteHistory);
      renderHistoryModal();
    };
  });
  $("#profile-card").querySelectorAll("[data-cancel-delete-history]").forEach(b => {
    b.onclick = () => {
      const id = Number(b.dataset.cancelDeleteHistory);
      pendingHistoryDeleteId = null;
      renderHistoryModal(`[data-request-delete-history="${id}"]`);
    };
  });
  $("#profile-card").querySelectorAll("[data-confirm-delete-history]").forEach(b => {
    b.onclick = () => deleteHistory(Number(b.dataset.confirmDeleteHistory));
  });
}

function focusHistoryMessage(id) {
  window.requestAnimationFrame(() => {
    const target = document.querySelector(`[data-history-id="${Number(id)}"]`);
    if (!target) {
      $("#draft-input")?.focus({ preventScroll: true });
      return;
    }
    target.scrollIntoView({ block: "start" });
    target.focus({ preventScroll: true });
  });
}

async function restoreHistory(id) {
  const h = activeHistory.find(x => x.id === id);
  if (!h) return;
  const key = historyTabKey(h);
  state.activeTab = key;
  state.threads[key] = state.threads[key] || [];
  const historyTaskId = String(h.task_id || "");
  let restoredMsg = state.threads[key].find(message => message.kind === "ai" && (
    (historyTaskId && String(message.taskId || "") === historyTaskId)
    || Number(message.restoredHistoryId) === Number(id)
  ));
  const alreadyInThread = !!restoredMsg;
  if (!restoredMsg) {
    if (h.question) pushUser(key, h.question);
    restoredMsg = {
      kind: "ai",
      id: "h" + id,
      taskId: historyTaskId,
      chartId: h.chart_id || activeChartId || null,
      restoredHistoryId: id,
      scenario: historyTitle(h),
      title: "历史解读",
      body: h.answer || "",
      streaming: false,
      followups: [],
      error: "",
      rawScenario: h.scenario || "natal",
      rawTopic: h.topic || "",
      rawQuestion: h.question || "",
    };
    restoredMsg.followups = suggestedFollowups(key, restoredMsg);
    state.threads[key].push(restoredMsg);
  } else {
    restoredMsg.restoredHistoryId = id;
  }
  await closeProfileModal();
  threadScrollLock = { key, locked: false };
  renderTabs();
  renderThread();
  focusHistoryMessage(id);
  toast(alreadyInThread ? "已定位到这条历史解读" : "历史解读已打开，继续追问");
}

async function deleteHistory(id) {
  if (!activeProfileId || deletingHistoryId) return;
  deletingHistoryId = id;
  renderHistoryModal();
  try {
    const r = await fetch(`/api/profiles/${activeProfileId}/interpretations/${id}`, {
      method: "DELETE",
      headers: Account.csrfHeaders(),
    });
    if (!r.ok) throw new Error(await r.text());
    pendingHistoryDeleteId = null;
    deletingHistoryId = null;
    await refreshProfileHistory();
    await Account.refresh();
    renderHistoryModal();
    toast("历史已删除");
  } catch (e) {
    deletingHistoryId = null;
    renderHistoryModal();
    toast("删除失败：" + humanError(String(e.message || e)), "warn");
  }
}
