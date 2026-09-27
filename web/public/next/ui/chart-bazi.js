// 八字命盘面板：四柱、命局速览、五行分布、大运流年与走势。
// 十神、五行、逐年干支与走势分值全部使用接口投影字段，客户端不推算。
import { h, svg } from "../lib/dom.js?v=n1";
import { icon } from "../lib/icons.js?v=n1";
import { local } from "../lib/store.js?v=n1";
import { elementClass } from "./gua.js?v=n1";
import { openGlossary } from "./glossary.js?v=n1";

const MODE_KEY = "xz-next-bazi-mode";
const ORDER = [["year", "年柱"], ["month", "月柱"], ["day", "日柱"], ["hour", "时柱"]];
const WUXING = ["木", "火", "土", "金", "水"];

// 横向滑动条里让选中项露出来（只滚动条本身，不带动页面）。
function revealSelected(strip) {
  const run = () => {
    const item = strip.querySelector(".is-selected");
    if (!item || !strip.clientWidth) return;
    const box = strip.getBoundingClientRect();
    const rect = item.getBoundingClientRect();
    if (rect.left < box.left) strip.scrollLeft -= box.left - rect.left + 12;
    else if (rect.right > box.right) strip.scrollLeft += rect.right - box.right + 12;
  };
  if (strip.isConnected) run(); else requestAnimationFrame(run);
}

// 局部重绘前记下焦点与滑动位置，重绘后还原：点选大运、流年时不丢焦点，滑动条也不跳回开头。
function snapshot(container) {
  const active = document.activeElement;
  const strips = {};
  container.querySelectorAll("[data-strip]").forEach(strip => { strips[strip.dataset.strip] = strip.scrollLeft; });
  return { focus: active && container.contains(active) ? active.dataset.key || "" : "", strips };
}

function restore(container, keep) {
  container.querySelectorAll("[data-strip]").forEach(strip => {
    const left = keep?.strips[strip.dataset.strip];
    if (left !== undefined && strip.isConnected) strip.scrollLeft = left;
    revealSelected(strip);
  });
  if (keep?.focus) container.querySelector(`[data-key="${keep.focus}"]`)?.focus({ preventScroll: true });
}

function ganzhi(text, stemElement, branchElement, className = "") {
  const chars = Array.from(String(text || ""));
  return h("span", { class: ["gz", className] },
    h("b", { class: elementClass(stemElement) }, chars[0] || "—"),
    h("b", { class: elementClass(branchElement) }, chars[1] || ""));
}

function pillarsBlock(payload, advanced) {
  const pillars = payload?.chart?.pillars || {};
  const detail = payload?.pillars_detail || {};
  return h("div", { class: "cp-pillars", role: "table", "aria-label": "四柱" },
    ORDER.map(([key, label]) => {
      const item = detail[key] || {};
      const chars = Array.from(String(pillars[key] || item.pillar || ""));
      const god = key === "day" ? "日元" : (item.stem_ten_god || "");
      return h("div", { class: ["cp-pillar", key === "day" && "is-day"], role: "row" },
        h("span", { class: "cp-pillar-label", role: "rowheader" }, label),
        h("span", { class: "cp-pillar-god" }, god || "—"),
        h("b", { class: ["cp-pillar-char", elementClass(item.stem_element)] }, chars[0] || "—"),
        h("b", { class: ["cp-pillar-char", elementClass(item.branch_element)] }, chars[1] || "—"),
        h("span", { class: "cp-pillar-el" }, [item.stem_element, item.branch_element].filter(Boolean).join(" · ")),
        advanced && Array.isArray(item.hidden) && item.hidden.length
          ? h("span", { class: "cp-hidden" }, item.hidden.map(hidden => h("span", { class: elementClass(hidden.element) }, `${hidden.stem || ""}`, h("small", null, hidden.ten_god || ""))))
          : null,
        advanced && (item.di_shi || item.na_yin)
          ? h("span", { class: "cp-pillar-extra" }, [item.di_shi, item.na_yin].filter(Boolean).join(" · "))
          : null);
    }));
}

