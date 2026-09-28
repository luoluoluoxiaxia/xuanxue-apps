// 八字命盘面板：四柱、命局速览、五行分布、大运流年与走势；进阶里另有所选大运的机械事实、当前流月引动与十二流月。
// 十神、五行、逐年干支、走势分值与引动关系全部使用接口投影字段，客户端不推算。
// 点一柱、所选大运、所选流年或一个流月可看古典解读（静态释义，见 ui/popover.js）。
import { h, svg, esc } from "../lib/dom.js?v=n5";
import { icon } from "../lib/icons.js?v=n5";
import { local } from "../lib/store.js?v=n5";
import { TREND_NOTE } from "../lib/copy.js?v=n5";
import { elementClass } from "./gua.js?v=n5";
import { openGlossary } from "./glossary.js?v=n5";
import { pillarPop, dayunPop, liunianPop, liuyuePop } from "./popover.js?v=n5";

const MODE_KEY = "xz-next-bazi-mode";
const ORDER = [["year", "年柱"], ["month", "月柱"], ["day", "日柱"], ["hour", "时柱"]];
const WUXING = ["木", "火", "土", "金", "水"];
const list = value => (Array.isArray(value) ? value : []);
const present = value => value !== null && value !== undefined && value !== "";
const ageRange = step => step?.age_range || [step?.start_age, step?.end_age].filter(present).join("–");
const yearRange = step => step?.year_range || (step?.start_year ? `${step.start_year}–${step.end_year || ""}` : "");

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

// 点开古典解读的小按钮：可见文字写明是哪一格的释义，读屏另有完整名称。
function infoButton(text, label, key, open) {
  return h("button", {
    type: "button",
    class: "btn btn-sm cp-info",
    "aria-label": label,
    "data-key": key,
    onClick: event => open(event.currentTarget),
  }, icon("info", "icon-sm"), text);
}

function pillarsBlock(payload, advanced) {
  const pillars = payload?.chart?.pillars || {};
  const detail = payload?.pillars_detail || {};
  return h("div", { class: "cp-pillars", role: "group", "aria-label": "四柱（点一柱看古典解读）" },
    ORDER.map(([key, label]) => {
      const item = detail[key] || {};
      const text = String(pillars[key] || item.pillar || "");
      const chars = Array.from(text);
      const god = key === "day" ? "日元" : (item.stem_ten_god || "");
      return h("button", {
        type: "button",
        class: ["cp-pillar", key === "day" && "is-day"],
        "data-key": `pillar-${key}`,
        onClick: event => pillarPop(key, text, item, { returnFocus: event.currentTarget }),
      },
      h("span", { class: "cp-pillar-label" }, label),
      h("span", { class: "cp-pillar-god" }, god || "—"),
      h("b", { class: ["cp-pillar-char", elementClass(item.stem_element)] }, chars[0] || "—"),
      h("b", { class: ["cp-pillar-char", elementClass(item.branch_element)] }, chars[1] || "—"),
      h("span", { class: "cp-pillar-el" }, [item.stem_element, item.branch_element].filter(Boolean).join(" · ")),
      advanced && Array.isArray(item.hidden) && item.hidden.length
        ? h("span", { class: "cp-hidden" }, item.hidden.map(hidden => h("span", { class: elementClass(hidden.element) }, `${hidden.stem || ""}`, h("small", null, hidden.ten_god || ""))))
        : null,
      advanced && (item.di_shi || item.na_yin)
        ? h("span", { class: "cp-pillar-extra" }, [item.di_shi, item.na_yin].filter(Boolean).join(" · "))
        : null,
      h("span", { class: "sr-only" }, "，查看古典解读"));
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

// 五行：表层与含藏干两个数都来自接口；「表层有 / 藏干见 / 未见」只是把这两个数换成文字。
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
      const state = a ? "表层有" : b ? "藏干见" : "未见";
      return h("div", { class: ["cp-wx", elementClass(name), !b && "is-absent"] },
        h("span", { class: "cp-wx-name" }, name),
        h("span", { class: "cp-wx-track", "aria-hidden": "true" },
          h("i", { class: "cp-wx-hidden", style: { width: `${(b / max) * 100}%` } }),
          h("i", { class: "cp-wx-surface", style: { width: `${(a / max) * 100}%` } })),
        h("span", { class: "cp-wx-num tnum" }, h("span", { class: "sr-only" }, "表层 "), `${a}`, h("small", null, " / ", h("span", { class: "sr-only" }, "含藏干 "), `${b}`)),
        h("span", { class: "cp-wx-state" }, state));
    })),
    h("p", { class: "cp-note" }, "深色为表层，浅色含藏干；数量只示分布，不等于旺衰强弱。"));
}

