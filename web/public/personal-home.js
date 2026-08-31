(() => {
  "use strict";

  const Account = window.XuanxueAccount;
  const $ = selector => document.querySelector(selector);
  const $$ = selector => Array.from(document.querySelectorAll(selector));
  const state = {
    payload: null,
    loading: false,
    pollTimer: 0,
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function errorMessage(payload, fallback = "请求失败，请稍后重试") {
    const detail = payload?.detail;
    if (typeof detail === "string") return detail;
    if (detail && typeof detail.message === "string") return detail.message;
    return fallback;
  }

  async function readJson(response) {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(errorMessage(payload));
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  function toast(message, tone = "") {
    const node = $("#toast");
    if (!node) return;
    node.textContent = message;
    node.className = `toast${tone ? ` ${tone}` : ""}`;
    node.hidden = false;
    window.clearTimeout(toast.timer);
    toast.timer = window.setTimeout(() => { node.hidden = true; }, 2800);
  }

  function stopPolling() {
    window.clearInterval(state.pollTimer);
    state.pollTimer = 0;
  }

  function shouldShow(screen = document.body.dataset.screen || "landing") {
    if (screen !== "landing" || !Account?.snapshot()?.authenticated) return false;
    if (location.hash === "#gua-square") return false;
    const query = new URLSearchParams(location.search);
    return !query.get("view") && !query.get("start") && !query.get("personal_case");
  }

  function isVisible() {
    const node = $("#personal-workbench");
    return !!node && !node.hidden;
  }

  function syncScreen(screen = document.body.dataset.screen || "landing") {
    const active = shouldShow(screen);
    const community = screen === "landing" && location.hash === "#gua-square";
    const workbench = $("#personal-workbench");
    if (workbench) workbench.hidden = !active;
    $$('[data-home-action-panel]').forEach(node => {
      node.hidden = screen !== "landing" || active || community;
    });
    const square = $("#gua-square");
    if (square) square.hidden = screen !== "landing" || active || !community;
    const footer = document.querySelector(".landing .hero-footer");
    if (footer) footer.hidden = active;
    document.body.dataset.homeExperience = active ? "personal" : "public";
    if (active && !state.payload && !state.loading) load().catch(() => {});
    return active;
  }

  function showOnly(name) {
    ["loading", "ready", "error"].forEach(key => {
      const node = $(`[data-ph-${key}]`);
      if (node) node.hidden = key !== name;
    });
  }

  function pillarsText(profile) {
    const pillars = profile?.pillars || {};
    return ["year", "month", "day", "hour"]
      .map(key => pillars[key])
      .filter(Boolean)
      .join(" · ") || "四柱命盘";
  }

  function profileChoices(payload) {
    const currentId = Number(payload.default_profile?.id || 0);
    const rows = (payload.profiles || []).map(profile => {
      const active = Number(profile.id) === currentId;
      return `<button type="button" class="ph-profile-choice" data-ph-set-default="${Number(profile.id)}"${active ? ' aria-current="true" disabled' : ""}>
        <span><b>${escapeHtml(profile.name || "未命名命盘")}</b><em>${escapeHtml(pillarsText(profile))}</em></span>
        <i>${active ? "默认命盘" : "设为默认"}</i>
      </button>`;
    }).join("");
    return `<div class="ph-profile-choices">${rows}</div>`;
  }

  function renderHomeGate(payload) {
    const node = $("[data-ph-home-gate]");
    node.hidden = false;
    $("[data-ph-today]").hidden = true;
    $("[data-ph-month]").hidden = true;
    if (payload.profile_state === "no_profile") {
      node.innerHTML = `<span>观象台</span>
        <h2>先建立一张本人命盘</h2>
        <p>完成八字排盘并设为默认后，今日宜忌、本月宜忌、颜色与手镯材质会出现在这里。</p>
        <button type="button" class="ph-primary" data-ph-create-default>去排八字</button>`;
      return;
    }
    if (payload.profile_state === "choose_default") {
      node.innerHTML = `<span>观象台</span>
        <h2>选择一张默认命盘</h2>
        <p>默认命盘只决定观象台依据哪张盘，其他档案都会保留。初次设置后会自动准备，稍后刷新即可。</p>
        ${profileChoices(payload)}`;
      return;
    }

    const generation = payload.generation || {};
    if (generation.state === "paused") {
      node.innerHTML = `<span>观象台</span>
        <h2>今日与本月尚未更新</h2>
        <p>${escapeHtml(generation.message || "本次未自动生成，需要时点一下即可更新。")}</p>
        <button type="button" class="ph-primary" data-ph-refresh>更新今日与本月</button>
        <em>点击后才开始准备，不消耗私密提问次数。</em>`;
      return;
    }
    if (generation.state === "failed") {
      node.innerHTML = `<span>观象台</span>
        <h2>这次没有生成成功</h2>
        <p>${escapeHtml(generation.message || "内容暂时没有准备成功。")}</p>
        <button type="button" class="ph-primary" data-ph-refresh>重新生成</button>`;
      return;
    }
    node.innerHTML = `<span>观象台</span>
      <i class="ph-preparing-mark" aria-hidden="true"></i>
      <h2>正在准备今日与本月</h2>
      <p>${escapeHtml(generation.message || "正在根据默认命盘准备内容。")}</p>
      <em>可以先离开，完成后会保留在这里。</em>`;
  }

  function renderList(selector, values) {
    const node = $(selector);
    node.innerHTML = (values || []).map(item => `<li>${escapeHtml(item)}</li>`).join("");
  }

  function reasonControl({ id, name, reason, swatch = "", material = false }) {
    const safeName = escapeHtml(name);
    const safeReason = escapeHtml(
      reason || "依据本月月令变化，并与整月穿搭主调相互呼应。"
    );
    return `<button type="button" class="ph-reason-control${material ? " ph-material-control" : ""}"
      data-ph-reason aria-expanded="false" aria-describedby="${id}"
      aria-label="${safeName}，查看选择依据">
      ${swatch}<em>${safeName}</em>
      <span class="ph-reason-tooltip" id="${id}" role="tooltip">
        <b>为什么是${safeName}</b><span>${safeReason}</span>
      </span>
    </button>`;
  }

  function closeReasonTips(except = null) {
    $$('[data-ph-reason][aria-expanded="true"]').forEach(button => {
      if (button !== except) button.setAttribute("aria-expanded", "false");
    });
  }

  function alignReasonTip(button) {
    const tip = button?.querySelector(".ph-reason-tooltip");
    if (!tip) return;
    tip.style.removeProperty("--ph-tip-nudge");
    tip.style.removeProperty("--ph-arrow-nudge");
    window.requestAnimationFrame(() => {
      const rect = tip.getBoundingClientRect();
      const edge = 12;
      let nudge = 0;
      if (rect.left < edge) nudge = edge - rect.left;
      else if (rect.right > window.innerWidth - edge) {
        nudge = window.innerWidth - edge - rect.right;
      }
      if (!nudge) return;
      tip.style.setProperty("--ph-tip-nudge", `${nudge}px`);
      tip.style.setProperty("--ph-arrow-nudge", `${-nudge}px`);
    });
  }

  function renderDaily(daily, currentCity = "") {
    $("[data-ph-daily-date]").textContent = daily?.date_label || "今日";
    $("[data-ph-daily-weekday]").textContent = daily?.weekday_label || "";
    $("[data-ph-city-label]").textContent = currentCity || "设置常住城市";
    const content = daily?.content || {};
    const ready = daily?.status === "done"
      && Array.isArray(content.suitable)
      && Array.isArray(content.avoid);
    const pending = ["missing", "pending", "running"].includes(daily?.status);
    const failed = daily?.status === "failed" || (daily?.status === "done" && !ready);
    $("[data-ph-daily-content]").hidden = !ready;
    $("[data-ph-daily-pending]").hidden = !pending;
    $("[data-ph-daily-error]").hidden = !failed;
    if (!ready) return;
    renderList("[data-ph-daily-suitable]", content.suitable);
    renderList("[data-ph-daily-avoid]", content.avoid);
  }

  function renderMonth(month) {
    $("[data-ph-onboarding]").hidden = true;

    const content = month?.content || {};
    const ready = month?.status === "done"
      && Array.isArray(content.suitable)
      && Array.isArray(content.avoid)
      && Array.isArray(content.outfit?.colors)
      && Array.isArray(content.outfit?.bracelet_materials);
    const pending = ["missing", "pending", "running"].includes(month?.status);
    const failed = month?.status === "failed" || (month?.status === "done" && !ready);
    $("[data-ph-month-content]").hidden = !ready;
    $("[data-ph-month-pending]").hidden = !pending;
    $("[data-ph-month-error]").hidden = !failed;
    if (!ready) return;

    renderList("[data-ph-suitable]", content.suitable);
    renderList("[data-ph-avoid]", content.avoid);
    $("[data-ph-style-intent]").textContent = content.outfit?.intent_label || "本月配色";
    const colors = content.outfit?.colors || [];
    $("[data-ph-colors]").innerHTML = colors.map((color, index) => reasonControl({
      id: `ph-color-reason-${index}`,
      name: color.name || "",
      reason: color.reason,
      swatch: `<i style="--swatch:${escapeHtml(color.hex || "#d6d6d9")}" aria-hidden="true"></i>`,
    })).join("");
    const materials = content.outfit.bracelet_materials;
    const materialReasons = content.outfit?.bracelet_reasons || {};
    $("[data-ph-bracelet-materials]").innerHTML = materials
      .map((material, index) => reasonControl({
        id: `ph-material-reason-${index}`,
        name: material,
        reason: materialReasons[material],
        material: true,
      }))
      .join('<b aria-hidden="true">·</b>');
  }

  function renderReady(payload) {
    const generationState = payload.generation?.state || "needs_default";
    const profileReady = payload.profile_state === "ready";
    const bothFailed = payload.daily?.status === "failed" && payload.month?.status === "failed";
    const gateRequired = !profileReady
      || ["needs_default", "paused"].includes(generationState)
      || bothFailed;
    if (gateRequired) {
      renderHomeGate(payload);
      showOnly("ready");
      stopPolling();
      return;
    }

    $("[data-ph-home-gate]").hidden = true;
    $("[data-ph-today]").hidden = false;
    $("[data-ph-month]").hidden = false;
    renderDaily(payload.daily || {}, payload.current_city || "");
    renderMonth(payload.month || {});
    showOnly("ready");
    const dayPending = ["missing", "pending", "running"].includes(payload.daily?.status);
    const monthPending = ["missing", "pending", "running"].includes(payload.month?.status);
    if (dayPending || monthPending) startPolling();
    else stopPolling();
  }

  function renderError(message) {
    stopPolling();
    $("[data-ph-error-message]").textContent = message;
    showOnly("error");
  }

  async function load({ quiet = false } = {}) {
    if (state.loading) return state.payload;
    state.loading = true;
    if (!quiet && isVisible()) showOnly("loading");
    try {
      await Account.ready();
      if (!Account.snapshot().authenticated) {
        state.payload = null;
        syncScreen();
        return null;
      }
      const response = await fetch("/api/personal-home", {
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        cache: "no-store",
      });
      const payload = await readJson(response);
      state.payload = payload;
      renderReady(payload);
      return payload;
    } catch (reason) {
      renderError(reason?.message || "网络连接不稳定，请稍后重试。");
      throw reason;
    } finally {
      state.loading = false;
    }
  }

  function startPolling() {
    if (state.pollTimer) return;
    state.pollTimer = window.setInterval(() => {
      load({ quiet: true }).catch(() => {});
    }, 1800);
  }

  async function setDefaultProfile(profileId) {
    const buttons = $$('[data-ph-set-default]');
    buttons.forEach(button => { button.disabled = true; });
    try {
      const response = await fetch("/api/personal-home/default-profile", {
        method: "PUT",
        headers: Account.csrfHeaders({ "Content-Type": "application/json", Accept: "application/json" }),
        credentials: "same-origin",
        body: JSON.stringify({ profile_id: Number(profileId) }),
      });
      const payload = await readJson(response);
      state.payload = payload;
      renderReady(payload);
      toast("已设为默认命盘，正在准备内容");
    } catch (reason) {
      toast(reason?.message || "默认命盘设置失败", "warn");
      renderReady(state.payload || { profile_state: "choose_default", profiles: [], daily: {} });
    }
  }

  async function refreshWorkbench() {
    const button = $("[data-ph-refresh]");
    if (button) {
      button.disabled = true;
      button.textContent = "正在开始准备";
    }
    try {
      const response = await fetch("/api/personal-home/refresh", {
        method: "POST",
        headers: Account.csrfHeaders({ Accept: "application/json" }),
        credentials: "same-origin",
      });
      const payload = await readJson(response);
      state.payload = payload;
      renderReady(payload);
      toast("已经开始准备，完成后会保留在这里");
    } catch (reason) {
      toast(reason?.message || "暂时没有开始准备", "warn");
      renderReady(state.payload || { profile_state: "ready", generation: { state: "paused" } });
    }
  }

  function openCityDialog() {
    const dialog = $("[data-ph-city-dialog]");
    const form = $("[data-ph-city-form]");
    if (!dialog || !form) return;
    form.elements.city.value = state.payload?.current_city || "";
    $("[data-ph-city-error]").hidden = true;
    dialog.showModal();
    window.setTimeout(() => form.elements.city.focus({ preventScroll: true }), 60);
  }

  async function submitCity(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = $("[data-ph-city-submit]");
    const error = $("[data-ph-city-error]");
    submit.disabled = true;
    submit.textContent = "正在保存";
    error.hidden = true;
    try {
      const response = await fetch("/api/personal-home/city", {
        method: "PUT",
        headers: Account.csrfHeaders({ "Content-Type": "application/json", Accept: "application/json" }),
        credentials: "same-origin",
        body: JSON.stringify({ city: form.elements.city.value.trim() }),
      });
      const payload = await readJson(response);
      state.payload = payload;
      renderReady(payload);
      $("[data-ph-city-dialog]")?.close();
      toast("常住城市已更新");
    } catch (reason) {
      error.textContent = reason?.message || "城市保存失败";
      error.hidden = false;
    } finally {
      submit.disabled = false;
      submit.textContent = "保存";
    }
  }

  function createDefaultProfile() {
    const url = new URL(location.href);
    url.searchParams.set("set_default", "1");
    url.searchParams.set("from", "personal_home");
    history.replaceState(history.state, "", `${url.pathname}${url.search}`);
    document.dispatchEvent(new CustomEvent("xuanshu:startbazi", { cancelable: true }));
  }

  async function retryMonth() {
    const button = $("[data-ph-retry-month]");
    button.disabled = true;
    button.textContent = "正在重新生成";
    try {
      const response = await fetch("/api/personal-home/month", {
        method: "POST",
        headers: Account.csrfHeaders({ Accept: "application/json" }),
        credentials: "same-origin",
      });
      const month = await readJson(response);
      if (state.payload) state.payload.month = month;
      renderReady(state.payload || {
        profile_state: "ready",
        generation: { state: "preparing" },
        daily: {},
        month,
      });
      toast("本月内容已经开始重新生成");
    } catch (reason) {
      toast(reason?.message || "本月内容准备失败", "warn");
    } finally {
      button.disabled = false;
      button.textContent = "重新生成本月";
    }
  }

  async function retryDay() {
    const button = $("[data-ph-retry-day]");
    button.disabled = true;
    button.textContent = "正在重新生成";
    try {
      const response = await fetch("/api/personal-home/day", {
        method: "POST",
        headers: Account.csrfHeaders({ Accept: "application/json" }),
        credentials: "same-origin",
      });
      const daily = await readJson(response);
      if (state.payload) state.payload.daily = daily;
      renderReady(state.payload || {
        profile_state: "ready",
        generation: { state: "preparing" },
        daily,
        month: {},
      });
      toast("今日宜忌已经开始重新生成");
    } catch (reason) {
      toast(reason?.message || "今日宜忌生成失败", "warn");
    } finally {
      button.disabled = false;
      button.textContent = "重新生成今日";
    }
  }

  async function openDetailed(options = {}) {
    const loggedIn = await Account.requireLogin({
      mode: "login",
      message: "登录后可用本人命盘与六爻一起详断这件事。",
    });
    if (!loggedIn) return false;
    const payload = await load({ quiet: true }).catch(() => null);
    if (!payload) return false;
    if (payload.profile_state !== "ready") {
      renderReady(payload);
      document.dispatchEvent(new CustomEvent("xuanshu:showpersonalhome", {
        cancelable: true,
        detail: { historyMode: options.historyMode === "replace" ? "replace" : "push" },
      }));
      toast(payload.profile_state === "no_profile" ? "先建立本人命盘" : "先选择本人命盘");
      return false;
    }
    const quota = payload.private_quota || {};
    const remaining = Number(quota.remaining || 0);
    if (remaining <= 0) {
      toast("今日私密次数已用完，北京时间 0 点重置", "warn");
      return false;
    }
    document.dispatchEvent(new CustomEvent("xuanshu:startdetailed", {
      cancelable: true,
      detail: { historyMode: options.historyMode === "replace" ? "replace" : "push" },
    }));
    return true;
  }

  function bind() {
    document.addEventListener("click", event => {
      const reason = event.target.closest("[data-ph-reason]");
      if (reason) {
        event.preventDefault();
        const opening = reason.getAttribute("aria-expanded") !== "true";
        closeReasonTips(reason);
        reason.setAttribute("aria-expanded", String(opening));
        if (opening) alignReasonTip(reason);
      } else {
        closeReasonTips();
      }
      if (event.target.closest("[data-open-detailed]")) {
        event.preventDefault();
        openDetailed().catch(() => {});
      }
      if (event.target.closest("[data-ph-create-default]")) createDefaultProfile();
      if (event.target.closest("[data-ph-refresh]")) refreshWorkbench();
      if (event.target.closest("[data-ph-edit-city]")) openCityDialog();
      const profile = event.target.closest("[data-ph-set-default]");
      if (profile) setDefaultProfile(profile.dataset.phSetDefault);
      if (event.target.closest("[data-ph-retry-home]")) load().catch(() => {});
      if (event.target.closest("[data-ph-retry-day]")) retryDay();
      if (event.target.closest("[data-ph-retry-month]")) retryMonth();
      if (event.target.closest("[data-ph-start-liuyao]")) {
        document.dispatchEvent(new CustomEvent("xuanshu:startliuyao", { cancelable: true }));
      }
      if (event.target.closest("[data-ph-start-bazi]")) {
        document.dispatchEvent(new CustomEvent("xuanshu:startbazi", { cancelable: true }));
      }
      if (event.target.closest("[data-ph-close-city]")) $("[data-ph-city-dialog]")?.close();
    });
    document.addEventListener("keydown", event => {
      if (event.key !== "Escape") return;
      const open = $('[data-ph-reason][aria-expanded="true"]');
      closeReasonTips();
      open?.focus({ preventScroll: true });
    });
    document.addEventListener("focusin", event => {
      const reason = event.target.closest?.("[data-ph-reason]");
      if (reason) alignReasonTip(reason);
    });
    document.addEventListener("pointerover", event => {
      const reason = event.target.closest?.("[data-ph-reason]");
      if (reason) alignReasonTip(reason);
    });
    window.addEventListener("resize", () => {
      const open = $('[data-ph-reason][aria-expanded="true"]');
      if (open) alignReasonTip(open);
    });
    $("[data-ph-city-form]")?.addEventListener("submit", submitCity);
    $("[data-ph-city-dialog]")?.addEventListener("click", event => {
      if (event.target === event.currentTarget) event.currentTarget.close();
    });
    document.addEventListener("xuanshu:authchange", event => {
      if (!event.detail?.authenticated) {
        state.payload = null;
        stopPolling();
      }
      syncScreen();
      if (event.detail?.authenticated && isVisible()) load().catch(() => {});
    });
  }

  window.XuanxuePersonalHome = Object.freeze({
    load,
    syncScreen,
    isVisible,
    openDetailed,
  });

  function init() {
    bind();
    Account?.ready().then(() => syncScreen()).catch(() => syncScreen());
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