function factsBlock(payload) {
  const dm = payload?.chart?.day_master || {};
  const mc = payload?.month_command || {};
  const roots = Array.isArray(payload?.roots) ? payload.roots : [];
  const rootBranches = [...new Set(roots.map(root => root.branch).filter(Boolean))];
  const facts = [
    ["日主", dm.stem ? `${dm.stem} · ${dm.yin_yang || ""}${dm.element || ""}` : "—"],
    ["月令", mc.branch ? `${mc.branch}月 · ${mc.main_qi || ""}本气` : "—"],
    ["根气", roots.length ? `${rootBranches.join("、")} · ${roots.length}处` : "原局未见"],
    ["生肖", payload?.chart?.shengxiao || "—"],
    ["胎元", payload?.tai_yuan || "—"],
    ["旬空", payload?.xun_kong || "—"],
  ];
  return h("dl", { class: "cp-facts" }, facts.map(([label, value]) => h("div", null, h("dt", null, label), h("dd", null, value))));
}

function wuxingBlock(payload) {
  const surface = payload?.wuxing_count || {};
  const hidden = payload?.wuxing_count_with_hidden || surface;
  const max = Math.max(1, ...WUXING.map(name => Number(hidden[name] ?? surface[name]) || 0));
  const totalSurface = WUXING.reduce((sum, name) => sum + (Number(surface[name]) || 0), 0);
  const totalHidden = WUXING.reduce((sum, name) => sum + (Number(hidden[name] ?? surface[name]) || 0), 0);
  return h("section", { class: "cp-section" },
    h("div", { class: "cp-section-head" }, h("h3", null, "五行分布"), h("span", { class: "muted tnum" }, `表层 ${totalSurface} · 含藏干 ${totalHidden}`)),
    h("div", { class: "cp-wuxing" }, WUXING.map(name => {
      const a = Number(surface[name]) || 0;
      const b = Number(hidden[name] ?? a) || 0;
      return h("div", { class: ["cp-wx", elementClass(name)] },
        h("span", { class: "cp-wx-name" }, name),
        h("span", { class: "cp-wx-track", "aria-hidden": "true" },
          h("i", { class: "cp-wx-hidden", style: { width: `${(b / max) * 100}%` } }),
          h("i", { class: "cp-wx-surface", style: { width: `${(a / max) * 100}%` } })),
        h("span", { class: "cp-wx-num tnum" }, `${a}`, h("small", null, ` / ${b}`)));
    })),
    h("p", { class: "cp-note" }, "深色为表层，浅色含藏干；数量只示分布，不等于旺衰强弱。"));
}