/* ---------- 走势折线（单系列，悬停查看数值；大运与运内流年共用） ---------- */
// view：axis(item) 横轴文字；tip(item) 浮窗标题与副标题；label 读屏名称；caption / columns / cells 为读屏表格；
// inset 左右留白（横轴是四位年份时放宽，窄屏两端不被裁掉）；numeric 横轴用等宽数字。
function trendChart(items, selectedIndex, onSelect, view) {
  const scores = items.map(item => Math.max(20, Math.min(95, Number(item.display_trend_score) || 60)));
  const width = 320;
  const height = 132;
  const inset = view.inset ?? 12;
  const pad = { l: inset, r: inset, t: 22, b: 26 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const x = index => pad.l + (items.length === 1 ? innerW / 2 : (innerW * index) / (items.length - 1));
  const y = value => pad.t + innerH - ((value - 20) / 75) * innerH;
  const points = scores.map((score, index) => [x(index), y(score)]);
  const line = points.map(([px, py], index) => `${index ? "L" : "M"}${px.toFixed(1)} ${py.toFixed(1)}`).join(" ");
  const area = `${line} L${points[points.length - 1][0].toFixed(1)} ${pad.t + innerH} L${points[0][0].toFixed(1)} ${pad.t + innerH} Z`;
  const grid = [40, 60, 80].map(value => `<line x1="${pad.l}" x2="${width - pad.r}" y1="${y(value).toFixed(1)}" y2="${y(value).toFixed(1)}" class="trend-grid"/>`).join("");
  const labels = items.map((item, index) => `<text x="${x(index).toFixed(1)}" y="${height - 8}" text-anchor="middle" class="trend-x${view.numeric ? " is-num" : ""}${index === selectedIndex ? " is-selected" : ""}">${esc(view.axis(item))}</text>`).join("");
  const dots = points.map(([px, py], index) => `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${index === selectedIndex ? 5.5 : 4}" class="trend-dot${index === selectedIndex ? " is-selected" : ""}"/>`).join("");
  const sel = points[selectedIndex];
  const selLabel = sel ? `<text x="${sel[0].toFixed(1)}" y="${(sel[1] - 11).toFixed(1)}" text-anchor="middle" class="trend-label">${scores[selectedIndex]}</text>` : "";
  const chart = svg(`<svg class="trend-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(view.label)}">
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
    const [title, sub] = view.tip(items[index]);
    cross.setAttribute("x1", points[index][0]);
    cross.setAttribute("x2", points[index][0]);
    cross.setAttribute("visibility", "visible");
    tip.hidden = false;
    tip.replaceChildren(...[
      h("b", null, title),
      sub ? h("span", null, sub) : null,
      h("span", { class: "trend-tip-row" }, h("i", { "aria-hidden": "true" }), `示意指数 ${scores[index]}`),
    ].filter(Boolean));
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
    h("caption", null, view.caption),
    h("thead", null, h("tr", null, view.columns.map(name => h("th", { scope: "col" }, name)))),
    h("tbody", null, items.map((item, index) => h("tr", null, view.cells(item, scores[index]).map(cell => h("td", null, String(cell ?? "")))))));
  wrap.append(table);
  return wrap;
}

const STEP_VIEW = count => ({
  axis: step => step.ganzhi || "",
  tip: step => [`${step.ganzhi || ""} 大运`, `${ageRange(step)}岁 · ${yearRange(step) || "年份待定"}`],
  label: `大运走势示意，共 ${count} 步`,
  caption: "大运走势示意指数",
  columns: ["大运", "年龄", "指数"],
  cells: (step, score) => [step.ganzhi || "", step.age_range || ageRange(step), score],
});

const YEAR_VIEW = (step, count) => ({
  inset: 16,
  numeric: true,
  axis: item => String(item.year || ""),
  tip: item => [`${item.year || ""} ${item.pillar || ""} 流年`, [item.stem_ten_god, item.current ? "今年" : ""].filter(Boolean).join(" · ")],
  label: `${step.ganzhi || ""}大运运内流年走势示意，共 ${count} 年`,
  caption: `${step.ganzhi || ""}大运运内流年示意指数`,
  columns: ["年份", "流年", "十神", "指数"],
  cells: (item, score) => [item.year, item.pillar, item.stem_ten_god, score],
});

/* ---------- 进阶：所选大运 · 机械事实 ---------- */
// 逐柱落点：接口给出的干/支关系里，以「无固定」开头的占位说明不展示。
function endpointDetail(endpoint) {
  const relations = [endpoint?.stem_relation, endpoint?.branch_relation, endpoint?.compound]
    .filter(value => value && !String(value).startsWith("无固定"));
  const actions = [endpoint?.stem_element_action, endpoint?.branch_element_action].filter(Boolean);
  return {
    pair: [endpoint?.a, endpoint?.b].filter(Boolean).join(" ↔ ") || "关系落点",
    relations: relations.join(" · ") || "同柱引动",
    actions: actions.join(" · "),
  };
}

// 两层折叠用固定标记（data-dayun-mechanics-level），展开状态记在面板状态里，切换大运、切换基础 / 进阶后保持。
function mechanicsLevel(key, open, onToggle) {
  const template = document.createElement("template");
  template.innerHTML = key === "relations"
    ? `<details class="dym-level" data-dayun-mechanics-level="relations"${open ? " open" : ""}></details>`
    : `<details class="dym-level" data-dayun-mechanics-level="endpoints"${open ? " open" : ""}></details>`;
  const details = template.content.firstElementChild;
  details.addEventListener("toggle", () => onToggle(details.open));
  return details;
}

function mechanicsBlock(step, state) {
  const hidden = list(step.branch_hidden_stems).filter(item => item && item.stem);
  const shensha = list(step.shensha).filter(Boolean);
  const relations = list(step.relations_to_natal).filter(Boolean);
  const endpoints = list(step.relations_to_natal_endpoints).map(endpointDetail);
  const range = [ageRange(step) ? `${ageRange(step)}岁` : "", yearRange(step)].filter(Boolean).join(" · ");
  const inKong = step.in_natal_xun_kong === true ? "是" : step.in_natal_xun_kong === false ? "否" : "—";
  const chips = items => h("div", { class: "cp-chips" }, items.map(item => h("span", { class: "chip" }, item)));

  const relationsLevel = mechanicsLevel("relations", state.relationsOpen, open => { state.relationsOpen = open; });
  relationsLevel.append(
    h("summary", { "data-key": "dym-relations" }, h("span", null, "作用关系"), h("span", { class: "muted tnum" }, `${shensha.length} 神煞 · ${relations.length} 关系`)),
    h("div", { class: "dym-level-body" },
      h("div", { class: "dym-group" }, h("span", null, "神煞"), chips(shensha.length ? shensha : ["无"])),
      h("div", { class: "dym-group" }, h("span", null, "与原局"), chips(relations.length ? relations : ["无固定合冲刑害"]))));

  const endpointsLevel = mechanicsLevel("endpoints", state.endpointsOpen, open => { state.endpointsOpen = open; });
  endpointsLevel.append(
    h("summary", { "data-key": "dym-endpoints" }, h("span", null, "逐柱落点"), h("span", { class: "muted tnum" }, endpoints.length ? `${endpoints.length} 处` : "暂无")),
    h("div", { class: "dym-level-body" },
      h("div", { class: "dym-group" }, h("span", null, "关系落点"),
        endpoints.length
          ? h("ul", { class: "dym-endpoints" }, endpoints.map(item => h("li", { class: "dym-endpoint" },
            h("span", null, item.pair), h("b", null, item.relations), item.actions ? h("em", null, item.actions) : null)))
          : h("p", { class: "cp-note" }, "暂无明确落点"))));

  return h("section", { class: "dym", "aria-label": `${step.ganzhi || "所选"}大运机械事实` },
    h("div", { class: "dym-head" },
      h("span", { class: "dym-kicker" }, "所选大运 · 机械事实"),
      h("span", { class: "dym-title" }, ganzhi(step.ganzhi, step.stem_element, step.branch_element), range ? h("span", { class: "muted tnum" }, range) : null),
      h("span", { class: "dym-badge" }, "排盘确定性结果 · 非 AI 判断")),
    h("div", { class: "dym-tier" }, h("span", null, "运柱基础"), h("span", null, "直接查看")),
    h("dl", { class: "dym-grid" },
      h("div", { class: "dym-cell is-wide" }, h("dt", null, "地支藏干"),
        h("dd", { class: "dym-stems" }, hidden.length
          ? hidden.map(item => h("span", { class: "dym-stem" }, h("b", { class: elementClass(item.element) }, item.stem), h("small", null, [item.ten_god, item.qi].filter(Boolean).join(" · ") || "—")))
          : h("span", { class: "dym-empty" }, "无"))),
      h("div", { class: "dym-cell" }, h("dt", null, "日主十二长生"), h("dd", null, step.day_master_stage || "—")),
      h("div", { class: "dym-cell" }, h("dt", null, "纳音"), h("dd", null, step.na_yin || "—")),
      h("div", { class: "dym-cell" }, h("dt", null, "本柱旬空"), h("dd", null, step.pillar_xun_kong || "—")),
      h("div", { class: "dym-cell" }, h("dt", null, "落本命日旬空"), h("dd", null, inKong))),
    relationsLevel,
    endpointsLevel);
}

/* ---------- 行运：没有大运（未填性别等）时只列今年流年与当前流月 ---------- */
function stageCard({ kicker, badge, current = false, item, god, range, key, open }) {
  return h("button", {
    type: "button",
    class: ["cp-stage-card", current && "is-current"],
    "data-key": key,
    onClick: event => open(event.currentTarget),
  },
  h("span", { class: "cp-stage-top" }, h("span", { class: "cp-stage-kicker" }, kicker), h("span", { class: "cp-stage-badge" }, badge)),
  ganzhi(item.pillar, item.stem_element, item.branch_element, "cp-stage-gz"),
  h("span", { class: "cp-stage-god" }, god.filter(Boolean).join(" · ") || "—"),
  range ? h("span", { class: "cp-stage-range tnum" }, range) : null,
  h("span", { class: "sr-only" }, "，查看古典解读"));
}

function stageWithoutDayun(payload) {
  const ln = payload?.liu_nian;
  const clm = payload?.current_liu_yue;
  const cards = [];
  if (ln?.pillar) {
    cards.push(stageCard({
      kicker: "今年流年", badge: "今年", current: true, item: ln, key: "stage-ln",
      god: [ln.stem_ten_god, ln.year ? `${ln.year} 年` : ""],
      open: trigger => liunianPop(ln, { returnFocus: trigger }),
    }));
    if (clm?.pillar) {
      cards.push(stageCard({
        kicker: "当前流月", badge: "本月", item: clm, key: "stage-ly",
        god: [clm.stem_ten_god, clm.month_name], range: clm.solar_term_range || "",
        open: trigger => liuyuePop(clm, { year: ln.year, returnFocus: trigger }),
      }));
    }
  }
  return h("section", { class: "cp-section cp-dayun" },
    h("div", { class: "cp-section-head" }, h("h3", null, "行运")),
    cards.length ? h("div", { class: "cp-stage", role: "group", "aria-label": "今年与本月（点开看古典解读）" }, cards) : null,
    h("p", { class: "cp-note cp-stage-hint" },
      cards.length ? "请先填写性别，再按出生时间定大运 / 人生走势。" : "请先填写性别，再定大运 / 流年 / 流月。",
      h("br"),
      "点顶部", h("span", { class: "cp-inline-icon" }, icon("edit", "icon-sm")), "「修改信息」补全。"));
}

/* ---------- 大运走势、运内流年，以及（进阶）所选大运的机械事实 ---------- */
function dayunBlock(payload, state, rerender) {
  const dy = payload?.da_yun;
  if (!dy || !Array.isArray(dy.list) || !dy.list.length) return stageWithoutDayun(payload);
  const section = h("section", { class: "cp-section cp-dayun" });
  const steps = dy.list;
  let selected = state.dayun;
  if (selected === null || selected === undefined || !steps[selected]) {
    selected = steps.findIndex(step => step.ganzhi === dy.current);
    if (selected < 0) selected = steps.findIndex(step => step.ganzhi === dy.next);
    if (selected < 0) selected = 0;
    state.dayun = selected;
  }
  const step = steps[selected];
  const isCurrentStep = !!step.ganzhi && step.ganzhi === dy.current;
  const select = index => { state.dayun = index; state.year = null; rerender(); };
  // 原生 append 会把 null 写成文字，先滤掉未启用的块。
  section.append(...[
    h("div", { class: "cp-section-head" },
      h("h3", null, "大运走势"),
      h("span", { class: "muted" }, `${steps.length} 步 · ${dy.forward ? "顺排" : "逆排"} · ${dy.start_age ?? "—"} 岁起运`)),
    trendChart(steps, selected, select, STEP_VIEW(steps.length)),
    h("div", { class: "dayun-cards", role: "group", "aria-label": "大运（选一步查看运内流年）", "data-strip": "dayun" },
      steps.map((item, index) => {
        const current = item.ganzhi === dy.current;
        return h("button", {
          type: "button",
          class: ["dayun-card", index === selected && "is-selected", current && "is-current"],
          "aria-pressed": String(index === selected),
          "data-key": `dy-${index}`,
          onClick: () => select(index),
        },
        h("span", { class: "dayun-age tnum" }, `${ageRange(item)}岁`),
        ganzhi(item.ganzhi, item.stem_element, item.branch_element, "dayun-gz"),
        h("span", { class: "dayun-god" }, item.stem_ten_god || ""),
        h("span", { class: "dayun-years tnum" }, yearRange(item) || "年份待定"),
        current ? h("span", { class: "dayun-now" }, "当前") : null);
      })),
    ...yearView(payload, step, selected, isCurrentStep, state, rerender),
    h("p", { class: "cp-note cp-trend-note" }, h("b", null, "〔按〕"), TREND_NOTE),
    state.advanced ? mechanicsBlock(step, state) : null,
  ].filter(Boolean));
  return section;
}

// 所选大运的运内流年：逐年折线（display_years[].display_trend_score）＋流年条＋所选流年一行。
function yearView(payload, step, selected, isCurrentStep, state, rerender) {
  const years = list(step?.display_years);
  const head = h("div", { class: "cp-sub-head" },
    h("div", { class: "cp-sub-title" },
      h("h4", null, `${step.ganzhi || ""} 运内流年`),
      h("span", { class: "muted tnum" }, [yearRange(step), years.length ? `${years.length} 年` : ""].filter(Boolean).join(" · "))),
    infoButton("大运释义", `${step.ganzhi || ""}大运 古典释义`, "dy-info", trigger => dayunPop(step, { current: isCurrentStep, returnFocus: trigger })));
  if (!years.length) return [head, h("p", { class: "cp-note" }, "逐年事实暂时不可用，请刷新后重试。")];
  const ln = payload?.liu_nian;
  let yearIndex = state.year;
  if (yearIndex === null || yearIndex === undefined || !years[yearIndex]) {
    yearIndex = years.findIndex(item => item.current);
    if (yearIndex < 0) yearIndex = years.findIndex(item => Number(item.year) === Number(ln?.year));
    if (yearIndex < 0) yearIndex = 0;
  }
  const chosen = years[yearIndex];
  const isThisYear = Number(chosen.year) === Number(ln?.year);
  const clm = payload?.current_liu_yue;
  const selectYear = index => { state.year = index; rerender(); };
  // 逐年条目没有地支藏干；所选正是今年时，用接口的今年流年补上。
  const yearFacts = isThisYear && ln ? { ...chosen, branch_hidden_stems: ln.branch_hidden_stems } : chosen;
  return [
    head,
    trendChart(years, yearIndex, selectYear, YEAR_VIEW(step, years.length)),
    h("div", { class: "liunian-strip", role: "group", "aria-label": `${step.ganzhi || ""}大运的流年`, "data-strip": `liunian-${selected}` },
      years.map((item, index) => h("button", {
        type: "button",
        class: ["liunian", index === yearIndex && "is-selected", item.current && "is-current"],
        "aria-pressed": String(index === yearIndex),
        "aria-label": `${item.year || ""}年 ${item.pillar || ""}${item.stem_ten_god ? ` ${item.stem_ten_god}` : ""}${item.current ? "（今年）" : ""}`,
        "data-key": `ln-${selected}-${index}`,
        onClick: () => selectYear(index),
      }, h("span", { class: "tnum" }, String(item.year || "")), ganzhi(item.pillar, item.stem_element, item.branch_element), h("small", null, item.stem_ten_god || "")))),
    h("div", { class: "cp-pick" },
      h("p", { class: "liunian-detail" },
        h("span", { class: "cp-pick-kicker" }, "所选流年"),
        h("b", null, `${chosen.year || ""} ${chosen.pillar || ""}`),
        ` · ${chosen.stem_ten_god || "—"} · `,
        isThisYear && clm?.pillar
          ? `今年 · 当前流月 ${clm.pillar} ${clm.stem_ten_god || ""} · ${clm.month_name || ""} · ${clm.solar_term_range || ""}`
          : `${step.ganzhi || ""}大运第 ${yearIndex + 1} 年`),
      infoButton("流年释义", `${chosen.year || ""}年 ${chosen.pillar || ""}流年 古典释义`, "ln-info", trigger => liunianPop(yearFacts, { returnFocus: trigger }))),
  ];
}

/* ---------- 进阶：当前流月引动与十二流月 ---------- */
function liuyueBlock(payload) {
  const months = list(payload?.liu_yue);
  const clm = payload?.current_liu_yue;
  const year = payload?.liu_nian?.year || "";
  const hasDayun = list(payload?.da_yun?.list).length > 0;
  const relations = clm
    ? [...new Set([...list(clm.relations?.to_natal), ...list(clm.relations?.to_da_yun), ...list(clm.relations?.to_liu_nian)].filter(Boolean))]
    : [];
  return h("section", { class: "cp-section cp-liuyue" },
    h("div", { class: "cp-section-head" },
      h("h3", null, "当前流月引动"),
      clm?.pillar ? h("span", { class: "muted" }, `${clm.pillar} ↔ ${["本命", hasDayun && "大运", "流年"].filter(Boolean).join(" / ")}`) : null),
    clm
      ? h("div", { class: "cp-chips" }, (relations.length ? relations : ["本月无明显引动"]).map(item => h("span", { class: "chip" }, item)))
      : h("p", { class: "cp-note" }, "当前流月暂时不可用，请刷新后重试。"),
    h("div", { class: "cp-section-head cp-liuyue-head" },
      h("h3", null, `${year} 十二流月`.trim()),
      months.length ? h("span", { class: "muted" }, "点一格看古典解读") : null),
    months.length
      ? h("div", { class: "lm-grid", role: "group", "aria-label": `${year} 十二流月`.trim() },
        months.map((month, index) => h("button", {
          type: "button",
          class: ["lm-cell", month.is_current && "is-current"],
          "data-key": `lm-${index}`,
          "aria-current": month.is_current ? "date" : null,
          onClick: event => liuyuePop(month, { year, returnFocus: event.currentTarget }),
        },
        h("span", { class: "lm-name" }, month.month_name || ""),
        ganzhi(month.pillar, month.stem_element, month.branch_element, "lm-gz"),
        h("span", { class: "lm-god" }, month.stem_ten_god || ""),
        month.is_current ? h("span", { class: "lm-now" }, "本月") : null,
        h("span", { class: "sr-only" }, "，查看古典解读"))))
      : h("p", { class: "cp-note" }, "十二流月暂时不可用，请刷新后重试。"));
}

function shenshaBlock(payload) {
  const entries = Object.entries(payload?.shensha || {});
  return h("section", { class: "cp-section" },
    h("div", { class: "cp-section-head" }, h("h3", null, "神煞")),
    entries.length
      ? h("div", { class: "cp-chips" }, entries.map(([name, positions]) => h("span", { class: "chip" }, `${name} · ${(Array.isArray(positions) ? positions : [positions]).join("/")}`)))
      : h("p", { class: "cp-note" }, "无特殊神煞"));
}

/* ---------- 盘头：性别 · 生肖 · 出生地或手动四柱 · 历法 · 出生时间 ---------- */
function genderText(value) {
  const text = String(value || "");
  if (text === "male" || text === "男") return "男";
  if (text === "female" || text === "女") return "女";
  return "";
}

function isManualChart(payload, input = {}) {
  return payload?.profile?.input_mode === "manual_pillars" || input?.input_mode === "manual_pillars";
}

// 手动四柱没有匹配到精确出生时刻时，接口在 warnings 里给出「行运近似锚点」说明。
function anchorWarning(payload) {
  return list(payload?.warnings).map(item => String(item || "")).find(item => item.includes("行运近似锚点")) || "";
}

export function baziMeta(payload, input = {}) {
  const profile = payload?.profile || {};
  const manual = isManualChart(payload, input);
  const location = profile.location || input.location || "";
  const calendar = manual ? "" : ((input.calendar || profile.calendar) === "lunar" ? "农历" : "公历");
  const solar = String(profile.solar || "").slice(0, 16);
  return [
    genderText(profile.gender || input.gender),
    payload?.chart?.shengxiao ? `生肖${payload.chart.shengxiao}` : "",
    manual ? `手动四柱 ${anchorWarning(payload) ? "近似锚点" : "匹配"}` : location,
    calendar,
    solar ? `${solar}${profile.used_true_solar ? " 真太阳时" : ""}` : "",
  ].filter(Boolean).join(" · ");
}

// beside：摆在解读页标题旁边（桌面右栏），命盘名页面上已经有了，盘头只留出生信息和层级切换。
export function baziPanel(payload, { name = "", input = {}, beside = false } = {}) {
  // relationsOpen / endpointsOpen：进阶里「作用关系」默认展开、「逐柱落点」默认收起，重绘时沿用用户的选择。
  const state = {
    dayun: null,
    year: null,
    advanced: local.get(MODE_KEY, "basic") === "advanced",
    relationsOpen: true,
    endpointsOpen: false,
  };
  const root = h("section", { class: "chart-panel is-bazi", "aria-label": "八字命盘" });
  const caveat = isManualChart(payload, input) ? anchorWarning(payload) : "";
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
    root.replaceChildren(...[
      h("header", { class: "cp-head" },
        h("div", { class: "cp-title" },
          beside ? null : h("p", { class: "kicker" }, "八字命盘"),
          beside ? null : h("h2", null, name || payload?.profile_name || "我的命盘"),
          h("p", { class: "cp-meta" }, baziMeta(payload, input))),
        modeSeg),
      caveat ? h("p", { class: "cp-caveat" }, icon("info", "icon-sm"), h("span", null, caveat)) : null,
      pillarsBlock(payload, state.advanced),
      state.advanced ? null : h("p", { class: "cp-hint" }, icon("info", "icon-sm"), "点任意一柱看古典解读；藏干、神煞与十二流月在「进阶」里。"),
      factsBlock(payload),
      wuxingBlock(payload),
      renderDayun(),
      state.advanced ? liuyueBlock(payload) : null,
      state.advanced ? shenshaBlock(payload) : null,
      h("button", { type: "button", class: "btn btn-sm btn-ghost cp-gloss", onClick: () => openGlossary("bazi") }, icon("book"), "名词解释"),
    ].filter(Boolean));
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
