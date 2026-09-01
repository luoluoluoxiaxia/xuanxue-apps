(() => {
  "use strict";

  const Account = window.XuanxueAccount;
  const page = document.querySelector("#credit-ledger-page");
  if (!page || !Account) return;

  const state = {
    filter: "all",
    month: "",
    page: 1,
    requestId: 0,
  };

  const $ = selector => page.querySelector(selector);
  const $$ = selector => Array.from(page.querySelectorAll(selector));

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function beijingMonth() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
    }).formatToParts(new Date());
    const year = parts.find(part => part.type === "year")?.value || "";
    const month = parts.find(part => part.type === "month")?.value || "";
    return /^\d{4}$/.test(year) && /^\d{2}$/.test(month) ? `${year}-${month}` : "";
  }

  function normalizedMonth(value) {
    const text = String(value || "").trim();
    return /^\d{4}-(?:0[1-9]|1[0-2])$/.test(text) ? text : beijingMonth();
  }

  function monthLabel(value) {
    const [year = "", month = ""] = normalizedMonth(value).split("-");
    return `${Number(year)} 年 ${Number(month)} 月`;
  }

  function dateLabel(value) {
    const text = String(value || "").trim();
    if (!text) return "—";
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.valueOf()) && /(?:Z|[+-]\d\d:\d\d)$/.test(text)) {
      const parts = new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(parsed);
      const valueOf = type => parts.find(part => part.type === type)?.value || "";
      return `${valueOf("month")}-${valueOf("day")} ${valueOf("hour")}:${valueOf("minute")}`;
    }
    const normalized = text.replace("T", " ");
    return `${normalized.slice(5, 10)} ${normalized.slice(11, 16)}`.trim();
  }

  function signedAmount(value) {
    const amount = Number(value || 0);
    return amount > 0 ? `+${amount}` : String(amount);
  }

  function entryType(item) {
    const types = {
      answer_usage: "AI 回答",
      checkout_purchase: "充值",
      welcome_bonus: "注册赠送",
      admin_credit: "积分补发",
      admin_debit: "积分调整",
    };
    return types[String(item?.entry_type || "")] || String(item?.title || "积分变动");
  }

  function activityRow(item) {
    const amount = Number(item?.amount || 0);
    return `<div class="cl-row" role="row">
      <span class="cl-time" role="cell">${escapeHtml(dateLabel(item?.created_at))}</span>
      <span class="cl-type" role="cell">${escapeHtml(entryType(item))}</span>
      <span class="cl-description" role="cell" title="${escapeHtml(item?.description || "积分余额已更新")}">${escapeHtml(item?.description || "积分余额已更新")}</span>
      <span class="cl-change${amount === 0 ? " is-zero" : ""}" role="cell">${escapeHtml(signedAmount(amount))}</span>
      <span class="cl-after" role="cell">${Number(item?.balance_after || 0)}</span>
    </div>`;
  }

  function orderRow(item) {
    const status = String(item?.status || "pending");
    const statusLabel = { paid: "已到账", pending: "待支付", expired: "已失效" }[status] || "处理中";
    const currency = String(item?.currency || "usd").toUpperCase();
    const amount = status === "paid" ? Number(item?.credits || 0) : 0;
    const occurredAt = item?.paid_at || item?.expired_at || item?.created_at;
    return `<div class="cl-row" role="row">
      <span class="cl-time" role="cell">${escapeHtml(dateLabel(occurredAt))}</span>
      <span class="cl-type" role="cell">充值 · ${escapeHtml(statusLabel)}</span>
      <span class="cl-description" role="cell">${escapeHtml(`${currency} ${(Number(item?.amount_total || 0) / 100).toFixed(2)} · ${Number(item?.credits || 0)} 分`)}</span>
      <span class="cl-change${amount === 0 ? " is-zero" : ""}" role="cell">${escapeHtml(signedAmount(amount))}</span>
      <span class="cl-after" role="cell">—</span>
    </div>`;
  }

  function syncSummary(wallet = null) {
    const account = Account.snapshot();
    const currentWallet = wallet || account.creditWallet || {};
    const quota = account.privateQuota || {};
    const remaining = Math.max(0, Number(quota.remaining || 0));
    const total = Math.max(0, Number(quota.total || 0));
    $("[data-cl-balance]").textContent = String(Number(currentWallet.balance || 0));
    $("[data-cl-quota-remaining]").textContent = String(remaining);
    $("[data-cl-quota-total]").textContent = String(total);
    $("[data-cl-quota-base]").textContent = `${Number(quota.base || 0)} 分`;
    $("[data-cl-quota-referral]").textContent = `+${Number(quota.referral_bonus || 0)} 分`;
    $("[data-cl-quota-used]").textContent = `${Number(quota.used || 0)} 分`;
    const ratio = total > 0 ? Math.min(100, Math.max(0, (remaining / total) * 100)) : 0;
    $("[data-cl-quota-progress]").style.width = `${ratio}%`;
  }

  function setLoading() {
    const body = $("[data-cl-body]");
    body.setAttribute("aria-busy", "true");
    body.innerHTML = '<div class="cl-loading" role="status"><span></span><b>正在读取明细</b></div>';
    $("[data-cl-pagination]").hidden = true;
  }

  function renderSignedOut() {
    const body = $("[data-cl-body]");
    body.setAttribute("aria-busy", "false");
    body.innerHTML = '<div class="cl-empty"><b>登录后管理积分</b><span>积分余额、充值与流水只对本人可见。</span><button type="button" data-cl-login>登录 / 注册</button></div>';
    body.querySelector("[data-cl-login]")?.addEventListener("click", () => Account.open("login", "登录后管理积分。"));
    $("[data-cl-pagination]").hidden = true;
  }

  function renderPagination(pagination) {
    const nav = $("[data-cl-pagination]");
    const current = Math.max(1, Number(pagination?.page || 1));
    const pageCount = Math.max(1, Number(pagination?.page_count || 1));
    nav.innerHTML = `<button type="button" data-cl-page="${current - 1}" ${current <= 1 ? "disabled" : ""}>‹&nbsp; 上一页</button><span>${current}</span><button type="button" data-cl-page="${current + 1}" ${current >= pageCount ? "disabled" : ""}>下一页 &nbsp;›</button>`;
    nav.hidden = false;
    nav.querySelectorAll("[data-cl-page]").forEach(button => {
      button.addEventListener("click", () => {
        state.page = Math.max(1, Number(button.dataset.clPage || 1));
        load();
      });
    });
  }

  function renderPayload(payload) {
    const body = $("[data-cl-body]");
    const items = Array.isArray(payload?.items) ? payload.items : [];
    body.setAttribute("aria-busy", "false");
    syncSummary(payload?.wallet);
    if (!items.length) {
      const emptyLabel = state.filter === "usage" ? "本月暂无消耗" : state.filter === "orders" ? "本月暂无充值记录" : state.filter === "credit" ? "本月暂无获得记录" : "本月暂无积分记录";
      body.innerHTML = `<div class="cl-empty"><b>${escapeHtml(emptyLabel)}</b><span>有新的积分变动后会显示在这里。</span></div>`;
    } else {
      body.innerHTML = items.map(item => state.filter === "orders" ? orderRow(item) : activityRow(item)).join("");
    }
    renderPagination(payload?.pagination);
  }

  async function readJson(response) {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = typeof payload?.detail === "string" ? payload.detail : "明细加载失败，请稍后再试";
      throw new Error(detail);
    }
    return payload;
  }

  async function load() {
    const requestId = ++state.requestId;
    setLoading();
    try {
      const params = new URLSearchParams({ page: String(state.page), month: state.month });
      let endpoint = "/api/billing/activity";
      if (state.filter === "orders") {
        endpoint = "/api/billing/orders";
        params.set("status", "all");
      } else {
        params.set("kind", state.filter);
      }
      const response = await fetch(`${endpoint}?${params}`, {
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        cache: "no-store",
      });
      const payload = await readJson(response);
      if (requestId !== state.requestId) return;
      renderPayload(payload);
    } catch (reason) {
      if (requestId !== state.requestId) return;
      const body = $("[data-cl-body]");
      body.setAttribute("aria-busy", "false");
      body.innerHTML = `<div class="cl-error" role="alert"><b>积分记录加载失败</b><span>${escapeHtml(reason?.message || "请稍后再试")}</span><button type="button" data-cl-retry>重新加载</button></div>`;
      body.querySelector("[data-cl-retry]")?.addEventListener("click", load);
      $("[data-cl-pagination]").hidden = true;
    }
  }

  function syncFilterButtons() {
    $$("[data-cl-filter]").forEach(button => {
      button.setAttribute("aria-selected", button.dataset.clFilter === state.filter ? "true" : "false");
    });
  }

  function updateMonthLocation() {
    try {
      const url = new URL(location.href);
      url.searchParams.set("view", "credits");
      url.searchParams.set("month", state.month);
      history.replaceState(history.state, "", `${url.pathname}${url.search}`);
    } catch (_) {}
  }

  async function activate({ reload = true } = {}) {
    page.hidden = false;
    const query = new URLSearchParams(location.search);
    state.month = normalizedMonth(query.get("month"));
    $("[data-cl-month]").value = state.month;
    $("[data-cl-month]").max = beijingMonth();
    $("[data-cl-month-label]").textContent = monthLabel(state.month);
    syncSummary();
    if (reload) {
      await Account.ready();
      if (Account.snapshot().authenticated) load();
      else renderSignedOut();
    }
  }

  function deactivate() {
    state.requestId += 1;
    page.hidden = true;
  }

  function isVisible() {
    return !page.hidden;
  }

  $$("[data-cl-filter]").forEach(button => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.clFilter || "all";
      state.page = 1;
      syncFilterButtons();
      load();
    });
  });

  $("[data-cl-month]").addEventListener("change", event => {
    state.month = normalizedMonth(event.currentTarget.value);
    event.currentTarget.value = state.month;
    $("[data-cl-month-label]").textContent = monthLabel(state.month);
    state.page = 1;
    updateMonthLocation();
    load();
  });

  $("[data-cl-topup]").addEventListener("click", async () => {
    const authenticated = await Account.requireLogin({ mode: "login", message: "登录后充值积分。" });
    if (!authenticated) return;
    Account.open("topup");
  });

  document.addEventListener("xuanshu:authchange", event => {
    if (!isVisible()) return;
    syncSummary();
    if (event.detail?.authenticated) load();
    else renderSignedOut();
  });

  window.XuanxueCreditLedger = Object.freeze({ activate, deactivate, isVisible, load });
})();