/* ---------- 大运走势（单系列折线，悬停查看数值） ---------- */
function trendChart(list, selectedIndex, onSelect) {
  const scores = list.map(step => Math.max(20, Math.min(95, Number(step.display_trend_score) || 60)));
  const width = 320;
  const height = 132;
  const pad = { l: 12, r: 12, t: 22, b: 26 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const x = index => pad.l + (list.length === 1 ? innerW / 2 : (innerW * index) / (list.length - 1));
  const y = value => pad.t + innerH - ((value - 20) / 75) * innerH;
  const points = scores.map((score, index) => [x(index), y(score)]);
  const line = points.map(([px, py], index) => `${index ? "L" : "M"}${px.toFixed(1)} ${py.toFixed(1)}`).join(" ");
  const area = `${line} L${points[points.length - 1][0].toFixed(1)} ${pad.t + innerH} L${points[0][0].toFixed(1)} ${pad.t + innerH} Z`;
  const grid = [40, 60, 80].map(value => `<line x1="${pad.l}" x2="${width - pad.r}" y1="${y(value).toFixed(1)}" y2="${y(value).toFixed(1)}" class="trend-grid"/>`).join("");
  const labels = list.map((step, index) => `<text x="${x(index).toFixed(1)}" y="${height - 8}" text-anchor="middle" class="trend-x">${step.ganzhi || ""}</text>`).join("");
  const dots = points.map(([px, py], index) => `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${index === selectedIndex ? 5.5 : 4}" class="trend-dot${index === selectedIndex ? " is-selected" : ""}"/>`).join("");
  const sel = points[selectedIndex];
  const selLabel = sel ? `<text x="${sel[0].toFixed(1)}" y="${(sel[1] - 11).toFixed(1)}" text-anchor="middle" class="trend-label">${scores[selectedIndex]}</text>` : "";
  const chart = svg(`<svg class="trend-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="大运走势示意，共 ${list.length} 步">
    ${grid}
    <path d="${area}" class="trend-area"/>
    <path d="${line}" class="trend-line"/>
    <line class="trend-cross" x1="0" x2="0" y1="${pad.t}" y2="${pad.t + innerH}" visibility="hidden"/>
    ${dots}${selLabel}${labels}
  </svg>`);
  const tip = h("div", { class: "trend-tip", hidden: true, role: "status" });
  const wrap = h("div", { class: "trend" }, chart, tip);
  const cross = chart.querySelector(".trend-cross");
  const nearest = event => {
    const rect = chart.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * width;
    let best = 0;
    points.forEach(([cx], index) => { if (Math.abs(cx - px) < Math.abs(points[best][0] - px)) best = index; });
    return best;
  };
  chart.addEventListener("pointermove", event => {
    const index = nearest(event);
    const step = list[index];
    cross.setAttribute("x1", points[index][0]);
    cross.setAttribute("x2", points[index][0]);
    cross.setAttribute("visibility", "visible");
    tip.hidden = false;
    tip.replaceChildren(
      h("b", null, `${step.ganzhi || ""} 大运`),
      h("span", null, `${step.age_range || `${step.start_age ?? ""}–${step.end_age ?? ""}`}岁 · ${step.year_range || `${step.start_year ?? ""}–${step.end_year ?? ""}`}`),
      h("span", { class: "trend-tip-row" }, h("i", { "aria-hidden": "true" }), `示意指数 ${scores[index]}`));
    const rect = chart.getBoundingClientRect();
    const left = (points[index][0] / width) * rect.width;
    tip.style.left = `${Math.max(64, Math.min(rect.width - 64, left))}px`;
  });
  chart.addEventListener("pointerleave", () => {
    cross.setAttribute("visibility", "hidden");
    tip.hidden = true;
  });
  chart.addEventListener("click", event => onSelect(nearest(event)));
  const table = h("table", { class: "sr-only" },
    h("caption", null, "大运走势示意指数"),
    h("thead", null, h("tr", null, h("th", { scope: "col" }, "大运"), h("th", { scope: "col" }, "年龄"), h("th", { scope: "col" }, "指数"))),
    h("tbody", null, list.map((step, index) => h("tr", null, h("td", null, step.ganzhi || ""), h("td", null, step.age_range || ""), h("td", null, String(scores[index]))))));
  wrap.append(table);
  return wrap;
}

function dayunBlock(payload, state, rerender) {
  const dy = payload?.da_yun;
  const section = h("section", { class: "cp-section cp-dayun" });
  if (!dy || !Array.isArray(dy.list) || !dy.list.length) {
    const ln = payload?.liu_nian;
    section.append(
      h("div", { class: "cp-section-head" }, h("h3", null, "行运")),
      ln?.pillar ? h("div", { class: "cp-year-row" }, h("span", null, "今年流年"), h("b", null, `${ln.year || ""} ${ln.pillar}`), h("span", { class: "muted" }, ln.stem_ten_god || "")) : null,
      h("p", { class: "cp-note" }, "请先填写性别，再按出生时间定大运 / 流年 / 流月。"));
    return section;
  }
  const list = dy.list;
  let selected = state.dayun;
  if (selected === null || selected === undefined || !list[selected]) {
    selected = list.findIndex(step => step.ganzhi === dy.current);
    if (selected < 0) selected = list.findIndex(step => step.ganzhi === dy.next);
    if (selected < 0) selected = 0;
    state.dayun = selected;
  }
  const step = list[selected];
  const select = index => { state.dayun = index; state.year = null; rerender(); };
  section.append(
    h("div", { class: "cp-section-head" },
      h("h3", null, "大运走势"),
      h("span", { class: "muted" }, `${list.length} 步 · ${dy.forward ? "顺排" : "逆排"} · ${dy.start_age ?? "—"} 岁起运`)),
    trendChart(list, selected, select),
    h("p", { class: "cp-note" }, "曲线把十神倾向压成相对节律，只作示意，不是吉凶定论。"),
    h("div", { class: "dayun-cards", role: "group", "aria-label": "大运（选一步查看流年）", "data-strip": "dayun" },
      list.map((item, index) => {
        const current = item.ganzhi === dy.current;
        const card = h("button", {
          type: "button",
          class: ["dayun-card", index === selected && "is-selected", current && "is-current"],
          "aria-pressed": String(index === selected),
          "data-key": `dy-${index}`,
          onClick: () => select(index),
        },
        h("span", { class: "dayun-age tnum" }, `${item.age_range || `${item.start_age ?? ""}–${item.end_age ?? ""}`}岁`),
        ganzhi(item.ganzhi, item.stem_element, item.branch_element, "dayun-gz"),
        h("span", { class: "dayun-god" }, item.stem_ten_god || ""),
        h("span", { class: "dayun-years tnum" }, item.year_range || (item.start_year ? `${item.start_year}–${item.end_year || ""}` : "年份待定")),
        current ? h("span", { class: "dayun-now" }, "当前") : null);
        return card;
      })));

  const years = Array.isArray(step?.display_years) ? step.display_years : [];
  if (!years.length) {
    section.append(h("p", { class: "cp-note" }, "逐年事实暂时不可用，请刷新后重试。"));
  } else {
    let yearIndex = state.year;
    if (yearIndex === null || yearIndex === undefined || !years[yearIndex]) {
      yearIndex = years.findIndex(item => item.current);
      if (yearIndex < 0) yearIndex = years.findIndex(item => Number(item.year) === Number(payload?.liu_nian?.year));
      if (yearIndex < 0) yearIndex = 0;
    }
    const chosen = years[yearIndex];
    const isThisYear = chosen && Number(chosen.year) === Number(payload?.liu_nian?.year);
    const clm = payload?.current_liu_yue;
    section.append(
      h("div", { class: "liunian-strip", role: "group", "aria-label": `${step.ganzhi || ""}大运的流年`, "data-strip": `liunian-${selected}` },
        years.map((item, index) => h("button", {
          type: "button",
          class: ["liunian", index === yearIndex && "is-selected", item.current && "is-current"],
          "aria-pressed": String(index === yearIndex),
          "aria-label": `${item.year || ""}年 ${item.pillar || ""}${item.stem_ten_god ? ` ${item.stem_ten_god}` : ""}${item.current ? "（今年）" : ""}`,
          "data-key": `ln-${selected}-${index}`,
          onClick: () => { state.year = index; rerender(); },
        }, h("span", { class: "tnum" }, String(item.year || "")), ganzhi(item.pillar, item.stem_element, item.branch_element), h("small", null, item.stem_ten_god || "")))),
      chosen ? h("p", { class: "liunian-detail" },
        h("b", null, `${chosen.year} ${chosen.pillar || ""}`),
        ` · ${chosen.stem_ten_god || ""} · `,
        isThisYear && clm?.pillar
          ? `今年 · 当前流月 ${clm.pillar} ${clm.stem_ten_god || ""} · ${clm.month_name || ""} · ${clm.solar_term_range || ""}`
          : `${step.ganzhi || ""}大运第 ${yearIndex + 1} 年`) : null);
  }
  return section;
}

function shenshaBlock(payload) {
  const entries = Object.entries(payload?.shensha || {});
  return h("section", { class: "cp-section" },
    h("div", { class: "cp-section-head" }, h("h3", null, "神煞")),
    entries.length
      ? h("div", { class: "cp-chips" }, entries.map(([name, positions]) => h("span", { class: "chip" }, `${name} · ${(Array.isArray(positions) ? positions : [positions]).join("/")}`)))
      : h("p", { class: "cp-note" }, "无特殊神煞"));
}

export function baziMeta(payload, input = {}) {
  const profile = payload?.profile || {};
  const gender = profile.gender || input.gender || "";
  const location = profile.location || input.location || "";
  const solar = String(profile.solar || "").slice(0, 16);
  return [gender, payload?.chart?.shengxiao ? `生肖${payload.chart.shengxiao}` : "", location, solar ? `${solar}${profile.used_true_solar ? " 真太阳时" : ""}` : ""].filter(Boolean).join(" · ");
}

export function baziPanel(payload, { name = "", input = {} } = {}) {
  const state = { dayun: null, year: null, advanced: local.get(MODE_KEY, "basic") === "advanced" };
  const root = h("section", { class: "chart-panel is-bazi", "aria-label": "八字命盘" });
  let dayun = null;
  // 选大运、流年只重绘这一段，其余盘面不动。
  const renderDayun = () => {
    const keep = dayun ? snapshot(dayun) : null;
    const next = dayunBlock(payload, state, renderDayun);
    if (dayun?.isConnected) dayun.replaceWith(next);
    dayun = next;
    if (keep) restore(next, keep);
    return next;
  };
  const render = () => {
    const keep = snapshot(root);
    const setMode = advanced => { state.advanced = advanced; local.set(MODE_KEY, advanced ? "advanced" : "basic"); render(); };
    const modeSeg = h("div", { class: "seg cp-mode", role: "group", "aria-label": "显示层级" },
      h("button", { type: "button", "aria-pressed": String(!state.advanced), "data-key": "mode-basic", onClick: () => setMode(false) }, "基础"),
      h("button", { type: "button", "aria-pressed": String(state.advanced), "data-key": "mode-advanced", onClick: () => setMode(true) }, "进阶"));
    dayun = null;
    root.replaceChildren(
      h("header", { class: "cp-head" },
        h("div", { class: "cp-title" },
          h("p", { class: "kicker" }, "八字命盘"),
          h("h2", null, name || payload?.profile_name || "我的命盘"),
          h("p", { class: "cp-meta" }, baziMeta(payload, input))),
        modeSeg),
      pillarsBlock(payload, state.advanced),
      factsBlock(payload),
      wuxingBlock(payload),
      renderDayun(),
      state.advanced ? shenshaBlock(payload) : h("p", { class: "cp-hint" }, icon("info", "icon-sm"), "想看藏干、地势纳音与神煞，切到「进阶」。"),
      h("button", { type: "button", class: "btn btn-sm btn-ghost cp-gloss", onClick: () => openGlossary("bazi") }, icon("book"), "名词解释"));
    restore(root, keep);
  };
  render();
  return root;
}

// 手机顶部的命盘速览条
export function baziStrip(payload) {
  const pillars = payload?.chart?.pillars || {};
  const detail = payload?.pillars_detail || {};
  const dm = payload?.chart?.day_master || {};
  return h("div", { class: "chart-strip" },
    h("span", { class: "strip-pillars" }, ORDER.map(([key]) => ganzhi(pillars[key], detail[key]?.stem_element, detail[key]?.branch_element, key === "day" ? "is-day" : ""))),
    dm.stem ? h("span", { class: "strip-dm" }, `日主 ${dm.stem}${dm.element || ""}`) : null);
}
